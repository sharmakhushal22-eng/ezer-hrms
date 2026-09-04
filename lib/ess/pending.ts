// lib/ess/pending.ts — "pending on you", built once and used by Home and Approvals.
//
// Part 1 is the same for every login: rows whose current_approver_id is stamped to
// this employee (guide §2 — stamped at the stage transition, never recomputed at
// render). Part 2 adds what a wider scope surfaces: the HR Manager stage of every
// resignation for RESIGNATION approvers, PENDING_FINANCE claims for finance
// approvers, and the department's queue for an HOD. Each item says which of those
// produced it (surfaced_via, answers B4) so the UI and the audit can explain why.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { employeesById, daysAgo, fmtDate, type EssContext } from './session'

export type PendingKind = 'LEAVE' | 'TRAVEL' | 'RESIGNATION'
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
}

const RES_STAGE_LABEL: Record<string, string> = {
  PENDING_RM_L1: 'Acknowledge (RM L1)', PENDING_RM_L2: 'Acknowledge (RM L2)', PENDING_HOD: 'Acknowledge (HOD)',
  PENDING_HR_MANAGER: 'HR Manager — set final LWD', RETENTION_HOLD: 'On retention hold',
}
const RES_ACTIONS_RM = ['Acknowledge & forward', 'Accept with my date', 'Request retention']
const RES_ACTIONS_HR = ['Set final LWD', 'View full chain']

export async function buildPending(ctx: EssContext): Promise<PendingItem[]> {
  const me = ctx.caller.employeeId
  const items: PendingItem[] = []
  const seen = new Set<string>()
  const key = (k: PendingKind, id: string) => `${k}:${id}`

  // ── Part 1 — stamped to me ─────────────────────────────────────────────
  const [{ data: leaves }, { data: claims }, { data: resigs }] = await Promise.all([
    sb.from('leave_applications').select('id, employee_id, from_date, to_date, days, reason, applied_at, leave_types(name)')
      .eq('current_approver_id', me).eq('status', 'PENDING'),
    sb.from('travel_claims').select('id, employee_id, claim_no, total_claimed, status, submitted_at, period_from, period_to')
      .eq('current_approver_id', me).in('status', ['PENDING_RM', 'PENDING_HR', 'PENDING_FINANCE']),
    sb.from('employee_resignation').select('id, employee_id, status, current_stage, date_of_resignation, notice_period_days, notice_shortfall_days, lwd_as_per_policy, proposed_lwd, submitted_at, created_at, reason_code, exit_reason_master(label)')
      .eq('current_approver_id', me).in('status', ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD']),
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
      const [{ data: l }, { data: t }, { data: r }] = await Promise.all([
        sb.from('leave_applications').select('id, employee_id, from_date, to_date, days, reason, applied_at, current_approver_id, leave_types(name)').in('employee_id', ids).eq('status', 'PENDING'),
        sb.from('travel_claims').select('id, employee_id, claim_no, total_claimed, status, submitted_at, period_from, period_to, current_approver_id').in('employee_id', ids).in('status', ['PENDING_RM', 'PENDING_HR', 'PENDING_FINANCE']),
        sb.from('employee_resignation').select('id, employee_id, status, current_stage, current_approver_id, date_of_resignation, notice_period_days, notice_shortfall_days, lwd_as_per_policy, proposed_lwd, submitted_at, created_at, reason_code, exit_reason_master(label)').in('employee_id', ids).like('status', 'PENDING_%'),
      ])
      extras.push({ rows: l || [], kind: 'LEAVE', via: 'HOD scope' }, { rows: t || [], kind: 'TRAVEL', via: 'HOD scope' }, { rows: r || [], kind: 'RESIGNATION', via: 'HOD scope' })
    }
  }

  const allEmp = [...(leaves || []), ...(claims || []), ...(resigs || []), ...extras.flatMap(x => x.rows)].map((r: any) => r.employee_id)
  const names = await employeesById(allEmp)
  const who = (id: string) => { const e = names.get(id); return e ? `${e.full_name}${e.emp_code ? ' · ' + e.emp_code : ''}` : id }

  const pushLeave = (r: any, via: string, mine: boolean) => {
    const k = key('LEAVE', r.id); if (seen.has(k)) return; seen.add(k)
    items.push({
      kind: 'LEAVE', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Leave request — ${Number(r.days || 0)} day${Number(r.days) === 1 ? '' : 's'}, ${fmtDate(r.from_date)}${r.to_date && r.to_date !== r.from_date ? ' – ' + fmtDate(r.to_date) : ''}`,
      meta: [r.leave_types?.name, r.reason, `Requested ${daysAgo(r.applied_at)}`].filter(Boolean).join(' · '),
      stage: 'Approve', raised_at: r.applied_at, surfaced_via: via, mine, actions: mine ? ['Approve', 'Decline'] : ['View'],
    })
  }
  const pushTravel = (r: any, via: string, mine: boolean) => {
    const k = key('TRAVEL', r.id); if (seen.has(k)) return; seen.add(k)
    const stage = r.status === 'PENDING_RM' ? 'RM approval' : r.status === 'PENDING_HR' ? 'HR approval' : 'Finance approval'
    items.push({
      kind: 'TRAVEL', id: r.id, employee_id: r.employee_id, who: who(r.employee_id),
      what: `Travel claim — ₹${Math.round(Number(r.total_claimed || 0)).toLocaleString('en-IN')}${r.claim_no ? ' · ' + r.claim_no : ''}`,
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
      what: `Resignation — ${RES_STAGE_LABEL[r.status] || r.status}`,
      meta: [`Submitted ${fmtDate(r.submitted_at || r.created_at)}`, r.exit_reason_master?.label ? `reason: ${r.exit_reason_master.label}` : null,
             `notice ${r.notice_period_days ?? '—'} days`, r.proposed_lwd ? `RM proposed LWD ${fmtDate(r.proposed_lwd)}` : null,
             shortfall ? `${shortfall} days shortfall` : null].filter(Boolean).join(' · '),
      stage: RES_STAGE_LABEL[r.status] || r.status, raised_at: r.submitted_at || r.created_at, surfaced_via: via, mine,
      actions: !mine ? ['View full chain'] : r.status === 'RETENTION_HOLD' ? ['Resume chain', 'View full chain'] : hr ? RES_ACTIONS_HR : RES_ACTIONS_RM,
      tone: hr ? 'w' : r.status === 'RETENTION_HOLD' ? 'd' : 'w',
    })
  }

  ;(leaves || []).forEach((r: any) => pushLeave(r, 'stamped', true))
  ;(claims || []).forEach((r: any) => pushTravel(r, 'stamped', true))
  ;(resigs || []).forEach((r: any) => pushRes(r, 'stamped', true))
  for (const x of extras) for (const r of x.rows) {
    const mine = r.current_approver_id === me
    if (x.kind === 'LEAVE') pushLeave(r, x.via, mine)
    else if (x.kind === 'TRAVEL') pushTravel(r, x.via, mine)
    else pushRes(r, x.via, mine || (x.via === 'RESIGNATION role' && r.status === 'PENDING_HR_MANAGER'))
  }

  const rank: Record<PendingKind, number> = { RESIGNATION: 0, TRAVEL: 1, LEAVE: 2 }
  items.sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1) || rank[a.kind] - rank[b.kind] || String(a.raised_at).localeCompare(String(b.raised_at)))
  return items
}
