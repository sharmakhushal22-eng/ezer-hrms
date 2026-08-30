// lib/payroll/payslip-pdf.ts — the statutory payslip, drawn with pdf-lib.
//
// Deliberately formal: Helvetica (Arial's metric twin, and the only sans face pdf-lib
// ships without an embedded font file), black rules, white paper, no colour, no
// rounded corners. A document an employee keeps for life and hands to a bank has to
// read as a legal record, not a dashboard — the branded version was already tried
// and rejected (03-PAYSLIP-Format-Spec.md §1). Do not restyle it.
//
// Pure presentation: everything comes in through PayslipData, nothing is computed
// here. Runs on the server (the API route) and in the browser (merging) alike —
// pdf-lib is isomorphic and this file touches no Node or DOM API.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { inr0, inr2, type PayslipData } from './payslip.ts'

const A4 = { w: 595.28, h: 841.89 }
const M = 26                       // page margin, pt
const BLACK = rgb(0, 0, 0)
const FS = 7.6                     // body font size — the reference is dense on purpose
const LH = 10.2                    // row height

type Align = 'l' | 'r' | 'c'
interface Col { w: number; align?: Align }

class Sheet {
  doc!: PDFDocument
  page!: PDFPage
  font!: PDFFont
  bold!: PDFFont
  y = 0
  readonly x0 = M
  readonly width = A4.w - 2 * M

  static async create() {
    const s = new Sheet()
    s.doc = await PDFDocument.create()
    s.font = await s.doc.embedFont(StandardFonts.Helvetica)
    s.bold = await s.doc.embedFont(StandardFonts.HelveticaBold)
    s.newPage()
    return s
  }
  newPage() { this.page = this.doc.addPage([A4.w, A4.h]); this.y = A4.h - M }
  /** Move down; start a new page when the next block would fall off the bottom. */
  need(h: number) { if (this.y - h < M) this.newPage() }

  text(t: string, x: number, y: number, o: { size?: number; bold?: boolean; align?: Align; w?: number } = {}) {
    const f = o.bold ? this.bold : this.font, size = o.size ?? FS
    const tw = f.widthOfTextAtSize(t, size)
    let px = x
    if (o.align === 'r') px = x + (o.w ?? 0) - tw
    else if (o.align === 'c') px = x + ((o.w ?? 0) - tw) / 2
    this.page.drawText(t, { x: px, y, size, font: f, color: BLACK })
  }
  hline(x1: number, x2: number, y: number, w = 0.6) { this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: w, color: BLACK }) }
  vline(x: number, y1: number, y2: number, w = 0.6) { this.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: w, color: BLACK }) }
  box(x: number, y: number, w: number, h: number) { this.page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 0.6 }) }

  /** Fit text into a cell width by trimming with an ellipsis — a bank account number
   *  must never wrap into the next column. */
  fit(t: string, w: number, bold = false, size = FS): string {
    const f = bold ? this.bold : this.font
    if (f.widthOfTextAtSize(t, size) <= w) return t
    let s = t
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > w) s = s.slice(0, -1)
    return s + '…'
  }

  /** One bordered table row. Returns the y after the row. */
  row(x: number, cols: Col[], cells: string[], o: { bold?: boolean; h?: number; border?: boolean } = {}) {
    const h = o.h ?? LH
    let cx = x
    cols.forEach((c, i) => {
      const pad = 3
      const t = this.fit(cells[i] ?? '', c.w - 2 * pad, o.bold)
      this.text(t, cx + pad, this.y - h + 3, { bold: o.bold, align: c.align, w: c.w - 2 * pad })
      if (o.border !== false) this.box(cx, this.y - h, c.w, h)
      cx += c.w
    })
    this.y -= h
  }
  header(x: number, cols: Col[], cells: string[]) { this.row(x, cols, cells.map(c => c.toUpperCase()), { bold: true }) }
  section(title: string, x = this.x0, w = this.width) {
    this.need(LH + 2)
    this.hline(x, x + w, this.y)
    this.text(title, x, this.y - LH + 3, { bold: true, align: 'c', w })
    this.y -= LH
    this.hline(x, x + w, this.y)
  }
}

export async function renderPayslipPdf(d: PayslipData): Promise<Uint8Array> {
  const s = await Sheet.create()
  await drawPayslip(s, d)
  return s.doc.save()
}

/** Several employees in one document, one payslip per page (A2 option i). */
export async function renderCombinedPdf(list: PayslipData[]): Promise<Uint8Array> {
  const s = await Sheet.create()
  for (let i = 0; i < list.length; i++) {
    if (i > 0) s.newPage()
    await drawPayslip(s, list[i])
  }
  return s.doc.save()
}

async function drawPayslip(s: Sheet, d: PayslipData) {
  const { x0, width } = s
  const top = s.y

  // ── Company header ─────────────────────────────────────────────────────
  s.text(d.company.name, x0, s.y - 12, { bold: true, size: 11, align: 'c', w: width })
  s.y -= 15
  s.text(d.company.address, x0, s.y - 8, { size: 7, align: 'c', w: width }); s.y -= 9
  s.text(`CIN: ${d.company.cin || '—'}   |   Branch: ${d.company.branch || '—'}`, x0, s.y - 8, { size: 7, align: 'c', w: width }); s.y -= 11
  s.hline(x0, x0 + width, s.y)
  s.text('PAYSLIP', x0, s.y - 10, { bold: true, size: 9.5, align: 'c', w: width }); s.y -= 13
  s.hline(x0, x0 + width, s.y)
  s.text(`For the month of ${d.period.monthLabel}`, x0, s.y - 9, { size: 8, align: 'c', w: width }); s.y -= 12
  s.hline(x0, x0 + width, s.y)
  s.box(x0, s.y, width, top - s.y)

  // ── Identity block — two label/value pairs per row, exactly the reference's rows ──
  const e = d.employee
  const left: [string, string][] = [
    ['Emp Code', e.code], ['Emp Name', e.name], ['Department', e.department], ['Designation', e.designation],
    ['DOB', e.dob], ['DOJ', e.doj], ['Payable Days', d.attendance.payableDays.toFixed(2)],
    ['LWP', d.attendance.lwp.toFixed(2)], ['Arrear Days', d.attendance.arrearDays.toFixed(2)],
  ]
  if (e.groupDoj) left.splice(6, 0, ['Group DOJ', `${e.groupDoj} (continuous service)`])
  const right: [string, string][] = [
    ['Location', e.location], ['IFSC Code', e.ifsc], ['Bank A/c No.', e.bankAccount], ['PAN', e.pan],
    ['PF No.', e.pfNumber], ['PF UAN.', e.uan], ['ESI No.', e.esiNumber],
    ['Sub Department', e.subDepartment || '—'], ['Unit', e.unit],
  ]
  if (e.dol) right.push(['Date of Leaving', e.dol])
  const idCols: Col[] = [{ w: width * 0.14 }, { w: width * 0.36 }, { w: width * 0.14 }, { w: width * 0.36 }]
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i++) {
    const L = left[i], Rr = right[i]
    s.row(x0, idCols, [L?.[0] ?? '', L ? `: ${L[1]}` : '', Rr?.[0] ?? '', Rr ? `: ${Rr[1]}` : ''], { border: false })
  }
  s.box(x0, s.y, width, LH * n)
  s.vline(x0 + width / 2, s.y, s.y + LH * n)

  // ── Earnings | Deductions ──────────────────────────────────────────────
  const gap = 6
  const halfW = (width - gap) / 2
  const ex = x0, dx = x0 + halfW + gap
  // Four amount columns must each hold "1,00,000.00" at 8pt bold without eliding.
  const eCols: Col[] = [{ w: halfW * 0.28 }, { w: halfW * 0.18, align: 'r' }, { w: halfW * 0.18, align: 'r' }, { w: halfW * 0.18, align: 'r' }, { w: halfW * 0.18, align: 'r' }]
  const dCols: Col[] = [{ w: halfW * 0.62 }, { w: halfW * 0.38, align: 'r' }]
  const rows = Math.max(d.earnings.length, d.deductions.length)
  s.need(LH * (rows + 3) + 4)
  const yStart = s.y
  // earnings
  s.row(ex, [{ w: halfW }], ['Earnings'], { bold: true })
  s.header(ex, eCols, ['Description', 'Rate', 'Monthly', 'Arrear', 'Total'])
  for (let i = 0; i < rows; i++) {
    const r = d.earnings[i]
    s.row(ex, eCols, r ? [r.label, r.rate === null ? '—' : inr2(r.rate), inr2(r.monthly), inr2(r.arrear), inr2(r.total)] : ['', '', '', '', ''])
  }
  // Total row: the label spans Description+Rate+Monthly so it never elides.
  const eTotCols: Col[] = [{ w: halfW * 0.64 }, { w: halfW * 0.18, align: 'r' }, { w: halfW * 0.18, align: 'r' }]
  s.row(ex, eTotCols, ['GROSS EARNINGS', inr2(d.grossArrear), inr2(d.grossEarnings)], { bold: true })
  const yEndE = s.y
  // deductions, drawn from the same top
  s.y = yStart
  s.row(dx, [{ w: halfW }], ['Deductions'], { bold: true })
  s.header(dx, dCols, ['Description', 'Amount'])
  for (let i = 0; i < rows; i++) {
    const r = d.deductions[i]
    s.row(dx, dCols, r ? [r.label, inr2(r.amount)] : ['', ''])
  }
  s.row(dx, dCols, ['GROSS DEDUCTIONS', inr2(d.grossDeductions)], { bold: true })
  s.y = Math.min(s.y, yEndE)

  // ── Net pay bar ────────────────────────────────────────────────────────
  s.need(LH + 4)
  s.y -= 2
  s.hline(x0, x0 + width, s.y)
  s.text(`Net Pay : ${inr2(d.netPay)}   (${d.netPayWords})`, x0, s.y - LH + 2, { bold: true, size: 8.5, align: 'c', w: width })
  s.y -= LH + 2
  s.hline(x0, x0 + width, s.y)

  // ── Perquisites band — car lease and driver, "NA" for whoever does not get one ──
  {
    const p = d.perquisites
    const cell = (v: number | null) => v && v > 0 ? inr2(v) : 'NA'
    const line = p.car || p.driver
      ? `Perquisites (taxable value, this month)   —   Car lease : ${cell(p.car)}      Driver : ${cell(p.driver)}`
      : 'Perquisites (Car lease / Driver) : NA'
    s.need(LH + 2)
    s.text(line, x0, s.y - LH + 2, { size: 7.5, align: 'c', w: width })
    s.y -= LH + 1
    s.hline(x0, x0 + width, s.y)
  }

  // ── Income tax worksheet — three columns like the reference ────────────
  s.y -= 3
  s.section(`Income Tax Worksheet for the Period ${d.period.fyFrom} - ${d.period.fyTo} (Investment Declaration)`)
  s.text(d.tax.regimeNote, x0 + 3, s.y - LH + 3, { size: 7 })
  s.y -= LH

  const c1w = width * 0.40, c2w = width * 0.30, c3w = width * 0.30
  const c1x = x0, c2x = x0 + c1w, c3x = x0 + c1w + c2w
  const yTop = s.y

  // column 1 — head-wise + tax working
  const wsCols: Col[] = [{ w: c1w * 0.40 }, { w: c1w * 0.20, align: 'r' }, { w: c1w * 0.20, align: 'r' }, { w: c1w * 0.20, align: 'r' }]
  s.header(c1x, wsCols, ['Description', 'Gross', 'Exempt', 'Taxable'])
  for (const r of d.tax.worksheet) s.row(c1x, wsCols, [r.label, inr0(r.gross), inr0(r.exempt), inr0(r.taxable)])
  s.row(c1x, wsCols, ['Gross', inr0(d.tax.grossTotal), inr0(d.tax.exemptTotal), inr0(d.tax.taxableTotal)], { bold: true })
  s.row(c1x, [{ w: c1w }], ['Tax Working'], { bold: true })
  const twCols: Col[] = [{ w: c1w * 0.62 }, { w: c1w * 0.38, align: 'r' }]
  const t = d.tax
  const tw: [string, number, boolean?][] = [
    ['Standard Deduction', t.standardDeduction], ['Previous Employer Taxable Income', t.previousEmployerIncome],
    ['Professional Tax', t.professionalTax], ['Under Chapter VI-A', t.chapterVIA], ['Any Other Income', t.anyOtherIncome],
    ['Taxable Income', t.taxableIncome, true], ['Total Tax', t.totalTax], ['Tax Rebate u/s 87A', t.rebate87A],
    ['Surcharge', t.surcharge], ['Tax Due', t.taxDue], ['Health and Education Cess', t.cess], ['Net Tax', t.netTax, true],
    ['Tax Deducted Till Date', t.deductedTillDate], ['Tax to be Deducted', t.toBeDeducted],
    ['Tax per month', t.perMonth], ['Tax Deduction for this month', t.thisMonth, true],
  ]
  if (t.additionalThisMonth) tw.push([`Additional TDS on ${t.additionalCause}`, t.additionalThisMonth, true])
  for (const [l, v, b] of tw) s.row(c1x, twCols, [l, inr2(v)], { bold: b })
  const yEnd1 = s.y

  // column 2 — chapter VI-A
  s.y = yTop
  const viaCols: Col[] = [{ w: c2w * 0.67 }, { w: c2w * 0.33, align: 'r' }]
  s.row(c2x, [{ w: c2w }], ['Deduction Under Chapter VI-A'], { bold: true })
  if (d.chapterVIA) {
    const v = d.chapterVIA
    s.row(c2x, viaCols, ['Investments u/s 80C', ''], { bold: true })
    for (const x of v.lines80C) s.row(c2x, viaCols, [x.label, inr2(x.amount)])
    s.row(c2x, viaCols, ['Total Investments u/s 80C', inr2(v.total80C)], { bold: true })
    s.row(c2x, viaCols, ['80C limit available', inr2(v.limit80C)])
    s.row(c2x, viaCols, ['80C claimed', inr2(v.claimed80C)], { bold: true })
    for (const x of v.others) s.row(c2x, viaCols, [x.label, inr2(x.amount)])
    s.row(c2x, viaCols, ['Total Ded Under Ch. VI-A', inr2(v.total)], { bold: true })
  } else {
    s.row(c2x, viaCols, ['New Regime — only 80CCD(2)', inr2(d.tax.chapterVIA)])
    s.row(c2x, viaCols, ['employer NPS is available', ''])
  }
  const yEnd2 = s.y

  // column 3 — HRA + monthly TDS
  s.y = yTop
  const hCols: Col[] = [{ w: c3w * 0.62 }, { w: c3w * 0.38, align: 'r' }]
  if (d.hra) {
    const h = d.hra
    s.row(c3x, [{ w: c3w }], [`Taxable HRA Calculation (${h.metro ? 'Metro' : 'Non-Metro'})`], { bold: true })
    s.row(c3x, hCols, ['Rent Paid', inr2(h.rentPaid)])
    s.row(c3x, hCols, [`From: ${h.from}`, `To: ${h.to}`])
    s.row(c3x, hCols, ['1. Actual HRA', inr2(h.actualHra)])
    s.row(c3x, hCols, [`2. ${h.metro ? '50' : '40'}% of Basic (${h.metro ? 'Metro' : 'Non-Metro'})`, inr2(h.percentOfBasic)])
    s.row(c3x, hCols, ['3. Rent - 10% Basic', inr2(h.rentLessTenPercent)])
    s.row(c3x, hCols, ['Least of above is exempt', inr2(h.exempt)], { bold: true })
    s.row(c3x, hCols, ['Taxable HRA', inr2(h.taxable)], { bold: true })
  }
  s.row(c3x, [{ w: c3w }], ['TDS Deducted Monthly'], { bold: true })
  s.header(c3x, hCols, ['Month', 'Amount'])
  for (const m of d.tdsMonthly) {
    s.row(c3x, hCols, [m.month, inr2(m.amount)])
    if (m.additional) s.row(c3x, hCols, [`  Additional TDS`, inr2(m.additional)])
  }
  s.row(c3x, hCols, ['Total', inr2(d.tdsMonthlyTotal)], { bold: true })
  const yEnd3 = s.y

  // level the three columns and box them
  s.y = Math.min(yEnd1, yEnd2, yEnd3)
  s.box(x0, s.y, width, yTop - s.y)
  s.vline(c2x, s.y, yTop); s.vline(c3x, s.y, yTop)

  // ── Footer ─────────────────────────────────────────────────────────────
  s.y -= 4
  s.need(LH * (2 + d.footnotes.length) + 8)
  s.row(x0, [{ w: width }], [`LWP Count: ${d.attendance.lwp.toFixed(2)}${d.tax.projectedMonths ? `     |     Projected months remaining: ${d.tax.projectedMonths}` : ''}`])
  for (const f of d.footnotes) { s.text(f, x0 + 2, s.y - LH + 3, { size: 7 }); s.y -= LH }
  s.y -= 2
  s.hline(x0, x0 + width, s.y)
  s.text('This is a computer-generated payslip and does not require a signature. — EZER HRMS', x0, s.y - LH + 2, { size: 6.8, align: 'c', w: width })
  s.y -= LH
}
