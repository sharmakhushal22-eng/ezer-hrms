// POST /api/te/stay — the Travel Desk answers the hotels an employee suggested.
//
// Body: { tripId, action: 'choose' | 'reject', choice?: number, remark?: string }
//
// WHY Travel Claims EDIT. This is the desk acting on somebody else's trip, the
// same footing as recording a booking, so it takes the same permission. The
// employee's own way into their stay is /api/te/bookings/request, which checks
// ownership in SQL instead — the two are deliberately different because the
// question is different: "is this my trip" there, "do you run the desk" here.
// te_stay_decide checks TRAVEL DESK membership again regardless — migration 164
// moved it off te_finance_members, which this comment still named — so a
// permission that drifted cannot turn into an outsider picking the hotel.
//
// IT DOES NOT STOP A DESK MEMBER CHOOSING THEIR OWN. This comment used to claim
// it did. te_stay_decide compares p_actor only against te_desk_members and has
// no p_actor = t.employee_id guard, so a traveller who is on the travel desk
// answers their own request — the thing the function's own preamble calls
// meaningless. te_vehicle_verify has exactly that guard ("Nobody verifies their
// own vehicle"); this does not. Migration 175 widened te_desk_members to every
// active member, so the gap now reaches more people, not fewer.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needUuid, optText, TeHttpError } from '@/lib/te/errors'
import { stayDecide } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Body { tripId?: unknown; action?: unknown; choice?: unknown; remark?: unknown }

/** The remark lands in the audit log and on the employee's trip screen, so it
 *  is capped: an unbounded paste is a denial of service on their eyes. */
const capped = (v: unknown, max: number) => {
  const s = optText(v)
  return s ? s.slice(0, max) : null
}

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    // Who is calling is resolved before the body is read, so an anonymous
    // request is told to sign in rather than told which field it got wrong.
    const ctx = await t.ctx()
    await t.permit('Travel Claims', 'EDIT')
    const b = await t.body<Body>()

    const action = needOneOf(b.action, ['choose', 'reject'] as const, 'action')
    const remark = capped(b.remark, 400)

    if (action === 'reject' && !remark) {
      // The SQL refuses this too. Saying it here means the desk is told before
      // the round trip, and in the same words.
      throw new TeHttpError(400, 'TE_STAY', 'Say why none of these work, so they know what to look for.')
    }

    let choice: number | undefined
    if (action === 'choose') {
      choice = Number(b.choice)
      if (!Number.isInteger(choice) || choice < 0) {
        throw new TeHttpError(400, 'TE_STAY', 'Pick one of the hotels that was suggested.')
      }
    }

    return stayDecide(ctx, {
      trip_id: needUuid(b.tripId, 'tripId'),
      action,
      ...(choice === undefined ? {} : { choice }),
      ...(remark ? { remark } : {}),
    })
  })
}
