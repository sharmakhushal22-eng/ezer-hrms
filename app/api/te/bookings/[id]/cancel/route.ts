// POST /api/te/bookings/[id]/cancel — the Travel Desk cancels a booking (the
// ticket was cancelled, or booked again). Body: { reason }. Refused once the
// booking's line is part of a claim.
import { NextRequest } from 'next/server'
import { tePermitFor, teRoute } from '@/lib/te/server'
import { needText, needUuid } from '@/lib/te/errors'
import { bookingCancel } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const bookingId = needUuid(id, 'Booking')
    const body = await t.body<{ reason?: string }>()
    const reason = needText(body.reason, 'reason')
    await tePermitFor(t, 'te_bookings', bookingId, 'Travel Claims', 'EDIT')
    return bookingCancel(await t.ctx(), bookingId, reason)
  })
}
