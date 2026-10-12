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
  if (ctx.caller.viewAs) return forbidden('Approvals cannot be actioned while viewing as somebody else.')
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
    if (res) {
      const st = String(res.status)
      // Words: Configuration → Employee lifecycle → Notifications, for the employee's company / branch.
      const scope = await employeeScope(res.employee_id)
      if (st === 'RETENTION_HOLD') await notifyFromTemplate(res.employee_id, 'notify.resignation.retention', { actor_name: actor }, { scope })
      else if (st.startsWith('PENDING_')) {
        await notifyFromTemplate(res.employee_id, 'notify.resignation.moved', { actor_name: actor, next_stage: st.replace('PENDING_', '').replace('_', ' ') }, { scope })
        await notifyFromTemplate(res.current_approver_id, 'notify.resignation.awaiting', { stage: res.current_stage }, { scope, link: '/ess?tab=approvals' })
      } else if (res.final_lwd) await notifyFromTemplate(res.employee_id, 'notify.resignation.lwd', { last_working_day: fmtDate(res.final_lwd) }, { scope })
    }
    await audit(ctx.caller, `RESIGNATION_${code}`, res?.employee_id || null, { resignation_id: id, note: body.note || null, lwd: body.lwd || null })
    return NextResponse.json({ ok: true, result: out })
  }

  return NextResponse.json({ error: 'Travel claims are actioned from the Travel Claims screen.' }, { status: 400 })
}
