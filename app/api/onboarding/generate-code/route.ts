// app/api/onboarding/generate-code/route.ts
// HR approves form + generates employee code → ESS access unlocked.
// Type-wise auto-code: company_code + type suffix + 4-digit atomic sequence.
// The number is reserved atomically AT GENERATION TIME — so the order codes are
// assigned follows who completes first, not planned joining date, and is never reused.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildEmpCode } from '@/lib/employee-code'
import { createEmployeeFromOnboarding } from '@/lib/onboarding/create-employee'
import { approvalsOf, TEAM_LABEL, type Team } from '@/lib/onboarding/approvals'

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
// HR's manual path (it may type a custom code). The four team approvals must be in; the
// automatic path (lib/onboarding/approvals.ts) runs the same creator on the fourth approval.
export async function POST(req: NextRequest) {
  try {
    const { onboarding_id, employee_code, hr_notes, approved_by, force } = await req.json()
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })
    const approvals = await approvalsOf(supa as any, onboarding_id)
    const pending = approvals.filter(a => a.status !== 'APPROVED').map(a => TEAM_LABEL[a.team as Team])
    if (pending.length && !force) {
      return NextResponse.json({ error: `Waiting on ${pending.join(', ')} approval${pending.length > 1 ? 's' : ''}. The code is generated automatically once all four teams have approved from ESS → Tasks & Approvals.`, pending }, { status: 409 })
    }
    const r = await createEmployeeFromOnboarding(supa as any, { onboardingId: onboarding_id, customCode: employee_code, by: approved_by, notes: hr_notes, actorType: 'HR' })
    if (!r.ok) return NextResponse.json({ error: r.error, employee_code: r.employee_code, employee_synced: r.employee_synced ?? false, sync_error: r.sync_error }, { status: r.status || 500 })
    const { data: cand } = await supa.from('onboarding_candidates').select('full_name').eq('id', onboarding_id).maybeSingle()
    return NextResponse.json({
      success: true, employee_code: r.employee_code, employee_synced: true, docs_emailed: r.docs_emailed, employee_id: r.employee_id, sync_error: null, dept_matched: r.dept_matched,
      message: `Employee ID ${r.employee_code} generated for ${cand?.full_name || 'the candidate'}. Master record created.`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
