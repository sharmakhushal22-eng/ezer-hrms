// lib/leave/accrual.ts — what an employee has actually earned.
//
// THE MODEL, as specified:
//
//   * quota comes from resolve_leave_quota(company, branch, fy) — branch policy
//     wins, then company default, then the catalogue value on leave_types
//   * it accrues MONTHLY at annual_quota / 12
//   * a month is credited at MONTH END, not on the 1st
//   * a joining or leaving month is weighted by its effective days
//   * `used` is derived from APPROVED leave applications, never stored
//   * carry-forward is capped at the FINANCIAL YEAR boundary only; within the
//     year, unused accrual simply accumulates
//
// EFFECTIVE DAYS
//
//   normal month    every day
//   joining month   last day of month − DOJ + 1
//   leaving month   LWD − 1 + 1, i.e. the day number of the last working day
//   both at once    LWD − DOJ + 1
//
// The last working day is employees.date_of_leaving. Four columns could have
// claimed that role — date_of_leaving, relieving_date, date_of_resignation and
// employee_resignation.final_lwd — and accrual has to agree with payroll rather
// than pick its own, so this one is named here deliberately.
//
// WHY THE ROUNDING HAPPENS ONCE, AT THE END
//
// Rounding down per month looks tidier and is wrong. EL is 15/12 = 1.25 a
// month; floored to one decimal that is 1.2, so a full year would accrue 14.4
// days instead of 15 — the employee quietly loses half a day a year to
// arithmetic. The months are summed exactly and floored once, which keeps a
// whole year whole and still never credits more than is owed.
//
// One decimal because leave_balances is NUMERIC(6,1). Down, not nearest, so the
// company never over-credits.

/** Last calendar day of a 1-indexed month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM-DD' → parts, or null for anything unusable. */
function parts(d: string | null | undefined): { y: number; m: number; d: number } | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, dd] = d.split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(dd) ? { y, m, d: dd } : null;
}

const before = (a: { y: number; m: number }, b: { y: number; m: number }) =>
  a.y < b.y || (a.y === b.y && a.m < b.m);
const same = (a: { y: number; m: number }, b: { y: number; m: number }) =>
  a.y === b.y && a.m === b.m;

/**
 * Days of one month the employee was actually on the payroll.
 *
 * 0 before they joined and after they left, which is what makes the same
 * function serve joiners, leavers and everyone in between.
 */
export function effectiveDays(
  year: number, month: number,
  doj: string | null | undefined,
  lwd: string | null | undefined,
): number {
  const total = daysInMonth(year, month);
  const here = { y: year, m: month };
  const j = parts(doj);
  const l = parts(lwd);

  // No joining date on file: nothing can be earned. Two of 398 employees are in
  // this state, and crediting them a full year on missing data would be worse
  // than crediting nothing — the gap shows up instead of being papered over.
  if (!j) return 0;

  if (before(here, j)) return 0;               // not joined yet
  if (l && before(l, here)) return 0;          // already left

  const from = same(here, j) ? j.d : 1;
  const to = l && same(here, l) ? l.d : total;
  return Math.max(0, to - from + 1);
}

/**
 * How a type credits its quota. Mirrors leave_policy.accrual / leave_types.accrual.
 *
 * The live data says YEARLY for all eleven types and all three policy rows,
 * which contradicts the monthly model this engine was specified against.
 * Rather than hard-code monthly and make the configuration a lie — or read the
 * column and make the balances wrong — the engine honours the column and
 * migration 130 corrects the data. Neither is silently overruled.
 */
export type AccrualMode = 'MONTHLY' | 'YEARLY' | 'NONE';

export function normaliseMode(v: string | null | undefined): AccrualMode {
  const s = String(v || '').toUpperCase();
  return s === 'MONTHLY' || s === 'YEARLY' || s === 'NONE' ? s : 'MONTHLY';
}

/** The exact (unrounded) accrual for one month. */
export function monthlyAccrual(
  annualQuota: number, year: number, month: number,
  doj: string | null | undefined, lwd: string | null | undefined,
): number {
  if (!(annualQuota > 0)) return 0;
  const total = daysInMonth(year, month);
  return (annualQuota / 12) * (effectiveDays(year, month, doj, lwd) / total);
}

/** One decimal, rounded DOWN. The column is NUMERIC(6,1). */
export function floor1(n: number): number {
  // +1e-9 absorbs binary float error so an exact 15 cannot fall to 14.9.
  return Math.floor(n * 10 + 1e-9) / 10;
}

/** The twelve (year, month) pairs of an Indian FY, April → March. */
export function fyMonths(fyStartYear: number): { year: number; month: number }[] {
  return Array.from({ length: 12 }, (_, i) => ({
    year: fyStartYear + Math.floor((3 + i) / 12),
    month: ((3 + i) % 12) + 1,
  }));
}

/**
 * Everything accrued between the FY start and `asOf`, month-end credited.
 *
 * A month counts only once it has finished: on 21 September, April through
 * August are credited and September is not. That is what "month end" means,
 * and it is the difference between 6 × 1.25 and 5 × 1.25 on an EL balance.
 */
export function accruedAsOf(
  annualQuota: number, fyStartYear: number,
  doj: string | null | undefined, lwd: string | null | undefined,
  asOf: Date = new Date(),
  mode: AccrualMode = 'MONTHLY',
): number {
  if (mode === 'NONE' || !(annualQuota > 0)) return 0;

  const asY = asOf.getFullYear(), asM = asOf.getMonth() + 1, asD = asOf.getDate();
  const ended = (year: number, month: number) =>
    year < asY ||
    (year === asY && month < asM) ||
    (year === asY && month === asM && asD >= daysInMonth(year, month));

  // YEARLY grants the whole quota once the employee is here — no spreading.
  // Kept deliberately simple because migration 130 moves every type to MONTHLY;
  // if YEARLY is ever used in earnest it will need its own pro-rata rule, and
  // that is a decision rather than an implementation detail.
  if (mode === 'YEARLY') {
    const present = fyMonths(fyStartYear).some(
      ({ year, month }) => effectiveDays(year, month, doj, lwd) > 0,
    );
    return present ? floor1(annualQuota) : 0;
  }

  let exact = 0;
  for (const { year, month } of fyMonths(fyStartYear)) {
    if (!ended(year, month)) continue;
    exact += monthlyAccrual(annualQuota, year, month, doj, lwd);
  }
  return floor1(exact);
}

export interface LeaveApplicationLike {
  leave_type_id: string;
  status: string;
  from_date: string;
  days: number | string | null;
}

/**
 * Days consumed, derived rather than stored.
 *
 * leave_balances.used exists in the schema and nothing has ever written it. A
 * stored counter drifts the moment an application is cancelled or edited;
 * deriving it cannot. PENDING is deliberately excluded — a request awaiting a
 * manager has not been taken.
 */
export function usedFrom(
  apps: LeaveApplicationLike[], leaveTypeId: string, fyStartYear: number,
): number {
  const start = `${fyStartYear}-04-01`;
  const end = `${fyStartYear + 1}-03-31`;
  let total = 0;
  for (const a of apps || []) {
    if (a.leave_type_id !== leaveTypeId) continue;
    if (String(a.status).toUpperCase() !== 'APPROVED') continue;
    if (a.from_date < start || a.from_date > end) continue;
    total += Number(a.days) || 0;
  }
  return floor1(total);
}

export interface BalanceInput {
  annualQuota: number;
  fyStartYear: number;
  doj: string | null | undefined;
  lwd: string | null | undefined;
  opening?: number;      // carried in from last FY, capped at max_carry_forward
  encashed?: number;
  applications?: LeaveApplicationLike[];
  leaveTypeId?: string;
  asOf?: Date;
  /** From leave_policy.accrual / leave_types.accrual. Defaults to MONTHLY. */
  mode?: AccrualMode;
}

export interface Balance {
  opening: number; accrued: number; used: number; encashed: number; available: number;
}

/** opening + accrued − used − encashed, never below zero. */
export function balanceFor(i: BalanceInput): Balance {
  const opening = Number(i.opening || 0);
  const encashed = Number(i.encashed || 0);
  // The mode must reach accruedAsOf. Omitting it here would make every balance
  // MONTHLY whatever the configuration says — the precise failure the mode was
  // added to prevent, reintroduced one call deeper.
  const accrued = accruedAsOf(i.annualQuota, i.fyStartYear, i.doj, i.lwd, i.asOf, i.mode ?? 'MONTHLY');
  const used = i.applications && i.leaveTypeId
    ? usedFrom(i.applications, i.leaveTypeId, i.fyStartYear)
    : 0;
  return {
    opening, accrued, used, encashed,
    // Clamped: a negative balance is not a thing an employee can have, and
    // showing one would invite the question of what it means.
    available: Math.max(0, floor1(opening + accrued - used - encashed)),
  };
}

/**
 * What carries into next FY: the closing balance, capped.
 *
 * `maxCarryForward` is the FY-END cap and nothing else — within the year unused
 * accrual accumulates freely. EL is capped at 30; CL and SL at 0, so they
 * lapse. `unlimited` overrides the cap.
 */
export function carryForward(
  closing: number, maxCarryForward: number, unlimited = false,
): number {
  if (closing <= 0) return 0;
  if (unlimited) return floor1(closing);
  return floor1(Math.min(closing, Math.max(0, maxCarryForward)));
}
