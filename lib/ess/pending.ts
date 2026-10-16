// lib/ess/pending.ts — "pending on you", built once and used by Home and Approvals.
//
// Part 1 is the same for every login: rows whose current_approver_id is stamped to
// this employee (guide §2 — stamped at the stage transition, never recomputed at
// render). Part 2 adds what a wider scope surfaces: the HR Manager stage of every
// resignation for RESIGNATION approvers, PENDING_FINANCE claims for finance
// approvers, and the department's queue for an HOD. Each item says which of those
// produced it (surfaced_via, answers B4) so the UI and the audit can explain why.
//
// Leave cards also carry what an approver needs to decide without leaving the
// card (`facts`, `alert`): the balance before and after, who else in the team is
// off on those days, and whether the dates have already gone by. Attendance
// corrections (migration 138) and cancellations of approved leave are queued
// here too, stamped exactly like leave.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { employeesById, daysAgo, fmtDate, type EssContext } from './session'
import { ledgersFor } from '@/lib/leave/ledger'
import { istToday } from '@/lib/leave/notify'

export type PendingKind = 'LEAVE' | 'LEAVE_CANCEL' | 'REGULARISATION' | 'TRAVEL' | 'RESIGNATION'
export interface PendingItem {
  kind: PendingKind
  id: string
  employee_id: string
  who: string                 // "Rahul Nair · SRS0512"
  what: string                // "Leave request — 2 days, 12–13 Nov"
  meta: string
  stage: string               // Acknowledge / Approve / HR Manager — final LWD …
  raised_at: string | null
  surfaced_via: string        // 'stamped' | 'RESIGNATION role' | 'TRAVEL_CLAIM_FINANCE role' | 'HOD scope'
  mine: boolean               // stamped to me → can act; otherwise read-only oversight
  actions: string[]
  tone?: 'w' | 'd'
  link?: string
  /** Short lines of context the approver reads before deciding. */
  facts?: string[]
  /** Something that should stop a blind click — shown highlighted. */
  alert?: string | null
}

const RES_STAGE_LABEL: Record<string, string> = {
  PENDING_RM_L1: 'Acknowledge (RM L1)', PENDING_RM_L2: 'Acknowledge (RM L2)', PENDING_HOD: 'Acknowledge (HOD)',
  PENDING_HR_MANAGER: 'HR Manager: set final LWD', RETENTION_HOLD: 'On retention hold',
}
const RES_ACTIONS_RM = ['Acknowledge & forward', 'Accept with my date', 'Request retention']
const RES_ACTIONS_HR = ['Set final LWD', 'View full chain']

const LEAVE_COLS = 'id, employee_id, leave_type_id, from_date, to_date, days, half_day, reason, applied_at, approval_stage, current_approver_id, leave_types(name, short_name)'
const CANCEL_COLS = 'id, employee_id, leave_type_id, from_date, to_date, days, cancel_reason, cancel_requested_at, cancel_approver_id, leave_types(name, short_name)'
const REG_COLS = 'id, employee_id, attendance_date, recorded_in, recorded_out, requested_in, requested_out, reason, created_at, request_group, current_approver_id'

/** A timestamptz as IST "09:31", or "—". */
const istTime = (ts: string | null | undefined) => ts
  ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
  : '—'
const dayMon = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
const span = (from: string, to?: string | null) => `${fmtDate(from)}${to && to !== from ? ' – ' + fmtDate(to) : ''}`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export async function buildPending(ctx: EssContext): Promise<PendingItem[]> {
  const me = ctx.caller.employeeId
  const items: PendingItem[] = []
  const seen = new Set<string>()
  const key = (k: PendingKind, id: string) => `${k}:${id}`

  // ── Part 1 — stamped to me ─────────────────────────────────────────────
  // The two 138 queries degrade to "nothing" if the migration has not run:
  // supabase-js resolves an unknown column as { data: null, error }.
  const [{ data: leaves }, { data: claims }, { data: resigs }, { data: cancels }, { data: regs }] = await Promise.all([
    sb.from('leave_applications').select(LEAVE_COLS).eq('current_approver_id', me).eq('status', 'PENDING'),
    sb.from('travel_claims').select('id, employee_id, claim_no, total_claimed, status, submitted_at, period_from, period_to')
      .eq('current_approver_id', me).in('status', ['PENDING_RM', 'PENDING_HR', 'PENDING_FINANCE']),
    sb.from('employee_resignation').select('id, employee_id, status, current_stage, date_of_resignation, notice_period_days, notice_shortfall_days, lwd_as_per_policy, proposed_lwd, submitted_at, created_at, reason_code, exit_reason_master(label)')
      .eq('current_approver_id', me).in('status', ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD']),
    sb.from('leave_applications').select(CANCEL_COLS).eq('cancel_approver_id', me).eq('cancel_status', 'REQUESTED').eq('status', 'APPROVED'),
    sb.from('attendance_regularisation').select(REG_COLS).eq('current_approver_id', me).eq('status', 'PENDING'),
  ])

  // ── Part 2 — scope-qualified extras ───────────────────────────────────
  const extras: { rows: any[]; kind: PendingKind; via: string }[] = []
  if (ctx.menu.approval_types.includes('RESIGNATION') || ctx.grant.isSuperAdmin) {
    const { data } = await sb.from('employee_resignation')
      .select('id, employee_id, status, current_stage, current_approver_id, date_of_resignation, notice_period_days, notice_shortfall_days, lwd_as_per_policy, proposed_lwd, submitted_at, created_at, reason_code, exit_reason_master(label)')
      .in('status', ['PENDING_HR_MANAGER', 'RETENTION_HOLD'])
    extras.push({ rows: data || [], kind: 'RESIGNATION', via: 'RESIGNATION role' })
  }
  if (ctx.menu.approval_types.includes('TRAVEL_CLAIM_FINANCE') || ctx.grant.isSuperAdmin) {
    const { data } = await sb.from('travel_claims').select('id, employee_id, claim_no, total_claimed, status, submitted_at, period_from, period_to, current_approver_id').eq('status', 'PENDING_FINANCE')
    extras.push({ rows: data || [], kind: 'TRAVEL', via: 'TRAVEL_CLAIM_FINANCE role' })
  }
  if (ctx.menu.is_hod && ctx.menu.hod_departments.length) {
    const { data: deptEmps } = await sb.from('employees').select('id').in('department_id', ctx.menu.hod_departments).eq('employment_status', 'Active')
    const ids = (deptEmps || []).map((e: any) => e.id)
    if (ids.length) {
      const [{ data: l }, { data: t }, { data: r }, { data: g }] = await Promise.all([
        sb.from('leave_applications').select(LEAVE_COLS).in('employee_id', ids).eq('status', 'PENDING'),
        sb.from('travel_claims').select('id, employee_id, claim_no, total_claimed, status, submitted_at, period_from, period_to, current_approver_id').in('employee_id', ids).in('status', ['PENDING_RM', 'PENDING_HR', 'PENDING_FINANCE']),
        sb.from('employee_resignation').select('id, employee_id, status, current_stage, current_approver_id, date_of_resignation, notice_period_days, notice_shortfall_days, lwd_as_per_policy, proposed_lwd, submitted_at, created_at, reason_code, exit_reason_master(label)').in('employee_id', ids).like('status', 'PENDING_%'),
        sb.from('attendance_regularisation').select(REG_COLS).in('employee_id', ids).eq('status', 'PENDING'),
      ])
      extras.push(
        { rows: l || [], kind: 'LEAVE', via: 'HOD scope' }, { rows: t || [], kind: 'TRAVEL', via: 'HOD scope' },
        { rows: r || [], kind: 'RESIGNATION', via: 'HOD scope' }, { rows: g || [], kind: 'REGULARISATION', via: 'HOD scope' },
      )
    }
  }

  const allRows = [...(leaves || []), ...(claims || []), ...(resigs || []), ...(cancels || []), ...(regs || []), ...extras.flatMap(x => x.rows)]
  const names = await employeesById(allRows.map((r: any) => r.employee_id))
  const who = (id: string) => { const e = names.get(id); return e ? `${e.full_name}${e.emp_code ? ' · ' + e.emp_code : ''}` : id }

  // ── Context for leave cards: balances and the team calendar ─────────────
  const leaveRows = [...(leaves || []), ...extras.filter(x => x.kind === 'LEAVE').flatMap(x => x.rows)] as any[]
  const ledgers = await ledgersFor(leaveRows.map(r => r.employee_id)).catch(() => new Map())
  const offByEmp = await teamOverlaps(leaveRows)
  const today = istToday()

  const pushLeave = (r: any, via: string, mine: boolean) => {
    const k = key('LEAVE', r.id); if (seen.has(k)) return; seen.add(k)
    const days = Number(r.days || 0)
    const facts: string[] = []
    let alert: string | null = null
    const b = ledgers.get(r.employee_id)?.byType.get(r.leave_type_id)
    if (b) {
      if (b.policy === 'UNLIMITED') facts.push(`${b.short_name || b.name}: unpaid / no balance needed`)
      else if (b.policy === 'EARNED') facts.push(`${b.short_name || b.name}: confirm the off-day worked before approving`)
      else if (b.policy === 'PER_OCCURRENCE') {
        facts.push(`${b.name}: up to ${plural(b.quota, 'day')} per occurrence`)
        if (days > b.quota) alert = `This is more than the ${b.quota}-day entitlement.`
      } else if (b.available != null) {
        const after = Math.round((b.available - days) * 10) / 10
        const others = Math.max(0, Math.round((b.pending - days) * 10) / 10)
        facts.push(`${b.short_name} balance ${b.available} → ${after} after approving${others > 0 ? ` (another ${others} pending)` : ''}`)
        if (after < 0) alert = `Not enough ${b.short_name}: ${b.available} left for a ${days}-day request. Approving will be refused — decline, or ask for the extra days as LWP.`
      }
    }
    const off = (offByEmp.get(r.id) || [])
    if (off.length) facts.push(`Also off: ${off.slice(0, 3).join(', ')}${off.length > 3 ? ` +${off.length - 3} more` : ''}`)
    else facts.push('Nobody else in the team is off on these dates')
    if (r.from_date < today) alert = alert || `These dates have already started or passed (${fmtDate(r.from_date)}).`
    const stage = r.approval_stage === 'L1' ? 'Approve — manager stage' : r.approval_stage === 'HR' ? 'Approve — HR stage' : 'Approve'
    items.push({
      kind: 'LEAVE', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Leave request — ${plural(days, 'day')}${r.half_day ? ' (half day)' : ''}, ${span(r.from_date, r.to_date)}`,
      meta: [r.leave_types?.name, r.reason, `Requested ${daysAgo(r.applied_at)}`].filter(Boolean).join(' · '),
      stage, raised_at: r.applied_at, surfaced_via: via, mine, actions: mine ? ['Approve', 'Decline'] : ['View'],
      facts, alert,
    })
  }
  const pushCancel = (r: any, via: string, mine: boolean) => {
    const k = key('LEAVE_CANCEL', r.id); if (seen.has(k)) return; seen.add(k)
    const days = Number(r.days || 0)
    items.push({
      kind: 'LEAVE_CANCEL', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Cancel approved leave — ${plural(days, 'day')}, ${span(r.from_date, r.to_date)}`,
      meta: [r.leave_types?.name, r.cancel_reason, `Requested ${daysAgo(r.cancel_requested_at)}`].filter(Boolean).join(' · '),
      stage: 'Cancellation', raised_at: r.cancel_requested_at, surfaced_via: via, mine,
      actions: mine ? ['Approve', 'Decline'] : ['View'],
      facts: [`Approving gives ${plural(days, 'day')} of ${r.leave_types?.short_name || 'leave'} back to the balance`],
    })
  }
  const pushRegGroup = (rows: any[], via: string, mine: boolean) => {
    const r0 = rows[0]
    const id = r0.request_group || r0.id
    const k = key('REGULARISATION', id); if (seen.has(k)) return; seen.add(k)
    const dates = rows.map(r => r.attendance_date).sort()
    // A range with gaps (weekly offs skipped) still reads as its span; the day count is in `what`.
    const when = dates.length === 1 ? fmtDate(dates[0]) : span(dates[0], dates[dates.length - 1])
    const facts = rows.slice(0, 5).map(r => {
      const had = r.recorded_in || r.recorded_out ? `recorded ${istTime(r.recorded_in)}–${istTime(r.recorded_out)}` : 'no punches recorded'
      return `${dayMon(r.attendance_date)}: ${had} → ${String(r.requested_in).slice(0, 5)}–${String(r.requested_out).slice(0, 5)}`
    })
    if (rows.length > 5) facts.push(`+${rows.length - 5} more day(s) with the same times`)
    const oldest = dates[0] < today && (Date.parse(today) - Date.parse(dates[0])) / 86400000 > 30
    items.push({
      kind: 'REGULARISATION', id, employee_id: r0.employee_id, who: who(r0.employee_id),
      what: `Attendance correction — ${plural(rows.length, 'day')}, ${when}`,
      meta: [r0.reason, `Requested ${daysAgo(r0.created_at)}`].filter(Boolean).join(' · '),
      stage: 'Approve', raised_at: r0.created_at, surfaced_via: via, mine,
      actions: mine ? ['Approve', 'Decline'] : ['View'],
      facts, alert: oldest ? 'Some of these days are more than a month old — check payroll for that month has not closed.' : null,
    })
  }
  const groupRegs = (rows: any[]) => {
    const g = new Map<string, any[]>()
    for (const r of rows) { const k = r.request_group || r.id; g.set(k, [...(g.get(k) || []), r]) }
    return [...g.values()]
  }
  const pushTravel = (r: any, via: string, mine: boolean) => {
    const k = key('TRAVEL', r.id); if (seen.has(k)) return; seen.add(k)
    const stage = r.status === 'PENDING_RM' ? 'RM approval' : r.status === 'PENDING_HR' ? 'HR approval' : 'Finance approval'
    items.push({
      kind: 'TRAVEL', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Travel claim: ₹${Math.round(Number(r.total_claimed || 0)).toLocaleString('en-IN')}${r.claim_no ? ' · ' + r.claim_no : ''}`,
      meta: [r.period_from ? `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` : null, `Submitted ${daysAgo(r.submitted_at)}`].filter(Boolean).join(' · '),
      stage, raised_at: r.submitted_at, surfaced_via: via, mine, actions: ['Open claim'], link: 'claims',
    })
  }
  const pushRes = (r: any, via: string, mine: boolean) => {
    const k = key('RESIGNATION', r.id); if (seen.has(k)) return; seen.add(k)
    const hr = r.status === 'PENDING_HR_MANAGER'
    const shortfall = Number(r.notice_shortfall_days || 0)
    items.push({
      kind: 'RESIGNATION', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Resignation: ${RES_STAGE_LABEL[r.status] || r.status}`,
      meta: [`Submitted ${fmtDate(r.submitted_at || r.created_at)}`, r.exit_reason_master?.label ? `reason: ${r.exit_reason_master.label}` : null,
             `notice ${r.notice_period_days ?? '-'} days`, r.proposed_lwd ? `RM proposed LWD ${fmtDate(r.proposed_lwd)}` : null,
             shortfall ? `${shortfall} days shortfall` : null].filter(Boolean).join(' · '),
      stage: RES_STAGE_LABEL[r.status] || r.status, raised_at: r.submitted_at || r.created_at, surfaced_via: via, mine,
      actions: !mine ? ['View full chain'] : r.status === 'RETENTION_HOLD' ? ['Resume chain', 'View full chain'] : hr ? RES_ACTIONS_HR : RES_ACTIONS_RM,
      tone: hr ? 'w' : r.status === 'RETENTION_HOLD' ? 'd' : 'w',
    })
  }

  ;(leaves || []).forEach((r: any) => pushLeave(r, 'stamped', true))
  ;(cancels || []).forEach((r: any) => pushCancel(r, 'stamped', true))
  groupRegs(regs || []).forEach(g => pushRegGroup(g, 'stamped', true))
  ;(claims || []).forEach((r: any) => pushTravel(r, 'stamped', true))
  ;(resigs || []).forEach((r: any) => pushRes(r, 'stamped', true))
  for (const x of extras) {
    if (x.kind === 'REGULARISATION') {
      for (const g of groupRegs(x.rows)) pushRegGroup(g, x.via, g.every(r => r.current_approver_id === me))
      continue
    }
    for (const r of x.rows) {
      const mine = r.current_approver_id === me
      if (x.kind === 'LEAVE') pushLeave(r, x.via, mine)
      else if (x.kind === 'TRAVEL') pushTravel(r, x.via, mine)
      else pushRes(r, x.via, mine || (x.via === 'RESIGNATION role' && r.status === 'PENDING_HR_MANAGER'))
    }
  }

  const rank: Record<PendingKind, number> = { RESIGNATION: 0, TRAVEL: 1, LEAVE: 2, LEAVE_CANCEL: 3, REGULARISATION: 4 }
  items.sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1) || rank[a.kind] - rank[b.kind] || String(a.raised_at).localeCompare(String(b.raised_at)))
  return items
}

/**
 * For each pending leave, the teammates (same reporting manager) on approved or
 * pending leave over any of the same days: "Rohan Rao (EL, 15 Oct)".
 * Two queries for the whole queue, however long it is.
 */
async function teamOverlaps(rows: any[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!rows.length) return out
  const { data: applicants } = await sb.from('employees').select('id, l1_manager_id').in('id', [...new Set(rows.map(r => r.employee_id))])
  const managerOf = new Map<string, string | null>(((applicants || []) as any[]).map(e => [e.id, e.l1_manager_id]))
  const managers = [...new Set([...managerOf.values()].filter(Boolean))] as string[]
  if (!managers.length) return out
  const { data: team } = await sb.from('employees').select('id, full_name, l1_manager_id').in('l1_manager_id', managers).eq('employment_status', 'Active')
  const teamRows = (team || []) as { id: string; full_name: string; l1_manager_id: string }[]
  if (!teamRows.length) return out
  const minFrom = rows.map(r => r.from_date).sort()[0]
  const maxTo = rows.map(r => r.to_date || r.from_date).sort().slice(-1)[0]
  const { data: off } = await sb.from('leave_applications')
    .select('id, employee_id, from_date, to_date, status, leave_types(short_name)')
    .in('employee_id', teamRows.map(t => t.id)).in('status', ['APPROVED', 'PENDING'])
    .lte('from_date', maxTo).gte('to_date', minFrom)
  const nameOf = new Map(teamRows.map(t => [t.id, t.full_name]))
  const teamOf = new Map(teamRows.map(t => [t.id, t.l1_manager_id]))
  for (const r of rows) {
    const mgr = managerOf.get(r.employee_id)
    const to = r.to_date || r.from_date
    const list = ((off || []) as any[])
      .filter(o => o.id !== r.id && o.employee_id !== r.employee_id && teamOf.get(o.employee_id) === mgr && o.from_date <= to && o.to_date >= r.from_date)
      .map(o => `${nameOf.get(o.employee_id)} (${o.leave_types?.short_name || 'leave'}, ${dayMon(o.from_date)}${o.to_date !== o.from_date ? '–' + dayMon(o.to_date) : ''}${o.status === 'PENDING' ? ', pending' : ''})`)
    out.set(r.id, [...new Set(list)])
  }
  return out
}
