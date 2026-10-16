// GET /api/te/trips/[id] — one trip with everything on it: legs, lines, claims,
// advance, bookings, messages, timeline, and whether the caller may act on it.
// Open to the employee, the people on its approval chain, the Finance team,
// and anyone whose role grants Travel Claims or Finance (view) in that company.
import { NextRequest } from 'next/server'
import { teOpen, teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { tripDetail } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const tripId = needUuid(id, 'Trip')
    const ctx = await t.ctx()
    return teOpen(t, 'trip', tripId, admin => tripDetail(ctx, tripId, admin))
  })
}
