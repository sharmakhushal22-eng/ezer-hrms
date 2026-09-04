// app/api/admin/inbox/route.ts — the HR-admin controls for the ESS inbox.
//
//   GET                          -> policy, per-role overrides, desks, agents
//   PATCH { policy: {...} }      -> change reach and limits
//   PATCH { override: {...} }    -> set or clear a per-role reach override
//   POST  { desk_code, employee_id, action: 'add'|'remove' }  -> staff a desk
//
// Reach was specified as group-wide "for now", explicitly on the condition
// that HR can change it later without a code change. That is the whole reason
// inbox_policy is a table; this route is the thing that edits it.
//
// Gated the same way the company master is, and for the same reason: a
// control that only hides a button in the browser is not a control. Every
// verb here resolves the caller's grant server-side first.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { notInstalled } from '@/lib/inbox/server'

export const dynamic = 'force-dynamic'

/**
 * Who may change how far the inbox reaches.
 *
 * The platform roles, the customer's own administrator — and HR_HEAD, which
 * is the difference from COMPANY_EDIT_ROLES. Reach is an HR policy: who may
 * talk to whom is exactly the kind of question an HR head should own, and the
 * blast radius of getting it wrong is a conversation that should not have
 * happened, not a failed payroll run.
 */
const INBOX_ADMIN_ROLES = new Set([
  'ADMIN_SUPER', 'SUPER_ADMIN', 'IMPL_MANAGER', 'ADMIN_COMPANY', 'HR_HEAD',
])

const REACH = new Set(['GROUP', 'COMPANY', 'CHAIN_HR', 'NO_COLD_UP'])

async function admin(req: NextRequest) {
  const g = await grantForRequest(req)
  const ok = g.isSuperAdmin || (g.roles ?? []).some((r: any) => INBOX_ADMIN_ROLES.has(r.role_code))
  return {
    ok,
    grant: g,
    deny: NextResponse.json({
      error: 'Changing the inbox policy needs an HR admin role.',
      holds: (g.roles ?? []).map((r: any) => r.role_name),
    }, { status: 403 }),
  }
}

const notReady = () => NextResponse.json({
  installed: false,
  reason: 'The inbox tables are not in the database yet (migration 080).',
})

export async function GET(req: NextRequest) {
  const a = await admin(req)
  if (!a.ok) return a.deny

  // Staffing a desk needs a people search. It runs here, behind the same
  // admin gate, rather than from the browser through the anon client — the
  // pattern the company master is still stuck with and that I am not going
  // to add another instance of.
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q) {
    const { data } = await sb.from('employees')
      .select('id, full_name, emp_code, designation')
      .or(`full_name.ilike.%${q}%,emp_code.ilike.%${q}%`)
      .limit(20).order('full_name')
    return NextResponse.json({ people: data ?? [] })
  }

  const { data: pol, error } = await sb.from('inbox_policy').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (notInstalled(error)) return notReady()
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const [{ data: roles }, { data: overrides }, { data: desks }, { data: agents }] = await Promise.all([
    sb.from('ess_roles').select('id, role_code, role_name').order('sort_order'),
    sb.from('inbox_reach_overrides').select('role_id, reach_mode'),
    sb.from('inbox_desks').select('*').order('sort_order'),
    sb.from('inbox_desk_agents')
      .select('id, desk_id, employee_id, is_active, employees!inner(full_name, emp_code)')
      .eq('is_active', true),
  ])

  return NextResponse.json({
    installed: true,
    policy: pol,
    roles: roles ?? [],
    overrides: overrides ?? [],
    desks: (desks ?? []).map((d: any) => ({
      ...d,
      agents: (agents ?? []).filter((x: any) => x.desk_id === d.id).map((x: any) => ({
        id: x.id, employee_id: x.employee_id,
        name: x.employees?.full_name, code: x.employees?.emp_code,
      })),
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const a = await admin(req)
  if (!a.ok) return a.deny
  const b = await req.json().catch(() => ({}))
  const by = a.grant.employeeId ?? null

  if (b.policy) {
    const p = b.policy
    const patch: Record<string, any> = { updated_by: by, updated_at: new Date().toISOString() }

    if (p.reach_mode !== undefined) {
      if (!REACH.has(p.reach_mode)) {
        return NextResponse.json({ error: 'Unknown reach mode.' }, { status: 400 })
      }
      patch.reach_mode = p.reach_mode
    }
    for (const k of ['allow_desk_threads', 'allow_group_threads']) {
      if (p[k] !== undefined) patch[k] = !!p[k]
    }
    if (p.max_direct_members !== undefined) {
      const n = Number(p.max_direct_members)
      // Mirrors the CHECK in 080 rather than relying on the database to
      // reject it, so the message says what is wrong instead of surfacing a
      // constraint name.
      if (!Number.isFinite(n) || n < 2 || n > 200) {
        return NextResponse.json({ error: 'A conversation can hold between 2 and 200 people.' }, { status: 400 })
      }
      patch.max_direct_members = Math.round(n)
    }
    if (Array.isArray(p.always_reachable_desks)) {
      patch.always_reachable_desks = p.always_reachable_desks.map(String)
    }

    const { error } = await sb.from('inbox_policy').update(patch).eq('id', 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, changed: Object.keys(patch).filter(k => k !== 'updated_by' && k !== 'updated_at') })
  }

  if (b.override) {
    const { role_id, reach_mode } = b.override
    if (!role_id) return NextResponse.json({ error: 'Which role?' }, { status: 400 })
    // An empty reach_mode clears the override rather than storing a blank —
    // "no override" and "override to nothing" must not be the same row.
    if (!reach_mode) {
      await sb.from('inbox_reach_overrides').delete().eq('role_id', role_id)
      return NextResponse.json({ ok: true, cleared: true })
    }
    if (!REACH.has(reach_mode)) return NextResponse.json({ error: 'Unknown reach mode.' }, { status: 400 })
    const { error } = await sb.from('inbox_reach_overrides').upsert(
      { role_id, reach_mode, updated_by: by, updated_at: new Date().toISOString() },
      { onConflict: 'role_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const a = await admin(req)
  if (!a.ok) return a.deny
  const b = await req.json().catch(() => ({}))
  const { desk_code, employee_id, action } = b

  const { data: desk } = await sb.from('inbox_desks')
    .select('id, label').eq('desk_code', String(desk_code || '')).maybeSingle()
  if (!desk) return NextResponse.json({ error: 'No such desk.' }, { status: 404 })
  if (!employee_id) return NextResponse.json({ error: 'Which employee?' }, { status: 400 })

  if (action === 'remove') {
    // Deactivated, not deleted: the thread history should still be able to
    // say who answered it at the time.
    await sb.from('inbox_desk_agents').update({ is_active: false })
      .eq('desk_id', desk.id).eq('employee_id', employee_id)
    return NextResponse.json({ ok: true })
  }

  const { error } = await sb.from('inbox_desk_agents').upsert(
    { desk_id: desk.id, employee_id, is_active: true, added_by: a.grant.employeeId ?? null },
    { onConflict: 'desk_id,employee_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, desk: desk.label })
}
