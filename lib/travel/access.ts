// ============================================================================
// EZER HRMS — Travel Claim Module · Access Guard
// lib/travel/access.ts
//
// THE TWO ENFORCEMENT RULES OF THIS MODULE LIVE HERE:
//
//   1. DATE OF LEAVING — once an employee is past their last working day they
//      cannot log in to the travel module, cannot enter or submit anything,
//      and cannot see any report. Default policy post_exit_grace_days = 0,
//      so the block lands ON the DOL itself.
//
//   2. PERIOD OPEN / CLOSE — HR opens and closes each expense month from the
//      admin screen. Nothing can be written into a CLOSED month, and a LOCKED
//      month (already paid through payroll) can never be reopened.
//
// Every API route calls requireWriteAccess() before it touches the database.
// Never call the DB directly from a route without going through here.
//
// employees.date_of_leaving exists in this repo exactly as the drop assumed,
// so DOL_COLUMN is unchanged. It is mirrored in migration 049's
// travel_is_employee_active(); those are the only two places that read it.
// ============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { GuardResult, TravelPeriod, TravelPolicy } from './types';

export const DOL_COLUMN = 'date_of_leaving';

// ---------------------------------------------------------------------------
// Service client — server-side only. Never import this into a 'use client' file.
//
// Same key pattern as the other 39 places in this repo: service-role if the
// environment has it, anon otherwise. The app never announces a missing
// service-role key and never fails because of one. Written on one line so a
// grep for the pattern finds this file too.
//
// The anon key is sufficient here because the travel tables ship with the
// permissive EZER RLS policy. If those policies are tightened — and they should
// be, expense data is more sensitive than attendance — this stops being enough,
// and the fix is to rethink the route, not to hand out the key.
// ---------------------------------------------------------------------------
export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    { auth: { persistSession: false } },
  );
}

// ---------------------------------------------------------------------------
export function monthStart(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(to + 'T00:00:00').getTime();
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Employee snapshot used by the guard and by the fare engine
// ---------------------------------------------------------------------------
// Field names here are the module's own vocabulary; the select below maps this
// repo's actual employee columns onto them, so nothing downstream has to know
// that department is really department_id or that the RM is l1_manager_id.
export interface EmployeeContext {
  id: string;
  company_id: string;
  employee_code: string | null;
  full_name: string | null;
  grade: string | null;
  department: string | null;
  location: string | null;
  date_of_joining: string | null;
  date_of_leaving: string | null;
  reporting_manager_l1: string | null;
  hr_head_id: string | null;
  is_active_for_travel: boolean;
  exited_on: string | null;
}

export async function getEmployeeContext(
  sb: SupabaseClient,
  employeeId: string
): Promise<EmployeeContext | null> {
  const { data, error } = await sb
    .from('employees')
    .select(
      `id, company_id, emp_code, full_name, grade, department_id, location_id,
       group_doj, ${DOL_COLUMN}, l1_manager_id, hr_head_id, hr_manager_id`
    )
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, any>;
  const dol = row[DOL_COLUMN] as string | null;

  return {
    id: row.id,
    company_id: row.company_id,
    employee_code: row.emp_code ?? null,
    full_name: row.full_name ?? null,
    grade: row.grade ?? null,
    department: row.department_id ?? null,
    location: row.location_id ?? null,
    date_of_joining: row.group_doj ?? null,
    date_of_leaving: dol ?? null,
    reporting_manager_l1: row.l1_manager_id ?? null,
    // hr_head_id is the HR Head who signs off travel spend; hr_manager_id is
    // the day-to-day HR contact and only stands in when no head is mapped.
    hr_head_id: row.hr_head_id ?? row.hr_manager_id ?? null,
    is_active_for_travel: true, // recomputed below by checkEmployeeActive
    exited_on: dol ?? null,
  };
}

// ---------------------------------------------------------------------------
// APPROVAL ROUTING — added for this repo. The drop shipped RM -> Finance with
// no HR stage; the chain here is RM -> HR Head -> Finance, and the RM leg only
// runs when the policy enables it and an RM is actually mapped.
//
// Mirrors travel_claim_approver() / travel_first_claim_stage() in migration 049.
// Kept in TypeScript too so the routes can resolve an approver without a round
// trip through the database for every claim.
// ---------------------------------------------------------------------------
export type ClaimStage = 'CLAIM_RM' | 'CLAIM_HR' | 'CLAIM_FINANCE';
export type ClaimPendingStatus = 'PENDING_RM' | 'PENDING_HR' | 'PENDING_FINANCE';

export function resolveApprover(
  emp: EmployeeContext,
  stage: ClaimStage
): string | null {
  const approver =
    stage === 'CLAIM_RM' ? emp.reporting_manager_l1
    : stage === 'CLAIM_HR' ? emp.hr_head_id
    : null;

  // never route a claim back to the person who raised it
  return approver && approver !== emp.id ? approver : null;
}

/** Where a freshly submitted claim lands. Finance is always the last stop. */
export function firstClaimStage(
  emp: EmployeeContext,
  policy: TravelPolicy | null
): ClaimPendingStatus {
  if (policy?.rm_stage_enabled && resolveApprover(emp, 'CLAIM_RM')) {
    return 'PENDING_RM';
  }
  if (resolveApprover(emp, 'CLAIM_HR')) return 'PENDING_HR';
  // Nobody mapped upstream — Finance still has to see it rather than the claim
  // parking in a state no one owns.
  return 'PENDING_FINANCE';
}

/** Where a claim goes after the stage that just approved it. */
export function nextClaimStage(
  current: ClaimPendingStatus,
  emp: EmployeeContext
): ClaimPendingStatus | 'APPROVED' {
  if (current === 'PENDING_RM') {
    return resolveApprover(emp, 'CLAIM_HR') ? 'PENDING_HR' : 'PENDING_FINANCE';
  }
  if (current === 'PENDING_HR') return 'PENDING_FINANCE';
  return 'APPROVED'; // Finance approved — nothing after it
}

// ---------------------------------------------------------------------------
// RULE 1 — Date of leaving
// ---------------------------------------------------------------------------
export async function checkEmployeeActive(
  sb: SupabaseClient,
  employeeId: string
): Promise<GuardResult> {
  const emp = await getEmployeeContext(sb, employeeId);

  if (!emp) {
    return {
      allowed: false,
      code: 'EMPLOYEE_NOT_FOUND',
      message: 'Employee record not found.',
    };
  }

  if (!emp.date_of_leaving) {
    return { allowed: true, code: 'OK', message: '' };
  }

  const policy = await getActivePolicy(sb, emp.company_id);
  const grace = policy?.post_exit_grace_days ?? 0;

  const cutoff = new Date(emp.date_of_leaving + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() + grace);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  if (todayISO() > cutoffISO) {
    return {
      allowed: false,
      code: 'EMPLOYEE_EXITED',
      message:
        grace > 0
          ? `Your travel module access ended on ${cutoffISO} (${grace} days after your last working day).`
          : 'Your travel module access ended on your last working day.',
      meta: { date_of_leaving: emp.date_of_leaving, grace_days: grace },
    };
  }

  return { allowed: true, code: 'OK', message: '' };
}

// ---------------------------------------------------------------------------
// RULE 2 — Period open / close
// ---------------------------------------------------------------------------
export async function getPeriod(
  sb: SupabaseClient,
  companyId: string,
  expenseDate: string
): Promise<TravelPeriod | null> {
  const { data } = await sb
    .from('travel_periods')
    .select('*')
    .eq('company_id', companyId)
    .eq('period_month', monthStart(expenseDate))
    .maybeSingle();
  return (data as TravelPeriod) ?? null;
}

export async function checkPeriodOpen(
  sb: SupabaseClient,
  companyId: string,
  expenseDate: string
): Promise<GuardResult> {
  const period = await getPeriod(sb, companyId, expenseDate);

  if (!period) {
    return {
      allowed: false,
      code: 'PERIOD_NOT_OPENED',
      message:
        'This expense month has not been opened yet. Please ask HR to open it.',
      meta: { period_month: monthStart(expenseDate) },
    };
  }

  if (period.status === 'LOCKED') {
    return {
      allowed: false,
      code: 'PERIOD_LOCKED',
      message: `${period.period_label} is locked — it has already been paid through payroll and cannot be changed.`,
      meta: { period },
    };
  }

  if (period.status === 'CLOSED') {
    return {
      allowed: false,
      code: 'PERIOD_CLOSED',
      message: `${period.period_label} is closed. You can no longer add or edit expenses for this month.`,
      meta: { period },
    };
  }

  const today = todayISO();
  if (period.submit_open_from && today < period.submit_open_from) {
    return {
      allowed: false,
      code: 'PERIOD_CLOSED',
      message: `Submissions for ${period.period_label} open on ${period.submit_open_from}.`,
      meta: { period },
    };
  }
  if (period.submit_open_till && today > period.submit_open_till) {
    return {
      allowed: false,
      code: 'PERIOD_CLOSED',
      message: `The submission window for ${period.period_label} ended on ${period.submit_open_till}.`,
      meta: { period },
    };
  }

  return { allowed: true, code: 'OK', message: '', meta: { period } };
}

// ---------------------------------------------------------------------------
// Bill age — the 90-day rule, enforced at ENTRY not at approval
// ---------------------------------------------------------------------------
export function checkBillAge(
  expenseDate: string,
  policy: TravelPolicy,
  doj: string | null
): GuardResult {
  const today = todayISO();

  if (expenseDate > today) {
    return {
      allowed: false,
      code: 'FUTURE_DATED',
      message: 'Expense date cannot be in the future.',
    };
  }

  if (doj && expenseDate < doj) {
    return {
      allowed: false,
      code: 'BEFORE_JOINING',
      message: `Expense date is before your date of joining (${doj}).`,
    };
  }

  const age = daysBetween(expenseDate, today);

  if (age > policy.bill_max_age_days) {
    return {
      allowed: false,
      code: 'BILL_TOO_OLD',
      message: `This bill is ${age} days old. Bills older than ${policy.bill_max_age_days} days cannot be claimed.`,
      meta: { age_days: age, max_days: policy.bill_max_age_days },
    };
  }

  return { allowed: true, code: 'OK', message: '', meta: { age_days: age } };
}

// ---------------------------------------------------------------------------
// Active policy for a company
// ---------------------------------------------------------------------------
export async function getActivePolicy(
  sb: SupabaseClient,
  companyId: string
): Promise<TravelPolicy | null> {
  const today = todayISO();
  const { data } = await sb
    .from('travel_policies')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;
  const p = data[0] as TravelPolicy;
  if (p.effective_to && p.effective_to < today) return null;
  return p;
}

// ---------------------------------------------------------------------------
// THE ONE FUNCTION EVERY WRITE ROUTE CALLS
// ---------------------------------------------------------------------------
export interface WriteAccess {
  ok: boolean;
  guard: GuardResult;
  employee?: EmployeeContext;
  policy?: TravelPolicy;
  period?: TravelPeriod;
}

export async function requireWriteAccess(
  sb: SupabaseClient,
  employeeId: string,
  expenseDate: string
): Promise<WriteAccess> {
  // 1. still an employee?
  const active = await checkEmployeeActive(sb, employeeId);
  if (!active.allowed) return { ok: false, guard: active };

  const emp = await getEmployeeContext(sb, employeeId);
  if (!emp) {
    return {
      ok: false,
      guard: {
        allowed: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee record not found.',
      },
    };
  }

  const policy = await getActivePolicy(sb, emp.company_id);
  if (!policy) {
    return {
      ok: false,
      guard: {
        allowed: false,
        code: 'PERIOD_NOT_OPENED',
        message: 'No active travel policy is configured for your company.',
      },
      employee: emp,
    };
  }

  // 2. is the month open?
  const periodCheck = await checkPeriodOpen(sb, emp.company_id, expenseDate);
  if (!periodCheck.allowed) {
    return { ok: false, guard: periodCheck, employee: emp, policy };
  }

  // 3. is the bill within 90 days?
  const ageCheck = checkBillAge(expenseDate, policy, emp.date_of_joining);
  if (!ageCheck.allowed) {
    return { ok: false, guard: ageCheck, employee: emp, policy };
  }

  return {
    ok: true,
    guard: { allowed: true, code: 'OK', message: '' },
    employee: emp,
    policy,
    period: (periodCheck.meta as { period: TravelPeriod })?.period,
  };
}

// ---------------------------------------------------------------------------
// READ access — used by the ESS page and every report endpoint.
// A separated exit employee gets nothing, not even their own history.
// ---------------------------------------------------------------------------
export async function requireReadAccess(
  sb: SupabaseClient,
  employeeId: string
): Promise<WriteAccess> {
  const active = await checkEmployeeActive(sb, employeeId);
  if (!active.allowed) return { ok: false, guard: active };

  const emp = await getEmployeeContext(sb, employeeId);
  if (!emp) {
    return {
      ok: false,
      guard: {
        allowed: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee record not found.',
      },
    };
  }

  const policy = await getActivePolicy(sb, emp.company_id);
  return {
    ok: true,
    guard: { allowed: true, code: 'OK', message: '' },
    employee: emp,
    policy: policy ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Standard JSON error shape so the UI can switch on `code`
// ---------------------------------------------------------------------------
export function guardResponse(guard: GuardResult): Response {
  const status =
    guard.code === 'EMPLOYEE_EXITED' || guard.code === 'EMPLOYEE_NOT_FOUND'
      ? 403
      : 409;
  return new Response(
    JSON.stringify({ error: guard.message, code: guard.code, meta: guard.meta ?? null }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}
