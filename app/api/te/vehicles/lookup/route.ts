// GET /api/te/vehicles/lookup?reg=HR26DK4821 — what the RC says about a number,
// before the employee adds the vehicle. The owner's name comes back masked
// unless it is the employee's own. With no RC provider configured every number
// answers { notFound: true } and the screen asks for a photo of the RC.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needText } from '@/lib/te/errors'
import { vehicleLookup } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => vehicleLookup(await t.ctx(), needText(req.nextUrl.searchParams.get('reg'), 'reg')))
}
