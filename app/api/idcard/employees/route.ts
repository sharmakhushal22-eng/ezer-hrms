// app/api/idcard/employees/route.ts
//
//   GET -> the employees whose ID cards THIS caller may download
//
// Not "all employees, filtered in the browser". The list is narrowed by the
// caller's scope in the query and then checked again per row on the way out,
// because a filter can be dropped by a later edit and a second check cannot be
// dropped silently — it is what actually decides whether a row is serialised.
//
// See lib/idcard/authz.ts for why this does not use requireModule(): the
// Employees module is held by recruiters and finance, and hasLevel() opens for
// everyone while enforce_module_access is false.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { scopeAllows, exportRefusal, refusalFor } from '@/lib/idcard/authz'
import { idCardCaller, applyScope } from '@/lib/idcard/server'
import { cardGaps, type EmployeeCardRow } from '@/lib/idcard/card-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** locations!location_id is not decoration: employees has two FKs to locations
 *  (location_id and actual_posted_location_id) and an ambiguous embed 400s. */
const SELECT =
  'id, emp_code, full_name, designation, company_id, location_id, department_id,' +
  ' employment_status, date_of_leaving, blood_group, emergency_contact_1, photo_path, company_doj,' +
  ' companies!employees_company_id_fkey(company_name,company_code),' +
  ' locations!location_id(location_name,city),' +
  ' departments!employees_department_id_fkey(dept_name)'

interface Joined extends EmployeeCardRow {
  date_of_leaving?: string | null
  companies?: { company_name?: string | null } | null
  locations?: { location_name?: string | null } | null
  departments?: { dept_name?: string | null } | null
}

export async function GET(req: NextRequest) {
  const caller = await idCardCaller(req)
  if (caller.scope.kind === 'none') {
    return NextResponse.json({ error: refusalFor(caller.scope) }, { status: 403 })
  }

  const url = new URL(req.url)
  const search = (url.searchParams.get('q') || '').trim()
  const location = url.searchParams.get('location') || ''
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 1000)

  let q = sb.from('employees').select(SELECT).neq('is_test', true).order('emp_code')
  // Scope first, always. A narrowing filter the user chose is applied after, so
  // it can only ever shrink the set further, never widen it.
  q = applyScope(q as never, caller.scope) as typeof q
  if (location) q = q.eq('location_id', location)
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ')
    q = q.or(`full_name.ilike.*${safe}*,emp_code.ilike.*${safe}*,designation.ilike.*${safe}*`)
  }
  q = q.limit(limit)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || []) as unknown as Joined[]

  // Credentials in one go rather than per row. Read only — see the warning in
  // authz.ts: issuing here would rotate somebody's live gate secret.
  const ids = rows.map(r => r.id)
  const credByEmp = new Map<string, { state: string | null; card_no: string | null; valid_till: string | null }>()
  if (ids.length) {
    const { data: creds } = await sb
      .from('id_card_credentials')
      .select('employee_id, state, card_no, valid_till')
      .in('employee_id', ids)
    for (const c of (creds || []) as Record<string, string>[]) {
      credByEmp.set(c.employee_id, { state: c.state ?? null, card_no: c.card_no ?? null, valid_till: c.valid_till ?? null })
    }
  }

  const employees = rows
    // The second check. Cheap, and the failure it prevents is a card belonging
    // to somebody outside this caller's branch appearing in a response body.
    .filter(r => scopeAllows(caller.scope, r))
    .map(r => {
      const flat: EmployeeCardRow = {
        ...r,
        company_name: r.companies?.company_name ?? null,
        location_name: r.locations?.location_name ?? null,
        department_name: r.departments?.dept_name ?? null,
      }
      const cred = credByEmp.get(r.id)
      return {
        id: r.id,
        emp_code: flat.emp_code,
        full_name: flat.full_name,
        designation: flat.designation,
        department_name: flat.department_name,
        location_name: flat.location_name,
        location_id: r.location_id ?? null,
        employment_status: r.employment_status ?? null,
        gaps: cardGaps(flat),
        cardNo: cred?.card_no ?? null,
        validTill: cred?.valid_till ?? null,
        /** Null when downloadable; otherwise the sentence to show instead of a button. */
        blocked: exportRefusal(r, cred?.state),
      }
    })

  return NextResponse.json(
    {
      scope: caller.scope.kind,
      locationIds: caller.scope.kind === 'locations' ? caller.scope.locationIds : null,
      count: employees.length,
      employees,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
