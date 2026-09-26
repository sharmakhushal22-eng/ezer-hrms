// lib/recruitment/ctc-model.ts
//
// The Automated CTC model behind the CTC Negotiation calculator — one pure
// function so the recruiter's screen, the candidate's salary link and the tests
// all agree. Rules (verified Sep-2026):
//
//   Basic          MAX(50% of fixed CTC, state minimum wage for the worker category)
//   Employer EPF   13% of MIN(Basic, ₹25,000)   — 12% EPF/EPS + 0.5% EDLI + 0.5% admin.
//                  Wage ceiling ₹25,000 w.e.f. 17-Sep-2026 (S.O. 5109(E), Code on
//                  Social Security 2020); ₹15,000 before that.
//   Employer ESIC  3.25% of GROSS, only when gross ≤ ₹21,000/month (ESI Central Rules).
//                  ESIC is on gross wages, not on Basic — solved algebraically because
//                  gross itself is what is left of the fixed CTC after employer costs.
//   Gratuity       4.81% of Basic (15/26 ÷ 12), inside CTC only if the recruiter says so.
//   Statutory bonus 8.33% / 20% / 0. Eligible when Basic ≤ ₹21,000 (Payment of Bonus
//                  Act, 1965 as amended 2015); computed on MIN(Basic, MAX(₹7,000, minimum
//                  wage)) — the Act's calculation ceiling. "With salary" puts it in gross;
//                  "Only in CTC" makes it an employer overhead outside gross.
//   HRA            up to 50% of Basic, from what is left; the rest is Other Allowance,
//                  printed as Conveyance (₹1,600) + Special Allowance on the slip.
//   Employee side  PF 12% of MIN(Basic, ceiling); ESIC 0.75% of gross (≤ ₹21,000);
//                  Professional Tax (state slab on gross); Labour Welfare Fund (state).
//   Net in-hand    Gross − employee PF − employee ESIC − PT − LWF, before TDS.

export const EPF_WAGE_CEILING = 25000        // ₹/month, w.e.f. 17-Sep-2026
export const EPF_WAGE_CEILING_OLD = 15000    // for negotiations saved before the change
export const EPF_EMPLOYER_RATE = 0.13
export const EPF_EMPLOYEE_RATE = 0.12
export const ESIC_WAGE_CEILING = 21000
export const ESIC_EMPLOYER_RATE = 0.0325
export const ESIC_EMPLOYEE_RATE = 0.0075
export const GRATUITY_RATE = 0.0481
export const BONUS_ELIGIBILITY_WAGE = 21000
export const BONUS_CALC_FLOOR = 7000
export const CONVEYANCE_STD = 1600
export const HRA_MAX_OF_BASIC = 0.50
export const BASIC_OF_FIXED = 0.50

// ── Professional Tax — monthly deduction by state, on gross monthly wages ────────────
// Slabs are the common monthly-equivalent figures used in payroll (annual ceiling
// ₹2,500). Half-yearly states (Tamil Nadu, Kerala, Puducherry) are shown as a monthly
// equivalent. Odisha repealed PT from 1-Apr-2026. States not listed levy no PT.
// The payroll module's own PT master is the source of truth at payout time.
type Slab = [minGross: number, monthly: number]   // applies when gross > minGross
const PT_SLABS: Record<string, Slab[]> = {
  'Karnataka':        [[24999, 200]],
  'Maharashtra':      [[10000, 200]],                                    // ₹300 in Feb
  'Gujarat':          [[12000, 200]],
  'Telangana':        [[15000, 150], [20000, 200]],
  'Andhra Pradesh':   [[15000, 150], [20000, 200]],
  'West Bengal':      [[10000, 110], [15000, 130], [25000, 150], [40000, 200]],
  'Madhya Pradesh':   [[18750, 125], [25000, 208]],                      // ₹2,500/yr top slab
  'Tamil Nadu':       [[21000, 22], [30000, 53], [45000, 118], [60000, 178], [75000, 208]],   // half-yearly ÷ 6
  'Kerala':           [[11999, 20], [17999, 50], [29999, 100], [44999, 125], [59999, 200], [99999, 208]],  // half-yearly ÷ 6
  'Assam':            [[10000, 150], [15000, 180], [25000, 208]],
  'Bihar':            [[25000, 83], [41666, 125], [83333, 208]],
  'Jharkhand':        [[25000, 100], [41666, 150], [66666, 175], [83333, 208]],
  'Chhattisgarh':     [[8333, 150], [12500, 180], [16666, 190], [20833, 200]],
  'Punjab':           [[20833, 200]],
  'Meghalaya':        [[4166, 16], [6250, 25], [8333, 41], [12500, 62], [16666, 83], [20833, 104], [25000, 125], [29166, 150], [33333, 175], [37500, 200], [41666, 208]],
  'Sikkim':           [[20000, 125], [30000, 150], [40000, 200]],
  'Tripura':          [[7500, 150], [15000, 180], [15001, 208]],
  'Manipur':          [[4166, 100], [6250, 167], [8333, 200], [10416, 208]],
  'Nagaland':         [[4000, 35], [5000, 75], [7000, 110], [9000, 180], [12000, 208]],
  'Mizoram':          [[5000, 75], [8000, 120], [10000, 150], [12000, 195], [15000, 208]],
  'Puducherry':       [[16666, 41], [33333, 83], [50000, 125], [83333, 167], [100000, 208]],
}
export function professionalTax(state: string, grossMonthly: number): number {
  const slabs = PT_SLABS[state]
  if (!slabs) return 0
  let pt = 0
  for (const [min, amt] of slabs) if (grossMonthly > min) pt = amt
  return pt
}

// ── Labour Welfare Fund — employee share, as a monthly equivalent ─────────────────
// Most states collect a flat few rupees half-yearly or yearly; Haryana is 0.2% of
// wages capped at ₹35 per month. States not listed have no LWF.
const LWF_MONTHLY: Record<string, number | ((gross: number) => number)> = {
  'Haryana': g => Math.min(Math.round(g * 0.002), 35),
  'Punjab': 5, 'Chandigarh': 5,
  'Delhi': 1,                       // ₹6 / half-year
  'Maharashtra': 8,                 // ₹50 / half-year (wages > ₹3,000)
  'Karnataka': 4,                   // ₹50 / year
  'Gujarat': 1,                     // ₹6 / half-year
  'Tamil Nadu': 2,                  // ₹20 / year
  'Telangana': 0.17, 'Andhra Pradesh': 2.5,   // ₹2 / yr, ₹30 / yr
  'Madhya Pradesh': 2, 'West Bengal': 0.5, 'Kerala': 20, 'Goa': 10, 'Chhattisgarh': 2.5,
}
export function labourWelfareFund(state: string, grossMonthly: number): number {
  const v = LWF_MONTHLY[state]
  if (v == null) return 0
  return typeof v === 'function' ? v(grossMonthly) : v
}

export interface CtcInput {
  ctcAnnual: number
  variableAnnual?: number
  minWage: number                  // ₹/month for the state + category
  state: string
  gratuity?: 'yes' | 'no'
  bonusPct?: number                // 8.33 | 20 | 0
  bonusMode?: 'salary' | 'ctc'
  epfCeiling?: number              // default EPF_WAGE_CEILING
}

export interface CtcResult {
  ok: true
  ctcAnnual: number; variable: number; variableAnnual: number; varMonthly: number
  fixedMonthly: number; fixedAnnual: number
  basic: number; basicRule: 'minwage' | '50pct'; hra: number; statBonus: number
  otherAllow: number; conveyance: number; specialAllow: number; gross: number
  epfEmployee: number; esicEmployee: number; ptMonthly: number; lwfMonthly: number; totalDed: number; inHand: number
  epfEmployer: number; esicEmployer: number; gratuityMonthly: number; bonusMonthly: number; bonusOverheadMonthly: number
  bonusBase: number; epfCeiling: number; epfWageBase: number; minReqFixedAnn: number
  totalCTCMonthly: number; totalCTCAnnual: number
}
export interface CtcTooLow { ok: false; minReqFixedAnn: number; fixedAnnual: number; basic: number }

const r2 = (n: number) => Math.round(n * 100) / 100

export function computeCtc(i: CtcInput): CtcResult | CtcTooLow {
  const ctcAnnual = Math.max(0, Number(i.ctcAnnual) || 0)
  const variable = Math.max(0, Number(i.variableAnnual) || 0)
  const fixedAnnual = Math.max(0, ctcAnnual - variable)
  const fixedMonthly = fixedAnnual / 12
  const minWage = Math.max(0, Number(i.minWage) || 0)
  const epfCeiling = i.epfCeiling || EPF_WAGE_CEILING
  const gratuityOn = (i.gratuity || 'yes') === 'yes'
  const bonusPct = (Number(i.bonusPct) || 0) / 100
  const bonusInCtc = (i.bonusMode || 'salary') === 'ctc'

  // Basic
  const basicRule: 'minwage' | '50pct' = minWage > fixedMonthly * BASIC_OF_FIXED ? 'minwage' : '50pct'
  const basic = Math.max(fixedMonthly * BASIC_OF_FIXED, minWage)

  // Employer costs that depend on Basic only
  const epfWageBase = Math.min(basic, epfCeiling)
  const epfEmployer = epfWageBase * EPF_EMPLOYER_RATE
  const gratuityMonthly = gratuityOn ? basic * GRATUITY_RATE : 0
  const bonusBase = Math.min(basic, Math.max(BONUS_CALC_FLOOR, minWage))
  const bonusMonthly = basic <= BONUS_ELIGIBILITY_WAGE && bonusPct > 0 ? bonusBase * bonusPct : 0
  const statBonus = bonusInCtc ? 0 : bonusMonthly              // in gross
  const bonusOverheadMonthly = bonusInCtc ? bonusMonthly : 0    // employer overhead

  // Minimum fixed CTC: gross can't go below Basic (+ bonus paid with salary)
  const minGross = basic + statBonus
  const esicOnMin = minGross <= ESIC_WAGE_CEILING ? minGross * ESIC_EMPLOYER_RATE : 0
  const minReqFixedAnn = (minGross + epfEmployer + gratuityMonthly + bonusOverheadMonthly + esicOnMin) * 12
  if (fixedAnnual + 0.5 < minReqFixedAnn) return { ok: false, minReqFixedAnn, fixedAnnual, basic }

  // Gross = what is left after employer costs; employer ESIC (on gross) solved in closed form
  const R = fixedMonthly - epfEmployer - gratuityMonthly - bonusOverheadMonthly
  const grossWithEsic = R / (1 + ESIC_EMPLOYER_RATE)
  const esicApplies = grossWithEsic <= ESIC_WAGE_CEILING
  const gross = esicApplies ? grossWithEsic : R
  const esicEmployer = esicApplies ? gross * ESIC_EMPLOYER_RATE : 0

  // Allocation inside gross
  const rem = Math.max(0, gross - basic - statBonus)
  const hra = Math.min(basic * HRA_MAX_OF_BASIC, rem)
  const otherAllow = Math.max(0, rem - hra)
  const conveyance = Math.min(otherAllow, CONVEYANCE_STD)
  const specialAllow = Math.max(0, otherAllow - conveyance)

  // Employee side
  const epfEmployee = epfWageBase * EPF_EMPLOYEE_RATE
  const esicEmployee = esicApplies ? gross * ESIC_EMPLOYEE_RATE : 0
  const ptMonthly = professionalTax(i.state, gross)
  const lwfMonthly = labourWelfareFund(i.state, gross)
  const totalDed = epfEmployee + esicEmployee + ptMonthly + lwfMonthly
  const inHand = gross - totalDed

  return {
    ok: true,
    ctcAnnual, variable, variableAnnual: variable, varMonthly: variable / 12,
    fixedMonthly, fixedAnnual,
    basic: r2(basic), basicRule, hra: r2(hra), statBonus: r2(statBonus),
    otherAllow: r2(otherAllow), conveyance: r2(conveyance), specialAllow: r2(specialAllow), gross: r2(gross),
    epfEmployee: r2(epfEmployee), esicEmployee: r2(esicEmployee), ptMonthly, lwfMonthly: r2(lwfMonthly), totalDed: r2(totalDed), inHand: r2(inHand),
    epfEmployer: r2(epfEmployer), esicEmployer: r2(esicEmployer), gratuityMonthly: r2(gratuityMonthly),
    bonusMonthly: r2(bonusMonthly), bonusOverheadMonthly: r2(bonusOverheadMonthly),
    bonusBase: r2(bonusBase), epfCeiling, epfWageBase: r2(epfWageBase), minReqFixedAnn: r2(minReqFixedAnn),
    totalCTCMonthly: ctcAnnual / 12, totalCTCAnnual: ctcAnnual,
  }
}

export const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`
