// GET /api/te/admin/audit — the audit log of the company, newest first.
// Every create, submit, approve, reduce, reject, pay and settings change is one
// row (te_audit_log is append-only). Filters: entity_type, entity_id, action,
// actor_id, from, to (YYYY-MM-DD). Paginated: ?limit= (50, at most 200), ?offset=.
// ?detail=1 adds the before/after JSON of each row (large for settings changes).
// Needs full access to the Travel Claims module.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, rpcError } from '@/lib/te/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SLIM = 'id, entity_type, entity_id, entity_ref, action, actor_id, actor_role, summary, employee_visible, at'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    const q = req.nextUrl.searchParams
    const page = t.page()
    let r = t.sb().from('te_audit_log').select(q.get('detail') === '1' ? `${SLIM}, before, after` : SLIM, { count: 'exact' }).eq('company_id', company)
    const word = (k: string) => { const v = q.get(k); return v && /^[A-Za-z_]{1,60}$/.test(v) ? v : null }
    const id = (k: string) => { const v = q.get(k); if (v && !isUuid(v)) throw new TeHttpError(400, 'TE_BAD_REQUEST', `${k} is not a valid id.`); return v }
    const day = (k: string) => { const v = q.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
    const entityType = word('entity_type'); if (entityType) r = r.eq('entity_type', entityType)
    const action = word('action'); if (action) r = r.eq('action', action)
    const entityId = id('entity_id'); if (entityId) r = r.eq('entity_id', entityId)
    const actorId = id('actor_id'); if (actorId) r = r.eq('actor_id', actorId)
    const from = day('from'); if (from) r = r.gte('at', `${from}T00:00:00+05:30`)
    const to = day('to'); if (to) r = r.lte('at', `${to}T23:59:59+05:30`)
    const { data, count, error } = await r.order('at', { ascending: false }).order('id', { ascending: false }).range(page.from, page.to)
    if (error) throw rpcError(error, 'te_audit_log')
    return { company_id: company, rows: data ?? [], total: count ?? 0, limit: page.limit, offset: page.offset }
  })
}
