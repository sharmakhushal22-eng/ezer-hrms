// app/api/idcard/log/route.ts
//
//   GET -> who downloaded whose card, newest first
//
// The log is itself a record of who looked at personal data, which makes it
// personal data. So it is gated by the same permission as the download, and
// narrowed by the same scope: a Branch HR sees downloads of the people in
// their branch, not a company-wide history of everyone else's activity.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { refusalFor } from '@/lib/idcard/authz'
import { idCardCaller, applyScope } from '@/lib/idcard/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await idCardCaller(req)
  if (caller.scope.kind === 'none') {
    return NextResponse.json({ error: refusalFor(caller.scope) }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 500)

  let q = sb.from('id_card_downloads')
    .select('id, downloaded_at, actor_label, actor_role_codes, subject_employee_id, subject_emp_code, format, sides, batch_size, source')
    .order('downloaded_at', { ascending: false })
    .limit(limit)

  // Anything narrower than "all" means resolving which subjects are in reach
  // first. Two queries rather than a join, because the scope filter belongs on
  // employees (where location_id lives) and not on the log.
  if (caller.scope.kind !== 'all') {
    let e = sb.from('employees').select('id').neq('is_test', true)
    e = applyScope(e as never, caller.scope) as typeof e
    const { data: scoped, error: se } = await e.limit(5000)
    if (se) return NextResponse.json({ error: se.message }, { status: 500 })
    const ids = (scoped || []).map((r: { id: string }) => r.id)
    if (!ids.length) {
      return NextResponse.json({ rows: [], count: 0 }, { headers: { 'Cache-Control': 'no-store' } })
    }
    q = q.in('subject_employee_id', ids)
  }

  const { data, error } = await q
  if (error) {
    // The table arrives in migration 131. Until that runs, say so plainly
    // rather than showing an empty log that looks like "nobody has downloaded
    // anything" — which is a far more misleading thing for an audit screen to
    // claim than an honest error.
    const missing = /relation .* does not exist|schema cache/i.test(error.message)
    return NextResponse.json(
      { error: missing ? 'The download log table is not created yet — migration 131 has not been run.' : error.message },
      { status: missing ? 503 : 500 },
    )
  }

  return NextResponse.json(
    { rows: data || [], count: (data || []).length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
