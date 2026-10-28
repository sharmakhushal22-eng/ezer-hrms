// /api/ess/exit-employee — an exit the company starts (lib/exit/hr-exit.ts), from the red Exit
// button on People → Employees → employee detail, approved in Tasks & Approvals.
//   GET  ?target=<employee id> -> { allowed, reasons, employee, request, blocked }
//                                 the live request (PENDING / APPROVED / REJECTED) with its chain
//   GET  ?inbox=1              -> { items } requests whose current step waits on the caller
//   POST { action: 'start', employee_id, reason_code, sub_reason, lwd, remarks }
//   POST { action: 'approve' | 'reject', id, note }   the current step's approver
//   POST { action: 'cancel', id, note }                running or approved (not yet left)
//   POST { action: 'reset', id }                       a rejected one, so another can start
// Nothing touches the employee until the last approval. Then: an employee_resignation row with
// the final last working day, employees.last_working_date, the employee told by bell and mail;
// on or before today their access ends at once (lib/offboarding/run.ts), otherwise on that day.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, notify } from '@/lib/ess/session'
import {
  canExitOthers, OPEN_EXIT, HR_EXIT_REASONS, STAGES, SHOWN_STATUSES, reasonOf, suggestedLwd, startProblems,
  buildChain, advance, decide, waitingOn, type ChainStep, type Person,
} from '@/lib/exit/hr-exit'
import { effectiveNoticeDays } from '@/lib/exit/notice'
import { revokeAccess } from '@/lib/offboarding/run'
import { sendMail, mailConfigured } from '@/lib/mail/send'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const today = () => new Date().toISOString().slice(0, 10)
const APPROVALS_LINK = '/ess?tab=approvals'

const allowedFor = (ctx: any) => canExitOthers(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
/** The company the caller may exit people in (null = any: super admin / cross-company). */
const scopeOf = (ctx: any): string | null => (ctx.grant.isSuperAdmin || ctx.grant.crossCompany) ? null : (ctx.companyId || null)
const who = (p: Person) => `${p.full_name}${p.emp_code ? ` (${p.emp_code})` : ''}`

async function personOf(id: string): Promise<Person> {
  const { data } = await sb.from('employees').select('id, emp_code, full_name').eq('id', id).maybeSingle()
  return { id, emp_code: data?.emp_code ?? null, full_name: data?.full_name || 'HR' }
}

/** Active holders of every stage role, in one company. */
async function holdersIn(companyId: string | null): Promise<Record<string, Person[]>> {
  const codes = Array.from(new Set(Object.values(STAGES).flatMap(s => s.roles)))
  const { data } = await sb.from('ess_user_roles')
    .select('is_active, ess_roles!inner(role_code), ess_accounts!inner(employee_id, employees(id, emp_code, full_name, company_id, employment_status, access_revoked_at))')
    .eq('is_active', true).in('ess_roles.role_code', codes)
  const out: Record<string, Person[]> = {}
  for (const r of (data || []) as any[]) {
    const e = r.ess_accounts?.employees
    if (!e || e.access_revoked_at || e.employment_status === 'Resigned') continue
    if (companyId && e.company_id !== companyId) continue
    ;(out[r.ess_roles.role_code] ||= []).push({ id: e.id, emp_code: e.emp_code, full_name: e.full_name })
  }
  return out
}

async function tellApprovers(step: ChainStep, emp: Person, reasonLabel: string) {
  await Promise.all(step.approvers.map(p => notify(p.id, `Exit approval: ${who(emp)}`,
    `${reasonLabel}. Waiting on you as ${step.label}. Approve or reject it in Tasks & Approvals.`, APPROVALS_LINK, 'APPROVAL').catch(() => null)))
}

const shape = (r: any) => r && ({
  id: r.id, employee_id: r.employee_id, reason_code: r.reason_code, reason_label: r.reason_label, sub_reason: r.sub_reason,
  last_working_day: r.last_working_day, remarks: r.remarks, status: r.status, chain: r.chain || [], current_step: r.current_step,
  rehire_flag: r.rehire_flag, initiated_by_name: r.initiated_by_name, created_at: r.created_at, decided_at: r.decided_at,
})

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId
  const sp = req.nextUrl.searchParams

  if (sp.get('inbox')) {
    const { data } = await sb.from('hr_exit_requests').select('*, employees!hr_exit_requests_employee_id_fkey(full_name, emp_code, designation)').eq('status', 'PENDING').order('created_at')
    const items = (data || []).filter((x: any) => waitingOn(x.chain || [], me))
      .map((x: any) => ({ ...shape(x), employee: { full_name: x.employees?.full_name, emp_code: x.employees?.emp_code, designation: x.employees?.designation } }))
    return NextResponse.json({ items })
  }

  const allowed = allowedFor(ctx)
  const target = sp.get('target')
  if (!allowed || !target) return NextResponse.json({ allowed, reasons: [], employee: null, request: null, blocked: null })

  const { data: emp } = await sb.from('employees')
    .select('id, full_name, emp_code, company_id, employment_status, last_working_date, access_revoked_at, notice_period_days, confirmation_status, confirmation_date, company_doj, group_doj, probation_months')
    .eq('id', target).maybeSingle()
  if (!emp) return bad('Employee not found.', 404)
  const co = scopeOf(ctx)
  if (co && emp.company_id !== co) return forbidden('This employee belongs to another company.')

  const [{ data: reqs }, { data: open }, { data: att }] = await Promise.all([
    sb.from('hr_exit_requests').select('*').eq('employee_id', emp.id).in('status', SHOWN_STATUSES).order('created_at', { ascending: false }).limit(1),
    sb.from('employee_resignation').select('id, status').eq('employee_id', emp.id).in('status', OPEN_EXIT).limit(1),
    sb.from('attendance_records').select('attendance_date').eq('employee_id', emp.id).not('work_in', 'is', null).order('attendance_date', { ascending: false }).limit(1),
  ])
  const request = reqs?.[0] || null
  const noticeDays = effectiveNoticeDays(emp as any)
  const lastAttendance = (att?.[0] as any)?.attendance_date || null
  const reasons = HR_EXIT_REASONS.map(x => ({
    code: x.code, label: x.label, sub_reasons: x.subReasons, lwd_hint: x.lwdHint, rehire: x.rehire,
    chain: x.chain.map(s => STAGES[s].label), lwd: suggestedLwd(x.code, { today: today(), noticeDays, lastAttendance }),
  }))
  // Nothing live of ours, but the employee cannot be exited from here: already gone, or a
  // resignation they filed themselves is still running.
  const blocked = request ? null
    : (emp.access_revoked_at || emp.employment_status === 'Resigned') ? `${emp.full_name} has already left.`
    : open?.length ? `${emp.full_name} already has a resignation in progress (${String(open[0].status).replace(/_/g, ' ').toLowerCase()}). It is handled in Tasks & Approvals.`
    : null
  return NextResponse.json({
    allowed, reasons, blocked, request: shape(request), notice_days: noticeDays, last_attendance: lastAttendance,
    employee: { id: emp.id, full_name: emp.full_name, emp_code: emp.emp_code, employment_status: emp.employment_status, left: !!emp.access_revoked_at },
  })
}

/** The last approval: the exit takes effect. */
async function applyExit(row: any, by: Person): Promise<{ resignationId: string | null; revokedNow: boolean; mailed: boolean }> {
  const { data: emp } = await sb.from('employees')
    .select('id, full_name, emp_code, office_email, personal_email, notice_period_days, confirmation_status, confirmation_date, company_doj, group_doj, probation_months')
    .eq('id', row.employee_id).maybeSingle()
  if (!emp) return { resignationId: null, revokedNow: false, mailed: false }
  const now = new Date().toISOString(), t = today(), lwd = row.last_working_day as string
  const why = `${row.reason_label}${row.sub_reason ? ` · ${row.sub_reason}` : ''}`
  const { data: res } = await sb.from('employee_resignation').insert({
    employee_id: emp.id, reason_code: null, date_of_resignation: t,
    notice_period_days: effectiveNoticeDays(emp as any), lwd_as_per_policy: lwd, final_lwd: lwd,
    status: 'INITIATED', current_stage: null, current_approver_id: null,
    submitted_by_employee: false, submitted_at: now, remarks: `${why}. ${row.remarks || ''}`.trim(),
    initiated_by: row.initiated_by, initiated_by_name: row.initiated_by_name,
  }).select('id').single()
  if (res?.id) {
    await sb.from('resignation_stage_log').insert({
      resignation_id: res.id, stage: 'HR_MANAGER', approver_id: by.id, actor_id: by.id, action: 'FINAL_LWD_SET', proposed_lwd: lwd,
      note: `Company exit (${why}) started by ${row.initiated_by_name}, approved by the chain; last approval ${who(by)}`, actioned_at: now,
    }).then(() => null, () => null)
  }
  await sb.from('employees').update({ date_of_resignation: t, last_working_date: lwd }).eq('id', emp.id)
  let revokedNow = false
  if (lwd <= t) {
    try { await revokeAccess(sb as any, emp.id, { reason: `Company exit: ${why}`, by: by.id, byName: who(by), lastWorkingDay: lwd }); revokedNow = true } catch { /* the daily run retries */ }
  }
  await notify(emp.id, 'Your exit has been processed', `HR has processed your exit (${row.reason_label}). Your last working day is ${day(lwd)}. Download your payslips and documents before then; ESS access ends on that day.`, '/ess', 'COMPLIANCE').catch(() => null)
  let mailed = false
  const to = emp.office_email || emp.personal_email
  if (to && mailConfigured()) {
    const sent = await sendMail({
      to, fromName: 'EZER HR Team',
      subject: `Your exit has been processed: last working day ${day(lwd)}`,
      text: `Hi ${emp.full_name},\n\nHR has processed your exit from the company.\nReason: ${row.reason_label}\nLast working day: ${day(lwd)}\n\nPlease download your payslips, letters and other documents from ESS before your last working day; your ESS access ends on that day.\n\nEZER HR Team`,
      html: `<p>Hi ${esc(emp.full_name)},</p><p>HR has processed your exit from the company.</p><p><b>Reason:</b> ${esc(row.reason_label)}<br><b>Last working day:</b> ${esc(day(lwd))}</p><p>Please download your payslips, letters and other documents from ESS before your last working day; your ESS access ends on that day.</p><p>EZER HR Team</p>`,
    }).catch(() => ({ sent: false }))
    mailed = !!(sent as any).sent
  }
  return { resignationId: res?.id || null, revokedNow, mailed }
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so this exit has nobody to act on it. Sign in again with your own ESS account.'
      : 'An exit can only be acted on from your own portal, not while you are viewing somebody else\'s.')
  }
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const actor = await personOf(me)
  const now = new Date().toISOString()

  if (action === 'start') {
    if (!allowedFor(ctx)) return forbidden('Only the HR team and Hiring Managers can exit an employee.')
    const x = { employeeId: String(body.employee_id || '') || null, reasonCode: String(body.reason_code || '') || null, subReason: String(body.sub_reason || '') || null, lwd: String(body.lwd || '') || null, remarks: String(body.remarks || '').trim() || null }
    const problems = startProblems(x, { self: me })
    if (problems.length) return bad(problems.join(' '))
    const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, employment_status, access_revoked_at').eq('id', x.employeeId!).maybeSingle()
    if (!emp) return bad('Employee not found.', 404)
    const co = scopeOf(ctx)
    if (co && emp.company_id !== co) return forbidden('This employee belongs to another company.')
    if (emp.access_revoked_at || emp.employment_status === 'Resigned') return bad(`${who(emp as any)} has already left.`, 409)
    const [{ data: live }, { data: open }] = await Promise.all([
      sb.from('hr_exit_requests').select('id, status').eq('employee_id', emp.id).in('status', SHOWN_STATUSES).limit(1),
      sb.from('employee_resignation').select('id, status').eq('employee_id', emp.id).in('status', OPEN_EXIT).limit(1),
    ])
    if (live?.length) return bad(`${who(emp as any)} already has an exit (${String(live[0].status).toLowerCase()}). Open the Exit button to see it.`, 409)
    if (open?.length) return bad(`${who(emp as any)} already has a resignation in progress (${String(open[0].status).replace(/_/g, ' ').toLowerCase()}). It is handled in Tasks & Approvals.`, 409)

    const reason = reasonOf(x.reasonCode)!
    const target: Person = { id: emp.id, emp_code: emp.emp_code, full_name: emp.full_name }
    const built = buildChain(reason.code, { holders: await holdersIn(emp.company_id), initiator: actor, initiatorRoles: ctx.menu.roles || [], employeeId: emp.id, now })
    const { chain, current, done } = advance(built, now)
    const { data: row, error } = await sb.from('hr_exit_requests').insert({
      employee_id: emp.id, company_id: emp.company_id, reason_code: reason.code, reason_label: reason.label, sub_reason: x.subReason,
      last_working_day: x.lwd, remarks: x.remarks, status: done ? 'APPROVED' : 'PENDING', chain, current_step: current,
      rehire_flag: reason.rehire, initiated_by: me, initiated_by_name: who(actor), decided_at: done ? now : null,
    }).select('*').single()
    if (error) return bad(/hr_exit_requests/.test(error.message) && /does not exist|schema cache/.test(error.message)
      ? 'The exit approvals table is missing. Run migration 172_hr_exit_requests.sql in the Supabase SQL Editor.' : error.message, 500)
    let applied = null
    if (done) {
      applied = await applyExit(row, actor)
      if (applied.resignationId) await sb.from('hr_exit_requests').update({ resignation_id: applied.resignationId }).eq('id', row.id)
    } else if (current != null) {
      await tellApprovers(chain[current], target, `${reason.label} · ${x.subReason}`)
    }
    await audit(ctx.caller, 'EXIT_STARTED_BY_HR', emp.id, { request_id: row.id, reason: reason.code, sub_reason: x.subReason, lwd: x.lwd, approved_at_once: done })
    return NextResponse.json({ ok: true, request: shape({ ...row, resignation_id: applied?.resignationId }), applied })
  }

  const id = String(body.id || '')
  if (!id) return bad('Which exit?')
  const { data: row } = await sb.from('hr_exit_requests').select('*').eq('id', id).maybeSingle()
  if (!row) return bad('Exit not found.', 404)
  const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, access_revoked_at').eq('id', row.employee_id).maybeSingle()
  const target: Person = { id: row.employee_id, emp_code: emp?.emp_code ?? null, full_name: emp?.full_name || 'the employee' }

  if (action === 'approve' || action === 'reject') {
    if (row.status !== 'PENDING') return bad(`This exit is ${String(row.status).toLowerCase()}, not waiting on an approval.`, 409)
    let chain: ChainStep[]
    try { chain = decide(row.chain || [], { actor, approve: action === 'approve', note: body.note, now, superAdmin: false }) }
    catch (e: any) { return bad(e.message, 403) }
    const step = chain[row.current_step ?? chain.findIndex(s => s.status !== 'PENDING')]
    const { chain: next, current, done } = action === 'approve' ? advance(chain, now) : { chain, current: null, done: false }
    const status = action === 'reject' ? 'REJECTED' : done ? 'APPROVED' : 'PENDING'
    // Conditional on the step it was read at, so two approvers cannot both act on it.
    const { data: upd, error } = await sb.from('hr_exit_requests')
      .update({ chain: next, current_step: current, status, updated_at: now, decided_at: status === 'PENDING' ? null : now })
      .eq('id', row.id).eq('status', 'PENDING').eq('current_step', row.current_step).select('*')
    if (error) return bad(error.message, 500)
    if (!upd?.length) return bad('Somebody acted on this exit a moment ago. Reload to see where it is.', 409)
    let applied = null
    if (status === 'APPROVED') {
      applied = await applyExit(upd[0], actor)
      if (applied.resignationId) await sb.from('hr_exit_requests').update({ resignation_id: applied.resignationId }).eq('id', row.id)
    } else if (status === 'PENDING' && current != null) {
      await tellApprovers(next[current], target, `${row.reason_label}${row.sub_reason ? ` · ${row.sub_reason}` : ''}`)
    }
    if (row.initiated_by && row.initiated_by !== me) {
      const what = status === 'REJECTED' ? `rejected by ${who(actor)} (${step?.label || 'approver'}): ${String(body.note || '').trim()}`
        : status === 'APPROVED' ? `fully approved. Last working day ${day(row.last_working_day)}.` : `approved by ${who(actor)} (${step?.label || 'approver'}); now with the ${next[current!]?.label}.`
      await notify(row.initiated_by, `Exit of ${who(target)}: ${status === 'REJECTED' ? 'rejected' : 'approved'}`, `${row.reason_label} exit ${what}`, '/dashboard/employees', 'APPROVAL').catch(() => null)
    }
    await audit(ctx.caller, action === 'approve' ? 'EXIT_APPROVED' : 'EXIT_REJECTED', row.employee_id, { request_id: row.id, stage: step?.stage, note: body.note || null, final: status })
    return NextResponse.json({ ok: true, request: shape(upd[0]), applied })
  }

  if (action === 'cancel' || action === 'reset') {
    if (!allowedFor(ctx)) return forbidden('Only the HR team and Hiring Managers can do this.')
    const co = scopeOf(ctx)
    if (co && row.company_id !== co) return forbidden('This employee belongs to another company.')
    if (action === 'reset' && row.status !== 'REJECTED') return bad('Only a rejected exit is reset. A running one is cancelled.', 409)
    if (action === 'cancel' && !['PENDING', 'APPROVED'].includes(row.status)) return bad(`This exit is ${String(row.status).toLowerCase()}; there is nothing to cancel.`, 409)
    if (action === 'cancel' && row.status === 'APPROVED' && emp?.access_revoked_at) return bad(`${who(target)} has already left on ${day(row.last_working_day)}, so the exit cannot be cancelled here.`, 409)
    const note = String(body.note || '').trim() || null
    const { data: upd, error } = await sb.from('hr_exit_requests')
      .update({ status: action === 'cancel' ? 'CANCELLED' : 'RESET', current_step: null, closed_by: me, closed_by_name: who(actor), close_note: note, closed_at: now, updated_at: now })
      .eq('id', row.id).eq('status', row.status).select('*')
    if (error) return bad(error.message, 500)
    if (!upd?.length) return bad('This exit changed a moment ago. Reload to see where it is.', 409)
    if (action === 'cancel' && row.status === 'APPROVED') {
      // Undo what the approval did: the resignation is withdrawn, the dates cleared.
      if (row.resignation_id) {
        await sb.from('employee_resignation').update({ status: 'WITHDRAWN' }).eq('id', row.resignation_id)
        await sb.from('resignation_stage_log').insert({ resignation_id: row.resignation_id, stage: 'HR_MANAGER', approver_id: me, actor_id: me, action: 'WITHDRAWN', note: `Company exit cancelled by ${who(actor)}${note ? `: ${note}` : ''}`, actioned_at: now }).then(() => null, () => null)
      }
      await sb.from('employees').update({ date_of_resignation: null, last_working_date: null }).eq('id', row.employee_id)
      await notify(row.employee_id, 'Your exit has been cancelled', `HR has cancelled your exit (${row.reason_label}). You continue in your role.`, '/ess', 'COMPLIANCE').catch(() => null)
    }
    if (action === 'cancel' && row.status === 'PENDING') {
      const pending = (row.chain || []).find((s: ChainStep) => s.status === 'PENDING')
      await Promise.all((pending?.approvers || []).map((p: Person) => notify(p.id, `Exit cancelled: ${who(target)}`, `The ${row.reason_label} exit waiting on you was cancelled by ${who(actor)}.`, APPROVALS_LINK, 'APPROVAL').catch(() => null)))
    }
    await audit(ctx.caller, action === 'cancel' ? 'EXIT_CANCELLED' : 'EXIT_RESET', row.employee_id, { request_id: row.id, was: row.status, note })
    return NextResponse.json({ ok: true })
  }

  return bad("action must be 'start', 'approve', 'reject', 'cancel' or 'reset'")
}
