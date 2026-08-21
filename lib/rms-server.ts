// lib/rms-server.ts — who is making this request, and what may they touch.
//
// The browser is not asked. It sends a token; this resolves that token into an employee,
// then into roles, then into module access — all with the service key, against tables the
// anon key can no longer write (migration 055). A client that lies about its employee_id
// gets nothing, because the id never comes from the client.
//
// Two identities are accepted while the rollout is in progress:
//
//   ESS session   the real one. An HMAC token from lib/ess-session.ts carrying an
//                 employee_id, issued at /api/ess-auth/login.
//
//   Supabase auth the legacy dashboard login. Kept working ONLY until the SUPER_ADMIN
//                 role has a real person attached to it (checklist steps 1 and 9) —
//                 without it there would be a window with no way into the dashboard at
//                 all. Delete LEGACY_SUPABASE_BRIDGE below to close it; nothing else
//                 depends on it.
import { createClient } from '@supabase/supabase-js'
import { verifyEssToken } from '@/lib/ess-session'
import {
  resolveGrant, emptyGrant, MODULES,
  type Grant, type RoleRef, type AccessLevel,
} from '@/lib/permissions'

/** Flip to false the day a real person holds SUPER_ADMIN. Leaving it on is a deliberate,
 *  temporary bridge, not an oversight — see the note above. */
export const LEGACY_SUPABASE_BRIDGE = true

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

function bearer(req: { headers: { get(n: string): string | null } }): string {
  const h = req.headers.get('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

/** Is module enforcement switched on yet? Held in the database rather than an env var so
 *  it can be turned on the moment the hand-assignment list is in, without a deploy — and
 *  turned back off just as fast if something is wrong. Missing table or row reads as
 *  "not enforcing", which is the safe direction during a rollout. */
async function enforcementOn(): Promise<boolean> {
  const { data } = await sb.from('rms_config').select('enforce_module_access').limit(1).maybeSingle()
  return !!data?.enforce_module_access
}

/** Everything a person holds, resolved. Returns an empty grant rather than throwing —
 *  "no token" and "bad token" are the same answer to a caller. */
export async function grantForRequest(req: { headers: { get(n: string): string | null } }): Promise<Grant> {
  const token = bearer(req)
  if (!token) return emptyGrant()

  const ess = verifyEssToken(token)
  if (ess?.employeeId) return grantForEmployee(ess.employeeId)

  if (LEGACY_SUPABASE_BRIDGE) {
    const { data, error } = await sb.auth.getUser(token)
    if (!error && data?.user) return legacyGrant(data.user.email ?? null)
  }
  return emptyGrant()
}

/** The legacy shared dashboard login. Full access, flagged as legacy so the audit trail
 *  can tell it apart from a real person, and so the assignment screen can warn that this
 *  session is not attached to an employee record. */
async function legacyGrant(email: string | null): Promise<Grant> {
  const g = emptyGrant()
  g.name = email
  g.legacy = true
  g.enforced = await enforcementOn()
  for (const m of MODULES) g.modules[m] = 'FULL'
  g.scope = 'GROUP'
  g.salaryVisibility = 'GROUP'
  return g
}

/** Resolve an employee id into a full grant. Exported because the assignment screen needs
 *  to preview somebody else's access without becoming them. */
export async function grantForEmployee(employeeId: string): Promise<Grant> {
  const [{ data: emp }, { data: acct }, enforced] = await Promise.all([
    sb.from('employees').select('id, full_name, emp_code').eq('id', employeeId).maybeSingle(),
    sb.from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle(),
    enforcementOn(),
  ])
  if (!emp) return emptyGrant()

  const base = {
    employeeId: emp.id as string,
    name: (emp.full_name as string) ?? null,
    empCode: (emp.emp_code as string) ?? null,
    enforced,
  }
  if (!acct?.id) {
    // An employee with no ESS account holds no roles — they cannot sign in at all. The
    // trigger added in 055 stops this happening to anyone created from now on.
    return resolveGrant({ ...base, roles: [], permissions: [], approvals: [] })
  }

  const today = new Date().toISOString().slice(0, 10)
  // valid_from / valid_to arrive with migration 055. Asking for them before it runs
  // returns a 42703 and no rows, which would read as "this person holds nothing" — so
  // the query falls back to the columns that have always been there. This is what lets
  // the code ship before or after the migration rather than only after it.
  let { data: ur, error: urErr } = await sb
    .from('ess_user_roles')
    .select('role_id, valid_from, valid_to')
    .eq('ess_account_id', acct.id)
    .eq('is_active', true)
  if (urErr) {
    const retry = await sb
      .from('ess_user_roles')
      .select('role_id')
      .eq('ess_account_id', acct.id)
      .eq('is_active', true)
    ur = retry.data as any
  }

  // Effective dating: an assignment counts only while it is in force. Rows written
  // before 055 have valid_from defaulted to the migration date, so they all count.
  const roleIds = (ur || [])
    .filter((r: any) =>
      (!r.valid_from || r.valid_from <= today) &&
      (!r.valid_to   || r.valid_to   >= today))
    .map((r: any) => r.role_id as string)

  if (!roleIds.length) return resolveGrant({ ...base, roles: [], permissions: [], approvals: [] })

  const [{ data: roles }, { data: perms }, { data: rights }] = await Promise.all([
    sb.from('ess_roles').select('id, role_code, role_name, scope, salary_visibility').in('id', roleIds),
    sb.from('role_permissions').select('role_id, module, access_level').in('role_id', roleIds),
    sb.from('role_approval_rights')
      .select('role_id, approval_type, can_approve, can_reject, can_initiate').in('role_id', roleIds),
  ])

  return resolveGrant({
    ...base,
    roles: (roles || []) as RoleRef[],
    permissions: (perms || []) as { role_id: string; module: string; access_level: AccessLevel }[],
    approvals: (rights || []) as any[],
  })
}

/** The employee id behind a token, without the rest of the resolution. For routes that
 *  only need to know who is calling — e.g. to stamp an audit row. */
export async function actorFromRequest(req: { headers: { get(n: string): string | null } }): Promise<
  { employeeId: string | null; name: string | null; legacy: boolean }
> {
  const token = bearer(req)
  if (!token) return { employeeId: null, name: null, legacy: false }

  const ess = verifyEssToken(token)
  if (ess?.employeeId) {
    const { data } = await sb.from('employees').select('full_name').eq('id', ess.employeeId).maybeSingle()
    return { employeeId: ess.employeeId, name: (data?.full_name as string) ?? null, legacy: false }
  }
  if (LEGACY_SUPABASE_BRIDGE) {
    const { data, error } = await sb.auth.getUser(token)
    if (!error && data?.user) return { employeeId: null, name: data.user.email ?? null, legacy: true }
  }
  return { employeeId: null, name: null, legacy: false }
}

export { sb as rmsServiceClient }
