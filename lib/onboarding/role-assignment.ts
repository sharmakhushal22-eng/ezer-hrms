// lib/onboarding/role-assignment.ts — SERVER ONLY.
//
// After IT, Admin and Payroll have approved an onboarding, the HR Manager assigns the joiner's
// reporting line (L1, L2, HOD) and ESS role from the onboarding card (Role assignment). The
// role's module permissions are shown while choosing and a snapshot is kept on the record, so
// what was granted is on file even if the role changes later. Generating the employee code
// requires this; at that moment the assignment is applied to the new employee:
// employee_relationships rows (what the org chart reads), employees.l1/l2_manager_id, an ESS
// account (inactive, credentials are issued separately) and the ess_user_roles row.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RoleOption { id: string; role_code: string; role_name: string; scope: string | null; salary_visibility: string | null; permissions: { module: string; access_level: string }[] }
export interface EmpOption { id: string; emp_code: string; full_name: string; designation: string | null; department: string | null }
export interface RoleAssignment {
  role_id: string; role_code: string; role_name: string
  permissions: { module: string; access_level: string }[]
  l1_manager_id: string; l2_manager_id: string | null; hod_id: string | null
  l1_name?: string | null; l2_name?: string | null; hod_name?: string | null
  by: string | null; by_name: string | null; at: string
}

/** Roles that are never handed out from onboarding. */
const HIDDEN_ROLES = new Set(['ALL_ACCESS', 'ADMIN_SUPER', 'IMPL_MANAGER', 'HI'])
const CAND = 'id, full_name, designation, department, status, company_id, l1_manager_id, l2_manager_id, hod_id, role_assignment, employee_code'

/** What the Role assignment form needs: the candidate, the company's active employees to pick
 *  managers from, and the roles with their module permissions. */
export async function roleOptions(sb: SupabaseClient, onboardingId: string) {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', onboardingId).maybeSingle()
  if (!oc) return null
  const [{ data: emps }, { data: roles }, { data: perms }] = await Promise.all([
    sb.from('employees').select('id, emp_code, full_name, designation, department').eq('company_id', oc.company_id).eq('employment_status', 'Active').order('full_name').limit(2000),
    sb.from('ess_roles').select('id, role_code, role_name, scope, salary_visibility, sort_order').order('sort_order'),
    sb.from('role_permissions').select('role_id, module, access_level'),
  ])
  const byRole = new Map<string, { module: string; access_level: string }[]>()
  for (const p of (perms || []) as any[]) { if (p.access_level === 'NONE') continue; const l = byRole.get(p.role_id) || []; l.push({ module: p.module, access_level: p.access_level }); byRole.set(p.role_id, l) }
  return {
    candidate: oc,
    employees: ((emps || []) as any[]).map(e => ({ id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation, department: e.department })) as EmpOption[],
    roles: ((roles || []) as any[]).filter(r => !HIDDEN_ROLES.has(r.role_code)).map(r => ({ id: r.id, role_code: r.role_code, role_name: r.role_name, scope: r.scope, salary_visibility: r.salary_visibility, permissions: (byRole.get(r.id) || []).sort((a, b) => a.module.localeCompare(b.module)) })) as RoleOption[],
  }
}

export interface SaveInput { onboardingId: string; l1: string; l2?: string | null; hod?: string | null; roleId: string; actorId: string | null; actorName: string | null }

/** The HR Manager's assignment. Only after the three heads have approved (status APPROVED). */
export async function saveRoleAssignment(sb: SupabaseClient, i: SaveInput): Promise<{ ok: boolean; error?: string; status?: number; assignment?: RoleAssignment }> {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', i.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated — change the role from Roles & access instead.', status: 409 }
  if (oc.status !== 'APPROVED') return { ok: false, error: 'IT, Admin and Payroll have to approve first; the role is assigned after that.', status: 409 }
  if (!i.l1) return { ok: false, error: 'Pick the L1 manager.', status: 400 }
  if (!i.roleId) return { ok: false, error: 'Pick the role.', status: 400 }
  const ids = [i.l1, i.l2, i.hod].filter((x): x is string => !!x)
  if (new Set(ids).size !== ids.length && i.l1 === i.l2) return { ok: false, error: 'L1 and L2 cannot be the same person.', status: 400 }
  const { data: emps } = await sb.from('employees').select('id, full_name, company_id').in('id', ids)
  const byId = new Map<string, any>(((emps || []) as any[]).map(e => [e.id, e]))
  for (const id of ids) {
    const e = byId.get(id)
    if (!e) return { ok: false, error: 'A chosen manager was not found.', status: 400 }
    if (e.company_id !== oc.company_id) return { ok: false, error: `${e.full_name} is in another company.`, status: 400 }
  }
  const { data: role } = await sb.from('ess_roles').select('id, role_code, role_name').eq('id', i.roleId).maybeSingle()
  if (!role || HIDDEN_ROLES.has(role.role_code)) return { ok: false, error: 'That role cannot be assigned from onboarding.', status: 400 }
  const { data: perms } = await sb.from('role_permissions').select('module, access_level').eq('role_id', role.id).neq('access_level', 'NONE')

  const assignment: RoleAssignment = {
    role_id: role.id, role_code: role.role_code, role_name: role.role_name,
    permissions: ((perms || []) as any[]).map(p => ({ module: p.module, access_level: p.access_level })).sort((a, b) => a.module.localeCompare(b.module)),
    l1_manager_id: i.l1, l2_manager_id: i.l2 || null, hod_id: i.hod || null,
    l1_name: byId.get(i.l1)?.full_name || null, l2_name: i.l2 ? byId.get(i.l2)?.full_name || null : null, hod_name: i.hod ? byId.get(i.hod)?.full_name || null : null,
    by: i.actorId, by_name: i.actorName, at: new Date().toISOString(),
  }
  const { error } = await sb.from('onboarding_candidates').update({ l1_manager_id: i.l1, l2_manager_id: i.l2 || null, hod_id: i.hod || null, role_assignment: assignment }).eq('id', i.onboardingId)
  if (error) return { ok: false, error: error.message, status: 500 }
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: i.onboardingId, action: 'ROLE_ASSIGNED', actor_type: 'HR', actor_id: i.actorId,
    details: { by: i.actorName, role: role.role_code, l1: assignment.l1_name, l2: assignment.l2_name, hod: assignment.hod_name, modules: assignment.permissions.length },
  }).then(() => null, () => null)
  return { ok: true, assignment }
}

/** At code generation: the assignment becomes the employee's reporting line and ESS role.
 *  Best effort — each step reports rather than blocks the employee record. */
export async function applyRoleAssignment(sb: SupabaseClient, onboardingId: string, employeeId: string, by: string | null): Promise<{ applied: string[]; warnings: string[] }> {
  const applied: string[] = [], warnings: string[] = []
  const { data: oc } = await sb.from('onboarding_candidates').select('l1_manager_id, l2_manager_id, hod_id, role_assignment').eq('id', onboardingId).maybeSingle()
  if (!oc) return { applied, warnings: ['onboarding record not found'] }
  const today = new Date().toISOString().slice(0, 10)
  const lines: [string, string | null][] = [['L1', oc.l1_manager_id], ['L2', oc.l2_manager_id], ['HOD', oc.hod_id]]
  for (const [type, mgr] of lines) {
    if (!mgr || mgr === employeeId) continue
    await sb.from('employee_relationships').update({ valid_to: today }).eq('employee_id', employeeId).eq('relationship_type', type).is('valid_to', null)
    const { error } = await sb.from('employee_relationships').insert({ employee_id: employeeId, manager_employee_id: mgr, relationship_type: type, source: 'MANUAL', valid_from: today })
    if (error) warnings.push(`${type} manager: ${error.message}`); else applied.push(`${type} manager`)
  }
  const patch: Record<string, any> = {}
  if (oc.l1_manager_id) patch.l1_manager_id = oc.l1_manager_id
  if (oc.l2_manager_id) patch.l2_manager_id = oc.l2_manager_id
  if (Object.keys(patch).length) { const { error } = await sb.from('employees').update(patch).eq('id', employeeId); if (error) warnings.push(`employee managers: ${error.message}`) }

  const ra = oc.role_assignment as RoleAssignment | null
  if (ra?.role_id) {
    let acct: string | null = null
    const { data: found } = await sb.from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle()
    if (found?.id) acct = found.id
    else { const { data: made, error } = await sb.from('ess_accounts').insert({ employee_id: employeeId, status: 'INACTIVE' }).select('id').single(); if (error) warnings.push(`ESS account: ${error.message}`); acct = made?.id || null }
    if (acct) {
      const { error } = await sb.from('ess_user_roles').upsert({ ess_account_id: acct, role_id: ra.role_id, is_active: true, assigned_by: by, assigned_at: new Date().toISOString() }, { onConflict: 'ess_account_id,role_id' })
      if (error) warnings.push(`role ${ra.role_code}: ${error.message}`)
      else {
        applied.push(`role ${ra.role_code}`)
        await sb.from('ess_access_audit').insert({ ess_account_id: acct, action: 'ROLE_ASSIGN', performed_by: by, performed_by_name: ra.by_name || 'Onboarding', reason: 'Assigned at onboarding (Role assignment before code generation)', details: { employee_id: employeeId, role: ra.role_code, mode: 'add' } }).then(() => null, () => null)
      }
    }
  }
  return { applied, warnings }
}
