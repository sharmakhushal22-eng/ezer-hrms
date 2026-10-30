// /api/ess/exit-employee — an exit the company starts (lib/exit/hr-exit.ts), from the Exit section
// in People → Employees → employee → HR Actions, approved in Tasks & Approvals through THE SAME
// chain as an employee's own resignation: Reporting Manager (L1) → L2 Manager → HOD → HR Manager.
//   GET  ?target=<employee id> -> { allowed, reasons, employee, request, blocked }
//                                 the live request (PENDING / APPROVED / REJECTED) with its chain
//   GET  ?inbox=1              -> { items } requests whose current step waits on the caller
//   POST { action: 'start', target_id, reason_code, sub_reason, lwd, remarks, destination_company_id }
//        (target_id, not employee_id: lib/ess/asked reads a body employee_id as whose portal it is)
//   POST { action: 'act', id, act, note?, lwd? }       the current stage's approver: act is
//        ACKNOWLEDGED / ACCEPTED_WITH_DATE (lwd) / REQUESTED_RETENTION / RESUMED, or at the HR
//        Manager stage FINAL_LWD_SET (lwd) — the step that puts the exit into effect
//   POST { action: 'cancel', id, note }                running or approved (not yet left)
//   POST { action: 'reset', id }                       an older, rejected one, so another can start
// Nothing touches the employee until the final LWD is set. Then: an employee_resignation row with
// the final last working day, employees.last_working_date, the employee told by bell and mail;
// on or before today their access ends at once (lib/offboarding/run.ts), otherwise on that day.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, notify } from '@/lib/ess/session'
import {
  canExitOthers, isSilent, OPEN_EXIT, HR_EXIT_REASONS, STAGE_ORDER, ACTIONS, SHOWN_STATUSES, reasonOf, suggestedLwd, startProblems,
  buildChain, advance, act, actionsFor, proposedLwd, waitingOn, type ChainStep, type Person, type StageKey,
} from '@/lib/exit/hr-exit'
import { effectiveNoticeDays } from '@/lib/exit/notice'
import { allowedCompanies } from '@/lib/rms/resolve'
import { applyCompanyExit, sendAbscondReminder } from '@/lib/exit/case'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const today = () => new Date().toISOString().slice(0, 10)
const APPROVALS_LINK = '/ess?tab=approvals'

const allowedFor = (ctx: any) => canExitOthers(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
/** The company the caller may exit people in (null = any: super admin / cross-company). */
/** The companies the caller may act in (null = any: super admin / cross-company): their own,
 *  plus any their roles were scoped to (ess_user_roles.company_ids, migration 203). */
const scopeOf = (ctx: any): string[] | null => (ctx.grant.isSuperAdmin || ctx.grant.crossCompany) ? null : allowedCompanies(ctx.grant, null)
const who = (p: Person) => `${p.full_name}${p.emp_code ? ` (${p.emp_code})` : ''}`

async function personOf(id: string): Promise<Person> {
  const { data } = await sb.from('employees').select('id, emp_code, full_name').eq('id', id).maybeSingle()
  return { id, emp_code: data?.emp_code ?? null, full_name: data?.full_name || 'HR' }
}

/** Each stage's approver for this employee, resolved exactly as a resignation's are: 071's
 *  fn_resignation_stage_approver (L1, L2, HOD with the department fallback, the HR Manager with
 *  the company's resignation approver as fallback), then any active delegation. */
async function stageApprovers(employeeId: string): Promise<Record<StageKey, Person | null>> {
  const ids = await Promise.all(STAGE_ORDER.map(async stage => {
    const { data } = await sb.rpc('fn_resignation_stage_approver', { p_employee_id: employeeId, p_stage: stage })
    const id = (data as string | null) || null
    if (!id) return null
    const { data: eff } = await sb.rpc('ess_effective_approver', { p_employee_id: id })
    return ((eff as string | null) || id) as string
  }))
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  const { data: people } = want.length ? await sb.from('employees').select('id, emp_code, full_name').in('id', want) : { data: [] as any[] }
  const by = new Map<string, any>((people || []).map((p: any) => [p.id, p]))
  return Object.fromEntries(STAGE_ORDER.map((st, i) => {
    const p = ids[i] ? by.get(ids[i]!) : null
    return [st, p ? { id: p.id, emp_code: p.emp_code ?? null, full_name: p.full_name } : null]
  })) as Record<StageKey, Person | null>
}

async function tellApprovers(step: ChainStep, emp: Person, reasonLabel: string) {
  const ask = step.stage === 'HR_MANAGER' ? 'Set the final last working day' : 'Acknowledge it, accept it with your date, or request retention'
  await Promise.all(step.approvers.map(p => notify(p.id, `Exit approval: ${who(emp)}`,
    `${reasonLabel}. Waiting on you as ${step.label}. ${ask} in Tasks & Approvals.`, APPROVALS_LINK, 'APPROVAL').catch(() => null)))
}

const shape = (r: any) => r && ({
  id: r.id, employee_id: r.employee_id, reason_code: r.reason_code, reason_label: r.reason_label, sub_reason: r.sub_reason,
  last_working_day: r.last_working_day, remarks: r.remarks, status: r.status, chain: r.chain || [], current_step: r.current_step,
  rehire_flag: r.rehire_flag, initiated_by_name: r.initiated_by_name, created_at: r.created_at, decided_at: r.decided_at,
  documents: r.documents || [], abscond_stage: r.abscond_stage || null, reminders_sent: r.reminders_sent || 0, last_reminder_at: r.last_reminder_at || null,
  destination_company_id: r.destination_company_id || null, resignation_id: r.resignation_id || null,
})

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId
  const sp = req.nextUrl.searchParams

  if (sp.get('inbox')) {
    const { data } = await sb.from('hr_exit_requests').select('*, employees!hr_exit_requests_employee_id_fkey(full_name, emp_code, designation)').eq('status', 'PENDING').order('created_at')
    const items = (data || []).filter((x: any) => waitingOn(x.chain || [], me))
      .map((x: any) => {
        const step = (x.chain || []).find((s: ChainStep) => s.status === 'PENDING' || s.status === 'HOLD')
        return { ...shape(x), employee: { full_name: x.employees?.full_name, emp_code: x.employees?.emp_code, designation: x.employees?.designation },
          actions: actionsFor(step).map(k => ({ code: k, label: ACTIONS[k] })), proposed_lwd: proposedLwd(x.chain || []) }
      })
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
  if (co && !co.includes(emp.company_id)) return forbidden('This employee belongs to another company.')

  const [{ data: reqs }, { data: open }, { data: att }] = await Promise.all([
    sb.from('hr_exit_requests').select('*').eq('employee_id', emp.id).in('status', SHOWN_STATUSES).order('created_at', { ascending: false }).limit(1),
    sb.from('employee_resignation').select('id, status').eq('employee_id', emp.id).in('status', OPEN_EXIT).limit(1),
    sb.from('attendance_records').select('attendance_date').eq('employee_id', emp.id).not('work_in', 'is', null).order('attendance_date', { ascending: false }).limit(1),
  ])
  const request = reqs?.[0] || null
  // The chain this employee's exit would walk, with the names on it — the same people their own
  // resignation would go to.
  const flow = buildChain({ approvers: await stageApprovers(emp.id), initiator: await personOf(me), employeeId: emp.id, now: new Date().toISOString() })
  const flowLabels = flow.map(s => s.status === 'SKIPPED' ? null : `${s.label}: ${s.approvers[0] ? who(s.approvers[0]) : '-'}${s.action === 'STARTED' ? ' (you)' : ''}`).filter(Boolean) as string[]
  const noticeDays = effectiveNoticeDays(emp as any)
  const lastAttendance = (att?.[0] as any)?.attendance_date || null
  const reasons = HR_EXIT_REASONS.map(x => ({
    code: x.code, label: x.label, sub_reasons: x.subReasons, lwd_hint: x.lwdHint, rehire: x.rehire,
    chain: flowLabels, lwd: suggestedLwd(x.code, { today: today(), noticeDays, lastAttendance }),
  }))
  // Nothing live of ours, but the employee cannot be exited from here: already gone, or a
  // resignation they filed themselves is still running.
  const blocked = request ? null
    : (emp.access_revoked_at || emp.employment_status === 'Resigned') ? `${emp.full_name} has already left.`
    : open?.length ? `${emp.full_name} already has a resignation in progress (${String(open[0].status).replace(/_/g, ' ').toLowerCase()}). It is handled in Tasks & Approvals.`
    : null
  // Companies of the group, for a Transfer's destination.
  const { data: co0 } = await sb.from('companies').select('id, group_id').eq('id', emp.company_id).maybeSingle()
  let cq = sb.from('companies').select('id, company_name, company_code').neq('id', emp.company_id).order('company_name')
  if ((co0 as any)?.group_id) cq = cq.eq('group_id', (co0 as any).group_id)
  const { data: companies } = await cq
  const destName = request?.destination_company_id ? ((await sb.from('companies').select('company_name').eq('id', request.destination_company_id).maybeSingle()).data as any)?.company_name : null
  return NextResponse.json({
    allowed, reasons, blocked, request: request ? { ...shape(request), destination_company: destName || null } : null, notice_days: noticeDays, last_attendance: lastAttendance,
    companies: (companies || []).map((c: any) => ({ id: c.id, name: c.company_name || c.company_code })),
    employee: { id: emp.id, full_name: emp.full_name, emp_code: emp.emp_code, employment_status: emp.employment_status, left: !!emp.access_revoked_at },
  })
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
    const x = { employeeId: String(body.target_id || '') || null, reasonCode: String(body.reason_code || '') || null, subReason: String(body.sub_reason || '') || null, lwd: String(body.lwd || '') || null, remarks: String(body.remarks || '').trim() || null, destinationCompanyId: String(body.destination_company_id || '') || null }
    const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, employment_status, access_revoked_at').eq('id', x.employeeId || '00000000-0000-0000-0000-000000000000').maybeSingle()
    const problems = startProblems({ ...x, sourceCompanyId: emp?.company_id || null }, { self: me })
    if (problems.length) return bad(problems.join(' '))
    if (!emp) return bad('Employee not found.', 404)
    const co = scopeOf(ctx)
    if (co && !co.includes(emp.company_id)) return forbidden('This employee belongs to another company.')
    if (emp.access_revoked_at || emp.employment_status === 'Resigned') return bad(`${who(emp as any)} has already left.`, 409)
    const [{ data: live }, { data: open }] = await Promise.all([
      sb.from('hr_exit_requests').select('id, status').eq('employee_id', emp.id).in('status', SHOWN_STATUSES).limit(1),
      sb.from('employee_resignation').select('id, status').eq('employee_id', emp.id).in('status', OPEN_EXIT).limit(1),
    ])
    if (live?.length) return bad(`${who(emp as any)} already has an exit (${String(live[0].status).toLowerCase()}). Open the Exit button to see it.`, 409)
    if (open?.length) return bad(`${who(emp as any)} already has a resignation in progress (${String(open[0].status).replace(/_/g, ' ').toLowerCase()}). It is handled in Tasks & Approvals.`, 409)

    const reason = reasonOf(x.reasonCode)!
    const target: Person = { id: emp.id, emp_code: emp.emp_code, full_name: emp.full_name }
    const built = buildChain({ approvers: await stageApprovers(emp.id), initiator: actor, employeeId: emp.id, now })
    // Abscond (§4 Step 3): three weekly reminders first; the chain starts after 21 days.
    const abscond = reason.code === 'ABSCOND'
    const { chain, current, done } = abscond ? { chain: built, current: null, done: false } : advance(built, now)
    const { data: row, error } = await sb.from('hr_exit_requests').insert({
      employee_id: emp.id, company_id: emp.company_id, reason_code: reason.code, reason_label: reason.label, sub_reason: x.subReason,
      last_working_day: x.lwd, remarks: x.remarks, status: done ? 'APPROVED' : 'PENDING', chain, current_step: current,
      rehire_flag: reason.rehire, initiated_by: me, initiated_by_name: who(actor), decided_at: done ? now : null,
      destination_company_id: reason.code === 'TRANSFER' ? x.destinationCompanyId : null,
      abscond_stage: abscond ? 'REMINDING' : null, step_started_at: current != null ? now : null,
    }).select('*').single()
    if (error) return bad(/hr_exit_requests/.test(error.message) && /does not exist|schema cache/.test(error.message)
      ? 'The exit approvals table is missing. Run migration 172_hr_exit_requests.sql in the Supabase SQL Editor.' : error.message, 500)
    let applied = null
    if (abscond) {
      // Attendance stops counting from today; the first reminder goes now.
      await sb.from('employees').update({ abscond_marked_at: now }).eq('id', emp.id)
      await sendAbscondReminder(sb as any, row, new Date(now))
    } else if (done) {
      applied = await applyCompanyExit(sb as any, row, actor)
    } else if (current != null) {
      await tellApprovers(chain[current], target, `${reason.label} · ${x.subReason}`)
    }
    await audit(ctx.caller, 'EXIT_STARTED_BY_HR', emp.id, { request_id: row.id, reason: reason.code, sub_reason: x.subReason, lwd: x.lwd, approved_at_once: done })
    return NextResponse.json({ ok: true, request: shape({ ...row, resignation_id: applied?.resignationId || null }), applied })
  }

  const id = String(body.id || '')
  if (!id) return bad('Which exit?')
  const { data: row } = await sb.from('hr_exit_requests').select('*').eq('id', id).maybeSingle()
  if (!row) return bad('Exit not found.', 404)
  const { data: emp } = await sb.from('employees').select('id, full_name, emp_code, company_id, access_revoked_at').eq('id', row.employee_id).maybeSingle()
  const target: Person = { id: row.employee_id, emp_code: emp?.emp_code ?? null, full_name: emp?.full_name || 'the employee' }

  if (action === 'reject') return bad('A company exit follows the resignation chain, which has no reject: request retention to hold it, or HR cancels it.', 400)
  if (action === 'act' || action === 'approve') {
    if (row.status !== 'PENDING') return bad(`This exit is ${String(row.status).toLowerCase()}, not waiting on anyone.`, 409)
    if (row.abscond_stage === 'REMINDING') return bad('The abscond reminders are still running; the chain starts after the third.', 409)
    const cur = (row.chain || []).find((s: ChainStep) => s.status === 'PENDING' || s.status === 'HOLD')
    // 'approve' is the older button: it acknowledges, or at the HR Manager sets the LWD on record.
    const code = action === 'approve' ? (cur?.stage === 'HR_MANAGER' ? 'FINAL_LWD_SET' : 'ACKNOWLEDGED') : String(body.act || '')
    const lwdIn = String(body.lwd || '') || (action === 'approve' ? row.last_working_day : '')
    let out: ReturnType<typeof act>
    try { out = act(row.chain || [], { actor, action: code, note: body.note, lwd: lwdIn, now }) }
    catch (e: any) { return bad(e.message, 403) }
    const step = out.chain[(row.chain || []).indexOf(cur)] || cur
    const moved = out.hold || code === 'RESUMED' ? { chain: out.chain, current: row.current_step, done: false } : advance(out.chain, now)
    const done = moved.done
    const lwd = done ? (out.finalLwd || proposedLwd(moved.chain) || row.last_working_day) : row.last_working_day
    const status = done ? 'APPROVED' : 'PENDING'
    // Conditional on the step it was read at, so two approvers cannot both act on it.
    const { data: upd, error } = await sb.from('hr_exit_requests')
      .update({ chain: moved.chain, current_step: moved.current, status, last_working_day: lwd, updated_at: now, decided_at: done ? now : null,
        ...(out.hold ? { step_escalated_at: now } : { step_started_at: now, step_escalated_at: null }) })
      .eq('id', row.id).eq('status', 'PENDING').eq('current_step', row.current_step).select('*')
    if (error) return bad(error.message, 500)
    if (!upd?.length) return bad('Somebody acted on this exit a moment ago. Reload to see where it is.', 409)
    let applied = null
    const why = `${row.reason_label}${row.sub_reason ? ` · ${row.sub_reason}` : ''}`
    if (done) applied = await applyCompanyExit(sb as any, upd[0], actor)
    else if (!out.hold && code !== 'RESUMED' && moved.current != null) await tellApprovers(moved.chain[moved.current], target, why)
    if (row.initiated_by && row.initiated_by !== me) {
      const what = done ? `complete: final last working day ${day(lwd)}.`
        : out.hold ? `on retention hold: ${who(actor)} (${step?.label}) requested retention${body.note ? ` (${String(body.note).trim()})` : ''}.`
        : code === 'RESUMED' ? `resumed by ${who(actor)} (${step?.label}).`
        : `${code === 'ACCEPTED_WITH_DATE' ? `accepted with ${day(String(body.lwd))}` : 'acknowledged'} by ${who(actor)} (${step?.label}); now with the ${moved.current != null ? moved.chain[moved.current]?.label : 'HR Manager'}.`
      await notify(row.initiated_by, `Exit of ${who(target)}: ${done ? 'final LWD set' : out.hold ? 'retention requested' : 'moved on'}`, `${row.reason_label} exit ${what}`, '/dashboard/employees', 'APPROVAL').catch(() => null)
    }
    await audit(ctx.caller, `EXIT_${code}`, row.employee_id, { request_id: row.id, stage: step?.stage, note: body.note || null, lwd: body.lwd || null, final: status })
    return NextResponse.json({ ok: true, request: shape(upd[0]), applied, hold: out.hold })
  }

  if (action === 'cancel' || action === 'reset') {
    if (!allowedFor(ctx)) return forbidden('Only the HR team and Hiring Managers can do this.')
    const co = scopeOf(ctx)
    if (co && !co.includes(row.company_id)) return forbidden('This employee belongs to another company.')
    if (action === 'reset' && row.status !== 'REJECTED') return bad('Only a rejected exit is reset. A running one is cancelled.', 409)
    if (action === 'cancel' && !['PENDING', 'APPROVED'].includes(row.status)) return bad(`This exit is ${String(row.status).toLowerCase()}; there is nothing to cancel.`, 409)
    if (action === 'cancel' && row.status === 'APPROVED' && emp?.access_revoked_at) return bad(`${who(target)} has already left on ${day(row.last_working_day)}, so the exit cannot be cancelled here.`, 409)
    if (action === 'cancel' && row.resignation_id) {
      const { data: f } = await sb.from('fnf_settlements').select('status').eq('resignation_id', row.resignation_id).maybeSingle()
      if (f && f.status !== 'CALCULATED') return bad(`The F&F for ${who(target)} is already ${String(f.status).toLowerCase()}, so the exit cannot be cancelled.`, 409)
    }
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
      await sb.from('employees').update({ date_of_resignation: null, last_working_date: null, rehire_flag: null, rehire_reason: null }).eq('id', row.employee_id)
      // Clearance and an unapproved F&F go with it; a Transfer's onboarding is withdrawn.
      if (row.resignation_id) {
        await sb.from('exit_clearance').delete().eq('resignation_id', row.resignation_id).then(() => null, () => null)
        await sb.from('fnf_settlements').delete().eq('resignation_id', row.resignation_id).eq('status', 'CALCULATED').then(() => null, () => null)
      }
      if (row.onboarding_candidate_id) await sb.from('onboarding_candidates').update({ status: 'REJECTED', hr_notes: 'Transfer cancelled' }).eq('id', row.onboarding_candidate_id).then(() => null, () => null)
      if (!isSilent(row.reason_code)) await notify(row.employee_id, 'Your exit has been cancelled', `HR has cancelled your exit (${row.reason_label}). You continue in your role.`, '/ess', 'COMPLIANCE').catch(() => null)
    }
    if (row.reason_code === 'ABSCOND') await sb.from('employees').update({ abscond_marked_at: null }).eq('id', row.employee_id)
    if (action === 'cancel' && row.status === 'PENDING') {
      const pending = (row.chain || []).find((s: ChainStep) => s.status === 'PENDING' || s.status === 'HOLD')
      await Promise.all((pending?.approvers || []).map((p: Person) => notify(p.id, `Exit cancelled: ${who(target)}`, `The ${row.reason_label} exit waiting on you was cancelled by ${who(actor)}.`, APPROVALS_LINK, 'APPROVAL').catch(() => null)))
    }
    await audit(ctx.caller, action === 'cancel' ? 'EXIT_CANCELLED' : 'EXIT_RESET', row.employee_id, { request_id: row.id, was: row.status, note })
    return NextResponse.json({ ok: true })
  }

  return bad("action must be 'start', 'act', 'cancel' or 'reset'")
}
