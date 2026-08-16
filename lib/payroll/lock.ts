// lib/payroll/lock.ts — per-employee payroll lock (migration sql102).
//
// Once payroll has run for an employee, their month is finished: attendance, bank,
// salary, all of it freezes. Anything that would change a figure the payslip was built
// from is refused until HR deliberately reopens that one employee, with a reason.
//
// This is NOT the month-level lock. payroll_runs.status = 'LOCKED' closes a whole month
// to every category sync; this closes one employee inside an otherwise open month. They
// stack — the month lock sits outside, the employee lock inside.
//
// Locked also means "already paid this cycle", which is what keeps Run Payroll honest:
// it only processes unlocked employees, so pressing it twice cannot quietly rewrite a
// payslip that has already gone out. To re-run somebody, unlock them first.
import { supabase } from '@/lib/supabase'

export interface LockRow {
  employee_code: string
  full_name: string
  department: string | null
  designation: string | null
  location: string | null
  is_locked: boolean
  locked_at: string | null
  unlocked_at: string | null
  unlock_reason: string | null
  /** which company's run this row belongs to — a group month spans several */
  run_id: string
  company: string
}

export interface LockFilter {
  /** only meaningful in group mode — one month is three runs across three companies */
  company: string
  department: string
  designation: string
  location: string
  /** free text: emp codes (a pasted list works) or a name */
  employee: string
}
export const EMPTY_LOCK_FILTER: LockFilter = { company: '', department: '', designation: '', location: '', employee: '' }

/** The month's employees with their lock state. Filtering happens server-side so the
 *  list on screen and the set that gets unlocked are decided by the same condition. */
export async function loadLockList(
  runs: { id: string; company_name?: string | null }[],
  f: LockFilter = EMPTY_LOCK_FILTER,
): Promise<LockRow[]> {
  const terms = f.employee.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean)
  const out: LockRow[] = []
  for (const run of runs) {
    // Company is filtered here rather than server-side: it is not an employee attribute
    // at all but which company's run the row came from, and the RPC takes one run at a
    // time anyway. Skipping the call outright also saves a round trip per company.
    if (f.company && (run.company_name || '') !== f.company) continue
    const { data, error } = await supabase.rpc('payroll_lock_list', {
      p_run_id: run.id,
      p_department: f.department || null,
      p_designation: f.designation || null,
      p_location: f.location || null,
      // Codes go to the server only when they look like codes. A name typed into the
      // same box would match nothing there, so that case is filtered below instead.
      p_codes: null,
    })
    if (error) throw new Error(error.message)
    ;(data as any[] || []).forEach(r => out.push({ ...r, run_id: run.id, company: run.company_name || '' }))
  }
  if (!terms.length) return out
  const low = terms.map(t => t.toLowerCase())
  return out.filter(r => {
    const code = String(r.employee_code || '').toLowerCase()
    const name = String(r.full_name || '').toLowerCase()
    return low.some(t => code === t || code.includes(t) || name.includes(t))
  })
}

export function lockFilterOptions(rows: LockRow[]) {
  const uniq = (k: keyof LockRow) =>
    Array.from(new Set(rows.map(r => String(r[k] ?? '').trim()).filter(Boolean))).sort()
  return {
    companies: uniq('company'),
    departments: uniq('department'), designations: uniq('designation'), locations: uniq('location'),
  }
}

/** Lock the employees a run just paid. Called by Run Payroll, not by a button. */
export async function lockEmployees(runId: string, codes: string[] | null): Promise<{ error: string | null; count: number }> {
  const { data, error } = await supabase.rpc('lock_payroll_employees', { p_run_id: runId, p_codes: codes })
  return { error: error?.message || null, count: Number(data) || 0 }
}

/** Reopen specific employees. The reason is enforced by the database, not just here —
 *  a client-side check is a suggestion, and this one has to be a rule. */
export async function unlockEmployees(
  runId: string, codes: string[], reason: string,
): Promise<{ error: string | null; count: number }> {
  const { data, error } = await supabase.rpc('unlock_payroll_employees', {
    p_run_id: runId, p_codes: codes, p_reason: reason,
  })
  return { error: error?.message || null, count: Number(data) || 0 }
}

/** Refuse an edit on a locked employee with a message that says why. The trigger in the
 *  database drops the write regardless; this exists so HR sees a reason instead of a
 *  save that appears to work and changes nothing. */
export async function assertEditable(runId: string, empCode: string): Promise<string | null> {
  const { error } = await supabase.rpc('guard_payroll_edit', { p_run_id: runId, p_employee_code: empCode })
  if (!error) return null
  // Migration not applied yet → let the edit through rather than blocking real work.
  //
  // Narrow on purpose. This branch OPENS a lock: whatever matches here lets an edit
  // proceed on a possibly-locked employee. `does not exist` used to match too, and
  // Postgres says that for a bad column reference inside guard_payroll_edit as well —
  // so a broken guard would have quietly waved every edit through instead of failing
  // loudly. Only a function that genuinely is not there earns that.
  if (/could not find the function|schema cache/i.test(error.message)) return null
  return error.message
}

export interface LockAudit {
  action: 'EMPLOYEES_LOCKED' | 'EMPLOYEES_UNLOCKED'
  count: number
  employees: string[]
  reason: string | null
  by: string
  at: string
}

/** The lock/unlock trail for this month — who reopened whom, and why. */
export async function loadLockAudit(runIds: string[]): Promise<LockAudit[]> {
  if (!runIds.length) return []
  const { data, error } = await supabase.from('payroll_audit_log')
    .select('action, detail, performed_by, created_at')
    .in('run_id', runIds)
    .in('action', ['EMPLOYEES_LOCKED', 'EMPLOYEES_UNLOCKED'])
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) return []
  return (data as any[] || []).map(r => ({
    action: r.action,
    count: Number(r.detail?.count) || 0,
    employees: Array.isArray(r.detail?.employees) ? r.detail.employees : [],
    reason: r.detail?.reason || null,
    by: r.performed_by || 'HR',
    at: r.created_at,
  }))
}
