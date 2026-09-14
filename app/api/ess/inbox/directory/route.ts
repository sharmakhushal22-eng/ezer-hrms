// app/api/ess/inbox/directory/route.ts
//
//   GET ?q=<search>  -> the people this caller is allowed to write to
//
// The filtering is the point. A directory that lists everyone and then
// refuses on send teaches people to try and fail; this returns only names
// the reach policy will actually accept, so the picker cannot offer a
// conversation that will be rejected.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { policy, notInstalled } from '@/lib/inbox/server'
import { orIlike } from '@/lib/pg-search'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId
  const q = (req.nextUrl.searchParams.get('q') || '').trim()

  let pol
  try { pol = await policy() } catch (e: any) {
    if (notInstalled(e)) return NextResponse.json({ installed: false, people: [] })
    throw e
  }

  const { data: mine } = await sb.from('employees')
    .select('id, company_id, department_id, l1_manager_id, l2_manager_id, full_name, emp_code, designation')
    .eq('id', me).maybeSingle()
  if (!mine) return NextResponse.json({ people: [] })

  let sel = sb.from('employees')
    .select('id, full_name, emp_code, designation, photo_url, department_id, company_id')
    .neq('id', me)
    .limit(q ? 40 : 25)

  // Narrow in SQL where the mode allows it, so we are not pulling 400 rows to
  // throw most of them away.
  if (pol.reach_mode === 'COMPANY' && mine.company_id) sel = sel.eq('company_id', mine.company_id)
  // Quoted, because this is a search box: a name with a comma or a full stop
  // in it was being read as more filter syntax and came back 400, which the
  // compose sheet could only render as "nobody matched".
  if (q) sel = sel.or(orIlike(['full_name', 'emp_code', 'designation'], q))
  sel = sel.order('full_name')

  const { data: rows, error: de } = await sel
  if (de) return NextResponse.json({ error: de.message }, { status: 500 })

  // The list excludes the caller, because messaging yourself is not a thing.
  // That makes searching your OWN name or code the one empty result with no
  // explanation in it — and on a portal an admin is viewing, "yourself" is the
  // employee whose portal it is, which is easy to type by accident. Say so
  // rather than leaving an empty sheet to be read as a broken search.
  const matchedSelf = !!q && [mine.full_name, mine.emp_code, mine.designation]
    .some(v => String(v ?? '').toLowerCase().includes(q.toLowerCase()))

  let list = rows ?? []

  // CHAIN_HR and NO_COLD_UP are structural, not a column filter, so they are
  // applied here against the same rule the database uses.
  if (pol.reach_mode === 'CHAIN_HR') {
    const allowed = new Set<string>([mine.l1_manager_id, mine.l2_manager_id].filter(Boolean) as string[])
    const { data: reports } = await sb.from('employees').select('id')
      .or(`l1_manager_id.eq.${me},l2_manager_id.eq.${me}`)
    for (const r of reports ?? []) allowed.add(r.id)
    if (mine.l1_manager_id) {
      const { data: peers } = await sb.from('employees').select('id').eq('l1_manager_id', mine.l1_manager_id)
      for (const p of peers ?? []) if (p.id !== me) allowed.add(p.id)
    }
    list = list.filter((e: any) => allowed.has(e.id))
  }

  const { data: desks } = await sb.from('inbox_desks')
    .select('desk_code, label, description, accent').eq('is_active', true).order('sort_order')

  // How many desks have nobody on them. The UI says so rather than accepting
  // a message into a void.
  const { data: agents } = await sb.from('inbox_desk_agents').select('desk_id').eq('is_active', true)
  const staffed = new Set((agents ?? []).map((a: any) => a.desk_id))

  return NextResponse.json({
    installed: true,
    reach_mode: pol.reach_mode,
    matched_self: matchedSelf,
    people: list.map((e: any) => ({
      id: e.id, name: e.full_name, code: e.emp_code,
      designation: e.designation, photo: e.photo_url,
    })),
    desks: (desks ?? []).map((d: any) => ({ ...d, staffed: staffed.size > 0 })),
    unstaffed_desks: (desks ?? []).length && staffed.size === 0,
  })
}
