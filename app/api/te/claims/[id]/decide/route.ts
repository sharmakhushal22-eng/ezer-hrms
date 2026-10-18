// POST /api/te/claims/[id]/decide — an approver or a Finance member decides a claim.
//
//   approval levels   action: approve | sendback | reject
//   finance levels    action: verify  | hold     | sendback | reject
//
// Body: { action, stage?, comment?, decisions?, fix? }
//   stage      'manager' or 'finance'. Optional: verify and hold are always
//              finance, approve is always an approval level; for sendback and
//              reject the stage the claim is in right now is used.
//   decisions  { <line id>: { amount?, reject?: 'final' | 'refile', reason? } }  reduce or reject single lines
//   fix        [<line id>, …]  the lines the employee must correct (send-back)
//
// No role check here: the SQL functions know whose step it is, who is in the
// Finance team, and that nobody decides their own claim.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needUuid, rpcError } from '@/lib/te/errors'
import { claimDecide, claimFinance } from '@/lib/te/engine/te-service.js'
import type { DecideInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MANAGER = ['approve', 'sendback', 'reject'] as const
const FINANCE = ['verify', 'hold', 'sendback', 'reject'] as const
const ALL = ['approve', 'verify', 'hold', 'sendback', 'reject'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const claimId = needUuid(id, 'Claim')
    const body = await t.body<DecideInput & { action?: string; stage?: string }>()
    const action = needOneOf(body.action, ALL, 'action')
    const ctx = await t.ctx()

    let stage = body.stage === undefined ? null : needOneOf(body.stage, ['manager', 'finance'] as const, 'stage')
    if (!stage && (action === 'verify' || action === 'hold')) stage = 'finance'
    if (!stage && action === 'approve') stage = 'manager'
    if (!stage) {
      const { data, error } = await t.sb().from('te_claims').select('status').eq('id', claimId).maybeSingle()
      if (error) throw rpcError(error, 'te_claims')
      stage = data?.status === 'IN_VERIFICATION' || data?.status === 'ON_HOLD' ? 'finance' : 'manager'
    }

    const o: DecideInput = { comment: body.comment, decisions: body.decisions, fix: body.fix }
    if (stage === 'finance') {
      if (action === 'approve') throw new TeHttpError(400, 'TE_BAD_REQUEST', `At a finance level the action is one of: ${FINANCE.join(', ')}.`)
      return claimFinance(ctx, claimId, action, o)
    }
    if (action === 'verify' || action === 'hold') throw new TeHttpError(400, 'TE_BAD_REQUEST', `At an approval level the action is one of: ${MANAGER.join(', ')}.`)
    return claimDecide(ctx, claimId, action, o)
  })
}
