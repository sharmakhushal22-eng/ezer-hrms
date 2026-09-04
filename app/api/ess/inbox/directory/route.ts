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
    .select('id, company_id, department_id, l1_manager_id, l2_manager_id')
    .eq('id', me).maybeSingle()
  if (!mine) return NextResponse.json({ people: [] })

  let sel = sb.from('employees')
    .select('id, full_name, emp_code, designation, photo_url, department_id, company_id')
    .neq('id', me)
    .limit(q ? 40 : 25)

  // Narrow in SQL where the mode allows it, so we are not pulling 400 rows to
  // throw most of them away.
  if (pol.reach_mode === 'COMPANY' && mine.company_id) sel = sel.eq('company_id', mine.company_id)
  if (q) sel = sel.or(`full_name.ilike.%${q}%,emp_code.ilike.%${q}%,designation.ilike.%${q}%`)
  sel = sel.order('full_name')

  const { data: rows, error: de } = await sel
  if (de) return NextResponse.json({ error: de.message }, { status: 500 })

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
    people: list.map((e: any) => ({
      id: e.id, name: e.full_name, code: e.emp_code,
      designation: e.designation, photo: e.photo_url,
    })),
    desks: (desks ?? []).map((d: any) => ({ ...d, staffed: staffed.size > 0 })),
    unstaffed_desks: (desks ?? []).length && staffed.size === 0,
  })
}
