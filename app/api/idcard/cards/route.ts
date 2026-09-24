// app/api/idcard/cards/route.ts
//
//   POST { ids: string[] } -> card data for those employees, and an audit row
//                             for every card actually handed over
//
// WHY THIS RETURNS DATA AND NOT A PDF
//
// The card is drawn on a canvas (lib/profile/id-card-pdf.ts) and canvas is a
// browser API. Rendering server-side would mean a second implementation of the
// same card — and two implementations of one identity document drift, which is
// how the printed card and the ESS card stop matching. The employee's own
// download already renders in the browser; this makes HR's use the identical
// code path, so there is exactly one card design in the product.
//
// THE AUDIT ROW IS PART OF THE RESPONSE, not a side effect to be skipped. The
// card carries a photograph, a blood group and a family member's phone number.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { scopeAllows, exportRefusal, refusalFor } from '@/lib/idcard/authz'
import { idCardCaller, applyScope, recordDownloads, callerIp } from '@/lib/idcard/server'
import { toIdCardData, type EmployeeCardRow } from '@/lib/idcard/card-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A ceiling on one request. Not a performance limit — a blast-radius one: a
 *  single call should not be able to drain the entire employee master's
 *  emergency contacts in one go without leaving 400 obvious audit rows. */
const MAX_BATCH = 200

const SELECT =
  'id, emp_code, full_name, designation, company_id, location_id,' +
  ' employment_status, date_of_leaving, blood_group, emergency_contact_1, photo_path, company_doj,' +
  ' companies!employees_company_id_fkey(company_name),' +
  ' locations!location_id(location_name),' +
  ' departments!employees_department_id_fkey(dept_name)'

interface Joined extends EmployeeCardRow {
  date_of_leaving?: string | null
  companies?: { company_name?: string | null } | null
  locations?: { location_name?: string | null } | null
  departments?: { dept_name?: string | null } | null
}

export async function POST(req: NextRequest) {
  const caller = await idCardCaller(req)
  if (caller.scope.kind === 'none') {
    return NextResponse.json({ error: refusalFor(caller.scope) }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { ids?: unknown; sides?: string }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
  if (!ids.length) return NextResponse.json({ error: 'No employees selected.' }, { status: 400 })
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `Too many at once — ${MAX_BATCH} is the limit.` }, { status: 400 })
  }
  const sides = ['both', 'front', 'back'].includes(String(body.sides)) ? String(body.sides) : 'both'

  // Scope is applied to the QUERY, so an id outside the caller's reach simply
  // does not come back — it is never distinguished from an id that does not
  // exist, which is also the correct thing to leak: nothing.
  let q = sb.from('employees').select(SELECT).in('id', ids)
  q = applyScope(q as never, caller.scope) as typeof q
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || []) as unknown as Joined[]

  const { data: creds } = await sb
    .from('id_card_credentials')
    .select('employee_id, state, card_no, valid_till')
    .in('employee_id', rows.map(r => r.id))
  const credByEmp = new Map((creds || []).map((c: Record<string, string>) =>
    [c.employee_id, c]))

  const cards: Record<string, unknown>[] = []
  const skipped: { code: string | null; reason: string }[] = []

  for (const r of rows) {
    if (!scopeAllows(caller.scope, r)) {      // second check, as in the list route
      skipped.push({ code: r.emp_code ?? null, reason: refusalFor(caller.scope) })
      continue
    }
    const cred = credByEmp.get(r.id)
    const block = exportRefusal(r, cred?.state)
    if (block) { skipped.push({ code: r.emp_code ?? null, reason: block }); continue }

    // The photo goes back as a signed URL; the browser converts it to a data
    // URL before drawing, because a cross-origin image taints the canvas and
    // toDataURL() then throws. That conversion already exists client-side.
    let photoUrl: string | null = null
    if (r.photo_path) {
      const { data: s } = await sb.storage.from('employee-photos')
        .createSignedUrl(r.photo_path, 60 * 10)
      photoUrl = s?.signedUrl ?? null
    }

    const flat: EmployeeCardRow = {
      ...r,
      company_name: r.companies?.company_name ?? null,
      location_name: r.locations?.location_name ?? null,
      department_name: r.departments?.dept_name ?? null,
    }
    cards.push({
      id: r.id,
      photoUrl,
      card: toIdCardData(flat, { cardNo: cred?.card_no ?? null, validTill: cred?.valid_till ?? null }),
    })
  }

  // Ids the caller asked for that produced nothing: outside scope, or gone.
  // Reported as one line rather than per id, so a Branch HR probing ids cannot
  // use the response to map the rest of the company.
  const missing = ids.length - rows.length
  if (missing > 0) skipped.push({ code: null, reason: `${missing} not available to you.` })

  const audit = await recordDownloads(
    caller,
    rows.filter(r => cards.some(c => c.id === r.id))
        .map(r => ({ subjectEmployeeId: r.id, subjectEmpCode: r.emp_code ?? null })),
    { format: 'pdf', sides, source: 'admin', ip: callerIp(req), userAgent: req.headers.get('user-agent') },
  )

  return NextResponse.json(
    { cards, skipped, logged: audit.logged, logError: audit.error },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
