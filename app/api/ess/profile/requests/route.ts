// app/api/ess/profile/requests/route.ts
//
//   GET  ?scope=mine    -> what I have filed, and where each one sits
//   GET  ?scope=queue   -> what I may act on as an approver
//   POST { action: 'approve' | 'reject', id, remarks? }
//   POST { action: 'cancel',  id }
//
// WHO MAY DO WHAT IS NOT DECIDED HERE.
//
// 105's profile_change_can_act() is the single authority, and both the queue
// listing and the decision call go through it — so the list can only ever
// contain rows that decide() will actually accept. Deciding that here as well
// would be a second copy of the rule, free to drift from the first; the usual
// way that ends is a screen offering an Approve button that errors on click.
//
// The route's job is narrower: establish WHO is calling from a signed session,
// refuse the shared-login and view-as cases, and forward.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

/** 105 is not in yet. A deployment state, not a caller error — say which
 *  migration is missing rather than surfacing a raw PostgREST code. */
function notReady(e: { code?: string; message?: string }) {
  if (e.code === 'PGRST202' || e.code === 'PGRST205') {
    return 'The profile approval queue is not installed yet (migration 105).'
  }
  if (e.code === '42501') {
    return 'The approval functions exist but are not granted to the service role. '
         + 'Re-run the grants at the bottom of migration 105.'
  }
  return null
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  const scope = req.nextUrl.searchParams.get('scope') === 'queue' ? 'queue' : 'mine'

  const { data, error: rpcErr } = await sb.rpc(
    scope === 'queue' ? 'profile_change_queue' : 'profile_change_mine',
    scope === 'queue' ? { p_actor: me } : { p_employee: me },
  )
  if (rpcErr) return bad(notReady(rpcErr) ?? rpcErr.message, 500)

  return NextResponse.json({ ok: true, scope, requests: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  // Approving is an act with a name attached to it. The shared dashboard login
  // has no employee record to attach, and acting inside somebody else's portal
  // would file the decision under THEM — which is exactly the confusion the
  // Fun Zone invite bug turned out to be.
  if (ctx.caller.viewAs) {
    return bad(ctx.caller.actorEmployeeId === null
      ? 'This session is the shared dashboard login, which is not attached to an '
        + 'employee record. Sign in with your own ESS account to approve requests.'
      : 'You are viewing somebody else\'s portal, so this decision would be '
        + 'recorded as them. Open your own portal to approve requests.', 403)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : ''

  if (!['approve', 'reject', 'cancel'].includes(action)) {
    return bad('Action must be approve, reject or cancel.')
  }
  if (!id) return bad('Which request?')

  // A rejection that says nothing is the complaint HR fields all day: the
  // employee sees "Not approved" and has no idea what to fix.
  if (action === 'reject' && !remarks) {
    return bad('A reason is required when rejecting — the employee sees it.')
  }

  const { data, error: rpcErr } = action === 'cancel'
    ? await sb.rpc('profile_change_cancel', { p_request: id, p_actor: me })
    : await sb.rpc('profile_change_decide', {
        p_request: id, p_actor: me, p_decision: action,
        p_remarks: remarks || null,
      })

  if (rpcErr) {
    const ready = notReady(rpcErr)
    if (ready) return bad(ready, 500)
    // 105 raises these by hand for the cases a person can actually hit —
    // already decided, not your stage, not your request. They are answers,
    // not faults, so they go back as 403/409 with the text as written.
    const m = rpcErr.message ?? ''
    if (/not the approver|Only the person who raised/i.test(m)) return bad(m, 403)
    if (/already|nothing to withdraw/i.test(m)) return bad(m, 409)
    return bad(m, 500)
  }

  return NextResponse.json({ ok: true, ...(data as object ?? {}) })
}
