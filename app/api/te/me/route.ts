// GET /api/te/me — everything the signed-in employee's own Travel and Expense
// screens show: settings, places, vehicles, trips, legs, expense lines, claims,
// advances, bookings and the open months. One call (te_snapshot); the UI renders from it.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { me } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => me(await t.ctx()))
}
