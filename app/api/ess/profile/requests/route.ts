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
import { approversFor, waitingOn, COMPOSITE_KEYS, compositePatch } from '@/lib/profile/server'

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

  const rows = (data ?? []) as Record<string, unknown>[]
  if (scope === 'queue' || !rows.length) return NextResponse.json({ ok: true, scope, requests: rows })

  // WHO IT IS WITH, BY NAME. 105's stage label says "With HR"; the person
  // asking wants to know whom to chase. The stage is the database's, the name
  // is the one the employee record assigns to that stage (lib/profile/server).
  // And for a decided request, who decided it.
  const [a, extra] = await Promise.all([
    approversFor(me),
    sb.from('profile_change_requests').select('id, route_to, approved_by, rejected_by')
      .in('id', rows.map(r => String(r.id))),
  ])
  const ex = new Map(((extra.data ?? []) as Record<string, string | null>[]).map(r => [r.id, r]))
  const deciders = [...new Set([...ex.values()].flatMap(r => [r.approved_by, r.rejected_by]).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (deciders.length) {
    const { data: ppl } = await sb.from('employees').select('id, full_name').in('id', deciders)
    for (const p of (ppl ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name)
  }
  const requests = rows.map(r => {
    const x = ex.get(String(r.id))
    const by = x?.approved_by ?? x?.rejected_by ?? null
    return { ...r, route_to: x?.route_to ?? null, waiting_on: waitingOn(String(r.status), a),
             decided_by: by ? names.get(by) ?? null : null }
  })
  return NextResponse.json({ ok: true, scope, requests })
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

  // COMPOSITE KEYS AT THEIR FINAL STAGE are applied here, not by 105.
  // profile_change_decide writes new_value into ONE column; an address is five
  // and a salary account four (lib/profile/server explains). Every other case
  // — reject, cancel, the line-manager step, single-column fields — still goes
  // to the database functions unchanged.
  if (action === 'approve') {
    const { data: rq } = await sb.from('profile_change_requests')
      .select('id, employee_id, field_key, field_label, new_value, status').eq('id', id).maybeSingle()
    const r = rq as Record<string, string> | null
    if (r && COMPOSITE_KEYS.includes(r.field_key) && (r.status === 'pending_hr' || r.status === 'pending_payroll')) {
      return applyComposite(me, r, remarks)
    }
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

/** Final approval of an address or salary account change.
 *
 *  Authority is NOT re-implemented: the request must be in the actor's own
 *  queue, which 105 builds from profile_change_can_act() — the same rule
 *  decide() checks. The status flip is guarded on the status read, so two
 *  approvers clicking at once cannot both apply it. */
async function applyComposite(me: string, r: Record<string, string>, remarks: string) {
  const { data: q, error: qErr } = await sb.rpc('profile_change_queue', { p_actor: me })
  if (qErr) return bad(notReady(qErr) ?? qErr.message, 500)
  if (!((q ?? []) as { id: string }[]).some(x => x.id === r.id)) {
    return bad('You are not the approver for this request at its current stage', 403)
  }
  const patch = compositePatch(r.field_key, r.new_value)
  if (!patch) return bad(`This ${r.field_label.toLowerCase()} request is not in a form that can be applied. Reject it with a note so it can be raised again.`, 409)

  const now = new Date().toISOString()
  const { data: flipped, error: fErr } = await sb.from('profile_change_requests')
    .update({ status: 'approved', approved_by: me, approved_at: now, applied_at: now, remarks: remarks || null })
    .eq('id', r.id).eq('status', r.status).select('id')
  if (fErr) return bad(fErr.message, 500)
  if (!flipped?.length) return bad('This request was already decided, so it cannot be decided again', 409)

  const { error: upErr } = await sb.from('employees').update(patch).eq('id', r.employee_id)
  if (upErr) {
    await sb.from('profile_change_requests')
      .update({ status: r.status, approved_by: null, approved_at: null, applied_at: null }).eq('id', r.id)
    return bad(`Could not apply the ${r.field_label.toLowerCase()}: ${upErr.message}`, 500)
  }
  return NextResponse.json({ ok: true, status: 'approved', applied: true })
}
