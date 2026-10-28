// POST /api/te/legs/[id]/review — what a DESK does about one journey.
//
//   action      body                what happens
//   confirm     { desk }            that desk agrees the journey happened as recorded
//   send-back   { desk, reason }    that desk asks the traveller for something
//
// desk = 'travel' | 'finance'.
//
// WHY THIS IS NOT ../action. That route is "everything the employee does on
// their own leg" and every one of its cases goes through te__leg_for_actor,
// which refuses anybody else's. These two are the opposite: the caller is
// explicitly NOT the traveller, and the right being checked is membership of a
// desk that answers for the journey's company. Two permission models behind one
// `action` switch is how a case ends up guarded by the wrong one.
//
// WHO IS CHECKED, AND WHERE. te__journey_desk_actor in migration 180 does it,
// in SQL: on that desk at all (te_on_desk), and that desk answers for this
// journey's company — a member of Company A's travel desk has no business
// confirming Company B's cab rides. This route adds no permission logic of its
// own on purpose; there is exactly one place that decides, and it is the floor.
//
// CONFIRMING PAYS NOTHING and sending back takes nothing away. The amount is
// the claim's, settled by the approval chain and by Finance on the claim
// itself. What these two record is whether a human looked, and what they asked
// for first. The one thing a send-back does do is hold the trip's claim, which
// is the point: letting it through would ask the approver to sign off the very
// thing a desk has just queried.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needText, needUuid } from '@/lib/te/errors'
import { legConfirm, legSendBack } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['confirm', 'send-back'] as const
const DESKS = ['travel', 'finance'] as const

interface Body {
  action?: string
  desk?: string
  reason?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const legId = needUuid(id, 'Journey')
    const body = await t.body<Body>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    const desk = needOneOf(body.desk, DESKS, 'desk')
    const ctx = await t.ctx()
    switch (action) {
      case 'confirm': return legConfirm(ctx, legId, desk)
      // The reason is required here as well as in SQL, so the message names the
      // field while the form is still open rather than after a round trip.
      case 'send-back': return legSendBack(ctx, legId, desk, needText(body.reason, 'reason'))
    }
  })
}
