// lib/onboarding/appointment-letter-server.ts — SERVER ONLY. The Letter of Appointment's facts
// (from the employee record created at Generate code, the onboarding record, the approved offer
// and the joiner's salary structure) and its PDF on the company letterhead, drawn the same way
// as the exit letters (pdfkit for the content, lib/letterhead for the page).
import PDFDocument from 'pdfkit'
import { PDFDocument as LibDoc, StandardFonts, rgb } from 'pdf-lib'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean } from '@/lib/letterhead/pdf-letter'
import { loadSalaryBreakdown } from '@/lib/onboarding/salary-breakdown'
import {
  annexureFrom, buildSections, benefitsOf, inrNum, longDate, salutationFor, splitJoiningBonus,
  type ApptDraft, type ApptFields,
} from './appointment-letter'

const INK = '#1E1B4B', MUTED = '#6B7280', LINE = '#D9DCE3', HEAD_BG = '#EEF2FF'
const today = () => new Date().toISOString().slice(0, 10)

export interface ApptContext {
  draft: ApptDraft
  company: any
  onboarding: { id: string; status: string; employee_id: string | null; employee_code: string | null }
  to: string
  salary_source: string
}

/** Everything the letter is filled from. Null when the onboarding record does not exist. */
export async function loadAppointment(sb: any, onboardingId: string): Promise<ApptContext | null> {
  const { data: oc } = await sb.from('onboarding_candidates')
    .select('id, status, company_id, candidate_id, employee_id, employee_code, full_name, email, designation, department, department_id, location_id, date_of_joining, offered_ctc, annual_ctc, pt_state, form_data, notice_period_days')
    .eq('id', onboardingId).maybeSingle()
  if (!oc) return null
  // The CTC on the payroll master, for joiners whose CTC was never on the onboarding record.
  const { data: cm } = oc.employee_id
    ? await sb.from('ctc_master').select('annual_ctc').eq('employee_id', oc.employee_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null as any }
  const masterCtc = Number(cm?.annual_ctc) || null
  const [{ data: emp }, { data: company }, offerRes, salary] = await Promise.all([
    oc.employee_id ? sb.from('employees').select('full_name, emp_code, gender, designation, department_id, location_id, company_doj, personal_email, office_email, notice_period_days').eq('id', oc.employee_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('companies').select('*').eq('id', oc.company_id).maybeSingle(),
    oc.candidate_id ? sb.from('offer_approval_requests').select('joining_bonus, joining_bonus_freq, esop_value, esop_vesting, offered_ctc, proposed_doj, status, manpower_requisitions(designation), candidates(designation)').eq('candidate_id', oc.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    // The negotiation / offer structure first; the payroll master's CTC only when there is none.
    loadSalaryBreakdown(sb, oc, Number(oc.annual_ctc) || null)
      .then(b => (b.source === 'none' && masterCtc ? loadSalaryBreakdown(sb, oc, masterCtc) : b)).catch(() => null),
  ])
  const offer: any = offerRes?.data || null
  // The requisition and the offer letter the joiner was hired against: they carry the department,
  // the location and the role when the employee / onboarding records were left without them.
  const { data: cand } = oc.candidate_id ? await sb.from('candidates').select('mrf_id, designation').eq('id', oc.candidate_id).maybeSingle() : { data: null as any }
  const [{ data: mrf }, { data: ol }] = await Promise.all([
    cand?.mrf_id ? sb.from('manpower_requisitions').select('department_id, location_id, job_title, position, designation, business_unit').eq('id', cand.mrf_id).maybeSingle() : Promise.resolve({ data: null }),
    oc.candidate_id ? sb.from('offer_letters').select('department, location, designation, date_of_joining, annual_ctc').eq('candidate_id', oc.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const deptId = emp?.department_id || oc.department_id || (mrf as any)?.department_id || null
  const locId = emp?.location_id || oc.location_id || (mrf as any)?.location_id || null
  const [{ data: dept }, { data: loc }, { data: hq }] = await Promise.all([
    deptId ? sb.from('departments').select('dept_name').eq('id', deptId).maybeSingle() : Promise.resolve({ data: null }),
    locId ? sb.from('locations').select('location_name, city').eq('id', locId).maybeSingle() : Promise.resolve({ data: null }),
    // Last resort for the place of posting: the company's head office (else its first location).
    sb.from('locations').select('location_name, city, location_type').eq('company_id', oc.company_id).order('location_name').limit(50),
  ])
  const head = ((hq as any[]) || []).find(l => /head|hq|corporate|corp/i.test(`${l.location_type || ''} ${l.location_name || ''}`)) || ((hq as any[]) || [])[0] || null
  const step1 = oc.form_data?.step_1 || {}
  const ann = annexureFrom(salary?.rows || [])
  const ctc = Number(salary?.annual_ctc) || Number(oc.annual_ctc) || Number(oc.offered_ctc) || Number(offer?.offered_ctc) || masterCtc || 0
  const basicAnnual = ann.annexure.find(r => /^basic/i.test(r.label))?.annual || 0
  const jb = splitJoiningBonus(Number(offer?.joining_bonus) || 0, offer?.joining_bonus_freq)

  const fields: ApptFields = {
    salutation: salutationFor(emp?.gender || step1.gender),
    name: emp?.full_name || oc.full_name || '',
    emp_code: emp?.emp_code || oc.employee_code || '',
    letter_date: today(),
    designation: emp?.designation || oc.designation || (ol as any)?.designation || cand?.designation || offer?.candidates?.designation
      || (mrf as any)?.job_title || (mrf as any)?.designation || (mrf as any)?.position || offer?.manpower_requisitions?.designation || '',
    department: dept?.dept_name || oc.department || (ol as any)?.department || (mrf as any)?.business_unit || '',
    company_name: company?.company_name || '',
    doj: String(emp?.company_doj || oc.date_of_joining || (ol as any)?.date_of_joining || offer?.proposed_doj || '').slice(0, 10),
    place: loc?.city || loc?.location_name || (ol as any)?.location || head?.city || head?.location_name || '',
    ctc_annual: Math.round(ctc || Number((ol as any)?.annual_ctc) || 0),
    jb_total: jb.first + jb.second, jb_first: jb.first, jb_second: jb.second,
    esop_value: Math.round(Number(offer?.esop_value) || 0),
    esop_vesting: offer?.esop_vesting || (Number(offer?.esop_value) > 0 ? '4-year vesting with 1 year cliff' : ''),
    probation_notice_days: 30,
    notice_days: Number(company?.notice_period_days) || 90,
    jurisdiction: 'Gurugram',
    medical: 'INR 5,00,000/- per annum (Spouse+2 Children)',
    // Over and above the CTC, the statutory 4.81% of Basic, unless the structure already has it.
    gratuity_annual: ann.gratuityInCtc ? ann.gratuityAnnual : Math.round(basicAnnual * 0.0481),
    gratuity_in_ctc: ann.gratuityInCtc,
  }
  return {
    draft: { fields, sections: buildSections(fields), annexure: ann.annexure },
    company,
    onboarding: { id: oc.id, status: oc.status, employee_id: oc.employee_id || null, employee_code: oc.employee_code || null },
    to: oc.email || emp?.personal_email || emp?.office_email || '',
    salary_source: salary?.label || 'No CTC on record',
  }
}

/** The letter as a PDF, from the draft exactly as the HR Manager left it. */
export async function appointmentLetterPdf(company: any, draft: ApptDraft): Promise<{ name: string; content: Buffer }> {
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const f = draft.fields
  const companyName = f.company_name || company?.company_name || 'the Company'
  // Room at the foot of every page for the two signature captions, as on the company's letter.
  const SIGN_H = 34
  const M = { ...lh.margins, bottom: lh.margins.bottom + SIGN_H }

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: `Letter of Appointment — ${f.name}`, Author: companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right, x0 = M.left
    const bottom = () => d.page.height - M.bottom
    const ensure = (h: number) => { if (d.y + h > bottom()) d.addPage() }
    const body = (t: string, indent = 0, bullet?: string) => {
      ensure(26)
      d.font('Helvetica').fontSize(10).fillColor(INK)
      if (bullet) { const y = d.y; d.text(bullet, x0 + indent, y, { width: 12, lineBreak: false }); d.y = y }
      d.text(clean(t), x0 + indent + (bullet ? 12 : 0), d.y, { width: W - indent - (bullet ? 12 : 0), align: 'justify', lineGap: 2 })
      d.moveDown(0.45)
    }
    const lines = (text: string) => String(text || '').split('\n').map(s => s.trimEnd()).filter(s => s.trim()).forEach(l => {
      if (/^\s*•\s?/.test(l)) body(l.replace(/^\s*•\s?/, ''), 14, '•')
      else if (/^\s*-\s/.test(l)) body(l.replace(/^\s*-\s/, ''), 30, '-')
      else body(l)
    })

    // Addressee, date, subject
    d.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(clean(`${f.salutation} ${f.name}`), x0, d.y, { width: W / 2 + 60 })
    if (f.emp_code) d.font('Helvetica').fontSize(9.8).fillColor(MUTED).text(clean(`Employee Code: ${f.emp_code}`), x0, d.y, { width: W / 2 + 60 })
    d.font('Helvetica').fontSize(10).fillColor(INK).text(clean(longDate(f.letter_date)), x0, d.y + 4, { width: W })
    d.moveDown(1)
    d.font('Helvetica-Bold').fontSize(11).text('Subject: Letter of Appointment', x0, d.y, { width: W, underline: true })
    d.moveDown(0.8)
    body(`Dear ${f.name},`)

    for (const s of draft.sections) {
      if (s.key === 'annex_note') continue
      if (s.key === 'declaration') {
        ensure(150); d.moveDown(0.8)
        lines(s.body)
        d.moveDown(1)
        d.font('Helvetica').fontSize(10).fillColor(INK).text(clean(`Name: ${f.name}`), x0, d.y, { width: W / 2, continued: false })
        d.text(clean(`Date: ________________`), x0 + W / 2, d.y - 12, { width: W / 2, align: 'right' })
        d.moveDown(1.6); d.text('Signature: ________________', x0, d.y)
        continue
      }
      if (!s.heading) { lines(s.body); continue }
      if (s.inline) {
        // "• Designation: You will be designated as …" — heading and first line on one line.
        const [first, ...rest] = String(s.body || '').split('\n')
        ensure(30); d.moveDown(0.15)
        const y = d.y
        d.font('Helvetica').fontSize(10).fillColor(INK).text('•', x0, y, { width: 12, lineBreak: false })
        d.font('Helvetica-Bold').text(`${clean(s.heading)}: `, x0 + 12, y, { width: W - 12, continued: true })
          .font('Helvetica').text(clean(first || ''), { width: W - 12, align: 'justify', lineGap: 2 })
        d.moveDown(0.45)
        if (rest.length) lines(rest.join('\n'))
        continue
      }
      ensure(44); d.moveDown(0.35)
      const y = d.y
      d.font('Helvetica').fontSize(10).fillColor(INK).text('•', x0, y, { width: 12, lineBreak: false })
      d.font('Helvetica-Bold').fontSize(10.4).text(clean(`${s.heading}:`), x0 + 12, y, { width: W - 12 })
      d.moveDown(0.3)
      lines(s.body)
    }

    // Annexure A — the CTC structure, then the benefits, on a page of its own.
    d.addPage()
    d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Annexure A', x0, d.y, { width: W, align: 'center' })
    d.moveDown(0.8)
    const cols = [W * 0.5, W * 0.25, W * 0.25]
    const row = (cells: string[], o: { head?: boolean; bold?: boolean } = {}) => {
      // The header's two-word captions wrap onto a second line, so its row is taller.
      const h = o.head ? 30 : 20
      ensure(h + 2); const y = d.y
      if (o.head) d.rect(x0, y, W, h).fill(HEAD_BG)
      d.font(o.head || o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.head ? 8.8 : 9.8).fillColor(INK)
      let cx = x0
      cells.forEach((c, i) => { d.text(clean(c), cx + 6, y + 6, { width: cols[i] - 12, align: i ? 'right' : 'left', ...(o.head ? { lineGap: 1 } : { lineBreak: false }) }); cx += cols[i] })
      d.rect(x0, y, W, h).lineWidth(0.5).strokeColor(LINE).stroke()
      d.y = y + h
    }
    row(['COMPONENT NAME', 'MONTHLY REMUNERATION', 'YEARLY REMUNERATION'], { head: true })
    for (const r of draft.annexure) row([r.label, inrNum(r.monthly), inrNum(r.annual)], { bold: r.bold })
    d.moveDown(1)
    const note = draft.sections.find(s => s.key === 'annex_note')
    if (note) lines(note.body)
    const benefits = benefitsOf(f)
    if (benefits.length) {
      d.moveDown(0.6)
      d.font('Helvetica-Bold').fontSize(10.4).fillColor(INK).text('Benefits:', x0, d.y); d.moveDown(0.4)
      benefits.forEach(([k, v]) => {
        ensure(22); const y = d.y
        d.font('Helvetica-Bold').fontSize(9.8).text(clean(k), x0 + 6, y + 6, { width: cols[0] - 12, lineBreak: false })
        d.font('Helvetica').text(clean(v), x0 + cols[0] + 6, y + 6, { width: W - cols[0] - 12, lineBreak: false })
        d.rect(x0, y, W, 20).lineWidth(0.5).strokeColor(LINE).stroke(); d.y = y + 20
      })
    }
    ensure(100); d.moveDown(1.6)
    d.font('Helvetica').fontSize(10).fillColor(INK).text(clean(`On behalf of ${companyName.toUpperCase()}`), x0, d.y)
    if (sig.image) { try { d.image(sig.image, x0, d.y + 4, { height: 38 }); d.y += 46 } catch { d.moveDown(2.2) } } else d.moveDown(2.2)
    d.font('Helvetica-Bold').text(clean(sig.name || 'Authorised Signatory'), x0, d.y)
    d.font('Helvetica').fillColor(MUTED).text(clean(sig.designation || 'Human Resources'), x0, d.y)

    d.end()
  })

  const stamped = await stampOnLetterhead(content, lh, { title: `Letter of Appointment — ${f.name}`, author: companyName, label: (i, n) => `${f.name}${f.emp_code ? ` (${f.emp_code})` : ''} - Letter of Appointment | Page ${i + 1} of ${n}` })
  // The signature captions at the foot of every page, in the room kept for them (drawn with
  // pdf-lib: pdfkit text below its bottom margin starts a new page).
  const out = await LibDoc.load(stamped)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.12, 0.11, 0.29), size = 9, right = 'Employee Name & Signature:'
  for (const p of out.getPages()) {
    const y = lh.margins.bottom + 12
    p.drawText('Authorized Signatory', { x: lh.margins.left, y, size, font: bold, color: ink })
    p.drawText(right, { x: p.getWidth() - lh.margins.right - bold.widthOfTextAtSize(right, size), y, size, font: bold, color: ink })
  }
  const pdf = Buffer.from(await out.save())
  return { name: `Appointment_Letter_${(f.emp_code || f.name).replace(/[^A-Za-z0-9]+/g, '_')}.pdf`, content: pdf }
}
