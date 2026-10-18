// POST /api/te/claims/preview — the review screen before submit: totals, every
// flag, what is capped, the net against the advance, who will approve.
// Body: { tripId? , lineIds?, note? }. No tripId = the "other expenses" claim.
// No lineIds = every saved line of that trip (or every saved line with no trip).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { claimPreview } from '@/lib/te/engine/te-service.js'
import type { ClaimInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => claimPreview(await t.ctx(), await t.body<ClaimInput>()))
}
