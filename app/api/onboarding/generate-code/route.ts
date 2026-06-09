// app/api/onboarding/generate-code/route.ts
// HR approves form + generates employee code → ESS access unlocked
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { onboarding_id, employee_code, hr_notes, approved_by } = await req.json()
    if (!onboarding_id || !employee_code) {
      return NextResponse.json({ error: 'onboarding_id and employee_code required' }, { status: 400 })
    }

    // Get candidate
    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, company_id, full_name, email, designation, status')
      .eq('id', onboarding_id)
      .single()

    if (error || !cand) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })
    if (cand.status === 'EMPLOYEE_CREATED') return NextResponse.json({ error: 'Employee code already generated' }, { status: 409 })
    if (!['SUBMITTED', 'HR_REVIEW'].includes(cand.status)) {
      return NextResponse.json({ error: 'Form not yet submitted by candidate' }, { status: 400 })
    }

    // Check employee_code is unique
    const { data: existing } = await supa
      .from('onboarding_candidates')
      .select('id')
      .eq('employee_code', employee_code)
      .maybeSingle()

    if (existing) return NextResponse.json({ error: 'Employee code already exists. Use a different code.' }, { status: 409 })

    // Update to EMPLOYEE_CREATED
    const { error: updateErr } = await supa
      .from('onboarding_candidates')
      .update({
        status:          'EMPLOYEE_CREATED',
        employee_code:   employee_code,
        hr_reviewed_at:  new Date().toISOString(),
        hr_reviewed_by:  approved_by || null,
        hr_notes:        hr_notes || null,
      })
      .eq('id', onboarding_id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Mark statutory enrollment as done
    await supa.from('onboarding_statutory_enrollment').update({
      enrolled_at:  new Date().toISOString(),
      enrolled_by:  approved_by || null,
    }).eq('onboarding_id', onboarding_id)

    // Notification to candidate
    await supa.from('onboarding_notifications').insert({
      onboarding_id:  onboarding_id,
      recipient_type: 'CANDIDATE',
      channel:        'EMAIL',
      subject:        `Welcome aboard! Your Employee ID: ${employee_code}`,
      body: `Dear ${cand.full_name},\n\nYour joining process is complete. Your Employee ID is ${employee_code}.\n\nYou can now login to EZER ESS portal. Login credentials will follow in a separate email.\n\nWelcome to the team!`,
      status:         'SENT',
      sent_at:        new Date().toISOString(),
    })

    // Audit
    await supa.from('onboarding_audit_log').insert({
      onboarding_id,
      action:     'EMPLOYEE_CODE_GENERATED',
      actor_type: 'HR',
      actor_id:   approved_by || null,
      details:    { employee_code, company_id: cand.company_id },
    })

    return NextResponse.json({
      success:       true,
      employee_code,
      message:       `Employee ID ${employee_code} generated for ${cand.full_name}. ESS access unlocked.`,
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
