// lib/leave/policy.ts — what a leave type lets somebody take, and whether a
// request fits. Pure: no database, so every rule here is unit-tested
// (lib/leave/__tests__/policy.test.ts) and shared by the apply route, the
// approval step, the approver's card, the balance sync and the HR screen.
//
// HOW A TYPE IS COUNTED — four policies, decided by the type's own settings:
//
//   UNLIMITED       allow_without_balance (LWP, Sabbatical). Never blocked on
//                   balance; the days are still counted as used, because LWP
//                   days are exactly what payroll needs to deduct.
//   EARNED          application_mode EARN_AVAIL (Comp Off). A comp-off is
//                   earned by working an off day, and nothing in the product
//                   records that yet (comp_off_ledger is empty and has no
//                   screen), so the approver verifies it. Not blocked.
//   PER_OCCURRENCE  a lifetime cap (max_times_in_tenure — Maternity 2,
//                   Paternity 2). These are statutory entitlements granted per
//                   event, not earned month by month: Maternity is 26 weeks
//                   when it happens, not 15 days a month. The quota is what one
//                   request may cover; the cap on occurrences is enforced
//                   separately by the apply route.
//   ACCRUAL         everything else. opening + accrued − used − encashed, from
//                   lib/leave/accrual.ts. A type whose quota is 0 accrues
//                   nothing, so it can only be taken once HR loads an opening
//                   balance or sets a quota — which is what "0-day quota" means.
//
// PENDING COUNTS AGAINST WHAT YOU CAN BOOK. Two pending 3-day CL requests on a
// 4-day balance must not both get through to two different approvers.
// `available` is what has been earned and not taken; `bookable` subtracts what
// is already waiting.
import { balanceFor, floor1, normaliseMode, type LeaveApplicationLike } from './accrual.ts'

export type LeavePolicy = 'UNLIMITED' | 'EARNED' | 'PER_OCCURRENCE' | 'ACCRUAL'

export interface LeaveTypeLike {
  id: string
  short_name: string | null
  name: string | null
  application_mode?: string | null
  accrual?: string | null
  annual_quota?: number | string | null
  allow_without_balance?: boolean | null
  is_paid?: boolean | null
  gender?: string | null
  max_times_in_tenure?: number | string | null
  sort_order?: number | null
}

export interface StoredBalanceLike {
  opening?: number | string | null
  encashed?: number | string | null
}

export interface TypeBalance {
  leave_type_id: string
  short_name: string
  name: string
  policy: LeavePolicy
  quota: number
  opening: number
  accrued: number
  used: number
  pending: number
  encashed: number
  /** Earned and not yet taken. null when the type is not balance-tracked. */
  available: number | null
  /** available − pending: what a NEW request may use. null when not tracked. */
  bookable: number | null
  /** Counts towards the single "leave balance" figure (EL, CL, SL …). */
  headline: boolean
}

export function policyOf(t: LeaveTypeLike, quota: number): LeavePolicy {
  if (t.allow_without_balance) return 'UNLIMITED'
  if (String(t.application_mode || '').toUpperCase() === 'EARN_AVAIL') return 'EARNED'
  if (t.max_times_in_tenure != null && quota > 0) return 'PER_OCCURRENCE'
  return 'ACCRUAL'
}

/**
 * The single "leave balance" number on Home, Today and the Leave tab: the
 * ordinary paid leave everybody accrues. Gendered and per-occurrence types are
 * left out — adding 180 days of maternity entitlement to somebody's EL/CL/SL
 * would make the figure meaningless.
 */
export function isHeadline(t: LeaveTypeLike, quota: number, policy: LeavePolicy): boolean {
  return policy === 'ACCRUAL'
    && t.is_paid !== false
    && String(t.gender || 'ANY').toUpperCase() === 'ANY'
    && String(t.application_mode || 'EMPLOYEE').toUpperCase() === 'EMPLOYEE'
    && quota > 0
}

const num = (v: unknown) => Number(v) || 0

/** Sum of a type's PENDING days in the FY (by from_date, as `used` is). */
export function pendingFrom(apps: LeaveApplicationLike[], leaveTypeId: string, fyStartYear: number, excludeId?: string): number {
  const start = `${fyStartYear}-04-01`, end = `${fyStartYear + 1}-03-31`
  let total = 0
  for (const a of apps || []) {
    if (a.leave_type_id !== leaveTypeId) continue
    if (String(a.status).toUpperCase() !== 'PENDING') continue
    if (excludeId && (a as { id?: string }).id === excludeId) continue
    if (a.from_date < start || a.from_date > end) continue
    total += num(a.days)
  }
  return floor1(total)
}

export interface ComputeInput {
  type: LeaveTypeLike
  /** The resolved quota (branch/company policy, else catalogue). */
  quota: number
  fyStartYear: number
  doj: string | null | undefined
  lwd: string | null | undefined
  stored?: StoredBalanceLike | null
  /** This employee's applications in the FY — APPROVED and PENDING both. */
  applications: (LeaveApplicationLike & { id?: string })[]
  asOf?: Date
  /** Leave a request out of `pending` (re-checking it at approval time). */
  excludeId?: string
}

export function computeTypeBalance(i: ComputeInput): TypeBalance {
  const t = i.type
  const policy = policyOf(t, i.quota)
  const base = balanceFor({
    annualQuota: i.quota,
    fyStartYear: i.fyStartYear,
    doj: i.doj,
    lwd: i.lwd,
    opening: num(i.stored?.opening),
    encashed: num(i.stored?.encashed),
    applications: i.applications,
    leaveTypeId: t.id,
    asOf: i.asOf,
    mode: normaliseMode(t.accrual),
  })
  const pending = pendingFrom(i.applications, t.id, i.fyStartYear, i.excludeId)
  const common = {
    leave_type_id: t.id,
    short_name: String(t.short_name || ''),
    name: String(t.name || t.short_name || 'Leave'),
    policy, quota: i.quota,
    opening: base.opening, used: base.used, pending, encashed: base.encashed,
    headline: isHeadline(t, i.quota, policy),
  }
  if (policy === 'UNLIMITED' || policy === 'EARNED') {
    return { ...common, accrued: 0, available: null, bookable: null }
  }
  if (policy === 'PER_OCCURRENCE') {
    // The full entitlement, for each occurrence.
    return { ...common, accrued: i.quota, available: i.quota, bookable: i.quota }
  }
  // base.available is clamped at 0; bookable is too — a negative "you can book"
  // is not a number anyone can act on.
  return {
    ...common,
    accrued: base.accrued,
    available: base.available,
    bookable: Math.max(0, floor1(base.available - pending)),
  }
}

export type RequestCheck =
  | { ok: true }
  | { ok: false; reason: string; bookable: number; available: number; pending: number }

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Does a request of `days` fit this balance? */
export function checkRequest(b: TypeBalance, days: number): RequestCheck {
  if (b.bookable == null || b.available == null) return { ok: true }
  if (b.policy === 'PER_OCCURRENCE') {
    if (days <= b.quota) return { ok: true }
    return { ok: false, available: b.quota, pending: 0, bookable: b.quota,
      reason: `${b.name} covers up to ${dayWord(b.quota)} per occurrence; this request is ${dayWord(days)}.` }
  }
  if (days <= b.bookable) return { ok: true }
  if (b.available <= 0 && b.quota <= 0 && b.opening <= 0) {
    return { ok: false, available: 0, pending: b.pending, bookable: 0,
      reason: `No ${b.name} entitlement has been set up for you yet — HR sets it in Leave configuration.` }
  }
  const waiting = b.pending > 0 ? ` (${dayWord(b.pending)} more already waiting for approval)` : ''
  return { ok: false, available: b.available, pending: b.pending, bookable: b.bookable,
    reason: `You have ${dayWord(b.bookable)} of ${b.short_name || b.name} you can book${waiting}; this request is ${dayWord(days)}.` }
}

/** Would approving `days` take this balance below zero? Pending is ignored —
 *  it is the decision on THIS request; others wait their turn. */
export function checkApproval(b: TypeBalance, days: number): RequestCheck {
  if (b.available == null) return { ok: true }
  if (b.policy === 'PER_OCCURRENCE') return checkRequest(b, days)
  if (days <= b.available) return { ok: true }
  return { ok: false, available: b.available, pending: b.pending, bookable: b.bookable ?? 0,
    reason: `Approving this would overdraw ${b.short_name || b.name}: ${dayWord(b.available)} left, request is ${dayWord(days)}.` }
}

export interface Split { from: string; to: string; days: number }

/**
 * Split a run of WORKING days into a paid part and an LWP remainder.
 *
 * The paid part takes whole days from the start, as many as `bookable` allows
 * (rounded down — a half day in the middle of a range is not a thing). Both
 * parts begin and end on working days, because they are built from the list of
 * working days itself; the leave rule "may not start or end on a holiday" holds
 * for each without re-checking.
 */
export function splitWithLwp(workingDays: string[], bookable: number): { paid: Split | null; lwp: Split | null } {
  const days = [...workingDays].sort()
  const n = Math.max(0, Math.min(days.length, Math.floor(bookable)))
  const paid = n > 0 ? { from: days[0], to: days[n - 1], days: n } : null
  const rest = days.slice(n)
  const lwp = rest.length ? { from: rest[0], to: rest[rest.length - 1], days: rest.length } : null
  return { paid, lwp }
}

/** How the approver relates to the employee, for "waiting on Shreya Reddy (HR manager)". */
export function approverRole(
  emp: { l1_manager_id?: string | null; l2_manager_id?: string | null; hr_manager_id?: string | null; hr_head_id?: string | null } | null | undefined,
  approverId: string | null | undefined,
): string {
  if (!emp || !approverId) return 'Approver'
  // L1 first: when one person is both line manager and HR manager, the line
  // relationship is the one the employee recognises.
  if (emp.l1_manager_id === approverId) return 'Reporting manager'
  if (emp.hr_manager_id === approverId) return 'HR manager'
  if (emp.l2_manager_id === approverId) return 'L2 manager'
  if (emp.hr_head_id === approverId) return 'HR head'
  return 'Approver (delegate)'
}
