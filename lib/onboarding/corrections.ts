// lib/onboarding/corrections.ts — pure. What a returned onboarding form asks the candidate to
// fix (rejected documents, flagged details, a note), the one-line summary of it, and the mail
// that lists it. Shared by the HR Manager's review (review.ts), the team return
// (approvals.ts) and Resend link.

export const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: 'Aadhaar Card (Front)', AADHAAR_BACK: 'Aadhaar Card (Back)', PAN: 'PAN Card', PHOTO: 'Passport Size Photo',
  FAMILY_PHOTO: 'Family Photo (for ESIC)', DEGREE: 'Highest Degree Certificate', EXP_LETTER: 'Experience / Relieving Letter',
  BANK_PROOF: 'Cancelled Cheque / Bank Passbook', UAN_CARD: 'UAN Card', MARKSHEET_10: '10th Mark Sheet', MARKSHEET_12: '12th Mark Sheet',
  MASTERS: 'Post-graduation / Masters Certificate', OTHER_CERT: 'Other Certificate', APPOINTMENT_LETTER: 'Previous Appointment Letter',
  APPRAISAL_LETTER: 'Previous Appraisal Letter', SALARY_SLIP_1: 'Salary Slip — latest month', SALARY_SLIP_2: 'Salary Slip — 2nd last month',
  SALARY_SLIP_3: 'Salary Slip — 3rd last month', FORM_16: 'Form 16 (previous employer)', PASSPORT: 'Passport (front page)', VISA: 'Visa copy', WORK_PERMIT: 'Work Permit',
}
export const docLabel = (code: string) => DOC_LABEL[code] || code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

export interface DocVerdict { doc_code: string; ok: boolean; reason?: string | null }
export interface DetailFlag { section?: string | null; field: string; reason: string }
export interface Corrections { documents: { doc_code: string; label: string; reason: string }[]; details: DetailFlag[]; note?: string | null }
export interface HrReview extends Corrections {
  outcome: 'ACCEPTED' | 'RETURNED' | 'RESUBMITTED'
  at: string; by: string | null; by_name: string | null
  resubmitted_at?: string | null
}

/** What the candidate is asked to fix, as one sentence for the remark / audit. */
export function summarise(c: Corrections): string {
  const parts: string[] = []
  if (c.documents.length) parts.push(`${c.documents.length} document${c.documents.length === 1 ? '' : 's'} rejected (${c.documents.map(d => d.label).join(', ')})`)
  if (c.details.length) parts.push(`${c.details.length} detail${c.details.length === 1 ? '' : 's'} to correct (${c.details.map(d => d.field).join(', ')})`)
  if (c.note && c.note.trim()) parts.push(c.note.trim())
  return parts.join('; ') || 'Corrections requested'
}

/** The mail a candidate gets when the form is returned: every rejected document and flagged
 *  detail, each with its reason, and the link. Also used by Resend link while it stands. */
export function correctionsMail(o: { name: string; link: string; validityHours: number; byTeam?: string | null }, c: Corrections): { subject: string; text: string; html: string } {
  const team = o.byTeam || 'HR'
  const lines: string[] = [`Dear ${o.name},`, '', `Thank you for submitting your onboarding form. ${team} has reviewed it and needs a few corrections before it can be approved.`]
  if (c.documents.length) {
    lines.push('', `Documents rejected — please upload these again:`)
    c.documents.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}${d.reason ? ` — ${d.reason}` : ''}`))
  }
  if (c.details.length) {
    lines.push('', `Details to correct:`)
    c.details.forEach((d, i) => lines.push(`  ${i + 1}. ${d.field}${d.section ? ` (${d.section})` : ''}${d.reason ? ` — ${d.reason}` : ''}`))
  }
  if (c.note && c.note.trim()) lines.push('', `Note from ${team}: ${c.note.trim()}`)
  lines.push('', 'Please open your onboarding link, make the changes and submit the form again:', o.link, '', `The link is valid for ${o.validityHours} hours.`, '', 'Warm regards,', 'HR Team')
  const text = lines.join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const li = (s: string) => `<li>${esc(s)}</li>`
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">
<p>Dear ${esc(o.name)},</p>
<p>Thank you for submitting your onboarding form. ${esc(team)} has reviewed it and needs a few corrections before it can be approved.</p>
${c.documents.length ? `<p><b>Documents rejected — please upload these again:</b></p><ol>${c.documents.map(d => li(`${d.label}${d.reason ? ` — ${d.reason}` : ''}`)).join('')}</ol>` : ''}
${c.details.length ? `<p><b>Details to correct:</b></p><ol>${c.details.map(d => li(`${d.field}${d.section ? ` (${d.section})` : ''}${d.reason ? ` — ${d.reason}` : ''}`)).join('')}</ol>` : ''}
${c.note && c.note.trim() ? `<p><b>Note from ${esc(team)}:</b> ${esc(c.note.trim())}</p>` : ''}
<p>Please open your onboarding link, make the changes and submit the form again:<br><a href="${o.link}">${o.link}</a></p>
<p>The link is valid for ${o.validityHours} hours.</p>
<p>Warm regards,<br>HR Team</p></div>`
  const n = c.documents.length + c.details.length
  return { subject: n ? `Corrections needed on your onboarding form (${n} item${n === 1 ? '' : 's'})` : 'A correction is needed on your onboarding form', text, html }
}

