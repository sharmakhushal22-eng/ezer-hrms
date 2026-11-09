// lib/onboarding/appointment-letter.ts — the Letter of Appointment (the employment contract) a
// joiner gets once their employee code is generated (People → Letters → Pending letters, or
// Issue a letter → Appointment Letter).
//
// The content follows the EZER Appointment Letter spec (Downloads/EZER-APPOINTMENT-LETTER-SPEC.md):
// header (reference number, date, Private & Confidential, CIN), the addressee with their
// father's name and permanent address, then twenty numbered sections — appointment, position &
// reporting, probation, compensation, working hours, leave, notice & termination, code of
// conduct, confidentiality, non-compete, IP, statutory benefits, policies, grievance, BGV,
// medical fitness, governing law — the acceptance & signatures, and three annexures:
//   A  the salary structure exactly as the recruitment negotiation shows it (the candidate's
//      salary statement, with the HR Head's revision when there is one) — `annexureFrom`
//   B  the leave policy summary — `leaveRows`
//   C  the code of conduct summary — a section
// The company's own clauses (transfer, joining bonus recovery, training cost recovery, notice
// buyout, events of breach) are kept inside the matching sections.
//
// Pure, shared by the popup and the server: the facts (`ApptFields`, loaded in
// appointment-letter-server.ts) and the sections built from them (`buildSections`). The HR
// Manager may edit any field, section or annexure row in the popup before sending; the PDF is
// drawn from exactly what was sent.
//
// Section bodies are plain text: a line starting "• " is a bullet, "- " a sub-bullet, any other
// line a paragraph.

import type { StmtRow } from '@/lib/recruitment/ctc-statement'

export interface ApptFields {
  // ── the letter
  letter_date: string         // YYYY-MM-DD
  ref_no: string              // the document ID; set when the letter is sent
  // ── the employee
  salutation: string          // Mr. / Ms.
  name: string
  emp_code: string
  relation: string            // S/o · D/o · W/o
  father_name: string
  perm_address: string
  // ── the company
  company_name: string
  company_address: string
  cin: string
  // ── position & reporting
  designation: string
  department: string          // the "function"
  grade: string
  employment_type: string
  reporting_manager: string
  functional_manager: string
  doj: string                 // YYYY-MM-DD
  place: string               // place of posting
  // ── compensation
  ctc_annual: number
  /** Joining bonus: the total and its two instalments (first salary, after 6 months). */
  jb_total: number
  jb_first: number
  jb_second: number
  retention_bonus: number
  esop_value: number
  esop_vesting: string
  esi_applicable: boolean
  medical: string
  gratuity_annual: number
  /** True when the CTC structure carries gratuity inside the package. */
  gratuity_in_ctc: boolean
  // ── probation & notice
  probation_months: number
  probation_extension_months: number
  probation_notice_days: number
  notice_days: number
  fnf_days: number
  // ── working hours
  working_days: string
  working_hours: string
  effective_hours: string
  overtime: string
  // ── leave (Annexure B)
  el_days: number
  el_carry_max: number
  cl_days: number
  sl_days: number
  maternity_weeks: number
  paternity_days: number
  bereavement_days: string
  marriage_days: number
  // ── restrictive covenants & conduct
  confidentiality_years: number
  non_compete_months: number
  non_solicit_months: number
  non_compete_region: string
  gift_limit: number
  bgv_days: number
  // ── law & signatures
  jurisdiction: string        // "Gurugram, Haryana"
  signatory_name: string
  signatory_designation: string
  witness_name: string
  witness_designation: string
}

export interface ApptSection { key: string; heading: string; body: string; inline?: boolean }
/** A line of Annexure A. `kind` 'head' is a group heading (EARNINGS, …); 'extra' a payment
 *  outside the CTC (joining bonus, ESOP). */
export interface AnnexRow { label: string; monthly: number; annual: number; bold?: boolean; kind?: 'row' | 'head' | 'sum' | 'total' | 'ded' | 'net' | 'extra' }
export interface ApptDraft { fields: ApptFields; sections: ApptSection[]; annexure: AnnexRow[] }
export interface LeaveRow { type: string; days: string; carry: string; encash: string; accrual: string; remarks: string }

/** "3,00,000" — Indian grouping, no symbol (the letter writes INR in front). */
export const inrNum = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-IN')
export const longDate = (d: string | null | undefined) => {
  if (!d) return '________'
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`)
  return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const blank = (s: string | null | undefined) => (s && String(s).trim()) || '________'
const has = (s: string | null | undefined) => !!(s && String(s).trim())

export const salutationFor = (gender: string | null | undefined) => /^f/i.test(String(gender || '')) ? 'Ms.' : 'Mr.'
export const relationFor = (gender: string | null | undefined) => /^f/i.test(String(gender || '')) ? 'D/o' : 'S/o'

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const two = (n: number) => n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
const three = (n: number) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${n % 100 ? two(n % 100) : ''}`
/** 1200000 → "Rupees Twelve Lakh Only" (Indian system: crore, lakh, thousand). */
export function inrWords(amount: number): string {
  let n = Math.round(Math.abs(Number(amount) || 0))
  if (!n) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`)
  if (lakh) parts.push(`${two(lakh)} Lakh`)
  if (thousand) parts.push(`${two(thousand)} Thousand`)
  if (n) parts.push(three(n))
  return `Rupees ${parts.join(' ')} Only`
}

/** The joining bonus as instalments, from the offer's frequency: "After 6 Months" pays it all
 *  after six months, instalments / split pays two halves (the company's usual terms), anything
 *  else ("With Salary") with the first salary. */
export function splitJoiningBonus(total: number, freq: string | null | undefined): { first: number; second: number } {
  const t = Math.max(0, Math.round(Number(total) || 0))
  const q = String(freq || '')
  if (!t) return { first: 0, second: 0 }
  if (/instal|split|half|two/i.test(q)) { const first = Math.round(t / 2); return { first, second: t - first } }
  if (/after\s*(6|six)|(6|six)\s*months?/i.test(q)) return { first: 0, second: t }
  return { first: t, second: 0 }
}

/** Fields the letter cannot go out without. */
export function apptProblems(f: ApptFields): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('the name')
  if (!f.designation.trim()) out.push('the designation')
  if (!f.department.trim()) out.push('the function / department')
  if (!f.doj) out.push('the date of joining')
  if (!f.place.trim()) out.push('the place of posting')
  if (!(f.ctc_annual > 0)) out.push('the annual CTC')
  if (!f.company_name.trim()) out.push('the company')
  if (!f.emp_code.trim()) out.push('the employee code')
  if (f.jb_total > 0 && Math.round(f.jb_first + f.jb_second) !== Math.round(f.jb_total)) out.push('joining bonus instalments that add up to the total')
  return out
}

/** Details the letter reads better with but can go without (the line is then left out). */
export function apptWarnings(f: ApptFields): string[] {
  const out: string[] = []
  if (!has(f.father_name)) out.push("the father's / husband's name")
  if (!has(f.perm_address)) out.push('the permanent address')
  if (!has(f.reporting_manager)) out.push('the reporting manager')
  if (!has(f.grade)) out.push('the grade / band')
  return out
}

const r0 = (n: any) => Math.round(Number(n) || 0)

/** Annexure A from the salary statement — the recruitment negotiation's own lines, in its order
 *  (lib/recruitment/ctc-statement: the candidate's statement, or the recruiter's / stipend one
 *  when that is all there is): earnings, employer contributions, the fixed CTC, the variable,
 *  the total, then the employee's deductions and net in-hand, and the one-time payments outside
 *  the CTC. Notes are left out. */
export function annexureFrom(rows: StmtRow[], extras: [string, number][] = []): { annexure: AnnexRow[]; gratuityAnnual: number; gratuityInCtc: boolean } {
  const out: AnnexRow[] = []
  let gratuityAnnual = 0, gratuityInCtc = false
  let group = ''
  const head = (label: string) => { if (group !== label) { out.push({ label, monthly: 0, annual: 0, kind: 'head', bold: true }); group = label } }
  let afterTotal = false
  for (const row of rows) {
    const monthly = r0(row.monthly ?? (Number(row.annual) || 0) / 12)
    const annual = r0(row.annual ?? (Number(row.monthly) || 0) * 12)
    if (row.kind === 'note') continue
    if (row.kind === 'head') { afterTotal = true; head(/deduct/i.test(row.label) ? 'EMPLOYEE DEDUCTIONS & NET IN-HAND' : row.label.toUpperCase()); continue }
    if (afterTotal) {
      if (row.kind === 'sum') continue                              // the gross again, above the deductions
      if (row.kind === 'ded' && !monthly && !annual) continue
      out.push({ label: row.label.replace(/^\(−\)\s*/, 'Less: '), monthly, annual, kind: row.kind === 'net' ? 'net' : 'ded', bold: row.kind === 'net' })
      continue
    }
    if (row.kind === 'row' || (row.kind === 'bonus' && !/overhead/i.test(row.label))) {
      head('EARNINGS')
      out.push({ label: row.label.replace(/\s*\(advance, with salary\)/i, ''), monthly, annual, kind: 'row' })
    } else if (row.kind === 'emp' || row.kind === 'grat' || row.kind === 'bonus') {
      if (row.kind === 'grat') { gratuityAnnual = annual; gratuityInCtc = true }
      if (!monthly && !annual) continue
      head('EMPLOYER CONTRIBUTIONS')
      out.push({ label: row.label, monthly, annual, kind: 'row' })
    } else if (row.kind === 'sum') {
      out.push({ label: /gross/i.test(row.label) ? 'Gross Earnings (A)' : /fixed/i.test(row.label) ? 'Fixed CTC (B)' : row.label, monthly, annual, kind: 'sum', bold: true })
    } else if (row.kind === 'muted') {
      if (!monthly && !annual) continue
      head('PERFORMANCE LINKED')
      out.push({ label: /variable|performance/i.test(row.label) ? 'Variable / Performance Pay' : row.label, monthly, annual, kind: 'row' })
    } else if (row.kind === 'total') {
      group = ''
      out.push({ label: /annual|ctc/i.test(row.label) ? 'TOTAL CTC' : row.label, monthly, annual, kind: 'total', bold: true })
    } else if (row.kind === 'ded' || row.kind === 'net') {
      head('DEDUCTIONS & NET PAYABLE')
      out.push({ label: row.label.replace(/^\(−\)\s*/, 'Less: '), monthly, annual, kind: row.kind, bold: row.kind === 'net' })
    }
  }
  const paid = extras.filter(([, v]) => r0(v) > 0)
  if (paid.length) {
    out.push({ label: 'ONE-TIME PAYMENTS (OUTSIDE THE CTC)', monthly: 0, annual: 0, kind: 'head', bold: true })
    for (const [label, v] of paid) out.push({ label, monthly: 0, annual: r0(v), kind: 'extra' })
  }
  return { annexure: out, gratuityAnnual, gratuityInCtc }
}

/** Annexure B — the leave policy summary, from the leave fields. */
export function leaveRows(f: ApptFields): LeaveRow[] {
  return [
    { type: 'Earned / Privilege Leave (EL)', days: String(f.el_days), carry: f.el_carry_max ? `Max ${f.el_carry_max} days` : 'No', encash: 'Yes (on exit)', accrual: `Monthly (${Math.round(f.el_days / 12 * 100) / 100}/month)`, remarks: 'Available after confirmation' },
    { type: 'Casual Leave (CL)', days: String(f.cl_days), carry: 'No (lapses)', encash: 'No', accrual: 'Half-yearly', remarks: 'Max 3 consecutive days' },
    { type: 'Sick Leave (SL)', days: String(f.sl_days), carry: 'No (lapses)', encash: 'No', accrual: 'Half-yearly', remarks: 'Medical certificate for > 2 consecutive days' },
    { type: 'Maternity Leave', days: `${f.maternity_weeks} weeks`, carry: 'N/A', encash: 'No', accrual: 'N/A', remarks: 'As per the Maternity Benefit Act' },
    { type: 'Paternity Leave', days: String(f.paternity_days), carry: 'N/A', encash: 'No', accrual: 'N/A', remarks: "Within 30 days of the child's birth" },
    { type: 'Bereavement Leave', days: f.bereavement_days, carry: 'N/A', encash: 'No', accrual: 'N/A', remarks: 'Immediate family only' },
    { type: 'Marriage Leave', days: String(f.marriage_days), carry: 'N/A', encash: 'No', accrual: 'N/A', remarks: 'Once during employment' },
    { type: 'Compensatory Off', days: 'Earned', carry: 'Expires in 30 days', encash: 'No', accrual: 'N/A', remarks: 'Requires manager approval' },
  ]
}

/** The letter's sections, in the spec's order, filled from the fields. */
export function buildSections(f: ApptFields): ApptSection[] {
  const co = blank(f.company_name)
  const notice = f.notice_days, pn = f.probation_notice_days
  const months = (d: number) => d % 30 === 0 ? `${d / 30} month${d === 30 ? '' : 's'}’` : `${d} days’`

  const comp: string[] = [
    `• CTC: Your annual Cost to Company (CTC) will be INR ${inrNum(f.ctc_annual)} (${inrWords(f.ctc_annual)}). The detailed break-up is provided in Annexure A attached herewith.`,
    '• Payment: Salary will be paid monthly, by the last working day of each month, through bank transfer (NEFT/RTGS) to your registered bank account.',
    '• Tax: Salary is subject to deduction of Income Tax at source (TDS) as per applicable rates.',
    `• Statutory deductions: Statutory deductions including Provident Fund${f.esi_applicable ? ', ESIC' : ', ESIC (if applicable)'}, Professional Tax and Labour Welfare Fund will be made as per law.`,
    '• Revision: Your compensation may be revised based on the annual performance review, as per company policy.',
    '• Confidentiality: Your compensation details are strictly confidential and must not be disclosed to colleagues or any third party.',
  ]
  if (f.jb_total > 0) {
    comp.push(`• Joining bonus: You shall be eligible for a joining bonus of INR ${inrNum(f.jb_total)} payable as;`)
    if (f.jb_first > 0) comp.push(`- INR ${inrNum(f.jb_first)} which will be paid in your first month salary.`)
    if (f.jb_second > 0) comp.push(`- INR ${inrNum(f.jb_second)} post successful completion of 6 months in the company.`)
    comp.push(`The joining bonus is tied to your tenure and association with ${co}:`)
    if (f.jb_first > 0 && f.jb_second > 0) {
      comp.push(`- If you resign from the company before completing 6 months, the first installment of INR ${inrNum(f.jb_first)} paid to you shall be fully recoverable.`)
      comp.push(`- If you resign from the company before completing 12 months, the total joining bonus of INR ${inrNum(f.jb_total)} shall be fully recoverable.`)
      comp.push(`- If you resign from the company after completing 12 months but before completing 18 months, only the second installment of INR ${inrNum(f.jb_second)} shall be fully recoverable.`)
    } else if (f.jb_second > 0) {
      comp.push(`- If you resign from the company before completing 18 months, the joining bonus of INR ${inrNum(f.jb_total)} paid to you shall be fully recoverable.`)
    } else {
      comp.push(`- If you resign from the company before completing 12 months, the joining bonus of INR ${inrNum(f.jb_total)} paid to you shall be fully recoverable.`)
    }
  }
  if (f.retention_bonus > 0) comp.push(`• Retention bonus: You are eligible for a retention bonus of INR ${inrNum(f.retention_bonus)}, payable on the terms communicated in your offer, and recoverable if you leave before they are met.`)
  if (f.esop_value > 0) comp.push(`• ESOPs: You are eligible for ESOPs worth INR ${inrNum(f.esop_value)} in the company with ${f.esop_vesting.trim() || '4-year vesting with 1 year cliff'}, as per the ESOP plan.`)

  return [
    { key: 'intro', heading: '', body: [
      `We refer to our initial meetings with you. We were very impressed with your credentials, experience and enthusiasm, and believe that you would be an asset to ${co}.`,
      `We are pleased to appoint you as “${blank(f.designation)}” in the “${blank(f.department)}” department of ${co}. Your employment will commence from ${longDate(f.doj)}. Your Employee Code is ${blank(f.emp_code)}.`,
      'Your appointment is subject to the following terms and conditions:',
    ].join('\n') },
    { key: 'position', heading: 'Position & Reporting', body: [
      `• Designation: ${blank(f.designation)}`,
      `• Department: ${blank(f.department)}`,
      ...(has(f.grade) ? [`• Grade / Level / Band: ${f.grade.trim()}`] : []),
      `• Employment type: ${blank(f.employment_type)}`,
      `• Reporting Manager: ${blank(f.reporting_manager)}`,
      ...(has(f.functional_manager) ? [`• Functional (dotted-line) reporting: ${f.functional_manager.trim()}`] : []),
      `• Place of posting: ${blank(f.place)}`,
      '• Transfer: You are liable to be transferred from one place to another, one job to another, one unit to another, now on to be started hereafter, wherever located in the country or abroad, at any point of time as the exigencies of work demand. You can also be deputed to work in and / or assigned the work of our sister concerns and / or subsidiaries / or holding / or any other client as per the assignment and / or agreement, which the company has and / or may have with such other client.',
    ].join('\n') },
    { key: 'probation', heading: 'Probation', body: [
      `• You will be on probation for a period of ${f.probation_months} months from your date of joining.`,
      `• The probation may be extended by a further ${f.probation_extension_months} months at the management’s discretion.`,
      '• Confirmation is subject to satisfactory performance and conduct during the probation period. A separate letter of confirmation will be issued upon its successful completion; until then you remain on probation.',
      `• During probation, either party may terminate the employment with ${pn} days’ notice or salary in lieu thereof.`,
      '• During probation you will be entitled to all benefits applicable to your grade, except where a benefit is linked to confirmation or length of service (such as gratuity eligibility).',
    ].join('\n') },
    { key: 'compensation', heading: 'Compensation (CTC)', body: comp.join('\n') },
    { key: 'working_hours', heading: 'Working Hours & Days', body: [
      `• Working days: ${blank(f.working_days)}.`,
      `• Working hours: ${blank(f.working_hours)}${has(f.effective_hours) ? `; effective working hours ${f.effective_hours.trim()}` : ''}.`,
      `• Overtime: ${blank(f.overtime)}`,
      '• Shifts: The company may assign shifts as per business requirements.',
      '• Remote / hybrid work: As per the company’s work-from-home policy notified from time to time.',
      '• Attendance: You are required to mark your attendance daily through the biometric / digital attendance system.',
      '• You are required to respect the hours of work, shift working, weekly offs and paid holidays of the company.',
    ].join('\n') },
    { key: 'leave', heading: 'Leave Policy', body: [
      `• Earned / Privilege Leave: ${f.el_days} days per year, credited monthly. Earned Leave can be carried forward up to a maximum of ${f.el_carry_max} days and the balance will be encashed at the time of exit.`,
      `• Casual Leave: ${f.cl_days} days per year. Sick Leave: ${f.sl_days} days per year.`,
      `• Maternity Leave: ${f.maternity_weeks} weeks, as per the Maternity Benefit Act. Paternity Leave: ${f.paternity_days} days, within 30 days of the child’s birth.`,
      `• Bereavement Leave: ${f.bereavement_days} days for immediate family. Marriage Leave: ${f.marriage_days} days, once during employment.`,
      '• Compensatory off for extra working days as per the comp-off policy. Leave Without Pay, when all leave is exhausted, requires the approval of your manager and HR.',
      '• You will be entitled to paid holidays as per the Holiday Calendar published annually.',
      '• The leave summary is in Annexure B; the detailed leave policy is available on the ESS portal.',
    ].join('\n') },
    { key: 'termination', heading: 'Notice Period & Termination', body: [
      `• During probation the notice period is ${pn} days or ${months(pn)} salary in lieu. Upon confirmation the notice period will be ${notice} days or ${months(notice)} salary in lieu, on either side, in accordance with company policy.`,
      '• Where the notice period is not served, basic salary equivalent to the number of days of notice not served will be recovered from the Full & Final settlement, unless a waiver is approved in writing by the concerned authority.',
      '• It shall be open to the company to accept or reject your resignation. After acceptance you shall serve the notice period as per business requirements, and may be asked to discontinue your services at any time during the notice; the company shall then not be liable to pay any compensation for the notice not served.',
      '• If you are put on a Performance Improvement Plan (PIP) and do not achieve the outlined expectations, the PIP month shall also serve as your notice period and you will be relieved at its end.',
      '• The company may terminate your employment without notice in cases of gross misconduct, fraud, breach of trust or violation of company policies. Grounds for termination include:',
      '- Poor performance or continuous indiscipline even after warnings.',
      '- Misconduct, or misbehaviour with fellow employees or customers.',
      '- Fraud, dishonesty, forgery or misappropriation.',
      '- Breach of confidentiality or of the company’s policies.',
      '- Conviction for a criminal offence.',
      '- Insubordination or refusal to discharge the duties assigned to you.',
      '- Unauthorised absence for 10 consecutive days without a reasonable explanation.',
      '• On separation you shall return all company property, including laptop, ID card, access cards, documents and any other material.',
      `• Your Full & Final settlement will be processed within ${f.fnf_days} days of your last working day. The company reserves the right to recover any pending dues from it.`,
    ].join('\n') },
    { key: 'recovery', heading: 'Recovery of Joining Costs', body: [
      '• Joining bonus: If, after availing a joining bonus, you resign before completing 1 year from your date of joining, you shall return it to the company; the company may deduct / set off the amount from your Full & Final settlement.',
      '• Training cost: The company invests significant time, resources and costs in your induction, onboarding and training. If you resign voluntarily before completing one (1) year of continuous service, the company may recover an amount equal to one (1) month’s salary towards these costs.',
      '• Notice period buyout: If the company bought out your notice period with your previous employer and you resign before completing 1 year from your date of joining, you shall return the buyout amount; the company may deduct / set off the amount from your Full & Final settlement.',
    ].join('\n') },
    { key: 'conduct', heading: 'Code of Conduct', body: [
      '• Maintain professional behaviour and decorum at the workplace, follow the dress code and report on time.',
      '• Treat colleagues, clients and visitors with respect and dignity. There is no discrimination based on gender, religion, caste, race or disability.',
      '• The company has zero tolerance for sexual harassment, in compliance with the POSH Act, 2013.',
      '• No consumption of alcohol or drugs during working hours or on company premises.',
      '• Follow the company’s social media policy; do not defame the company online.',
      '• Disclose any conflict of interest to the management.',
      '• Your employment is full time: you shall not engage in any other employment, business or consulting, directly or indirectly, without prior written approval.',
      '• No political activities during office hours or using company resources.',
      `• You shall not accept any commission, rebate, discount, gift or profit from any person or firm having business with the company; gifts above INR ${inrNum(f.gift_limit)} must not be accepted.`,
      '• The detailed Code of Conduct is summarised in Annexure C and available on the ESS portal.',
    ].join('\n') },
    { key: 'confidentiality', heading: 'Confidentiality & Non-Disclosure', body: [
      '• All information related to the company’s business, clients, technology, processes, financial data and strategies is confidential.',
      '• You shall not disclose, copy or use confidential information for any purpose other than company work, nor communicate it to public papers, journals or any unauthorised person, except with the prior approval of the management.',
      `• This obligation continues during your employment and for a period of ${f.confidentiality_years} years after separation.`,
      '• You shall comply with the company’s data protection and privacy policies. Client data and contracts are strictly confidential and must not be shared with any third party.',
      '• You shall not share any company-related confidential information on social media or public forums.',
      '• On separation you shall return all notes, memoranda, documents, data and materials — physical and digital — and any copies of them.',
      '• Breach of confidentiality may result in termination and / or legal action for damages. A separate Non-Disclosure Agreement (NDA) may be executed.',
    ].join('\n') },
    { key: 'non_compete', heading: 'Non-Compete & Non-Solicitation', body: [
      '• During your employment you shall not engage in any competing business or employment.',
      `• For a period of ${f.non_compete_months} months after separation, you shall not join a direct competitor within ${blank(f.non_compete_region)} or solicit the company’s clients, to the extent permitted by law.`,
      `• You shall not solicit or hire any current employee of the company for ${f.non_solicit_months} months after separation.`,
      '• You shall not approach or solicit any client with whom you had dealings during your employment.',
    ].join('\n') },
    { key: 'ip', heading: 'Intellectual Property Rights', body: [
      '• All work product, inventions, designs, code, documentation and creative work developed during your employment belongs exclusively to the company, and you hereby assign all rights, title and interest in it to the company.',
      '• Any prior invention or intellectual property you wish to exclude must be declared in writing before joining.',
      '• You waive all moral rights in such work to the extent permitted by law. The company has the right to patent or copyright any work created by you during employment.',
      '• You shall cooperate in filing patent / copyright applications, even after separation.',
    ].join('\n') },
    { key: 'statutory', heading: 'Statutory Benefits', body: [
      '• Provident Fund: You will be enrolled under the Employees’ Provident Funds & Miscellaneous Provisions Act, 1952, with contributions as per the Act (shown in Annexure A).',
      f.esi_applicable
        ? '• ESI: Your gross salary is within the ESIC limit, so you are covered under the Employees’ State Insurance Act, 1948 (employee 0.75%, employer 3.25%).'
        : '• ESI: If your gross salary is ₹21,000 a month or less, you will be covered under the Employees’ State Insurance Act, 1948 (employee 0.75%, employer 3.25%).',
      '• Gratuity: As per the Payment of Gratuity Act, 1972, on completion of 4 years and 240 days of continuous service.',
      '• Bonus: Statutory bonus as per the Payment of Bonus Act, 1965, if applicable to your salary bracket.',
      `• Medical insurance: Group medical insurance for self and dependents as per company policy${has(f.medical) ? ` (${f.medical.trim()})` : ''}.`,
      '• Professional Tax will be deducted as per state-specific rates. Maternity benefit as per the Maternity Benefit Act.',
      '• POSH: The company complies with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, and has constituted an Internal Complaints Committee (ICC).',
    ].join('\n') },
    { key: 'policies', heading: 'Company Policies', body: [
      'The following policies are available on the ESS portal: Leave Policy (and Annexure B), Code of Conduct (and Annexure C), POSH Policy, IT & Data Security Policy, Travel & Reimbursement Policy, Performance Management Policy, Grievance Redressal Policy, Whistleblower Policy, Dress Code Policy, Social Media Policy, Remote Work / WFH Policy and the Anti-Bribery & Anti-Corruption Policy.',
      'All company policies as amended from time to time shall be applicable to you and are deemed part of this appointment. Any of the terms and conditions of service may be modified at the company’s discretion and will be communicated to you in writing.',
    ].join('\n') },
    { key: 'grievance', heading: 'Grievance Mechanism', body: [
      '• First level: raise the issue with your Reporting Manager. Second level: escalate to the HR Manager. Third level: escalate to the HR Head / Grievance Committee.',
      '• POSH complaints go to the Internal Complaints Committee (ICC) through its separate process. An anonymous whistleblower channel is available.',
      '• The company will acknowledge a grievance within 3 days and resolve it within 15 working days. No employee will face retaliation for raising a genuine grievance.',
    ].join('\n') },
    { key: 'bgv', heading: 'Background Verification', body: [
      '• Your appointment is subject to successful completion of background verification, covering previous employment, education, criminal record, address and references. By signing this letter you consent to it.',
      `• The verification will be completed within ${f.bgv_days} days of joining and may be conducted through an authorised third-party agency. You agree to furnish all information requested for it.`,
      '• You affirm that all information you have provided, for seeking employment or during it, is true, accurate and not misleading, and you will promptly inform the company in writing of any change. Any discrepancy found may result in termination of employment.',
    ].join('\n') },
    { key: 'medical', heading: 'Medical Fitness', body: [
      '• Your appointment is subject to your being medically fit for the role; the company may require a pre-employment medical examination.',
      '• You are expected to maintain the health standards required for the role. Extended medical leave beyond entitlement may lead to a review of employment status.',
    ].join('\n') },
    { key: 'governing_law', heading: 'Governing Law & Jurisdiction', body: [
      '• This appointment shall be governed by the laws of India.',
      `• Any dispute arising out of or related to your employment shall be subject to the exclusive jurisdiction of the courts in ${blank(f.jurisdiction)}. Disputes may first be referred to arbitration under the Arbitration and Conciliation Act, 1996.`,
      '• If any provision is held invalid, the remaining provisions shall continue in full force.',
      '• This letter along with its Annexures constitutes the entire agreement and supersedes all prior communications. No modification shall be valid unless in writing and signed by both parties.',
      '• The terms of this letter are strictly confidential between you and the company.',
    ].join('\n') },
    { key: 'closing', heading: '', body: `Please sign and return the duplicate copy of this letter, with your initials on every page, as a token of your acceptance. We welcome you to ${co} and wish you a long and rewarding career with us.` },
    { key: 'declaration', heading: '', body: `I have read, understood and agree to abide by the terms and conditions mentioned in this letter and its Annexures. I have sought appropriate clarifications from the company concerning them, and I understand that my employment with ${co} is subject to a clear background check.` },
    { key: 'annex_note', heading: '', body: [
      '*The figures above are as agreed at the recruitment negotiation. Fixed CTC is subject to applicable Income Tax, ESIC, PT and LWF deductions as per relevant laws and employee declarations; net in-hand is shown before income tax (TDS).',
      f.gratuity_in_ctc
        ? 'Gratuity is included in the CTC shown above and shall be governed by the Payment of Gratuity Act, 1972, and its subsequent amendments.'
        : 'Gratuity is over and above the CTC shown above and shall be governed by the Payment of Gratuity Act, 1972, and its subsequent amendments.',
      'One-time payments are outside the CTC and governed by the recovery terms in this letter.',
    ].join('\n') },
    { key: 'annex_c', heading: 'Annexure C — Code of Conduct (Summary)', body: [
      '• Professional behaviour: integrity, punctuality, decorum and the dress code.',
      '• Workplace conduct: respect, non-discrimination, no substance abuse, safe use of company property.',
      '• Anti-harassment (POSH): zero tolerance; complaints to the Internal Complaints Committee.',
      '• IT security & data protection: authorised use of systems, passwords and data only; no sharing of confidential data.',
      '• Social media: no confidential information and no defamatory content about the company, its clients or employees.',
      '• Conflict of interest: declare any outside interest, employment, business or relationship that may conflict with your duties.',
      '• Disciplinary framework: verbal warning, then written warning, then a Performance Improvement Plan, then termination; gross misconduct may lead to immediate termination.',
      '• Whistleblower protection: concerns raised in good faith are protected from retaliation.',
    ].join('\n') },
  ]
}

/** The benefits table under Annexure A. */
export function benefitsOf(f: ApptFields): [string, string][] {
  const out: [string, string][] = []
  if (f.medical.trim()) out.push(['Medical Policy', f.medical.trim()])
  if (f.gratuity_annual > 0) out.push(['Gratuity', `INR ${inrNum(f.gratuity_annual)} per annum${f.gratuity_in_ctc ? ' (in CTC)' : ' (over and above CTC)'}`])
  return out
}

export function defaultEmail(f: ApptFields): { subject: string; body: string } {
  return {
    subject: `Letter of Appointment — ${f.company_name || 'Appointment'}`,
    body: `Dear ${f.name},\n\nCongratulations and welcome to ${f.company_name || 'the company'}!\n\nPlease find attached your Letter of Appointment as ${f.designation || 'per your offer'}${f.emp_code ? ` (Employee Code: ${f.emp_code})` : ''}, effective ${longDate(f.doj)}. Read it carefully, initial every page, sign the last page and share the signed copy with the HR team.\n\nFor any clarification, reply to this email.\n\nRegards,\nHR Team\n${f.company_name || ''}`.trim(),
  }
}
