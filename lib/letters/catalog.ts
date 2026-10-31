// lib/letters/catalog.ts — pure. The twenty letters of People → Letters (EZER Letters & Documents
// spec v1.0): for each, the code used in its document ID, the fields it needs (most filled from
// the employee record by lib/letters/facts.ts; whatever the record lacks, HR types), whether it
// appears in the employee's ESS (spec §6), who signs it, and its wording built from the fields.
//
// A letter is built into blocks (paragraph, heading, bullets, key/value table, money table) that
// lib/letters/render-pdf.ts lays out on the company letterhead.

export type FieldType = 'text' | 'date' | 'money' | 'number' | 'textarea' | 'select'
export interface LetterField {
  key: string; label: string; type: FieldType
  /** Must be filled before the letter can be generated. */
  required?: boolean
  options?: string[]
  hint?: string
  /** Filled from the employee record when the record has it (lib/letters/facts.ts). */
  auto?: boolean
  /** Spans the full form width (long text). */
  wide?: boolean
}
export type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; text: string }
  | { t: 'bullets'; items: string[] }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'money'; title: string; rows: [string, number][]; total?: [string, number] }
export type Signer = 'company' | 'employee' | 'manager' | 'hr'
export interface LetterDoc {
  subject: string
  /** 'employee' opens "Dear <name>,"; 'concern' is a certificate ("To whom it may concern"). */
  to: 'employee' | 'concern'
  blocks: Block[]
  signers: Signer[]
}
export type Stage = 'Pre-joining' | 'Onboarding' | 'Employment' | 'Disciplinary' | 'Compensation' | 'Exit'
export interface LetterDef {
  code: string; name: string; stage: Stage
  /** Shown in the employee's ESS (spec §6). Warning, show cause, PIP and welcome letters are not. */
  ess: boolean
  /** One line on what it is for, shown in the picker. */
  about: string
  fields: LetterField[]
  build: (v: Values) => LetterDoc
}
export type Values = Record<string, string>

// ── formatting ──────────────────────────────────────────────────────────────
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function longDate(v?: string | null): string {
  const s = String(v || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(v || '')
  const [y, m, d] = s.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`
}
export const money = (v?: string | number | null): string => {
  const n = Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0)
  return `INR ${n.toLocaleString('en-IN')}`
}
const num = (v?: string | null) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0
const has = (v?: string | null) => !!String(v ?? '').trim()
/** "X years and Y months" between two dates (both inclusive of the start month). */
export function serviceText(from?: string | null, to?: string | null): string {
  const a = new Date(`${String(from || '').slice(0, 10)}T00:00:00Z`), b = new Date(`${String(to || '').slice(0, 10)}T00:00:00Z`)
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return ''
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) months -= 1
  const y = Math.floor(months / 12), m = months % 12
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'less than a month'
}
const pron = (v: Values) => /^(ms|mrs|miss)/i.test(v.salutation || '') ? { he: 'she', his: 'her', him: 'her' } : { he: 'he', his: 'his', him: 'him' }

// ── the fields every letter shares ─────────────────────────────────────────
const f = (key: string, label: string, type: FieldType = 'text', o: Partial<LetterField> = {}): LetterField => ({ key, label, type, ...o })
const A = (key: string, label: string, type: FieldType = 'text', o: Partial<LetterField> = {}) => f(key, label, type, { auto: true, required: true, ...o })
const ID = [A('salutation', 'Salutation', 'select', { options: ['Mr.', 'Ms.', 'Mrs.', 'Dr.'] }), A('name', 'Employee name'), A('emp_code', 'Employee code'), A('designation', 'Designation'), A('department', 'Department')]
const COMPANY = [A('company_name', 'Company')]
const DOJ = A('doj', 'Date of joining', 'date')
const LWD = A('lwd', 'Last working day', 'date')
const CONTINUED = 'All other terms and conditions of your employment remain unchanged.'
const CONFIDENTIAL = 'The contents of this letter are confidential and are not to be shared.'

// ── the twenty letters ──────────────────────────────────────────────────────
export const LETTERS: LetterDef[] = [
  // ── Pre-joining / onboarding ──
  { code: 'OFR', name: 'Offer Letter', stage: 'Pre-joining', ess: true, about: 'The offer of employment, with CTC and joining terms.',
    fields: [...ID, ...COMPANY, A('location', 'Location / branch'), A('reporting_manager', 'Reporting manager'), A('doj', 'Expected date of joining', 'date'), A('ctc_annual', 'Annual CTC', 'money'),
      A('probation_months', 'Probation (months)', 'number'), A('notice_days', 'Notice after confirmation (days)', 'number'), f('working_hours', 'Working hours', 'text', { required: true, hint: 'e.g. Monday to Friday, 9:30 to 18:30' }),
      f('offer_valid_till', 'Offer valid till', 'date', { required: true }), f('benefits', 'Benefits summary', 'textarea', { wide: true, hint: 'Medical insurance, PF, gratuity…' })],
    build: v => ({ subject: 'Offer of Employment', to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `We are pleased to offer you the position of ${v.designation} in the ${v.department} department of ${v.company_name}, on the terms below.` },
      { t: 'kv', rows: [['Designation', v.designation], ['Department', v.department], ['Location', v.location], ['Reporting to', v.reporting_manager], ['Expected date of joining', longDate(v.doj)], ['Annual CTC', money(v.ctc_annual)], ['Probation', `${v.probation_months} months`], ['Notice period', `30 days during probation, ${v.notice_days} days after confirmation`], ['Working hours', v.working_hours]] },
      ...(has(v.benefits) ? [{ t: 'h', text: 'Benefits' } as Block, { t: 'p', text: v.benefits } as Block] : []),
      { t: 'h', text: 'Conditions' },
      { t: 'bullets', items: ['This offer is subject to satisfactory background verification and medical fitness.', 'You will submit the documents listed by HR on or before your date of joining.', 'You will keep confidential all information about the company that you receive.'] },
      { t: 'p', text: `This offer is valid till ${longDate(v.offer_valid_till)}. Please sign and return a copy of this letter as your acceptance. A detailed appointment letter will be issued on joining.` },
    ] }) },
  { code: 'APT', name: 'Appointment Letter', stage: 'Onboarding', ess: true, about: 'The employment contract: role, CTC, probation, notice and conduct.',
    fields: [...ID, ...COMPANY, A('father_name', "Father's / spouse's name"), DOJ, A('grade', 'Grade / level'), A('reporting_manager', 'Reporting to'), A('location', 'Location / branch'),
      A('employment_type', 'Employment type'), A('ctc_annual', 'Annual CTC', 'money'), A('probation_months', 'Probation (months)', 'number'), A('notice_days', 'Notice after confirmation (days)', 'number'),
      f('working_hours', 'Working hours & days', 'text', { required: true, hint: 'e.g. Monday to Friday, 9:30 to 18:30' }), f('leave_policy', 'Leave entitlement', 'text', { required: true, hint: 'e.g. 18 EL, 7 CL, 7 SL a year' }), A('jurisdiction', 'Courts of jurisdiction')],
    build: v => ({ subject: 'Letter of Appointment', to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `With reference to your application and the interviews you had with us, we are pleased to appoint you on the following terms and conditions.` },
      { t: 'kv', rows: [['Employee code', v.emp_code], ["Father's / spouse's name", v.father_name], ['Designation', v.designation], ['Department', v.department], ['Grade', v.grade], ['Reporting to', v.reporting_manager], ['Location', v.location], ['Employment type', v.employment_type], ['Date of joining', longDate(v.doj)], ['Annual CTC', money(v.ctc_annual)]] },
      { t: 'h', text: 'Probation and confirmation' }, { t: 'p', text: `You will be on probation for ${v.probation_months} months from your date of joining. On satisfactory completion you will be confirmed in writing.` },
      { t: 'h', text: 'Notice period' }, { t: 'p', text: `Either party may end the employment with 30 days' notice during probation and ${v.notice_days} days' notice after confirmation, or salary in lieu of the notice not served.` },
      { t: 'h', text: 'Working hours and leave' }, { t: 'p', text: `${v.working_hours}. Leave: ${v.leave_policy}, as per the company's leave policy, along with the declared paid holidays.` },
      { t: 'h', text: 'Conduct, confidentiality and intellectual property' },
      { t: 'bullets', items: ['You will follow the company code of conduct and policies as amended from time to time.', 'You will not disclose confidential information of the company, its clients or employees, during or after your employment.', 'All work product created in the course of employment belongs to the company.', 'The company may end your employment without notice for misconduct, fraud or breach of these terms.', 'Grievances may be raised with your reporting manager or HR as per the grievance policy.'] },
      { t: 'p', text: `This appointment is governed by the laws of India and the courts at ${v.jurisdiction} shall have jurisdiction. Please sign the duplicate of this letter as your acceptance.` },
    ] }) },
  { code: 'NDA', name: 'Non-Disclosure Agreement', stage: 'Onboarding', ess: true, about: 'What is confidential, the employee’s obligations, duration and remedies.',
    fields: [...ID, ...COMPANY, f('effective_date', 'Effective date', 'date', { required: true, auto: true }), f('post_years', 'Years after employment it applies', 'number', { required: true }), A('jurisdiction', 'Courts of jurisdiction')],
    build: v => ({ subject: 'Non-Disclosure Agreement', to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `This agreement is made on ${longDate(v.effective_date)} between ${v.company_name} ("the Company") and ${v.name} (${v.emp_code}) ("the Employee").` },
      { t: 'h', text: '1. Confidential information' }, { t: 'p', text: 'Trade secrets, client and employee data, business plans, financial information, pricing, source code, algorithms and any information marked or understood to be confidential.' },
      { t: 'h', text: '2. Obligations' }, { t: 'bullets', items: ['Use confidential information only for the Company’s work.', 'Not disclose it to anyone without written authorisation.', 'Protect it with at least the care used for one’s own confidential information.'] },
      { t: 'h', text: '3. Permitted disclosure' }, { t: 'p', text: 'Disclosure required by law or a court order, after informing the Company where lawful.' },
      { t: 'h', text: '4. Return of materials' }, { t: 'p', text: 'On leaving, the Employee returns all documents, devices and copies containing confidential information.' },
      { t: 'h', text: '5. Duration and remedies' }, { t: 'p', text: `These obligations apply during employment and for ${v.post_years} years after it ends. A breach entitles the Company to damages and injunctive relief.` },
      { t: 'p', text: `This agreement is governed by the laws of India; the courts at ${v.jurisdiction} have jurisdiction.` },
    ] }) },
  { code: 'NCA', name: 'Non-Compete Agreement', stage: 'Onboarding', ess: true, about: 'Restricted activities, period and region after employment.',
    fields: [...ID, ...COMPANY, f('effective_date', 'Effective date', 'date', { required: true, auto: true }), f('restricted_months', 'Restricted period (months)', 'number', { required: true }), f('geography', 'Geographic scope', 'text', { required: true, hint: 'e.g. India' }), f('competitors', 'Competitors / industry', 'textarea', { required: true, wide: true })],
    build: v => ({ subject: 'Non-Compete Agreement', to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `This agreement, effective ${longDate(v.effective_date)}, is between ${v.company_name} and ${v.name} (${v.emp_code}).` },
      { t: 'h', text: 'Restricted activities' }, { t: 'p', text: `For ${v.restricted_months} months after leaving, within ${v.geography}, the Employee will not join, advise or start a business that competes with the Company, namely: ${v.competitors}.` },
      { t: 'h', text: 'Non-solicitation' }, { t: 'p', text: 'For the same period the Employee will not solicit the Company’s clients or employees.' },
      { t: 'h', text: 'Exceptions and severability' }, { t: 'p', text: 'Passive investments and roles in unrelated industries are not restricted. If any clause is held unenforceable, the rest remain in force.' },
      { t: 'p', text: 'Governed by the Indian Contract Act, 1872. The Employee acknowledges that post-employment restraints may be limited by Section 27 of that Act.' },
    ] }) },
  { code: 'WEL', name: 'Welcome Letter', stage: 'Pre-joining', ess: false, about: 'A warm welcome with first-day details (email only, not in ESS).',
    fields: [A('salutation', 'Salutation', 'select', { options: ['Mr.', 'Ms.', 'Mrs.', 'Dr.'] }), A('name', 'Employee name'), ...COMPANY, DOJ, f('reporting_time', 'Reporting time', 'text', { required: true, hint: 'e.g. 9:30 AM' }), A('office_address', 'Office address', 'textarea', { wide: true }),
      f('contact_person', 'First-day contact (name & phone)', 'text', { required: true }), f('bring', 'What to bring', 'textarea', { wide: true, hint: 'Original documents, photographs, bank details' }), f('buddy', 'Buddy / mentor', 'text')],
    build: v => ({ subject: `Welcome to ${v.company_name}`, to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `We are delighted that you are joining ${v.company_name}, and we look forward to seeing you on ${longDate(v.doj)}.` },
      { t: 'kv', rows: [['Reporting time', v.reporting_time], ['Office address', v.office_address], ['Your first-day contact', v.contact_person], ...(has(v.buddy) ? [['Your buddy', v.buddy] as [string, string]] : [])] },
      ...(has(v.bring) ? [{ t: 'h', text: 'Please bring' } as Block, { t: 'p', text: v.bring } as Block] : []),
      { t: 'p', text: 'Your first day includes a meeting with HR, your system setup and an introduction to your team. Welcome aboard!' },
    ] }) },

  // ── Employment lifecycle ──
  { code: 'CNF', name: 'Confirmation Letter', stage: 'Employment', ess: true, about: 'Confirms the employee after probation.',
    fields: [...ID, ...COMPANY, DOJ, A('probation_months', 'Probation served (months)', 'number'), A('confirmation_date', 'Confirmation date', 'date'), A('notice_days', 'Notice after confirmation (days)', 'number'), f('revised_ctc', 'Revised annual CTC (if any)', 'money')],
    build: v => ({ subject: 'Confirmation of Employment', to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `We are pleased to inform you that, on successful completion of your probation of ${v.probation_months} months, you are confirmed as ${v.designation} in the ${v.department} department with effect from ${longDate(v.confirmation_date)}.` },
      ...(num(v.revised_ctc) > 0 ? [{ t: 'p', text: `Your annual CTC is revised to ${money(v.revised_ctc)} with effect from the same date.` } as Block] : []),
      { t: 'p', text: `Your notice period from now on is ${v.notice_days} days. ${CONTINUED}` },
      { t: 'p', text: 'Congratulations, and thank you for your contribution so far.' },
    ] }) },
  { code: 'INC', name: 'Increment Letter', stage: 'Compensation', ess: true, about: 'Salary revision after appraisal.',
    fields: [...ID, ...COMPANY, f('effective_date', 'Effective date', 'date', { required: true }), A('previous_ctc', 'Previous annual CTC', 'money'), f('revised_ctc', 'Revised annual CTC', 'money', { required: true }), f('rating', 'Performance rating / FY', 'text', { hint: 'e.g. 4 / 5 for FY 2025-26' })],
    build: v => { const inc = num(v.revised_ctc) - num(v.previous_ctc); const pct = num(v.previous_ctc) ? Math.round((inc / num(v.previous_ctc)) * 1000) / 10 : 0
      return { subject: 'Revision of Compensation', to: 'employee', signers: ['company'], blocks: [
        { t: 'p', text: `In recognition of your performance${has(v.rating) ? ` (rating ${v.rating})` : ''}, we are pleased to revise your compensation with effect from ${longDate(v.effective_date)}.` },
        { t: 'kv', rows: [['Previous annual CTC', money(v.previous_ctc)], ['Revised annual CTC', money(v.revised_ctc)], ['Increment', `${money(inc)} (${pct}%)`]] },
        { t: 'p', text: `${CONTINUED} ${CONFIDENTIAL}` }, { t: 'p', text: 'We appreciate your efforts and look forward to your continued contribution.' },
      ] } } },
  { code: 'PRM', name: 'Promotion Letter', stage: 'Employment', ess: true, about: 'New designation, grade and compensation.',
    fields: [...ID, ...COMPANY, A('grade', 'Current grade'), f('new_designation', 'New designation', 'text', { required: true }), f('new_grade', 'New grade', 'text'), f('new_department', 'New department (if changing)', 'text'),
      f('effective_date', 'Effective date', 'date', { required: true }), A('previous_ctc', 'Previous annual CTC', 'money'), f('revised_ctc', 'Revised annual CTC', 'money', { required: true }), f('responsibilities', 'New responsibilities', 'textarea', { wide: true })],
    build: v => { const inc = num(v.revised_ctc) - num(v.previous_ctc)
      return { subject: 'Promotion', to: 'employee', signers: ['company'], blocks: [
        { t: 'p', text: `We are pleased to promote you from ${v.designation} to ${v.new_designation}${has(v.new_department) ? ` in the ${v.new_department} department` : ''} with effect from ${longDate(v.effective_date)}.` },
        { t: 'kv', rows: [['Previous designation', v.designation], ['New designation', v.new_designation], ['Previous grade', v.grade || '-'], ['New grade', v.new_grade || v.grade || '-'], ['Previous annual CTC', money(v.previous_ctc)], ['Revised annual CTC', money(v.revised_ctc)], ['Increase', money(inc)]] },
        ...(has(v.responsibilities) ? [{ t: 'h', text: 'Your new responsibilities' } as Block, { t: 'p', text: v.responsibilities } as Block] : []),
        { t: 'p', text: `${CONTINUED} Congratulations on this well-deserved recognition.` },
      ] } } },
  { code: 'TRF', name: 'Transfer Letter', stage: 'Employment', ess: true, about: 'Move to another location / department.',
    fields: [...ID, ...COMPANY, A('location', 'Current location'), f('new_location', 'New location', 'text', { required: true }), f('new_department', 'New department (if changing)', 'text'), f('effective_date', 'Effective date', 'date', { required: true }),
      f('reporting_date', 'Report at new location on', 'date', { required: true }), f('new_manager', 'New reporting manager', 'text'), f('reason', 'Reason for transfer', 'text', { required: true, hint: 'Business requirement / employee request' }), f('relocation', 'Relocation support / allowance', 'textarea', { wide: true })],
    build: v => ({ subject: 'Transfer', to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `Due to ${v.reason.toLowerCase()}, you are transferred from ${v.location} to ${v.new_location} with effect from ${longDate(v.effective_date)}.` },
      { t: 'kv', rows: [['From', `${v.location} · ${v.department}`], ['To', `${v.new_location} · ${v.new_department || v.department}`], ['Report on', longDate(v.reporting_date)], ...(has(v.new_manager) ? [['New reporting manager', v.new_manager] as [string, string]] : [])] },
      ...(has(v.relocation) ? [{ t: 'h', text: 'Relocation' } as Block, { t: 'p', text: v.relocation } as Block] : []),
      { t: 'p', text: `Please complete the handover of your current responsibilities before the effective date. ${CONTINUED}` },
    ] }) },
  { code: 'WRN', name: 'Warning Letter', stage: 'Disciplinary', ess: false, about: 'A written warning for misconduct (HR record, not in ESS).',
    fields: [...ID, ...COMPANY, f('warning_type', 'Warning type', 'select', { required: true, options: ['First Written Warning', 'Second Warning', 'Final Warning'] }), f('incident_date', 'Date of incident', 'date', { required: true }),
      f('description', 'What happened', 'textarea', { required: true, wide: true }), f('policy', 'Policy violated', 'text', { required: true }), f('expected', 'Expected behaviour', 'textarea', { required: true, wide: true }), f('deadline', 'Improve by', 'date')],
    build: v => ({ subject: v.warning_type, to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `This is a ${v.warning_type.toLowerCase()} regarding the incident on ${longDate(v.incident_date)}.` },
      { t: 'h', text: 'The issue' }, { t: 'p', text: v.description }, { t: 'p', text: `This is in violation of: ${v.policy}.` },
      { t: 'h', text: 'What is expected' }, { t: 'p', text: `${v.expected}${has(v.deadline) ? ` Improvement is expected by ${longDate(v.deadline)}.` : ''}` },
      { t: 'p', text: 'A repetition may lead to further disciplinary action, including termination. You may give a written explanation to HR within 7 days of this letter.' },
      { t: 'p', text: 'Please sign below to acknowledge that you have received and understood this warning.' },
    ] }) },
  { code: 'SCN', name: 'Show Cause Notice', stage: 'Disciplinary', ess: false, about: 'Asks the employee to explain an allegation (HR record, not in ESS).',
    fields: [...ID, ...COMPANY, f('issue', 'Issue (subject)', 'text', { required: true }), f('allegation', 'Allegation details', 'textarea', { required: true, wide: true }), f('evidence', 'Based on', 'text', { hint: 'Investigation dated… / reported by…' }),
      f('policy', 'Policy / rule violated', 'text', { required: true }), f('reply_days', 'Reply within (working days)', 'number', { required: true }), f('suspended', 'Suspended pending inquiry', 'select', { options: ['No', 'Yes'] })],
    build: v => ({ subject: `Show Cause Notice: ${v.issue}`, to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `It has been brought to our notice that ${v.allegation}${has(v.evidence) ? ` This is based on ${v.evidence}.` : ''}` },
      { t: 'p', text: `This is a violation of ${v.policy}. You are hereby required to show cause why disciplinary action should not be taken against you.` },
      { t: 'p', text: `Submit your written explanation within ${v.reply_days} working days of receiving this notice. You may ask for a personal hearing and may be accompanied by a colleague. Failure to respond will be treated as acceptance of the charges.` },
      ...(v.suspended === 'Yes' ? [{ t: 'p', text: 'You are suspended pending inquiry with immediate effect.' } as Block] : []),
      { t: 'p', text: 'Acknowledged receipt on: ____________' },
    ] }) },
  { code: 'PIP', name: 'PIP Letter', stage: 'Employment', ess: false, about: 'Performance Improvement Plan with goals and reviews (not downloadable in ESS).',
    fields: [...ID, ...COMPANY, f('start_date', 'PIP start date', 'date', { required: true }), f('duration_days', 'Duration (days)', 'select', { required: true, options: ['30', '60', '90'] }), f('reason', 'Reason for PIP', 'textarea', { required: true, wide: true }),
      f('goals', 'Goals (one per line: goal — metric — target)', 'textarea', { required: true, wide: true }), f('support', 'Support provided', 'textarea', { wide: true }), f('reviews', 'Review checkpoints', 'text', { required: true, hint: 'e.g. Weekly, every Friday' })],
    build: v => { const end = (() => { const d = new Date(`${v.start_date}T00:00:00Z`); if (isNaN(d.getTime())) return ''; d.setUTCDate(d.getUTCDate() + num(v.duration_days)); return d.toISOString().slice(0, 10) })()
      return { subject: 'Performance Improvement Plan', to: 'employee', signers: ['employee', 'manager', 'hr'], blocks: [
        { t: 'p', text: `This Performance Improvement Plan runs for ${v.duration_days} days, from ${longDate(v.start_date)} to ${longDate(end)}.` },
        { t: 'h', text: 'Why' }, { t: 'p', text: v.reason },
        { t: 'h', text: 'Goals' }, { t: 'bullets', items: v.goals.split('\n').map(s => s.trim()).filter(Boolean) },
        ...(has(v.support) ? [{ t: 'h', text: 'Support' } as Block, { t: 'p', text: v.support } as Block] : []),
        { t: 'p', text: `Progress will be reviewed ${v.reviews.toLowerCase()} with your manager. Meeting the goals returns you to the normal performance track; not meeting them may lead to further action, including termination.` },
        { t: 'p', text: 'I understand the expectations set out above and commit to improving.' },
      ] } } },
  { code: 'BNS', name: 'Bonus / Incentive Letter', stage: 'Compensation', ess: true, about: 'Bonus amount, tax and payment.',
    fields: [...ID, ...COMPANY, f('bonus_type', 'Bonus type', 'text', { required: true, hint: 'Performance / festival / incentive' }), f('period', 'For the period', 'text', { required: true }), f('amount', 'Gross bonus', 'money', { required: true }),
      f('tds', 'TDS', 'money'), f('payment_date', 'Payment date', 'date', { required: true }), f('clawback', 'Clawback clause', 'text')],
    build: v => ({ subject: `${v.bonus_type} Bonus`, to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `We are pleased to award you a ${v.bonus_type.toLowerCase()} bonus for ${v.period}.` },
      { t: 'money', title: 'Bonus', rows: [['Gross bonus', num(v.amount)], ['Less: TDS', -num(v.tds)]], total: ['Net payable', num(v.amount) - num(v.tds)] },
      { t: 'p', text: `It will be paid on ${longDate(v.payment_date)}.${has(v.clawback) ? ` ${v.clawback}` : ''} ${CONFIDENTIAL}` },
      { t: 'p', text: 'Congratulations, and thank you for your contribution.' },
    ] }) },
  { code: 'DEP', name: 'Deputation Letter', stage: 'Employment', ess: true, about: 'Deputation to a client / group company / location.',
    fields: [...ID, ...COMPANY, f('deputed_to', 'Deputed to', 'text', { required: true }), f('address', 'Address to report at', 'textarea', { required: true, wide: true }), f('start_date', 'Start date', 'date', { required: true }), f('end_date', 'End date', 'date'),
      f('reporting_to', 'Reporting to at deputation', 'text'), f('allowance', 'Deputation allowance', 'money'), f('terms', 'Travel, stay and statutory cover', 'textarea', { wide: true })],
    build: v => ({ subject: 'Deputation', to: 'employee', signers: ['company', 'employee'], blocks: [
      { t: 'p', text: `You are deputed to ${v.deputed_to} from ${longDate(v.start_date)}${has(v.end_date) ? ` to ${longDate(v.end_date)}` : ''}, subject to extension or recall.` },
      { t: 'kv', rows: [['Report at', v.address], ...(has(v.reporting_to) ? [['Functional reporting', v.reporting_to] as [string, string]] : []), ['Administrative reporting', `${v.company_name} HR`], ...(num(v.allowance) ? [['Deputation allowance', money(v.allowance)] as [string, string]] : [])] },
      ...(has(v.terms) ? [{ t: 'p', text: v.terms } as Block] : []),
      { t: 'p', text: `Your salary and benefits continue to be paid by ${v.company_name}. The company may recall you at any time with reasonable notice. ${CONTINUED}` },
    ] }) },

  // ── Exit ──
  { code: 'RAL', name: 'Resignation Acceptance Letter', stage: 'Exit', ess: true, about: 'Accepts the resignation and confirms the last working day.',
    fields: [...ID, ...COMPANY, A('resignation_date', 'Resignation date', 'date'), LWD, A('notice_days', 'Notice period (days)', 'number'), f('buyout', 'Notice buyout amount', 'money')],
    build: v => ({ subject: 'Acceptance of Resignation', to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `With reference to your resignation dated ${longDate(v.resignation_date)}, we accept it. Your last working day with ${v.company_name} will be ${longDate(v.lwd)}.` },
      ...(num(v.buyout) ? [{ t: 'p', text: `The notice period not served will be adjusted as a buyout of ${money(v.buyout)}.` } as Block] : []),
      { t: 'bullets', items: ['Complete the handover of your work before your last working day.', 'Submit pending reimbursements and investment proofs before LWD - 7.', 'Department clearance starts 7 days before your last working day; return all company property.', 'An exit interview will be scheduled.', 'Your Full & Final settlement will be processed within 30 days of your last working day.'] },
      { t: 'p', text: 'We thank you for your contribution and wish you the very best.' },
    ] }) },
  { code: 'TRM', name: 'Termination Letter', stage: 'Exit', ess: true, about: 'Ends the employment, with reasons and settlement terms.',
    fields: [...ID, ...COMPANY, f('termination_type', 'Termination type', 'select', { required: true, options: ['Termination for Cause', 'Termination for Performance', 'Abscond', 'Fraud / Misconduct'] }), f('reason', 'Reason (with references to warnings, PIP, show cause)', 'textarea', { required: true, wide: true }),
      LWD, f('policy', 'Policy violated', 'text'), f('appeal_to', 'Appeal to', 'text', { auto: true, hint: 'HR Head / MD' }), f('rehire', 'Eligible for rehire', 'select', { options: ['Yes', 'No'] })],
    build: v => ({ subject: 'Termination of Employment', to: 'employee', signers: ['company'], blocks: [
      { t: 'p', text: `This is to inform you that your employment with ${v.company_name} is terminated (${v.termination_type.toLowerCase()}) with effect from ${longDate(v.lwd)}.` },
      { t: 'h', text: 'Reason' }, { t: 'p', text: `${v.reason}${has(v.policy) ? ` This is in violation of ${v.policy}.` : ''}` },
      { t: 'bullets', items: ['Return all company property within 3 days.', 'Your Full & Final settlement will be processed subject to clearance and company policy; gratuity may be withheld in cases of misconduct (Section 4(6), Payment of Gratuity Act).', 'Your confidentiality and other post-employment obligations continue.', ...(has(v.appeal_to) ? [`You may appeal this decision to the ${v.appeal_to} within 15 days.`] : []), ...(v.rehire === 'No' ? ['You are not eligible for rehire.'] : [])] },
    ] }) },
  { code: 'REL', name: 'Relieving Letter', stage: 'Exit', ess: true, about: 'Certifies the employee is relieved and dues are settled.',
    fields: [...ID, ...COMPANY, DOJ, LWD, f('relieving_date', 'Relieving date', 'date', { required: true, auto: true })],
    build: v => { const p = pron(v)
      return { subject: 'Relieving Letter', to: 'concern', signers: ['company'], blocks: [
        { t: 'p', text: `This is to certify that ${v.salutation} ${v.name} (Employee Code ${v.emp_code}) worked with ${v.company_name} as ${v.designation} in the ${v.department} department from ${longDate(v.doj)} to ${longDate(v.lwd)}.` },
        { t: 'p', text: `${p.he[0].toUpperCase() + p.he.slice(1)} has been relieved from the services of the company with effect from ${longDate(v.relieving_date)}. All dues have been settled.` },
        { t: 'p', text: `We wish ${p.him} all the best in ${p.his} future endeavours.` },
      ] } } },
  { code: 'EXP', name: 'Experience Letter', stage: 'Exit', ess: true, about: 'Service certificate with tenure and conduct.',
    fields: [...ID, ...COMPANY, DOJ, LWD, f('responsibilities', 'Key responsibilities', 'textarea', { wide: true })],
    build: v => { const p = pron(v)
      return { subject: 'Experience Certificate', to: 'concern', signers: ['company'], blocks: [
        { t: 'p', text: `This is to certify that ${v.salutation} ${v.name} (Employee Code ${v.emp_code}) was employed with ${v.company_name} from ${longDate(v.doj)} to ${longDate(v.lwd)}, a total service of ${serviceText(v.doj, v.lwd)}.` },
        { t: 'p', text: `At the time of leaving, ${p.he} held the position of ${v.designation} in the ${v.department} department.${has(v.responsibilities) ? ` ${p.his[0].toUpperCase() + p.his.slice(1)} responsibilities included ${v.responsibilities.replace(/[.\s]+$/, '')}.` : ''}` },
        { t: 'p', text: `During ${p.his} tenure ${p.he} performed ${p.his} duties to our satisfaction, and ${p.his} conduct was found to be good. We wish ${p.him} success in the future.` },
      ] } } },
  { code: 'FNF', name: 'F&F Settlement Statement', stage: 'Exit', ess: true, about: 'Earnings, deductions and net payable at exit.',
    fields: [...ID, ...COMPANY, DOJ, LWD, f('exit_reason', 'Exit reason', 'text', { required: true, auto: true }), f('earnings', 'Earnings (one per line: label = amount)', 'textarea', { required: true, auto: true, wide: true }),
      f('deductions', 'Deductions (one per line: label = amount)', 'textarea', { auto: true, wide: true }), f('payment_date', 'Payment date', 'date'), A('bank', 'Paid to (bank account)')],
    build: v => { const lines = (s: string) => s.split('\n').map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim()).map(([l, a]) => [l.trim(), num(a)] as [string, number])
      const e = lines(v.earnings || ''), d = lines(v.deductions || ''), te = e.reduce((s, x) => s + x[1], 0), td = d.reduce((s, x) => s + x[1], 0)
      return { subject: 'Full & Final Settlement Statement', to: 'employee', signers: ['hr', 'company', 'employee'], blocks: [
        { t: 'kv', rows: [['Date of joining', longDate(v.doj)], ['Last working day', longDate(v.lwd)], ['Exit reason', v.exit_reason]] },
        { t: 'money', title: 'Earnings', rows: e, total: ['Total earnings', te] },
        { t: 'money', title: 'Deductions', rows: d, total: ['Total deductions', td] },
        { t: 'kv', rows: [['Net payable', money(te - td)], ['Paid to', v.bank || '-'], ...(has(v.payment_date) ? [['Payment date', longDate(v.payment_date)] as [string, string]] : [])] },
        { t: 'p', text: 'I accept the above as the full and final settlement of my dues.' },
      ] } } },
  { code: 'PFC', name: 'PF Claim Guidance', stage: 'Exit', ess: true, about: 'How to withdraw or transfer PF after leaving.',
    fields: [...ID, ...COMPANY, DOJ, LWD, A('uan', 'UAN'), A('pf_number', 'PF member ID', 'text', { required: false }), A('bank', 'Bank for the claim', 'text', { required: false })],
    build: v => { const short = (() => { const s = serviceText(v.doj, v.lwd); return /year/.test(s) ? Number(s.split(' ')[0]) < 5 : true })()
      return { subject: 'Provident Fund: How to Claim', to: 'employee', signers: [], blocks: [
        { t: 'kv', rows: [['UAN', v.uan], ['PF member ID', v.pf_number || '-'], ['Service', `${longDate(v.doj)} to ${longDate(v.lwd)}`], ['Bank linked for the claim', v.bank || 'Update it on the EPFO portal']] },
        { t: 'h', text: 'Form 19: final PF settlement' }, { t: 'p', text: 'If you are not joining another EPF-covered employer, claim your PF two months after leaving: EPFO Member e-SEWA portal → Online Services → Claim (Form-31, 19, 10C & 10D).' },
        { t: 'h', text: 'Form 10C: pension withdrawal' }, { t: 'p', text: 'With under 10 years of pensionable service you may withdraw the pension contribution; otherwise ask for a Scheme Certificate.' },
        { t: 'h', text: 'Joining a new employer' }, { t: 'p', text: 'Give your UAN to the new employer and transfer your balance through One Member – One EPF Account (Form 13) instead of withdrawing.' },
        ...(short ? [{ t: 'p', text: 'Your service is under 5 years, so TDS applies to a withdrawal.' } as Block] : []),
        { t: 'p', text: 'Before claiming, make sure your UAN is activated and linked to Aadhaar, PAN and your bank (KYC approved). Claims usually settle in 20 to 30 days. Portal: https://unifiedportal-mem.epfindia.gov.in · EPFO helpline 1800 118 005.' },
      ] } } },
]

export const LETTER_BY_CODE: Record<string, LetterDef> = Object.fromEntries(LETTERS.map(l => [l.code, l]))
export const STAGE_ORDER: Stage[] = ['Pre-joining', 'Onboarding', 'Employment', 'Compensation', 'Disciplinary', 'Exit']

/** Required fields still blank, by label. */
export function missingFields(def: LetterDef, v: Values): string[] {
  return def.fields.filter(x => x.required && !has(v[x.key])).map(x => x.label)
}

/** The document ID (spec §7): {Code}-{CompanyCode}-{EmpCode}-{YYYYMMDD}-{Seq}. */
export function docIdFor(code: string, companyCode: string, empCode: string, date: string, seq: number): string {
  const clean = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${code}-${clean(companyCode) || 'CO'}-${clean(empCode) || 'EMP'}-${String(date).slice(0, 10).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
}
