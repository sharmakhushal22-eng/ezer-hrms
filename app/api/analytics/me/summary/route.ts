// app/api/analytics/me/summary/route.ts — an employee's month in three lines (ESS → Insights).
//
// GET (&refresh=1). Identity from the session. The fact sheet (lib/analytics/ai/facts.ts
// myFacts) carries no name, code, department, designation or birthday. Always answers:
// the template lines when AI is off or its answer fails the check.
import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'
import { myAnalytics } from '@/lib/analytics/server/me'
import { summaryFor } from '@/lib/analytics/server/pieces'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  try {
    const mine = await myAnalytics(r.ctx.caller.employeeId)
    const out = await summaryFor(mine, { actor: r.ctx.caller.actorEmployeeId || r.ctx.caller.employeeId, refresh: req.nextUrl.searchParams.get('refresh') === '1' })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not write your summary.' }, { status: 500 })
  }
}
