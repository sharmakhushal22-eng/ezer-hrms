// lib/rms/server.ts — who is making this request, and what may they touch.
//
// The browser is never asked. It sends a token; this turns that token into an employee,
// then into roles, then into module access — with the service key, on the server. A
// client that lies about its employee id gets nothing, because the id never comes from
// the client.
//
// Two identities are accepted:
//
//   ESS session    the real one — an HMAC token from lib/ess-session.ts carrying an
//                  employee id, issued at /api/ess-auth/login.
//
//   Supabase auth  the legacy shared dashboard login. Still accepted, because until a
//                  named person holds a super-admin role there would otherwise be a
//                  window with no way into the dashboard at all. Set
//                  LEGACY_SUPABASE_BRIDGE to false to close it; nothing else depends on
//                  it.
import { createClient } from '@supabase/supabase-js'
import { verifyEssToken } from '@/lib/ess-session'
import { resolveGrant, emptyGrant, type Grant, type RoleRef } from '@/lib/rms/resolve'
import { buildChain, type ManagerSlot, type ManagerRef, type Relationship, type RelationshipType } from '@/lib/rms/hierarchy'
import { MODULES, type AccessLevel } from '@/lib/rms/modules'

/** Flip to false the day a named person holds a super-admin role. Leaving it on is a
 *  deliberate, temporary bridge rather than an oversight. */
export const LEGACY_SUPABASE_BRIDGE = true

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export { sb as rmsServiceClient }

interface HeaderBag { headers: { get(n: string): string | null } }

function bearer(req: HeaderBag): string {
  const h = req.headers.get('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

/** Is module enforcement switched on? Held in the database rather than an env var so it
 *  can be turned on the moment the roles are assigned, without a deploy — and turned back
 *  off just as fast. A missing table or row reads as "not enforcing", which is the safe
 *  direction while a migration is still pending. */
async function enforcementOn(): Promise<boolean> {
  const { data } = await sb.from('rms_config').select('enforce_module_access').limit(1).maybeSingle()
  return !!data?.enforce_module_access
}

/** Everything a person holds. Returns an empty grant rather than throwing — "no token"
 *  and "bad token" are the same answer to a caller. */
export async function grantForRequest(req: HeaderBag): Promise<Grant> {
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

/** The legacy shared login. Full access, flagged as legacy so the audit trail can tell it
 *  apart from a named person and the assignment screen can warn that this session is not
 *  attached to an employee record. */
async function legacyGrant(email: string | null): Promise<Grant> {
  const g = emptyGrant()
  g.name = email
  g.legacy = true
  g.enforced = await enforcementOn()
  for (const m of MODULES) g.modules[m] = 'FULL'
  return g
}

/** Resolve one employee into a full grant. Exported because the role assignment screen
 *  needs to preview somebody else's access without becoming them. */
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
    // No ESS account means no roles — they cannot sign in at all.
    return resolveGrant({ ...base, roles: [], permissions: [], approvals: [] })
  }

  const { data: ur } = await sb
    .from('ess_user_roles')
    .select('role_id')
    .eq('ess_account_id', acct.id)
    .eq('is_active', true)

  const roleIds = (ur || []).map((r: any) => r.role_id as string)
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

/** The employee behind a token, without the rest of the resolution — for routes that only
 *  need to know who is calling, to stamp an audit row. */
export async function actorFromRequest(req: HeaderBag): Promise<{ employeeId: string | null; name: string | null; legacy: boolean }> {
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

// ── The reporting structure ─────────────────────────────────────────────────

const MANAGER_FIELDS = 'id, emp_code, full_name, designation, office_email, personal_email, department_id'

/** The management chain for one employee, resolved into people. Reads the relationship
 *  table directly rather than the helper function, so it still works on a deployment
 *  where migration 058 has been applied but PostgREST has not yet reloaded its schema
 *  cache. */
export async function managerChainFor(employeeId: string): Promise<ManagerSlot[]> {
  const { data: rels, error } = await sb
    .from('employee_relationships')
    .select('employee_id, manager_employee_id, relationship_type')
    .eq('employee_id', employeeId)
    .is('valid_to', null)
  if (error || !rels?.length) return []

  const ids = [...new Set(rels.map((r: any) => r.manager_employee_id as string))]
  const [{ data: people }, { data: depts }] = await Promise.all([
    sb.from('employees').select(MANAGER_FIELDS).in('id', ids),
    sb.from('departments').select('id, dept_name'),
  ])
  const deptName = new Map((depts || []).map((d: any) => [d.id, d.dept_name]))
  const managers: Record<string, ManagerRef> = {}
  for (const p of people || []) {
    managers[(p as any).id] = {
      id: (p as any).id,
      emp_code: (p as any).emp_code ?? null,
      full_name: (p as any).full_name ?? null,
      designation: (p as any).designation ?? null,
      department: deptName.get((p as any).department_id) ?? null,
      office_email: (p as any).office_email ?? null,
      personal_email: (p as any).personal_email ?? null,
    }
  }
  return buildChain(rels as unknown as Relationship[], managers)
}

/** Who reports to this person, one level down. */
export async function directReportsFor(managerId: string, type: RelationshipType | null = 'L1') {
  let q = sb
    .from('employee_relationships')
    .select('employee_id, relationship_type')
    .eq('manager_employee_id', managerId)
    .is('valid_to', null)
  if (type) q = q.eq('relationship_type', type)
  const { data: rels } = await q
  if (!rels?.length) return []

  const ids = [...new Set(rels.map((r: any) => r.employee_id as string))]
  const [{ data: people }, { data: depts }] = await Promise.all([
    sb.from('employees').select(MANAGER_FIELDS).in('id', ids),
    sb.from('departments').select('id, dept_name'),
  ])
  const deptName = new Map((depts || []).map((d: any) => [d.id, d.dept_name]))
  return (people || []).map((p: any) => ({
    id: p.id,
    emp_code: p.emp_code ?? null,
    full_name: p.full_name ?? null,
    designation: p.designation ?? null,
    department: deptName.get(p.department_id) ?? null,
  })).sort((a, b) => String(a.emp_code).localeCompare(String(b.emp_code)))
}

/** Everybody beneath this person, following L1 downward. Uses the recursive helper from
 *  migration 058 so the walk happens once in the database rather than as N round trips. */
export async function allReportsFor(managerId: string, maxDepth = 12) {
  const { data, error } = await sb.rpc('employee_all_reports', { p_manager_id: managerId, p_max_depth: maxDepth })
  if (error) return []
  return (data || []) as { employee_id: string; emp_code: string; full_name: string; depth: number }[]
}

// ── Peers, the whole tree, and diagnostics (migration 060) ──────────────────

export interface PeerRef {
  id: string
  emp_code: string | null
  full_name: string | null
  designation: string | null
  department: string | null
  isSelf: boolean
  directReports: number
}

/** Everyone sharing this person's L1 manager. Empty for anyone at the top of
 *  their chain — an org root has no peers. */
export async function peersFor(employeeId: string, includeSelf = true): Promise<PeerRef[]> {
  const { data, error } = await sb.rpc('org_peers', { p_employee_id: employeeId, p_include_self: includeSelf })
  if (error) return []
  return (data || []).map((r: any) => ({
    id: r.employee_id, emp_code: r.emp_code, full_name: r.full_name,
    designation: r.designation, department: r.department,
    isSelf: !!r.is_self, directReports: r.direct_reports || 0,
  }))
}

export interface OrgTreeNode {
  id: string
  companyId: string
  empCode: string | null
  fullName: string | null
  designation: string | null
  department: string | null
  grade: string | null
  managerId: string | null
  depth: number
  directReports: number
  isHod: boolean
}

/** The whole company as one flat, parent-linked list — the org chart lays
 *  this out client-side rather than asking the database once per node. */
export async function orgTreeFor(companyId: string): Promise<OrgTreeNode[]> {
  const { data, error } = await sb
    .from('v_org_tree')
    .select('id, company_id, emp_code, full_name, designation, department, grade, l1_manager_id, depth, direct_reports, is_hod')
    .eq('company_id', companyId)
    .order('depth')
  if (error) return []
  return (data || []).map((r: any) => ({
    id: r.id, companyId: r.company_id, empCode: r.emp_code, fullName: r.full_name,
    designation: r.designation, department: r.department, grade: r.grade,
    managerId: r.l1_manager_id, depth: r.depth,
    directReports: r.direct_reports || 0, isHod: !!r.is_hod,
  }))
}

export interface OrphanRef { emp_code: string; full_name: string; designation: string | null; department: string | null }

/** Active employees with nobody above them and no department-head tag of
 *  their own. Their approvals have nowhere to land. */
export async function orphansFor(companyId?: string): Promise<OrphanRef[]> {
  const { data, error } = await sb.rpc('org_orphans', { p_company_id: companyId ?? null })
  return error ? [] : ((data || []) as OrphanRef[])
}

export interface SpanRow { emp_code: string; full_name: string; designation: string | null; department: string | null; direct_reports: number }

/** Managers ranked by direct reports, widest first. */
export async function spanOfControlFor(companyId?: string, limit = 20): Promise<SpanRow[]> {
  let q = sb.from('v_span_of_control').select('emp_code, full_name, designation, department, direct_reports').order('direct_reports', { ascending: false }).limit(limit)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  return error ? [] : ((data || []) as SpanRow[])
}

export interface DriftRow { emp_code: string; full_name: string; field: string; stored: string | null; tree: string | null }

/** Rows where employees.l1_manager_id / l2_manager_id disagree with
 *  employee_relationships — a real risk, since the classic `employment`
 *  bulk-uploader still writes l1_manager_id directly and bypasses the
 *  relationship table entirely. */
export async function driftReportFor(companyId?: string): Promise<DriftRow[]> {
  const { data, error } = await sb.rpc('org_drift_report', { p_company_id: companyId ?? null })
  return error ? [] : ((data || []) as DriftRow[])
}
