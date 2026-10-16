// POST /api/te/flags/[id] — Finance dismisses or confirms a flag on a claim in
// verification, with a reason. Body: { status: 'dismissed' | 'confirmed', note }.
// The claim's risk score follows. The SQL function refuses anyone outside the Finance team.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needText, needUuid } from '@/lib/te/errors'
import { flagResolve } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const body = await t.body<{ status?: string; note?: string }>()
    return flagResolve(await t.ctx(), needUuid(id, 'Flag'), needOneOf(body.status, ['dismissed', 'confirmed'] as const, 'status'), needText(body.note, 'note'))
  })
}
