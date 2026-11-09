// app/api/exit/lwd/route.ts — the HR Manager's hold on an approved exit (lib/exit/lwd.ts).
//
//   GET  ?employee_id=…   -> { can_manage, today, resignation }   the approved exit (a resignation
//                            the employee filed, or the one an HR exit created) with its dates,
//                            the notice waiver and the history of LWD changes
//   POST { action: 'update_lwd', resignation_id, lwd, reason }    move the final LWD — any time
//                            until the current LWD has passed
//   POST { action: 'waive', resignation_id, days, reason }        waive the notice period, wholly
//                            or in part (0 clears a waiver)
//
// Only the HR Manager (and the super admin) — lib/exit/lwd.ts canManageLwd — in the companies
// their roles are valid in. A change follows the date everywhere it is kept: the resignation
// (final_lwd, notice shortfall, recovery), employees.last_working_date (access ends that day,
// lib/offboarding/run.ts), the HR exit request and a draft F&F. The employee is told.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, notify } from '@/lib/ess/session'
import { allowedCompanies } from '@/lib/rms/resolve'
import { canManageLwd, lwdChangeProblem, waiverProblem, shortfallDays, type LwdChange } from '@/lib/exit/lwd'
import { revokeAccess } from '@/lib/offboarding/run'
import { isSilent } from '@/lib/exit/hr-exit'

export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const today = () => new Date().toISOString().slice(0, 10)
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const scopeOf = (ctx: any): string[] | null => (ctx.grant.isSuperAdmin || ctx.grant.crossCompany) ? null : allowedCompanies(ctx.grant, null)
const mayManage = (ctx: any) => canManageLwd(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)

/** The approved exit of an employee: the newest resignation with a final LWD, not withdrawn. */
async function approvedExit(employeeId: string) {
  const { data } = await sb.from('employee_resignation').select('*, exit_reason_master(label)')
    .eq('employee_id', employeeId).neq('status', 'WITHDRAWN').not('final_lwd', 'is', null)
    .order('created_at', { ascending: false }).limit(1)
  return (data as any[])?.[0] || null
}

/** The shortfall and recovery for the dates and waiver, and the status that follows from them. */
function settle(res: any, finalLwd: string, waived: number) {
  const short = shortfallDays({ policyLwd: res.lwd_as_per_policy, finalLwd, waivedDays: waived })
  const status = ['RECOVERY_PENDING', 'SETTLED'].includes(res.status) ? (short > 0 ? 'RECOVERY_PENDING' : 'SETTLED') : res.status
  return { notice_shortfall_days: short, recovery_required: short > 0, status }
}

const shape = (r: any) => r && ({
  id: r.id, status: r.status, reason: r.exit_reason_master?.label || r.reason_code || null, submitted_by_employee: !!r.submitted_by_employee,
  date_of_resignation: r.date_of_resignation, notice_period_days: r.notice_period_days, lwd_as_per_policy: r.lwd_as_per_policy,
  tentative_lwd: r.tentative_lwd || null, final_lwd: r.final_lwd, notice_shortfall_days: r.notice_shortfall_days || 0,
  notice_waived_days: r.notice_waived_days || 0, notice_waiver_reason: r.notice_waiver_reason || null,
  notice_waived_by_name: r.notice_waived_by_name || null, notice_waived_at: r.notice_waived_at || null,
  lwd_history: Array.isArray(r.lwd_history) ? r.lwd_history : [],
})

async function guard(ctx: any, resignationId: string) {
  if (!mayManage(ctx)) return { error: forbidden('Only the HR Manager can change the last working day or waive the notice period.') }
  const { data: res } = await sb.from('employee_resignation').select('*').eq('id', resignationId).maybeSingle()
  if (!res) return { error: bad('Exit not found.', 404) }
  if (res.status === 'WITHDRAWN') return { error: bad('This resignation was withdrawn.', 409) }
  const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, access_revoked_at').eq('id', res.employee_id).maybeSingle()
  if (!emp) return { error: bad('Employee not found.', 404) }
  const co = scopeOf(ctx)
  if (co && !co.includes(emp.company_id)) return { error: forbidden('This employee belongs to another company.') }
  return { res, emp }
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const employeeId = req.nextUrl.searchParams.get('employee_id') || ''
  if (!employeeId) return bad('employee_id required')
  const { data: emp } = await sb.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
  if (!emp) return bad('Employee not found.', 404)
  const co = scopeOf(ctx)
  if (co && !co.includes(emp.company_id)) return forbidden('This employee belongs to another company.')
  const res = await approvedExit(employeeId)
  return NextResponse.json({ can_manage: mayManage(ctx), today: today(), resignation: shape(res) })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active. Sign in again with your own ESS account.'
      : 'The last working day can only be changed from your own portal, not while you are viewing somebody else\'s.')
  }
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const g = await guard(ctx, String(body.resignation_id || ''))
  if (g.error) return g.error
  const { res, emp } = g
  const { data: meRow } = await sb.from('employees').select('full_name, emp_code').eq('id', me).maybeSingle()
  const byName = meRow ? `${meRow.full_name}${meRow.emp_code ? ` (${meRow.emp_code})` : ''}` : 'HR'
  const now = new Date().toISOString()
  const reason = String(body.reason || '').trim().slice(0, 500) || null
  // An HR exit for a death, an abscond and the like: nothing goes to the employee.
  const { data: hx } = await sb.from('hr_exit_requests').select('id, reason_code').eq('resignation_id', res.id).maybeSingle()
  const silent = hx?.reason_code ? isSilent(hx.reason_code) : false

  if (body.action === 'update_lwd') {
    const next = String(body.lwd || '').slice(0, 10)
    const why = lwdChangeProblem({ current: res.final_lwd, next, today: today(), resignedOn: res.date_of_resignation })
    if (why) return bad(why, 409)
    if (emp.access_revoked_at) return bad(`${emp.full_name}'s access has already ended, so the last working day can no longer be changed.`, 409)
    if (!reason) return bad('Give the reason for changing the last working day.')
    const history: LwdChange[] = [...(Array.isArray(res.lwd_history) ? res.lwd_history : []), { from: res.final_lwd, to: next, reason, by: me, by_name: byName, at: now }]
    const { error } = await sb.from('employee_resignation').update({
      final_lwd: next, lwd_confirmed_by_emp: next, lwd_history: history, ...settle(res, next, Number(res.notice_waived_days) || 0),
    }).eq('id', res.id).eq('final_lwd', res.final_lwd)   // two HR Managers cannot both move it
    if (error) return bad(/lwd_history/.test(error.message) ? 'Run migration 207_exit_lwd_controls.sql in Supabase first.' : error.message, 500)
    await sb.from('employees').update({ last_working_date: next }).eq('id', emp.id)
    if (hx) await sb.from('hr_exit_requests').update({ last_working_day: next, updated_at: now }).eq('id', hx.id)
    const { data: fnf } = await sb.from('fnf_settlements').select('id, status').eq('resignation_id', res.id).maybeSingle()
    if (fnf && fnf.status === 'CALCULATED') await sb.from('fnf_settlements').update({ last_working_day: next }).eq('id', fnf.id)
    if (next <= today()) {
      await revokeAccess(sb as any, emp.id, { reason: `Last working day ${next} (changed by HR)`, by: me, byName, lastWorkingDay: next }).catch(e => console.error('revoke on LWD change failed', e))
    }
    if (!silent) await notify(emp.id, 'Your last working day has changed', `HR has changed your last working day from ${day(res.final_lwd)} to ${day(next)}. Reason: ${reason}`, '/ess/exit', 'COMPLIANCE').catch(() => null)
    await audit(ctx.caller, 'EXIT_LWD_CHANGED', emp.id, { resignation_id: res.id, from: res.final_lwd, to: next, reason })
    return NextResponse.json({ ok: true, resignation: shape(await approvedExit(emp.id)),
      fnf_note: fnf && fnf.status !== 'CALCULATED' ? `The F&F is already ${String(fnf.status).toLowerCase()}; recalculate it for the new date.` : null })
  }

  if (body.action === 'waive') {
    const days = Math.round(Number(body.days))
    const notice = Number(res.notice_period_days) || 0
    const why = waiverProblem({ days, noticeDays: notice, reason })
    if (why) return bad(why)
    if (res.final_lwd && res.final_lwd < today()) return bad('The last working day has passed; settle the notice in the F&F instead.', 409)
    const { error } = await sb.from('employee_resignation').update({
      notice_waived_days: days, notice_waiver_reason: days ? reason : null,
      notice_waived_by: days ? me : null, notice_waived_by_name: days ? byName : null, notice_waived_at: days ? now : null,
      ...(res.final_lwd ? settle(res, res.final_lwd, days) : {}),
    }).eq('id', res.id)
    if (error) return bad(/notice_waived/.test(error.message) ? 'Run migration 207_exit_lwd_controls.sql in Supabase first.' : error.message, 500)
    const { data: fnf } = await sb.from('fnf_settlements').select('id, status').eq('resignation_id', res.id).maybeSingle()
    const whole = days >= notice && notice > 0
    if (!silent && days) await notify(emp.id, whole ? 'Your notice period has been waived' : 'Part of your notice period has been waived',
      `HR has waived ${whole ? 'your whole notice period' : `${days} of your ${notice} notice days`}. No recovery is made for ${whole ? 'it' : 'those days'}.`, '/ess/exit', 'COMPLIANCE').catch(() => null)
    await audit(ctx.caller, days ? 'EXIT_NOTICE_WAIVED' : 'EXIT_NOTICE_WAIVER_CLEARED', emp.id, { resignation_id: res.id, days, notice, reason })
    return NextResponse.json({ ok: true, resignation: shape(await approvedExit(emp.id)),
      fnf_note: fnf ? 'Recalculate the F&F so the notice recovery reflects the waiver.' : null })
  }

  return bad("action must be 'update_lwd' or 'waive'")
}
