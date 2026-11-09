// GET  /api/te/admin/desks — who is on the Finance desk and the Travel desk.
// PUT  /api/te/admin/desks — add, change or switch off desk rows.
//
// WHAT A DESK IS. A row saying "this person answers for this company, and
// optionally for this one branch". The branch → company → group ladder that
// turns those rows into "who may act on this request" is te_desk_members in
// migration 161; this route only reads and writes the rows it reads.
//
// WHY BOTH DESKS SHARE ONE ROUTE. They are the same shape — company, branch,
// person, a right, an active flag — and an administrator setting up a company
// does both in one sitting. Two routes would be the same code twice and two
// screens to keep in step.
//
// GROUP SCOPE IS READ ACROSS COMPANIES, which is the one place this route
// looks beyond ?company_id=. A group-wide member of another company answers
// for this one, so leaving them out would show an administrator a desk that
// looks emptier than it is. They come back flagged `otherCompany` and the
// screen shows them as read-only: they belong to the company that owns them.
//
// NOTHING IS DELETED. is_active = false is how somebody leaves a desk, so the
// history of who could approve what, when, stays answerable. The unique index
// in 161 means re-adding them later updates that same row back on.
//
// Needs full access to the Travel Claims module.
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, rpcError } from '@/lib/te/errors'
import { DESK_NAME, deskRowProblem, sameSeat, type DeskKind, type DeskMember } from '@/lib/te/desks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KIND = (v: unknown): DeskKind => {
  if (v === 'finance' || v === 'travel') return v
  throw new TeHttpError(400, 'TE_INVALID', 'A desk is either "finance" or "travel".', { field: 'kind' })
}

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    const sb = t.sb()

    const [co, locs, fin, travel] = await Promise.all([
      sb.from('companies').select('id, company_code, company_name, group_id').eq('id', company).maybeSingle(),
      sb.from('locations').select('id, location_name, location_type, city, status').eq('company_id', company).order('location_name'),
      sb.from('finance_team').select('id, company_id, location_id, employee_id, role, can_approve, can_disburse, approval_limit, is_group_scope, is_active'),
      sb.from('travel_desk').select('id, company_id, location_id, employee_id, role, can_book, is_group_scope, is_active'),
    ])
    if (co.error) throw rpcError(co.error, 'companies')
    if (locs.error) throw rpcError(locs.error, 'locations')
    if (fin.error) throw rpcError(fin.error, 'finance_team')
    // travel_desk is created by migration 161. Until it is applied the Finance
    // half of this screen must still work rather than the whole page failing.
    const noTable = travel.error?.code === '42P01' || travel.error?.code === 'PGRST205'
    if (travel.error && !noTable) throw rpcError(travel.error, 'travel_desk')

    // Every company in this one's group, so a group-scope row elsewhere can be
    // recognised as serving this company.
    const groupId = co.data?.group_id ?? null
    const siblings = groupId
      ? await sb.from('companies').select('id, company_code, company_name').eq('group_id', groupId)
      : { data: co.data ? [co.data] : [], error: null }
    if (siblings.error) throw rpcError(siblings.error, 'companies')
    const groupCompanies = (siblings.data ?? []).map(c => c.id as string)

    /** This company's own rows, plus group-scope rows from its siblings. */
    const mine = <T extends { company_id: string; is_group_scope: boolean }>(rows: T[]) =>
      rows.filter(r => r.company_id === company || (r.is_group_scope && groupCompanies.includes(r.company_id)))

    const finRows = mine(fin.data ?? [])
    const travelRows = noTable ? [] : mine(travel.data ?? [])

    // Names for everybody on either desk, and the pool to add from: this
    // company's active employees.
    const onDesks = [...new Set([...finRows, ...travelRows].map(r => r.employee_id as string))]
    const [people, pool, depts] = await Promise.all([
      onDesks.length
        ? sb.from('employees').select('id, emp_code, full_name, grade, department_id, location_id, company_id').in('id', onDesks)
        : Promise.resolve({ data: [], error: null }),
      sb.from('employees').select('id, emp_code, full_name, grade, department_id, location_id').eq('company_id', company).order('full_name').limit(5000),
      sb.from('departments').select('id, dept_name').eq('company_id', company),
    ])
    if (people.error) throw rpcError(people.error, 'employees')
    if (pool.error) throw rpcError(pool.error, 'employees')
    if (depts.error) throw rpcError(depts.error, 'departments')

    return {
      company_id: company,
      company: co.data,
      group_companies: groupCompanies,
      locations: locs.data ?? [],
      departments: depts.data ?? [],
      finance: finRows,
      travel: travelRows,
      travel_table_missing: noTable,
      people: people.data ?? [],
      pool: pool.data ?? [],
    }
  })
}

interface PutRow {
  id?: string
  company_id?: string
  location_id?: string | null
  employee_id?: string
  role?: string
  can_approve?: boolean
  can_disburse?: boolean
  can_book?: boolean
  approval_limit?: number | null
  is_group_scope?: boolean
  is_active?: boolean
}

export async function PUT(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{ kind?: unknown; rows?: unknown }>()
    const kind = KIND(body.kind)
    if (!Array.isArray(body.rows) || !body.rows.length) {
      throw new TeHttpError(400, 'TE_INVALID', 'Send at least one desk row to save.', { field: 'rows' })
    }
    if (body.rows.length > 500) {
      throw new TeHttpError(400, 'TE_INVALID', 'That is more than 500 rows in one save.', { field: 'rows' })
    }
    await t.permit('Travel Claims', 'FULL')
    const actor = await t.employee()
    const company = await t.company()
    const sb = t.sb()
    const spec = DESK_NAME[kind]
    // A branch must belong to the company being written, or a row could point
    // one company's desk at another company's office.
    const locs = await sb.from('locations').select('id').eq('company_id', company)
    if (locs.error) throw rpcError(locs.error, 'locations')
    const okLoc = new Set((locs.data ?? []).map(l => l.id as string))

    // And a person must be an employee of it. Somebody from another company
    // reaches this desk only through their own company's group-scope row.
    const emps = await sb.from('employees').select('id').eq('company_id', company)
    if (emps.error) throw rpcError(emps.error, 'employees')
    const okEmp = new Set((emps.data ?? []).map(e => e.id as string))

    // WHAT IS ALREADY THERE, so a save updates the seat somebody holds rather
    // than trying to create a second one. The unique index in 161 is on a
    // coalesce() expression — it has to be, because two NULL branches would
    // not otherwise conflict — and an expression index cannot be named as an
    // ON CONFLICT target. So the seat is matched here and the upsert is keyed
    // on the primary key, the same way te_places is handled in the masters
    // route. The index stays as the database's own last word on duplicates.
    const held = await sb.from(spec.table).select('id, company_id, location_id, employee_id').eq('company_id', company)
    if (held.error) throw rpcError(held.error, spec.table)
    const seats = (held.data ?? []).map(r => ({
      id: r.id as string,
      seat: { companyId: r.company_id as string, locationId: (r.location_id as string | null) ?? null, employeeId: r.employee_id as string } as DeskMember,
    }))

    const out = (body.rows as PutRow[]).map((r, i) => {
      const at = `Row ${i + 1}`
      const employee_id = String(r.employee_id ?? '')
      const location_id = r.location_id == null || r.location_id === '' ? null : String(r.location_id)
      if (!okEmp.has(employee_id)) {
        throw new TeHttpError(400, 'TE_INVALID', `${at}: that person is not an employee of this company.`, { field: 'employee_id', row: i })
      }
      if (location_id !== null && !okLoc.has(location_id)) {
        throw new TeHttpError(400, 'TE_INVALID', `${at}: that branch does not belong to this company.`, { field: 'location_id', row: i })
      }
      const able = kind === 'finance' ? r.can_approve !== false : r.can_book !== false
      const member: DeskMember = {
        companyId: company,
        locationId: location_id,
        employeeId: employee_id,
        active: r.is_active !== false,
        able,
        groupScope: r.is_group_scope === true,
        limit: kind === 'finance' ? (r.approval_limit ?? null) : null,
        disburse: r.can_disburse === true,
      }
      const problem = deskRowProblem(member, kind)
      if (problem) throw new TeHttpError(400, 'TE_INVALID', `${at}: ${problem}`, { row: i })

      const common = {
        id: seats.find(x => sameSeat(x.seat, member))?.id ?? randomUUID(),
        company_id: company,
        location_id,
        employee_id,
        is_group_scope: member.groupScope,
        is_active: member.active,
        updated_at: new Date().toISOString(),
      }
      return kind === 'finance'
        ? { ...common, role: r.role ?? 'EXECUTIVE', can_approve: able, can_disburse: member.disburse, approval_limit: member.limit }
        : { ...common, role: r.role ?? 'DESK', can_book: able }
    })

    // Two rows of one request must not name the same seat, or the upsert would
    // silently keep whichever landed last.
    out.forEach((r, i) => {
      if (out.findIndex(x => x.id === r.id) !== i) {
        throw new TeHttpError(400, 'TE_INVALID', `Row ${i + 1}: that person appears twice for the same branch.`, { row: i })
      }
    })

    // One statement, so either every row is saved or none is.
    const { data, error } = await sb.from(spec.table)
      .upsert(out, { onConflict: 'id', defaultToNull: false })
      .select('*')
    if (error) throw rpcError(error, spec.table)
    return { kind, company_id: company, saved: data?.length ?? 0, rows: data ?? [], by: actor }
  })
}
