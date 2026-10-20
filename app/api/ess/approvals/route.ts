// /api/ess/approvals — GET the full list (stamped-to-me ∪ scope extras), POST an action.
//
// Every action re-checks on the server that the row is stamped to the caller —
// the list is a convenience, never the authorization (guide §7). Resignation
// actions go through fn_resignation_act (071), which enforces the stage itself.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, fmtDate } from '@/lib/ess/session'
import { employeeScope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { buildPending } from '@/lib/ess/pending'
import { revokeAccess } from '@/lib/offboarding/run'
import { mailResignationStep, mailResignationApproved } from '@/lib/exit/mail'
import { decideLeave, decideLeaveCancel, decideRegularisation, type Actor } from '@/lib/leave/workflow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  // Everyone can open Approvals (for the MRF / hiring block); a non-approver just
  // has an empty leave/travel/resignation list.
  // Built for everyone: a delegate or a cancellation approver can have rows
  // stamped to them without holding an approver role, and those must not be
  // invisible. For anybody with nothing stamped this is a few empty queries.
  const items = await buildPending(ctx)
  const id = req.nextUrl.searchParams.get('resignation_id')
  let chain: any[] | undefined
  if (id) {
    const { data } = await sb.from('resignation_stage_log').select('stage, action, note, proposed_lwd, actioned_at, approver:employees!resignation_stage_log_approver_id_fkey(full_name), actor:employees!resignation_stage_log_actor_id_fkey(full_name)').eq('resignation_id', id).order('actioned_at')
    chain = data || []
  }
  return NextResponse.json({ items, mine: items.filter(i => i.mine).length, chain })
}

const RES_ACTION: Record<string, string> = {
  'Acknowledge & forward': 'ACKNOWLEDGED', 'Accept with my date': 'ACCEPTED_WITH_DATE', 'Request retention': 'REQUESTED_RETENTION',
  'Resume chain': 'RESUMED', 'Set final LWD': 'FINAL_LWD_SET',
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  // See app/api/ess/mrf/route.ts for why these are two messages, not one. An
  // approval especially must not be mis-explained: the approver's identity IS
  // the decision, so "sign in again" and "you are viewing a colleague" need
  // telling apart.
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so this decision has nobody to attribute it to. '
        + 'Sign in again with your own ESS account to approve or reject.'
      : 'An approval is recorded under your own name, so it cannot be actioned while you '
        + 'are viewing somebody else\'s portal. Open your own portal to decide.')
  }
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const kind = String(body.kind || '')
  const id = String(body.id || '')
  const action = String(body.action || '')
  if (!kind || !id || !action) return NextResponse.json({ error: 'kind, id and action are required' }, { status: 400 })
  const { data: meRow } = await sb.from('employees').select('full_name').eq('id', me).maybeSingle()

  // Leave, cancellations of approved leave and attendance corrections all go
  // through lib/leave/workflow.ts — the same functions HR's override uses, so
  // the balance check, the attendance write and the notifications cannot drift
  // between the two screens.
  if (kind === 'LEAVE' || kind === 'LEAVE_CANCEL' || kind === 'REGULARISATION') {
    const approve = /^approve/i.test(action)
    if (!approve && !/^decline|^reject/i.test(action)) return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 })
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
    const actor: Actor = { employeeId: me, name: meRow?.full_name || 'your manager', isSuperAdmin: ctx.grant.isSuperAdmin }
    const out = kind === 'LEAVE' ? await decideLeave(id, actor, approve, note)
      : kind === 'LEAVE_CANCEL' ? await decideLeaveCancel(id, actor, approve, note)
      : await decideRegularisation(id, actor, approve, note)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    const what = kind === 'LEAVE'
      ? (out.stage === 'HR' ? 'LEAVE_L1_APPROVED' : approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED')
      : kind === 'LEAVE_CANCEL' ? (approve ? 'LEAVE_CANCEL_APPROVED' : 'LEAVE_CANCEL_DECLINED')
      : (approve ? 'REGULARISATION_APPROVED' : 'REGULARISATION_REJECTED')
    await audit(ctx.caller, what, null, { id, note })
    return NextResponse.json(out)
  }

  if (kind === 'RESIGNATION') {
    const code = RES_ACTION[action] || action
    const { data: out, error } = await sb.rpc('fn_resignation_act', {
      p_resignation_id: id, p_actor_id: me, p_action: code,
      p_note: body.note || null, p_lwd: body.lwd || null, p_regrettable: typeof body.regrettable === 'boolean' ? body.regrettable : null,
    })
    if (error) return NextResponse.json({ error: error.message.replace(/^.*?: /, '') }, { status: 409 })
    const { data: res } = await sb.from('employee_resignation').select('employee_id, status, current_approver_id, current_stage, final_lwd').eq('id', id).maybeSingle()
    const actor = meRow?.full_name || 'your manager'
    // Mail at every step: the employee hears what happened, the approver who acted gets a confirmation.
    const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    await mailResignationStep(sb as any, { resignationId: id, stage: String((out as any)?.stage || res?.current_stage || ''), action: code, actorId: me, note: body.note || null, lwd: body.lwd || null, baseUrl: base }).catch(e => console.warn('resignation step mail failed', e))
    if (res) {
      const st = String(res.status)
      // Words: Configuration → Employee lifecycle → Notifications, for the employee's company / branch.
      const scope = await employeeScope(res.employee_id)
      if (st === 'RETENTION_HOLD') await notifyFromTemplate(res.employee_id, 'notify.resignation.retention', { actor_name: actor }, { scope })
      else if (st.startsWith('PENDING_')) {
        await notifyFromTemplate(res.employee_id, 'notify.resignation.moved', { actor_name: actor, next_stage: st.replace('PENDING_', '').replace('_', ' ') }, { scope })
        await notifyFromTemplate(res.current_approver_id, 'notify.resignation.awaiting', { stage: res.current_stage }, { scope, link: '/ess?tab=approvals' })
      } else if (res.final_lwd) {
        await notifyFromTemplate(res.employee_id, 'notify.resignation.lwd', { last_working_day: fmtDate(res.final_lwd) }, { scope })
        // The chain is complete: "approved — download your documents before your last day".
        await mailResignationApproved(sb as any, id, base).catch(e => console.warn('resignation approved mail failed', e))
        // The final last working day goes on the employee record; on that day the daily
        // offboarding run revokes roles, access and reporting lines — at once if it is already here.
        const { data: cur } = await sb.from('employee_resignation').select('date_of_resignation').eq('id', id).maybeSingle()
        await sb.from('employees').update({ last_working_date: res.final_lwd, date_of_resignation: cur?.date_of_resignation || null }).eq('id', res.employee_id)
        if (String(res.final_lwd) <= new Date().toISOString().slice(0, 10)) {
          await revokeAccess(sb as any, res.employee_id, { reason: `Last working day ${res.final_lwd} (set by HR)`, by: me, byName: actor, lastWorkingDay: res.final_lwd }).catch(e => console.error('revoke on final LWD failed', e))
        }
      }
    }
    await audit(ctx.caller, `RESIGNATION_${code}`, res?.employee_id || null, { resignation_id: id, note: body.note || null, lwd: body.lwd || null })
    return NextResponse.json({ ok: true, result: out })
  }

  return NextResponse.json({ error: 'Travel claims are actioned from the Travel Claims screen.' }, { status: 400 })
}
