// app/api/analytics/me/ai/route.ts — the AI read of an employee's own record (ESS).
//
// GET (&refresh=1). Identity from the session, as in ../route.ts. The fact sheet
// (lib/analytics/ai/facts.ts myFacts) carries no name, code, department, designation
// or birthday — the pattern of a record, not whose record it is.
import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'
import { myAnalytics } from '@/lib/analytics/server/me'
import { myFacts } from '@/lib/analytics/ai/facts'
import { aiBrief } from '@/lib/analytics/server/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  try {
    const mine = await myAnalytics(r.ctx.caller.employeeId)
    const out = await aiBrief(myFacts(mine), { actor: r.ctx.caller.actorEmployeeId || r.ctx.caller.employeeId, refresh: req.nextUrl.searchParams.get('refresh') === '1' })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not write the AI read.' }, { status: 500 })
  }
}
