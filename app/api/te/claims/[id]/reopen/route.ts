// POST /api/te/claims/[id]/reopen — reopen a rejected claim, with a reason,
// until its month is locked. Body: { reason }. The SQL function decides who may
// (a Finance member, never the claimant).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needText, needUuid } from '@/lib/te/errors'
import { claimReopen } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const body = await t.body<{ reason?: string }>()
    return claimReopen(await t.ctx(), needUuid(id, 'Claim'), needText(body.reason, 'reason'))
  })
}
