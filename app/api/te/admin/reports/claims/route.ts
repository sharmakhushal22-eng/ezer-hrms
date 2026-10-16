// GET /api/te/admin/reports/claims — the claim register: one line per claim
// (v_te_claim_summary). Filters: from, to (submitted, YYYY-MM-DD), status,
// period (YYYY-MM), employee_id. JSON is paginated (?limit=, ?offset=);
// ?format=csv downloads up to 5,000 rows as a file.
// Open to full access on Travel Claims, or view access on Finance.
import { NextRequest } from 'next/server'
import { teCsvResponse, teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, rpcError } from '@/lib/te/errors'
import { toCsv } from '@/lib/te/csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: [string, string][] = [
  ['claim_no', 'Claim'], ['status', 'Status'], ['emp_code', 'Employee code'], ['employee_name', 'Employee'], ['grade', 'Grade'],
  ['department', 'Department'], ['trip_no', 'Trip'], ['trip_name', 'Trip name'], ['scope', 'Scope'], ['period_label', 'Expense month'],
  ['is_late', 'Late'], ['line_count', 'Lines'], ['claimed_total', 'Claimed'], ['eligible_total', 'Eligible'], ['approved_total', 'Approved'],
  ['advance_adjusted', 'Advance adjusted'], ['net_amount', 'Net payable'], ['risk_band', 'Risk'], ['open_flags', 'Open flags'],
  ['is_exception', 'Exception'], ['is_post_facto', 'After travel'], ['submitted_at', 'Submitted'], ['verified_at', 'Verified'],
  ['settled_at', 'Settled'], ['paid_ref', 'Payment reference'],
]
const CSV_MAX = 5000

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    if (!(await t.holds('Travel Claims', 'FULL')) && !(await t.holds('Finance', 'VIEW'))) {
      throw new TeHttpError(403, 'TE_FORBIDDEN', 'The claim register needs full access to Travel Claims, or view access to Finance.')
    }
    const company = await t.company()
    const q = req.nextUrl.searchParams
    const csv = q.get('format') === 'csv'
    const page = t.page()
    let r = t.sb().from('v_te_claim_summary').select('*', { count: 'exact' }).eq('company_id', company)
    const status = q.get('status'); if (status && /^[A-Z_]{1,30}$/.test(status)) r = r.eq('status', status)
    const period = q.get('period'); if (period && /^\d{4}-\d{2}$/.test(period)) r = r.eq('period_month', `${period}-01`)
    const employee = q.get('employee_id')
    if (employee) { if (!isUuid(employee)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'employee_id is not a valid id.'); r = r.eq('employee_id', employee) }
    const from = q.get('from'); if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) r = r.gte('submitted_at', `${from}T00:00:00+05:30`)
    const to = q.get('to'); if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) r = r.lte('submitted_at', `${to}T23:59:59+05:30`)
    const { data, count, error } = await r.order('submitted_at', { ascending: false, nullsFirst: false })
      .range(csv ? 0 : page.from, csv ? CSV_MAX - 1 : page.to)
    if (error) throw rpcError(error, 'v_te_claim_summary')
    const rows = (data ?? []) as Record<string, unknown>[]
    if (csv) return teCsvResponse(toCsv(rows, COLUMNS), `claims-${new Date().toISOString().slice(0, 10)}.csv`)
    return { company_id: company, rows, total: count ?? 0, limit: page.limit, offset: page.offset }
  })
}
