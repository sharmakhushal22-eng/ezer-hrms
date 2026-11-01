// lib/onboarding/appointment-letter-server.ts — SERVER ONLY. The Letter of Appointment's facts
// and its PDF on the company letterhead (pdfkit for the content, lib/letterhead for the page).
//
// The facts come from the employee record created at Generate code, the onboarding record, the
// requisition, the approved offer, the company (address, CIN), its leave policy and shift, the
// letterhead signatory — and the salary from the recruitment negotiation, exactly as the
// candidate's salary statement and the offer file show it (lib/recruitment/offer-dossier: the
// HR Head's revision of the offer when there is one, else the negotiated calculation). Only a
// joiner with no negotiation falls back to the offer letter's figures or the CTC on record.
//
// A letter can be loaded for an onboarding record or, for an employee who never went through
// onboarding, for the employee record alone.
import PDFDocument from 'pdfkit'
import { PDFDocument as LibDoc, StandardFonts, rgb } from 'pdf-lib'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean } from '@/lib/letterhead/pdf-letter'
import { loadSalaryBreakdown, negotiatedSalary } from '@/lib/onboarding/salary-breakdown'
import {
  annexureFrom, buildSections, benefitsOf, leaveRows, inrNum, longDate, salutationFor, relationFor, splitJoiningBonus,
  type ApptDraft, type ApptFields,
} from './appointment-letter'

const INK = '#1E1B4B', MUTED = '#6B7280', LINE = '#D9DCE3', HEAD_BG = '#EEF2FF', GROUP_BG = '#F5F6FA'
const today = () => new Date().toISOString().slice(0, 10)
/** A value, trimmed; a placeholder of dots or dashes ("........", "N/A") is no value. */
const s = (v: any) => { const t = v == null ? '' : String(v).trim(); return /^[.\-_\s]*$/.test(t) || /^n\/?a$/i.test(t) ? '' : t }
const hhmm = (t: any) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''))
  if (!m) return ''
  const h = Number(m[1]), ap = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${m[2]} ${ap}`
}

export { negotiatedSalary }

export interface ApptContext {
  draft: ApptDraft
  company: any
  onboarding: { id: string | null; status: string | null; employee_id: string | null; employee_code: string | null; company_id: string | null }
  to: string
  salary_source: string
}

/** Everything the letter is filled from. Null when neither record exists. */
export async function loadAppointment(sb: any, ref: string | { onboardingId?: string | null; employeeId?: string | null }): Promise<ApptContext | null> {
  const want = typeof ref === 'string' ? { onboardingId: ref, employeeId: null } : ref
  const OC_COLS = 'id, status, company_id, candidate_id, employee_id, employee_code, full_name, email, designation, department, department_id, location_id, date_of_joining, offered_ctc, annual_ctc, pt_state, form_data, notice_period_days'
  let oc: any = null
  if (want.onboardingId) ({ data: oc } = await sb.from('onboarding_candidates').select(OC_COLS).eq('id', want.onboardingId).maybeSingle())
  else if (want.employeeId) ({ data: oc } = await sb.from('onboarding_candidates').select(OC_COLS).eq('employee_id', want.employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle())
  const employeeId = oc?.employee_id || want.employeeId || null
  const { data: emp } = employeeId ? await sb.from('employees').select('*').eq('id', employeeId).maybeSingle() : { data: null as any }
  if (!oc && !emp) return null
  const companyId = emp?.company_id || oc?.company_id || null
  const candidateId = oc?.candidate_id || null

  // The CTC on the payroll master, for joiners whose CTC was never on the onboarding record.
  const [{ data: cm }, { data: company }, negotiated, { data: cand }] = await Promise.all([
    employeeId ? sb.from('ctc_master').select('annual_ctc').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    companyId ? sb.from('companies').select('*').eq('id', companyId).maybeSingle() : Promise.resolve({ data: null }),
    candidateId ? negotiatedSalary(sb, candidateId).catch(() => null) : Promise.resolve(null),
    candidateId ? sb.from('candidates').select('mrf_id, designation').eq('id', candidateId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const masterCtc = Number(cm?.annual_ctc) || null
  const offer: any = negotiated?.offer || (candidateId ? (await sb.from('offer_approval_requests').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle()).data : null)
  // No negotiation: the offer letter's figures, else the CTC on record run through the CTC model.
  const fallback = negotiated ? null : await (oc
    ? loadSalaryBreakdown(sb, oc, null).then(b => (b.source === 'none' && masterCtc ? loadSalaryBreakdown(sb, oc, masterCtc) : b))
    : loadSalaryBreakdown(sb, { id: '', pt_state: emp?.pt_state || emp?.professional_tax_state || null }, masterCtc)).catch(() => null)

  // The requisition and the offer letter the joiner was hired against: they carry the department,
  // the location and the role when the employee / onboarding records were left without them.
  const [{ data: mrf }, { data: ol }] = await Promise.all([
    cand?.mrf_id ? sb.from('manpower_requisitions').select('department_id, location_id, job_title, position, designation, business_unit').eq('id', cand.mrf_id).maybeSingle() : Promise.resolve({ data: null }),
    candidateId ? sb.from('offer_letters').select('department, location, designation, date_of_joining, annual_ctc').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const deptId = emp?.department_id || oc?.department_id || (mrf as any)?.department_id || null
  const locId = emp?.location_id || oc?.location_id || (mrf as any)?.location_id || null
  const mgrIds = [emp?.l1_manager_id, emp?.functional_manager_id || emp?.dotted_line_manager_id].filter(Boolean)
  const [{ data: dept }, { data: loc }, { data: hq }, { data: mgrs }, { data: leaves }, { data: shifts }, sig] = await Promise.all([
    deptId ? sb.from('departments').select('dept_name').eq('id', deptId).maybeSingle() : Promise.resolve({ data: null }),
    locId ? sb.from('locations').select('location_name, city, state, address_line1, address_line2, pin_code').eq('id', locId).maybeSingle() : Promise.resolve({ data: null }),
    // Last resort for the place of posting: the company's head office (else its first location).
    companyId ? sb.from('locations').select('location_name, city, state, location_type').eq('company_id', companyId).order('location_name').limit(50) : Promise.resolve({ data: [] }),
    mgrIds.length ? sb.from('employees').select('id, full_name, designation').in('id', mgrIds) : Promise.resolve({ data: [] }),
    companyId ? sb.from('leave_policy').select('fy, annual_quota, max_carry_forward, is_active, leave_types(name, short_name)').eq('company_id', companyId).eq('is_active', true) : Promise.resolve({ data: [] }),
    companyId ? sb.from('shift_master').select('shift_type, in_time, out_time, lunch_duration_mins, overtime_applicable, is_active').eq('company_id', companyId).eq('is_active', true).limit(20) : Promise.resolve({ data: [] }),
    loadSignatory(company).catch(() => ({ name: '', designation: '', image: null })),
  ])
  const head = ((hq as any[]) || []).find(l => /head|hq|corporate|corp/i.test(`${l.location_type || ''} ${l.location_name || ''}`)) || ((hq as any[]) || [])[0] || null
  const place: any = loc || head
  const mgrName = (id: any) => { const m = ((mgrs as any[]) || []).find(x => x.id === id); return m ? `${m.full_name}${m.designation ? `, ${m.designation}` : ''}` : '' }

  // Leave: the company's policy for the current year where it has one, else the spec's defaults.
  const quota = (re: RegExp) => {
    const rows = ((leaves as any[]) || []).filter(l => re.test(`${l.leave_types?.short_name || ''} ${l.leave_types?.name || ''}`)).sort((a, b) => String(b.fy).localeCompare(String(a.fy)))
    return rows[0] || null
  }
  const el = quota(/\b(EL|PL)\b|earned|privilege/i), cl = quota(/\bCL\b|casual/i), sl = quota(/\bSL\b|sick/i)
  const shift = ((shifts as any[]) || []).find(x => /general/i.test(x.shift_type || '')) || ((shifts as any[]) || [])[0] || null
  const shiftHours = shift ? (() => {
    const [a, b] = [shift.in_time, shift.out_time].map((t: any) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN })
    const span = b - a, lunch = Number(shift.lunch_duration_mins) || 0
    return Number.isFinite(span) && span > 0 ? { span, lunch, net: span - lunch } : null
  })() : null
  const hrs = (m: number) => `${Math.round(m / 6) / 10} hours`.replace('.0 ', ' ')

  const step3 = oc?.form_data?.step_3 || oc?.form_data?.step_1 || {}
  const step4 = oc?.form_data?.step_4 || {}
  const gender = emp?.gender || step3.gender
  const permAddress = [emp?.perm_address1, emp?.perm_address2, emp?.perm_city, emp?.perm_state, emp?.perm_pin].map(s).filter(Boolean).join(', ')
    || [step4.perm_line1, step4.perm_city, step4.perm_state, step4.perm_pin].map(s).filter(Boolean).join(', ')
    || [emp?.res_address1, emp?.res_address2, emp?.res_city, emp?.res_state, emp?.res_pin].map(s).filter(Boolean).join(', ')

  const rows = negotiated?.rows || fallback?.rows || []
  const ann = annexureFrom(rows, negotiated?.extras || [])
  const ctc = Number(negotiated?.ctc) || Number(fallback?.annual_ctc) || Number(oc?.annual_ctc) || Number(oc?.offered_ctc) || Number(offer?.offered_ctc) || masterCtc || Number((ol as any)?.annual_ctc) || 0
  const basicAnnual = ann.annexure.find(r => /^basic/i.test(r.label))?.annual || 0
  const jb = splitJoiningBonus(Number(offer?.joining_bonus) || 0, offer?.joining_bonus_freq)
  const esi = ann.annexure.some(r => /esic/i.test(r.label) && r.annual > 0)
  const empType = s(emp?.employment_type)
  const companyAddress = s(company?.reg_office) || s(company?.corp_office)
  const jur = s(place?.city) || 'Gurugram'
  const jurState = s(place?.state)

  const fields: ApptFields = {
    letter_date: today(),
    ref_no: '',
    salutation: salutationFor(gender),
    name: s(emp?.full_name) || s(oc?.full_name),
    emp_code: s(emp?.emp_code) || s(oc?.employee_code),
    relation: relationFor(gender),
    father_name: s(emp?.father_name) || s(step3.father_name),
    perm_address: permAddress,
    company_name: s(company?.company_name),
    company_address: companyAddress,
    cin: s(company?.cin),
    designation: s(emp?.designation) || s(oc?.designation) || s((ol as any)?.designation) || s(cand?.designation) || s(offer?.designation)
      || s((mrf as any)?.job_title) || s((mrf as any)?.designation) || s((mrf as any)?.position),
    department: s(dept?.dept_name) || s(oc?.department) || s((ol as any)?.department) || s((mrf as any)?.business_unit),
    grade: s(emp?.grade) || s(emp?.band),
    employment_type: emp?.fixed_term_employee ? 'Fixed-term' : !empType || /^employee$|permanent|full/i.test(empType) ? 'Full-time (Permanent)' : empType,
    reporting_manager: mgrName(emp?.l1_manager_id) || s(emp?.reporting_manager),
    functional_manager: mgrName(emp?.functional_manager_id || emp?.dotted_line_manager_id),
    doj: String(emp?.company_doj || emp?.date_of_appointment || oc?.date_of_joining || (ol as any)?.date_of_joining || offer?.proposed_doj || '').slice(0, 10),
    place: [s(place?.location_name), s(place?.city)].filter((v, i, a) => v && a.indexOf(v) === i).join(', ') || s((ol as any)?.location),
    ctc_annual: Math.round(ctc),
    jb_total: jb.first + jb.second, jb_first: jb.first, jb_second: jb.second,
    retention_bonus: Math.round(Number(offer?.retention_bonus) || 0),
    esop_value: Math.round(Number(offer?.esop_value) || 0),
    esop_vesting: s(offer?.esop_vesting) || (Number(offer?.esop_value) > 0 ? '4-year vesting with 1 year cliff' : ''),
    esi_applicable: esi,
    medical: 'INR 5,00,000/- per annum (Spouse+2 Children)',
    // Over and above the CTC, the statutory 4.81% of Basic, unless the structure already has it.
    gratuity_annual: ann.gratuityInCtc ? ann.gratuityAnnual : Math.round(basicAnnual * 0.0481),
    gratuity_in_ctc: ann.gratuityInCtc,
    probation_months: Number(emp?.probation_months) || (Number(company?.probation_days) ? Math.round(Number(company.probation_days) / 30) : 6),
    probation_extension_months: 3,
    probation_notice_days: 30,
    notice_days: Number(company?.notice_period_days) || (Number(emp?.notice_period_days) > 30 ? Number(emp.notice_period_days) : 60),
    fnf_days: 30,
    working_days: 'Monday to Friday (5-day week)',
    working_hours: shift ? `${hhmm(shift.in_time)} to ${hhmm(shift.out_time)}${shiftHours?.lunch ? ` (including a ${shiftHours.lunch}-minute lunch break)` : ''}` : '9:00 AM to 6:00 PM (including a 1-hour lunch break)',
    effective_hours: shiftHours ? `${hrs(shiftHours.net)} per day` : '8 hours per day / 40 hours per week',
    overtime: shift?.overtime_applicable ? 'Overtime is payable as per company policy and applicable law.' : 'Overtime is not applicable for this grade; compensatory off may be provided for extra hours worked.',
    el_days: Number(el?.annual_quota) || 15,
    el_carry_max: Number(el?.max_carry_forward) || 30,
    cl_days: Number(cl?.annual_quota) || 8,
    sl_days: Number(sl?.annual_quota) || 7,
    maternity_weeks: 26,
    paternity_days: 5,
    bereavement_days: '3-5',
    marriage_days: 3,
    confidentiality_years: 2,
    non_compete_months: 12,
    non_solicit_months: 12,
    non_compete_region: 'India',
    gift_limit: 2000,
    bgv_days: 30,
    jurisdiction: jurState && jurState.toLowerCase() !== jur.toLowerCase() ? `${jur}, ${jurState}` : jur,
    signatory_name: s(sig?.name) && !/^authori[sz]ed signatory$/i.test(s(sig?.name)) ? s(sig?.name) : '',
    signatory_designation: s(sig?.designation) || 'HR Head',
    witness_name: '',
    witness_designation: '',
  }
  return {
    draft: { fields, sections: buildSections(fields), annexure: ann.annexure },
    company,
    onboarding: { id: oc?.id || null, status: oc?.status || null, employee_id: employeeId, employee_code: fields.emp_code || null, company_id: companyId },
    to: s(oc?.email) || s(emp?.personal_email) || s(emp?.office_email),
    salary_source: negotiated?.label || fallback?.label || 'No CTC on record',
  }
}

/** The letter as a PDF, from the draft exactly as the HR Manager left it. */
export async function appointmentLetterPdf(company: any, draft: ApptDraft): Promise<{ name: string; content: Buffer }> {
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const f = draft.fields
  const companyName = f.company_name || company?.company_name || 'the Company'
  // Room at the foot of every page for the signature / initials captions.
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
      d.font('Helvetica').fontSize(9.8).fillColor(INK)
      if (bullet) { const y = d.y; d.text(bullet, x0 + indent, y, { width: 12, lineBreak: false }); d.y = y }
      // "Label: text" bullets print the label in bold.
      const txt = clean(t), m = bullet === '•' ? /^([A-Z][A-Za-z /&()\-]{1,40}):\s/.exec(txt) : null
      const opts = { width: W - indent - (bullet ? 12 : 0), align: 'justify' as const, lineGap: 2 }
      if (m) d.font('Helvetica-Bold').text(`${m[1]}: `, x0 + indent + 12, d.y, { ...opts, continued: true }).font('Helvetica').text(txt.slice(m[0].length), opts)
      else d.text(txt, x0 + indent + (bullet ? 12 : 0), d.y, opts)
      d.moveDown(0.4)
    }
    const lines = (text: string) => String(text || '').split('\n').map(x => x.trimEnd()).filter(x => x.trim()).forEach(l => {
      if (/^\s*•\s?/.test(l)) body(l.replace(/^\s*•\s?/, ''), 6, '•')
      else if (/^\s*-\s/.test(l)) body(l.replace(/^\s*-\s/, ''), 22, '-')
      else body(l)
    })
    const heading = (t: string) => {
      ensure(48); d.moveDown(0.5)
      d.font('Helvetica-Bold').fontSize(10.6).fillColor(INK).text(clean(t), x0, d.y, { width: W })
      const y = d.y + 2
      d.moveTo(x0, y).lineTo(x0 + W, y).lineWidth(0.6).strokeColor(LINE).stroke()
      d.y = y + 5
    }

    // ── Header: Private & Confidential, reference, date, company details
    const top = d.y
    d.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('PRIVATE & CONFIDENTIAL', x0, top, { width: W, align: 'right', characterSpacing: 0.6 })
    d.font('Helvetica').fontSize(9.4).fillColor(INK)
    d.text(clean(`Ref. No.: ${f.ref_no || 'Assigned on issue'}`), x0, top, { width: W / 2 + 40 })
    d.text(clean(`Date: ${longDate(f.letter_date)}`), x0, d.y, { width: W / 2 + 40 })
    const coLine = [f.company_address ? `Registered Office: ${f.company_address}` : '', f.cin ? `CIN: ${f.cin}` : ''].filter(Boolean).join('  |  ')
    if (coLine) d.font('Helvetica').fontSize(8.2).fillColor(MUTED).text(clean(`${companyName}  |  ${coLine}`), x0, d.y + 2, { width: W })
    d.moveDown(1)

    // ── Addressee
    d.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(clean(`${f.salutation} ${f.name}`), x0, d.y, { width: W })
    d.font('Helvetica').fontSize(9.8)
    if (f.father_name.trim()) d.text(clean(`${f.relation || 'S/o'} ${f.father_name.trim()}`), x0, d.y, { width: W })
    if (f.perm_address.trim()) d.text(clean(f.perm_address.trim()), x0, d.y, { width: W * 0.6 })
    if (f.emp_code) d.fillColor(MUTED).text(clean(`Employee Code: ${f.emp_code}`), x0, d.y, { width: W }).fillColor(INK)
    d.moveDown(0.9)
    d.font('Helvetica-Bold').fontSize(11).text('Subject: Letter of Appointment', x0, d.y, { width: W, align: 'center', underline: true })
    d.moveDown(0.8)
    body(`Dear ${f.name},`)

    let n = 0
    for (const sct of draft.sections) {
      if (sct.key === 'annex_note' || sct.key === 'annex_c' || sct.key === 'declaration') continue
      if (!sct.heading) { lines(sct.body); continue }
      heading(`${++n}. ${sct.heading}`)
      lines(sct.body)
    }

    // ── Acceptance & signatures
    ensure(260); d.moveDown(0.6)
    heading(`${++n}. Acceptance & Signatures`)
    const decl = draft.sections.find(x => x.key === 'declaration')
    d.font('Helvetica-Bold').fontSize(9.8).fillColor(INK).text('Declaration by the employee', x0, d.y); d.moveDown(0.3)
    if (decl) lines(decl.body)
    d.moveDown(0.8)
    const colW = (W - 24) / 2, yTop = d.y
    // The company
    d.font('Helvetica-Bold').fontSize(9.8).fillColor(INK).text(clean(`For ${companyName}`), x0, yTop, { width: colW })
    let yc = d.y + 4
    if (sig.image) { try { d.image(sig.image, x0, yc, { height: 38 }); yc += 44 } catch { yc += 30 } } else yc += 30
    d.font('Helvetica').fontSize(9.6)
    d.text('______________________________', x0, yc, { width: colW })
    d.font('Helvetica-Bold').text(clean(f.signatory_name || sig.name || 'Authorised Signatory'), x0, d.y + 2, { width: colW })
    d.font('Helvetica').fillColor(MUTED).text(clean(f.signatory_designation || sig.designation || 'Human Resources'), x0, d.y, { width: colW }).fillColor(INK)
    d.text(clean(`Date: ${longDate(f.letter_date)}`), x0, d.y + 2, { width: colW })
    d.text('Company Seal / Stamp:', x0, d.y + 2, { width: colW })
    const yLeft = d.y
    // The employee
    const xr = x0 + colW + 24
    d.font('Helvetica-Bold').fontSize(9.8).text('Accepted by the employee', xr, yTop, { width: colW })
    d.font('Helvetica').fontSize(9.6)
    d.text('Signature: ______________________', xr, yTop + 52, { width: colW })
    d.text(clean(`Name: ${f.name}`), xr, d.y + 6, { width: colW })
    d.text('Date: ____________________', xr, d.y + 6, { width: colW })
    d.text('Place: ____________________', xr, d.y + 6, { width: colW })
    d.y = Math.max(yLeft, d.y) + 14
    d.font('Helvetica').fontSize(9.4).fillColor(INK)
      .text(clean(`Witness (optional): ${f.witness_name.trim() ? `${f.witness_name.trim()}${f.witness_designation.trim() ? `, ${f.witness_designation.trim()}` : ''}` : '______________________'}     Signature: ____________________`), x0, d.y, { width: W })

    // ── Annexure A — the salary structure, as negotiated, then the benefits
    d.addPage()
    d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Annexure A — CTC Breakup', x0, d.y, { width: W, align: 'center' })
    d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(`${f.name}${f.emp_code ? ` (${f.emp_code})` : ''} · ${f.designation} · Annual CTC INR ${inrNum(f.ctc_annual)}`), x0, d.y + 2, { width: W, align: 'center' })
    d.moveDown(0.9)
    const cols = [W * 0.52, W * 0.24, W * 0.24]
    const row = (cells: string[], o: { head?: boolean; bold?: boolean; group?: boolean; shade?: boolean } = {}) => {
      const h = o.head ? 26 : 19
      ensure(h + 2); const y = d.y
      if (o.head) d.rect(x0, y, W, h).fill(HEAD_BG)
      else if (o.group || o.shade) d.rect(x0, y, W, h).fill(GROUP_BG)
      d.font(o.head || o.bold || o.group ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.head || o.group ? 8.6 : 9.4).fillColor(INK)
      if (o.group) d.text(clean(cells[0]), x0 + 6, y + 5.5, { width: W - 12, lineBreak: false, characterSpacing: 0.4 })
      else {
        let cx = x0
        cells.forEach((c, i) => { d.text(clean(c), cx + 6, y + (o.head ? 8 : 5.5), { width: cols[i] - 12, align: i ? 'right' : 'left', lineBreak: false }); cx += cols[i] })
      }
      d.rect(x0, y, W, h).lineWidth(0.5).strokeColor(LINE).stroke()
      d.y = y + h
    }
    row(['COMPONENT', 'MONTHLY (INR)', 'ANNUAL (INR)'], { head: true })
    for (const r of draft.annexure) {
      if (r.kind === 'head') row([r.label], { group: true })
      else if (r.kind === 'extra') row([r.label, '—', inrNum(r.annual)])
      else row([r.label, inrNum(r.monthly), inrNum(r.annual)], { bold: r.bold, shade: r.kind === 'total' || r.kind === 'net' })
    }
    d.moveDown(0.8)
    const note = draft.sections.find(x => x.key === 'annex_note')
    if (note) lines(note.body)
    const benefits = benefitsOf(f)
    if (benefits.length) {
      d.moveDown(0.4)
      d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Other benefits', x0, d.y); d.moveDown(0.3)
      benefits.forEach(([k, v]) => {
        ensure(22); const y = d.y
        d.font('Helvetica-Bold').fontSize(9.4).text(clean(k), x0 + 6, y + 5.5, { width: cols[0] - 12, lineBreak: false })
        d.font('Helvetica').text(clean(v), x0 + cols[0] + 6, y + 5.5, { width: W - cols[0] - 12, lineBreak: false })
        d.rect(x0, y, W, 19).lineWidth(0.5).strokeColor(LINE).stroke(); d.y = y + 19
      })
    }

    // ── Annexure B — leave policy summary
    d.addPage()
    d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Annexure B — Leave Policy Summary', x0, d.y, { width: W, align: 'center' })
    d.moveDown(0.9)
    const lc = [0.25, 0.10, 0.15, 0.15, 0.14, 0.21].map(p => W * p)
    const lrow = (cells: string[], hd = false) => {
      d.font(hd ? 'Helvetica-Bold' : 'Helvetica').fontSize(hd ? 8 : 8.6)
      const hts = cells.map((c, i) => d.heightOfString(clean(c), { width: lc[i] - 8 }))
      const h = Math.max(18, Math.max(...hts) + 9)
      ensure(h + 2); const y = d.y
      if (hd) d.rect(x0, y, W, h).fill(HEAD_BG)
      d.fillColor(INK)
      let cx = x0
      cells.forEach((c, i) => { d.text(clean(c), cx + 4, y + 4.5, { width: lc[i] - 8 }); cx += lc[i] })
      d.rect(x0, y, W, h).lineWidth(0.5).strokeColor(LINE).stroke()
      d.y = y + h
    }
    lrow(['LEAVE TYPE', 'DAYS / YEAR', 'CARRY FORWARD', 'ENCASHMENT', 'ACCRUAL', 'REMARKS'], true)
    for (const l of leaveRows(f)) lrow([l.type, l.days, l.carry, l.encash, l.accrual, l.remarks])
    d.moveDown(0.8)
    d.font('Helvetica').fontSize(8.8).fillColor(MUTED).text('Paid holidays as per the Holiday Calendar published annually. The detailed leave policy on the ESS portal prevails.', x0, d.y, { width: W }).fillColor(INK)

    // ── Annexure C — code of conduct summary
    const annexC = draft.sections.find(x => x.key === 'annex_c')
    if (annexC) {
      d.moveDown(2); ensure(200)
      d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(clean(annexC.heading || 'Annexure C — Code of Conduct (Summary)'), x0, d.y, { width: W, align: 'center' })
      d.moveDown(0.8)
      lines(annexC.body)
    }
    d.end()
  })

  const stamped = await stampOnLetterhead(content, lh, { title: `Letter of Appointment — ${f.name}`, author: companyName, label: (i, n) => `${f.ref_no ? `${f.ref_no} | ` : ''}${f.name}${f.emp_code ? ` (${f.emp_code})` : ''} - Letter of Appointment | Page ${i + 1} of ${n}` })
  // The captions at the foot of every page, in the room kept for them (drawn with pdf-lib:
  // pdfkit text below its bottom margin starts a new page). The employee initials every page.
  const out = await LibDoc.load(stamped)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.12, 0.11, 0.29), size = 9, right = 'Employee Initials: __________'
  for (const p of out.getPages()) {
    const y = lh.margins.bottom + 12
    p.drawText('Authorised Signatory', { x: lh.margins.left, y, size, font: bold, color: ink })
    p.drawText(right, { x: p.getWidth() - lh.margins.right - bold.widthOfTextAtSize(right, size), y, size, font: bold, color: ink })
  }
  const pdf = Buffer.from(await out.save())
  return { name: `${f.ref_no || `Appointment_Letter_${(f.emp_code || f.name).replace(/[^A-Za-z0-9]+/g, '_')}`}.pdf`, content: pdf }
}
