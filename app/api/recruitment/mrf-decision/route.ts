// /api/recruitment/mrf-decision — the dashboard's MRF approval (Recruitment → MRF Review modal
// and the HR Head tab). Used to be a direct Supabase write from the browser that set APPROVED
// with nobody assigned; now it goes through lib/recruitment/mrf-approve.ts, which refuses
// to open a requisition without a hiring manager of its own company.
//   GET  ?company_ids=a,b  → { recruiters: { [company_id]: [{ id, name, code }] } }
//   POST { id, assigned_hr_ids: string[], note? }
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { approveMrf, hrTeamFor } from '@/lib/recruitment/mrf-approve'
import { cleanIds } from '@/lib/recruitment/mrf-handoff'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const ids = (req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)
  const recruiters: Record<string, { id: string; name: string; code: string }[]> = {}
  await Promise.all(ids.map(async id => { recruiters[id] = (await hrTeamFor(sb as any, id)).map(({ id, name, code }) => ({ id, name, code })) }))
  return NextResponse.json({ recruiters })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  let actor: { id: string | null; name: string | null; code: string | null } = { id: gate.user.employeeId, name: gate.user.email, code: null }
  if (gate.user.employeeId) {
    const { data: e } = await sb.from('employees').select('full_name, emp_code').eq('id', gate.user.employeeId).maybeSingle()
    if (e) actor = { id: gate.user.employeeId, name: e.full_name, code: e.emp_code }
  }
  // Holding the Recruitment module is not the same as being an approver. Only a super admin
  // (or the shared admin login) may decide past the chain; anyone else approves the step that
  // is actually waiting on them, exactly as /api/ess/mrf does.
  const grant = await grantForRequest(req)
  const override = grant.isSuperAdmin || grant.legacy
  const out = await approveMrf(sb as any, {
    id, actor, note: body.note || null, assignIds: cleanIds(body.assigned_hr_ids),
    mode: override ? 'final' : 'step', mustBeApprover: !override,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
