// lib/payroll/payslip.ts — one employee's payslip, assembled from what the run stored.
//
// Pure. No database, no React, no PDF. It takes the rows the API route already
// fetched (the frozen Month Master row, the payroll_lines row, the declaration, its
// itemised lines, the vouchers, and the earlier months of the FY) and turns them into
// the exact figures the reference payslip prints — in the reference's order, with
// the reference's labels. Nothing here recomputes a tax figure: every worksheet and
// tax-working number is READ from the tds_* columns sync_month_tds() wrote, so the
// payslip and the engine can never disagree (03-PAYSLIP-Format-Spec.md §4, D7).
//
// The two arithmetic checks it does perform are on itself, not on tax: the earnings
// rows must add up to payroll_lines.gross_earning and the deduction rows to
// payroll_lines.total_deductions. A payslip that does not add up is refused, not
// printed (EZER-PAYSLIP-ANSWERS.md C6) — those come back as blocking `issues`.
//
// Unit-tested against the Rahul Nair reference figures in __tests__/payslip.test.ts.

export interface PayslipHeadRow { label: string; rate: number | null; monthly: number; arrear: number; total: number }
export interface PayslipDeduction { label: string; amount: number }
export interface WorksheetRow { label: string; gross: number; exempt: number; taxable: number }

export interface PayslipData {
  company: { name: string; address: string; cin: string; branch: string }
  period: { monthLabel: string; fy: string; month: number; fyFrom: string; fyTo: string }
  employee: {
    code: string; name: string; department: string; subDepartment: string; designation: string
    dob: string; doj: string; groupDoj: string | null; dol: string | null
    location: string; unit: string; ifsc: string; bankAccount: string
    pan: string; pfNumber: string; uan: string; esiNumber: string
  }
  attendance: { payableDays: number; lwp: number; arrearDays: number }
  earnings: PayslipHeadRow[]
  deductions: PayslipDeduction[]
  grossEarnings: number
  grossArrear: number
  grossDeductions: number
  netPay: number
  netPayWords: string
  tax: {
    regimeNote: string
    worksheet: WorksheetRow[]
    grossTotal: number; exemptTotal: number; taxableTotal: number
    standardDeduction: number; previousEmployerIncome: number; professionalTax: number
    chapterVIA: number; anyOtherIncome: number; taxableIncome: number
    totalTax: number; rebate87A: number; surcharge: number; taxDue: number; cess: number; netTax: number
    deductedTillDate: number; toBeDeducted: number; perMonth: number; thisMonth: number
    additionalThisMonth: number; additionalCause: string | null
    monthsRemaining: number; projectedMonths: number
  }
  chapterVIA: {
    lines80C: { label: string; amount: number }[]
    total80C: number; limit80C: number; claimed80C: number
    others: { label: string; amount: number }[]
    total: number
  } | null
  hra: {
    metro: boolean; rentPaid: number; from: string; to: string
    actualHra: number; percentOfBasic: number; rentLessTenPercent: number; exempt: number; taxable: number
  } | null
  tdsMonthly: { month: string; amount: number; additional: number }[]
  tdsMonthlyTotal: number
  footnotes: string[]
  /** C5 — data missing on the record. `blocking` ones stop the payslip from being issued. */
  issues: { text: string; blocking: boolean }[]
}

export interface AssembleInput {
  run: { fy: string; month: number; period_label?: string | null }
  company: Record<string, any>
  snapshot: Record<string, any>
  line: Record<string, any>
  declaration: Record<string, any> | null
  declarationLines: { section_code: string; declared_amount: number | string | null }[]
  vouchers: { head_name: string; head_type: string; amount: number | string | null }[]
  /** Earlier runs of the same FY for this employee — for "TDS Deducted Monthly". */
  priorMonths: { month: number; tds_monthly: number | string | null; tds_additional: number | string | null }[]
}

export const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const num = (v: any): number => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const blank = (v: any) => v === null || v === undefined || String(v).trim() === ''
const R = (n: number) => Math.round(n)

/** FY '2026-27' + month index (1 = April) → the calendar year that month falls in. */
export function calendarYear(fy: string, month: number): number {
  const start = Number(String(fy).split('-')[0])
  return month <= 9 ? start : start + 1
}
export function monthLabel(fy: string, month: number): string {
  return `${MONTHS[month - 1]} ${calendarYear(fy, month)}`
}
/** '2026-08-11' → '11 Aug 2026'. Anything unparseable comes back as '—'. */
export function fmtDate(v: any): string {
  if (blank(v)) return '—'
  const s = String(v).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return '—'
  return `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}`
}
/** Indian grouping, two decimals — 209867 → '2,09,867.00'. */
export function inr2(n: number): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function inr0(n: number): string {
  return Math.round(Number(n || 0)).toLocaleString('en-IN')
}

// ── Rupees in words, Indian system ─────────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function two(n: number): string { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '') }
function three(n: number): string { return n > 99 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n) }

/** 176361 → 'One Lakh Seventy Six Thousand Three Hundred Sixty One Rupees Only'. */
export function amountInWords(amount: number): string {
  let n = Math.round(Math.abs(amount))
  if (n === 0) return 'Zero Rupees Only'
  const parts: string[] = []
  const cr = Math.floor(n / 1e7); n %= 1e7
  const lk = Math.floor(n / 1e5); n %= 1e5
  const th = Math.floor(n / 1e3); n %= 1e3
  if (cr) parts.push(three(cr) + ' Crore')
  if (lk) parts.push(three(lk) + ' Lakh')
  if (th) parts.push(three(th) + ' Thousand')
  if (n) parts.push(three(n))
  return `${amount < 0 ? 'Minus ' : ''}${parts.join(' ')} Rupees Only`
}

// ── Head catalogue — the payslip's own labels, in the reference's order ────
// Fixed heads first, then flexi in the order the seed of flexi_head_tax_rules lists
// them; the worksheet rows come from the engine so their labels are the engine's.
const FIXED_HEADS: { key: string; label: string; rate: string; earn: string; arrear: string }[] = [
  { key: 'basic',             label: 'BASIC',             rate: 'basic_monthly',     earn: 'earn_basic_monthly',     arrear: 'arrear_basic' },
  { key: 'hra',               label: 'HRA',               rate: 'hra_monthly',       earn: 'earn_hra_monthly',       arrear: 'arrear_hra' },
  { key: 'conveyance',        label: 'Conveyance',        rate: 'conveyance',        earn: 'earn_conveyance',        arrear: 'arrear_conveyance' },
  { key: 'special_allowance', label: 'Special Allowance', rate: 'special_allowance', earn: 'earn_special_allowance', arrear: 'arrear_special_allowance' },
  { key: 'statutory_bonus',   label: 'Statutory Bonus',   rate: 'statutory_bonus',   earn: 'earn_statutory_bonus',   arrear: 'arrear_statutory_bonus' },
]
const FLEXI_HEADS: { key: string; label: string }[] = [
  { key: 'flexi_car',    label: 'Flexi - Car Lease' },
  { key: 'flexi_driver', label: 'Flexi - Driver' },
  { key: 'flexi_fuel',   label: 'Flexi - Car Fuel' },
  { key: 'flexi_tel',    label: 'Flexi - Telephone' },
  { key: 'flexi_meal',   label: 'Flexi - Meal Card' },
  { key: 'flexi_device', label: 'Flexi - Device' },
  { key: 'flexi_attire', label: 'Flexi - Corp Attire' },
  { key: 'flexi_pda',    label: 'Flexi - PDA' },
  { key: 'flexi_lta',    label: 'Flexi - LTA' },
  { key: 'flexi_chedu',  label: 'Flexi - Child Education' },
  { key: 'flexi_hostel', label: 'Flexi - Hostel' },
]
const ONE_OFFS: { key: string; label: string }[] = [
  { key: 'pay_incentive', label: 'Incentive' },
  { key: 'pay_variable',  label: 'Variable Pay' },
  { key: 'pay_bonus',     label: 'Bonus' },
  { key: 'pay_buyout',    label: 'Notice Buyout' },
]

// Chapter VI-A section codes → the label the payslip prints. 80C_* lines are itemised
// under "Investments u/s 80C"; everything else lists below the capped 80C figure.
const SECTION_LABELS: Record<string, string> = {
  '80C_EPF': 'Provident Fund', '80C_VPF': 'Voluntary PF', '80C_LIC': 'LIC Direct', '80C_PPF': 'PPF',
  '80C_ELSS': 'ELSS', '80C_TUITION': 'Tuition Fees', '80C_PRINCIPAL': 'Home Loan Principal',
  '80C_NSC': 'NSC', '80C_FD': 'Tax-saver FD', '80C_SSY': 'Sukanya Samriddhi', '80C_ULIP': 'ULIP',
  '80C_STAMP': 'Stamp Duty', '80C_OTHER': 'Other 80C', '80CCC': 'Pension Fund (80CCC)',
  '80CCD_1B': '80CCD(1B) Self NPS', '80D_SELF': '80D — Self & Family', '80D_PARENTS': '80D — Parents',
  '80E': '80E Education Loan Interest', '24B_SELF': '24(b) Home Loan Interest', '80DD': '80DD', '80DDB': '80DDB',
  '80EEB': '80EEB', '80G': '80G', '80U': '80U', '80TTA': '80TTA', '80TTB': '80TTB',
}

/** C5 — the words the identity block prints for a statutory number. */
function statutoryNumber(value: any, applicable: boolean | null | undefined): string {
  if (applicable === false) return 'Not Applicable'
  if (blank(value)) return 'Awaited'
  return String(value)
}

export function assemblePayslip(inp: AssembleInput): PayslipData {
  const { run, company, snapshot: s, line: l, declaration: d, vouchers } = inp
  const issues: PayslipData['issues'] = []
  const fyStart = Number(String(run.fy).split('-')[0])
  const regime = String(s.tds_regime_used || s.tds_regime || 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW'

  // ── Identity ───────────────────────────────────────────────────────────
  const cin = String(company?.cin ?? '').trim()
  const cinMissing = !cin || cin.toUpperCase() === 'N/A'
  if (cinMissing) issues.push({ text: 'Company CIN is missing — a statutory identifier on the payslip header.', blocking: false })
  if (blank(s.pan_number)) issues.push({ text: 'PAN missing.', blocking: false })
  if (s.pf_applicable !== false && blank(s.pf_account_number)) issues.push({ text: 'PF number awaited.', blocking: false })
  if (s.esic_applicable === true && blank(s.esic_number)) issues.push({ text: 'ESI number awaited — employee is covered.', blocking: false })
  if (blank(s.bank_account_number) || blank(s.ifsc_code)) issues.push({ text: 'Bank account or IFSC missing.', blocking: false })

  const groupDoj = fmtDate(s.group_doj), companyDoj = fmtDate(s.company_doj || s.date_of_joining)

  // ── Earnings grid ──────────────────────────────────────────────────────
  const earnings: PayslipHeadRow[] = []
  for (const h of FIXED_HEADS) {
    const rate = num(s[h.rate]), monthly = num(s[h.earn]), arrear = num(s[h.arrear])
    if (rate || monthly || arrear) earnings.push({ label: h.label, rate, monthly, arrear, total: monthly + arrear })
  }
  for (const h of FLEXI_HEADS) {
    const rate = num(s[h.key]), monthly = num(s[`earn_${h.key}`]), arrear = num(s[`arrear_${h.key}`])
    if (rate || monthly || arrear) earnings.push({ label: h.label, rate, monthly, arrear, total: monthly + arrear })
  }
  for (const o of ONE_OFFS) {
    const v = num(s[o.key])
    if (v) earnings.push({ label: o.label, rate: null, monthly: v, arrear: 0, total: v })
  }
  // Manual voucher additions, by their own head name (bulk-uploader payments that are
  // not one of the four one-offs — e.g. a referral bonus keyed by hand).
  for (const v of vouchers) {
    if (String(v.head_type || '').toLowerCase().startsWith('d')) continue
    const amt = num(v.amount)
    if (amt) earnings.push({ label: v.head_name, rate: null, monthly: amt, arrear: 0, total: amt })
  }
  // Approved flexi claims reimbursed this month, tax-free, on top of gross (A1 — the
  // live payroll mechanic; the exemption is what the worksheet then shows).
  const flexiReimb = num(l.flexi_reimbursement)
  if (flexiReimb) earnings.push({ label: 'Flexi Reimbursement (approved bills)', rate: null, monthly: flexiReimb, arrear: 0, total: flexiReimb })

  const grossEarnings = num(l.gross_earning)
  const grossArrear = earnings.reduce((a, r) => a + r.arrear, 0)
  const rowsSum = earnings.reduce((a, r) => a + r.total, 0)
  if (Math.abs(rowsSum - grossEarnings) > 1) {
    issues.push({ text: `Earnings rows add to ${inr0(rowsSum)} but the run paid ${inr0(grossEarnings)} — refusing to print a payslip that does not add up.`, blocking: true })
  }

  // ── Deductions — reference order (B7): Income Tax first, then statutory, company, vouchers ──
  const oneOffCause = ONE_OFFS.filter(o => num(s[o.key]) > 0).map(o => o.label.toLowerCase())
  const additional = num(l.ded_additional_tax) || (num(l.ded_tds) > num(s.tds_monthly) ? num(s.tds_additional) : 0)
  const incomeTax = num(l.ded_additional_tax) ? num(l.ded_tds) : num(l.ded_tds) - additional
  const deductions: PayslipDeduction[] = []
  const push = (label: string, amount: number) => { if (amount) deductions.push({ label, amount }) }
  push('Income Tax', incomeTax)
  push(`Additional TDS on ${oneOffCause.length ? oneOffCause.join(' & ') : 'one-off payment'}`, additional)
  push('PF', num(l.ded_epf))
  push('VPF', num(l.ded_vpf))
  push('ESI', num(l.ded_esic))
  push('Prof. Tax', num(l.ded_pt))
  push('Emp LWF', num(l.ded_lwf))
  push('NPS', num(l.ded_nps))
  push('Loan EMI', num(l.ded_loan_emi))
  // Company deductions: the snapshot carries them by name; the engine folds them into
  // the voucher total. Print by name, then whatever other voucher deductions remain.
  const named = { 'Parking Ded': num(s.ded_parking), 'Insurance': num(s.ded_insurance), 'Canteen': num(s.ded_canteen) }
  let namedSum = 0
  for (const [label, amt] of Object.entries(named)) { push(label, amt); namedSum += amt }
  const voucherDed = num(l.deductions_json?.voucher_deductions)
  const isNamedVoucher = (h: string) => /parking|insurance|canteen/i.test(h)
  let otherVouchers = 0
  for (const v of vouchers) {
    if (!String(v.head_type || '').toLowerCase().startsWith('d')) continue
    if (/loan|advance/i.test(String(v.head_name || ''))) continue   // already in Loan EMI
    if (isNamedVoucher(v.head_name)) continue
    const amt = num(v.amount)
    if (amt) { push(v.head_name, amt); otherVouchers += amt }
  }
  // Whatever the engine deducted under vouchers that no named row explains.
  const unexplained = voucherDed - namedSum - otherVouchers
  if (Math.abs(unexplained) > 1) push('Other Deductions', R(unexplained))

  const grossDeductions = num(l.total_deductions)
  const dedSum = deductions.reduce((a, r) => a + r.amount, 0)
  if (Math.abs(dedSum - grossDeductions) > 1) {
    issues.push({ text: `Deduction rows add to ${inr0(dedSum)} but the run deducted ${inr0(grossDeductions)} — refusing to print a payslip that does not add up.`, blocking: true })
  }
  const netPay = num(l.net_pay)
  if (netPay < 0) issues.push({ text: 'Net pay is negative — the run should not have been approved.', blocking: true })

  // ── Income tax worksheet — read, never recomputed ─────────────────────
  const ws = (s.tds_worksheet && typeof s.tds_worksheet === 'object') ? s.tds_worksheet : null
  const worksheet: WorksheetRow[] = ws?.rows
    ? (ws.rows as any[]).map(r => ({ label: String(r.label), gross: num(r.gross), exempt: num(r.exempt), taxable: num(r.taxable) }))
    : []
  if (!ws) issues.push({ text: 'Worksheet not stored on this run (engine older than migration 066) — re-run payroll before issuing payslips.', blocking: true })

  const netTax = num(s.tds_annual_liability)
  const paid = num(s.tds_paid_ytd)
  const prevTds = num(s.tds_prev_employer_tds)
  const thisMonth = num(s.tds_monthly)
  const additionalThisMonth = num(s.tds_additional)
  const taxDue = Math.max(0, num(s.tds_slab_tax) - num(s.tds_rebate_87a))

  const regimeNote = regime === 'OLD'
    ? '*You have opted for the Old Regime — exemptions and deductions applied'
    : '*You are on the New Regime (default) — exemptions and deductions not applicable'

  // ── Chapter VI-A — itemised from declaration lines, totals from the engine ──
  let chapterVIA: PayslipData['chapterVIA'] = null
  if (regime === 'OLD') {
    const lines80C = inp.declarationLines
      .filter(x => x.section_code.startsWith('80C_') || x.section_code === '80CCC')
      .map(x => ({ label: SECTION_LABELS[x.section_code] || x.section_code, amount: num(x.declared_amount) }))
      .filter(x => x.amount > 0)
    const total80C = lines80C.length ? lines80C.reduce((a, x) => a + x.amount, 0) : num(d?.sec_80c)
    if (!lines80C.length && num(d?.sec_80c)) lines80C.push({ label: 'Investments u/s 80C (declared)', amount: num(d?.sec_80c) })
    const others: { label: string; amount: number }[] = []
    const d80 = num(d?.sec_80d_self) + num(d?.sec_80d_parents) || num(d?.sec_80d)
    if (d80) others.push({ label: '80D Health Insurance', amount: d80 })
    if (num(d?.nps_80ccd1b)) others.push({ label: '80CCD(1B) Self NPS', amount: num(d?.nps_80ccd1b) })
    if (num(d?.sec_80e)) others.push({ label: '80E Education Loan Interest', amount: num(d?.sec_80e) })
    if (num(d?.employer_nps_80ccd2)) others.push({ label: '80CCD(2) Employer NPS', amount: num(d?.employer_nps_80ccd2) })
    for (const code of ['80DD', '80DDB', '80EEB', '80G', '80U']) {
      const v = num(d?.[`sec_${code.toLowerCase()}`])
      if (v) others.push({ label: SECTION_LABELS[code] || code, amount: v })
    }
    chapterVIA = { lines80C, total80C, limit80C: 150000, claimed80C: Math.min(total80C, 150000), others, total: num(s.tds_chapter_via) }
  }

  // ── HRA — Old Regime with rent declared only (B: render nothing otherwise) ──
  const rentAnnual = num(s.tds_hra_rent_annual) || num(d?.monthly_rent) * 12
  const hra: PayslipData['hra'] = regime === 'OLD' && rentAnnual > 0 ? {
    metro: !!s.tds_hra_metro,
    rentPaid: rentAnnual,
    from: `01/04/${fyStart}`, to: `31/03/${fyStart + 1}`,
    actualHra: num(s.tds_hra_leg_actual), percentOfBasic: num(s.tds_hra_leg_pct_basic),
    rentLessTenPercent: num(s.tds_hra_leg_rent_less_10),
    exempt: num(s.tds_hra_exempt), taxable: Math.max(0, num(s.tds_hra_leg_actual) - num(s.tds_hra_exempt)),
  } : null

  // ── TDS deducted monthly — every earlier run this FY; Additional TDS on its own line ──
  const tdsMonthly = inp.priorMonths
    .slice().sort((a, b) => a.month - b.month)
    .map(p => ({ month: `${MONTHS[p.month - 1]}-${calendarYear(run.fy, p.month)}`, amount: num(p.tds_monthly), additional: num(p.tds_additional) }))
  const tdsMonthlyTotal = tdsMonthly.reduce((a, m) => a + m.amount + m.additional, 0)

  // ── Footnotes ──────────────────────────────────────────────────────────
  const footnotes: string[] = []
  if (num(s.arrear_total) && s.arrear_months) {
    footnotes.push(`Arrears relate to ${s.arrear_months}${s.arrear_appraisal_effective_date ? ` (salary revision effective ${fmtDate(s.arrear_appraisal_effective_date)})` : ''}.`)
  }
  const projected = Math.max(0, num(s.tds_months_remaining) - 1)
  if (s.date_of_leaving) footnotes.push('Tax projection stops at the date of leaving.')

  return {
    company: {
      name: String(company?.company_name || ''),
      address: String(company?.reg_office || company?.corp_office || ''),
      cin: cinMissing ? '' : cin,
      branch: String(s.location || ''),
    },
    period: { monthLabel: run.period_label || monthLabel(run.fy, run.month), fy: run.fy, month: run.month, fyFrom: `April ${fyStart}`, fyTo: `March ${fyStart + 1}` },
    employee: {
      code: String(s.employee_code || ''), name: String(s.full_name || ''),
      department: String(s.department || ''), subDepartment: String(s.sub_department || ''),
      designation: String(s.designation || ''),
      dob: fmtDate(s.date_of_birth), doj: companyDoj,
      groupDoj: groupDoj !== '—' && groupDoj !== companyDoj ? groupDoj : null,
      dol: s.date_of_leaving ? fmtDate(s.date_of_leaving) : null,
      location: [s.location_city, s.location_state].filter(Boolean).join('-') || String(s.location || ''),
      unit: String(s.location_city || ''),                     // B1 — short term; an establishments master is the real fix
      ifsc: String(s.ifsc_code || ''), bankAccount: String(s.bank_account_number || ''),
      pan: String(s.pan_number || ''),
      pfNumber: statutoryNumber(s.pf_account_number, s.pf_applicable),
      uan: String(s.uan_number || ''),
      esiNumber: statutoryNumber(s.esic_number, s.esic_applicable === true),
    },
    attendance: { payableDays: num(s.paid_days), lwp: num(s.absent_days), arrearDays: num(s.arrear_days) },
    earnings, deductions,
    grossEarnings, grossArrear, grossDeductions, netPay,
    netPayWords: amountInWords(netPay),
    tax: {
      regimeNote, worksheet,
      grossTotal: num(ws?.gross), exemptTotal: num(ws?.exempt), taxableTotal: num(ws?.taxable),
      standardDeduction: num(s.tds_std_deduction), previousEmployerIncome: num(s.tds_prev_employer_income),
      professionalTax: num(s.tds_pt_deduction), chapterVIA: num(s.tds_chapter_via),
      anyOtherIncome: num(s.tds_other_income) + num(s.tds_perquisites) + num(s.tds_house_property),
      taxableIncome: num(s.tds_taxable_income),
      totalTax: num(s.tds_slab_tax), rebate87A: num(s.tds_rebate_87a), surcharge: num(s.tds_surcharge),
      taxDue, cess: num(s.tds_cess), netTax,
      deductedTillDate: paid, toBeDeducted: Math.max(0, netTax - paid - prevTds),
      perMonth: thisMonth, thisMonth, additionalThisMonth,
      additionalCause: additionalThisMonth ? (oneOffCause.join(' & ') || 'one-off payment') : null,
      monthsRemaining: num(s.tds_months_remaining), projectedMonths: projected,
    },
    chapterVIA, hra, tdsMonthly, tdsMonthlyTotal, footnotes, issues,
  }
}

/** Filenames per A2 — employee code, never name. */
export function payslipFileName(code: string, fy: string, month: number): string {
  return `${code}_${MONTHS[month - 1].slice(0, 3)}${calendarYear(fy, month)}_Payslip.pdf`
}
export function combinedFileName(companyShort: string, fy: string, month: number): string {
  const safe = (companyShort || 'Company').replace(/[^A-Za-z0-9]+/g, '')
  return `${safe}_${MONTHS[month - 1].slice(0, 3)}${calendarYear(fy, month)}_Payslips.pdf`
}
