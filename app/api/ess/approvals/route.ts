// /api/ess/approvals — GET the full list (stamped-to-me ∪ scope extras), POST an action.
//
// Every action re-checks on the server that the row is stamped to the caller —
// the list is a convenience, never the authorization (guide §7). Resignation
// actions go through fn_resignation_act (071), which enforces the stage itself.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, notify, audit, fmtDate } from '@/lib/ess/session'
import { buildPending } from '@/lib/ess/pending'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (!ctx.canApprovals) return forbidden()
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

  if (kind === 'LEAVE') {
    const { data: l } = await sb.from('leave_applications').select('id, employee_id, status, current_approver_id, from_date, to_date, days').eq('id', id).maybeSingle()
    if (!l) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 })
    if (l.current_approver_id !== me && !ctx.grant.isSuperAdmin) return forbidden('This request is not waiting on you.')
    if (l.status !== 'PENDING') return NextResponse.json({ error: `Already ${String(l.status).toLowerCase()}.` }, { status: 409 })
    const approve = action === 'Approve' || action === 'APPROVE'
    const { error } = await sb.from('leave_applications').update({
      status: approve ? 'APPROVED' : 'REJECTED', resolved_at: new Date().toISOString(),
      approver: meRow?.full_name || null, approver_employee_id: me, remark: body.note || null,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await notify(l.employee_id, approve ? 'Leave approved' : 'Leave declined',
      `${Number(l.days)} day${Number(l.days) === 1 ? '' : 's'} from ${fmtDate(l.from_date)} — ${approve ? 'approved' : 'declined'} by ${meRow?.full_name || 'your manager'}${body.note ? ': ' + body.note : ''}.`)
    await audit(ctx.caller, approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', l.employee_id, { leave_id: id, note: body.note || null })
    return NextResponse.json({ ok: true, status: approve ? 'APPROVED' : 'REJECTED' })
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
      if (st === 'RETENTION_HOLD') await notify(res.employee_id, 'Retention conversation requested', `${actor} has asked to discuss your resignation before it moves ahead.`)
      else if (st.startsWith('PENDING_')) {
        await notify(res.employee_id, 'Resignation moved ahead', `${actor} acknowledged your resignation. It is now with ${st.replace('PENDING_', '').replace('_', ' ')}.`)
        await notify(res.current_approver_id, 'Resignation awaiting you', `A resignation in your chain needs your acknowledgement (stage ${res.current_stage}).`, '/ess?tab=approvals')
      } else if (res.final_lwd) await notify(res.employee_id, 'Last working day confirmed', `HR has set your last working day as ${fmtDate(res.final_lwd)}.`)
    }
    await audit(ctx.caller, `RESIGNATION_${code}`, res?.employee_id || null, { resignation_id: id, note: body.note || null, lwd: body.lwd || null })
    return NextResponse.json({ ok: true, result: out })
  }

  return NextResponse.json({ error: 'Travel claims are actioned from the Travel Claims screen.' }, { status: 400 })
}
