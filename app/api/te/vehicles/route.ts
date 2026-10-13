// POST /api/te/vehicles — add a vehicle the employee drives. The RC is looked
// up again on the server: what the browser saw in /lookup is never trusted.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needText } from '@/lib/te/errors'
import { vehicleAdd } from '@/lib/te/engine/te-service.js'
import type { VehicleInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<VehicleInput>()
    needText(body.reg, 'reg')
    return vehicleAdd(await t.ctx(), body)
  })
}
