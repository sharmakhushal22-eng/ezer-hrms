// lib/offboarding/run.ts — SERVER ONLY. What happens on an employee's last working day:
// every ESS role is switched off, the ESS account goes INACTIVE (so the login and every
// signed token stop working), the reporting lines they sit on — as a report and as a
// manager — are closed, and the employee record is marked Resigned with the date of leaving.
// Run daily by /api/cron/offboarding-daily for everybody whose last working day has passed
// and who has not been revoked yet (employees.access_revoked_at, migration 168); also called
// straight away when HR sets a final last working day that is already today or earlier.

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/ess/session'
import { roleHolders } from '@/lib/recruitment/offer-approval-notify'

export interface Revoked { employee_id: string; emp_code: string; full_name: string; roles_off: number; lines_closed: number; reports: number; warnings: string[] }

/** Revoke one employee's access. Idempotent — a second call finds nothing left to switch off. */
export async function revokeAccess(sb: SupabaseClient, employeeId: string, o: { reason: string; by?: string | null; byName?: string | null; lastWorkingDay?: string | null }): Promise<Revoked> {
  const { data: e } = await sb.from('employees').select('id, emp_code, full_name, company_id, last_working_date, date_of_resignation').eq('id', employeeId).maybeSingle()
  const out: Revoked = { employee_id: employeeId, emp_code: e?.emp_code || '', full_name: e?.full_name || '', roles_off: 0, lines_closed: 0, reports: 0, warnings: [] }
  if (!e) { out.warnings.push('employee not found'); return out }
  const today = new Date().toISOString().slice(0, 10)
  const lwd = o.lastWorkingDay || e.last_working_date || today

  // 1. Roles off, account inactive.
  const { data: acct } = await sb.from('ess_accounts').select('id, status').eq('employee_id', employeeId).maybeSingle()
  if (acct) {
    const { data: roles } = await sb.from('ess_user_roles').select('role_id').eq('ess_account_id', acct.id).eq('is_active', true)
    if (roles?.length) {
      const { error } = await sb.from('ess_user_roles').update({ is_active: false }).eq('ess_account_id', acct.id).eq('is_active', true)
      if (error) out.warnings.push(`roles: ${error.message}`); else out.roles_off = roles.length
    }
    if (acct.status !== 'INACTIVE') {
      const { error } = await sb.from('ess_accounts').update({ status: 'INACTIVE', deactivated_at: new Date().toISOString(), deactivated_by: o.by || null, deactivation_reason: o.reason }).eq('id', acct.id)
      if (error) out.warnings.push(`account: ${error.message}`)
    }
    await sb.from('ess_access_audit').insert({ ess_account_id: acct.id, action: 'ACCESS_REVOKED', performed_by: o.by || null, performed_by_name: o.byName || 'Offboarding', reason: o.reason, details: { employee_id: employeeId, last_working_day: lwd, roles_off: out.roles_off } }).then(() => null, () => null)
  }

  // 2. Reporting lines: theirs, and everybody who reported to them (HR re-points those).
  const { data: asReport } = await sb.from('employee_relationships').select('id').eq('employee_id', employeeId).is('valid_to', null)
  const { data: asManager } = await sb.from('employee_relationships').select('id, employee_id, relationship_type').eq('manager_employee_id', employeeId).is('valid_to', null)
  const ids = [...(asReport || []), ...(asManager || [])].map((r: any) => r.id)
  if (ids.length) {
    const { error } = await sb.from('employee_relationships').update({ valid_to: lwd > today ? today : lwd }).in('id', ids)
    if (error) out.warnings.push(`relationships: ${error.message}`); else out.lines_closed = ids.length
  }
  const reportIds = [...new Set((asManager || []).map((r: any) => r.employee_id as string))]
  out.reports = reportIds.length
  if (reportIds.length) {
    // The columns the org chart and PMS read, cleared where they point at the leaver.
    for (const col of ['l1_manager_id', 'l2_manager_id', 'hod_id', 'hr_manager_id'] as const) {
      const { error } = await sb.from('employees').update({ [col]: null }).eq(col, employeeId)
      if (error) out.warnings.push(`${col}: ${error.message}`)
    }
  }

  // 3. The record itself.
  const { error } = await sb.from('employees').update({ employment_status: 'Resigned', last_working_date: lwd, date_of_leaving: lwd, date_of_resignation: e.date_of_resignation || null, access_revoked_at: new Date().toISOString() }).eq('id', employeeId)
  if (error) out.warnings.push(`employee: ${error.message}`)

  // 4. Tell HR, especially when a team is left without a manager.
  try {
    const hr = await roleHolders(sb, e.company_id, ['HR_MANAGER', 'HR_HEAD'])
    const names = reportIds.length ? (await sb.from('employees').select('full_name, emp_code').in('id', reportIds)).data || [] : []
    const body = `${e.full_name} (${e.emp_code}) has left: ESS access, ${out.roles_off} role${out.roles_off === 1 ? '' : 's'} and reporting lines are closed as of ${lwd}.` + (names.length ? ` ${names.length} ${names.length === 1 ? 'person' : 'people'} reported to them and need a new manager: ${names.map((n: any) => `${n.full_name} (${n.emp_code})`).join(', ')}.` : '')
    for (const p of hr) await notify(p.id, `Exit completed — ${e.full_name}`, body, '/ess/team', 'COMPLIANCE').catch(() => null)
  } catch { /* the revocation stands even if nobody could be told */ }
  return out
}

export interface OffboardingRun { checked: number; revoked: Revoked[]; errors: string[] }

/** Everybody whose last working day is today or earlier and who still has access. */
export async function runOffboardingDaily(sb: SupabaseClient, now = new Date()): Promise<OffboardingRun> {
  const today = now.toISOString().slice(0, 10)
  const run: OffboardingRun = { checked: 0, revoked: [], errors: [] }
  // From the resignation chain (final LWD set by HR) and from the employee record itself.
  const [{ data: res }, { data: emps }] = await Promise.all([
    sb.from('employee_resignation').select('employee_id, final_lwd').in('status', ['SETTLED', 'RECOVERY_PENDING']).lte('final_lwd', today),
    sb.from('employees').select('id, last_working_date').lte('last_working_date', today).is('access_revoked_at', null),
  ])
  const byId = new Map<string, string>()
  for (const r of (res || []) as any[]) if (r.final_lwd) byId.set(r.employee_id, r.final_lwd)
  for (const e of (emps || []) as any[]) if (!byId.has(e.id)) byId.set(e.id, e.last_working_date)
  for (const [id, lwd] of byId) {
    run.checked++
    const { data: e } = await sb.from('employees').select('access_revoked_at').eq('id', id).maybeSingle()
    if (!e || e.access_revoked_at) continue
    try { run.revoked.push(await revokeAccess(sb, id, { reason: `Last working day ${lwd}`, byName: 'Offboarding (daily)', lastWorkingDay: lwd })) }
    catch (err: any) { run.errors.push(`${id}: ${err?.message || err}`) }
  }
  return run
}
