// src/features/payroll-tax/tax.ts — the Flexi & TDS calculator's maths, as a pure module.
//
// SOURCE: components/ess/FlexiTdsCalculator.tsx (the website keeps this inside the
// component, not in lib/). Copied verbatim, only lifted out of React state:
//   · lines 21–50   SLAB_LABELS, OLD, NEW, COMPS, PERQ_ANN
//   · lines 52–68   R, N, getSlab, oldTax, newTax, finalize, hraCalcPeriod
//   · line  70      MONTHS
//   · lines 89–101  the initial form state (f, child)
//   · lines 118     norm()
//   · lines 168–171 the mid-year-joiner "default to NEW" rule on mount
//   · lines 206–221 sal (derived salary)
//   · lines 226–239 join (joining-date pro-ration)
//   · lines 241–263 schoolCount / hostelCount, getOldLimit, getNewLimit, setFlexi, oTot/nTot
//   · lines 265–272 hraExempt
//   · lines 275–317 T (tax computation) and recRegime
//   · lines 569–570 c80Total / addITotal (step 3 running totals)
// Quirks kept exactly as implemented (spec 03 §3.9 / §3.13): eEpf counts inside 80C
// AND as a separate Old-regime deduction; step 3's 80C total uses the un-pro-rated epf.
//
// No imports: this file runs under `node --experimental-strip-types` for its test.

export const FY = '2026-27'

export const SLAB_LABELS = ['≤5 LPA', '5.1–7.99 LPA', '8–11.99 LPA', '12–17.99 LPA', '18–24.99 LPA', '25–29.99 LPA', '30–39.99 LPA', '40–49.99 LPA', '50+ LPA']
export const OLD: Record<string, number>[] = [
  {},
  { pda: 18000, fuel: 60000, meal: 55000, attire: 40000, childEdu: 36000, hostel: 84000 },
  { pda: 24000, device: 50000, fuel: 96000, meal: 55000, attire: 48000, childEdu: 36000, hostel: 84000 },
  { pda: 30000, tel: 18000, device: 50000, fuel: 144000, meal: 55000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 36000, tel: 18000, device: 90000, lta: 1, car: 216000, driver: 144000, fuel: 144000, meal: 80000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 48000, tel: 18000, device: 130000, lta: 1, car: 300000, driver: 192000, fuel: 160000, meal: 96000, attire: 78000, childEdu: 36000, hostel: 84000 },
  { pda: 54000, tel: 18000, device: 150000, lta: 1, car: 360000, driver: 240000, fuel: 192000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 420000, driver: 240000, fuel: 240000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 600000, driver: 240000, fuel: 300000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
]
export const NEW: Record<string, number>[] = [
  {}, {},
  { device: 50000, fuel: 96000, meal: 55000 },
  { tel: 18000, device: 50000, fuel: 144000, meal: 55000 },
  { tel: 18000, device: 90000, car: 216000, driver: 144000, fuel: 144000, meal: 80000 },
  { tel: 18000, device: 130000, car: 300000, driver: 192000, fuel: 160000, meal: 96000 },
  { tel: 18000, device: 150000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
]
export const COMPS: { k: string; l: string; perq?: boolean }[] = [
  { k: 'pda', l: 'Professional Dev. Allowance' }, { k: 'tel', l: 'Telephone / WiFi Bill' },
  { k: 'device', l: 'Device Leasing' }, { k: 'lta', l: 'Leave Travel Allowance' },
  { k: 'car', l: 'Car Lease', perq: true }, { k: 'driver', l: 'Driver Allowance', perq: true },
  { k: 'fuel', l: 'Fuel Reimbursement' }, { k: 'meal', l: 'Meal Coupon (Zaggle)' },
  { k: 'attire', l: 'Corporate Attire' }, { k: 'childEdu', l: "Children's Education" }, { k: 'hostel', l: 'Hostel Allowance' },
]
export const PERQ_ANN = (7000 + 3000) * 12
export const MONTHS = ['April 2026', 'May 2026', 'June 2026', 'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027']
export const STEPS = ['Employee & Salary', 'Flexi Declaration', 'Investments', 'TDS Report']

/** Indian digit grouping, as `toLocaleString('en-IN')` prints an integer (1,50,000). */
export function groupIN(n: number): string {
  const neg = n < 0
  const s = String(Math.abs(n))
  let last3 = s.slice(-3)
  let rest = s.slice(0, -3)
  if (rest) last3 = ',' + last3
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return (neg ? '-' : '') + rest + last3
}
export const R = (n: number) => '₹' + groupIN(Math.round(n || 0))
export const N = (v: any) => parseFloat(v) || 0
export const getSlab = (c: number) => { const l = c / 1e5; if (l <= 5) return 0; if (l <= 7.99) return 1; if (l <= 11.99) return 2; if (l <= 17.99) return 3; if (l <= 24.99) return 4; if (l <= 29.99) return 5; if (l <= 39.99) return 6; if (l <= 49.99) return 7; return 8 }
export const oldTax = (t: number) => { if (t <= 250000) return 0; if (t <= 500000) return (t - 250000) * .05; if (t <= 1000000) return 12500 + (t - 500000) * .2; return 112500 + (t - 1000000) * .3 }
export const newTax = (t: number) => { if (t <= 400000) return 0; if (t <= 800000) return (t - 400000) * .05; if (t <= 1200000) return 20000 + (t - 800000) * .1; if (t <= 1600000) return 60000 + (t - 1200000) * .15; if (t <= 2000000) return 120000 + (t - 1600000) * .2; if (t <= 2400000) return 200000 + (t - 2000000) * .25; return 300000 + (t - 2400000) * .3 }
export function finalize(base: number, inc: number, isNew: boolean) {
  const r = isNew ? (inc <= 1200000 ? base : 0) : (inc <= 500000 ? Math.min(base, 12500) : 0)
  const a = Math.max(0, base - r)
  const sc = inc > 5e7 ? (isNew ? .25 : .37) : inc > 2e7 ? .25 : inc > 1e7 ? .15 : inc > 5e6 ? .1 : 0
  return Math.round((a + a * sc) * 1.04)
}
export function hraCalcPeriod(monthlyHRA: number, basic: number, rentM: number, fromM: number, toM: number, metro: boolean) {
  if (!rentM || fromM > toM) return 0
  const mo = toM - fromM + 1
  const hraP = monthlyHRA * mo, rentP = rentM * mo, basicP = (basic / 12) * mo
  return Math.min(hraP, Math.max(0, rentP - basicP * .1), basicP * (metro ? .5 : .4))
}

export type Regime = 'OLD' | 'NEW'
export const norm = (v: any): Regime => String(v || '').toUpperCase().includes('NEW') ? 'NEW' : 'OLD'

export type Form = Record<string, string>
export interface Child { count: number; c1: { school: boolean; hostel: boolean }; c2: { school: boolean; hostel: boolean } }
export type Flexi = Record<string, number>

export const initialForm = (): Form => ({
  ctc: '', variable: '', doj: '',
  rentM: '', hra1From: '1', hra1To: '12', cityType: 'nonmetro', landlordPAN: '',
  showHra2: '', rentM2: '', hra2From: '7', hra2To: '12', cityType2: 'nonmetro', landlordPAN2: '',
  lic: '', ppf: '', elss: '', tuit: '', hlP: '',
  medSelf: '', medParents: '', hlInt: '', hlLoanNo: '',
  npsSelf: '0', emplrNpsOld: '0', emplrNpsNew: '0',
  eduLoan: '', eduLoanNo: '', dep80dd: '0', dis80ddb: '', pmFund: '',
  oi: '', bon: '', iinc: '', varEx: '', iInc: '',
})
export const initialChild = (): Child => ({ count: 0, c1: { school: false, hostel: false }, c2: { school: false, hostel: false } })

/** The subset of lib/employees/hr-actions.ts SalaryBreakup the calculator reads. */
export interface SalaryDetailLite { basic: number; hra: number; erPf: number; special: number; specialGross: number }

export interface Sal { ctc: number; vari: number; fixed: number; basic: number; hra: number; epf: number; lta8: number; other: number; si: number }

/** FlexiTdsCalculator.tsx lines 206–221. `rd` = the real salary structure, or null. */
export function deriveSal(fCtc: string, fVariable: string, rd: SalaryDetailLite | null): Sal {
  const ctc = N(fCtc), vari = N(fVariable)
  const fixed = ctc - vari
  if (rd) {
    const basic = rd.basic * 12, hra = rd.hra * 12, epf = rd.erPf * 12
    const other = Math.round((rd.specialGross || rd.special) * 12)
    return { ctc, vari, fixed, basic, hra, epf, lta8: Math.round(basic * .0833), other, si: getSlab(ctc) }
  }
  const basic = fixed * .5, hra = basic * .5
  const epf = Math.min((basic / 12) * .12, 1800) * 12, lta8 = Math.round(basic * .0833), other = Math.max(0, fixed - basic - hra - epf)
  return { ctc, vari, fixed, basic, hra, epf, lta8, other, si: getSlab(ctc) }
}

export interface Join { pr: number; months: number; mid: boolean }
/** FlexiTdsCalculator.tsx lines 226–239. */
export function deriveJoin(fDoj: string): Join {
  const full = { pr: 1, months: 12, mid: false }
  if (!fDoj) return full
  const parts = fDoj.split('-').map(Number)
  if (parts.length < 3 || !parts[0]) return full
  const [y, mo, day] = parts
  const doj = Date.UTC(y, mo - 1, day)
  const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
  if (doj <= fyStart || doj > fyEnd) return full
  const totalDays = Math.round((fyEnd - fyStart) / 86400000) + 1
  const workedDays = Math.round((fyEnd - doj) / 86400000) + 1
  const fyMonth = mo >= 4 ? mo - 3 : mo + 9
  return { pr: Math.min(1, workedDays / totalDays), months: Math.max(1, 13 - fyMonth), mid: true }
}

/** Mount effect, lines 168–171: a DOJ inside FY 2026-27 defaults the regime to NEW. */
export function joinedMidYear(doj: string): boolean {
  const d = new Date(String(doj).slice(0, 10)).getTime()
  const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
  return d > fyStart && d <= fyEnd
}

/** Lines 241–250. */
export function oldLimit(sal: Sal, child: Child, k: string) {
  const schoolCount = (child.count >= 1 && child.c1.school ? 1 : 0) + (child.count >= 2 && child.c2.school ? 1 : 0)
  const hostelCount = (child.count >= 1 && child.c1.hostel ? 1 : 0) + (child.count >= 2 && child.c2.hostel ? 1 : 0)
  const b = OLD[sal.si] || {}
  if (k === 'lta') return b.lta ? sal.lta8 : 0
  if (k === 'childEdu') return schoolCount > 0 ? (b.childEdu || 0) * schoolCount : 0
  if (k === 'hostel') return hostelCount > 0 ? (b.hostel || 0) * hostelCount : 0
  return b[k] || 0
}
export const newLimit = (sal: Sal, k: string) => (NEW[sal.si] || {})[k] || 0

/** setFlexi's updater (lines 252–260): Car and Driver always move together. */
export function applyFlexi(prev: Flexi, k: string, v: number, gl: (k: string) => number): Flexi {
  const nx = { ...prev, [k]: v }
  if (k === 'car') nx.driver = v > 0 ? gl('driver') : 0
  if (k === 'driver') nx.car = v > 0 ? gl('car') : 0
  return nx
}
export const sumFlexi = (o: Flexi) => Object.values(o).reduce((a, b) => a + (b || 0), 0)

/** Lines 265–272. */
export function hraExemptOf(f: Form, sal: Sal) {
  if (!sal.basic) return 0
  const mHRA = sal.hra / 12
  const p1 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM), +f.hra1From, +f.hra1To, f.cityType === 'metro')
  let p2 = 0
  if (f.showHra2) p2 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM2), +f.hra2From, +f.hra2To, f.cityType2 === 'metro')
  return p1 + p2
}

export interface Tax {
  gO: number; dO: number; tO: number; bO: number; fO: number; moO: number; efO: string
  gN: number; dN: number; tN: number; bN: number; fN: number; moN: number; efN: string
  hE: number; c80: number; medS: number; medP: number; hlI: number; npsS: number; eNpsO: number; eNpsN: number
  eduLoan: number; dep80dd: number; dis80ddb: number; pmFund: number
  ltaAmt: number; addI: number; oPerq: number; nPerq: number; walBalO: number; walBalN: number; grossO: number; grossN: number; si: number
  eBasic: number; eHra: number; eOther: number; eVari: number; oClaim: number; nClaim: number; months: number; pr: number; mid: boolean
}

/** Lines 275–314. Null when there is no CTC. */
export function computeTax(sal: Sal, join: Join, hraExempt: number, f: Form, oFlexi: Flexi, nFlexi: Flexi): Tax | null {
  const { ctc, basic, hra, epf, vari, other, si } = sal
  if (!ctc) return null
  const oTot = sumFlexi(oFlexi), nTot = sumFlexi(nFlexi)
  const pr = join.pr, months = join.months
  const eBasic = basic * pr, eHra = hra * pr, eEpf = epf * pr, eOther = other * pr, eVari = vari * pr
  const earnedCtc = ctc * pr
  const hE = hraExempt
  const c80 = Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + eEpf + N(f.tuit) + N(f.hlP), 150000)
  const medS = Math.min(N(f.medSelf), 25000), medP = Math.min(N(f.medParents), 50000)
  const hlI = Math.min(N(f.hlInt), 200000)
  const npsS = N(f.npsSelf)
  const eNpsO = f.emplrNpsOld === 'on' ? Math.round(eBasic * .1) : 0
  const eNpsN = f.emplrNpsNew === 'on' ? Math.round(eBasic * .14) : 0
  const eduLoan = Math.min(N(f.eduLoan), 200000)
  const dep80dd = N(f.dep80dd), dis80ddb = Math.min(N(f.dis80ddb), 100000), pmFund = Math.min(N(f.pmFund), 200000)
  const addI = N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)
  const oClaim = Math.round(oTot * pr), nClaim = Math.round(nTot * pr)
  const ltaAmt = Math.round((oFlexi.lta || 0) * pr)
  const oPerq = (oFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
  const nPerq = (nFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
  const walBalO = Math.max(0, eOther - oClaim), walBalN = Math.max(0, eOther - nClaim)
  const grossO = eBasic + (eHra - hE) + walBalO + eVari + addI + oPerq
  const grossN = eBasic + eHra + walBalN + eVari + addI + nPerq
  const extraOldDed = eduLoan + dep80dd + dis80ddb + pmFund
  const gO = earnedCtc + addI + oPerq, dO = 50000 + hE + ltaAmt + oClaim + c80 + medS + medP + hlI + npsS + eNpsO + eEpf + extraOldDed
  const tO = Math.max(0, gO - dO), bO = oldTax(tO), fO = finalize(bO, tO, false)
  const gN = earnedCtc + addI + nPerq, dN = 75000 + nClaim + eNpsN + eEpf
  const tN = Math.max(0, gN - dN), bN = newTax(tN), fN = finalize(bN, tN, true)
  const denom = earnedCtc || ctc
  return {
    gO, dO, tO, bO, fO, moO: Math.round(fO / months), efO: (fO / denom * 100).toFixed(2),
    gN, dN, tN, bN, fN, moN: Math.round(fN / months), efN: (fN / denom * 100).toFixed(2),
    hE, c80, medS, medP, hlI, npsS, eNpsO, eNpsN, eduLoan, dep80dd, dis80ddb, pmFund,
    ltaAmt, addI, oPerq, nPerq, walBalO, walBalN, grossO, grossN, si,
    eBasic, eHra, eOther, eVari, oClaim, nClaim, months, pr, mid: join.mid,
  }
}

/** Line 317 — the lower-tax regime (ties go to OLD). */
export const recOf = (T: Tax | null): Regime | null => (T ? (T.fO <= T.fN ? 'OLD' : 'NEW') : null)

/** Lines 569–570 — step 3's running totals (80C here uses the un-pro-rated epf). */
export const c80TotalOf = (f: Form, sal: Sal) => Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + sal.epf + N(f.tuit) + N(f.hlP), 150000)
export const addITotalOf = (f: Form) => N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)

/** Read/write gates (lines 122–127). */
export function gates(status: 'NEW' | 'DRAFT' | 'SUBMITTED', editMode: null | 'flexi' | 'all') {
  const isSubmitted = status === 'SUBMITTED'
  return {
    isSubmitted,
    flexiRW: !isSubmitted || editMode === 'flexi' || editMode === 'all',
    investRW: !isSubmitted || editMode === 'all',
    basicRW: !isSubmitted || editMode === 'all',
    regimeLocked: isSubmitted,
    viewLocked: isSubmitted && !editMode,
  }
}

/** submitRegime's confirm text (lines 788–790), verbatim. */
export function submitConfirmText(regime: Regime, f: Form) {
  const emplrNps = f.emplrNpsOld === 'on' || f.emplrNpsNew === 'on'
  let msg = `Are you sure you want to select the ${regime === 'OLD' ? 'Old' : 'New'} Regime?\n\nYour regime will be locked after submission and your declaration will be downloaded.`
  if (emplrNps) msg = `You have chosen Employer NPS that will reduce your in-hand.\n\n` + msg
  msg += `\n\nYes → submit & download   ·   No → go back and choose`
  return msg
}
