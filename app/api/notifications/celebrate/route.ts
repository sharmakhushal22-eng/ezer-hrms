// app/api/notifications/celebrate/route.ts
//
//   POST { employee_id, kind: 'BIRTHDAY' | 'ANNIVERSARY', years? }
//
// The HR dashboard's celebrations widget used to insert straight into
// ess_notifications with the browser's anon client. That worked, but it meant
// a second writer with its own idea of what a notification is: no catalogue
// code, no priority, and — the reason this route exists — no way to know the
// recipient cannot log in.
//
// 128 of 398 active employees have no ESS account. Wishing one of them
// previously showed a tick and delivered nothing anybody could ever open.

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify } from '@/lib/notifications/dispatch'

export async function POST(req: NextRequest) {
  const auth = await requireDashboardUser(req)
  if (auth.error) return auth.error

  const body = await req.json().catch(() => null) as
    { employee_id?: string; kind?: string; years?: number } | null
  const to = body?.employee_id
  const kind = (body?.kind ?? 'BIRTHDAY').toUpperCase()
  const years = Number(body?.years) || 0

  if (!to) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
  if (kind !== 'BIRTHDAY' && kind !== 'ANNIVERSARY') {
    return NextResponse.json({ error: "kind must be BIRTHDAY or ANNIVERSARY" }, { status: 400 })
  }

  const { data: emp } = await sb.from('employees')
    .select('id, full_name').eq('id', to).is('date_of_leaving', null).maybeSingle()
  if (!emp) return NextResponse.json({ error: 'No such active employee' }, { status: 404 })

  const first = emp.full_name.split(/\s+/)[0]
  const isB = kind === 'BIRTHDAY'
  const plural = years === 1 ? '' : 's'

  const res = await notify({
    subjectId: to,                  // audience is SELF — it is about them
    code: isB ? 'BIRTHDAY' : 'ANNIVERSARY',
    title: isB ? '🎂 Happy Birthday!' : `🌟 Happy Work Anniversary — ${years} year${plural}!`,
    body: isB
      ? `Wishing you a very happy birthday, ${first}! Have a wonderful year ahead. — Team HR`
      : `Congratulations on completing ${years} year${plural} with us, ${first}. Thank you for everything you do! — Team HR`,
  })

  const blind = res.undeliverable.length > 0
  return NextResponse.json({
    ok: true,
    sent: res.sent,
    deliverable: !blind,
    warning: blind
      ? `${emp.full_name} has no active ESS login, so this is saved but cannot be opened yet.`
      : undefined,
  })
}
