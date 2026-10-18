// GET /api/te/admin/reports/approvers — F2 and F3, the two checks about
// approvers rather than about claims.
//
// WHY THIS IS A REPORT AND NOT A FLAG. Every other check looks at one claim
// and raises something on it. These look at a person's history: "this claim
// was approved in four seconds" is not a finding, and "this approver has
// cleared nineteen flagged claims in under a minute each" is. There is nothing
// useful to put on any single claim, so there is nothing for the engine to do
// and no flag for anybody to resolve.
//
// WHO MAY READ IT. Full access to Travel Claims, or view access to Finance —
// the same pair the flag report takes. Deliberately NOT every approver's own
// manager by default: this is a report about how approvals are being done, and
// widening who sees it is an administrator's decision rather than an implicit
// one.
//
// The window is the decision date and defaults to the last 90 days of the
// company's own calendar.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError } from '@/lib/te/errors'
import type { TeApproverWatch } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A date the caller typed, or nothing. An unparseable one is ignored rather
 *  than refused: the function then picks its own window. */
const asDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    // Being ON the Finance desk counts as the Finance access this asks
    // for. The role permission and desk membership had drifted apart: the
    // Finance Controller, who holds no dashboard role at all, could open
    // the Finance desk and was refused the reports that say they are open
    // to Finance. Same population, same intent, so the same gate.
    if (!(await t.holds('Travel Claims', 'FULL')) && !(await t.holds('Finance', 'VIEW')) && !(await t.onDesk('finance'))) {
      throw new TeHttpError(403, 'TE_FORBIDDEN',
        'The approver report needs full access to Travel Claims, or view access to Finance.')
    }
    const company = await t.company()
    const q = req.nextUrl.searchParams
    return t.db().rpc<TeApproverWatch>('te_approver_watch', {
      p_company: company,
      p_from: asDate(q.get('from')),
      p_to: asDate(q.get('to')),
    })
  })
}
