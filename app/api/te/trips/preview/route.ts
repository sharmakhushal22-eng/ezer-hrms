// POST /api/te/trips/preview — check a plan while it is being filled in:
// problems, the legs it becomes, the estimate, the advance cap, who will
// approve. Saves nothing (it may cache road distances it had to look up).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { tripPreview } from '@/lib/te/engine/te-service.js'
import type { TripDraft } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => tripPreview(await t.ctx(), await t.body<TripDraft>()))
}
