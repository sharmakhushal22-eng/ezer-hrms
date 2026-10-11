// POST /api/te/vehicles/[id]/verify — HR or the Travel Desk looked at the RC
// photo and confirms (or corrects) the vehicle type.
//
// The SQL function refuses only "your own vehicle"; it trusts this route to
// have checked the role, so the role and the company are checked here.
import { NextRequest } from 'next/server'
import { tePermitFor, teRoute } from '@/lib/te/server'
import { needUuid, optText } from '@/lib/te/errors'
import { vehicleVerify } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const vehicleId = needUuid(id, 'Vehicle')
    const body = await t.body<{ type_code?: string }>()
    await tePermitFor(t, 'te_employee_vehicles', vehicleId, 'Travel Claims', 'EDIT')
    return vehicleVerify(await t.ctx(), vehicleId, optText(body.type_code))
  })
}
