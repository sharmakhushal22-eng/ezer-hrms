// POST /api/te/bookings — the Travel Desk records a ticket or a hotel stay it
// booked and paid for. Body: { trip_id, leg_id | point_seq, vendor, reference, amount, ticket_url? }.
// The booking also becomes a company-paid line of the trip, so the trip cost
// sheet shows it and the employee cannot claim the same ticket.
//
// The SQL function does not check who the caller is; the role (Travel Claims,
// edit) and the trip's company are checked here.
import { NextRequest } from 'next/server'
import { tePermitFor, teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, needText, needUuid, optText } from '@/lib/te/errors'
import { bookingRecord, type BookingInput } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<Partial<BookingInput>>()
    const tripId = needUuid(body.trip_id, 'trip_id')
    if (body.leg_id !== undefined && body.leg_id !== null && !isUuid(body.leg_id)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'leg_id is not a valid id.')
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'amount must be a number.')
    const input: BookingInput = { trip_id: tripId, vendor: needText(body.vendor, 'vendor'), reference: needText(body.reference, 'reference'), amount: body.amount }
    if (body.leg_id) input.leg_id = body.leg_id
    if (typeof body.point_seq === 'number') input.point_seq = body.point_seq
    const ticket = optText(body.ticket_url)
    if (ticket) input.ticket_url = ticket
    await tePermitFor(t, 'te_trips', tripId, 'Travel Claims', 'EDIT')
    return bookingRecord(await t.ctx(), input)
  })
}
