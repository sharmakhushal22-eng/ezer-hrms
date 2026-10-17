// GET /api/te/finance/overview?view=… — the lists of the Finance desk.
//
//   view         reads                     filters
//   claims       v_te_claim_summary        status, stage, employee_id, period (YYYY-MM), from, to (submitted), q
//   payable      v_te_payable              employee_id            (verified claims waiting for a payout batch)
//   advances     v_te_advance_ledger       status, employee_id
//   batches      te_payout_batches + items status
//   adjustments  te_adjustments            status
//   periods      travel_periods            —
//   summary      counts for the desk's header tiles
//
// Paginated with ?limit= (50, at most 200) and ?offset=; the answer carries the
// total. Needs the dashboard Finance permission (view). These are plain reads
// of views and tables: there is no rule to apply, so no service function.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, isUuid, needOneOf, rpcError } from '@/lib/te/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VIEWS = ['claims', 'payable', 'advances', 'batches', 'adjustments', 'periods', 'summary'] as const
/** A status or stage is letters and underscores; anything else is not a value we store. */
const word = (v: string | null): string | null => (v && /^[A-Za-z_]{1,40}$/.test(v) ? v : null)
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    // WHO MAY OPEN THE FINANCE DESK. Being on it, or holding full admin access
    // to the module. It used to be the 'Finance' VIEW role permission alone,
    // which in this data lets an HR Head with no finance_team row at all read
    // the whole company's claims, advances and payouts — the Finance desk was
    // meant to be visible to Finance people.
    //
    // Falls back to the permission alone while migration 161 is unapplied:
    // te_on_desk does not exist then, and the desk must not go dark.
    const actorId = (await t.actor()).employeeId
    let onDesk = false
    try {
      onDesk = actorId ? await t.db().rpc<boolean>('te_on_desk', { p_kind: 'finance', p_actor: actorId }) === true : false
    } catch {
      onDesk = await t.holds('Finance', 'VIEW')
    }
    if (!onDesk && !(await t.holds('Travel Claims', 'FULL'))) {
      // Still 403 through permit(), so the message and the code stay the ones
      // every other Finance route gives.
      await t.permit('Finance', 'FULL')
    }
    const company = await t.company()
    const q = req.nextUrl.searchParams
    const view = needOneOf(q.get('view') ?? 'claims', VIEWS, 'view')
    const sb = t.sb()
    const page = t.page()
    const status = word(q.get('status'))
    const employee = q.get('employee_id')
    if (employee && !isUuid(employee)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'employee_id is not a valid id.')

    if (view === 'summary') {
      const count = async (table: string, col: string, values: string[]) => {
        const { count: n, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq('company_id', company).in(col, values)
        if (error) throw rpcError(error, table)
        return n ?? 0
      }
      const [inApproval, inVerification, onHold, payable, advancesToPay, advancesOut, openBatches] = await Promise.all([
        count('te_claims', 'status', ['IN_APPROVAL']),
        count('te_claims', 'status', ['IN_VERIFICATION']),
        count('te_claims', 'status', ['ON_HOLD']),
        count('te_claims', 'status', ['VERIFIED']),
        count('te_advances', 'status', ['REQUESTED', 'APPROVED']),
        count('te_advances', 'status', ['PAID', 'PART_SETTLED', 'RECOVERY_DUE']),
        count('te_payout_batches', 'status', ['DRAFT', 'FILE_GENERATED']),
      ])

      // Amounts and the spend split, for the dashboard tiles and bars.
      //
      // These are sums, and PostgREST aggregate functions are not enabled on
      // this project, so the rows are read and added up here. That is bounded:
      // at most SUM_CAP rows per query, and `complete` says whether the cap was
      // reached — a tile that is quietly short is worse than one that admits it.
      const SUM_CAP = 2000
      const sumOf = async (table: string, col: string, values: string[], amountCol: string) => {
        const { data, error } = await sb.from(table)
          .select(amountCol).eq('company_id', company).in(col, values).limit(SUM_CAP)
        if (error) throw rpcError(error, table)
        // The column is chosen at runtime, so the generated types cannot narrow
        // it and infer an error row instead. The name is from this function's
        // own call sites, never from a request.
        const rows = (data ?? []) as unknown as Record<string, number | null>[]
        const total = rows.reduce((a, r) => a + Number(r[amountCol] ?? 0), 0)
        return { amount: Math.round(total * 100) / 100, complete: rows.length < SUM_CAP }
      }

      const [pipe, pay, out, spend] = await Promise.all([
        // Everything still moving: with a manager, with Finance, or held.
        sumOf('te_claims', 'status', ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD'], 'claimed_total'),
        sumOf('te_claims', 'status', ['VERIFIED'], 'net_amount'),
        sumOf('te_advances', 'status', ['PAID', 'PART_SETTLED', 'RECOVERY_DUE'], 'outstanding_amount'),
        // What the money is actually spent on, by category, across claims that
        // have been submitted. Unclaimed lines are not spend yet.
        (async () => {
          const { data, error } = await sb.from('te_expenses')
            .select('category_code, eligible_amount, claimed_amount')
            .eq('company_id', company).not('claim_id', 'is', null)
            .order('created_at', { ascending: false }).limit(SUM_CAP)
          if (error) throw rpcError(error, 'te_expenses')
          const rows = (data ?? []) as { category_code: string; eligible_amount: number | null; claimed_amount: number | null }[]
          const by = new Map<string, number>()
          for (const r of rows) {
            const amount = Number(r.eligible_amount ?? r.claimed_amount ?? 0)
            if (amount) by.set(r.category_code, (by.get(r.category_code) ?? 0) + amount)
          }
          return {
            byCategory: [...by.entries()]
              .map(([cat, amount]) => ({ cat, amount: Math.round(amount * 100) / 100 }))
              .sort((a, b) => b.amount - a.amount),
            complete: rows.length < SUM_CAP,
          }
        })(),
      ])

      return {
        view,
        company_id: company,
        summary: {
          inApproval, inVerification, onHold, payable, advancesToPay, advancesOut, openBatches,
          pipelineAmount: pipe.amount,
          payableAmount: pay.amount,
          advancesOutAmount: out.amount,
          byCategory: spend.byCategory,
          /** false = a cap was hit, so the amounts are a floor, not a total. */
          amountsComplete: pipe.complete && pay.complete && out.complete && spend.complete,
        },
      }
    }

    let rows: unknown[] = []
    let total = 0
    if (view === 'claims') {
      let r = sb.from('v_te_claim_summary').select('*', { count: 'exact' }).eq('company_id', company)
      if (status) r = r.eq('status', status)
      const stage = word(q.get('stage'))
      if (stage) r = r.eq('stage', stage)
      if (employee) r = r.eq('employee_id', employee)
      const period = q.get('period')
      if (period && /^\d{4}-\d{2}$/.test(period)) r = r.eq('period_month', `${period}-01`)
      const from = day(q.get('from'))
      const to = day(q.get('to'))
      if (from) r = r.gte('submitted_at', `${from}T00:00:00+05:30`)
      if (to) r = r.lte('submitted_at', `${to}T23:59:59+05:30`)
      // Only letters, digits, space and dash reach the filter: a comma or a bracket would be read as filter syntax.
      const text = (q.get('q') ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 40)
      if (text) r = r.or(`claim_no.ilike.%${text}%,employee_name.ilike.%${text}%,emp_code.ilike.%${text}%`)
      const { data, count, error } = await r.order('submitted_at', { ascending: false, nullsFirst: false }).range(page.from, page.to)
      if (error) throw rpcError(error, 'v_te_claim_summary')
      rows = data ?? []; total = count ?? 0
    } else if (view === 'payable') {
      let r = sb.from('v_te_payable').select('*', { count: 'exact' }).eq('company_id', company)
      if (employee) r = r.eq('employee_id', employee)
      const { data, count, error } = await r.order('verified_at', { ascending: true }).range(page.from, page.to)
      if (error) throw rpcError(error, 'v_te_payable')
      rows = data ?? []; total = count ?? 0
    } else if (view === 'advances') {
      let r = sb.from('v_te_advance_ledger').select('*', { count: 'exact' }).eq('company_id', company)
      if (status) r = r.eq('status', status)
      if (employee) r = r.eq('employee_id', employee)
      const { data, count, error } = await r.order('created_at', { ascending: false }).range(page.from, page.to)
      if (error) throw rpcError(error, 'v_te_advance_ledger')
      rows = data ?? []; total = count ?? 0
    } else if (view === 'batches') {
      // Each line carries who and which claim, not just the ids. A batch that
      // has gone to the bank is where a single transfer gets marked as failed,
      // and that decision is unmakeable against a bare uuid — the claim it
      // belongs to is no longer in the payable list to look the name up from.
      let r = sb.from('te_payout_batches')
        .select('*, items:te_payout_items(id, claim_id, employee_id, amount, status, bank_ref, failure_reason, employees(emp_code, full_name), te_claims(claim_no))', { count: 'exact' })
        .eq('company_id', company)
      if (status) r = r.eq('status', status)
      const { data, count, error } = await r.order('created_at', { ascending: false }).range(page.from, page.to)
      if (error) throw rpcError(error, 'te_payout_batches')
      rows = data ?? []; total = count ?? 0
    } else if (view === 'adjustments') {
      // The claim is embedded (te_adjustments links to te_claims once), but the
      // employee is NOT: this table references employees twice, as employee_id
      // and created_by, so an embed would be ambiguous and fail at request
      // time. The names are read separately below, as app/api/te/desk does.
      let r = sb.from('te_adjustments')
        .select('*, te_claims(claim_no, status)', { count: 'exact' })
        .eq('company_id', company)
      if (status) r = r.eq('status', status)
      const { data, count, error } = await r.order('created_at', { ascending: false }).range(page.from, page.to)
      if (error) throw rpcError(error, 'te_adjustments')
      const who = [...new Set((data ?? []).map(a => a.employee_id as string).filter(Boolean))]
      const names = new Map<string, { emp_code: string | null; full_name: string | null }>()
      if (who.length) {
        const e = await sb.from('employees').select('id, emp_code, full_name').in('id', who)
        if (e.error) throw rpcError(e.error, 'employees')
        for (const row of e.data ?? []) {
          names.set(row.id as string, { emp_code: row.emp_code as string | null, full_name: row.full_name as string | null })
        }
      }
      rows = (data ?? []).map(a => ({ ...a, ...(names.get(a.employee_id as string) ?? { emp_code: null, full_name: null }) }))
      total = count ?? 0
    } else {
      const { data, count, error } = await sb.from('travel_periods')
        .select('id, period_month, period_label, status, closed_at, locked_at', { count: 'exact' })
        .eq('company_id', company).order('period_month', { ascending: false }).range(page.from, page.to)
      if (error) throw rpcError(error, 'travel_periods')
      rows = data ?? []; total = count ?? 0
    }
    return { view, company_id: company, rows, total, limit: page.limit, offset: page.offset }
  })
}
