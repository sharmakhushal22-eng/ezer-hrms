// GET /api/ess/team?scope=TEAM|DEPT — the roster this login may see, with the
// status pill the mockup shows (answers F2: notice period beats leave beats normal).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, fmtDate } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const asked = (req.nextUrl.searchParams.get('scope') || '').toUpperCase()
  const scope = asked === 'DEPT' && ctx.menu.is_hod ? 'DEPT' : asked === 'ORG' && (ctx.canCompany || ctx.grant.isSuperAdmin) ? 'ORG' : 'TEAM'
  if (scope === 'TEAM' && !ctx.menu.is_rm && !ctx.grant.isSuperAdmin) return forbidden('Nobody reports to you, so there is no team roster to show.')

  const { data: ids, error } = await sb.rpc('ess_scope_employee_ids', { p_employee_id: ctx.caller.employeeId, p_scope: scope })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const list: string[] = (ids || []).map((x: any) => (typeof x === 'string' ? x : x.ess_scope_employee_ids))
  if (!list.length) return NextResponse.json({ scope, rows: [] })

  const today = new Date().toISOString().slice(0, 10)
  const [{ data: emps }, { data: res }, { data: leaves }] = await Promise.all([
    sb.from('employees').select('id, emp_code, full_name, designation, department_id, departments!employees_department_id_fkey(dept_name), l1_manager_id').in('id', list).order('emp_code'),
    sb.from('employee_resignation').select('employee_id, status, final_lwd, lwd_as_per_policy').in('employee_id', list).not('status', 'in', '("SETTLED","WITHDRAWN")'),
    sb.from('leave_applications').select('employee_id, from_date, to_date').in('employee_id', list).eq('status', 'APPROVED').lte('from_date', today).gte('to_date', today),
  ])
  const notice = new Map<string, string>()
  ;(res || []).forEach((x: any) => notice.set(x.employee_id, x.final_lwd || x.lwd_as_per_policy))
  const onLeave = new Map<string, string>()
  ;(leaves || []).forEach((x: any) => onLeave.set(x.employee_id, x.to_date))

  const rows = (emps || []).map((e: any) => {
    let status = 'Normal', tone: 'ok' | 'warn' | 'info' = 'ok'
    if (notice.has(e.id)) { status = `Notice period · LWD ${fmtDate(notice.get(e.id))}`; tone = 'warn' }
    else if (onLeave.has(e.id)) {
      const back = new Date(onLeave.get(e.id)!); back.setDate(back.getDate() + 1)
      status = `On leave · back ${fmtDate(back.toISOString())}`; tone = 'info'
    }
    return { id: e.id, code: e.emp_code, name: e.full_name, designation: e.designation, department: e.departments?.dept_name || null, direct: e.l1_manager_id === ctx.caller.employeeId, status, tone }
  })
  return NextResponse.json({ scope, rows })
}
