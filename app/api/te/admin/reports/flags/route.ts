// GET /api/te/admin/reports/flags — every flag raised, across claims.
// Filters: check_code, status (open/dismissed/confirmed), blocking, from, to
// (by the claim's submission, YYYY-MM-DD). ?format=csv downloads up to 5,000.
//
// This route did not exist: the handover lists it as needed by screen d3 and
// suggests te_flags joined to te_claims for the company.
//
// WHY IT IS WORTH A SCREEN. One flag is a conversation between an approver
// and one employee. All of them together say which checks are earning their
// keep: a check that fires constantly and is dismissed every time is noise
// that trains people to ignore the rest, and a check that never fires at all
// may be misconfigured. That is a question only this report can answer.
import { NextRequest } from 'next/server'
import { teCsvResponse, teRoute } from '@/lib/te/server'
import { TeHttpError, rpcError } from '@/lib/te/errors'
import { toCsv } from '@/lib/te/csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: [string, string][] = [
  ['check_code', 'Check'], ['title', 'What it found'], ['severity', 'Severity'], ['is_blocking', 'Blocking'],
  ['status', 'Status'], ['claim_no', 'Claim'], ['employee_name', 'Employee'], ['emp_code', 'Employee code'],
  ['claim_status', 'Claim status'], ['resolve_reason', 'Why it was dismissed'], ['evidence', 'Evidence'],
  ['raised_at', 'Raised'],
]
const CSV_MAX = 5000

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    // Being ON the Finance desk counts as the Finance access this asks
    // for. The role permission and desk membership had drifted apart: the
    // Finance Controller, who holds no dashboard role at all, could open
    // the Finance desk and was refused the reports that say they are open
    // to Finance. Same population, same intent, so the same gate.
    if (!(await t.holds('Travel Claims', 'FULL')) && !(await t.holds('Finance', 'VIEW')) && !(await t.onDesk('finance'))) {
      throw new TeHttpError(403, 'TE_FORBIDDEN', 'The flag report needs full access to Travel Claims, or view access to Finance.')
    }
    const company = await t.company()
    const q = req.nextUrl.searchParams
    const csv = q.get('format') === 'csv'
    const page = t.page()

    // The company lives on the claim, so the join is the filter as well as
    // the context. An inner join keeps a flag whose claim was deleted out.
    //
    // The embedded resources are NOT aliased, and the filters below name the
    // tables rather than an alias. Every other embedded filter in this repo is
    // written that way (app/api/ess/home, app/api/ess/reports and ten more),
    // so this is the form known to work against this PostgREST; an alias would
    // be tidier to read and is the one thing here nothing else proves.
    let r = t.sb()
      .from('te_flags')
      .select('id, check_code, title, evidence, severity, is_blocking, status, resolve_reason, created_at, te_claims!inner(id, claim_no, status, company_id, submitted_at, employees(emp_code, full_name))', { count: 'exact' })
      .eq('te_claims.company_id', company)

    const code = q.get('check_code')
    if (code && /^[A-Z0-9]{1,8}$/.test(code)) r = r.eq('check_code', code)
    const status = q.get('status')
    if (status && ['open', 'dismissed', 'confirmed'].includes(status)) r = r.eq('status', status)
    const blocking = q.get('blocking')
    if (blocking === '1' || blocking === '0') r = r.eq('is_blocking', blocking === '1')
    const from = q.get('from'); if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) r = r.gte('te_claims.submitted_at', `${from}T00:00:00+05:30`)
    const to = q.get('to'); if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) r = r.lte('te_claims.submitted_at', `${to}T23:59:59+05:30`)

    const { data, count, error } = await r
      .order('created_at', { ascending: false })
      .range(csv ? 0 : page.from, csv ? CSV_MAX - 1 : page.to)
    if (error) throw rpcError(error, 'te_flags')

    // Flatten the join, so the screen and the CSV read the same shape. The
    // nesting is named by the tables, because the select above does not alias.
    type Joined = {
      id: string; check_code: string; title: string; evidence: string | null; severity: string
      is_blocking: boolean; status: string; resolve_reason: string | null; created_at: string
      te_claims: { claim_no: string; status: string; employees: { emp_code: string; full_name: string } | null } | null
    }
    const rows = ((data ?? []) as unknown as Joined[]).map(f => ({
      id: f.id,
      check_code: f.check_code,
      title: f.title,
      evidence: f.evidence,
      severity: f.severity,
      is_blocking: f.is_blocking,
      status: f.status,
      resolve_reason: f.resolve_reason,
      raised_at: f.created_at,
      claim_no: f.te_claims?.claim_no ?? '',
      claim_status: f.te_claims?.status ?? '',
      emp_code: f.te_claims?.employees?.emp_code ?? '',
      employee_name: f.te_claims?.employees?.full_name ?? '',
    }))

    if (csv) return teCsvResponse(toCsv(rows as unknown as Record<string, unknown>[], COLUMNS), `flags-${new Date().toISOString().slice(0, 10)}.csv`)
    return { company_id: company, rows, total: count ?? 0, limit: page.limit, offset: page.offset }
  })
}
