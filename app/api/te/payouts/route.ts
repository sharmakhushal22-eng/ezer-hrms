// GET  /api/te/payouts            the company's payout batches with their items, newest first (paginated; ?status=)
// POST /api/te/payouts            put verified claims into a new batch
//                                 body: { route: 'PAYROLL' | 'OFF_CYCLE', claim_ids?: [...] }   (no claim_ids = all that are waiting)
// Needs the dashboard Finance permission; the SQL
// function also requires a Finance team member who may pay.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, needOneOf, rpcError } from '@/lib/te/errors'
import { payoutCreate } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Finance', 'VIEW')
    const company = await t.company()
    const page = t.page()
    const status = req.nextUrl.searchParams.get('status')
    let r = t.sb().from('te_payout_batches')
      .select('*, items:te_payout_items(id, claim_id, employee_id, amount, status, bank_ref, failure_reason)', { count: 'exact' })
      .eq('company_id', company)
    if (status && /^[A-Z_]{1,30}$/.test(status)) r = r.eq('status', status)
    const { data, count, error } = await r.order('created_at', { ascending: false }).range(page.from, page.to)
    if (error) throw rpcError(error, 'te_payout_batches')
    return { company_id: company, rows: data ?? [], total: count ?? 0, limit: page.limit, offset: page.offset }
  })
}

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{ route?: string; claim_ids?: unknown }>()
    const route = needOneOf(body.route, ['PAYROLL', 'OFF_CYCLE'] as const, 'route')
    let claimIds: string[] | null = null
    if (body.claim_ids !== undefined && body.claim_ids !== null) {
      if (!Array.isArray(body.claim_ids) || !body.claim_ids.length || !body.claim_ids.every(isUuid)) {
        throw new TeHttpError(400, 'TE_BAD_REQUEST', 'claim_ids must be a list of claim ids.')
      }
      claimIds = body.claim_ids as string[]
    }
    await t.permit('Finance', 'VIEW')
    return payoutCreate(await t.ctx(), await t.company(), route, claimIds)
  })
}
