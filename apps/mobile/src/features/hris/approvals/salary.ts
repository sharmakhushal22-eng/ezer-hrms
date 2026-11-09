// The Payroll head's live salary structure — copied from
// lib/onboarding/salary-breakdown.ts (buildBreakdown / computedBreakdown /
// rebuildFor). That file imports its neighbours through the website's `@/lib/…`
// alias, which does not resolve in the app, so the three pure functions are
// copied here; the CTC model and the statement rows they call ARE imported from
// the website's lib (relative imports only, pure).
import { computeCtc, hraMaxFor } from '@web/recruitment/ctc-model'
import { ctcStatementRows, hasStatement, type StmtRow } from '@web/recruitment/ctc-statement'

export type { StmtRow }
export type SalarySource = 'negotiation' | 'stipend' | 'offer_letter' | 'computed' | 'none'
export interface SalaryBreakdown {
  source: SalarySource; label: string; annual_ctc: number; basic_monthly: number | null; basic_pct: number | null
  calc?: Record<string, any> | null; rows: StmtRow[]; too_low?: { minReqFixedAnn: number } | null; note?: string | null
}

const r0 = (n: any) => Math.round(Number(n) || 0)
const pct = (basicMonthly: number | null, annual: number) => basicMonthly && annual ? Math.round((basicMonthly * 12 / annual) * 1000) / 10 : null

function buildBreakdown(calc: Record<string, any>, annualOverride?: number | null, label?: string): SalaryBreakdown {
  const state = String(calc.state || '')
  const saved = Number(calc.ctcAnnual) || Number(calc.annual) || 0
  const target = annualOverride && annualOverride > 0 ? annualOverride : saved
  let merged: Record<string, any> = calc
  if (target !== saved || !hasStatement(calc)) {
    const varPct = saved > 0 ? (Number(calc.variable) || 0) / saved : 0
    const re: any = computeCtc({
      ctcAnnual: target, variableAnnual: target * varPct, minWage: Number(calc.minWage) || 0, state,
      gratuity: calc.gratuity === 'no' ? 'no' : 'yes', bonusPct: Number(calc.bonusPct) || 0, bonusMode: calc.bonusMode === 'ctc' ? 'ctc' : 'salary',
      epfCeiling: calc.epfCeiling || undefined, hraMax: calc.hraMax || hraMaxFor(calc.city || state),
    } as any)
    if (!re.ok) return { source: 'negotiation', label: label || 'CTC model', annual_ctc: target, basic_monthly: null, basic_pct: null, calc, rows: [], too_low: { minReqFixedAnn: re.minReqFixedAnn }, note: `₹${r0(target).toLocaleString('en-IN')} a year is below the statutory minimum for this structure (₹${r0(re.minReqFixedAnn).toLocaleString('en-IN')} fixed).` }
    merged = { ...calc, ...re }
  }
  return {
    source: 'negotiation', label: label || 'Automated CTC model', annual_ctc: Number(merged.ctcAnnual) || target,
    basic_monthly: r0(merged.basic), basic_pct: pct(r0(merged.basic), Number(merged.ctcAnnual) || target), calc: merged,
    rows: ctcStatementRows(merged, { state }),
  }
}

function computedBreakdown(annual: number, state: string, city?: string | null): SalaryBreakdown {
  const b = buildBreakdown({ ctcAnnual: 0, variable: 0, minWage: 0, state, city, gratuity: 'yes', bonusPct: 0, bonusMode: 'salary' }, annual, `Computed from the CTC on record (₹${r0(annual).toLocaleString('en-IN')}, ${state || 'state not set'})`)
  return { ...b, source: 'computed', note: b.note || 'No negotiation or offer letter figures were found; this is the CTC model with defaults (50% basic, no variable, no bonus). Correct the CTC above if the offer differs.' }
}

export function rebuildFor(b: SalaryBreakdown, annual: number): SalaryBreakdown {
  if (!annual || annual <= 0 || annual === b.annual_ctc) return b
  if (b.calc) { const n = buildBreakdown(b.calc, annual, b.label); return { ...n, source: b.source === 'none' ? 'computed' : b.source } }
  if (b.source === 'stipend') return { ...b, annual_ctc: annual, rows: b.rows }
  if (b.source === 'offer_letter') return { ...b, note: `The offer letter said ₹${r0(b.annual_ctc).toLocaleString('en-IN')}; the CTC entered is ₹${r0(annual).toLocaleString('en-IN')}. The structure below is the letter's; payroll will be set up on the CTC entered.` }
  return computedBreakdown(annual, '')
}
