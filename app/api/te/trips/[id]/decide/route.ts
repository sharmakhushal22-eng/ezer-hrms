// POST /api/te/trips/[id]/decide — the approver whose turn it is approves,
// sends back or rejects a trip plan. Body: { action, comment }.
// No role check here: the SQL function knows whose step it is (and who their
// live delegate is) and refuses everybody else with TE_NOT_WAITING.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needUuid, optText } from '@/lib/te/errors'
import { tripDecide } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['approve', 'sendback', 'reject'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const body = await t.body<{ action?: string; comment?: string }>()
    return tripDecide(await t.ctx(), needUuid(id, 'Trip'), needOneOf(body.action, ACTIONS, 'action'), optText(body.comment))
  })
}
