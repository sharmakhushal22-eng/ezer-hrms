// app/api/analytics/team/route.ts — a manager's team insights (ESS).
//
// GET ?scope=TEAM|DEPT  (&employee_id= for the admin "view as" preview)
//
// Who: anyone with direct reports (TEAM) or who heads a department (DEPT). The people
// come from the reporting line in the database — the request can only choose between
// the two scopes the caller already holds.
import { NextRequest, NextResponse } from 'next/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { teamAnalytics } from '@/lib/analytics/server/team'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const asked = (req.nextUrl.searchParams.get('scope') || '').toUpperCase()
  const scope: 'TEAM' | 'DEPT' = asked === 'DEPT' && ctx.menu.is_hod ? 'DEPT' : (!ctx.menu.is_rm && ctx.menu.is_hod ? 'DEPT' : 'TEAM')
  if (scope === 'TEAM' && !ctx.menu.is_rm) return forbidden('Nobody reports to you, so there is no team to show.')
  try {
    const body = await teamAnalytics(ctx.caller.employeeId, ctx.grant.name || 'You', scope, ctx.companyId)
    return NextResponse.json({ ...body, canDept: ctx.menu.is_hod, canTeam: ctx.menu.is_rm }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not build the team view.' }, { status: 500 })
  }
}
