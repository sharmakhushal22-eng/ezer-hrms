// lib/exit/letters-pdf.ts — server. The exit letters (spec §10) on the company letterhead, the
// same way the offer letter is drawn (pdfkit for the content, lib/letterhead for the page):
// Experience, Relieving, Termination, PF claim guidance (Form 19 / 10C) and the F&F statement.
import PDFDocument from 'pdfkit'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean } from '@/lib/letterhead/pdf-letter'
import { serviceOf, rupees, LETTER_LABEL, type LetterKind, type FnfLine } from './fnf'
import { CLEARANCE_FORMS, SIGNOFF_LABEL, DEPTS, type Dept } from './clearance'

const INK = '#1E1B4B', MUTED = '#6B7280', LINE = '#D9DCE3'
const day = (d: string | null | undefined) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '-'
const plus1 = (d: string) => new Date(new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)

export interface LetterInput {
  kind: LetterKind
  company: any
  employee: { full_name: string; emp_code: string | null; designation: string | null; department: string | null; doj: string | null; uan: string | null; bank: string | null; personal_email: string | null }
  lwd: string
  reason: { code: string; label: string; sub?: string | null }
  fnf?: { earnings: FnfLine[]; deductions: FnfLine[]; total_earnings: number; total_deductions: number; net_payable: number; status: string; reviewed_by_name?: string | null; approved_by_name?: string | null; paid_ref?: string | null } | null
  clearance?: { dept: string; status: string; recovery: number; cleared_by_name?: string | null }[]
}

export async function exitLetterPdf(x: LetterInput): Promise<{ name: string; content: Buffer }> {
  const [lh, sig] = await Promise.all([loadLetterhead(x.company), loadSignatory(x.company)])
  const M = lh.margins
  const companyName = x.company?.company_name || 'the Company'
  const title = LETTER_LABEL[x.kind]
  const e = x.employee
  const svc = e.doj ? serviceOf(e.doj, x.lwd) : null
  const tenure = svc ? `${svc.years} year(s) ${Math.floor(svc.days / 30.44)} month(s)` : '-'
  const ref = `${x.kind.slice(0, 3)}/${e.emp_code || 'EMP'}/${new Date().getFullYear()}`

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: `${title} — ${e.full_name}`, Author: companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, x.company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, x.company)) }
    const W = d.page.width - M.left - M.right, x0 = M.left
    const bottom = () => d.page.height - M.bottom
    const ensure = (h: number) => { if (d.y + h > bottom()) d.addPage() }
    const para = (t: string) => { ensure(30); d.font('Helvetica').fontSize(10.2).fillColor(INK).text(clean(t), x0, d.y, { width: W, align: 'justify', lineGap: 2.2 }); d.moveDown(0.7) }
    const heading = (t: string) => { ensure(40); d.moveDown(0.3); d.font('Helvetica-Bold').fontSize(10.8).fillColor(INK).text(clean(t), x0, d.y, { width: W }); d.moveDown(0.3) }
    const kv = (rows: [string, any][]) => rows.forEach(([k, v]) => {
      ensure(18); const y = d.y
      d.font('Helvetica').fontSize(9.8).fillColor(MUTED).text(clean(k), x0, y, { width: 170 })
      d.font('Helvetica-Bold').fillColor(INK).text(clean(v ?? '-'), x0 + 175, y, { width: W - 175 })
      d.y = Math.max(d.y, y + 15)
    })
    const money = (rows: FnfLine[], head: string, total: number) => {
      heading(head)
      for (const l of rows) {
        ensure(30); const y = d.y
        d.font('Helvetica').fontSize(9.8).fillColor(INK).text(clean(l.label), x0, y, { width: W - 120 })
        if (l.note) d.font('Helvetica').fontSize(8).fillColor(MUTED).text(clean(l.note), x0, d.y, { width: W - 120 })
        d.font('Helvetica').fontSize(9.8).fillColor(INK).text(clean(rupees(l.amount)), x0 + W - 115, y, { width: 115, align: 'right' })
        d.y = Math.max(d.y, y + 15) + 3
        d.moveTo(x0, d.y).lineTo(x0 + W, d.y).lineWidth(0.4).strokeColor(LINE).stroke(); d.y += 3
      }
      const y = d.y
      d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Total ${head.toLowerCase()}`, x0, y, { width: W - 120 })
      d.text(clean(rupees(total)), x0 + W - 115, y, { width: 115, align: 'right' }); d.moveDown(0.8)
    }
    const sign = (who?: string) => {
      ensure(110); d.moveDown(1.2)
      d.font('Helvetica').fontSize(10).fillColor(INK).text(`For ${clean(companyName)}`, x0, d.y)
      if (sig.image) { try { d.image(sig.image, x0, d.y + 4, { height: 38 }); d.y += 46 } catch { d.moveDown(2.2) } } else d.moveDown(2.2)
      d.font('Helvetica-Bold').text(clean(sig.name || who || 'Authorised Signatory'), x0, d.y)
      d.font('Helvetica').fillColor(MUTED).text(clean(sig.designation || 'Human Resources'), x0, d.y)
    }

    // Reference + date + title
    d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`Ref: ${ref}`, x0, d.y, { width: W / 2 })
    d.text(`Date: ${day(new Date().toISOString())}`, x0 + W / 2, d.y - 11.5, { width: W / 2, align: 'right' })
    d.moveDown(1.2)
    d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(clean(title.toUpperCase()), x0, d.y, { width: W, align: 'center' })
    d.moveDown(1)

    const name = e.full_name, role = [e.designation, e.department ? `${e.department} department` : null].filter(Boolean).join(', ')
    if (x.kind === 'EXPERIENCE') {
      d.font('Helvetica-Bold').fontSize(10.5).text('TO WHOM IT MAY CONCERN', x0, d.y, { width: W }); d.moveDown(0.8)
      para(`This is to certify that ${name} (Employee Code: ${e.emp_code || '-'}) was employed with ${companyName} from ${day(e.doj)} to ${day(x.lwd)}${role ? `, last holding the position of ${role}` : ''}.`)
      para(`The total length of service with the company is ${tenure}. During this tenure, ${name} discharged the responsibilities of the role with sincerity.`)
      para(`We wish ${name} every success in future endeavours.`)
      sign()
    } else if (x.kind === 'RELIEVING') {
      para(`Dear ${name},`)
      para(`With reference to your ${x.reason.code === 'SELF' ? 'resignation' : `separation (${x.reason.label})`}, we confirm that you have been relieved from the services of ${companyName} at the close of business hours on ${day(x.lwd)}. Your relieving date is ${day(plus1(x.lwd))}.`)
      kv([['Employee code', e.emp_code], ['Designation', e.designation], ['Department', e.department], ['Date of joining', day(e.doj)], ['Last working day', day(x.lwd)], ['Length of service', tenure]])
      d.moveDown(0.6)
      para('Your clearance from all departments and your Full & Final settlement are complete, and no dues are pending from you to the company.')
      para('We thank you for your contribution and wish you the very best.')
      sign()
    } else if (x.kind === 'TERMINATION') {
      para(`Dear ${name},`)
      const reasonText = x.reason.code === 'ABSCOND'
        ? 'You have remained absent from work without intimation and did not respond to the three reminders sent to you. The company has therefore treated you as having abandoned your employment.'
        : x.reason.code === 'FRAUD' ? `Following the inquiry into ${x.reason.sub || 'misconduct'} attributed to you, the management has decided to terminate your employment.`
        : `The management has decided to terminate your employment for the following reason: ${x.reason.label}${x.reason.sub ? ` (${x.reason.sub})` : ''}.`
      para(reasonText)
      para(`Your employment with ${companyName} stands terminated with effect from ${day(x.lwd)}, which is your last working day.`)
      para('Your dues up to that date will be settled in your Full & Final settlement after recovery of any amounts owed to the company. Return all company property in your possession immediately.')
      sign()
    } else if (x.kind === 'PF_GUIDANCE' && x.reason.code === 'DEATH') {
      // Death in service: the claim is the nominee's / family's.
      para(`To the nominee / family of the late ${name} (Employee Code: ${e.emp_code || '-'}). Please accept our deepest condolences. This note explains the Provident Fund, pension and insurance claims that are payable to you.`)
      kv([['UAN', e.uan || 'Not on record: contact HR'], ['Service period', `${day(e.doj)} to ${day(x.lwd)}`], ['Date of death', day(x.lwd)]])
      heading('Form 20: Provident Fund balance')
      para('The PF balance is paid to the nominee (or, without a nomination, to the legal heirs). Submit Form 20 with the death certificate and the claimant’s bank details; it can be filed online on the EPFO portal by the nominee.')
      heading('Form 10D: family / widow(er) pension (EPS)')
      para('The family pension under the Employees’ Pension Scheme is payable to the spouse and children (or the nominee) with no minimum service. Submit Form 10D with the death certificate, the claimants’ photographs and bank details.')
      heading('Form 5(IF): EDLI insurance')
      para('The Employees’ Deposit Linked Insurance assurance benefit is payable to the nominee. Submit Form 5(IF) along with Form 20; the company attests it.')
      heading('Gratuity and the Full & Final settlement')
      para(`Gratuity is payable on death without the five-year condition, and the Full & Final settlement from ${companyName} is paid to the nominee. HR will help you with the attestations and the documents required.`)
      sign()
    } else if (x.kind === 'PF_GUIDANCE') {
      para(`Dear ${name}, this note helps you withdraw or transfer your Provident Fund after leaving ${companyName}.`)
      kv([['UAN', e.uan || 'Not on record: contact HR'], ['Service period', `${day(e.doj)} to ${day(x.lwd)}`], ['Bank (for the claim)', e.bank || 'Update your bank in ESS'], ['Personal email', e.personal_email || '-']])
      heading('Form 19: PF final settlement (full withdrawal)')
      para('Use it when you are not joining another employer covered by EPF. You may claim after 2 months of leaving (or at once on retirement). On the EPFO Member e-SEWA portal: Online Services → Claim (Form-31, 19, 10C & 10D) → verify your bank → choose "PF Final Settlement".')
      heading('Form 10C: pension scheme withdrawal')
      para('If your pensionable service is under 10 years, you can withdraw the pension contribution with Form 10C (same Claim screen). With 10 years or more, ask for a Scheme Certificate instead and keep it for a pension later.')
      heading('Joining a new employer')
      para('Do not withdraw. Give your new employer your UAN; the balance can be transferred through Online Services → One Member – One EPF Account (Transfer Request).')
      heading('Before you claim')
      para('Your UAN must be activated and linked to Aadhaar, PAN and your bank account (KYC approved), and your date of exit must be updated by the company. Claims usually settle in 20–30 days.')
      sign()
    } else {
      // F&F statement
      kv([['Employee', `${name} (${e.emp_code || '-'})`], ['Designation', e.designation], ['Department', e.department], ['Date of joining', day(e.doj)], ['Last working day', day(x.lwd)], ['Exit reason', `${x.reason.label}${x.reason.sub ? ` · ${x.reason.sub}` : ''}`], ['Length of service', tenure]])
      d.moveDown(0.6)
      if (x.fnf) {
        money(x.fnf.earnings, 'Earnings', x.fnf.total_earnings)
        money(x.fnf.deductions, 'Deductions', x.fnf.total_deductions)
        ensure(30); const y = d.y
        d.rect(x0, y, W, 24).fill('#EEF2FF')
        d.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Net payable to employee', x0 + 8, y + 7, { width: W - 140 })
        d.text(clean(rupees(x.fnf.net_payable)), x0 + W - 130, y + 7, { width: 122, align: 'right' })
        d.y = y + 34
      }
      if (x.clearance?.length) {
        heading('Clearance summary')
        for (const dep of DEPTS) {
          const c = x.clearance.find(c => c.dept === dep); if (!c) continue
          kv([[CLEARANCE_FORMS[dep as Dept].label, `${SIGNOFF_LABEL[c.status] || c.status}${c.recovery ? ` · dues ${rupees(c.recovery)}` : ''}${c.cleared_by_name ? ` · ${c.cleared_by_name}` : ''}`]])
        }
      }
      if (x.fnf) {
        heading('Approvals')
        kv([['Reviewed (Payroll)', x.fnf.reviewed_by_name || '-'], ['Approved (HR)', x.fnf.approved_by_name || '-'], ['Payment reference', x.fnf.paid_ref || (x.fnf.status === 'PAID' ? 'Paid' : 'Pending')]])
      }
      sign()
    }
    d.end()
  })
  const stem = title.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')
  return {
    name: `${stem}-${(e.emp_code || e.full_name).replace(/[^A-Za-z0-9]+/g, '_')}.pdf`,
    content: await stampOnLetterhead(content, lh, { title: `${title} — ${e.full_name}`, author: companyName, label: (i, n) => `${e.full_name} - ${title} | Page ${i + 1} of ${n}` }),
  }
}
