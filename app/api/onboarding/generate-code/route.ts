// app/api/onboarding/generate-code/route.ts
// HR approves form + generates employee code → ESS access unlocked.
// Type-wise auto-code: company_code + type suffix + 4-digit atomic sequence.
// The number is reserved atomically AT GENERATION TIME — so the order codes are
// assigned follows who completes first, not planned joining date, and is never reused.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { onboardingToEmployee } from '@/lib/onboarding/to-employee'
import { buildEmpCode, isValidEmpCode, TYPE_SUFFIX } from '@/lib/employee-code'
import { sendAckEmail } from '@/lib/onboarding/ack-email'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// ── GET — preview the next auto-suggested code (does NOT consume a number) ──
export async function GET(req: NextRequest) {
  try {
    const onboarding_id = new URL(req.url).searchParams.get('onboarding_id')
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, company_id, employment_type, employee_code, full_name')
      .eq('id', onboarding_id).single()
    if (error || !cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    if (cand.employee_code) {
      return NextResponse.json({ suggested: cand.employee_code, already_generated: true, employment_type: cand.employment_type || 'Employee' })
    }

    const { data: company } = await supa.from('companies').select('company_code').eq('id', cand.company_id).single()
    const companyCode = company?.company_code || 'EZ'
    const employmentType = cand.employment_type || 'Employee'

    // Peek the next sequence WITHOUT incrementing (real reservation happens on save).
    const { data: seq } = await supa.from('employee_code_sequences')
      .select('last_sequence').eq('company_id', cand.company_id).eq('employment_type', employmentType).maybeSingle()
    const nextSeq = (seq?.last_sequence || 0) + 1

    return NextResponse.json({
      suggested: buildEmpCode(companyCode, employmentType, nextSeq),
      company_code: companyCode, employment_type: employmentType, next_sequence: nextSeq,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST — generate + lock the code (atomic), bridge to employees master ──
export async function POST(req: NextRequest) {
  try {
    const { onboarding_id, employee_code, hr_notes, approved_by } = await req.json()
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, company_id, employment_type, full_name, email, designation, status')
      .eq('id', onboarding_id).single()
    if (error || !cand) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })
    if (cand.status === 'EMPLOYEE_CREATED') return NextResponse.json({ error: 'Employee code already generated' }, { status: 409 })
    // Gate: code only after the candidate has completed (submitted) onboarding.
    if (!['SUBMITTED', 'HR_REVIEW'].includes(cand.status)) {
      return NextResponse.json({ error: 'Form not yet submitted by candidate — onboarding incomplete' }, { status: 400 })
    }

    const { data: company } = await supa.from('companies').select('company_code').eq('id', cand.company_id).single()
    const companyCode = (company?.company_code || 'EZ').toUpperCase()
    const employmentType = cand.employment_type || 'Employee'
    const suffix = TYPE_SUFFIX[employmentType] ?? ''
    const autoPattern = new RegExp(`^${companyCode}${suffix}\\d{4}$`)

    // Decide final code. If HR kept the auto pattern (or left it blank) → reserve a
    // fresh number atomically (authoritative, race-proof). If HR typed a genuinely
    // custom code → honour it. Either way numbers are never reused.
    const submitted = (employee_code || '').trim().toUpperCase()
    const isCustom = submitted.length > 0 && !autoPattern.test(submitted)

    let finalCode: string
    if (isCustom) {
      finalCode = submitted
    } else {
      const { data: nextSeq, error: seqErr } = await supa.rpc('get_next_employee_code', {
        p_company_id: cand.company_id, p_employment_type: employmentType,
      })
      if (seqErr) return NextResponse.json({ error: 'Sequence error: ' + seqErr.message }, { status: 500 })
      finalCode = buildEmpCode(companyCode, employmentType, nextSeq as number)
    }

    if (!isValidEmpCode(finalCode)) {
      return NextResponse.json({ error: `Invalid format: "${finalCode}". Expected e.g. SSM0001 or SSMINT0001` }, { status: 400 })
    }

    // Uniqueness across BOTH tables (never reuse a code, even from ex-employees).
    const [empCheck, candCheck] = await Promise.all([
      supa.from('employees').select('id').eq('emp_code', finalCode).maybeSingle(),
      supa.from('onboarding_candidates').select('id').eq('employee_code', finalCode).neq('id', onboarding_id).maybeSingle(),
    ])
    if (empCheck.data) return NextResponse.json({ error: `${finalCode} already exists in employees.` }, { status: 409 })
    if (candCheck.data) return NextResponse.json({ error: `${finalCode} already assigned to another candidate.` }, { status: 409 })

    const { error: updateErr } = await supa.from('onboarding_candidates').update({
      status: 'EMPLOYEE_CREATED', employee_code: finalCode,
      hr_reviewed_at: new Date().toISOString(), hr_reviewed_by: approved_by || null, hr_notes: hr_notes || null,
    }).eq('id', onboarding_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Bridge: create the master `employees` row. Non-fatal — status returned to HR.
    let employeeSync: any = { ok: false }
    try { employeeSync = await onboardingToEmployee(supa, onboarding_id, finalCode) }
    catch (e: any) { employeeSync = { error: e?.message || 'sync failed' } }

    await supa.from('onboarding_statutory_enrollment').update({
      enrolled_at: new Date().toISOString(), enrolled_by: approved_by || null,
    }).eq('onboarding_id', onboarding_id)

    await supa.from('onboarding_notifications').insert({
      onboarding_id, recipient_type: 'CANDIDATE', channel: 'EMAIL',
      subject: `Welcome aboard! Your Employee ID: ${finalCode}`,
      body: `Dear ${cand.full_name},\n\nYour joining process is complete. Your Employee ID is ${finalCode}.\n\nYou can now login to EZER ESS portal. Login credentials will follow in a separate email.\n\nWelcome to the team!`,
      status: 'SENT', sent_at: new Date().toISOString(),
    })

    await supa.from('onboarding_audit_log').insert({
      onboarding_id, action: 'EMPLOYEE_CODE_GENERATED', actor_type: 'HR', actor_id: approved_by || null,
      details: { employee_code: finalCode, employment_type: employmentType, company_id: cand.company_id, employee_synced: !!employeeSync.ok, sync_error: employeeSync.error || null },
    })

    // Email the joiner their acknowledgement document + acknowledged policies (non-fatal).
    let docsEmailed = false
    try { const r = await sendAckEmail(supa, onboarding_id, finalCode); docsEmailed = !!r.ok } catch { /* never block code gen */ }

    return NextResponse.json({
      success: true, employee_code: finalCode, employee_synced: !!employeeSync.ok, docs_emailed: docsEmailed,
      employee_id: employeeSync.employee_id || null, sync_error: employeeSync.error || null,
      dept_matched: employeeSync.dept_matched ?? null,
      message: employeeSync.ok
        ? `Employee ID ${finalCode} generated for ${cand.full_name}. Master record created.`
        : `Employee ID ${finalCode} generated for ${cand.full_name}. (Master sync issue: ${employeeSync.error || 'see logs'})`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
