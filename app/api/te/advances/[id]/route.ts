// POST /api/te/advances/[id] — the Finance desk acts on a trip advance.
// Body: { action, amount?, ref? }
//   pay      pay the advance of an approved trip (amount up to what was asked, ref = bank reference)
//   reject   refuse it
//   refund   the employee returned what was left (amount, ref)
//   payroll  what is left is recovered through payroll
//   carry    what is left moves to another approved trip of the same employee
// Two gates: the dashboard Finance permission here, and the SQL
// function's own rule that only a Finance team member who may pay can do it.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needUuid, optText } from '@/lib/te/errors'
import { advanceAct } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['pay', 'reject', 'refund', 'payroll', 'carry'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const advanceId = needUuid(id, 'Advance')
    const body = await t.body<{ action?: string; amount?: number; ref?: string }>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    if (body.amount !== undefined && !(typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0)) {
      throw new TeHttpError(400, 'TE_BAD_REQUEST', 'amount must be a number.')
    }
    await t.permit('Finance', 'VIEW')
    const o: { amount?: number; ref?: string } = {}
    if (body.amount !== undefined) o.amount = body.amount
    const ref = optText(body.ref)
    if (ref) o.ref = ref
    return advanceAct(await t.ctx(), advanceId, action, o)
  })
}
