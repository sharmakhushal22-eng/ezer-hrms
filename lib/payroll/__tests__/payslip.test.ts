// The assembler against the verified reference payslip — every figure on
// Reference-Payslip-RahulNair-Oct2026.pdf, reproduced from stored rows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assemblePayslip, amountInWords, fmtDate, payslipFileName, combinedFileName, inr2 } from '../payslip.ts'
import { renderPayslipPdf, renderCombinedPdf } from '../payslip-pdf.ts'
import { zipStore, crc32 } from '../../zip-store.ts'
import { RAHUL_NAIR } from './fixtures/rahul-nair.ts'

test('rupees in words — the reference net pay and the edges', () => {
  assert.equal(amountInWords(176361), 'One Lakh Seventy Six Thousand Three Hundred Sixty One Rupees Only')
  assert.equal(amountInWords(0), 'Zero Rupees Only')
  assert.equal(amountInWords(100), 'One Hundred Rupees Only')
  assert.equal(amountInWords(1000), 'One Thousand Rupees Only')
  assert.equal(amountInWords(12345678), 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only')
  assert.equal(amountInWords(-500), 'Minus Five Hundred Rupees Only')
})

test('dates and numbers print the way the reference does', () => {
  assert.equal(fmtDate('1991-11-18'), '18 Nov 1991')
  assert.equal(fmtDate(null), '—')
  assert.equal(inr2(209867), '2,09,867.00')
  assert.equal(payslipFileName('SRS0512', '2026-27', 7), 'SRS0512_Oct2026_Payslip.pdf')
  assert.equal(payslipFileName('SRS0512', '2026-27', 12), 'SRS0512_Mar2027_Payslip.pdf')
  assert.equal(combinedFileName('SRS', '2026-27', 7), 'SRS_Oct2026_Payslips.pdf')
})

test('Rahul Nair — identity block', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.equal(p.company.name, 'SRS Retail Solutions Pvt Ltd')
  assert.equal(p.company.cin, 'U74999HR2019PTC098234')
  assert.equal(p.period.monthLabel, 'October 2026')
  assert.equal(p.period.fyFrom, 'April 2026'); assert.equal(p.period.fyTo, 'March 2027')
  assert.equal(p.employee.code, 'SRS0512')
  assert.equal(p.employee.dob, '18 Nov 1991'); assert.equal(p.employee.doj, '12 Mar 2019')
  assert.equal(p.employee.groupDoj, null, 'group DOJ row only when it differs from company DOJ')
  assert.equal(p.employee.location, 'GURUGRAM-Haryana')
  assert.equal(p.employee.unit, 'GURUGRAM')
  assert.equal(p.employee.esiNumber, 'Not Applicable')
  assert.equal(p.employee.pfNumber, 'HR/GGN/0089123/000/0000512')
  assert.equal(p.attendance.payableDays, 31)
  assert.deepEqual(p.issues, [])
})

test('Rahul Nair — earnings grid ties to the run and prints every head', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.deepEqual(p.earnings.map(r => r.label), [
    'BASIC', 'HRA', 'Special Allowance',
    'Flexi - Driver', 'Flexi - Car Fuel', 'Flexi - Telephone', 'Flexi - Meal Card', 'Flexi - Corp Attire', 'Flexi - LTA',
  ])
  assert.equal(p.grossEarnings, 209867)
  assert.equal(p.grossArrear, 0)
  const basic = p.earnings[0]
  assert.deepEqual(basic, { label: 'BASIC', rate: 100000, monthly: 100000, arrear: 0, total: 100000 })
})

test('Rahul Nair — deductions in the reference order, Income Tax first', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.deepEqual(p.deductions, [
    { label: 'Income Tax', amount: 30171 },
    { label: 'PF', amount: 1800 },
    { label: 'Emp LWF', amount: 35 },
    { label: 'Parking Ded', amount: 1500 },
  ])
  assert.equal(p.grossDeductions, 33506)
  assert.equal(p.netPay, 176361)
  assert.equal(p.netPayWords, 'One Lakh Seventy Six Thousand Three Hundred Sixty One Rupees Only')
})

test('Rahul Nair — worksheet and tax working are read from the engine, to the rupee', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.equal(p.tax.regimeNote, '*You have opted for the Old Regime — exemptions and deductions applied')
  assert.equal(p.tax.worksheet.length, 9)
  assert.equal(p.tax.grossTotal, 2518404); assert.equal(p.tax.exemptTotal, 586404); assert.equal(p.tax.taxableTotal, 1932000)
  assert.equal(p.tax.standardDeduction, 50000)
  assert.equal(p.tax.chapterVIA, 96600)
  assert.equal(p.tax.taxableIncome, 1785400)
  assert.equal(p.tax.totalTax, 348120)
  assert.equal(p.tax.taxDue, 348120)
  assert.equal(p.tax.cess, 13925)
  assert.equal(p.tax.netTax, 362045)
  assert.equal(p.tax.deductedTillDate, 181020)
  assert.equal(p.tax.toBeDeducted, 181025)
  assert.equal(p.tax.perMonth, 30171)
  assert.equal(p.tax.thisMonth, 30171)
  assert.equal(p.tax.additionalThisMonth, 0)
  assert.equal(p.tax.monthsRemaining, 6)
})

test('Rahul Nair — chapter VI-A itemised, with the limit shown as a limit (B5)', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.ok(p.chapterVIA)
  assert.deepEqual(p.chapterVIA!.lines80C, [{ label: 'Provident Fund', amount: 21600 }, { label: 'LIC Direct', amount: 50000 }])
  assert.equal(p.chapterVIA!.total80C, 71600)
  assert.equal(p.chapterVIA!.limit80C, 150000)
  assert.equal(p.chapterVIA!.claimed80C, 71600)
  assert.deepEqual(p.chapterVIA!.others, [{ label: '80D Health Insurance', amount: 25000 }])
  assert.equal(p.chapterVIA!.total, 96600)
})

test('Rahul Nair — HRA block shows all three legs and the least', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.ok(p.hra)
  assert.equal(p.hra!.metro, true)
  assert.equal(p.hra!.rentPaid, 600000)
  assert.equal(p.hra!.from, '01/04/2026'); assert.equal(p.hra!.to, '31/03/2027')
  assert.equal(p.hra!.actualHra, 600000)
  assert.equal(p.hra!.percentOfBasic, 600000)
  assert.equal(p.hra!.rentLessTenPercent, 480000)
  assert.equal(p.hra!.exempt, 480000)
  assert.equal(p.hra!.taxable, 120000)
})

test('Rahul Nair — month-wise TDS April to September', () => {
  const p = assemblePayslip(RAHUL_NAIR)
  assert.equal(p.tdsMonthly.length, 6)
  assert.equal(p.tdsMonthly[0].month, 'April-2026')
  assert.equal(p.tdsMonthly[5].month, 'September-2026')
  assert.equal(p.tdsMonthlyTotal, 181020)
})

test('a New Regime employee gets no VI-A itemisation and no HRA block', () => {
  const p = assemblePayslip({
    ...RAHUL_NAIR,
    snapshot: { ...RAHUL_NAIR.snapshot, tds_regime_used: 'NEW', tds_chapter_via: 0, tds_hra_exempt: 0 },
  })
  assert.equal(p.chapterVIA, null)
  assert.equal(p.hra, null)
  assert.match(p.tax.regimeNote, /New Regime \(default\)/)
})

test('a run that does not add up is refused, not printed (C6)', () => {
  const p = assemblePayslip({ ...RAHUL_NAIR, line: { ...RAHUL_NAIR.line, total_deductions: 40000 } })
  assert.ok(p.issues.some(i => i.blocking && /Deduction rows add to/.test(i.text)))
  const q = assemblePayslip({ ...RAHUL_NAIR, snapshot: { ...RAHUL_NAIR.snapshot, tds_worksheet: null } })
  assert.ok(q.issues.some(i => i.blocking && /Worksheet not stored/.test(i.text)))
})

test('missing statutory numbers print Awaited, not Not Applicable (C5)', () => {
  const p = assemblePayslip({
    ...RAHUL_NAIR,
    snapshot: { ...RAHUL_NAIR.snapshot, esic_applicable: true, esic_number: null, pf_account_number: null },
    company: { ...RAHUL_NAIR.company, cin: 'N/A' },
  })
  assert.equal(p.employee.esiNumber, 'Awaited')
  assert.equal(p.employee.pfNumber, 'Awaited')
  assert.equal(p.company.cin, '')
  assert.ok(p.issues.some(i => /CIN is missing/.test(i.text) && !i.blocking))
  assert.ok(p.issues.some(i => /ESI number awaited/.test(i.text)))
})

test('Additional TDS is its own deduction line, labelled with its cause', () => {
  const p = assemblePayslip({
    ...RAHUL_NAIR,
    snapshot: { ...RAHUL_NAIR.snapshot, pay_incentive: 500000, tds_additional: 156000 },
    line: { ...RAHUL_NAIR.line, gross_earning: 709867, ded_tds: 30171, ded_additional_tax: 156000, total_deductions: 189506, net_pay: 520361 },
  })
  assert.ok(p.earnings.some(r => r.label === 'Incentive' && r.rate === null && r.total === 500000))
  assert.deepEqual(p.deductions.slice(0, 2), [{ label: 'Income Tax', amount: 30171 }, { label: 'Additional TDS on incentive', amount: 156000 }])
  assert.equal(p.tax.additionalCause, 'incentive')
  assert.deepEqual(p.issues, [])
})

test('perquisites: amount for who gets one, NA for who does not', () => {
  const p = assemblePayslip(RAHUL_NAIR)                       // driver 3,000 paid, no car lease
  assert.deepEqual(p.perquisites, { car: null, driver: 3000 })
  const q = assemblePayslip({ ...RAHUL_NAIR, snapshot: { ...RAHUL_NAIR.snapshot, earn_flexi_driver: 0, flexi_driver: 0 } })
  assert.deepEqual(q.perquisites, { car: null, driver: null })
  const r = assemblePayslip({ ...RAHUL_NAIR, perquisites: { car: 96000, driver: 0 } })   // annual valuation on record wins
  assert.deepEqual(r.perquisites, { car: 8000, driver: 3000 })
})

test('renders a real PDF — one page for one employee, N pages combined', async () => {
  const p = assemblePayslip(RAHUL_NAIR)
  const one = await renderPayslipPdf(p)
  assert.ok(one.length > 2000)
  assert.equal(new TextDecoder().decode(one.slice(0, 5)), '%PDF-')
  const both = await renderCombinedPdf([p, p])
  assert.ok(both.length > one.length)
})

test('zip-store produces a valid STORE archive', () => {
  const a = new TextEncoder().encode('hello')
  assert.equal(crc32(a), 0x3610a686)
  const z = zipStore([{ name: 'a.txt', data: a }])
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b)                 // 'PK'
  assert.equal(new TextDecoder().decode(z.slice(-22, -18)), 'PK\x05\x06')  // end of central directory
})
