// POST /api/te/adjustments — a correction after a claim is paid. The paid claim
// is never edited: Finance records what is to be recovered from the employee or
// paid to them. Body: { claim_id, direction: 'recover' | 'pay', amount, reason }.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needText, needUuid } from '@/lib/te/errors'
import { adjustmentAdd } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{ claim_id?: string; direction?: string; amount?: number; reason?: string }>()
    const claimId = needUuid(body.claim_id, 'claim_id')
    const direction = needOneOf(body.direction, ['recover', 'pay'] as const, 'direction')
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'amount must be a number.')
    const reason = needText(body.reason, 'reason')
    await t.permitDesk('finance', 'Finance', 'VIEW')
    return adjustmentAdd(await t.ctx(), claimId, direction, body.amount, reason)
  })
}
