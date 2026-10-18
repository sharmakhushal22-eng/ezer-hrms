// POST /api/te/adjustments/[id] — close a correction.
// Body: { action: 'done' | 'cancel', reference? }   done = the money has moved (reference = bank or payroll reference)
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needUuid, optText } from '@/lib/te/errors'
import { adjustmentClose } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const adjustmentId = needUuid(id, 'Adjustment')
    const body = await t.body<{ action?: string; reference?: string }>()
    const action = needOneOf(body.action, ['done', 'cancel'] as const, 'action')
    await t.permit('Finance', 'VIEW')
    return adjustmentClose(await t.ctx(), adjustmentId, action, optText(body.reference))
  })
}
