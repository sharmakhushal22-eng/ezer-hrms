// /api/ess/resignation — the employee's own resignation: submit, see the chain, withdraw.
// The chain itself (stamping, stage skipping, HR final LWD) lives in 071's
// fn_resignation_submit / fn_resignation_advance / fn_resignation_act.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essCaller, notify, audit, forbidden } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

const OPEN = ['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING']

export async function GET(req: NextRequest) {
  const c = await essCaller(req)
  if (c.error) return c.error
  const me = c.caller.employeeId
  const [{ data: rows }, { data: reasons }, { data: emp }] = await Promise.all([
    sb.from('employee_resignation').select('*, exit_reason_master(label, category)').eq('employee_id', me).order('created_at', { ascending: false }).limit(3),
    sb.from('exit_reason_master').select('code, category, label').eq('is_active', true).order('sort_order'),
    sb.from('employees').select('notice_period_days').eq('id', me).maybeSingle(),
  ])
  const current = (rows || []).find((r: any) => OPEN.includes(r.status)) || (rows || [])[0] || null
  let chain: any[] = []
  if (current) {
    const { data } = await sb.from('resignation_stage_log').select('stage, action, note, proposed_lwd, actioned_at, approver:employees!resignation_stage_log_approver_id_fkey(full_name, designation)').eq('resignation_id', current.id).order('actioned_at')
    chain = data || []
  }
  return NextResponse.json({ current, chain, reasons: reasons || [], notice_period_days: emp?.notice_period_days ?? 30 })
}

export async function POST(req: NextRequest) {
  const c = await essCaller(req)
  if (c.error) return c.error
  if (c.caller.viewAs) return forbidden('A resignation can only be submitted by the employee themself.')
  const me = c.caller.employeeId
  const body = await req.json().catch(() => ({}))

  if (body.action === 'WITHDRAW') {
    const { error } = await sb.rpc('fn_resignation_act', { p_resignation_id: body.id, p_actor_id: me, p_action: 'WITHDRAWN', p_note: body.note || null })
    if (error) return NextResponse.json({ error: error.message }, { status: 409 })
    await audit(c.caller, 'RESIGNATION_WITHDRAWN', me, { resignation_id: body.id })
    return NextResponse.json({ ok: true })
  }

  if (!body.reason_code) return NextResponse.json({ error: 'Pick a reason' }, { status: 400 })
  const { data: id, error } = await sb.rpc('fn_resignation_submit', {
    p_employee_id: me, p_reason_code: body.reason_code, p_date: body.date || new Date().toISOString().slice(0, 10), p_remarks: body.remarks || null,
  })
  if (error) return NextResponse.json({ error: error.message.replace(/^.*?: /, '') }, { status: 409 })
  const { data: res } = await sb.from('employee_resignation').select('status, current_stage, current_approver_id').eq('id', id).maybeSingle()
  if (res?.current_approver_id) {
    const { data: meRow } = await sb.from('employees').select('full_name, emp_code').eq('id', me).maybeSingle()
    await notify(res.current_approver_id, 'Resignation — acknowledgement needed', `${meRow?.full_name || 'An employee'}${meRow?.emp_code ? ' · ' + meRow.emp_code : ''} has submitted a resignation. It is waiting on you (${res.current_stage}).`, '/ess?tab=approvals')
  }
  await audit(c.caller, 'RESIGNATION_SUBMITTED', me, { resignation_id: id, reason_code: body.reason_code })
  return NextResponse.json({ ok: true, id, status: res?.status, stage: res?.current_stage })
}
