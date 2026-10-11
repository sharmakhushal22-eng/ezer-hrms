// POST /api/te/trips/[id]/legs — a leg nobody planned: a ride at the
// destination, or a change of plan. Body: { from, to, mode, vehicleId, why }.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { legAdd } from '@/lib/te/engine/te-service.js'
import type { ExtraLegInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => legAdd(await t.ctx(), needUuid(id, 'Trip'), await t.body<ExtraLegInput>()))
}
