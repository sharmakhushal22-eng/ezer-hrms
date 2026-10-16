// GET /api/te/claims/[id] — one claim with everything on it: lines, legs, line
// decisions, advance, messages, timeline, and whether the caller may act.
// Open to the employee, the people on its approval chain, the Finance team,
// and anyone whose role grants Travel Claims or Finance (view) in that company.
import { NextRequest } from 'next/server'
import { teOpen, teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { claimDetail } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const claimId = needUuid(id, 'Claim')
    const ctx = await t.ctx()
    return teOpen(t, 'claim', claimId, admin => claimDetail(ctx, claimId, admin))
  })
}
