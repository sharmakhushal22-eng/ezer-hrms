// POST /api/te/claims/[id]/action — what the employee does to their own claim.
//   { action: 'respond', text }   answer a send-back. The lines were corrected through
//                                 POST /api/te/expenses; every check runs again here.
//   { action: 'recall' }          take the claim back (before an approver has acted, or while sent back)
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needText, needUuid } from '@/lib/te/errors'
import { claimRecall, claimRespond } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['respond', 'recall'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const claimId = needUuid(id, 'Claim')
    const body = await t.body<{ action?: string; text?: string }>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    const ctx = await t.ctx()
    return action === 'respond' ? claimRespond(ctx, claimId, needText(body.text, 'text')) : claimRecall(ctx, claimId)
  })
}
