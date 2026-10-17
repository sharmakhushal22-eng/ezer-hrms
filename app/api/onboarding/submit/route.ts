// app/api/onboarding/submit/route.ts
// Final submission — validates, generates employee ID, moves to HR review
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { openApprovals } from '@/lib/onboarding/approvals'
import { docLabel } from '@/lib/onboarding/corrections'
import { renderEmail, onboardingScope, isUuid } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

/** Who hears that a joining form is in: the HR SPOC, else the employee who created the
 *  onboarding, else the default HR address. */
async function hrRecipient(...employeeIds: (string | null | undefined)[]): Promise<string | null> {
  for (const id of employeeIds) {
    if (!isUuid(id)) continue
    const { data } = await supa.from('employees').select('office_email, personal_email').eq('id', id).maybeSingle()
    const to = data?.office_email || data?.personal_email
    if (to) return to
  }
  return process.env.HR_DEFAULT_EMAIL || null
}

export async function POST(req: NextRequest) {
  try {
    const { token, final_form_data } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, company_id, full_name, email, designation, status, form_data, hr_spoc_id, created_by, hr_review')
      .eq('magic_link_token', token)
      .single()

    if (error || !cand) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    if (cand.status === 'SUBMITTED' || cand.status === 'EMPLOYEE_CREATED') {
      return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
    }

    // Merge final data
    const fullData = { ...(cand.form_data || {}), ...(final_form_data || {}), submitted_at: new Date().toISOString() }

    // Check mandatory documents
    const { data: docs } = await supa
      .from('onboarding_documents')
      .select('doc_code, ai_status, hr_verified')
      .eq('onboarding_id', cand.id)

    // A document HR rejected stays rejected until a new file replaces it (the upload clears
    // hr_verified) — the form cannot come back with the same file.
    const stillRejected = (docs || []).filter(d => d.hr_verified === false).map(d => docLabel(d.doc_code))
    if (stillRejected.length) {
      return NextResponse.json({ error: `Please upload a new copy of the rejected document${stillRejected.length > 1 ? 's' : ''} first: ${stillRejected.join(', ')}.`, rejected_docs: stillRejected }, { status: 400 })
    }

    const mandatoryDocs = ['AADHAAR_FRONT', 'PAN', 'PHOTO']
    const uploadedCodes = (docs || []).map(d => d.doc_code)
    const missingDocs   = mandatoryDocs.filter(d => !uploadedCodes.includes(d))

    if (missingDocs.length > 0) {
      return NextResponse.json({
        error: `Missing documents: ${missingDocs.join(', ')}`,
        missing_docs: missingDocs,
      }, { status: 400 })
    }

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
    const hrTo = await hrRecipient(cand.hr_spoc_id, cand.created_by)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || ''
    const mail = await renderEmail('onboarding.form_submitted', await onboardingScope(cand.id), {
      candidate_name: cand.full_name, role: cand.designation || '',
      review_link: appUrl ? `${appUrl}/dashboard/onboarding` : '',
    })
    const hrSent = hrTo
      ? await sendMail({ to: hrTo, subject: mail.subject, text: mail.text, html: mail.html })
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

    return NextResponse.json({
      success:        true,
      message:        'Form submitted successfully. IT, Admin, Payroll and HR will review it; your Employee ID follows their approval.',
      onboarding_id:  cand.id,
    })

  } catch (err: any) {
    console.error('submit error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
