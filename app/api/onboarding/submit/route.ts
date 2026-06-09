// app/api/onboarding/submit/route.ts
// Final submission — validates, generates employee ID, moves to HR review
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { token, final_form_data } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, company_id, full_name, email, designation, status, form_data')
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
      .select('doc_code, ai_status')
      .eq('onboarding_id', cand.id)

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

    // HR notification
    await supa.from('onboarding_notifications').insert({
      onboarding_id:  cand.id,
      recipient_type: 'HR',
      channel:        'EMAIL',
      subject:        `New Joining Form Submitted — ${cand.full_name}`,
      body:           `${cand.full_name} has submitted their joining form. Please review and approve.`,
      status:         'SENT',
      sent_at:        new Date().toISOString(),
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
      message:        'Form submitted successfully. HR will review and generate your Employee ID.',
      onboarding_id:  cand.id,
    })

  } catch (err: any) {
    console.error('submit error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
