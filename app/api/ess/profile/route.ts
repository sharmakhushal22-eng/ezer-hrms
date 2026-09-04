// app/api/ess/profile/route.ts
//
//   GET  ?code=SRS0512        -> the profile payload (own profile if no code)
//   POST { action: 'request' } -> raise a change request
//   POST { action: 'edit' }    -> save a `direct` field immediately
//
// WHY THE VENDOR'S VERSION IS NOT USED
//
// The drop shipped its own getViewerId() in lib/profile/access.ts, which reads
// the Supabase session and then FALLS BACK to an `x-employee-code` header or an
// `ezer_emp` cookie. Their own integration guide says of it:
//
//     "Delete the fallback block before go-live — with it in place, anyone can
//      set a header and read any profile."
//
// Rather than ship that and hope somebody remembers, the caller is resolved the
// way the rest of ESS resolves it: essRoute, from a signed session token. There
// is no header path and nothing to remember to delete.
//
// The masking is not done here either. get_employee_profile() decides the
// viewer's positional role and strips what they may not read, server-side,
// before the payload leaves the database. This route never widens that — it
// only forwards.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { MODEL } from '@/lib/profile/model'
import type { FieldState } from '@/lib/profile/types'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

/** 091 is not in, or 099 has not been run and the RPC still throws. Both are
 *  deployment states rather than caller errors, and both deserve to say so
 *  instead of surfacing a raw Postgres message on the screen. */
function notReady(e: { code?: string; message?: string }) {
  if (e.code === 'PGRST202' || e.code === 'PGRST205') {
    return 'The profile module is not installed yet (migration 091).'
  }
  if (e.code === '42703' && /ur\.employee_id/.test(e.message ?? '')) {
    return 'The profile service needs migration 099. Ask your administrator to run it.'
  }
  return null
}

/** The model is the authority on what a field is allowed to do. Looking it up
 *  here means the client cannot promote a `locked` field to `direct` by
 *  sending a different action — the button it drew is a suggestion, this is
 *  the decision. */
function fieldSpec(key: string) {
  for (const groups of Object.values(MODEL)) {
    for (const g of groups ?? []) {
      const f = g.fields.find(x => x.key === key)
      if (f) return f
    }
  }
  return null
}

const ALLOWED_BY_STATE: Record<FieldState, 'edit' | 'request' | null> = {
  direct: 'edit', request: 'request', event: 'request', locked: null,
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  // A colleague is opened by employee code, never by id — an id in a URL is
  // an invitation to walk the table.
  const code = req.nextUrl.searchParams.get('code')?.trim()
  let subject = me
  if (code) {
    const { data } = await sb.from('employees').select('id').eq('emp_code', code).maybeSingle()
    if (!data) return bad('No employee with that code.', 404)
    subject = (data as { id: string }).id
  }

  const { data, error: dbErr } = await sb.rpc('get_employee_profile', {
    p_employee_id: subject, p_viewer_id: me,
  })
  if (dbErr) {
    const friendly = notReady(dbErr)
    return friendly ? bad(friendly, 503) : bad(dbErr.message, 500)
  }

  // The RPC reports its own refusals in the payload rather than raising.
  const payload = data as { error?: string } | null
  if (payload?.error === 'employee_not_found') return bad('No such employee.', 404)
  if (payload?.error === 'viewer_not_found')   return bad('Your employee record could not be found.', 403)
  if (payload?.error === 'viewer_inactive')    return bad('Your record is marked as having left.', 403)

  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  const value = typeof body.value === 'string' ? body.value : ''

  const spec = fieldSpec(key)
  if (!spec) return bad('That is not a field on this profile.')

  const permitted = ALLOWED_BY_STATE[spec.state]
  if (!permitted) return bad(`${spec.label} is maintained elsewhere and cannot be changed here.`, 403)
  if (permitted !== action) {
    return bad(action === 'edit'
      ? `${spec.label} needs approval, so it has to go through a request.`
      : `${spec.label} is yours to change directly.`)
  }

  // You edit your OWN profile. Viewing a colleague is read-only, and an
  // administrator changing somebody's record does it from the HR screens where
  // it is audited as an administrative act rather than as the person.
  const subjectCode = typeof body.code === 'string' ? body.code.trim() : ''
  if (subjectCode) {
    const { data } = await sb.from('employees').select('id').eq('emp_code', subjectCode).maybeSingle()
    if ((data as { id: string } | null)?.id !== me) {
      return bad('You can only change your own profile here.', 403)
    }
  }
  if (ctx.caller.viewAs) {
    return bad(ctx.caller.actorEmployeeId === null
      ? 'This session is the shared dashboard login, which is not attached to an '
        + 'employee record. Sign in with your own ESS account to change a profile.'
      : 'You are viewing somebody else\'s portal, so this would be recorded as them. '
        + 'Open your own portal to change your details.', 403)
  }

  if (action === 'edit') {
    if (!value.trim()) return bad(`${spec.label} cannot be emptied here.`)
    // The explicit write column, never derived from the displayed source.
    // 091 renamed fourteen columns on the way in, so `employees.alt_mobile`
    // reads correctly on screen and does not exist to UPDATE — the real one
    // is alternate_mobile. A field with no column declared cannot be written.
    const column = spec.column
    if (!column) return bad(`${spec.label} cannot be edited directly.`, 400)
    const { error: upErr } = await sb.from('employees').update({ [column]: value }).eq('id', me)
    if (upErr) return bad(upErr.message, 500)
    return NextResponse.json({ ok: true, saved: spec.label })
  }

  // action === 'request'
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!value.trim()) return bad('What should it be changed to?')
  if (!reason) return bad('A reason is required — HR sees it when they review this.')

  const { data, error: reqErr } = await sb.rpc('raise_profile_change_request', {
    p_employee_id: me, p_requested_by: me, p_field_key: key,
    p_field_label: spec.label, p_new_value: value.trim(), p_reason: reason,
  })
  if (reqErr) {
    // 091 raises this by name when the field has no row in profile_field_config,
    // which is a configuration gap rather than anything the employee did.
    if (/not configured/i.test(reqErr.message)) {
      return bad(`${spec.label} has no approval route configured yet. HR needs to add it to `
               + `profile_field_config before requests can be raised against it.`, 503)
    }
    return bad(reqErr.message, 500)
  }
  return NextResponse.json({ ok: true, request_id: data })
}
