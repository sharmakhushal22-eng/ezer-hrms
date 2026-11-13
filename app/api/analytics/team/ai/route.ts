// app/api/analytics/team/ai/route.ts — the AI read of a manager's team (ESS).
//
// GET ?scope=TEAM|DEPT (&refresh=1)  — the same gate as ../route.ts.
//
// The model sees the team as P1, P2… (lib/analytics/ai/facts.ts teamFacts); names
// are put back on the server after the answer has passed the number check.
import { NextRequest, NextResponse } from 'next/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { teamAnalytics } from '@/lib/analytics/server/team'
import { teamFacts } from '@/lib/analytics/ai/facts'
import { aiBrief } from '@/lib/analytics/server/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const asked = (req.nextUrl.searchParams.get('scope') || '').toUpperCase()
  const scope: 'TEAM' | 'DEPT' = asked === 'DEPT' && ctx.menu.is_hod ? 'DEPT' : (!ctx.menu.is_rm && ctx.menu.is_hod ? 'DEPT' : 'TEAM')
  if (scope === 'TEAM' && !ctx.menu.is_rm) return forbidden('Nobody reports to you, so there is no team to show.')
  try {
    const team = await teamAnalytics(ctx.caller.employeeId, ctx.grant.name || 'You', scope, ctx.companyId)
    if (!team.members.length) return NextResponse.json({ status: 'empty', brief: null, cached: false, stale: false, message: 'Nobody reports to you in this view yet.' })
    const out = await aiBrief(teamFacts(team), { actor: ctx.caller.actorEmployeeId || ctx.caller.employeeId, refresh: req.nextUrl.searchParams.get('refresh') === '1' })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not write the AI read.' }, { status: 500 })
  }
}
