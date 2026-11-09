// lib/exit/case.ts — server. One exit = one employee_resignation row (a self-resignation, or a
// company exit once its chain approves it). From there (Exit Module spec v2):
//   §8  startClearance()   five department forms, approvers resolved, everyone told
//   §9  computeFnf()       once all five are cleared, the F&F statement is calculated
//   §8.3 / §4 / §2.2  runExitDaily()  clearance auto-start at LWD − 7, clearance escalation,
//                          48-hour approval escalation, the Abscond reminder run
import type { SupabaseClient } from '@supabase/supabase-js'
import { roleHolders } from '@/lib/recruitment/offer-approval-notify'
import { sendMail, mailConfigured } from '@/lib/mail/send'
import { CLEARANCE_FORMS, DEPTS, isCleared, recoveryOf, payableOf, clearanceEscalation, type Dept } from './clearance'
import { gratuityOf, pendingSalaryOf, noticeShortfallOf, fnfTotals, lettersFor, WITHHOLD_GRATUITY, NO_NOTICE_RECOVERY, NO_EL_ENCASHMENT, rupees, type FnfLine } from './fnf'
import { advance, reasonOf, isSilent, type ChainStep } from './hr-exit'
import { effectiveNoticeDays } from './notice'
import { revokeAccess } from '@/lib/offboarding/run'

type Sb = SupabaseClient
const today = () => new Date().toISOString().slice(0, 10)
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const who = (e: any) => `${e?.full_name || 'Employee'}${e?.emp_code ? ` (${e.emp_code})` : ''}`
export const APPROVALS_LINK = '/ess?tab=approvals'
// The clearance forms sit in Tasks & Approvals (the Exit Clearance & F&F tab was removed).
export const EXIT_LINK = APPROVALS_LINK

async function bell(sb: Sb, employeeId: string | null | undefined, title: string, body: string, link: string, category = 'APPROVAL') {
  if (!employeeId) return
  await sb.from('ess_notifications').insert({ employee_id: employeeId, category, title, body, link, is_read: false }).then(() => null, () => null)
}
async function mail(to: string | null | undefined, subject: string, text: string) {
  if (!to || !mailConfigured()) return false
  const r = await sendMail({ to, fromName: 'EZER HR Team', subject, text, html: text.split('\n\n').map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('') }).catch(() => ({ sent: false }))
  return !!(r as any).sent
}

/** The reason an exit carries: a company exit's code, or SELF for a resignation. */
export async function exitReasonOf(sb: Sb, resignationId: string): Promise<{ code: string; label: string; request: any | null }> {
  const { data } = await sb.from('hr_exit_requests').select('*').eq('resignation_id', resignationId).order('created_at', { ascending: false }).limit(1)
  const r = data?.[0]
  return r ? { code: r.reason_code, label: r.reason_label, request: r } : { code: 'SELF', label: 'Self Resignation', request: null }
}

// ── Facts pulled from the other modules (best effort: a module that is not set up gives nothing) ──
export interface ExitFacts {
  loan: number; advance: number; loanNote: string
  travelAdvance: number; travelNote: string
  pendingClaims: number; pendingClaimsAmount: number
  flexiPending: string[]
  investments: string
  grossMonthly: number; basicMonthly: number; paidThrough: string | null; salaryNote: string
  elBalance: number
  personalEmail: string | null; bank: string | null
}
export async function exitFacts(sb: Sb, employeeId: string): Promise<ExitFacts> {
  const f: ExitFacts = { loan: 0, advance: 0, loanNote: '', travelAdvance: 0, travelNote: '', pendingClaims: 0, pendingClaimsAmount: 0, flexiPending: [], investments: 'Not Submitted', grossMonthly: 0, basicMonthly: 0, paidThrough: null, salaryNote: '', elBalance: 0, personalEmail: null, bank: null }
  const safe = async (fn: () => Promise<void>) => { try { await fn() } catch { /* module not set up */ } }
  await Promise.all([
    safe(async () => {
      const { data } = await sb.from('loans').select('outstanding_principal, status, loan_types(code, name)').eq('employee_id', employeeId).in('status', ['DISBURSED', 'RECOVERING', 'EXIT_RECOVERY'])
      const notes: string[] = []
      for (const l of (data || []) as any[]) {
        const amt = Number(l.outstanding_principal) || 0
        if (l.loan_types?.code === 'SAL_ADV') f.advance += amt; else f.loan += amt
        if (amt > 0) notes.push(`${l.loan_types?.name || 'Loan'} ${rupees(amt)}`)
      }
      f.loanNote = notes.join(', ')
    }),
    safe(async () => {
      const { data } = await sb.from('te_advances').select('outstanding_amount, status').eq('employee_id', employeeId).in('status', ['PAID', 'PART_SETTLED', 'RECOVERY_DUE'])
      f.travelAdvance = (data || []).reduce((t: number, a: any) => t + (Number(a.outstanding_amount) || 0), 0)
      f.travelNote = data?.length ? `${data.length} advance(s) open` : ''
    }),
    safe(async () => {
      const { data } = await sb.from('te_claims').select('approved_total, net_amount, status').eq('employee_id', employeeId).in('status', ['IN_APPROVAL', 'SENT_BACK', 'IN_VERIFICATION', 'ON_HOLD', 'VERIFIED', 'IN_PAYOUT'])
      f.pendingClaims = data?.length || 0
      f.pendingClaimsAmount = (data || []).reduce((t: number, c: any) => t + (Number(c.net_amount ?? c.approved_total) || 0), 0)
    }),
    safe(async () => {
      const { data } = await sb.from('flexi_claims').select('component_code, status').eq('employee_id', employeeId).eq('status', 'PENDING')
      f.flexiPending = Array.from(new Set((data || []).map((c: any) => c.component_code)))
    }),
    safe(async () => {
      const { data } = await sb.from('flexi_tds_forms').select('status').eq('employee_id', employeeId).order('updated_at', { ascending: false }).limit(1)
      const s = String(data?.[0]?.status || '').toUpperCase()
      f.investments = !s ? 'Not Submitted' : /SUBMIT|APPROV|LOCK|FINAL/.test(s) ? 'Complete' : 'Incomplete'
    }),
    safe(async () => {
      const { data: ctc } = await sb.from('ctc_master').select('annual_ctc, annual_variable, basic_annual, fy').eq('employee_id', employeeId).order('fy', { ascending: false }).limit(1)
      const c = ctc?.[0]
      if (c) { f.basicMonthly = (Number(c.basic_annual) || 0) / 12; f.grossMonthly = ((Number(c.annual_ctc) || 0) - (Number(c.annual_variable) || 0)) / 12; f.salaryNote = `CTC master FY ${c.fy}` }
      const { data: lines } = await sb.from('payroll_lines').select('gross_earning, payroll_runs!inner(fy, month, status)').eq('employee_id', employeeId).in('payroll_runs.status', ['APPROVED', 'DISBURSED', 'LOCKED'])
      const runs = ((lines || []) as any[]).map(l => ({ g: Number(l.gross_earning) || 0, fy: String(l.payroll_runs.fy), m: Number(l.payroll_runs.month) }))
        .sort((a, b) => a.fy === b.fy ? b.m - a.m : b.fy.localeCompare(a.fy))
      if (runs[0]) {
        const y0 = Number(runs[0].fy.slice(0, 4)), cal = ((runs[0].m + 2) % 12) + 1, year = runs[0].m <= 9 ? y0 : y0 + 1
        f.paidThrough = new Date(Date.UTC(year, cal, 0)).toISOString().slice(0, 10)
        if (runs[0].g > 0) { f.grossMonthly = runs[0].g; f.salaryNote = `last processed payroll (${runs[0].fy} month ${runs[0].m})` }
      }
      const { data: snap } = await sb.from('payroll_employee_snapshot').select('basic_monthly').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1)
      if (Number(snap?.[0]?.basic_monthly) > 0) f.basicMonthly = Number(snap![0].basic_monthly)
    }),
    safe(async () => {
      const { data } = await sb.from('leave_balances').select('year, opening, accrued, used, encashed, leave_types!inner(short_name)').eq('employee_id', employeeId).eq('leave_types.short_name', 'EL').order('year', { ascending: false }).limit(1)
      const b = data?.[0] as any
      if (b) f.elBalance = Math.max(0, (Number(b.opening) || 0) + (Number(b.accrued) || 0) - (Number(b.used) || 0) - (Number(b.encashed) || 0))
    }),
    safe(async () => {
      const { data: e } = await sb.from('employees').select('personal_email, bank_name, bank_account_last4').eq('id', employeeId).maybeSingle()
      f.personalEmail = e?.personal_email || null
      f.bank = e?.bank_name || e?.bank_account_last4 ? `${e?.bank_name || 'Bank'} · A/C ••${e?.bank_account_last4 || '----'}` : null
    }),
  ])
  return f
}

/** What each form starts with: the figures the system already knows (§8.4 "auto-pull"). */
function prefill(dept: Dept, f: ExitFacts, o: { gratuityEligible: boolean; years: number; rehire: string | null }): Record<string, any> {
  if (dept === 'FINANCE') return {
    advance: { status: f.advance > 0 ? 'Recover' : 'Nil', amount: Math.round(f.advance), remark: f.advance ? 'From the loan module' : '' },
    loan: { status: f.loan > 0 ? 'Recover' : 'Nil', amount: Math.round(f.loan), remark: f.loanNote },
    expenses: { status: f.pendingClaimsAmount > 0 ? 'Pay employee' : 'Nil', amount: Math.round(f.pendingClaimsAmount), remark: f.pendingClaims ? `${f.pendingClaims} claim(s)` : '' },
    travel_adv: { status: f.travelAdvance > 0 ? 'Recover' : 'Nil', amount: Math.round(f.travelAdvance), remark: f.travelNote },
  }
  if (dept === 'HR') return {
    investments: { status: f.investments },
    gratuity: { status: o.gratuityEligible ? 'Eligible (≥4yr+240d)' : 'Not Eligible', remark: `${o.years} yrs` },
    reimbursements: { status: f.pendingClaims ? 'Pending' : 'All Settled', remark: f.pendingClaims ? String(f.pendingClaims) : '' },
    flexi: { status: f.flexiPending.length ? 'Pending' : 'All Settled', remark: f.flexiPending.join(', ') },
    personal_email: { status: f.personalEmail ? 'Verified' : 'Not Available', remark: f.personalEmail || '' },
    bank: { status: f.bank ? 'Confirmed' : 'Needs Update', remark: f.bank || '' },
    rehire: o.rehire ? { status: o.rehire === 'GREEN' ? 'Green' : o.rehire === 'BLOCKED' ? 'Blocked' : 'Review' } : {},
  }
  return {}
}

/** Who fills a department's form: its role holders in the company; HOD = the L1 manager / HOD. */
async function deptApprovers(sb: Sb, dept: Dept, emp: any): Promise<string[]> {
  if (dept === 'HOD') {
    let hod = emp.hod_id as string | null
    if (!hod && emp.department_id) { const { data } = await sb.from('departments').select('hod_employee_id').eq('id', emp.department_id).maybeSingle(); hod = (data as any)?.hod_employee_id || null }
    return Array.from(new Set([emp.l1_manager_id, hod].filter(Boolean))).filter(id => id !== emp.id) as string[]
  }
  const people = await roleHolders(sb as any, emp.company_id, CLEARANCE_FORMS[dept].roles)
  return people.map(p => p.id).filter(id => id !== emp.id)
}

/** §8.3 step 1–2: open the five forms (idempotent) and tell each department. */
export async function startClearance(sb: Sb, resignationId: string): Promise<{ started: number }> {
  const { data: res } = await sb.from('employee_resignation').select('id, employee_id, final_lwd, lwd_as_per_policy, status').eq('id', resignationId).maybeSingle()
  if (!res || res.status === 'WITHDRAWN') return { started: 0 }
  const { data: have } = await sb.from('exit_clearance').select('dept').eq('resignation_id', resignationId)
  const missing = DEPTS.filter(d => !(have || []).some((h: any) => h.dept === d))
  if (!missing.length) return { started: 0 }
  const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, department_id, l1_manager_id, hod_id, company_doj, group_doj, date_of_joining, rehire_flag, office_email, personal_email').eq('id', res.employee_id).maybeSingle()
  if (!emp) return { started: 0 }
  const lwd = String(res.final_lwd || res.lwd_as_per_policy || today())
  const facts = await exitFacts(sb, emp.id)
  const reason = await exitReasonOf(sb, resignationId)
  const g = gratuityOf(facts.basicMonthly, emp.company_doj || emp.date_of_joining, lwd, { death: reason.code === 'DEATH' })
  const rehire = emp.rehire_flag || reasonOf(reason.code)?.rehire || (reason.code === 'SELF' ? 'GREEN' : null)
  let started = 0
  for (const dept of missing) {
    const approvers = await deptApprovers(sb, dept, emp)
    const { error } = await sb.from('exit_clearance').insert({
      resignation_id: resignationId, employee_id: emp.id, company_id: emp.company_id, dept, status: 'PENDING',
      items: prefill(dept, facts, { gratuityEligible: g.eligible, years: g.years, rehire }), approver_ids: approvers,
    })
    if (error) continue
    started++
    const def = CLEARANCE_FORMS[dept]
    await Promise.all(approvers.map(id => bell(sb, id, `Exit clearance: ${who(emp)}`, `${def.label} clearance (${def.formId}-${emp.emp_code || ''}) is waiting on you. Last working day ${day(lwd)}. Fill it in Tasks & Approvals.`, APPROVALS_LINK)))
  }
  if (started) {
    if (!isSilent(reason.code)) await bell(sb, emp.id, 'Your exit clearance has started', `IT, Admin, Finance, HR and your manager will clear your exit before ${day(lwd)}. Return company property and hand over your work.`, '/ess/exit', 'COMPLIANCE')
    const hrs = await roleHolders(sb as any, emp.company_id, ['HR_MANAGER'])
    await Promise.all(hrs.map(h => bell(sb, h.id, `Clearance started: ${who(emp)}`, `Five department forms are open. Last working day ${day(lwd)}.`, EXIT_LINK, 'APPROVAL')))
  }
  return { started }
}

/** §9: the statement, from the facts and the cleared forms. Refreshes a CALCULATED one; never an
 *  approved or paid one. Returns null while any department is not cleared (§8.1 hard rule). */
export async function computeFnf(sb: Sb, resignationId: string, o: { force?: boolean } = {}): Promise<any | null> {
  const { data: rows } = await sb.from('exit_clearance').select('dept, status, items, recovery, payable').eq('resignation_id', resignationId)
  const byDept = Object.fromEntries((rows || []).map((r: any) => [r.dept, r]))
  if (!o.force && !DEPTS.every(d => isCleared(byDept[d]?.status))) return null
  const { data: existing } = await sb.from('fnf_settlements').select('*').eq('resignation_id', resignationId).maybeSingle()
  if (existing && existing.status !== 'CALCULATED') return existing
  const { data: res } = await sb.from('employee_resignation').select('id, employee_id, final_lwd, lwd_as_per_policy, date_of_resignation, notice_period_days').eq('id', resignationId).maybeSingle()
  if (!res) return null
  const { data: emp } = await sb.from('employees').select('id, company_id, company_doj, date_of_joining').eq('id', res.employee_id).maybeSingle()
  const lwd = String(res.final_lwd || res.lwd_as_per_policy || today())
  const reason = await exitReasonOf(sb, resignationId)
  const f = await exitFacts(sb, res.employee_id)
  const earnings: FnfLine[] = [], deductions: FnfLine[] = []

  if (reason.code === 'TRANSFER') {
    earnings.push({ key: 'transfer', label: 'Transfer within the group: salary continues in the new company', amount: 0, note: 'No F&F in the source company (spec §4 Step 6)', editable: true })
  } else {
    const ps = pendingSalaryOf(f.grossMonthly, f.paidThrough, lwd)
    earnings.push({ key: 'salary', label: 'Pending salary', amount: ps.amount, note: `${ps.note}${f.salaryNote ? ` (${f.salaryNote})` : ''}`, editable: true })
    const elAmt = NO_EL_ENCASHMENT.includes(reason.code) ? 0 : Math.round(f.elBalance * f.basicMonthly / 30)
    earnings.push({ key: 'el', label: 'Earned leave encashment', amount: elAmt, note: NO_EL_ENCASHMENT.includes(reason.code) ? 'Not payable on abscond' : `${f.elBalance} EL day(s) × (Basic ${rupees(f.basicMonthly)} ÷ 30)`, editable: true })
    const g = gratuityOf(f.basicMonthly, emp?.company_doj || emp?.date_of_joining || null, lwd, { withhold: WITHHOLD_GRATUITY.includes(reason.code), death: reason.code === 'DEATH' })
    earnings.push({ key: 'gratuity', label: 'Gratuity', amount: g.amount, note: g.note, editable: true })
    const pay = Math.round(Number(byDept.FINANCE?.payable) || 0)
    if (pay) earnings.push({ key: 'reimbursements', label: 'Pending reimbursements (Finance clearance)', amount: pay, editable: true })
    earnings.push({ key: 'other_earnings', label: 'Other earnings (bonus pro-rata, incentive)', amount: 0, editable: true })

    const fin = byDept.FINANCE?.items || {}
    const loan = fin.loan?.amount != null ? Number(fin.loan.amount) : f.loan
    const adv = fin.advance?.amount != null ? Number(fin.advance.amount) : f.advance
    deductions.push({ key: 'loan', label: 'Pending loan recovery', amount: Math.round(loan || 0), note: f.loanNote || 'Loan module', editable: true })
    deductions.push({ key: 'advance', label: 'Salary advance recovery', amount: Math.round(adv || 0), editable: true })
    const ns = noticeShortfallOf(f.grossMonthly, Number(res.notice_period_days) || 0, res.date_of_resignation, lwd, { waived: NO_NOTICE_RECOVERY.includes(reason.code) })
    deductions.push({ key: 'notice', label: 'Notice shortfall', amount: ns.amount, note: ns.note, editable: true })
    for (const d of DEPTS) {
      const r = byDept[d]; if (!r) continue
      let amt = recoveryOf(d, r.items || {})
      if (d === 'FINANCE') amt -= Math.round((Number(fin.loan?.amount) || 0) + (Number(fin.advance?.amount) || 0))
      if (amt > 0) deductions.push({ key: `clr_${d.toLowerCase()}`, label: `${CLEARANCE_FORMS[d].label} recovery`, amount: amt, note: 'From the clearance form', editable: true })
    }
    deductions.push({ key: 'tds', label: 'TDS on F&F', amount: 0, note: 'Enter the TDS from the payroll tax computation (leave encashment and gratuity are exempt up to their limits)', editable: true })
  }
  const t = fnfTotals({ earnings, deductions })
  const row = {
    resignation_id: resignationId, employee_id: res.employee_id, company_id: emp?.company_id || null, reason_code: reason.code, last_working_day: lwd,
    earnings, deductions, total_earnings: t.earnings, total_deductions: t.deductions, net_payable: t.net, status: 'CALCULATED',
    letters: lettersFor(reason.code), calculated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  const { data } = existing
    ? await sb.from('fnf_settlements').update(row).eq('id', existing.id).select('*').single()
    : await sb.from('fnf_settlements').insert(row).select('*').single()
  if (!existing && data) {
    const payroll = await roleHolders(sb as any, emp?.company_id || null, ['PAYROLL', 'PAYROLL_ADMIN'])
    const { data: e } = await sb.from('employees').select('full_name, emp_code').eq('id', res.employee_id).maybeSingle()
    await Promise.all(payroll.map(p => bell(sb, p.id, `F&F ready to review: ${who(e)}`, `All five clearances are in. Net payable ${rupees(t.net)}.`, EXIT_LINK)))
    const hrs = await roleHolders(sb as any, emp?.company_id || null, ['HR_MANAGER'])
    await Promise.all(hrs.map(p => bell(sb, p.id, `All clearances done: ${who(e)}`, `F&F calculated: net payable ${rupees(t.net)}.`, EXIT_LINK)))
    if (!isSilent(reason.code)) await bell(sb, res.employee_id, 'Your exit clearance is complete', 'All departments have cleared your exit. Your Full & Final settlement is being prepared.', '/ess/exit', 'COMPLIANCE')
  }
  return data
}

// ── The daily run ─────────────────────────────────────────────────────────────
export interface ExitDaily { clearanceStarted: number; clearanceEscalated: number; approvalEscalated: number; remindersSent: number; abscondReady: number; errors: string[] }

export async function runExitDaily(sb: Sb, now = new Date()): Promise<ExitDaily> {
  const out: ExitDaily = { clearanceStarted: 0, clearanceEscalated: 0, approvalEscalated: 0, remindersSent: 0, abscondReady: 0, errors: [] }
  const t = now.toISOString().slice(0, 10)
  const in7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn() } catch (e: any) { out.errors.push(`${name}: ${e?.message || e}`) } }

  // §8.3-1: clearance starts 7 days before the LWD (company exits start it on approval).
  await step('clearance-start', async () => {
    const { data } = await sb.from('employee_resignation').select('id').not('final_lwd', 'is', null).lte('final_lwd', in7).not('status', 'in', '(WITHDRAWN,SETTLED)')
    for (const r of data || []) out.clearanceStarted += (await startClearance(sb, (r as any).id)).started
  })

  // §8.3: 5 business days → HR Manager, 7 → HR Head (once each).
  await step('clearance-escalation', async () => {
    const { data } = await sb.from('exit_clearance').select('id, dept, company_id, started_at, escalated_to, employees!exit_clearance_employee_id_fkey(full_name, emp_code)').eq('status', 'PENDING')
    for (const c of (data || []) as any[]) {
      const level = clearanceEscalation(c.started_at, t)
      if (level === 'NONE' || c.escalated_to === level || (c.escalated_to === 'HR_HEAD')) continue
      const to = await roleHolders(sb as any, c.company_id, [level])
      await Promise.all(to.map(p => bell(sb, p.id, `Clearance overdue: ${who(c.employees)}`, `${CLEARANCE_FORMS[c.dept as Dept].label} has not cleared in ${level === 'HR_HEAD' ? 7 : 5} business days.${level === 'HR_HEAD' ? ' You can override it with a reason in Tasks & Approvals.' : ''}`, EXIT_LINK)))
      await sb.from('exit_clearance').update({ escalated_to: level, updated_at: now.toISOString() }).eq('id', c.id)
      out.clearanceEscalated++
    }
  })

  // §4 Step 4: a company-exit step pending for 48 hours → told to the next level.
  await step('approval-escalation', async () => {
    const cutoff = new Date(now.getTime() - 48 * 3600000).toISOString()
    const { data } = await sb.from('hr_exit_requests').select('id, company_id, chain, current_step, reason_label, step_started_at, step_escalated_at, employees!hr_exit_requests_employee_id_fkey(full_name, emp_code)')
      .eq('status', 'PENDING').not('current_step', 'is', null).lte('step_started_at', cutoff).is('step_escalated_at', null)
    for (const r of (data || []) as any[]) {
      const chain = (r.chain || []) as ChainStep[]
      // A stage on retention hold is waiting by choice, not overdue.
      const cur = chain[r.current_step]; if (!cur || cur.status !== 'PENDING') continue
      const later = chain.slice(r.current_step + 1).find(s => s.approvers.length && s.status === 'WAITING')
      const to = later ? later.approvers.map(p => p.id) : (await roleHolders(sb as any, r.company_id, ['HR_HEAD'])).map(p => p.id)
      await Promise.all(to.map(id => bell(sb, id, `Exit approval overdue: ${who(r.employees)}`, `The ${r.reason_label} exit has waited 48 hours on the ${cur.label} (${cur.approvers.map(p => p.emp_code).join(', ')}).`, APPROVALS_LINK)))
      await Promise.all(cur.approvers.map(p => bell(sb, p.id, `Reminder: exit approval waiting on you`, `${who(r.employees)} · ${r.reason_label}. It has been escalated after 48 hours.`, APPROVALS_LINK)))
      await sb.from('hr_exit_requests').update({ step_escalated_at: now.toISOString() }).eq('id', r.id)
      out.approvalEscalated++
    }
  })

  // §4 Step 3: Abscond — a reminder each week, three in all; after 21 days the chain starts.
  await step('abscond', async () => {
    const { data } = await sb.from('hr_exit_requests').select('id, employee_id, company_id, chain, reminders_sent, last_reminder_at, created_at, reason_label, sub_reason').eq('status', 'PENDING').eq('abscond_stage', 'REMINDING')
    for (const r of (data || []) as any[]) {
      const sinceLast = r.last_reminder_at ? (now.getTime() - new Date(r.last_reminder_at).getTime()) / 86400000 : 99
      if (r.reminders_sent < 3 && sinceLast >= 7) { await sendAbscondReminder(sb, r, now); out.remindersSent++; continue }
      const since = (now.getTime() - new Date(r.created_at).getTime()) / 86400000
      if (r.reminders_sent >= 3 && since >= 21) { await startAbscondChain(sb, r, now); out.abscondReady++ }
    }
  })
  return out
}

/** One of the three "please report or respond within 7 days" reminders (bell + mail). */
export async function sendAbscondReminder(sb: Sb, r: any, now = new Date()) {
  const n = (Number(r.reminders_sent) || 0) + 1
  const { data: e } = await sb.from('employees').select('full_name, emp_code, office_email, personal_email').eq('id', r.employee_id).maybeSingle()
  const text = `Dear ${e?.full_name || 'Employee'},\n\nYou have not reported to work and we have not been able to reach you. Please report to work or respond to HR within 7 days of this message.\n\nThis is reminder ${n} of 3. If we do not hear from you after the third reminder, the company will issue a discontinuation notice and end your employment.\n\nEZER HR Team`
  await bell(sb, r.employee_id, `Reminder ${n} of 3: please report or respond`, 'You have not reported to work. Please report or respond to HR within 7 days.', '/ess', 'COMPLIANCE')
  await mail(e?.personal_email || e?.office_email, `Reminder ${n} of 3: please report to work or respond within 7 days`, text)
  await mail(e?.office_email && e?.personal_email ? e.office_email : null, `Reminder ${n} of 3: please report to work or respond within 7 days`, text)
  await sb.from('hr_exit_requests').update({ reminders_sent: n, last_reminder_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', r.id)
}

/** After the third reminder and 21 days with no response: the approval chain begins. */
async function startAbscondChain(sb: Sb, r: any, now: Date) {
  // The same stamping as every other exit: skips an approver who already acted.
  const { chain, current, done } = advance((r.chain || []) as ChainStep[], now.toISOString())
  const i = current ?? -1
  await sb.from('hr_exit_requests').update({ abscond_stage: 'READY', chain, current_step: i >= 0 ? i : null, step_started_at: now.toISOString(), updated_at: now.toISOString(), ...(done ? { status: 'APPROVED', decided_at: now.toISOString() } : {}) }).eq('id', r.id)
  const { data: e } = await sb.from('employees').select('full_name, emp_code').eq('id', r.employee_id).maybeSingle()
  if (done) {
    const { data: row } = await sb.from('hr_exit_requests').select('*').eq('id', r.id).single()
    const last = [...chain].reverse().find(s => s.acted_by)?.acted_by as Person | undefined
    if (row) await applyCompanyExit(sb, row, last || { id: row.initiated_by, emp_code: null, full_name: row.initiated_by_name || 'HR' })
  }
  if (i >= 0) await Promise.all(chain[i].approvers.map(p => bell(sb, p.id, `Exit approval: ${who(e)}`, `Abscond: three reminders sent over 21 days with no response. ${chain[i].stage === 'HR_MANAGER' ? 'Set the final last working day' : 'Acknowledge it, accept it with your date, or request retention'} as ${chain[i].label} in Tasks & Approvals.`, APPROVALS_LINK)))
  return done
}

// ── A company exit takes effect (its last approval) ─────────────────────────────

export interface Person { id: string; emp_code: string | null; full_name: string }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/** The employee_resignation row with the final LWD, employees.last_working_date + rehire flag,
 *  the employee told, clearance opened; a Transfer also gets its onboarding in the new company. */
export async function applyCompanyExit(sb: Sb, row: any, by: Person): Promise<{ resignationId: string | null; revokedNow: boolean; mailed: boolean; onboardingId: string | null }> {
  const { data: emp } = await sb.from('employees').select('*').eq('id', row.employee_id).maybeSingle()
  if (!emp) return { resignationId: null, revokedNow: false, mailed: false, onboardingId: null }
  const now = new Date().toISOString(), t = today(), lwd = String(row.last_working_day)
  const why = `${row.reason_label}${row.sub_reason ? ` · ${row.sub_reason}` : ''}`
  const transfer = row.reason_code === 'TRANSFER'
  const { data: res } = await sb.from('employee_resignation').insert({
    employee_id: emp.id, reason_code: null, date_of_resignation: t,
    notice_period_days: effectiveNoticeDays(emp as any), lwd_as_per_policy: lwd, final_lwd: lwd,
    status: 'INITIATED', current_stage: null, current_approver_id: null,
    submitted_by_employee: false, submitted_at: now, remarks: `${why}. ${row.remarks || ''}`.trim(),
    initiated_by: row.initiated_by, initiated_by_name: row.initiated_by_name,
  }).select('id').single()
  if (res?.id) {
    await sb.from('hr_exit_requests').update({ resignation_id: res.id }).eq('id', row.id)
    await sb.from('resignation_stage_log').insert({
      resignation_id: res.id, stage: 'HR_MANAGER', approver_id: by.id, actor_id: by.id, action: 'FINAL_LWD_SET', proposed_lwd: lwd,
      note: `Company exit (${why}) started by ${row.initiated_by_name}, approved by the chain; last approval ${who(by)}`, actioned_at: now,
    }).then(() => null, () => null)
  }
  await sb.from('employees').update({
    date_of_resignation: t, last_working_date: lwd,
    ...(row.rehire_flag ? { rehire_flag: row.rehire_flag, rehire_reason: why } : {}),
  }).eq('id', emp.id)

  // Transfer (§4 Step 6): a pre-filled onboarding in the destination company, group DOJ carried,
  // new DOJ = LWD + 1. The destination HR generates the new employee code from Onboarding.
  let onboardingId: string | null = null
  if (transfer && row.destination_company_id) {
    const newDoj = new Date(new Date(`${lwd}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
    const { data: onb } = await sb.from('onboarding_candidates').insert({
      company_id: row.destination_company_id, location_id: row.destination_location_id || null,
      full_name: emp.full_name, designation: emp.designation, email: emp.personal_email || emp.office_email, mobile: emp.mobile,
      date_of_joining: newDoj, employment_type: emp.employment_type || 'Employee', status: 'HR_REVIEW',
      form_data: {
        is_transfer: true, transfer_from_employee_id: emp.id, transfer_from_emp_code: emp.emp_code, group_doj_carry: emp.group_doj || emp.company_doj,
        step_3: { full_name: emp.full_name, gender: emp.gender, dob: emp.date_of_birth, blood_group: emp.blood_group, marital_status: emp.marital_status },
        step_4: { mobile: emp.mobile, personal_email: emp.personal_email },
        step_7: { pan_number: emp.pan_number, uan_number: emp.uan_number, bank_name: emp.bank_name, bank_ifsc: emp.ifsc_code },
      },
    }).select('id').single()
    onboardingId = onb?.id || null
    if (onboardingId) {
      await sb.from('hr_exit_requests').update({ onboarding_candidate_id: onboardingId }).eq('id', row.id)
      await sb.from('employee_transfer').insert({
        employee_id: emp.id, transfer_type: 'INTER_COMPANY', from_company_id: emp.company_id, from_branch_id: emp.location_id, from_emp_code: emp.emp_code,
        to_company_id: row.destination_company_id, to_branch_id: row.destination_location_id || null, effective_date: newDoj,
        last_working_date_old: lwd, new_doj: newDoj, group_doj_preserved: emp.group_doj || emp.company_doj, benefit_type: 'NONE',
        status: 'PENDING_ONBOARDING', ack_status: 'PENDING', onboarding_id: onboardingId, reason: why, initiated_by_name: row.initiated_by_name,
      }).then(() => null, () => null)
      const dest = await roleHolders(sb as any, row.destination_company_id, ['HR_MANAGER', 'HR_HEAD'])
      await Promise.all(dest.map(p => bell(sb, p.id, `Transfer in: ${who(emp)}`, `Joining your company on ${day(newDoj)} by inter-company transfer. The onboarding is pre-filled: review it and generate the new employee code in Onboarding.`, '/dashboard/onboarding', 'APPROVAL')))
    }
  }

  let revokedNow = false
  if (lwd <= t) {
    try { await revokeAccess(sb as any, emp.id, { reason: `Company exit: ${why}`, by: by.id, byName: who(by), lastWorkingDay: lwd }); revokedNow = true } catch { /* the daily run retries */ }
  }
  if (res?.id) await startClearance(sb, res.id).catch(() => null)

  const title = transfer ? 'Your inter-company transfer is approved' : row.reason_code === 'ABSCOND' ? 'Discontinuation notice' : 'Your exit has been processed'
  const body = transfer
    ? `Your last working day in the current company is ${day(lwd)}. Your onboarding in the new company is ready; your group date of joining stays the same.`
    : `HR has processed your exit (${row.reason_label}). Your last working day is ${day(lwd)}. Download your payslips and documents before then; ESS access ends on that day.`
  let mailed = false
  if (isSilent(row.reason_code)) {
    // Death in service: nothing to the employee's own bell or mail; HR handles the family.
    const hrs = await roleHolders(sb as any, emp.company_id, ['HR_MANAGER', 'HR_HEAD'])
    await Promise.all(hrs.map(h => bell(sb, h.id, `Death in service recorded: ${who(emp)}`, `Last working day ${day(lwd)}. Clearance is open; the F&F, gratuity and the PF / EDLI claim are paid to the nominee.`, EXIT_LINK, 'APPROVAL')))
    return { resignationId: res?.id || null, revokedNow, mailed, onboardingId }
  }
  await bell(sb, emp.id, title, body, '/ess/exit', 'COMPLIANCE')
  const to = emp.personal_email || emp.office_email
  if (to && mailConfigured()) {
    const text = row.reason_code === 'ABSCOND'
      ? `Dear ${emp.full_name},\n\nYou did not report to work or respond to the three reminders sent to you over the last 21 days. The company has therefore discontinued your employment.\n\nReason: ${row.reason_label}${row.sub_reason ? ` (${row.sub_reason})` : ''}\nLast working day: ${day(lwd)}\n\nYour pending salary up to that date will be settled in your Full & Final settlement.\n\nEZER HR Team`
      : `Hi ${emp.full_name},\n\n${body}\n\nReason: ${row.reason_label}\nLast working day: ${day(lwd)}\n\nEZER HR Team`
    const sent = await sendMail({ to, fromName: 'EZER HR Team', subject: `${title}: last working day ${day(lwd)}`, text, html: text.split('\n\n').map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') }).catch(() => ({ sent: false }))
    mailed = !!(sent as any).sent
  }
  return { resignationId: res?.id || null, revokedNow, mailed, onboardingId }
}
