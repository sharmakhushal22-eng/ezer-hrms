// lib/leave/workflow.ts — every decision on a leave or attendance request.
// SERVER ONLY.
//
// The approver's Tasks & Approvals (/api/ess/approvals) and HR's override
// (/api/attendance/requests) call the same functions, so "approve" means one
// thing wherever it is clicked: the same balance check, the same record
// written, the same people told.
//
// WHAT EACH DECISION DOES
//
//   Leave            approve → APPROVED (or, for types approved by both, on to
//                    the HR stage); decline → REJECTED. The stored balance is
//                    re-synced, the employee is told by bell and email.
//   Leave cancel     an APPROVED leave the employee wants back. approve →
//                    CANCELLED and the days return to the balance; decline →
//                    the leave stands.
//   Regularisation   approve → the corrected times are written to
//                    attendance_records (status PRESENT, source REGULARISED),
//                    which is what the calendar, reports and payroll read;
//                    decline → REJECTED. A date-range request is one decision.
//
// NOBODY DECIDES THEIR OWN REQUEST — not as approver, not as HR, not as admin.
import { randomUUID } from 'node:crypto'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { employeeScope, isUuid } from '@/lib/config/store'
import { daysLabel } from '@/lib/config/workflow-templates'
import { ledgerFor, syncBalances } from './ledger'
import { approverRole, checkApproval } from './policy'
import { contacts, deliver, later, portalUrl, fmtDay, fmtRange, fmtDates, istToday } from './notify'

export interface Actor {
  /** null for the legacy admin login, which has no employee record. */
  employeeId: string | null
  name: string
  isSuperAdmin?: boolean
  /** HR acting from Attendance & Leave → Requests on somebody else's queue. */
  override?: boolean
}

export type Outcome =
  | { ok: true; status: string; stage?: string; waiting_on?: Waiting | null; message?: string }
  | { ok: false; status: number; error: string }

export interface Waiting { id: string; name: string; role: string }

const fail = (status: number, error: string): Outcome => ({ ok: false, status, error })

const MGR_COLS = 'id, full_name, emp_code, l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id'
type MgrRow = { id: string; full_name: string | null; emp_code: string | null; l1_manager_id: string | null; l2_manager_id: string | null; hr_manager_id: string | null; hr_head_id: string | null }

async function employee(id: string): Promise<MgrRow | null> {
  const { data } = await sb.from('employees').select(MGR_COLS).eq('id', id).maybeSingle()
  return (data as MgrRow | null) ?? null
}

/** Who a request is waiting on, as the employee should see it. */
export async function waitingOn(emp: MgrRow | null, approverId: string | null | undefined): Promise<Waiting | null> {
  if (!approverId) return null
  const c = (await contacts([approverId])).get(approverId)
  return c ? { id: approverId, name: c.name, role: approverRole(emp, approverId) } : null
}

/** May this actor decide a row stamped to `stampedTo` for `applicant`? */
function authorise(actor: Actor, stampedTo: string | null, applicant: string): string | null {
  if (actor.employeeId && actor.employeeId === applicant) return 'You cannot decide your own request.'
  if (actor.override || actor.isSuperAdmin) return null
  if (!actor.employeeId || stampedTo !== actor.employeeId) return 'This request is not waiting on you.'
  return null
}

const syncLater = (employeeId: string) => later(async () => {
  const r = await syncBalances([employeeId])
  if (r.error) console.warn('[leave] balance sync:', r.error)
})

// ═══════════════════════════════════════════════════════════════════════════
// Leave — approve / decline
// ═══════════════════════════════════════════════════════════════════════════
export async function decideLeave(id: string, actor: Actor, approve: boolean, note: string | null): Promise<Outcome> {
  if (!isUuid(id)) return fail(400, 'That is not a leave request id.')
  const { data: l } = await sb.from('leave_applications')
    .select('id, employee_id, leave_type_id, status, current_approver_id, approval_stage, from_date, to_date, days, reason, leave_types(approval_by, name, short_name)')
    .eq('id', id).maybeSingle()
  if (!l) return fail(404, 'Leave request not found.')
  if (l.status !== 'PENDING') return fail(409, `Already ${String(l.status).toLowerCase()}.`)
  const denied = authorise(actor, l.current_approver_id, l.employee_id)
  if (denied) return fail(403, denied)

  const lt = (l as any).leave_types || {}
  const typeName = String(lt.name || 'leave')
  const days = Number(l.days) || 0
  const emp = await employee(l.employee_id)
  const empName = emp?.full_name || 'The employee'
  const scope = await employeeScope(l.employee_id)
  const dates = fmtRange(l.from_date, l.to_date)

  // A decision never takes a balance below zero — checked at every approval,
  // the manager stage included, so a manager is told now rather than HR later.
  if (approve) {
    const ledger = await ledgerFor(l.employee_id)
    const b = ledger?.byType.get(l.leave_type_id)
    if (b) {
      const c = checkApproval(b, days)
      if (!c.ok) return fail(409, `${c.reason} Decline it, or ask ${empName} to re-apply with the extra days as Leave Without Pay.`)
    }
  }

  // Types approved by BOTH: the manager's approval moves it to HR.
  const mode = String(lt.approval_by || 'L1').toUpperCase()
  if (approve && mode === 'BOTH' && l.approval_stage === 'L1' && !actor.override) {
    const { error } = await sb.from('leave_applications').update({ approval_stage: 'HR' }).eq('id', id)
    if (error) return fail(500, error.message)
    const { data: next } = await sb.from('leave_applications').select('current_approver_id').eq('id', id).maybeSingle()
    const nextId = next?.current_approver_id || null
    // The same person holds both stages (a manager who is also the HR manager)
    // or nobody holds the HR stage: their approval is the final one — asking
    // them to approve the same request twice is a click, not a control.
    if (nextId && nextId !== actor.employeeId) {
      const who = await waitingOn(emp, nextId)
      await deliver({
        to: nextId, scope,
        bell: { key: 'notify.leave.awaiting_hr', vars: { leave_type: typeName }, link: '/ess?tab=approvals' },
        mail: { key: 'leave.request.approver', vars: {
          approver_name: who?.name || '', employee_name: empName, emp_code: emp?.emp_code || '',
          days_label: daysLabel(days), leave_type: typeName, dates, reason: l.reason || '', balance_line: '',
          portal_url: portalUrl('approvals'),
        } },
      })
      await deliver({ to: l.employee_id, scope, bell: { key: 'notify.leave.passed_to_hr', vars: { days_label: daysLabel(days), from_date: fmtDay(l.from_date) }, link: '/ess?tab=leave' } })
      return { ok: true, status: 'PENDING', stage: 'HR', waiting_on: who }
    }
  }

  const { error } = await sb.from('leave_applications').update({
    status: approve ? 'APPROVED' : 'REJECTED',
    resolved_at: new Date().toISOString(),
    approver: actor.name,
    approver_employee_id: actor.employeeId,
    remark: note || null,
  }).eq('id', id).eq('status', 'PENDING')
  if (error) return fail(500, error.message)

  syncLater(l.employee_id)
  await deliver({
    to: l.employee_id, scope,
    bell: { key: approve ? 'notify.leave.approved' : 'notify.leave.declined', link: '/ess?tab=leave', vars: {
      days_label: daysLabel(days), from_date: fmtDay(l.from_date), approver_name: actor.name, note: note || '',
    } },
    mail: { key: 'leave.decision.employee', vars: {
      employee_name: empName, decision: approve ? 'approved' : 'declined', days_label: daysLabel(days),
      leave_type: typeName, dates, approver_name: actor.name, note: note || '', portal_url: portalUrl('leave'),
    } },
  })
  return { ok: true, status: approve ? 'APPROVED' : 'REJECTED' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Leave — cancelling an approved request
// ═══════════════════════════════════════════════════════════════════════════
export async function requestLeaveCancel(id: string, employeeId: string, reason: string): Promise<Outcome> {
  if (!isUuid(id)) return fail(400, 'That is not a leave request id.')
  const { data: l } = await sb.from('leave_applications')
    .select('id, employee_id, status, from_date, to_date, days, approver_employee_id, cancel_status, cancel_approver_id, leave_types(name)')
    .eq('id', id).maybeSingle()
  if (!l) return fail(404, 'Leave request not found.')
  if (l.employee_id !== employeeId) return fail(403, 'That is not your leave request.')
  if (l.status === 'PENDING') return fail(409, 'This request is still pending — withdraw it instead.')
  if (l.status !== 'APPROVED') return fail(409, `Already ${String(l.status).toLowerCase()}.`)
  if (l.from_date <= istToday()) return fail(409, 'This leave has already started, so it cannot be cancelled here. Ask HR to adjust it.')
  if (l.cancel_status === 'REQUESTED') return fail(409, 'A cancellation for this leave is already waiting for approval.')

  const emp = await employee(employeeId)
  // The person who approved it decides, if they still can; otherwise the
  // normal chain. Never the employee.
  const { data: picked, error: pe } = await sb.rpc('ess_pick_approver', {
    p_employee_id: employeeId,
    p_candidates: [l.approver_employee_id, emp?.l1_manager_id, emp?.hr_manager_id, emp?.l2_manager_id, emp?.hr_head_id],
  })
  if (pe) return fail(500, /ess_pick_approver/.test(pe.message) ? 'Migration 138 has not been run yet.' : pe.message)
  const approverId = (picked as string | null) || null

  const { error } = await sb.from('leave_applications').update({
    cancel_status: 'REQUESTED', cancel_reason: reason || null, cancel_requested_at: new Date().toISOString(),
    cancel_approver_id: approverId, cancel_decided_at: null, cancel_decided_by: null, cancel_remark: null,
  }).eq('id', id).eq('status', 'APPROVED')
  if (error) return fail(500, error.message)

  const typeName = String((l as any).leave_types?.name || 'leave')
  const who = await waitingOn(emp, approverId)
  const scope = await employeeScope(employeeId)
  await deliver({
    to: approverId, scope,
    bell: { key: 'notify.leave.cancel_requested', link: '/ess?tab=approvals', vars: {
      employee_name: emp?.full_name || 'An employee', days_label: daysLabel(Number(l.days) || 0),
      leave_type: typeName, from_date: fmtDay(l.from_date), reason: reason || '',
    } },
    mail: { key: 'leave.cancel.approver', vars: {
      approver_name: who?.name || '', employee_name: emp?.full_name || 'An employee', emp_code: emp?.emp_code || '',
      days_label: daysLabel(Number(l.days) || 0), leave_type: typeName, dates: fmtRange(l.from_date, l.to_date),
      reason: reason || '', portal_url: portalUrl('approvals'),
    } },
  })
  return { ok: true, status: 'APPROVED', waiting_on: who,
    message: who ? `Cancellation sent to ${who.name}.` : 'Cancellation requested. No approver is set for you, so HR will see it in their Requests list.' }
}

export async function decideLeaveCancel(id: string, actor: Actor, approve: boolean, note: string | null): Promise<Outcome> {
  if (!isUuid(id)) return fail(400, 'That is not a leave request id.')
  const { data: l } = await sb.from('leave_applications')
    .select('id, employee_id, status, from_date, to_date, days, cancel_status, cancel_approver_id, leave_types(name)')
    .eq('id', id).maybeSingle()
  if (!l) return fail(404, 'Leave request not found.')
  if (l.cancel_status !== 'REQUESTED' || l.status !== 'APPROVED') return fail(409, 'There is no cancellation waiting on this leave.')
  const denied = authorise(actor, l.cancel_approver_id, l.employee_id)
  if (denied) return fail(403, denied)

  const now = new Date().toISOString()
  const { error } = await sb.from('leave_applications').update(approve
    ? { status: 'CANCELLED', cancel_status: 'APPROVED', cancel_decided_at: now, cancel_decided_by: actor.name, cancel_remark: note || null }
    : { cancel_status: 'DECLINED', cancel_decided_at: now, cancel_decided_by: actor.name, cancel_remark: note || null },
  ).eq('id', id).eq('cancel_status', 'REQUESTED')
  if (error) return fail(500, error.message)

  if (approve) syncLater(l.employee_id)
  const emp = (await contacts([l.employee_id])).get(l.employee_id)
  const typeName = String((l as any).leave_types?.name || 'leave')
  const scope = await employeeScope(l.employee_id)
  await deliver({
    to: l.employee_id, scope,
    bell: { key: approve ? 'notify.leave.cancel_approved' : 'notify.leave.cancel_declined', link: '/ess?tab=leave', vars: {
      days_label: daysLabel(Number(l.days) || 0), leave_type: typeName, from_date: fmtDay(l.from_date),
      approver_name: actor.name, note: note || '',
    } },
    mail: { key: 'leave.cancel.employee', vars: {
      employee_name: emp?.name || '', decision: approve ? 'approved' : 'declined', days_label: daysLabel(Number(l.days) || 0),
      leave_type: typeName, dates: fmtRange(l.from_date, l.to_date), approver_name: actor.name, note: note || '',
      portal_url: portalUrl('leave'),
    } },
  })
  return { ok: true, status: approve ? 'CANCELLED' : 'APPROVED' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Attendance regularisation
// ═══════════════════════════════════════════════════════════════════════════

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s)
const hhmm = (t: string) => t.slice(0, 5)

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export interface FileInput { dates?: unknown; date?: unknown; from?: unknown; to?: unknown; requested_in?: unknown; requested_out?: unknown; reason?: unknown }

export type FileOutcome =
  | { ok: true; filed: number; dates: string[]; skipped: { date: string; why: string }[]; group: string; waiting_on: Waiting | null }
  | { ok: false; status: number; error: string }

/** File a correction for one day, a list of days or a range — one row per day, one group per submission. */
export async function fileRegularisation(me: string, body: FileInput): Promise<FileOutcome> {
  const bad = (error: string, status = 400) => ({ ok: false as const, status, error })
  const requestedIn = body.requested_in, requestedOut = body.requested_out
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (!isTime(requestedIn) || !isTime(requestedOut)) return bad('Give both times as HH:mm.')
  if (hhmm(requestedOut) <= hhmm(requestedIn)) return bad('The out time has to be after the in time.')
  if (!reason) return bad('Say why the punch is being corrected. Whoever reviews it reads this.')

  let dates: string[] = []
  if (Array.isArray(body.dates)) dates = body.dates.filter(isDay)
  else if (isDay(body.date)) dates = [body.date]
  else if (isDay(body.from) && isDay(body.to)) dates = body.from <= body.to ? eachDay(body.from, body.to) : []
  else if (isDay(body.from)) dates = [body.from]
  dates = [...new Set(dates)].sort()
  if (!dates.length) return bad('Pick the day to correct.')
  if (dates.length > 62) return bad('Regularise at most two months at a time.')

  const today = istToday()
  const first = dates[0], last = dates[dates.length - 1]
  const [recR, holR, offR, lvR, existingR] = await Promise.all([
    sb.from('attendance_records').select('attendance_date, work_in, work_out').eq('employee_id', me).in('attendance_date', dates),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: me, p_from: first, p_to: last }),
    sb.from('leave_applications').select('from_date, to_date, half_day').eq('employee_id', me).eq('status', 'APPROVED').lte('from_date', last).gte('to_date', first),
    sb.from('attendance_regularisation').select('attendance_date, status').eq('employee_id', me).in('attendance_date', dates),
  ])
  const recBy = new Map(((recR.data || []) as { attendance_date: string; work_in: string | null; work_out: string | null }[]).map(r => [r.attendance_date, r]))
  const offs = new Set(((offR.data || []) as { off_date: string }[]).map(r => String(r.off_date)))
  // Every holiday on the calendar, optional ones included — the same rule the
  // leave route and the attendance grid use.
  const hols = new Map(((holR.data || []) as { holiday_date: string; description: string | null }[]).map(h => [String(h.holiday_date), h]))
  const onLeave = new Set<string>()
  for (const l of (lvR.data || []) as { from_date: string; to_date: string; half_day: boolean | null }[]) {
    if (l.half_day) continue           // a half day still needs the other half's punches
    for (const d of eachDay(l.from_date, l.to_date)) onLeave.add(d)
  }
  const decided = new Map(((existingR.data || []) as { attendance_date: string; status: string }[]).map(r => [r.attendance_date, r.status]))

  const skipped: { date: string; why: string }[] = []
  const group = randomUUID()
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    // Today is still being worked; a correction is for a day that is over.
    if (date >= today) { skipped.push({ date, why: date === today ? 'today is not over yet' : 'that day has not happened yet' }); continue }
    if (hols.has(date)) { skipped.push({ date, why: `it was ${hols.get(date)?.description || 'a holiday'}` }); continue }
    if (offs.has(date)) { skipped.push({ date, why: 'it was a weekly off' }); continue }
    if (onLeave.has(date)) { skipped.push({ date, why: 'you were on approved leave' }); continue }
    if (decided.get(date) === 'APPROVED') { skipped.push({ date, why: 'it has already been regularised' }); continue }
    const rec = recBy.get(date)
    rows.push({
      employee_id: me, attendance_date: date,
      recorded_in: rec?.work_in ?? null, recorded_out: rec?.work_out ?? null,
      requested_in: hhmm(requestedIn), requested_out: hhmm(requestedOut), reason,
      status: 'PENDING', request_group: group,
      reviewed_by: null, reviewed_by_id: null, reviewed_at: null, review_remark: null,
    })
  }
  if (!rows.length) {
    const only = skipped.length === 1 ? skipped[0] : null
    return bad(only ? `${fmtDay(only.date)}: ${only.why}.` : 'None of those days can be regularised.')
  }

  const { error } = await sb.from('attendance_regularisation').upsert(rows, { onConflict: 'employee_id,attendance_date' })
  if (error) {
    return bad(/request_group|reviewed_by_id|current_approver_id/.test(error.message)
      ? 'Attendance approvals are not switched on yet (migration 138 has not been run).' : error.message, 500)
  }

  const { data: filed } = await sb.from('attendance_regularisation').select('current_approver_id').eq('request_group', group).limit(1)
  const approverId = (filed?.[0]?.current_approver_id as string | null) ?? null
  const emp = await employee(me)
  const who = await waitingOn(emp, approverId)
  const filedDates = rows.map(r => String(r.attendance_date))
  const scope = await employeeScope(me)
  const datesLabel = fmtDates(filedDates)

  await deliver({
    to: approverId, scope,
    bell: { key: 'notify.attendance.reg_awaiting', link: '/ess?tab=approvals', vars: {
      employee_name: emp?.full_name || 'An employee', dates: datesLabel, day_count: filedDates.length, reason,
    } },
    mail: { key: 'attendance.correction.approver', vars: {
      approver_name: who?.name || '', employee_name: emp?.full_name || 'An employee', emp_code: emp?.emp_code || '',
      dates: datesLabel, day_count: filedDates.length, times: `${hhmm(requestedIn)} – ${hhmm(requestedOut)}`,
      reason, portal_url: portalUrl('approvals'),
    } },
  })
  if (who) {
    await deliver({ to: me, scope, bell: { key: 'notify.attendance.reg_submitted', link: '/ess?tab=attendance', vars: {
      dates: datesLabel, approver_name: who.name, approver_role: who.role,
    } } })
  }
  return { ok: true, filed: rows.length, dates: filedDates, skipped, group, waiting_on: who }
}

/** Withdraw your own pending correction — one day (row id) or a whole submission (group id). */
export async function withdrawRegularisation(me: string, id: string): Promise<Outcome> {
  if (!isUuid(id)) return fail(400, 'That is not a request id.')
  const { data: rows } = await sb.from('attendance_regularisation')
    .select('id, employee_id, attendance_date, status, current_approver_id')
    .or(`id.eq.${id},request_group.eq.${id}`).eq('employee_id', me).eq('status', 'PENDING')
  if (!rows?.length) return fail(404, 'Nothing pending to withdraw.')
  const { error } = await sb.from('attendance_regularisation')
    .update({ status: 'CANCELLED' }).in('id', rows.map(r => r.id)).eq('status', 'PENDING')
  if (error) return fail(500, error.message)
  const emp = await employee(me)
  const scope = await employeeScope(me)
  for (const approver of new Set(rows.map(r => r.current_approver_id).filter(Boolean) as string[])) {
    await deliver({ to: approver, scope, bell: { key: 'notify.attendance.reg_withdrawn', link: '/ess?tab=approvals', vars: {
      employee_name: emp?.full_name || 'An employee',
      dates: fmtDates(rows.filter(r => r.current_approver_id === approver).map(r => r.attendance_date)),
    } } })
  }
  return { ok: true, status: 'CANCELLED' }
}

interface ShiftRow {
  id: string; in_time: string | null; out_time: string | null; max_out_punch: string | null
  lunch_duration_mins: number | null; overtime_applicable: boolean | null
}

/** The shift in force on a date, as process_daily_attendance() picks it. */
async function shiftOn(employeeId: string, date: string): Promise<(ShiftRow & { ot: boolean }) | null> {
  const { data } = await sb.from('employee_shift_assignment')
    .select('effective_from, effective_till, overtime_applicable, shift_master(id, in_time, out_time, max_out_punch, lunch_duration_mins, overtime_applicable)')
    .eq('employee_id', employeeId).eq('is_active', true).lte('effective_from', date)
    .order('effective_from', { ascending: false }).limit(5)
  for (const a of (data || []) as any[]) {
    if (a.effective_till && a.effective_till < date) continue
    const s = Array.isArray(a.shift_master) ? a.shift_master[0] : a.shift_master
    if (s) return { ...s, ot: !!(a.overtime_applicable ?? s.overtime_applicable) }
  }
  return null
}

/** An IST wall-clock time on a date, as a timestamptz. */
const istAt = (date: string, time: string) => new Date(`${date}T${hhmm(time)}:00+05:30`)

/**
 * The attendance record an approved correction produces — the same arithmetic
 * as process_daily_attendance() (migration 036): worked = out − in − lunch,
 * late against the shift start, overtime past max_out_punch when the shift pays
 * it. The day is PRESENT with no LOP: resolving the exception is the point of
 * approving it.
 */
async function correctedRecord(employeeId: string, date: string, inT: string, outT: string, reason: string, actor: Actor) {
  const shift = await shiftOn(employeeId, date)
  const tin = istAt(date, inT), tout = istAt(date, outT)
  const worked = Math.max(0, Math.round((tout.getTime() - tin.getTime()) / 60000) - Number(shift?.lunch_duration_mins || 0))
  const late = shift?.in_time ? Math.max(0, Math.round((tin.getTime() - istAt(date, shift.in_time).getTime()) / 60000)) : 0
  const ot = shift?.ot && shift.max_out_punch && tout > istAt(date, shift.max_out_punch)
    ? Math.round((tout.getTime() - istAt(date, shift.max_out_punch).getTime()) / 60000) : 0
  const now = new Date().toISOString()
  return {
    employee_id: employeeId, attendance_date: date, shift_id: shift?.id ?? null,
    work_in: tin.toISOString(), work_out: tout.toISOString(),
    total_minutes: worked, late_minutes: late, overtime_minutes: ot,
    status: 'PRESENT', lop_applicable: false, source: 'REGULARISED',
    remark: `Regularised: ${reason}`.slice(0, 500),
    regularized_by: actor.employeeId, regularized_at: now, processed_at: now,
  }
}

export async function decideRegularisation(id: string, actor: Actor, approve: boolean, note: string | null): Promise<Outcome> {
  if (!isUuid(id)) return fail(400, 'That is not a request id.')
  const { data: all } = await sb.from('attendance_regularisation')
    .select('id, employee_id, attendance_date, requested_in, requested_out, reason, status, current_approver_id')
    .or(`id.eq.${id},request_group.eq.${id}`)
  const pending = (all || []).filter(r => r.status === 'PENDING')
  if (!all?.length) return fail(404, 'Attendance correction not found.')
  if (!pending.length) return fail(409, `Already ${String(all[0].status).toLowerCase()}.`)

  const mine = pending.filter(r => !authorise(actor, r.current_approver_id, r.employee_id))
  if (!mine.length) return fail(403, authorise(actor, pending[0].current_approver_id, pending[0].employee_id) || 'This request is not waiting on you.')

  const now = new Date().toISOString()
  if (approve) {
    for (const r of mine) {
      const rec = await correctedRecord(r.employee_id, r.attendance_date, r.requested_in, r.requested_out, r.reason || '', actor)
      const { error } = await sb.from('attendance_records').upsert(rec, { onConflict: 'employee_id,attendance_date' })
      if (error) return fail(500, `Could not update attendance for ${fmtDay(r.attendance_date)}: ${error.message}`)
    }
  }
  const { error } = await sb.from('attendance_regularisation').update({
    status: approve ? 'APPROVED' : 'REJECTED',
    reviewed_by: actor.name, reviewed_by_id: actor.employeeId, reviewed_at: now, review_remark: note || null,
  }).in('id', mine.map(r => r.id)).eq('status', 'PENDING')
  if (error) return fail(500, error.message)

  // One message per employee, however many days the submission covered.
  const byEmp = new Map<string, string[]>()
  for (const r of mine) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) || []), r.attendance_date])
  const names = await contacts([...byEmp.keys()])
  for (const [empId, dates] of byEmp) {
    const scope = await employeeScope(empId)
    await deliver({
      to: empId, scope,
      bell: { key: approve ? 'notify.attendance.reg_approved' : 'notify.attendance.reg_declined', link: '/ess?tab=attendance', vars: {
        dates: fmtDates(dates), approver_name: actor.name, note: note || '',
      } },
      mail: { key: 'attendance.correction.employee', vars: {
        employee_name: names.get(empId)?.name || '', decision: approve ? 'approved' : 'declined',
        dates: fmtDates(dates), approver_name: actor.name, note: note || '', portal_url: portalUrl('attendance'),
      } },
    })
  }
  return { ok: true, status: approve ? 'APPROVED' : 'REJECTED', message: `${mine.length} day${mine.length === 1 ? '' : 's'} ${approve ? 'approved' : 'declined'}.` }
}
