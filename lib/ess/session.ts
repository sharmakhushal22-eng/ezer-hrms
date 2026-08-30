// lib/ess/session.ts — who is calling an /api/ess/* route, and what the database says
// they can see (EZER-ESS-ROLE-RENDERING-GUIDE §3–§5, reconciled 30 Aug 2026).
//
// Two ideas, kept apart on purpose:
//   · essCaller()  — the employee behind the request. ESS tokens carry it; the legacy
//                    admin login (and an ESS user with admin roles) may pass
//                    ?employee_id= to view somebody else's portal — that is "view as",
//                    and it is audited.
//   · essContext() — the menu as data: structural flags from the org columns
//                    (ess_menu in 071) merged with the RMS Grant (role_permissions,
//                    role_approval_rights). No route or component compares a role
//                    code; they read is_rm / is_hod / approval_types / modules.
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { rmsServiceClient as sb, grantForEmployee } from '@/lib/rms/server'
import { hasAdminAccess, type Grant } from '@/lib/rms/resolve'
import { atLeast } from '@/lib/rms/modules'

export interface EssCaller {
  employeeId: string            // whose portal is being rendered
  viewAs: boolean               // true when somebody else is looking at it
  actorEmployeeId: string | null
  actorLabel: string | null
}

export interface EssMenu {
  employee_id: string
  is_rm: boolean
  direct_reports: number
  is_hod: boolean
  hod_departments: string[]
  roles: string[]
  functional_scope: 'SELF' | 'TEAM' | 'DEPT' | 'BRANCH' | 'ORG'
  approval_types: string[]
  modules: Record<string, number>
}

export interface EssContext {
  caller: EssCaller
  menu: EssMenu
  grant: Grant
  companyId: string | null
  /** The nav, as data. */
  tabs: { id: string; label: string }[]
  canCompany: boolean
  canReports: boolean
  canApprovals: boolean
}

export async function essCaller(req: NextRequest): Promise<{ caller: EssCaller; error: null } | { caller: null; error: NextResponse }> {
  const auth = await requireDashboardUser(req)
  if (auth.error) return { caller: null, error: auth.error }
  const u = auth.user
  const asked = req.nextUrl.searchParams.get('employee_id') || (req.method !== 'GET' ? null : null)

  if (u.kind === 'ess' && u.employeeId) {
    if (!asked || asked === u.employeeId) {
      return { caller: { employeeId: u.employeeId, viewAs: false, actorEmployeeId: u.employeeId, actorLabel: null }, error: null }
    }
    // An ESS user with admin roles may view another portal (the ess-credentials screen).
    const g = await grantForEmployee(u.employeeId)
    if (!hasAdminAccess(g)) return { caller: null, error: NextResponse.json({ error: 'You can only open your own portal.' }, { status: 403 }) }
    return { caller: { employeeId: asked, viewAs: true, actorEmployeeId: u.employeeId, actorLabel: g.name }, error: null }
  }
  // Legacy dashboard login — not attached to an employee; must say whose portal.
  if (!asked) return { caller: null, error: NextResponse.json({ error: 'employee_id is required for the dashboard login.' }, { status: 400 }) }
  return { caller: { employeeId: asked, viewAs: true, actorEmployeeId: null, actorLabel: u.email }, error: null }
}

export async function essContext(caller: EssCaller): Promise<EssContext> {
  const [{ data: m, error }, grant, { data: emp }] = await Promise.all([
    sb.rpc('ess_menu', { p_employee_id: caller.employeeId }),
    grantForEmployee(caller.employeeId),
    sb.from('employees').select('company_id').eq('id', caller.employeeId).maybeSingle(),
  ])
  if (error) throw new Error(`ess_menu: ${error.message} — has migration 071 been run?`)
  const menu: EssMenu = {
    employee_id: caller.employeeId,
    is_rm: !!m?.is_rm, direct_reports: Number(m?.direct_reports || 0),
    is_hod: !!m?.is_hod, hod_departments: (m?.hod_departments || []) as string[],
    roles: (m?.roles || []) as string[],
    functional_scope: (m?.functional_scope || 'SELF'),
    approval_types: (m?.approval_types || []) as string[],
    modules: (m?.modules || {}) as Record<string, number>,
  }
  const lvl = (mod: string) => grant.isSuperAdmin || atLeast((grant.modules as any)[mod], 'VIEW')
  const canCompany = lvl('Company Dashboard')
  const canReports = lvl('ESS Reports')
  const canApprovals = menu.is_rm || menu.is_hod || menu.approval_types.length > 0 || grant.isSuperAdmin
  const tabs = [{ id: 'home', label: 'Home' }]
  if (canApprovals) tabs.push({ id: 'approvals', label: 'Approvals' })
  if (canCompany) tabs.push({ id: 'company', label: 'Company' })
  if (canReports) tabs.push({ id: 'reports', label: 'Reports' })
  return { caller, menu, grant, companyId: (emp?.company_id as string) || null, tabs, canCompany, canReports, canApprovals }
}

/** Both at once — the common shape of a route. */
export async function essRoute(req: NextRequest): Promise<{ ctx: EssContext; error: null } | { ctx: null; error: NextResponse }> {
  const c = await essCaller(req)
  if (c.error) return { ctx: null, error: c.error }
  try {
    return { ctx: await essContext(c.caller), error: null }
  } catch (e: any) {
    return { ctx: null, error: NextResponse.json({ error: e?.message || String(e) }, { status: 500 }) }
  }
}

export const forbidden = (why = 'You do not hold a role that opens this.') => NextResponse.json({ error: why }, { status: 403 })

/** Indian financial year label for a date: April 2026 → '2026-27'. */
export function fyOf(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

export async function notify(employeeId: string | null | undefined, title: string, body: string, link = '/ess', category = 'APPROVAL') {
  if (!employeeId) return
  await sb.from('ess_notifications').insert({ employee_id: employeeId, category, title, body, link, is_read: false })
}

export async function audit(actor: EssCaller, action: string, targetEmployeeId: string | null, detail: Record<string, unknown> = {}) {
  await sb.from('ess_access_audit').insert({
    actor_employee_id: actor.actorEmployeeId, actor_label: actor.actorLabel, action, target_employee_id: targetEmployeeId, detail,
  })
}

export interface EmpLite { id: string; emp_code: string | null; full_name: string; designation: string | null; department_id: string | null; dept_name: string | null; location_id: string | null }

/** Names for a set of employee ids, one query. */
export async function employeesById(ids: string[]): Promise<Map<string, EmpLite>> {
  const out = new Map<string, EmpLite>()
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await sb.from('employees')
      .select('id, emp_code, full_name, designation, department_id, location_id, departments!employees_department_id_fkey(dept_name)')
      .in('id', uniq.slice(i, i + 200))
    ;(data || []).forEach((e: any) => out.set(e.id, {
      id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      department_id: e.department_id, dept_name: e.departments?.dept_name || null, location_id: e.location_id,
    }))
  }
  return out
}

export const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const daysAgo = (d: string | null | undefined) => {
  if (!d) return ''
  const n = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`
}
