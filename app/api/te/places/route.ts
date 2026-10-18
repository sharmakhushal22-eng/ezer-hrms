// POST /api/te/places — the employee saves a place: pinned by GPS, typed as an
// address, or picked from a map search. The address checks (PIN matches the
// state) and the "is this a place I already have?" check are in the service.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { placeAdd } from '@/lib/te/engine/te-service.js'
import type { PlaceInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => placeAdd(await t.ctx(), await t.body<PlaceInput>()))
}
