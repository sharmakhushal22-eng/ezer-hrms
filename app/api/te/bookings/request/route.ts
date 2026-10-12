// POST /api/te/bookings/request — the employee asks the Travel Desk to book a
// stay they have found, with the hotel's details and the page they found it on.
//
// NO ROLE IS CHECKED HERE, deliberately. Every other booking route needs
// Travel Claims EDIT because the desk is acting on somebody else's trip; this
// one is the traveller acting on their own, so the only question is "is this
// your trip?" — and te_booking_request() answers it, raising TE_FORBIDDEN if
// not. Checking a permission here as well would lock the employee out of a
// request meant for them.
//
// It records a REQUEST, not a booking: no PNR, no money moved, and no expense
// line on the trip. The desk's own route writes the expense when it actually
// books, which is the moment a cost exists.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needText, needUuid, optText } from '@/lib/te/errors'
import { TeHttpError } from '@/lib/te/errors'
import { bookingRequest } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** What the employee typed about the stay. Read back whole on the claim desk,
 *  never filtered on, so it travels as one object. */
interface StayDetails {
  address?: string
  room?: string
  platform?: string
  check_in?: string
  check_out?: string
  note?: string
}
interface Body {
  trip_id?: string
  point_seq?: number
  leg_id?: string
  vendor?: string
  amount?: number
  ticket_url?: string
  details?: StayDetails
}

/** A link the employee pasted. Only http(s) is accepted: a javascript: or
 *  data: URL would be stored and later rendered as something clickable. */
function safeLink(raw: string | undefined): string | undefined {
  const v = optText(raw)
  if (!v) return undefined
  let u: URL
  try { u = new URL(v) } catch { throw new TeHttpError(400, 'TE_BAD_REQUEST', 'That booking link is not a web address.') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new TeHttpError(400, 'TE_BAD_REQUEST', 'A booking link must start with http:// or https://.')
  }
  return u.toString()
}

const trim = (v: string | undefined, max: number) => {
  const s = (v ?? '').trim()
  return s ? s.slice(0, max) : undefined
}

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    // The session is resolved FIRST, so somebody who is not signed in is told
    // that rather than being walked through the body checks below. Validating
    // first answered an anonymous POST with 400 and a field name.
    const ctx = await t.ctx()

    const body = await t.body<Body>()
    const amount = Number(body.amount)
    if (!Number.isFinite(amount)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'amount must be a number.')

    const d = body.details ?? {}
    return bookingRequest(ctx, {
      trip_id: needUuid(body.trip_id, 'trip_id'),
      ...(typeof body.point_seq === 'number' ? { point_seq: body.point_seq } : {}),
      ...(body.leg_id ? { leg_id: needUuid(body.leg_id, 'leg_id') } : {}),
      vendor: needText(body.vendor, 'vendor').slice(0, 120),
      amount,
      ...(safeLink(body.ticket_url) ? { ticket_url: safeLink(body.ticket_url) } : {}),
      // Each field is capped: this is free text that ends up on an approver's
      // screen, and an unbounded paste is a denial of service on their eyes.
      details: {
        ...(trim(d.address, 240) ? { address: trim(d.address, 240) } : {}),
        ...(trim(d.room, 80) ? { room: trim(d.room, 80) } : {}),
        ...(trim(d.platform, 60) ? { platform: trim(d.platform, 60) } : {}),
        ...(trim(d.check_in, 10) ? { check_in: trim(d.check_in, 10) } : {}),
        ...(trim(d.check_out, 10) ? { check_out: trim(d.check_out, 10) } : {}),
        ...(trim(d.note, 400) ? { note: trim(d.note, 400) } : {}),
      },
    })
  })
}
