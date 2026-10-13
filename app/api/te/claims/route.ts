// POST /api/te/claims — submit a claim. Body: { tripId?, lineIds?, note?, declared: true }.
// Every check runs again on the server at this moment; the browser's preview is
// not trusted. Refused with TE_CLAIM (and the flags) while a line is blocked,
// a reason is missing, or the declaration is not accepted.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { claimSubmit } from '@/lib/te/engine/te-service.js'
import type { ClaimInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => claimSubmit(await t.ctx(), await t.body<ClaimInput>()))
}
