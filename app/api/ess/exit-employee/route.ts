// /api/ess/exit-employee — ESS → HR Services → Exit, "Exit an employee": the hiring and HR roles
// (lib/exit/hr-exit.ts EXIT_ROLES) process another employee's exit.
//   GET  ?q=…   -> { allowed, reasons, matches }  — reasons, and active employees in the caller's
//                  company matching an employee code / name (at most 10)
//   POST { employee_id, reason_code, date_of_exit, remarks }
//        -> an employee_resignation row initiated by HR with the final last working day set,
//           employees.last_working_date, a stage-log entry, the employee told by bell and mail.
//           On the date of exit the daily offboarding run (lib/offboarding/run.ts) switches off
//           their ESS access, roles and reporting lines — straight away when the date is today
//           or earlier.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, notify } from '@/lib/ess/session'
import { canExitOthers, exitProblems, OPEN_EXIT } from '@/lib/exit/hr-exit'
import { effectiveNoticeDays } from '@/lib/exit/notice'
import { revokeAccess } from '@/lib/offboarding/run'
import { sendMail, mailConfigured } from '@/lib/mail/send'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

async function allowedFor(ctx: any) {
  return canExitOthers(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
}
/** The company the caller may exit people in (null = any: super admin / cross-company). */
const scopeOf = (ctx: any): string | null => (ctx.grant.isSuperAdmin || ctx.grant.crossCompany) ? null : (ctx.companyId || null)

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (!(await allowedFor(ctx))) return NextResponse.json({ allowed: false, reasons: [], matches: [] })
  const { data: reasons } = await sb.from('exit_reason_master').select('code, category, label').eq('is_active', true).order('sort_order')
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  let matches: any[] = []
  if (q.length >= 2) {
    const co = scopeOf(ctx)
    const like = `%${q.replace(/[%_,()]/g, '')}%`
    let s = sb.from('employees').select('id, full_name, emp_code, designation, company_doj, last_working_date, departments:department_id(dept_name)')
      .neq('employment_status', 'Resigned').or(`emp_code.ilike.${like},full_name.ilike.${like}`).order('emp_code').limit(10)
    if (co) s = s.eq('company_id', co)
    const { data } = await s
    matches = (data || []).filter((e: any) => e.id !== ctx.caller.employeeId)
      .map((e: any) => ({ id: e.id, full_name: e.full_name, emp_code: e.emp_code, designation: e.designation, department: e.departments?.dept_name || null, doj: e.company_doj, lwd: e.last_working_date }))
  }
  return NextResponse.json({ allowed: true, reasons: reasons || [], matches })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so this exit has nobody to process it. Sign in again with your own ESS account.'
      : 'An exit can only be processed from your own portal, not while you are viewing somebody else\'s.')
  }
  if (!(await allowedFor(ctx))) return forbidden('Only the HR team and Hiring Managers can exit an employee.')
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const x = { employeeId: String(body.employee_id || '') || null, reasonCode: String(body.reason_code || '') || null, dateOfExit: String(body.date_of_exit || '') || null, remarks: String(body.remarks || '').trim() || null }

  const { data: reasons } = await sb.from('exit_reason_master').select('code, label').eq('is_active', true)
  const problems = exitProblems(x, { self: me, reasons: (reasons || []).map((r: any) => r.code) })
  if (problems.length) return bad(problems.join(' '))

  const { data: emp } = await sb.from('employees')
    .select('id, full_name, emp_code, company_id, employment_status, office_email, personal_email, notice_period_days, confirmation_status, confirmation_date, company_doj, group_doj, probation_months, access_revoked_at')
    .eq('id', x.employeeId!).maybeSingle()
  if (!emp) return bad('Employee not found.', 404)
  const co = scopeOf(ctx)
  if (co && emp.company_id !== co) return forbidden('This employee belongs to another company.')
  if (emp.access_revoked_at || emp.employment_status === 'Resigned') return bad(`${emp.full_name} (${emp.emp_code}) has already left.`, 409)
  const { data: open } = await sb.from('employee_resignation').select('id, status').eq('employee_id', emp.id).in('status', OPEN_EXIT).limit(1)
  if (open?.length) return bad(`${emp.full_name} (${emp.emp_code}) already has an exit in progress (${String(open[0].status).replace(/_/g, ' ').toLowerCase()}). Finish it from Tasks & Approvals.`, 409)

  const { data: meRow } = await sb.from('employees').select('full_name, emp_code').eq('id', me).maybeSingle()
  const byName = meRow ? `${meRow.full_name} (${meRow.emp_code})` : 'HR'
  const reasonLabel = (reasons || []).find((r: any) => r.code === x.reasonCode)?.label || x.reasonCode!
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  const { data: res, error } = await sb.from('employee_resignation').insert({
    employee_id: emp.id, reason_code: x.reasonCode, date_of_resignation: today,
    notice_period_days: effectiveNoticeDays(emp as any), lwd_as_per_policy: x.dateOfExit, final_lwd: x.dateOfExit,
    status: 'INITIATED', current_stage: null, current_approver_id: null,
    submitted_by_employee: false, submitted_at: now, remarks: x.remarks,
    initiated_by: me, initiated_by_name: byName,
  }).select('id').single()
  if (error) return bad(error.message, 500)

  await sb.from('resignation_stage_log').insert({
    resignation_id: res.id, stage: 'HR_MANAGER', approver_id: me, actor_id: me, action: 'FINAL_LWD_SET', proposed_lwd: x.dateOfExit,
    note: `Exit processed by ${byName}: ${reasonLabel}${x.remarks ? `. ${x.remarks}` : ''}`, actioned_at: now,
  }).then(() => null, () => null)
  await sb.from('employees').update({ date_of_resignation: today, last_working_date: x.dateOfExit }).eq('id', emp.id)

  // On or before today: access ends now; later dates are picked up by the daily offboarding run.
  let revokedNow = false
  if (x.dateOfExit! <= today) {
    try { await revokeAccess(sb as any, emp.id, { reason: `Exit processed by HR: ${reasonLabel}`, by: me, byName, lastWorkingDay: x.dateOfExit }); revokedNow = true } catch { /* the daily run retries */ }
  }

  // Tell the employee — bell, and mail where there is an address.
  const lwd = day(x.dateOfExit!)
  await notify(emp.id, 'Your exit has been processed', `HR has processed your exit (${reasonLabel}). Your last working day is ${lwd}. Download your payslips and documents before then; ESS access ends on that day.`, '/ess', 'COMPLIANCE').catch(() => null)
  let mailed = false
  const to = emp.office_email || emp.personal_email
  if (to && mailConfigured()) {
    const sent = await sendMail({
      to, fromName: 'EZER HR Team',
      subject: `Your exit has been processed: last working day ${lwd}`,
      text: `Hi ${emp.full_name},\n\nHR has processed your exit from the company.\nReason: ${reasonLabel}\nLast working day: ${lwd}\n\nPlease download your payslips, letters and other documents from ESS before your last working day; your ESS access ends on that day.\n\nEZER HR Team`,
      html: `<p>Hi ${esc(emp.full_name)},</p><p>HR has processed your exit from the company.</p><p><b>Reason:</b> ${esc(reasonLabel)}<br><b>Last working day:</b> ${esc(lwd)}</p><p>Please download your payslips, letters and other documents from ESS before your last working day; your ESS access ends on that day.</p><p>EZER HR Team</p>`,
    }).catch(() => ({ sent: false }))
    mailed = !!(sent as any).sent
  }

  await audit(ctx.caller, 'EXIT_PROCESSED_BY_HR', emp.id, { resignation_id: res.id, reason_code: x.reasonCode, date_of_exit: x.dateOfExit, by: byName, revoked_now: revokedNow })
  return NextResponse.json({ ok: true, id: res.id, employee: `${emp.full_name} (${emp.emp_code})`, last_working_day: x.dateOfExit, revoked_now: revokedNow, mailed })
}
