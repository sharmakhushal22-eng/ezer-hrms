// /api/ess/resignation — the employee's own resignation: submit, see the chain, withdraw.
// The chain itself (stamping, stage skipping, HR final LWD) lives in 071's
// fn_resignation_submit / fn_resignation_advance / fn_resignation_act.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essCaller, audit, forbidden } from '@/lib/ess/session'
import { employeeScope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { mailResignationStep } from '@/lib/exit/mail'

export const dynamic = 'force-dynamic'

const OPEN = ['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING']

export async function GET(req: NextRequest) {
  const c = await essCaller(req)
  if (c.error) return c.error
  const me = c.caller.employeeId
  const [{ data: rows }, { data: reasons }, { data: emp }] = await Promise.all([
    sb.from('employee_resignation').select('*, exit_reason_master(label, category)').eq('employee_id', me).order('created_at', { ascending: false }).limit(3),
    sb.from('exit_reason_master').select('code, category, label').eq('is_active', true).order('sort_order'),
    sb.from('employees').select('notice_period_days, l1_manager_id, l2_manager_id, hod_id, hr_manager_id, department_id').eq('id', me).maybeSingle(),
  ])
  const current = (rows || []).find((r: any) => OPEN.includes(r.status)) || (rows || [])[0] || null
  let chain: any[] = []
  if (current) {
    const { data } = await sb.from('resignation_stage_log').select('stage, action, note, proposed_lwd, actioned_at, approver:employees!resignation_stage_log_approver_id_fkey(full_name, emp_code, designation)').eq('resignation_id', current.id).order('actioned_at')
    chain = data || []
  }
  // Who each stage goes to — the same resolution as 071's fn_resignation_stage_approver, so
  // the timeline can name the L1 / L2 / HOD / HR Manager (with their codes) before they act.
  const approvers: Record<string, { id: string; full_name: string; emp_code: string | null; designation: string | null } | null> = { RM_L1: null, RM_L2: null, HOD: null, HR_MANAGER: null }
  if (emp) {
    let hod = emp.hod_id as string | null
    if (!hod && emp.department_id) { const { data: d } = await sb.from('departments').select('hod_employee_id').eq('id', emp.department_id).maybeSingle(); hod = d?.hod_employee_id || null }
    let hr = emp.hr_manager_id as string | null
    if (!hr) { const { data: r } = await sb.rpc('fn_resignation_stage_approver', { p_employee_id: me, p_stage: 'HR_MANAGER' }); hr = (r as string | null) || null }
    const ids: [string, string | null][] = [['RM_L1', emp.l1_manager_id], ['RM_L2', emp.l2_manager_id], ['HOD', hod], ['HR_MANAGER', hr]]
    const want = [...new Set(ids.map(([, id]) => id).filter((x): x is string => !!x && x !== me))]
    const { data: people } = want.length ? await sb.from('employees').select('id, full_name, emp_code, designation').in('id', want) : { data: [] as any[] }
    const by = new Map<string, any>(((people || []) as any[]).map(p => [p.id, p]))
    for (const [stage, id] of ids) approvers[stage] = id && by.get(id) ? { id, full_name: by.get(id).full_name, emp_code: by.get(id).emp_code ?? null, designation: by.get(id).designation ?? null } : null
  }
  return NextResponse.json({ current, chain, approvers, reasons: reasons || [], notice_period_days: emp?.notice_period_days ?? 30 })
}

export async function POST(req: NextRequest) {
  const c = await essCaller(req)
  if (c.error) return c.error
  // See app/api/ess/mrf/route.ts. The old wording was already careful not to
  // accuse anyone, but it still left a lapsed ESS session with no idea what to
  // do about it.
  if (c.caller.viewAs) {
    return forbidden(c.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so this resignation has nobody to submit it. '
        + 'Sign in again with your own ESS account.'
      : 'A resignation can only be submitted by the employee themself, so it cannot be '
        + 'done while you are viewing somebody else\'s portal.')
  }
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
    // Words: Configuration → Employee lifecycle → Notifications → "Resignation — acknowledgement needed".
    await notifyFromTemplate(res.current_approver_id, 'notify.resignation.submitted',
      { employee_name: meRow?.full_name || 'An employee', emp_code: meRow?.emp_code || '', stage: res.current_stage },
      { scope: await employeeScope(me), link: '/ess?tab=approvals' })
  }
  // Mail: the employee gets the acknowledgement of receipt, the first approver hears it is with them.
  await mailResignationStep(sb as any, { resignationId: id, stage: 'EMPLOYEE', action: 'STAMPED', actorId: res?.current_approver_id || null, baseUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin }).catch(e => console.warn('resignation submit mail failed', e))
  await audit(c.caller, 'RESIGNATION_SUBMITTED', me, { resignation_id: id, reason_code: body.reason_code })
  return NextResponse.json({ ok: true, id, status: res?.status, stage: res?.current_stage })
}
