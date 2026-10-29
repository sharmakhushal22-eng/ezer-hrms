// app/api/onboarding/generate-code/route.ts — the last step on the onboarding card.
//
//   GET  ?onboarding_id=…   the next type-wise code, suggested (nothing is consumed)
//   POST { onboarding_id, employee_code?, role_ids: string[], team: { direct: string[], exclude: string[] }, force? }
//        Generate code: records the roles and the team plan (lib/onboarding/hr-assignment.ts),
//        reserves the code atomically, writes the employees row, applies the reporting line
//        (the joiner's and their team's), opens the ESS account with the roles and mails the
//        joiner their code and temporary password (lib/onboarding/create-employee.ts).
//
// Requires: the three heads approved (409 with `pending` unless force), the managers assigned
// on the review sheet (400 needs_managers) and at least one role (400 needs_role).
// Guarded by the Onboarding module (EDIT to generate).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { createEmployeeFromOnboarding } from '@/lib/onboarding/create-employee'
import { nextCompanyCode, queueAheadOf } from '@/lib/onboarding/code-series'
import { approvalsOf, TEAM_LABEL, type Team } from '@/lib/onboarding/approvals'
import { saveCodeAssignment } from '@/lib/onboarding/hr-assignment'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime
export const dynamic = 'force-dynamic'

// ── GET — preview the next auto-suggested code (does NOT consume a number) ──
export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  try {
    const onboarding_id = req.nextUrl.searchParams.get('onboarding_id')
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: cand, error } = await sb.from('onboarding_candidates').select('id, company_id, employment_type, employee_code, full_name').eq('id', onboarding_id).single()
    if (error || !cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    if (cand.employee_code) return NextResponse.json({ suggested: cand.employee_code, already_generated: true, employment_type: cand.employment_type || 'Employee' })

    const { data: company } = await sb.from('companies').select('company_code').eq('id', cand.company_id).single()
    const companyCode = company?.company_code || 'EZ'
    const employmentType = cand.employment_type || 'Employee'
    // The company series' next number (highest in use + 1) and the FIFO queue ahead of this
    // candidate — nothing is reserved until Generate (lib/onboarding/code-series.ts).
    const [next, { ahead }] = await Promise.all([nextCompanyCode(sb as any, cand.company_id, companyCode), queueAheadOf(sb as any, onboarding_id)])
    return NextResponse.json({ suggested: next.code, after: next.after, company_code: companyCode, employment_type: employmentType, fifo_ahead: ahead })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST — roles + team recorded, then the code (atomic) and the employee ──
export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding', 'EDIT')
  if (gate.error) return gate.error
  try {
    const body = await req.json().catch(() => ({}))
    const onboarding_id = String(body.onboarding_id || '')
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })
    const approvals = await approvalsOf(sb as any, onboarding_id)
    const pending = approvals.filter(a => a.status !== 'APPROVED').map(a => TEAM_LABEL[a.team as Team])
    if (pending.length && !body.force) {
      return NextResponse.json({ error: `Waiting on ${pending.join(', ')} approval${pending.length > 1 ? 's' : ''} (ESS → Tasks & Approvals).`, pending }, { status: 409 })
    }
    // FIFO: never out of turn, and never with a typed code (create-employee checks both again).
    const { ahead } = await queueAheadOf(sb as any, onboarding_id)
    if (ahead.length) return NextResponse.json({ error: `${ahead[0].full_name} came into Onboarding first and has no employee code yet — generate theirs before this one.`, fifo_ahead: ahead }, { status: 409 })
    const { user } = gate
    const { data: me } = user.employeeId ? await sb.from('employees').select('full_name').eq('id', user.employeeId).maybeSingle() : { data: null as any }
    // The joining date becomes employees.company_doj — the Today tab, tenure, payroll and the
    // letters all read it. One typed on the wizard is saved first; without one, no code.
    const { data: dojRow } = await sb.from('onboarding_candidates').select('date_of_joining').eq('id', onboarding_id).maybeSingle()
    const typedDoj = body.date_of_joining ? String(body.date_of_joining).slice(0, 10) : ''
    if (typedDoj && !/^\d{4}-\d{2}-\d{2}$/.test(typedDoj)) return NextResponse.json({ error: 'The date of joining must be a date (YYYY-MM-DD).' }, { status: 400 })
    if (typedDoj && typedDoj !== (dojRow?.date_of_joining || '').slice(0, 10)) {
      const { error } = await sb.from('onboarding_candidates').update({ date_of_joining: typedDoj }).eq('id', onboarding_id)
      if (error) return NextResponse.json({ error: `Could not save the date of joining: ${error.message}` }, { status: 500 })
    }
    if (!typedDoj && !dojRow?.date_of_joining) return NextResponse.json({ error: 'Set the date of joining first — it is on the wizard\'s Code step.', needs_doj: true }, { status: 400 })
    const saved = await saveCodeAssignment(sb as any, {
      onboardingId: onboarding_id,
      roleIds: Array.isArray(body.role_ids) ? body.role_ids.map(String) : body.role_id ? [String(body.role_id)] : [],
      team: { direct: Array.isArray(body.team?.direct) ? body.team.direct.map(String) : [], exclude: Array.isArray(body.team?.exclude) ? body.team.exclude.map(String) : [] },
      actorId: user.employeeId, actorName: me?.full_name || user.email || null,
    })
    if (!saved.ok) return NextResponse.json({ error: saved.error, needs_managers: saved.code === 'needs_managers', needs_role: saved.code === 'needs_role' }, { status: saved.status || 500 })

    const r = await createEmployeeFromOnboarding(sb as any, { onboardingId: onboarding_id, customCode: null, by: user.employeeId, notes: body.hr_notes ? String(body.hr_notes) : null, actorType: 'HR' })
    if (!r.ok) return NextResponse.json({ error: r.error, employee_code: r.employee_code, employee_synced: r.employee_synced ?? false, sync_error: r.sync_error, fifo_ahead: r.fifo_ahead }, { status: r.status || 500 })
    const { data: cand } = await sb.from('onboarding_candidates').select('full_name, email').eq('id', onboarding_id).maybeSingle()
    return NextResponse.json({
      success: true, employee_code: r.employee_code, employee_synced: true, docs_emailed: r.docs_emailed, employee_id: r.employee_id, sync_error: null, dept_matched: r.dept_matched,
      role_applied: r.role_applied, role_warnings: r.role_warnings, team_changes: r.team_changes, credentials_mailed: r.credentials_mailed, credentials_error: r.credentials_error || null,
      message: `Employee ID ${r.employee_code} generated for ${cand?.full_name || 'the candidate'}. Master record created${r.credentials_mailed ? `; login details mailed to ${cand?.email}` : ''}.`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
