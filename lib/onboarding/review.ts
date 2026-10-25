// lib/onboarding/review.ts — SERVER ONLY (reviewPayload / applyReview); the mail text and the
// document labels are pure and shared with the tests.
//
// The HR Manager's review of a submitted onboarding form, from the onboarding card:
//   Review form → the reviewer marks what is wrong (documents, details) with one remark, then the
//   form is ACCEPTED (the HR Manager's approval — lib/onboarding/approvals.ts — which opens it to
//   the IT, Admin and Payroll heads) or RETURNED to the candidate.
//   A return reopens the link, mails the candidate the list of what to fix, and the card shows
//   Resend link until they resubmit. Rejected documents must be replaced before resubmitting.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import { approvalsOf, decideApproval } from './approvals'
import { managersOf } from './hr-assignment'
import { docLabel, summarise, type Corrections, type DocVerdict, type DetailFlag, type HrReview } from './corrections'
export { DOC_LABEL, docLabel, summarise, correctionsMail, type Corrections, type DocVerdict, type DetailFlag, type HrReview } from './corrections'

/** The review drawer's data: the form, every document (with a 10-minute signed URL and its
 *  verdict), the four team approvals and the last review. `maskBank` hides the account number
 *  from teams that are not Payroll. */
export async function reviewPayload(sb: SupabaseClient, onboardingId: string, o: { companyId?: string | null; maskBank?: boolean } = {}) {
  let q = sb.from('onboarding_candidates')
    .select('id, full_name, email, mobile, designation, department, employment_type, date_of_joining, offered_ctc, status, submitted_at, form_data, company_id, hr_notes, hr_review, magic_link_token, token_expires_at, esic_applicable, l1_manager_id, l2_manager_id, hod_id, hiring_track, work_country, payroll_currency, employing_entity')
    .eq('id', onboardingId)
  if (o.companyId) q = q.eq('company_id', o.companyId)
  const { data: oc } = await q.maybeSingle()
  if (!oc) return null
  const { data: docs } = await sb.from('onboarding_documents').select('doc_code, file_name, storage_path, mime_type, ai_status, hr_verified, hr_notes, hr_reviewed_at, uploaded_at').eq('onboarding_id', onboardingId).order('uploaded_at')
  const documents = await Promise.all((docs || []).map(async (d: any) => {
    const { data: s } = d.storage_path ? await sb.storage.from('onboarding-docs').createSignedUrl(d.storage_path, 600) : { data: null as any }
    return { doc_code: d.doc_code, label: docLabel(d.doc_code), file_name: d.file_name, mime_type: d.mime_type, ai_status: d.ai_status, hr_verified: d.hr_verified, note: d.hr_notes, hr_reviewed_at: d.hr_reviewed_at, uploaded_at: d.uploaded_at, url: s?.signedUrl || null }
  }))
  const fd = oc.form_data || {}
  const st = { ...(fd.step_7 || {}) }
  if (o.maskBank && st.bank_account) st.bank_account = `XXXX ${String(st.bank_account).slice(-4)}`
  const { magic_link_token: _t, ...item } = oc as any
  // The joiner's managers (Assign managers on the sheet) — the form cannot be accepted without the L1.
  const [approvals, managers] = await Promise.all([approvalsOf(sb, onboardingId), managersOf(sb, oc as any)])
  return { item: { ...item, form_data: { ...fd, step_7: st } }, approvals, documents, hr_review: (oc as any).hr_review || null, managers }
}

export interface ReviewInput {
  onboardingId: string
  outcome: 'ACCEPTED' | 'RETURNED'
  documents: DocVerdict[]
  details: DetailFlag[]
  note?: string | null
  actorId: string | null; actorName: string | null
  mail?: { t: Transporter; from: string } | null
  baseUrl?: string | null
}

/** Record the HR Manager's review and act on it: ACCEPTED is the HR Manager's team approval
 *  (the fourth one generates the code); RETURNED reopens the link and mails the candidate the
 *  list of corrections. */
export async function applyReview(sb: SupabaseClient, r: ReviewInput): Promise<{ ok: boolean; error?: string; status?: number; all_approved?: boolean; corrections?: Corrections; mailed?: boolean; needs_managers?: boolean }> {
  const { data: oc } = await sb.from('onboarding_candidates').select('id, status, full_name, email, company_id, l1_manager_id').eq('id', r.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated.', status: 409 }
  if (!['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(oc.status)) return { ok: false, error: 'The candidate has not submitted the form yet.', status: 409 }
  // Accepting needs the reporting line: Assign managers (L1, L2, HOD) comes before Accept form on the sheet.
  if (r.outcome === 'ACCEPTED' && !oc.l1_manager_id) return { ok: false, error: 'Assign the managers first — press Assign managers on the sheet and pick the L1 (and L2, HOD). Accept form opens after that.', status: 409, needs_managers: true }

  const rejected = r.documents.filter(d => !d.ok)
  const details = (r.details || []).filter(d => d.field && d.field.trim()).map(d => ({ section: d.section || null, field: d.field.trim(), reason: String(d.reason || '').trim() }))
  if (r.outcome === 'ACCEPTED' && (rejected.length || details.length)) return { ok: false, error: 'A form with rejected documents or flagged details cannot be accepted — return it to the candidate instead.', status: 400 }
  if (r.outcome === 'RETURNED' && !rejected.length && !details.length && !String(r.note || '').trim()) return { ok: false, error: 'Reject at least one document, flag a detail, or say what the candidate should fix.', status: 400 }
  // The review sheet sends one remark for everything it marked; a per-document reason is optional.
  const note = String(r.note || '').trim()
  if (rejected.some(d => !String(d.reason || '').trim()) && !note) return { ok: false, error: 'Write a remark for the candidate — it goes with every rejected document.', status: 400 }

  const now = new Date().toISOString()
  // Each document's verdict. Accepted keeps a carried-over note; rejected carries the reason
  // (or the remark), which the portal shows on the document.
  for (const d of r.documents) {
    const patch: any = { hr_verified: d.ok, hr_reviewed_at: now }
    if (!d.ok) patch.hr_notes = `Rejected: ${String(d.reason || '').trim() || note}`
    await sb.from('onboarding_documents').update(patch).eq('onboarding_id', r.onboardingId).eq('doc_code', d.doc_code)
  }
  const corrections: Corrections = { documents: rejected.map(d => ({ doc_code: d.doc_code, label: docLabel(d.doc_code), reason: String(d.reason || '').trim() })), details, note: r.note || null }
  const review: HrReview = { outcome: r.outcome, at: now, by: r.actorId, by_name: r.actorName, ...corrections }
  await sb.from('onboarding_candidates').update({ hr_review: review, ...(r.outcome === 'ACCEPTED' && oc.status === 'SUBMITTED' ? { status: 'HR_REVIEW' } : {}) }).eq('id', r.onboardingId)
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: r.onboardingId, action: r.outcome === 'ACCEPTED' ? 'HR_REVIEW_ACCEPTED' : 'HR_REVIEW_RETURNED', actor_type: 'HR', actor_id: r.actorId,
    details: { by: r.actorName, documents_rejected: corrections.documents.map(d => d.doc_code), details_flagged: details.map(d => d.field), note: r.note || null },
  }).then(() => null, () => null)

  const out = await decideApproval(sb, {
    onboardingId: r.onboardingId, team: 'HR_MANAGER', action: r.outcome === 'ACCEPTED' ? 'approve' : 'return',
    actorId: r.actorId, actorName: r.actorName, remark: r.outcome === 'ACCEPTED' ? (String(r.note || '').trim() || null) : summarise(corrections),
    corrections: r.outcome === 'RETURNED' ? corrections : undefined, mail: r.mail, baseUrl: r.baseUrl,
  })
  if (!out.ok) return out
  return { ...out, corrections, mailed: r.outcome === 'RETURNED' ? !!(r.mail && oc.email) : false }
}
