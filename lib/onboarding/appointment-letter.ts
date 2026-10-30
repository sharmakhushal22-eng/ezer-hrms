// lib/onboarding/appointment-letter.ts — the Letter of Appointment a joiner gets once their
// employee code is generated (Onboarding → the joiner's row → Appointment letter).
//
// Pure, shared by the popup and the server: the facts the letter is filled from (`ApptFields`,
// loaded in appointment-letter-server.ts), the sections built from them in the company's
// wording (`buildSections`, from the HR team's appointment.docx) and Annexure A (`annexureFrom`,
// the joiner's CTC structure). The HR Manager may edit any field, section or annexure row in
// the popup before sending; the PDF is drawn from exactly what was sent.
//
// Section bodies are plain text: a line starting "• " is a bullet, "- " a sub-bullet, any other
// line a paragraph.

import type { StmtRow } from '@/lib/recruitment/ctc-statement'

export interface ApptFields {
  salutation: string          // Mr. / Ms.
  name: string
  emp_code: string
  letter_date: string         // YYYY-MM-DD
  designation: string
  department: string          // the "function"
  company_name: string
  doj: string                 // YYYY-MM-DD
  place: string               // place of posting
  ctc_annual: number
  /** Joining bonus: the total and its two instalments (first salary, after 6 months). */
  jb_total: number
  jb_first: number
  jb_second: number
  esop_value: number
  esop_vesting: string
  probation_notice_days: number
  notice_days: number
  jurisdiction: string
  medical: string
  gratuity_annual: number
  /** True when the CTC structure carries gratuity inside the package. */
  gratuity_in_ctc: boolean
}

export interface ApptSection { key: string; heading: string; body: string; inline?: boolean }
export interface AnnexRow { label: string; monthly: number; annual: number; bold?: boolean }
export interface ApptDraft { fields: ApptFields; sections: ApptSection[]; annexure: AnnexRow[] }

/** "3,00,000" — Indian grouping, no symbol (the letter writes INR in front). */
export const inrNum = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-IN')
export const longDate = (d: string | null | undefined) => {
  if (!d) return '________'
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`)
  return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const blank = (s: string | null | undefined) => (s && String(s).trim()) || '________'

export const salutationFor = (gender: string | null | undefined) => /^f/i.test(String(gender || '')) ? 'Ms.' : 'Mr.'

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

/** Annexure A from the joiner's salary statement (lib/onboarding/salary-breakdown.ts): the
 *  earnings, the employer's contributions, the fixed CTC, any variable and the total — the
 *  deductions and in-hand lines are not part of the letter. */
export function annexureFrom(rows: StmtRow[]): { annexure: AnnexRow[]; gratuityAnnual: number; gratuityInCtc: boolean } {
  const out: AnnexRow[] = []
  let gratuityAnnual = 0, gratuityInCtc = false
  const r = (n: any) => Math.round(Number(n) || 0)
  for (const row of rows) {
    if (row.kind === 'head') break                                 // deductions start here
    if (row.kind === 'note' || row.kind === 'ded' || row.kind === 'net') continue
    if (row.kind === 'sum' && /gross/i.test(row.label)) continue
    if (row.kind === 'grat') { gratuityAnnual = r(row.annual); gratuityInCtc = true }
    if ((row.kind === 'emp' || row.kind === 'grat' || row.kind === 'muted') && !r(row.annual)) continue
    const label = row.kind === 'sum' && /fixed/i.test(row.label) ? '*Fixed CTC'
      : row.kind === 'total' ? 'Total CTC'
      : row.kind === 'muted' ? 'Variable / Performance Pay'
      : row.label.replace(/\s*\(advance, with salary\)/i, '')
    out.push({ label, monthly: r(row.monthly ?? (Number(row.annual) || 0) / 12), annual: r(row.annual ?? (Number(row.monthly) || 0) * 12), bold: row.kind === 'sum' || row.kind === 'total' })
  }
  return { annexure: out, gratuityAnnual, gratuityInCtc }
}

/** The letter's sections in the company's wording, filled from the fields. */
export function buildSections(f: ApptFields): ApptSection[] {
  const co = blank(f.company_name)
  const comp: string[] = [
    'Your remuneration in the role will be as follows -',
    `Total CTC of INR ${inrNum(f.ctc_annual)} per year. The Fixed CTC will be payable monthly subject to the internal HR policies of the company and tax laws of India. The detailed break-up is given in Annexure A.`,
  ]
  if (f.jb_total > 0) {
    comp.push(`You shall be eligible for a joining bonus of INR ${inrNum(f.jb_total)} payable as;`)
    if (f.jb_first > 0) comp.push(`• INR ${inrNum(f.jb_first)} which will be paid in your first month salary.`)
    if (f.jb_second > 0) comp.push(`• INR ${inrNum(f.jb_second)} post successful completion of 6 months in the company.`)
    comp.push('The associated conditions of the joining bonus are as detailed below:')
    comp.push(`The joining bonus is tied to your tenure and association with ${co}.`)
    if (f.jb_first > 0 && f.jb_second > 0) {
      comp.push(`• If you resign from the company before completing 6 months, the first installment of INR ${inrNum(f.jb_first)} paid to you shall be fully recoverable.`)
      comp.push(`• If you resign from the company before completing 12 months, the total joining bonus of INR ${inrNum(f.jb_total)} shall be fully recoverable.`)
      comp.push(`• If you resign from the company after completing 12 months but before completing 18 months, only the second installment of INR ${inrNum(f.jb_second)} shall be fully recoverable.`)
    } else if (f.jb_second > 0) {
      comp.push(`• If you resign from the company before completing 18 months, the joining bonus of INR ${inrNum(f.jb_total)} paid to you shall be fully recoverable.`)
    } else {
      comp.push(`• If you resign from the company before completing 12 months, the joining bonus of INR ${inrNum(f.jb_total)} paid to you shall be fully recoverable.`)
    }
  }
  if (f.esop_value > 0) comp.push(`You are eligible for ESOPs worth INR ${inrNum(f.esop_value)} in the company with ${f.esop_vesting.trim() || '4-year vesting with 1 year cliff'}.`)

  return [
    { key: 'intro', heading: '', body: `We refer to our initial meetings with you. We were very impressed with your credentials, experience and enthusiasm, and believe that you would be an asset to ${co}.` },
    { key: 'designation', heading: 'Designation', inline: true, body: `You will be designated as “${blank(f.designation)}” in “${blank(f.department)}” function.` },
    { key: 'commencement', heading: 'Commencement Date', inline: true, body: `Your date of appointment will be effective from ${longDate(f.doj)}.` },
    { key: 'posting', heading: 'Place of Posting', inline: true, body: `You will be posted at ${blank(f.place)}.\nHowever, you are liable to be transferred from one place to another, one job to another, one unit to another, now on to be started hereafter, wherever located in the country or abroad, at any point of time as the exigencies of work demand. You can also be deputed to work in and / or assigned the work of our sister concerns and/or subsidiaries / or holding / or any other client as per the assignment and / or agreement, which the company has and/or may have with such other client.` },
    { key: 'compensation', heading: 'Compensation and Benefits', body: comp.join('\n') },
    { key: 'regulations', heading: 'Employment Regulations', body: [
      'During the period of employment with us, you will adhere to the company’s HR policies. Your employment with the company is full time and under no circumstances should you engage yourself in any business whatsoever whilst so employed. Any breach of this condition may result in your immediate termination from the services of the organization. You are expected to discharge the duties assigned to you from time to time with due diligence, integrity and responsibility to the entire satisfaction of the management and maintain high standard of work expected of you by the company. You are also required to respect hours of work, shift working, weekly offs, paid holidays etc.',
      'You shall not under any circumstances either directly or indirectly, receive or accept for your benefit any commission, rebate, discount or profit from any person, company or firm having business transactions with the organization.',
      'The terms and conditions of service are confidential and may not be disclosed to or discussed with anyone.',
      'Any and all the terms and conditions of service may be modified or changed at the company’s discretion and will be communicated to you in writing.',
    ].join('\n') },
    { key: 'termination', heading: 'Resignation & Termination', body: [
      `• During the probation period, you are required to serve a ${f.probation_notice_days}-day notice period upon resignation. Upon successful completion of the probation period, the applicable notice period will be ${f.notice_days} Days, in accordance with company policy.`,
      '• Also, in an event where notice period is not being served basic salary equivalent to number of days of notice period not served would be recovered from the full & final settlement or unless exceptional approval given in written by concerned authority for notice waive.',
      '• It shall, however, be open to the company to accept or reject your resignation.',
      '• In the event of your resignation, post acceptance by the reporting authority, you shall be liable to serve the applicable notice period as per the business requirements and can be asked to discontinue your services at any given point of time during the tenure of notice. Tenure of notice period to be finally served shall be decided by the company. Company, in this case shall not be liable to pay any compensation in lieu of the notice period not served.',
      '• During your employment, if you are put on PIP (Performance Improvement Plan) (if applicable), only if you achieve the outlined expectations, you will be continued as earlier, otherwise the same month shall also serve as notice period and you will be relieved from the services at the end of the PIP period due to non-performance. The decision of continuation/termination of your services shall solely depend on your performance and review by your line manager.',
      '• In the event of a termination or separation (without clause), company shall extend relevant benefits to the outgoing employee as per its own discretion and applicability of benefits.',
      '• In the ‘Event of Breach’ which shall include fraud, gross negligence, breach of confidentiality, refusal to discharge duties attributed to you by the company, insubordination, violation of company policy or breach of the terms and conditions mentioned in this agreement or any act or omission which may affect the company or you adversely, the company shall have the right to forthwith terminate your association with it without notice or being liable to pay any amounts in respect. The following shall be considered as an ‘Event of Breach’:',
      '- Continuous indiscipline even after continuous warnings.',
      '- Repeated non-adherence to the group HR policy.',
      '- Misbehavior and misconduct at the workplace.',
      '- Misbehavior with fellow employees or customers post jurisdiction and decision of the grievance panel.',
      '- Lack of integrity or fraud, forgery or misappropriation.',
      '- If you remain absent from work without authorization or a reasonable explanation for 10 consecutive days.',
    ].join('\n') },
    { key: 'nda', heading: 'Non-Disclosure & Confidentiality Agreement', body: [
      'During your employment with us, you will have access to confidential/proprietary information about the organization, its clients, its business transactions, and associated companies. You shall not during your course of employment and after you have ceased to be in the employment of this organization, disclose such confidential/proprietary information to any third party and /or any unauthorized person.',
      'All notes and memoranda pertaining to this organization trade secrets and confidential/proprietary information made by or acquired by you during your employment shall always remain the property of this organization. Upon termination of your employment, you shall return all notes/memoranda and any copies thereof to organization that you may have obtained during your employment.',
    ].join('\n') },
    { key: 'confidentiality', heading: 'Confidentiality', body: [
      'You shall not disclose any information acquired during the employment about the business of the company or any affiliated companies to any unauthorized person, either during or on any online platform after your employment with the company, for any reason. You shall not communicate to public papers, journals, pamphlets or leaflets, or disclose at any time, any information or documents, official or otherwise relating to the company except with the prior approval of the management. Any invention, process development, discovery, formulate, plan specification, program, design, adaptation or improvement in procedure or other matters or work whatsoever made, developed or discovered by the employee either alone or jointly with any other person, in employment of the company, in connection with or in any way affecting or relating to the business of the company or capable of being used or adapted for use therein or in connection therewith shall forthwith be disclosed to the company and shall belong to and be the absolute property of the company.',
      '• Upon termination of your employment with the company you shall forthwith return to the company all the assets and property of the company (including any leased property), documents, files, books, paper, memos, electronic equipment or any other property of the company in your possession or under your control.',
      `• Any dispute arising out of and / or related to your employment with the company shall be subject to the exclusive jurisdiction of the courts in ${blank(f.jurisdiction)}.`,
      '• The terms of this letter are strictly confidential between you and the company and any breach of this confidence will be viewed with utmost seriousness.',
    ].join('\n') },
    { key: 'joining_bonus', heading: 'Joining Bonus', body: 'In case you are eligible to get a joining bonus in terms of your offer letter and subsequently after availing the joining bonus, if, you wish to resign from the services of the company anytime before completion of 1 year from your date of joining, then you shall be liable to return your joining bonus to the company. In such a scenario, company shall also reserve its right to deduct/setoff the amount of the joining bonus from your full & final settlement, in case of non-payment, if any.' },
    { key: 'training', heading: 'Training Cost Recovery', body: 'The Organisation has invested significant time, resources, and costs towards induction, onboarding, training, development, in the initial period of employment. Accordingly, if you voluntarily resign from the services of the company before completing one (1) year of continuous service from the date of joining, the Organisation shall have the right to recover an amount equivalent to one (1) month’s salary towards the training and development costs incurred by the Company.' },
    { key: 'buyout', heading: 'Notice Period Buyout', body: 'In case of a notice period buyout (by us), you shall be liable to return your buyout amount to the company if you wish to resign from the services of the company before completing 1 year from your date of joining. In such a scenario, the company shall also reserve its right to deduct/set off the amount of buyout from your full & final settlement, in case of non-payment, if any.' },
    { key: 'bgv', heading: 'Employee Background Verification', body: [
      'Upon accepting this offer of employment, you acknowledge and consent to undergo a background verification process as deemed necessary by the company:',
      '• This process may entail verifying employment history, references, criminal records, and any other personal information and checks that appear essential by the company. You agree to furnish all requisite information called by the company for verification procedures time to time.',
      '• The organization has agreed to formalize this employment contract based on the information furnished by you. You affirm that each piece of information provided, whether for the purpose of seeking employment with the organization or during the course of employment, is substantially true, accurate, and not deceptive. This information, as referred to in this paragraph (a), is termed as Employee Information. You commit to promptly notifying the organization in writing of any changes to the Employee Information.',
      '• The organization reserves its right to verify the information provided by you and you further grant your consent to the organization to conduct necessary checks, either independently or through designated service providers.',
    ].join('\n') },
    { key: 'declaration', heading: '', body: `I hereby declare that I have carefully read and understood all the terms of this letter. I have discussed this letter and sought appropriate clarifications from the company concerning terms contained in this letter. I understand and accept that my offer of employment with ${co} is subject to a clear background check.` },
    { key: 'annex_note', heading: '', body: [
      '*The Fixed CTC amount shown above is provisional and subject to applicable Income Tax, ESIC, PT, and LWF deductions as per relevant laws and employee declarations.',
      f.gratuity_in_ctc
        ? 'Gratuity is included in the CTC shown above and shall be governed by the Payment of Gratuity Act, 1972, and its subsequent amendments.'
        : 'Gratuity is over and above the Overall CTC mentioned in the table above and shall be governed by the Payment of Gratuity Act, 1972, and its subsequent amendments.',
    ].join('\n') },
  ]
}

/** The benefits table under Annexure A. */
export function benefitsOf(f: ApptFields): [string, string][] {
  const out: [string, string][] = []
  if (f.medical.trim()) out.push(['Medical Policy', f.medical.trim()])
  if (f.gratuity_annual > 0) out.push(['Gratuity', `INR ${inrNum(f.gratuity_annual)} per annum`])
  return out
}

export function defaultEmail(f: ApptFields): { subject: string; body: string } {
  return {
    subject: `Letter of Appointment — ${f.company_name || 'Appointment'}`,
    body: `Dear ${f.name},\n\nCongratulations and welcome to ${f.company_name || 'the company'}!\n\nPlease find attached your Letter of Appointment as ${f.designation || 'per your offer'}${f.emp_code ? ` (Employee Code: ${f.emp_code})` : ''}, effective ${longDate(f.doj)}. Read it carefully, sign every page and share the signed copy with the HR team.\n\nFor any clarification, reply to this email.\n\nRegards,\nHR Team\n${f.company_name || ''}`.trim(),
  }
}
