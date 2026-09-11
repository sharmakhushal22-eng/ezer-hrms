// app/api/ess/celebrations/route.ts
//
//   GET  ?employee_id=…   -> { birthdays: [...], anniversaries: [...] }
//   POST { to_employee_id, kind, message }  -> sends a wish
//
// This is the "wish a colleague happy birthday" flow. The catalogue has
// BIRTHDAY and ANNIVERSARY, but both are system date-matches that tell YOU it
// is your own birthday — there is no code for a colleague wishing you. That is
// the thing people actually open a bell for, so it is added here as
// WISH_RECEIVED rather than bent into one of the existing codes.
//
// The wish itself is stored in ess_kudos (from_employee_id, to_employee_id,
// message, badge), which already exists and is exactly this shape. No new
// table.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { notify } from '@/lib/notifications/dispatch'

interface Celebrant {
  id: string; emp_code: string | null; full_name: string
  designation: string | null; dept_name: string | null
  years?: number; already_wished: boolean
}

/** Same month and day, ignoring the year. Done in JS rather than SQL because
 *  the column is a plain date and Postgres date_part filters are not
 *  expressible through PostgREST without a view. 398 rows is cheap. */
const isToday = (iso: string | null, today: Date): boolean => {
  if (!iso) return false
  const d = new Date(iso)
  return d.getUTCMonth() === today.getUTCMonth() && d.getUTCDate() === today.getUTCDate()
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId

  const today = new Date()

  const { data: emps, error: e1 } = await sb.from('employees')
    .select('id, emp_code, full_name, designation, date_of_birth, company_doj, company_id, department_id')
    .is('date_of_leaving', null)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // Only colleagues in the same company — a birthday strip listing all three
  // companies' staff is noise, not a nicety. ctx already resolved the company.
  const sameCo = (emps ?? []).filter(e => !ctx.companyId || e.company_id === ctx.companyId)

  const birthdayRows    = sameCo.filter(e => isToday(e.date_of_birth, today))
  const anniversaryRows = sameCo.filter(e => isToday(e.company_doj, today) && e.company_doj)

  // Which of them I have already wished today, so the button can flip to
  // "Wished" instead of letting somebody send five in a row.
  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString()
  const { data: sent } = await sb.from('ess_kudos')
    .select('to_employee_id').eq('from_employee_id', me).gte('created_at', startOfDay)
  const wished = new Set((sent ?? []).map(k => k.to_employee_id))

  const deptIds = Array.from(new Set([...birthdayRows, ...anniversaryRows].map(e => e.department_id).filter(Boolean)))
  const deptName = new Map<string, string>()
  if (deptIds.length) {
    const { data: ds } = await sb.from('departments').select('id, dept_name').in('id', deptIds as string[])
    for (const d of ds ?? []) deptName.set(d.id, d.dept_name)
  }

  const shape = (e: typeof sameCo[number], years?: number): Celebrant => ({
    id: e.id, emp_code: e.emp_code, full_name: e.full_name,
    designation: e.designation,
    dept_name: e.department_id ? deptName.get(e.department_id) ?? null : null,
    years, already_wished: wished.has(e.id),
  })

  return NextResponse.json({
    birthdays: birthdayRows.filter(e => e.id !== me).map(e => shape(e)),
    anniversaries: anniversaryRows.filter(e => e.id !== me).map(e =>
      shape(e, today.getUTCFullYear() - new Date(e.company_doj!).getUTCFullYear())),
    // Your own, so the portal can say happy birthday to you too.
    mine: {
      birthday: birthdayRows.some(e => e.id === me),
      anniversary: anniversaryRows.some(e => e.id === me),
    },
  })
}

const KINDS = new Set(['BIRTHDAY', 'ANNIVERSARY', 'KUDOS'])

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId

  const body = await req.json().catch(() => null) as
    { to_employee_id?: string; kind?: string; message?: string } | null
  const to = body?.to_employee_id
  const kind = (body?.kind ?? 'BIRTHDAY').toUpperCase()
  const message = (body?.message ?? '').trim().slice(0, 500)

  if (!to) return NextResponse.json({ error: 'to_employee_id is required' }, { status: 400 })
  if (!KINDS.has(kind)) return NextResponse.json({ error: `kind must be one of ${[...KINDS].join(', ')}` }, { status: 400 })
  if (to === me) return NextResponse.json({ error: 'You cannot send yourself a wish' }, { status: 400 })

  const { data: recipient } = await sb.from('employees')
    .select('id, full_name').eq('id', to).is('date_of_leaving', null).maybeSingle()
  if (!recipient) return NextResponse.json({ error: 'No such active employee' }, { status: 404 })

  // One wish per person per day. Without this the bell becomes a spam target,
  // and there is no undo on a notification.
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  const { data: already } = await sb.from('ess_kudos')
    .select('id').eq('from_employee_id', me).eq('to_employee_id', to)
    .gte('created_at', startOfDay.toISOString()).limit(1)
  if ((already ?? []).length) {
    return NextResponse.json({ ok: true, duplicate: true, message: 'Already wished today' })
  }

  const { data: sender } = await sb.from('employees')
    .select('full_name, designation').eq('id', me).maybeSingle()
  const senderName = sender?.full_name ?? 'A colleague'

  const { error: kErr } = await sb.from('ess_kudos').insert({
    from_employee_id: me, to_employee_id: to,
    message: message || null, badge: kind, points: 0,
  })
  if (kErr) return NextResponse.json({ error: kErr.message }, { status: 500 })

  const title =
    kind === 'BIRTHDAY'    ? `🎂 ${senderName} wished you a happy birthday`
  : kind === 'ANNIVERSARY' ? `🌟 ${senderName} congratulated you on your work anniversary`
  :                          `👏 ${senderName} sent you kudos`

  const res = await notify({
    subjectId: me,
    toEmployeeId: to,
    code: kind === 'KUDOS' ? 'KUDOS_RECEIVED' : 'WISH_RECEIVED',
    title,
    body: message || undefined,
  })

  // 128 of 398 active employees have no ESS login. The wish is stored either
  // way, but saying "sent!" for something the recipient can never open is a
  // lie the sender has no way to detect.
  const blind = res.undeliverable.length > 0
  return NextResponse.json({
    ok: true,
    notified: res.sent,
    to: recipient.full_name,
    deliverable: !blind,
    warning: blind
      ? `${recipient.full_name} has no active ESS login yet, so this is saved but cannot be opened.`
      : undefined,
  })
}
