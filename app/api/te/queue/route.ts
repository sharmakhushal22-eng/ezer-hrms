// GET /api/te/queue — what is waiting for the caller right now: trip plans and
// claims whose current step is theirs (or their delegator's), and Finance-team
// steps when they are in the team. The four-eyes rules are already applied, so
// every row here is one the caller can act on. An employee who approves
// nothing gets an empty list.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { queue } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => ({ queue: await queue(await t.ctx()) }))
}
