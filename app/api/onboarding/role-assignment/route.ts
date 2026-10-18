// app/api/onboarding/role-assignment/route.ts — the HR Manager's Role assignment on the
// onboarding card, after IT, Admin and Payroll have approved.
//
//   GET  ?onboarding_id=…   the candidate, the company's employees (for L1 / L2 / HOD) and the
//                           roles with the module permissions each one grants
//   POST { onboarding_id, l1_manager_id, l2_manager_id?, hod_id?, role_id }
//
// Guarded by the Onboarding module (VIEW to read, EDIT to assign).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { roleOptions, saveRoleAssignment } from '@/lib/onboarding/role-assignment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  const id = req.nextUrl.searchParams.get('onboarding_id') || ''
  if (!id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })
  const out = await roleOptions(sb as any, id)
  if (!out) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding', 'EDIT')
  if (gate.error) return gate.error
  const body = await req.json().catch(() => ({}))
  const { user } = gate
  const { data: me } = user.employeeId ? await sb.from('employees').select('full_name').eq('id', user.employeeId).maybeSingle() : { data: null as any }
  const out = await saveRoleAssignment(sb as any, {
    onboardingId: String(body.onboarding_id || ''), l1: String(body.l1_manager_id || ''), l2: body.l2_manager_id ? String(body.l2_manager_id) : null, hod: body.hod_id ? String(body.hod_id) : null,
    roleId: String(body.role_id || ''), actorId: user.employeeId, actorName: me?.full_name || user.email || null,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status || 500 })
  return NextResponse.json(out)
}
