// GET /api/te/dashboard?from=&to= — the Reports and Dashboard tab.
//
// Four things in one read, because they are drawn on one screen and share one
// date window: my own requests, my approval scorecard, what I acted on, and
// my team read-only. Three routes would be three chances for the numbers on
// one screen to disagree with each other.
//
// NO ROLE IS CHECKED HERE, deliberately. Every employee has this tab. What
// they see is decided by the data, not by a permission: somebody who approves
// nothing gets an empty scorecard, and somebody with no reports gets an empty
// team. te_dashboard reads only what belongs to the caller or to the people
// who report to them, so there is nothing to gate.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { dashboard } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A date the caller typed, or nothing. An unparseable one is ignored rather
 *  than refused: the function falls back to the current month, which is the
 *  sensible answer to "show me the dashboard". */
const asDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    const q = req.nextUrl.searchParams
    return dashboard(await t.ctx(), asDate(q.get('from')), asDate(q.get('to')))
  })
}
