// lib/ess/leave-year.ts — the single answer to "which year key does leave use?"
//
// WHY THIS FILE EXISTS
//
// Leave had three year-keys for one feature:
//
//   leave_balances.year   TEXT '2026'      calendar year, per migration 030:77
//   home/route.ts         new Date().getFullYear()   number, calendar year
//   LeaveSection          '2026'           hardcoded string
//   the card title        "FY 2026-27"     financial year
//   leave_policy.fy       '2026-27'        financial year
//
// On 18 Sep 2026 every one of those resolved to 2026, so nothing looked wrong.
// On 1 Jan 2027 they diverge: the Home KPI silently moves to 2027 while the
// Leave tab stays pinned to 2026, and neither tracks the Indian FY boundary of
// 1 April — which is what the card claims to be showing.
//
// THE FIX
//
// Keep the column's calendar-year TEXT shape (the HR upload template writes it,
// and changing that is a data migration, not a code change) but derive it from
// the FINANCIAL year's start. Indian FY 2026-27 begins April 2026, so its key is
// '2026' — for every month from Apr 2026 through Mar 2027 inclusive.
//
// That makes the "FY 2026-27" label literally true, and makes the key stable
// across 1 January instead of flipping mid-year.

/**
 * The `leave_balances.year` key for a date: the FY's starting calendar year.
 *
 * Apr 2026 … Mar 2027  → '2026'   (FY 2026-27)
 * Apr 2027 … Mar 2028  → '2027'   (FY 2027-28)
 *
 * TEXT, because the column is TEXT. Comparing a number against it works only
 * because PostgREST coerces — which is the accident the old code relied on.
 */
export function leaveYearOf(d = new Date()): string {
  return String(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
}

/** The matching display label: '2026' → 'FY 2026-27'. Keeps card and query in step. */
export function leaveFyLabel(yearKey: string): string {
  const y = Number(yearKey);
  if (!Number.isFinite(y)) return yearKey;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * The `leave_policy.fy` key: '2026' → '2026-27'.
 *
 * A THIRD format for the same year, and the reason this lives here rather than
 * at a call site. The leave feature already had its year expressed three ways
 * (see the note at the top of this file); quota adds a fourth shape because
 * leave_policy.fy and resolve_leave_quota(p_fy) both want '2026-27' while
 * leave_balances.year wants '2026'.
 *
 * Deriving one from the other in one named place is what stops a route
 * querying FY 2026-27 quota against FY 2026 balances and getting a plausible,
 * wrong answer — the same class of bug as the Friday-to-Monday day count.
 */
export function leavePolicyFy(yearKey: string = leaveYearOf()): string {
  const y = Number(yearKey);
  if (!Number.isFinite(y)) return yearKey;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** The FY's start year as a number, for the accrual engine. '2026' → 2026. */
export function leaveFyStartYear(yearKey: string = leaveYearOf()): number {
  const y = Number(yearKey);
  return Number.isFinite(y) ? y : new Date().getFullYear();
}
