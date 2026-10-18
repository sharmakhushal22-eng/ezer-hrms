// POST /api/te/admin/workflow/[code]/reset — put one workflow back to the chain
// the product ships with (claim: reporting manager -> head of department when
// conditions apply -> Finance team; trip: reporting manager -> head of department).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf } from '@/lib/te/errors'
import { workflowReset } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return teRoute(req, async t => {
    const workflow = needOneOf(code, ['claim', 'trip'] as const, 'workflow')
    await t.permit('Travel Claims', 'FULL')
    return workflowReset(await t.ctx(), await t.company(), workflow)
  })
}
