// lib/onboarding/hr-assignment.ts — SERVER ONLY.
//
// The HR Manager's two assignments on an onboarding, and how they land on the new employee:
//
//   1. Assign managers — on the review sheet, BEFORE the form is accepted: the joiner's L1, L2
//      and HOD. Kept in onboarding_candidates.l1_manager_id / l2_manager_id / hod_id (and, with
//      names, under role_assignment.managers). Accepting the form requires it.
//   2. Generate code — on the card, once IT, Admin and Payroll have approved: the joiner's TEAM
//      (the employees who will report to them, pasted by code — lib/onboarding/team-plan.ts
//      shifts everybody under them one level down) and their ESS ROLES (checkboxes). Kept under
//      role_assignment.team / .roles, then the code is generated.
//
// When the employee row exists (lib/onboarding/create-employee.ts), applyAssignment writes:
//   employee_relationships rows for the joiner (L1 / L2 / HOD) and for every planned team member,
//   employees.l1_manager_id / l2_manager_id / hod_id likewise,
//   an ACTIVE ess_accounts row with a temporary password (must_change_password) and one
//   ess_user_roles row per role — the credentials go to the joiner by mail from create-employee.

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/ess-auth'
import { planTeam, withJoinerId, summarisePlan, autoRoleCodes, MANAGER_ROLE_CODES, type Chain, type TeamPerson, type PlannedMember, type Level } from './team-plan'

export interface RoleOption { id: string; role_code: string; role_name: string; scope: string | null; salary_visibility: string | null; permissions: { module: string; access_level: string }[] }
export interface EmpOption extends Chain { id: string; emp_code: string; full_name: string; designation: string | null; department: string | null }
export interface ManagerRef { id: string; name: string; emp_code: string | null; designation: string | null }
export interface Managers {
  l1_manager_id: string; l2_manager_id: string | null; hod_id: string | null
  l1_name: string | null; l2_name: string | null; hod_name: string | null
  by: string | null; by_name: string | null; at: string
}
/** onboarding_candidates.role_assignment — written in two steps (managers on the sheet, team + roles at the code). */
export interface HrAssignment {
  managers?: Managers
  /** `auto`: a manager role the team's depth decided (L1 / L2 / HOD), not ticked by hand. */
  roles?: { role_id: string; role_code: string; role_name: string; auto?: boolean }[]
  /** The union of the roles' module permissions, as granted. */
  permissions?: { module: string; access_level: string }[]
  team?: { direct: string[]; exclude: string[]; summary: string; count: number }
  by?: string | null; by_name?: string | null; at?: string
  /** Legacy single-role shape (before 18-Oct-2026). */
  role_id?: string; role_code?: string; role_name?: string
}

/** Roles that are never handed out from onboarding. */
const HIDDEN_ROLES = new Set(['ALL_ACCESS', 'ADMIN_SUPER', 'IMPL_MANAGER', 'HI'])
const CAND = 'id, full_name, email, designation, department, employment_type, status, company_id, l1_manager_id, l2_manager_id, hod_id, role_assignment, employee_code, it_email, hiring_track, work_country, payroll_currency, employing_entity'
const OPEN = ['SUBMITTED', 'HR_REVIEW', 'APPROVED']
const today = () => new Date().toISOString().slice(0, 10)

// ── Company people with their current chain ──────────────────────────────────────────────────

/** Everybody active in the company with their live L1 / L2 / HOD: the relationship rows first
 *  (what the org chart reads), the employees columns where there is no row. */
export async function companyPeople(sb: SupabaseClient, companyId: string): Promise<Map<string, TeamPerson>> {
  const [{ data: emps }, { data: depts }] = await Promise.all([
    sb.from('employees').select('id, emp_code, full_name, designation, department_id, l1_manager_id, l2_manager_id, hod_id').eq('company_id', companyId).eq('employment_status', 'Active').or('is_test.is.null,is_test.eq.false').order('full_name').limit(5000),
    sb.from('departments').select('id, dept_name').eq('company_id', companyId),
  ])
  const dept = new Map<string, string>(((depts || []) as any[]).map(d => [d.id, d.dept_name]))
  const people = new Map<string, TeamPerson>()
  for (const e of (emps || []) as any[]) people.set(e.id, { id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation ?? null, department: e.department_id ? dept.get(e.department_id) ?? null : null, l1: e.l1_manager_id || null, l2: e.l2_manager_id || null, hod: e.hod_id || null })
  const ids = [...people.keys()]
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rels } = await sb.from('employee_relationships').select('employee_id, manager_employee_id, relationship_type').in('employee_id', ids.slice(i, i + 200)).is('valid_to', null)
    for (const r of (rels || []) as any[]) {
      const p = people.get(r.employee_id); if (!p) continue
      if (r.relationship_type === 'L1') p.l1 = r.manager_employee_id
      else if (r.relationship_type === 'L2') p.l2 = r.manager_employee_id
      else if (r.relationship_type === 'HOD') p.hod = r.manager_employee_id
    }
  }
  return people
}

const reportsIndex = (people: Map<string, TeamPerson>) => {
  const by = new Map<string, string[]>()
  for (const p of people.values()) if (p.l1) { const l = by.get(p.l1) || []; l.push(p.id); by.set(p.l1, l) }
  return (m: string) => by.get(m) || []
}
const asOption = (p: TeamPerson): EmpOption => ({ id: p.id, emp_code: p.emp_code, full_name: p.full_name, designation: p.designation ?? null, department: p.department ?? null, l1: p.l1, l2: p.l2, hod: p.hod })
const ref = (people: Map<string, TeamPerson>, id: string | null): ManagerRef | null => {
  if (!id) return null
  const p = people.get(id)
  return p ? { id, name: p.full_name, emp_code: p.emp_code, designation: p.designation ?? null } : { id, name: '—', emp_code: null, designation: null }
}

// ── What the forms need ──────────────────────────────────────────────────────────────────────

/** The candidate, the company's people (to pick managers / team from) and the roles with their permissions. */
export async function assignmentOptions(sb: SupabaseClient, onboardingId: string) {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', onboardingId).maybeSingle()
  if (!oc) return null
  const [people, { data: roles }, { data: perms }] = await Promise.all([
    companyPeople(sb, oc.company_id),
    sb.from('ess_roles').select('id, role_code, role_name, scope, salary_visibility, sort_order').order('sort_order'),
    sb.from('role_permissions').select('role_id, module, access_level'),
  ])
  const byRole = new Map<string, { module: string; access_level: string }[]>()
  for (const p of (perms || []) as any[]) { if (p.access_level === 'NONE') continue; const l = byRole.get(p.role_id) || []; l.push({ module: p.module, access_level: p.access_level }); byRole.set(p.role_id, l) }
  const { role_assignment: ra, ...cand } = oc as any
  return {
    candidate: { ...cand, assignment: (ra || null) as HrAssignment | null },
    managers: { l1: ref(people, oc.l1_manager_id), l2: ref(people, oc.l2_manager_id), hod: ref(people, oc.hod_id) },
    employees: [...people.values()].map(asOption),
    roles: ((roles || []) as any[]).filter(r => !HIDDEN_ROLES.has(r.role_code)).map(r => ({ id: r.id, role_code: r.role_code, role_name: r.role_name, scope: r.scope, salary_visibility: r.salary_visibility, permissions: (byRole.get(r.id) || []).sort((a, b) => a.module.localeCompare(b.module)) })) as RoleOption[],
  }
}

/** The managers of an onboarding, named — for the review sheet. */
export async function managersOf(sb: SupabaseClient, oc: { l1_manager_id?: string | null; l2_manager_id?: string | null; hod_id?: string | null }) {
  const ids = [oc.l1_manager_id, oc.l2_manager_id, oc.hod_id].filter((x): x is string => !!x)
  if (!ids.length) return { l1: null, l2: null, hod: null }
  const { data } = await sb.from('employees').select('id, full_name, emp_code, designation').in('id', ids)
  const by = new Map<string, any>(((data || []) as any[]).map(e => [e.id, e]))
  const r = (id?: string | null): ManagerRef | null => { if (!id) return null; const e = by.get(id); return e ? { id, name: e.full_name, emp_code: e.emp_code, designation: e.designation ?? null } : { id, name: '—', emp_code: null, designation: null } }
  return { l1: r(oc.l1_manager_id), l2: r(oc.l2_manager_id), hod: r(oc.hod_id) }
}

// ── 1. Assign managers (review sheet) ────────────────────────────────────────────────────────

export interface ManagersInput { onboardingId: string; l1: string; l2?: string | null; hod?: string | null; actorId: string | null; actorName: string | null }

export async function saveManagers(sb: SupabaseClient, i: ManagersInput): Promise<{ ok: boolean; error?: string; status?: number; managers?: Managers }> {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', i.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated — change the reporting line from the employee record.', status: 409 }
  if (!OPEN.includes(oc.status)) return { ok: false, error: 'The candidate has not submitted the form yet.', status: 409 }
  if (!i.l1) return { ok: false, error: 'Pick the L1 manager.', status: 400 }
  if (i.l2 && i.l2 === i.l1) return { ok: false, error: 'L1 and L2 cannot be the same person.', status: 400 }
  const ids = [...new Set([i.l1, i.l2, i.hod].filter((x): x is string => !!x))]
  const { data: emps } = await sb.from('employees').select('id, full_name, company_id, employment_status').in('id', ids)
  const byId = new Map<string, any>(((emps || []) as any[]).map(e => [e.id, e]))
  for (const id of ids) {
    const e = byId.get(id)
    if (!e) return { ok: false, error: 'A chosen manager was not found.', status: 400 }
    if (e.company_id !== oc.company_id) return { ok: false, error: `${e.full_name} is in another company.`, status: 400 }
  }
  const managers: Managers = {
    l1_manager_id: i.l1, l2_manager_id: i.l2 || null, hod_id: i.hod || null,
    l1_name: byId.get(i.l1)?.full_name || null, l2_name: i.l2 ? byId.get(i.l2)?.full_name || null : null, hod_name: i.hod ? byId.get(i.hod)?.full_name || null : null,
    by: i.actorId, by_name: i.actorName, at: new Date().toISOString(),
  }
  const prev = (oc.role_assignment || {}) as HrAssignment
  const { error } = await sb.from('onboarding_candidates').update({ l1_manager_id: i.l1, l2_manager_id: i.l2 || null, hod_id: i.hod || null, role_assignment: { ...prev, managers } }).eq('id', i.onboardingId)
  if (error) return { ok: false, error: error.message, status: 500 }
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: i.onboardingId, action: 'MANAGERS_ASSIGNED', actor_type: 'HR', actor_id: i.actorId,
    details: { by: i.actorName, l1: managers.l1_name, l2: managers.l2_name, hod: managers.hod_name },
  }).then(() => null, () => null)
  return { ok: true, managers }
}

// ── 2. The team plan (Generate code, step Team) ──────────────────────────────────────────────

export interface TeamPlanOut {
  joiner: { l1: ManagerRef | null; l2: ManagerRef | null; hod: ManagerRef | null }
  /** The pasted people who matched, in the order given. */
  direct: EmpOption[]
  unknown: string[]
  members: PlannedMember[]
  problems: string[]
  warnings: string[]
  summary: string
  /** id → name / code, for everybody the plan mentions (managers before and after). */
  names: Record<string, { name: string; emp_code: string | null }>
}

/** Resolve pasted codes (or ids) to people and draw the plan. */
export async function teamPlanFor(sb: SupabaseClient, onboardingId: string, codes: string[], exclude: string[] = []): Promise<TeamPlanOut | null> {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', onboardingId).maybeSingle()
  if (!oc) return null
  const people = await companyPeople(sb, oc.company_id)
  const byCode = new Map<string, TeamPerson>([...people.values()].map(p => [String(p.emp_code || '').toUpperCase(), p]))
  const direct: EmpOption[] = [], unknown: string[] = [], directIds: string[] = []
  for (const raw of codes) {
    const c = String(raw || '').trim()
    if (!c) continue
    const p = people.get(c) || byCode.get(c.toUpperCase())
    if (!p) { unknown.push(c); continue }
    if (!directIds.includes(p.id)) { directIds.push(p.id); direct.push(asOption(p)) }
  }
  const joiner: Chain = { l1: oc.l1_manager_id || null, l2: oc.l2_manager_id || null, hod: oc.hod_id || null }
  const plan = planTeam(joiner, directIds, people, reportsIndex(people), { exclude })
  const names: Record<string, { name: string; emp_code: string | null }> = {}
  const name = (id: string | null) => { if (id && !names[id]) { const p = people.get(id); names[id] = p ? { name: p.full_name, emp_code: p.emp_code } : { name: '—', emp_code: null } } }
  for (const m of plan.members) { name(m.id); for (const c of [m.before, m.after]) { name(c.l1); name(c.l2); name(c.hod) } }
  ;[joiner.l1, joiner.l2, joiner.hod].forEach(name)
  return { joiner: { l1: ref(people, joiner.l1), l2: ref(people, joiner.l2), hod: ref(people, joiner.hod) }, direct, unknown, members: plan.members, problems: plan.problems, warnings: plan.warnings, summary: summarisePlan(plan.members), names }
}

// ── 2. Roles + team, recorded just before the code is generated ──────────────────────────────

export interface CodeAssignmentInput { onboardingId: string; roleIds: string[]; team: { direct: string[]; exclude: string[] }; actorId: string | null; actorName: string | null }

export async function saveCodeAssignment(sb: SupabaseClient, i: CodeAssignmentInput): Promise<{ ok: boolean; error?: string; status?: number; code?: string; assignment?: HrAssignment }> {
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', i.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated.', status: 409 }
  if (!oc.l1_manager_id) return { ok: false, error: 'The managers are not assigned — open the form (View form) and press Assign managers first.', status: 400, code: 'needs_managers' }
  const plan = await teamPlanFor(sb, i.onboardingId, i.team?.direct || [], i.team?.exclude || [])
  if (plan?.problems.length) return { ok: false, error: plan.problems[0], status: 400 }
  // The manager roles are the team's to decide (autoRoleCodes), never the form's: whatever it
  // sent for L1 / L2 / HOD is dropped, and the ones the team's depth calls for are added.
  const { data: allRoles } = await sb.from('ess_roles').select('id, role_code, role_name')
  const byId = new Map<string, any>(((allRoles || []) as any[]).map(r => [r.id, r]))
  const byCode = new Map<string, any>(((allRoles || []) as any[]).map(r => [r.role_code, r]))
  const manual = [...new Set((i.roleIds || []).filter(Boolean))].map(id => byId.get(id)).filter(Boolean).filter(r => !(MANAGER_ROLE_CODES as readonly string[]).includes(r.role_code))
  if (manual.some(r => HIDDEN_ROLES.has(r.role_code))) return { ok: false, error: 'A chosen role cannot be assigned from onboarding.', status: 400 }
  const auto = autoRoleCodes(plan?.members || []).map(c => byCode.get(c)).filter(Boolean)
  const found = [...manual, ...auto.filter(a => !manual.some(m => m.id === a.id))]
  if (!found.length) return { ok: false, error: 'Tick at least one role — it is what the joiner can open in ESS.', status: 400, code: 'needs_role' }
  const roleIds = found.map(r => r.id)
  const { data: perms } = await sb.from('role_permissions').select('role_id, module, access_level').in('role_id', roleIds).neq('access_level', 'NONE')
  const rank: Record<string, number> = { VIEW: 1, EDIT: 2, FULL: 3 }
  const union = new Map<string, string>()
  for (const p of (perms || []) as any[]) { const cur = union.get(p.module); if (!cur || (rank[p.access_level] || 0) > (rank[cur] || 0)) union.set(p.module, p.access_level) }
  const prev = (oc.role_assignment || {}) as HrAssignment
  const assignment: HrAssignment = {
    managers: prev.managers,
    roles: found.map(r => ({ role_id: r.id, role_code: r.role_code, role_name: r.role_name, auto: auto.some(a => a.id === r.id) || undefined })),
    permissions: [...union.entries()].map(([module, access_level]) => ({ module, access_level })).sort((a, b) => a.module.localeCompare(b.module)),
    team: { direct: plan?.direct.map(d => d.id) || [], exclude: i.team?.exclude || [], summary: plan?.summary || summarisePlan([]), count: plan?.members.length || 0 },
    by: i.actorId, by_name: i.actorName, at: new Date().toISOString(),
  }
  const { error } = await sb.from('onboarding_candidates').update({ role_assignment: assignment }).eq('id', i.onboardingId)
  if (error) return { ok: false, error: error.message, status: 500 }
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: i.onboardingId, action: 'ROLE_ASSIGNED', actor_type: 'HR', actor_id: i.actorId,
    details: { by: i.actorName, roles: assignment.roles!.map(r => r.role_code), modules: assignment.permissions!.length, team: assignment.team!.summary },
  }).then(() => null, () => null)
  return { ok: true, assignment }
}

// ── 3. At code generation: everything lands on the new employee ──────────────────────────────

const LEVEL_COL: Record<Level, string> = { L1: 'l1_manager_id', L2: 'l2_manager_id', HOD: 'hod_id' }

/** One level of one employee's reporting line: close the live row if it differs, open the new one. */
async function setLine(sb: SupabaseClient, employeeId: string, type: Level, managerId: string | null): Promise<string | null> {
  if (managerId === employeeId) return null
  const { data: cur } = await sb.from('employee_relationships').select('id, manager_employee_id').eq('employee_id', employeeId).eq('relationship_type', type).is('valid_to', null).maybeSingle()
  if ((cur?.manager_employee_id || null) === (managerId || null)) return null
  if (cur) await sb.from('employee_relationships').update({ valid_to: today() }).eq('id', cur.id)
  if (managerId) {
    const { error } = await sb.from('employee_relationships').insert({ employee_id: employeeId, manager_employee_id: managerId, relationship_type: type, source: 'MANUAL', valid_from: today() })
    if (error) { if (cur) await sb.from('employee_relationships').update({ valid_to: null }).eq('id', cur.id); return error.message }
  }
  return null
}

/** A temporary password the joiner must change on first login: 3 groups of 4, no look-alike characters. */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(12)
  const chars = [...bytes].map(b => alphabet[b % alphabet.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

export interface Applied {
  applied: string[]; warnings: string[]
  team_changes: number
  /** Set when an ESS account was (re)issued — mailed by the caller, never logged. */
  credentials: { login_id: string; temp_password: string } | null
}

export async function applyAssignment(sb: SupabaseClient, onboardingId: string, employeeId: string, by: string | null): Promise<Applied> {
  const out: Applied = { applied: [], warnings: [], team_changes: 0, credentials: null }
  const { data: oc } = await sb.from('onboarding_candidates').select(CAND).eq('id', onboardingId).maybeSingle()
  if (!oc) { out.warnings.push('onboarding record not found'); return out }
  const ra = (oc.role_assignment || {}) as HrAssignment

  // The joiner's own line.
  const own: [Level, string | null][] = [['L1', oc.l1_manager_id], ['L2', oc.l2_manager_id], ['HOD', oc.hod_id]]
  for (const [type, mgr] of own) {
    if (!mgr) continue
    const err = await setLine(sb, employeeId, type, mgr)
    if (err) out.warnings.push(`${type} manager: ${err}`); else out.applied.push(`${type} manager`)
  }
  { const { error } = await sb.from('employees').update({ l1_manager_id: oc.l1_manager_id || null, l2_manager_id: oc.l2_manager_id || null, hod_id: oc.hod_id || null }).eq('id', employeeId); if (error) out.warnings.push(`employee managers: ${error.message}`) }

  // The team: drawn afresh now (people may have moved since the plan was shown), with the real id.
  if (ra.team?.direct?.length) {
    const plan = await teamPlanFor(sb, onboardingId, ra.team.direct, ra.team.exclude || [])
    const members = withJoinerId(plan?.members || [], employeeId)
    const changed: { emp_code: string; levels: Level[] }[] = []
    for (const m of members) {
      if (!m.changed.length) continue
      const patch: Record<string, string | null> = {}
      for (const lv of m.changed) {
        const err = await setLine(sb, m.id, lv, m.after[lv.toLowerCase() as 'l1' | 'l2' | 'hod'])
        if (err) out.warnings.push(`${m.emp_code} ${lv}: ${err}`); else { patch[LEVEL_COL[lv]] = m.after[lv.toLowerCase() as 'l1' | 'l2' | 'hod']; out.team_changes++ }
      }
      if (Object.keys(patch).length) { const { error } = await sb.from('employees').update(patch).eq('id', m.id); if (error) out.warnings.push(`${m.emp_code} columns: ${error.message}`) }
      changed.push({ emp_code: m.emp_code, levels: m.changed })
    }
    if (changed.length) out.applied.push(`team of ${changed.length}`)
    await sb.from('onboarding_audit_log').insert({ onboarding_id: onboardingId, action: 'TEAM_REMAPPED', actor_type: 'HR', actor_id: by, details: { employee_id: employeeId, summary: plan?.summary, changed } }).then(() => null, () => null)
  }

  // ESS: an active account with a temporary password, and the roles.
  const roles = ra.roles?.length ? ra.roles : ra.role_id ? [{ role_id: ra.role_id, role_code: ra.role_code || '', role_name: ra.role_name || '' }] : []
  const { data: found } = await sb.from('ess_accounts').select('id, password_hash, must_change_password').eq('employee_id', employeeId).maybeSingle()
  let acct: string | null = found?.id || null
  // A fresh account, or one still on a temporary password, gets the credentials; a real password is never overwritten.
  if (!found || !found.password_hash || found.must_change_password) {
    const pw = tempPassword()
    const { hash, salt } = hashPassword(pw)
    const patch = { employee_id: employeeId, password_hash: hash, password_salt: salt, status: 'ACTIVE', must_change_password: true, password_reset_allowed: true }
    const { data: up, error } = await sb.from('ess_accounts').upsert(patch, { onConflict: 'employee_id' }).select('id').single()
    if (error) out.warnings.push(`ESS account: ${error.message}`)
    else { acct = up?.id || acct; out.applied.push('ESS login'); out.credentials = { login_id: oc.employee_code || '', temp_password: pw } }
  }
  if (acct && roles.length) {
    for (const r of roles) {
      const { error } = await sb.from('ess_user_roles').upsert({ ess_account_id: acct, role_id: r.role_id, is_active: true, assigned_by: by, assigned_at: new Date().toISOString() }, { onConflict: 'ess_account_id,role_id' })
      if (error) out.warnings.push(`role ${r.role_code}: ${error.message}`); else out.applied.push(`role ${r.role_code}`)
    }
    await sb.from('ess_access_audit').insert({ ess_account_id: acct, action: 'ROLE_ASSIGN', performed_by: by, performed_by_name: ra.by_name || 'Onboarding', reason: 'Assigned at onboarding (Generate code)', details: { employee_id: employeeId, roles: roles.map(r => r.role_code), mode: 'add' } }).then(() => null, () => null)
  }
  return out
}
