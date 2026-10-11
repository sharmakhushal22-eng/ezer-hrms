// POST /api/te/periods — close, reopen, roll forward or lock an expense month.
// Body: { month: 'YYYY-MM', action: 'close' | 'reopen' | 'roll' | 'lock', reason? }
//   close   no new claims are filed into the month
//   reopen  needs a reason of at least 10 characters
//   roll    unfinished claims move to the next open month, marked late
//   lock    final, after payout. Refused while the month has unfinished claims
// The months themselves are listed by GET /api/te/finance/overview?view=periods.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, optText } from '@/lib/te/errors'
import { periodAct } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{ month?: string; action?: string; reason?: string }>()
    const m = /^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/.exec(String(body.month ?? ''))
    if (!m) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'month must look like 2026-11.')
    const action = needOneOf(body.action, ['close', 'reopen', 'roll', 'lock'] as const, 'action')
    await t.permit('Finance', 'VIEW')
    return periodAct(await t.ctx(), await t.company(), `${m[1]}-${m[2]}-01`, action, optText(body.reason))
  })
}
