// src/features/payroll-tax/flexi/exports.ts — the declaration downloads.
//
// SOURCE: FlexiTdsCalculator.tsx downloadDeclaration() (lines 652–730, Excel) and
// downloadDeclarationPdf() (lines 733–780, printable HTML). Same rows, same sheet
// names, same file name, same HTML. Quirk kept: "Flexi Wallet (monthly)" carries the
// annual wallet (sal.other), as on the website.
//
// Phone: the workbook is written to the cache with `xlsx` and handed to the share
// sheet; the HTML is rendered to a PDF with expo-print and shared. Browser test build:
// XLSX.writeFile and a print window, exactly as the website.
import { Platform } from 'react-native'
import * as XLSX from 'xlsx'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { light } from '@/ui/theme'
import { COMPS, N, R, SLAB_LABELS, sumFlexi, type Flexi, type Form, type Regime, type Sal, type Tax } from '../tax'

export interface ExportCtx { empName?: string; empCode?: string; chosenRegime: Regime | null; sal: Sal; T: Tax; f: Form; oFlexi: Flexi; nFlexi: Flexi }

export function workbookRows({ empName, empCode, chosenRegime, sal, T, f, oFlexi, nFlexi }: ExportCtx) {
  const isOld = chosenRegime === 'OLD'
  const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
  const dt = new Date().toLocaleString('en-IN')
  const num = (v: any) => Math.round(Number(v) || 0)
  const summary: any[][] = [
    ['EZER HRMS: Flexi & TDS Declaration', ''],
    ['Financial Year', 'FY 2026-27 (AY 2027-28)'],
    ['Employee', `${empName || ''} (${empCode || ''})`],
    ['Submitted On', dt],
    ['Chosen Regime', isOld ? 'OLD Regime' : 'NEW Regime'],
    ['', ''],
    ['SALARY', ''],
    ['Annual CTC', num(sal.ctc)],
    ['Variable Pay (annual)', num(sal.vari)],
    ['Fixed Salary (annual)', num(sal.fixed)],
    ['Basic (monthly)', num(sal.basic / 12)],
    ['HRA (monthly)', num(sal.hra / 12)],
    ['Employer PF (annual)', num(sal.epf)],
    ['Flexi Wallet (monthly)', num(sal.other)],
    ['Salary Slab', SLAB_LABELS[sal.si]],
    ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`],
  ]
  const flexi: any[][] = [['Component', 'Old Regime (₹/yr)', 'New Regime (₹/yr)']]
  COMPS.forEach(c => { const o = oFlexi[c.k] || 0, n = nFlexi[c.k] || 0; if (o || n) flexi.push([c.l, o, n]) })
  flexi.push(['TOTAL', sumFlexi(oFlexi), sumFlexi(nFlexi)])
  const inv: any[][] = [
    ['Deduction / Investment', 'Amount (₹)', 'Applies to'],
    ['Monthly Rent Declared', N(f.rentM), 'Old (HRA)'],
    ['HRA Exemption', num(T.hE), 'Old'],
    ['80C: LIC', N(f.lic), 'Old'],
    ['80C: PPF', N(f.ppf), 'Old'],
    ['80C: ELSS / Mutual Funds', N(f.elss), 'Old'],
    ['80C: Tuition Fees', N(f.tuit), 'Old'],
    ['80C: Home Loan Principal', N(f.hlP), 'Old'],
    ['80C: Employee PF (auto)', num(sal.epf), 'Old'],
    ['80C Total (capped ₹1.5L)', num(T.c80), 'Old'],
    ['80D: Self + Family', num(T.medS), 'Old'],
    ['80D: Parents', num(T.medP), 'Old'],
    ['Home Loan Interest 24(b)', num(T.hlI), 'Old'],
    ['NPS Self 80CCD(1B)', num(T.npsS), 'Old'],
    ['Employer NPS 80CCD(2)', num(isOld ? T.eNpsO : T.eNpsN), 'Both'],
    ['80E: Education Loan', num(T.eduLoan), 'Old'],
    ['80DD: Dependent Disability', num(T.dep80dd), 'Old'],
    ['80DDB: Disease Treatment', num(T.dis80ddb), 'Old'],
    ['80G: PM Relief / Donations', num(T.pmFund), 'Old'],
    ['Additional Income', num(T.addI), 'Both'],
  ]
  const tds: any[][] = [
    ['', 'Old Regime', 'New Regime'],
    ['Gross Taxable Income', num(T.grossO), num(T.grossN)],
    ['Total Deductions', num(T.dO), num(T.dN)],
    ['Net Taxable Income', num(T.tO), num(T.tN)],
    ['Annual Tax', num(T.fO), num(T.fN)],
    ['Monthly TDS', num(T.moO), num(T.moN)],
    ['Effective Rate %', T.efO, T.efN],
    ['', '', ''],
    ['Recommended Regime', rec, ''],
    ['Your Chosen Regime', isOld ? 'OLD' : 'NEW', ''],
    ['Annual Tax Saving (best)', Math.abs(T.fO - T.fN), ''],
    ['Payable Monthly TDS (chosen)', isOld ? num(T.moO) : num(T.moN), ''],
  ]
  return { summary, flexi, inv, tds }
}

export async function downloadExcel(ctx: ExportCtx) {
  const { summary, flexi, inv, tds } = workbookRows(ctx)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(flexi), 'Flexi Declaration')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Investments')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tds), 'TDS Report')
  const name = `EZER_Flexi_TDS_Declaration_${ctx.empCode || 'employee'}.xlsx`
  if (Platform.OS === 'web') { XLSX.writeFile(wb, name); return }
  const b64: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  const { File, Paths } = await import('expo-file-system')
  const file = new File(Paths.cache, name)
  if (file.exists) file.delete()
  file.create()
  file.write(b64, { encoding: 'base64' })
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: name,
  })
}

/** The website's printable declaration, byte for byte (token colours resolved to the light theme, as printed). */
export function declarationHtml({ empName, empCode, chosenRegime, sal, T, oFlexi, nFlexi }: ExportCtx, withPrintScript: boolean) {
  const TK = light
  const isOld = chosenRegime === 'OLD'
  const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
  const dt = new Date().toLocaleString('en-IN')
  const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')
  const flexiRows = COMPS.filter(c => (oFlexi[c.k] || 0) || (nFlexi[c.k] || 0)).map(c => `<tr><td>${esc(c.l)}</td><td class="r">${R(oFlexi[c.k] || 0)}</td><td class="r">${R(nFlexi[c.k] || 0)}</td></tr>`).join('')
  const oTotV = sumFlexi(oFlexi), nTotV = sumFlexi(nFlexi)
  const invRows = ([
    ['HRA Exemption', R(T.hE)], ['80C (capped ₹1.5L)', R(T.c80)], ['80D Self+Family', R(T.medS)], ['80D Parents', R(T.medP)],
    ['Home Loan Interest 24(b)', R(T.hlI)], ['NPS Self 80CCD(1B)', R(T.npsS)], ['Employer NPS 80CCD(2)', R(isOld ? T.eNpsO : T.eNpsN)],
    ['80E Education Loan', R(T.eduLoan)], ['80DD Dependent Disability', R(T.dep80dd)], ['80DDB Disease', R(T.dis80ddb)], ['80G Donations', R(T.pmFund)], ['Additional Income', R(T.addI)],
  ] as [string, string][]).filter(([, v]) => v !== '₹0').map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Flexi & TDS Declaration: ${esc(empCode)}</title><style>
      *{box-sizing:border-box} body{font-family:"DM Sans","Segoe UI",sans-serif;color:#1E1B4B;margin:0;background:#F5F3FF}
      .doc{background:#fff;max-width:820px;margin:22px auto;padding:34px 40px;border:1px solid #E9E7F5;border-radius:14px}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563EB;padding-bottom:14px;margin-bottom:16px}
      .brand{font-size:22px;font-weight:800;color:#2563EB}.title{text-align:right;font-size:14px;font-weight:800;letter-spacing:.05em}
      .title .sub{font-size:11px;color:#2563EB}
      .badge{display:inline-block;padding:4px 14px;border-radius:99px;font-weight:800;font-size:13px;background:${isOld ? TK.warningTint : TK.positiveTint};color:${isOld ? TK.warning : TK.positive};border:2px solid ${isOld ? TK.warningTint : TK.positive}}
      h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#3C3489;margin:20px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td,th{padding:7px 10px;border-bottom:1px solid #F1F0FA;text-align:left}
      th{background:#1E1B4B;color:#fff;font-size:11px}.r{text-align:right}.k{color:#6B7280;width:45%}.v{font-weight:600}
      .tot td{font-weight:800;color:#2563EB;background:#F5F3FF}
      .note{margin-top:20px;font-size:11px;color:#9CA3AF;line-height:1.5;border-top:1px dashed #E9E7F5;padding-top:12px}
      @media print{body{background:#fff}.doc{border:none;margin:0;border-radius:0;max-width:100%}}
    </style></head><body><div class="doc">
      <div class="hd"><div><div class="brand">EZER HRMS</div><div style="font-size:12px;color:#6B7280">Flexi &amp; Tax Declaration</div></div>
        <div class="title"><div>FLEXI &amp; TDS</div><div class="sub">DECLARATION · FY 2026-27</div></div></div>
      <table>${kv([['Employee', `${empName || ''} (${empCode || ''})`], ['Submitted On', dt]])}
        <tr><td class="k">Chosen Regime</td><td><span class="badge">${isOld ? 'OLD REGIME' : 'NEW REGIME'}</span></td></tr></table>
      <h3>Salary</h3><table>${kv([['Annual CTC', R(sal.ctc)], ['Variable Pay', R(sal.vari)], ['Fixed Salary', R(sal.fixed)], ['Basic (monthly)', R(sal.basic / 12)], ['HRA (monthly)', R(sal.hra / 12)], ['Flexi Wallet (monthly)', R(sal.other)], ['Salary Slab', SLAB_LABELS[sal.si]], ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`]])}</table>
      <h3>Flexi Declaration (annual)</h3><table><thead><tr><th>Component</th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>${flexiRows || '<tr><td colspan="3" style="color:#9CA3AF">None declared</td></tr>'}<tr class="tot"><td>Total</td><td class="r">${R(oTotV)}</td><td class="r">${R(nTotV)}</td></tr></tbody></table>
      <h3>Investments &amp; Deductions</h3><table><tbody>${invRows || '<tr><td colspan="2" style="color:#9CA3AF">None declared</td></tr>'}</tbody></table>
      <h3>TDS Report</h3><table><thead><tr><th></th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>
        <tr><td>Gross Taxable</td><td class="r">${R(T.grossO)}</td><td class="r">${R(T.grossN)}</td></tr>
        <tr><td>Deductions</td><td class="r">${R(T.dO)}</td><td class="r">${R(T.dN)}</td></tr>
        <tr><td>Net Taxable</td><td class="r">${R(T.tO)}</td><td class="r">${R(T.tN)}</td></tr>
        <tr><td>Annual Tax</td><td class="r">${R(T.fO)}</td><td class="r">${R(T.fN)}</td></tr>
        <tr class="tot"><td>Monthly TDS</td><td class="r">${R(T.moO)}</td><td class="r">${R(T.moN)}</td></tr></tbody></table>
      <div style="margin-top:12px;font-size:13px"><b>Recommended:</b> ${rec} Regime (lower tax) · <b>Your choice:</b> ${isOld ? 'Old' : 'New'} · <b>Payable Monthly TDS:</b> ${R(isOld ? T.moO : T.moN)}</div>
      <div class="note">System-generated declaration for FY 2026-27 (AY 2027-28). Figures are estimates for planning; actual TDS may vary with final proofs and payroll processing. Not tax advice.</div>
    </div>${withPrintScript ? '<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>' : ''}</body></html>`
}

export async function downloadPdf(ctx: ExportCtx) {
  if (Platform.OS === 'web') {
    const w = (globalThis as any).window?.open('', '_blank')
    if (w) { w.document.write(declarationHtml(ctx, true)); w.document.close() }
    return
  }
  const { uri } = await Print.printToFileAsync({ html: declarationHtml(ctx, false) })
  await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: `Flexi & TDS Declaration: ${ctx.empCode || ''}` })
}
