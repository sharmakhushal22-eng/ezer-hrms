// app/api/onboarding/team-plan/route.ts — Generate code, step "Team": the reporting-line plan
// for the people who will report to the joiner.
//
//   GET ?onboarding_id=…&codes=STC9022,STC9007&exclude=<id>,<id>
//       → { joiner: {l1,l2,hod}, direct, unknown, members, problems, summary, names }
//
// `codes` are employee codes (or ids) HR pasted; `exclude` are members HR unticked. Nothing is
// written — the plan is applied when the code is generated (lib/onboarding/hr-assignment.ts).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { teamPlanFor } from '@/lib/onboarding/hr-assignment'
import { parseCodes } from '@/lib/onboarding/team-plan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  const q = req.nextUrl.searchParams
  const id = q.get('onboarding_id') || ''
  if (!id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })
  // Ids are case-sensitive UUIDs, codes are not — parseCodes upper-cases, so ids come separately.
  const codes = [...parseCodes(q.get('codes') || ''), ...(q.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)]
  const exclude = (q.get('exclude') || '').split(',').map(s => s.trim()).filter(Boolean)
  const out = await teamPlanFor(sb as any, id, codes, exclude)
  if (!out) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })
  return NextResponse.json(out)
}
