// lib/exit/fnf.ts — pure. Full & Final settlement (Exit Module spec v2 §9):
//   NET = pending salary + EL encashment + gratuity (if eligible) + other earnings
//       − loan − salary advance − notice shortfall − clearance recoveries − TDS
// and the letters an exit gets (§10.4). The route (app/api/exit/fnf) gathers the inputs.

export const GRATUITY_CAP = 2_000_000

const d0 = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const r2 = (n: number) => Math.round(n * 100) / 100
export const daysInMonth = (iso: string) => { const d = d0(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() }

/** Completed years + leftover days of continuous service from DOJ to LWD (inclusive). */
export function serviceOf(dojIso: string, lwdIso: string): { years: number; days: number; totalDays: number } {
  // The LWD is a day worked, so service runs up to (not including) the day after it.
  const a = d0(dojIso), end = new Date(d0(lwdIso).getTime() + 86400000)
  const totalDays = Math.max(0, Math.round((end.getTime() - a.getTime()) / 86400000))
  const at = (y: number) => new Date(Date.UTC(a.getUTCFullYear() + y, a.getUTCMonth(), a.getUTCDate()))
  let years = end.getUTCFullYear() - a.getUTCFullYear()
  if (at(years) > end) years--
  years = Math.max(0, years)
  const days = Math.max(0, Math.round((end.getTime() - at(years).getTime()) / 86400000))
  return { years, days, totalDays }
}

/** Gratuity eligibility: 4 years + 240 days (§9.1-3). Years counted for the formula: completed
 *  years, plus one when the leftover is more than six months (Payment of Gratuity Act, s.4(2)). */
export function gratuityOf(basicMonthly: number, dojIso: string | null, lwdIso: string, o: { withhold?: boolean; death?: boolean } = {}): { eligible: boolean; years: number; amount: number; note: string } {
  if (!dojIso) return { eligible: false, years: 0, amount: 0, note: 'No date of joining on record' }
  const s = serviceOf(dojIso, lwdIso)
  // On death the continuous-service condition does not apply (Payment of Gratuity Act, s.4(1) proviso).
  const eligible = !!o.death || s.years > 4 || (s.years === 4 && s.days >= 240)
  const years = s.years + (s.days > 182 ? 1 : 0)
  if (!eligible) return { eligible: false, years, amount: 0, note: `${s.years} yr ${s.days} d of service: below 4 years + 240 days` }
  const amount = Math.min(GRATUITY_CAP, Math.round(basicMonthly * 15 / 26 * years))
  if (o.death && years === 0) return { eligible: true, years: 0, amount: 0, note: 'Death in service: payable to the nominee, but under 6 months of service counts as 0 years' }
  if (o.withhold) return { eligible: true, years, amount: 0, note: `Eligible (${years} yrs, ₹${amount.toLocaleString('en-IN')}) but withheld for this exit reason pending inquiry` }
  return { eligible: true, years, amount, note: `(Basic × 15 ÷ 26) × ${years} yrs${amount === GRATUITY_CAP ? ' (capped at ₹20 lakh)' : ''}${o.death ? ' · death in service: no minimum service, payable to the nominee' : ''}` }
}

/** Salary for days not yet paid: from the day after the last processed month to the LWD (§9.1-1).
 *  Each month part is pro-rated on that month's own days. */
export function pendingSalaryOf(grossMonthly: number, paidThroughIso: string | null, lwdIso: string): { days: number; amount: number; from: string | null; note: string } {
  const lwd = d0(lwdIso)
  const start = paidThroughIso ? new Date(d0(paidThroughIso).getTime() + 86400000) : new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth(), 1))
  if (start > lwd) return { days: 0, amount: 0, from: null, note: 'Salary already processed up to the last working day' }
  let amount = 0, days = 0
  for (let m = new Date(start); m <= lwd;) {
    const y = m.getUTCFullYear(), mo = m.getUTCMonth()
    const end = new Date(Math.min(Date.UTC(y, mo + 1, 0), lwd.getTime()))
    const n = Math.round((end.getTime() - m.getTime()) / 86400000) + 1
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
    amount += grossMonthly / dim * n; days += n
    m = new Date(Date.UTC(y, mo + 1, 1))
  }
  const from = start.toISOString().slice(0, 10)
  return { days, amount: Math.round(amount), from, note: `${days} day(s) from ${from} to ${lwdIso.slice(0, 10)} at monthly gross ₹${Math.round(grossMonthly).toLocaleString('en-IN')} ÷ days in month` }
}

/** Notice shortfall (§9.2-3): unserved notice days × daily gross (gross ÷ 30). */
export function noticeShortfallOf(grossMonthly: number, noticeDays: number, resignedIso: string | null, lwdIso: string, o: { waived?: boolean } = {}): { days: number; amount: number; note: string } {
  if (!noticeDays || !resignedIso || o.waived) return { days: 0, amount: 0, note: o.waived ? 'Notice not applicable for this exit' : 'No notice period on record' }
  const served = Math.max(0, Math.round((d0(lwdIso).getTime() - d0(resignedIso).getTime()) / 86400000))
  const days = Math.max(0, noticeDays - served)
  return { days, amount: Math.round(days * grossMonthly / 30), note: `${noticeDays} days notice, ${served} served: ${days} × (gross ÷ 30)` }
}

export interface FnfLine { key: string; label: string; amount: number; note?: string; editable?: boolean }
export interface FnfInput {
  earnings: FnfLine[]
  deductions: FnfLine[]
}
export function fnfTotals(x: FnfInput): { earnings: number; deductions: number; net: number } {
  const e = Math.round(x.earnings.reduce((t, l) => t + (Number(l.amount) || 0), 0))
  const d = Math.round(x.deductions.reduce((t, l) => t + (Number(l.amount) || 0), 0))
  return { earnings: e, deductions: d, net: e - d }
}

/** TDS on the F&F (§9.3): a flat estimate on the taxable earnings — leave encashment and
 *  gratuity are exempt up to their limits (₹25 lakh / ₹20 lakh), so only salary and other
 *  earnings are taxed here, at the employee's average rate. Editable on the statement. */
export function fnfTdsOf(taxableEarnings: number, avgRatePct: number): number {
  return Math.max(0, Math.round(taxableEarnings * Math.max(0, avgRatePct) / 100))
}

// ── Letters (§10.4) ───────────────────────────────────────────────────────────
export type LetterKind = 'EXPERIENCE' | 'RELIEVING' | 'TERMINATION' | 'PF_GUIDANCE' | 'FNF_STATEMENT'
export const LETTER_LABEL: Record<LetterKind, string> = {
  EXPERIENCE: 'Experience letter', RELIEVING: 'Relieving letter', TERMINATION: 'Termination letter',
  PF_GUIDANCE: 'PF claim guidance (Form 19 / 10C)', FNF_STATEMENT: 'F&F statement',
}
/** Which letters an exit gets. `caseByCase` is HR's call for a Termination (yes = issue them). */
export function lettersFor(reason: string, o: { caseByCase?: boolean } = {}): LetterKind[] {
  const r = reason.toUpperCase()
  if (r === 'TRANSFER') return ['FNF_STATEMENT']
  if (r === 'DEATH') return ['FNF_STATEMENT', 'PF_GUIDANCE']   // the nominee's PF / pension / EDLI claim
  if (r === 'ABSCOND' || r === 'FRAUD') return ['FNF_STATEMENT', 'TERMINATION', 'PF_GUIDANCE']
  if (r === 'TERMINATION') return o.caseByCase ? ['FNF_STATEMENT', 'TERMINATION', 'EXPERIENCE', 'RELIEVING', 'PF_GUIDANCE'] : ['FNF_STATEMENT', 'TERMINATION', 'PF_GUIDANCE']
  return ['FNF_STATEMENT', 'EXPERIENCE', 'RELIEVING', 'PF_GUIDANCE']   // self resignation, layoff, discontinue
}
/** Gratuity is withheld for these reasons pending inquiry (§9.1-3 special cases). */
export const WITHHOLD_GRATUITY = ['ABSCOND', 'FRAUD']
/** Pending salary only for an abscond: no EL encashment (§2 table). */
export const NO_EL_ENCASHMENT = ['ABSCOND']
/** No notice shortfall is charged when the company ends the employment. */
export const NO_NOTICE_RECOVERY = ['ABSCOND', 'FRAUD', 'LAYOFF', 'TERMINATION', 'DISCONTINUE', 'TRANSFER', 'DEATH']

export const rupees = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`
export { r2 }
