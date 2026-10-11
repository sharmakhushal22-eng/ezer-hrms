// lib/recruitment/offer-accepted-mail.ts — SERVER ONLY.
//
// The two mails sent when a candidate accepts on the salary link, both carrying the salary
// break-up PDF (the CTC break-up acknowledgement, password-protected with the candidate's mobile):
//   - to the hiring manager(s) — the MRF's assigned_recruiter_ids, who sent the link
//   - to the candidate, confirming what they accepted
// Called by app/api/salary-view/respond. Best-effort: returns how many mails were sent.

import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { ctcAcknowledgementPdf } from '@/lib/recruitment/approval-pack'

const inr = (n: any) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const empEmail = (e: any) => e?.office_email || e?.personal_email || null

/** The two acceptance mails. Returns how many were sent; never throws past the caller's catch. */
export async function mailAcceptance(neg: any): Promise<number> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return 0

  const { data: cand } = await sb.from('candidates').select('full_name, email, mobile, phone, designation, mrf_id').eq('id', neg.candidate_id).maybeSingle()
  const mrfId = cand?.mrf_id || null
  const { data: mrf } = mrfId
    ? await sb.from('manpower_requisitions').select('mrf_number, designation, position, assigned_recruiter_ids').eq('id', mrfId).maybeSingle()
    : { data: null as any }
  const hmIds: string[] = Array.isArray(mrf?.assigned_recruiter_ids) ? mrf.assigned_recruiter_ids : []
  const { data: hms } = hmIds.length
    ? await sb.from('employees').select('full_name, office_email, personal_email').in('id', hmIds)
    : { data: [] as any[] }

  // Same password as the HR Head's copy: the candidate's registered mobile number.
  const password = String(cand?.mobile || cand?.phone || '').replace(/\D/g, '') || 'ezerhr'
  const pdf = await ctcAcknowledgementPdf(sb as any, neg.id, neg.candidate_id, password)
  const attachments = pdf ? [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }] : []

  const who = cand?.full_name || neg.candidate_name || 'The candidate'
  // The title on the salary link is what the candidate accepted; the MRF's is the fallback.
  const role = neg.position_title || mrf?.designation || mrf?.position || cand?.designation || ''
  const ref = mrf?.mrf_number ? ` (${mrf.mrf_number})` : ''
  const on = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  const pkg = neg.is_stipend ? `${inr(neg.stipend_monthly)} a month` : `${inr(neg.offered_ctc)} a year`
  const pdfNote = pdf ? `\n\nThe salary break-up is attached as a PDF. It is password-protected — the password is the candidate's registered mobile number.` : ''

  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  const from = `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`
  const jobs: Promise<any>[] = []
  let sentCount = 0

  const hmTo = (hms || []).map(empEmail).filter(Boolean) as string[]
  if (hmTo.length) {
    jobs.push(t.sendMail({
      from, to: hmTo.join(','), attachments,
      subject: `Offer accepted — ${who}${role ? ` (${role})` : ''}`,
      text: `Hi,\n\n${who} has accepted the salary offer${role ? ` for ${role}` : ''}${ref} on ${on}.\n\nOffered: ${pkg}${neg.proposed_doj ? `\nProposed joining: ${new Date(neg.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}${neg.response_note ? `\nCandidate's note: ${neg.response_note}` : ''}${pdfNote}\n\nNext step: raise the offer approval request to the HR Head from Recruitment → Offer Approval.\n\n— EZER HRMS`,
    }).then(() => { sentCount++ }).catch(() => null))
  }

  if (cand?.email) {
    jobs.push(t.sendMail({
      from, to: cand.email, attachments,
      subject: `You have accepted the offer${role ? ` — ${role}` : ''}`,
      text: `Dear ${who},\n\nThank you — we have recorded your acceptance of the salary offer${role ? ` for the ${role} role` : ''} on ${on}.\n\nOffered: ${pkg}${pdf ? `\n\nYour salary break-up is attached as a PDF. It is password-protected — the password is your registered mobile number (digits only).` : ''}\n\nOur team will be in touch with the next steps and your offer letter.\n\nRegards,\n${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}`,
    }).then(() => { sentCount++ }).catch(() => null))
  }

  await Promise.all(jobs)
  return sentCount
}
