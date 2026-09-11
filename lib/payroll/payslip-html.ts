// lib/payroll/payslip-html.ts — the same payslip as a self-contained HTML page.
//
// A second RENDERER, never a second source of truth. It takes the identical
// PayslipData that lib/payroll/payslip-pdf.ts takes, produced by the identical
// assemblePayslip(), so a figure can only ever differ between the two if the
// assembler produced it differently — which it cannot, because it runs once.
//
// The sections, their order and their labels mirror payslip-pdf.ts line for line:
// company header · identity · earnings | deductions · net pay · perquisites ·
// tax worksheet in three columns · footnotes. If one changes, change both.
//
// Self-contained on purpose: everything is inline, no fonts fetched, no scripts,
// no images. The file lands in somebody's Downloads folder and is opened later,
// often offline and often mailed on — anything external would render as a hole.
import { inr0, inr2, type PayslipData } from './payslip.ts'

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A dash rather than an empty cell: blank reads as "not printed", '—' as "nothing here". */
const val = (v: unknown): string => { const s = String(v ?? '').trim(); return s ? esc(s) : '—' }

const rows2 = (list: [string, string | number][], bold: string[] = []) =>
  list.map(([l, v]) =>
    `<tr${bold.includes(l) ? ' class="b"' : ''}><td>${esc(l)}</td><td class="n">${esc(v)}</td></tr>`).join('')

/** One payslip, as a <section>. Page-breaks after itself so printing gives one per sheet. */
export function renderPayslipHtml(d: PayslipData): string {
  const e = d.employee
  const t = d.tax

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

  const idRows = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const L = left[i], R = right[i]
    return `<tr><th>${L ? esc(L[0]) : ''}</th><td>${L ? val(L[1]) : ''}</td>`
         + `<th>${R ? esc(R[0]) : ''}</th><td>${R ? val(R[1]) : ''}</td></tr>`
  }).join('')

  const earnRows = d.earnings.map(r =>
    `<tr><td>${esc(r.label)}</td><td class="n">${r.rate === null ? '—' : esc(inr2(r.rate))}</td>`
    + `<td class="n">${esc(inr2(r.monthly))}</td><td class="n">${esc(inr2(r.arrear))}</td>`
    + `<td class="n">${esc(inr2(r.total))}</td></tr>`).join('')

  const dedRows = d.deductions.map(r =>
    `<tr><td>${esc(r.label)}</td><td class="n">${esc(inr2(r.amount))}</td></tr>`).join('')

  const perqCell = (v: number | null) => v && v > 0 ? inr2(v) : 'NA'
  const perqLine = d.perquisites.car || d.perquisites.driver
    ? `Perquisites (taxable value, this month) — Car lease : ${perqCell(d.perquisites.car)} &nbsp;&nbsp; Driver : ${perqCell(d.perquisites.driver)}`
    : 'Perquisites (Car lease / Driver) : NA'

  const tw: [string, number, boolean?][] = [
    ['Standard Deduction', t.standardDeduction], ['Previous Employer Taxable Income', t.previousEmployerIncome],
    ['Professional Tax', t.professionalTax], ['Under Chapter VI-A', t.chapterVIA], ['Any Other Income', t.anyOtherIncome],
    ['Taxable Income', t.taxableIncome, true], ['Total Tax', t.totalTax], ['Tax Rebate u/s 87A', t.rebate87A],
    ['Surcharge', t.surcharge], ['Tax Due', t.taxDue], ['Health and Education Cess', t.cess], ['Net Tax', t.netTax, true],
    ['Tax Deducted Till Date', t.deductedTillDate], ['Tax to be Deducted', t.toBeDeducted],
    ['Tax per month', t.perMonth], ['Tax Deduction for this month', t.thisMonth, true],
  ]
  if (t.additionalThisMonth) tw.push([`Additional TDS on ${t.additionalCause}`, t.additionalThisMonth, true])

  const viaHtml = d.chapterVIA
    ? (() => {
        const v = d.chapterVIA!
        return `<tr class="b"><td colspan="2">Investments u/s 80C</td></tr>`
          + rows2(v.lines80C.map(x => [x.label, inr2(x.amount)] as [string, string]))
          + rows2([['Total Investments u/s 80C', inr2(v.total80C)]], ['Total Investments u/s 80C'])
          + rows2([['80C limit available', inr2(v.limit80C)]])
          + rows2([['80C claimed', inr2(v.claimed80C)]], ['80C claimed'])
          + rows2(v.others.map(x => [x.label, inr2(x.amount)] as [string, string]))
          + rows2([['Total Ded Under Ch. VI-A', inr2(v.total)]], ['Total Ded Under Ch. VI-A'])
      })()
    : `<tr><td>New Regime — only 80CCD(2)</td><td class="n">${esc(inr2(t.chapterVIA))}</td></tr>`
      + `<tr><td colspan="2">employer NPS is available</td></tr>`

  const hraHtml = d.hra ? (() => {
    const h = d.hra!
    return `<div class="h">Taxable HRA Calculation (${h.metro ? 'Metro' : 'Non-Metro'})</div>`
      + `<table class="kv">`
      + rows2([['Rent Paid', inr2(h.rentPaid)]])
      + `<tr><td>From: ${esc(h.from)}</td><td class="n">To: ${esc(h.to)}</td></tr>`
      + rows2([
          ['1. Actual HRA', inr2(h.actualHra)],
          [`2. ${h.metro ? '50' : '40'}% of Basic (${h.metro ? 'Metro' : 'Non-Metro'})`, inr2(h.percentOfBasic)],
          ['3. Rent - 10% Basic', inr2(h.rentLessTenPercent)],
          ['Least of above is exempt', inr2(h.exempt)],
          ['Taxable HRA', inr2(h.taxable)],
        ], ['Least of above is exempt', 'Taxable HRA'])
      + `</table>`
  })() : ''

  return `
<section class="slip">
  <header class="co">
    <div class="co-name">${val(d.company.name)}</div>
    <div class="co-line">${val(d.company.address)}</div>
    <div class="co-line">CIN: ${val(d.company.cin)} &nbsp;|&nbsp; Branch: ${val(d.company.branch)}</div>
    <div class="title">PAYSLIP</div>
    <div class="co-line">For the month of ${val(d.period.monthLabel)}</div>
  </header>

  <table class="id">${idRows}</table>

  <div class="two">
    <div>
      <div class="h">Earnings</div>
      <table class="amt">
        <thead><tr><th>Description</th><th class="n">Rate</th><th class="n">Monthly</th><th class="n">Arrear</th><th class="n">Total</th></tr></thead>
        <tbody>${earnRows}</tbody>
        <tfoot><tr class="b"><td colspan="3">GROSS EARNINGS</td><td class="n">${esc(inr2(d.grossArrear))}</td><td class="n">${esc(inr2(d.grossEarnings))}</td></tr></tfoot>
      </table>
    </div>
    <div>
      <div class="h">Deductions</div>
      <table class="amt">
        <thead><tr><th>Description</th><th class="n">Amount</th></tr></thead>
        <tbody>${dedRows}</tbody>
        <tfoot><tr class="b"><td>GROSS DEDUCTIONS</td><td class="n">${esc(inr2(d.grossDeductions))}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="net">Net Pay : ${esc(inr2(d.netPay))} &nbsp; (${esc(d.netPayWords)})</div>
  <div class="perq">${perqLine}</div>

  <div class="sec">Income Tax Worksheet for the Period ${val(d.period.fyFrom)} - ${val(d.period.fyTo)} (Investment Declaration)</div>
  <div class="regime">${val(t.regimeNote)}</div>

  <div class="three">
    <div class="col">
      <table class="amt">
        <thead><tr><th>Description</th><th class="n">Gross</th><th class="n">Exempt</th><th class="n">Taxable</th></tr></thead>
        <tbody>${d.tax.worksheet.map(r =>
          `<tr><td>${esc(r.label)}</td><td class="n">${esc(inr0(r.gross))}</td><td class="n">${esc(inr0(r.exempt))}</td><td class="n">${esc(inr0(r.taxable))}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="b"><td>Gross</td><td class="n">${esc(inr0(t.grossTotal))}</td><td class="n">${esc(inr0(t.exemptTotal))}</td><td class="n">${esc(inr0(t.taxableTotal))}</td></tr></tfoot>
      </table>
      <div class="h">Tax Working</div>
      <table class="kv">${tw.map(([l, v, b]) =>
        `<tr${b ? ' class="b"' : ''}><td>${esc(l)}</td><td class="n">${esc(inr2(v))}</td></tr>`).join('')}</table>
    </div>

    <div class="col">
      <div class="h">Deduction Under Chapter VI-A</div>
      <table class="kv">${viaHtml}</table>
    </div>

    <div class="col">
      ${hraHtml}
      <div class="h">TDS Deducted Monthly</div>
      <table class="kv">
        <thead><tr><th>Month</th><th class="n">Amount</th></tr></thead>
        <tbody>${d.tdsMonthly.map(m =>
          `<tr><td>${esc(m.month)}</td><td class="n">${esc(inr2(m.amount))}</td></tr>`
          + (m.additional ? `<tr><td class="ind">Additional TDS</td><td class="n">${esc(inr2(m.additional))}</td></tr>` : '')).join('')}</tbody>
        <tfoot><tr class="b"><td>Total</td><td class="n">${esc(inr2(d.tdsMonthlyTotal))}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="foot">
    <div>LWP Count: ${d.attendance.lwp.toFixed(2)}${t.projectedMonths ? ` &nbsp;|&nbsp; Projected months remaining: ${t.projectedMonths}` : ''}</div>
    ${d.footnotes.map(f => `<div class="note">${esc(f)}</div>`).join('')}
    <div class="sig">This is a computer-generated payslip and does not require a signature. — EZER HRMS</div>
  </div>
</section>`
}

/** Wrap one or more rendered payslips into a standalone document. */
export function wrapPayslipHtml(sections: string[], title: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  /* No @font-face and no web font: this file is opened offline and mailed on. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #F1F5F9; color: #0F172A;
         font-family: "DM Sans", "Segoe UI", system-ui, sans-serif; font-size: 11px; }
  .slip { background: #fff; border: 1px solid #94A3B8; max-width: 1000px; margin: 0 auto 22px;
          padding: 14px 16px; }
  .co { text-align: center; border-bottom: 1px solid #94A3B8; padding-bottom: 6px; margin-bottom: 8px; }
  .co-name { font-size: 15px; font-weight: 700; }
  .co-line { font-size: 9.5px; color: #334155; margin-top: 2px; }
  .title { font-weight: 700; font-size: 12.5px; letter-spacing: .08em; margin: 6px 0 3px;
           border-top: 1px solid #94A3B8; border-bottom: 1px solid #94A3B8; padding: 3px 0; }
  table { width: 100%; border-collapse: collapse; }
  .id { border: 1px solid #94A3B8; margin-bottom: 10px; }
  .id th { text-align: left; font-weight: 600; color: #334155; padding: 3px 6px; width: 14%; font-size: 10px; }
  .id td { padding: 3px 6px; width: 36%; font-size: 10px; }
  .id td:nth-child(2) { border-right: 1px solid #CBD5E1; }
  .h { font-weight: 700; font-size: 11px; padding: 4px 6px; background: #E2E8F0; border: 1px solid #94A3B8;
       border-bottom: none; }
  .amt, .kv { border: 1px solid #94A3B8; }
  .amt th, .kv th { background: #F1F5F9; font-weight: 600; font-size: 9.5px; text-align: left;
                    padding: 3px 6px; border-bottom: 1px solid #94A3B8; }
  .amt td, .kv td { padding: 2.5px 6px; font-size: 10px; border-bottom: 1px solid #E2E8F0; }
  .amt tfoot td, .kv tfoot td { border-top: 1px solid #94A3B8; border-bottom: none; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .b td, tr.b td { font-weight: 700; }
  .ind { padding-left: 18px !important; color: #475569; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .three { display: grid; grid-template-columns: 40% 30% 30%; gap: 8px; margin-top: 4px; }
  .col { min-width: 0; }
  .net { text-align: center; font-weight: 700; font-size: 12px; padding: 7px 0; margin-top: 10px;
         border-top: 1px solid #94A3B8; border-bottom: 1px solid #94A3B8; }
  .perq { text-align: center; font-size: 9.5px; color: #334155; padding: 5px 0;
          border-bottom: 1px solid #94A3B8; }
  .sec { text-align: center; font-weight: 700; font-size: 11px; background: #E2E8F0;
         border: 1px solid #94A3B8; padding: 4px; margin-top: 10px; }
  .regime { font-size: 9px; color: #334155; padding: 4px 2px; }
  .foot { margin-top: 10px; font-size: 9.5px; color: #334155; }
  .note { font-size: 9px; margin-top: 2px; }
  .sig { text-align: center; font-size: 8.5px; color: #64748B; border-top: 1px solid #94A3B8;
         margin-top: 6px; padding-top: 4px; }

  @media print {
    body { background: #fff; padding: 0; font-size: 9.5px; }
    /* One payslip per sheet, and never a table split down the middle. */
    .slip { border: none; margin: 0; padding: 8mm; max-width: none; break-after: page; page-break-after: always; }
    .slip:last-child { break-after: auto; page-break-after: auto; }
    table, .col { break-inside: avoid; page-break-inside: avoid; }
  }
  @page { size: A4 landscape; margin: 8mm; }
</style>
</head><body>
${sections.join('\n')}
</body></html>`
}
