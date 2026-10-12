// GET /api/te/admin/trips — every trip in the company, for the GPS log.
// Filters: employee_id, scope, from, to (by start date, YYYY-MM-DD), status.
// JSON is paginated (?limit=, ?offset=); ?format=csv downloads up to 5,000
// rows as a file.
//
// This route did not exist: the handover lists it as needed by screens c0 and
// c1 and suggests exactly this — v_te_trips for the company, Travel Claims
// FULL. The per-leg detail it links to is already served by GET /trips/[id].
//
// Open to full access on Travel Claims, or view access on Finance — the same
// pair as the claim register, because it answers the same kind of question
// about the same people.
import { NextRequest } from 'next/server'
import { teCsvResponse, teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, rpcError } from '@/lib/te/errors'
import { toCsv } from '@/lib/te/csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: [string, string][] = [
  ['trip_no', 'Trip'], ['name', 'Name'], ['display_status', 'Status'], ['emp_code', 'Employee code'],
  ['employee_name', 'Employee'], ['scope', 'Scope'], ['pattern', 'Pattern'], ['origin', 'Origin'],
  ['start_date', 'Starts'], ['end_date', 'Ends'], ['leg_count', 'Legs'], ['open_leg_count', 'Open legs'],
  ['planned_km', 'Planned km'], ['estimate_total', 'Estimate'], ['advance_outstanding', 'Advance outstanding'],
  ['purpose', 'Purpose'], ['project', 'Project'], ['created_at', 'Created'],
]
const CSV_MAX = 5000

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    if (!(await t.holds('Travel Claims', 'FULL')) && !(await t.holds('Finance', 'VIEW'))) {
      throw new TeHttpError(403, 'TE_FORBIDDEN', 'The trip log needs full access to Travel Claims, or view access to Finance.')
    }
    const company = await t.company()
    const q = req.nextUrl.searchParams
    const csv = q.get('format') === 'csv'
    const page = t.page()

    let r = t.sb().from('v_te_trips').select('*', { count: 'exact' }).eq('company_id', company)

    const employee = q.get('employee_id')
    if (employee) {
      if (!isUuid(employee)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'employee_id is not a valid id.')
      r = r.eq('employee_id', employee)
    }
    const scope = q.get('scope')
    if (scope && ['local', 'domestic', 'international'].includes(scope)) r = r.eq('scope', scope)
    const status = q.get('status')
    if (status && /^[A-Z_]{1,30}$/.test(status)) r = r.eq('status', status)
    const from = q.get('from'); if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) r = r.gte('start_date', from)
    const to = q.get('to'); if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) r = r.lte('start_date', to)

    const { data, count, error } = await r
      .order('start_date', { ascending: false, nullsFirst: false })
      .range(csv ? 0 : page.from, csv ? CSV_MAX - 1 : page.to)
    if (error) throw rpcError(error, 'v_te_trips')

    const rows = (data ?? []) as Record<string, unknown>[]
    if (csv) return teCsvResponse(toCsv(rows, COLUMNS), `trips-${new Date().toISOString().slice(0, 10)}.csv`)
    return { company_id: company, rows, total: count ?? 0, limit: page.limit, offset: page.offset }
  })
}
