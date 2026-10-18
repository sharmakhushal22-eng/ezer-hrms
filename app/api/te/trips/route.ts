// POST /api/te/trips — plan a trip, record one already travelled
// (origin: 'POST_FACTO'), or edit one (id set). The engine checks the plan;
// a blocked plan is refused with code TE_TRIP, the field and the full issue list.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { tripSave } from '@/lib/te/engine/te-service.js'
import type { TripDraft } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => tripSave(await t.ctx(), await t.body<TripDraft>()))
}
