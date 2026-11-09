// lib/onboarding/submit.ts — SERVER ONLY. Final submission of the joining form.
//
// The route (app/api/onboarding/submit) and the e-sign step (app/api/onboarding/esign) share
// this: checkSubmission() is run BEFORE the candidate signs, so a missing detail or document is
// found while they can still fix it, and submitOnboarding() runs once the signature is on.
// When the forms were e-signed, the HR mail carries the signed PDF.
import type { NextRequest } from 'next/server'
import { openApprovals } from '@/lib/onboarding/approvals'
import { docLabel } from '@/lib/onboarding/corrections'
import { missingFields, describeMissing } from '@/lib/onboarding/required'
import { trackOf, requiredDocCodes } from '@/lib/onboarding/hiring-track'
import { renderEmail, onboardingScope, isUuid } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'
import { signedJoiningPdf } from '@/lib/onboarding/esign'

export const SUBMIT_SELECT = 'id, company_id, full_name, email, designation, status, form_data, hr_spoc_id, created_by, hr_review, hiring_track, esic_applicable, offered_ctc'

type Result = { status: number; body: Record<string, any> }

/** Who hears that a joining form is in: the HR SPOC, else the employee who created the
 *  onboarding, else the default HR address. */
export async function hrRecipient(supa: any, ...employeeIds: (string | null | undefined)[]): Promise<string | null> {
  for (const id of employeeIds) {
    if (!isUuid(id)) continue
    const { data } = await supa.from('employees').select('office_email, personal_email').eq('id', id).maybeSingle()
    const to = data?.office_email || data?.personal_email
    if (to) return to
  }
  return process.env.HR_DEFAULT_EMAIL || null
}

/** Everything the final submission insists on. null when the form may be submitted. */
export async function checkSubmission(supa: any, cand: any, fullData: any): Promise<Result | null> {
  if (cand.status === 'SUBMITTED' || cand.status === 'EMPLOYEE_CREATED') return { status: 409, body: { error: 'Already submitted' } }
  // The required details (lib/onboarding/required.ts) — the portal checks them step by step,
  // and this is the fence for anything that got past it.
  const track = trackOf(cand.hiring_track)
  const missing = missingFields(fullData, { track })
  if (missing.length) {
    return { status: 400, body: { error: `Some required details are missing or invalid: ${describeMissing(missing)}.`, missing_fields: missing } }
  }

  // Check mandatory documents
  const { data: docs } = await supa
    .from('onboarding_documents')
    .select('doc_code, ai_status, hr_verified')
    .eq('onboarding_id', cand.id)

  // A document HR rejected stays rejected until a new file replaces it (the upload clears
  // hr_verified) — the form cannot come back with the same file.
  const stillRejected = (docs || []).filter((d: any) => d.hr_verified === false).map((d: any) => docLabel(d.doc_code))
  if (stillRejected.length) {
    return { status: 400, body: { error: `Please upload a new copy of the rejected document${stillRejected.length > 1 ? 's' : ''} first: ${stillRejected.join(', ')}.`, rejected_docs: stillRejected } }
  }

  // Per track (lib/onboarding/hiring-track.ts): Aadhaar for domestic, passport + visa for a
  // foreign national in India, passport for overseas; PAN unless overseas.
  const gross = cand.offered_ctc ? Number(cand.offered_ctc) / 12 : 0
  const esicOn = cand.esic_applicable === true || (gross > 0 && gross <= 21000)
  const fresher = fullData.step_5?.is_fresher === true
  const mandatoryDocs = requiredDocCodes(track, { esic: esicOn, fresher }).filter(d => d !== 'DEGREE' && d !== 'BANK_PROOF' && d !== 'FAMILY_PHOTO' && d !== 'AADHAAR_BACK')
  const uploadedCodes = (docs || []).map((d: any) => d.doc_code)
  const missingDocs   = mandatoryDocs.filter(d => !uploadedCodes.includes(d))

  if (missingDocs.length > 0) {
    return { status: 400, body: {
      error: `Missing documents: ${missingDocs.join(', ')}`,
      missing_docs: missingDocs,
    } }
  }
  return null
}

/** Validate and submit. `final` is merged over the saved form data. */
export async function submitOnboarding(supa: any, token: string, final: any, req: NextRequest): Promise<Result> {
  const { data: cand, error } = await supa.from('onboarding_candidates').select(SUBMIT_SELECT).eq('magic_link_token', token).single()
  if (error || !cand) return { status: 404, body: { error: 'Invalid token' } }

  // Merge final data
  const fullData = { ...(cand.form_data || {}), ...(final || {}), submitted_at: new Date().toISOString() }
  const bad = await checkSubmission(supa, cand, fullData)
  if (bad) return bad

  // Update status to SUBMITTED
  await supa.from('onboarding_candidates').update({
    status:       'SUBMITTED',
    form_data:    fullData,
    submitted_at: new Date().toISOString(),
    current_step: 8,
    hr_notes:     null,
    // A return that stood is answered by this submission; the review history stays on the row.
    hr_review:    cand.hr_review?.outcome === 'RETURNED' ? { ...cand.hr_review, outcome: 'RESUBMITTED', resubmitted_at: new Date().toISOString() } : cand.hr_review ?? null,
  }).eq('id', cand.id)

  // Create statutory enrollment record (PF/ESI)
  const step7 = (fullData as any).step_7 || {}
  const grossSalary = parseFloat((fullData as any).step_7?.gross_monthly || '0')
  const esiApplicable = grossSalary <= 21000 && grossSalary > 0

  await supa.from('onboarding_statutory_enrollment').upsert({
    onboarding_id:      cand.id,
    pf_applicable:      step7.pf_applicable !== false,
    uan_number:         step7.pf_details?.uan || null,
    esi_applicable:     esiApplicable,
    pt_applicable:      true,
    gratuity_applicable: true,
  }, { onConflict: 'onboarding_id' })

  // Create default BGV tasks
  const bgvChecks = ['EDUCATION', 'EMPLOYMENT', 'ADDRESS', 'CRIMINAL']
  await supa.from('onboarding_bgv').insert(
    bgvChecks.map(check_type => ({
      onboarding_id: cand.id,
      check_type,
      status:        'PENDING',
    }))
  )

  // The sign-off chain starts with the HR Manager's review (Review form on the card); IT,
  // Admin and Payroll are told only once the HR Manager has accepted the form
  // (lib/onboarding/approvals.ts). A resubmission after a return resets every team to pending.
  try { await openApprovals(supa as any, cand.id, { reset: true }) } catch (e) { console.error('onboarding approvals could not be opened', e) }

  // HR notification — "Joining form submitted — HR" (Configuration → Onboarding). This used to
  // be logged here as SENT without being emailed; it is now sent, to the onboarding's HR SPOC,
  // else the employee who sent the link, else HR_DEFAULT_EMAIL, and the log says what happened.
  const hrTo = await hrRecipient(supa, cand.hr_spoc_id, cand.created_by)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || ''
  const mail = await renderEmail('onboarding.form_submitted', await onboardingScope(cand.id), {
    candidate_name: cand.full_name, role: cand.designation || '',
    review_link: appUrl ? `${appUrl}/dashboard/onboarding` : '',
  })
  // E-signed forms travel with the mail, so HR gets the signed copy the way they always got the notice.
  const signed = await signedJoiningPdf(cand.id).catch(() => null)
  const hrSent = hrTo
    ? await sendMail({ to: hrTo, subject: mail.subject, text: mail.text, html: mail.html, ...(signed ? { attachments: [{ filename: signed.fileName, content: Buffer.from(signed.bytes), contentType: 'application/pdf' }] } : {}) })
    : { sent: false }
  await supa.from('onboarding_notifications').insert({
    onboarding_id:  cand.id,
    recipient_type: 'HR',
    channel:        'EMAIL',
    subject:        mail.subject,
    body:           mail.text,
    status:         hrSent.sent ? 'SENT' : 'FAILED',
    sent_at:        hrSent.sent ? new Date().toISOString() : null,
  })

  // Audit
  await supa.from('onboarding_audit_log').insert({
    onboarding_id: cand.id,
    action:        'FORM_SUBMITTED',
    actor_type:    'CANDIDATE',
    details:       { company_id: cand.company_id, designation: cand.designation },
    ip_address:    req.headers.get('x-forwarded-for') || null,
  })

  return {
    status: 200,
    body: {
      success:        true,
      message:        'Form submitted successfully. IT, Admin, Payroll and HR will review it; your Employee ID follows their approval.',
      onboarding_id:  cand.id,
    },
  }
}
