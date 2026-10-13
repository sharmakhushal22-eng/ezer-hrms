// GET /api/te/admin/health — "is this company ready to use Travel and
// Expenses?" One row per check with ok / warn / fail and what to do about it
// (te_health). Read-only. Shown on Admin > Setup check; run it after the
// migrations and after go-live changes to the org structure.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import type { TeHealthRow } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    const health = await t.db().rpc<TeHealthRow[]>('te_health', { p_company_id: company })
    const worst = health.some(h => h.status === 'fail') ? 'fail' : health.some(h => h.status === 'warn') ? 'warn' : 'ok'
    return { company_id: company, status: worst, health }
  })
}
