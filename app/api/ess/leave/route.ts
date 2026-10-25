// app/api/ess/leave/route.ts — the ESS Leave API.
//
// WHY THIS ROUTE EXISTS
//
// Leave was the one ESS feature that talked to Supabase directly from the
// browser on the anon key. Every other tab — Wall, FunZone, Inbox, Approvals,
// Today, Social — goes through essRoute(req), which resolves the caller from
// the ESS session so a request body can never name the actor.
//
// Leave did not, and the leave tables carry the house permissive RLS policy
// (030:119-126, `FOR ALL TO anon, authenticated USING (true)`). The apply path
// was therefore a bare insert with `employee_id` taken from the client and
// `status:'PENDING'` set client-side: anyone could file leave as anyone, and
// the database trigger would helpfully route it to that person's real manager.
//
// Every rule below used to live only in the browser, where it was advice.
//
// GET   → everything the Leave tab renders, in ONE round trip (was four).
// POST  → apply, fully validated server-side.
// PATCH → cancel your own PENDING request (the CANCELLED status has existed
//         in the CHECK constraint since 030 with no way to reach it).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, fmtDate } from '@/lib/ess/session'
import { employeeScope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { daysLabel } from '@/lib/config/workflow-templates'
import { leaveYearOf, leaveFyLabel } from '@/lib/ess/leave-year'
import { ledgerFor, syncBalancesQuietly } from '@/lib/leave/ledger'
import { checkRequest, splitWithLwp, approverRole, type TypeBalance } from '@/lib/leave/policy'
import { contacts, deliver, later, portalUrl, fmtRange } from '@/lib/leave/notify'
import { requestLeaveCancel } from '@/lib/leave/workflow'

export const dynamic = 'force-dynamic'

// ── Employee gender is 'Male'/'Female'; leave_types.gender is 'M'/'F'/'ANY' ──
// Comparing them directly rejects every maternity and paternity request, which
// is exactly what a naive `===` here would have done. 5 of 398 employees have
// no gender recorded at all: unknown must not block, or an HR data gap becomes
// an employee's problem.
function normGender(g: string | null | undefined): 'M' | 'F' | null {
  if (!g) return null
  const s = String(g).trim().toUpperCase()
  if (s === 'M' || s === 'MALE') return 'M'
  if (s === 'F' || s === 'FEMALE') return 'F'
  return null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parseDay = (s: unknown): Date | null => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? null : d
}
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000)

/** Every calendar date from `from` to `to`, inclusive. */
function eachDay(from: Date, to: Date): string[] {
  const out: string[] = []
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) out.push(iso(new Date(t)))
  return out
}

/** The Leave Without Pay type, if the catalogue has one: unpaid and never
 *  balance-blocked. It is what the excess of an over-balance request becomes. */
async function lwpType(): Promise<{ id: string; name: string; short_name: string } | null> {
  const { data } = await sb.from('leave_types').select('id, name, short_name, is_paid, allow_without_balance, application_mode')
    .eq('is_active', true).eq('allow_without_balance', true).eq('is_paid', false).order('sort_order')
  const t = (data || []).find((x: any) => String(x.application_mode || 'EMPLOYEE').toUpperCase() === 'EMPLOYEE')
  return t ? { id: t.id, name: t.name, short_name: t.short_name } : null
}

/** "7.5 days of EL; 5.5 after this request" — for the approver's email. */
function balanceLine(b: TypeBalance | undefined, days: number): string {
  if (!b || b.available == null) return ''
  if (b.policy === 'PER_OCCURRENCE') return `${b.name}: up to ${b.quota} days per occurrence`
  const after = Math.round((b.available - days) * 10) / 10
  return `${b.available} day(s) of ${b.short_name || b.name} left; ${after} after this request`
}

/** A date that cannot be claimed as leave, and why. */
type NonWorking = { date: string; kind: 'WEEKLY_OFF' | 'HOLIDAY'; label: string }

/**
 * Every non-working date in a range, from the configured calendar.
 *
 * This is the join between ESS Leave and Holiday & Weekly-off Configuration.
 * Both resolvers have existed since migration 026:
 *   resolve_weekly_offs() reads weekly_off_config, scoped company/branch/
 *     employment_type, and understands EVERY and NTH modes.
 *   resolve_holidays()    reads the employee's mapped PUBLISHED calendar,
 *     scoped by holiday_applicability (company × branch).
 * Nothing here is hardcoded — no weekday constant, no holiday list.
 *
 * OPTIONAL HOLIDAYS COUNT AS HOLIDAYS.
 * This reverses the previous rule. A day the company has declared a holiday is
 * not a day an employee can spend leave on, and the config UI's "employee
 * picks" promise was never implemented — there is no pick table, route or
 * screen anywhere, so an optional holiday was simply a working day wearing a
 * holiday's label. Treating it as a real holiday is what the configuration
 * actually says.
 *
 * ERRORS ARE NOT SWALLOWED.
 * supabase-js .rpc() resolves with { data: null, error } rather than throwing,
 * so the previous `try/catch` never fired for a Postgres error — it destructured
 * `data` only, got null, built an empty off-set and counted EVERY calendar day
 * as working. A Friday-to-Monday request was then billed as 4 days instead of 2
 * and the employee was silently over-charged. A resolver that cannot be read is
 * now a refusal, not a guess.
 */
async function nonWorkingDays(
  employeeId: string, from: Date, to: Date,
): Promise<{ map: Map<string, NonWorking>; failed: boolean }> {
  const [offRes, holRes] = await Promise.all([
    sb.rpc('resolve_weekly_offs', { p_employee_id: employeeId, p_from: iso(from), p_to: iso(to) }),
    sb.rpc('resolve_holidays', { p_employee_id: employeeId }),
  ])
  const map = new Map<string, NonWorking>()
  if (offRes.error || holRes.error) return { map, failed: true }

  for (const r of (offRes.data || []) as any[]) {
    const d = String(r.off_date)
    map.set(d, { date: d, kind: 'WEEKLY_OFF', label: 'a weekly off' })
  }
  // A holiday overwrites a weekly off for the same date: if the company has
  // named the day, the name is the more useful thing to tell the employee.
  for (const h of (holRes.data || []) as any[]) {
    const d = String(h.holiday_date)
    map.set(d, { date: d, kind: 'HOLIDAY', label: String(h.description || 'a holiday') })
  }
  return { map, failed: false }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET — everything the tab renders, in one round trip
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const year = leaveYearOf()

  // The calendar the tab draws needs the employee's REAL weekly offs, not a
  // weekday constant. resolve_weekly_offs takes a range, so this asks for a
  // rolling year from today — comfortably past any date somebody can apply for,
  // and a few dozen dates on the wire.
  const winFrom = iso(new Date())
  const winTo = iso(new Date(Date.now() + 366 * 86400000))

  const [{ data: emp }, { data: types }, { data: apps }, { data: hols }, { data: offRows }, ledger, lwp] = await Promise.all([
    sb.from('employees')
      .select('gender, company_doj, group_doj, date_of_leaving, company_id, confirmation_status, l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id')
      .eq('id', me).maybeSingle(),
    sb.from('leave_types').select('*').eq('is_active', true).neq('application_mode', 'HR_MARK').order('sort_order'),
    sb.from('leave_applications')
      .select('*, leave_types(short_name, name)')
      .eq('employee_id', me).order('applied_at', { ascending: false }).limit(10),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: me, p_from: winFrom, p_to: winTo }),
    // Balances: one computation (lib/leave/ledger.ts) shared with Home, Today,
    // the approver's card, the HR Requests screen and the stored table. It
    // derives `used` from every APPROVED request in the FY — not from `apps`
    // above, which is the recent strip capped at 10 rows.
    ledgerFor(me),
    lwpType(),
  ])
  // Keep leave_balances in step with what this screen shows. After the
  // response: the employee is not made to wait on a write they did not ask for.
  later(() => syncBalancesQuietly([me]))

  const weeklyOffs = ((offRows || []) as { off_date: string }[]).map(r => String(r.off_date)).sort()
  // The weekdays those dates land on, so the client can shade a month outside
  // the window without a second call. Derived from the resolver, never assumed:
  // a branch configured Fri+Sat, or an NTH rule, shows up here correctly.
  const weeklyOffWeekdays = [...new Set(weeklyOffs.map((d: string) => new Date(d + 'T00:00:00Z').getUTCDay()))].sort()

  // How far back this employee may apply, set by HR per company (migration
  // 132). Resolved through the function rather than read from the table, so
  // this and the POST guard below answer the identical question — a UI that
  // offers a date the server then refuses is worse than no backdating at all.
  // 0 (the default, and the answer when the migration has not run) reproduces
  // exactly the old behaviour: nothing before today.
  let backdateDays = 0
  if (emp?.company_id) {
    const { data: win } = await sb.rpc('resolve_backdate_window', { p_company_id: emp.company_id })
    backdateDays = Number(win) || 0
  }

  // Annotate each type with whether THIS employee may take it, and why not.
  // The old dropdown offered all ten to all 398 — including Maternity Leave to
  // everybody — because it filtered on nothing but is_active and HR_MARK.
  const gender = normGender(emp?.gender)
  const doj = emp?.company_doj || emp?.group_doj || null
  const onProbation = String(emp?.confirmation_status || '') === 'Probation'
  const today = new Date()

  const annotated = (types || []).map((t: any) => {
    const reasons: string[] = []
    // A gendered type (ML is 'F', PL is 'M') needs a POSITIVE match.
    //
    // This read `t.gender !== 'ANY' && gender && t.gender !== gender`. When the
    // employee had no gender on file, normGender() returned null and that middle
    // clause short-circuited, skipping the check altogether — so all 5 active
    // employees whose gender column is NULL were offered BOTH Maternity and
    // Paternity leave. That was a deliberate "don't punish an HR data gap"
    // choice on my part, and it was the wrong call: for a statutory gendered
    // entitlement, defaulting to "allow" is the unsafe direction.
    //
    // Blocking also surfaces the missing record instead of hiding it.
    if (t.gender !== 'ANY' && t.gender !== gender) {
      reasons.push(gender ? 'Not available for your gender' : 'Your gender is not on file. Ask HR to update it')
    }
    // Probation does NOT block every leave type.
    //
    // This previously read `onProbation && !t.probation_eligible`, which looked
    // correct but locked 171 of 398 active employees (43%) out of applying for
    // ANY leave at all. Migration 030's seed never lists probation_eligible in
    // its INSERT, so all 11 types inherit the column default of FALSE — the flag
    // has never been populated, it just defaulted. The component this route
    // replaced had no probation check whatsoever, so this was a regression.
    //
    // Only the EXPLICIT rule stands: a type that declares eligible_from =
    // 'AFTER_PROBATION' is unavailable until confirmation. No live type does.
    // Once HR actually sets probation_eligible per type, the stricter gate can
    // come back. The script that sets those flags (leave-probation-eligibility.sql)
    // is handed over separately and is deliberately NOT in this repo and NOT
    // applied: which leave types are available during probation is an HR policy
    // decision, not a default. Restoring the gate against today's all-FALSE data
    // would lock out 171 of 398 active employees again.
    if (onProbation && t.eligible_from === 'AFTER_PROBATION') reasons.push('Available after confirmation')
    if (t.eligible_from === 'AFTER_DAYS' && doj) {
      const eligibleOn = new Date(new Date(doj + 'T00:00:00Z').getTime() + Number(t.min_tenure_days || 0) * 86400000)
      if (eligibleOn > today) reasons.push(`Available from ${fmtDate(iso(eligibleOn))}`)
    }
    // From the shared ledger (lib/leave/policy.ts explains the four policies).
    const b = ledger?.byType.get(t.id)
    // A type with no quota and nothing loaded cannot be taken at all. Saying so
    // here beats a form that accepts the dates and then refuses them.
    if (b && b.policy === 'ACCRUAL' && b.quota <= 0 && b.opening <= 0 && (b.available ?? 0) <= 0) {
      reasons.push('No entitlement set up yet — ask HR')
    }
    return {
      id: t.id, short_name: t.short_name, name: t.name,
      application_mode: t.application_mode,
      allow_half_day: !!t.allow_half_day,          // ← the client no longer hardcodes this
      allow_without_balance: !!t.allow_without_balance,
      approval_by: t.approval_by,
      // Earned and not taken. null for types that are not balance-tracked (LWP,
      // Sabbatical, Comp Off). Per-occurrence types (Maternity, Paternity) give
      // the entitlement for one occurrence.
      available: b ? b.available : null,
      // What a NEW request may use: available minus what is already pending.
      bookable: b ? b.bookable : null,
      pending: b ? b.pending : 0,
      policy: b ? b.policy : null,
      eligible: reasons.length === 0,
      reason: reasons[0] || null,
    }
  })

  // Who each request is waiting on, by name — the employee used to see only
  // "PENDING" (or "stage L1") and had to guess who to chase.
  const waitIds = (apps || []).flatMap((a: any) => [
    a.status === 'PENDING' ? a.current_approver_id : null,
    a.cancel_status === 'REQUESTED' ? a.cancel_approver_id : null,
  ]).filter(Boolean) as string[]
  const people = await contacts(waitIds)
  const who = (id: string | null) => {
    const c = id ? people.get(id) : null
    return c ? { id: c.id, name: c.name, role: approverRole(emp, c.id) } : null
  }
  const applications = (apps || []).map((a: any) => ({
    ...a,
    waiting_on: a.status === 'PENDING' ? who(a.current_approver_id) : null,
    cancel_waiting_on: a.cancel_status === 'REQUESTED' ? who(a.cancel_approver_id) : null,
  }))

  // The balance cards: headline types (EL, CL, SL …), in the stored-row shape
  // the web hero and the mobile app already read, filled from the ledger.
  const balances = (ledger?.headline || []).map(b => ({
    leave_type_id: b.leave_type_id, year: ledger?.year,
    opening: b.opening, accrued: b.accrued, used: b.used, encashed: b.encashed,
    pending: b.pending, available: b.available, bookable: b.bookable,
    leave_types: { short_name: b.short_name, name: b.name },
  }))

  return NextResponse.json({
    year,
    fyLabel: ledger?.fyLabel || leaveFyLabel(year),
    balances,
    balance_total: ledger?.headlineTotal ?? 0,
    types: annotated,
    applications,
    // The type an over-balance request's extra days can go to.
    lwp_type: lwp,
    holidays: hols || [],
    // The employee's own configured weekly offs, for the calendar. The tab used
    // to hardcode Sunday, which was right only because the single live rule is a
    // global "weekday 0 / EVERY" row — it would have shaded the wrong days the
    // moment a branch was configured differently.
    weekly_offs: weeklyOffs,
    weekly_off_weekdays: weeklyOffWeekdays,
    // The calendar's earliest selectable day is computed from this. Sent rather
    // than assumed client-side, because the same number gates the POST.
    backdate_days: backdateDays,
    // Surfaced so the tab can say WHY a card is empty instead of implying the
    // employee simply has nothing — the two are indistinguishable today.
    diagnostics: {
      noBalances: !balances.length,
      noHolidays: !(hols || []).length,
      noApprover: !emp?.l1_manager_id && !emp?.hr_manager_id,
      // True when no weekly-off rule matches this employee at all. Distinct
      // from "no holidays": one means HR has published no calendar, the other
      // means every day of the week is a working day for them.
      noWeeklyOffs: !weeklyOffs.length,
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — apply
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  // Applying for leave while viewing somebody else's portal would file it in
  // THEIR name. Approvals already refuses this; so does Leave now.
  // Two situations, one message — see the note in app/api/ess/mrf/route.ts.
  // actorEmployeeId null means no employee record behind the session (a lapsed
  // ESS token included), not impersonation.
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so there is nobody to apply on behalf of. '
        + 'Sign in again with your own ESS account.'
      : 'Leave is applied for in your own name, so it cannot be submitted while you '
        + 'are viewing somebody else\'s portal. Open your own portal to apply.')
  }

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

  // ── 1. Shape ────────────────────────────────────────────────────────────
  const typeId = String(body.leave_type_id || '')
  const from = parseDay(body.from_date)
  const to = parseDay(body.to_date)
  const halfDay = body.half_day === true
  const halfSession = body.half_session === '1st' || body.half_session === '2nd' ? body.half_session : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

  if (!typeId) return bad('Select a leave type.')
  if (!from || !to) return bad('Select valid from and to dates.')
  // The old client floored a reversed range to 1 day with Math.max(1, …), so
  // "to before from" was silently accepted as a one-day leave.
  if (daysBetween(from, to) < 0) return bad('The "to" date cannot be before the "from" date.')

  // ── 2. The type, and whether it is applyable at all ─────────────────────
  const { data: type } = await sb.from('leave_types').select('*').eq('id', typeId).maybeSingle()
  if (!type) return bad('That leave type no longer exists.', 404)
  if (!type.is_active) return bad('That leave type is no longer active.')
  if (type.application_mode === 'HR_MARK') return forbidden('That leave type is marked by HR, not applied for.')

  // ── 3. Half day ─────────────────────────────────────────────────────────
  // Was a hardcoded array ['EL','CL','SL','LWP','CP'] in the component that
  // happened to agree with the data. It now comes from the type's own flag.
  if (halfDay) {
    if (!type.allow_half_day) return bad(`${type.short_name} cannot be taken as a half day.`)
    if (!halfSession) return bad('Choose 1st half or 2nd half.')
    if (daysBetween(from, to) !== 0) return bad('A half day must start and end on the same date.')
  }

  // ── 4. The employee, and the eligibility rules that were never enforced ──
  const { data: emp } = await sb.from('employees')
    .select('full_name, emp_code, gender, company_doj, group_doj, company_id, confirmation_status, l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id')
    .eq('id', me).maybeSingle()
  if (!emp) return bad('Employee record not found.', 404)

  const gender = normGender(emp.gender)
  // Positive match required — see the long note in GET. The `&& gender &&` that
  // stood here skipped the check entirely for anyone with no gender recorded, so
  // Maternity leave could be filed for them by the UI (which reads the same
  // annotation) or by a crafted POST.
  if (type.gender !== 'ANY' && type.gender !== gender) {
    return forbidden(gender
      ? `${type.name} is not available for your gender record.`
      : `${type.name} requires your gender on file. Please ask HR to update your record.`)
  }

  // Probation is NOT a blanket bar — see the long note in GET.
  //
  // A gate stood here reading `onProbation && !type.probation_eligible`. Because
  // migration 030's seed never lists probation_eligible, all 11 live types sit
  // at the column default of FALSE, so that one line refused every leave type
  // for every probationer — 171 of 398 active employees. `onProbation` is kept:
  // it still feeds the explicit AFTER_PROBATION rule directly below, which is
  // the only probation rule any leave type actually declares.
  const onProbation = String(emp.confirmation_status || '') === 'Probation'

  const doj = emp.company_doj || emp.group_doj || null
  if (type.eligible_from === 'AFTER_PROBATION' && onProbation) {
    return forbidden(`${type.name} is available only after confirmation.`)
  }
  if (type.eligible_from === 'AFTER_DAYS' && doj) {
    const eligibleOn = new Date(new Date(doj + 'T00:00:00Z').getTime() + Number(type.min_tenure_days || 0) * 86400000)
    if (from < eligibleOn) return forbidden(`${type.name} is available from ${fmtDate(iso(eligibleOn))}.`)
  }
  if (type.eligible_from === 'ON_DOJ' && doj && from < new Date(doj + 'T00:00:00Z')) {
    return bad('That date is before your joining date.')
  }

  // ── 4b. Backdating, within the window HR configured ─────────────────────
  //
  // THE GUARD THE CLIENT COMMENT PROMISED AND NOBODY WROTE. Until now there was
  // no past-date check here at all: the calendar refused past dates, so nothing
  // server-side did, and a hand-crafted POST could file leave for any date back
  // to the employee's joining. Now that the calendar deliberately offers past
  // dates, that hole would be reachable from the UI itself.
  //
  // Counted back from today INCLUSIVE, matching what the calendar offers: a
  // window of 30 means today and the previous 29 days. 0 refuses every past
  // date, which is the default and the old behaviour.
  {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    if (from < startOfToday) {
      const { data: win } = await sb.rpc('resolve_backdate_window', { p_company_id: emp.company_id })
      const days = Number(win) || 0
      const earliest = new Date(startOfToday.getTime() - Math.max(0, days - 1) * 86400000)
      if (days <= 0) {
        return bad('Leave cannot be applied for a past date. Ask HR if you need to claim an absence.')
      }
      if (from < earliest) {
        return bad(`Leave can only be backdated ${days} day${days === 1 ? '' : 's'}. The earliest you can claim is ${fmtDate(iso(earliest))}.`)
      }
    }
  }

  // ── 5. Overlap with an existing request ─────────────────────────────────
  // Two requests covering the same day used to be perfectly acceptable.
  const { data: clashes } = await sb.from('leave_applications')
    .select('id, from_date, to_date, status')
    .eq('employee_id', me).in('status', ['PENDING', 'APPROVED'])
    .lte('from_date', iso(to)).gte('to_date', iso(from))
  if (clashes?.length) {
    const c = clashes[0]
    return bad(`This overlaps a ${String(c.status).toLowerCase()} request for ${fmtDate(c.from_date)}${c.to_date !== c.from_date ? ' – ' + fmtDate(c.to_date) : ''}.`, 409)
  }

  // ── 6. Lifetime cap (ML and PL are configured at 2) ─────────────────────
  if (type.max_times_in_tenure != null) {
    const { count } = await sb.from('leave_applications')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', me).eq('leave_type_id', typeId).in('status', ['PENDING', 'APPROVED'])
    if ((count || 0) >= Number(type.max_times_in_tenure)) {
      return forbidden(`${type.name} may be taken ${type.max_times_in_tenure} time(s) in your tenure.`)
    }
  }

  // ── 7. Days — working days, and the days that may not be claimed ────────
  //
  // Holidays and weekly offs are the company's own configuration, so a leave
  // request may SPAN them (a Friday-to-Monday absence legitimately covers the
  // weekend) but may not BEGIN or END on one. That is the whole rule: an
  // employee cannot claim as leave a day the company has already given them.
  const { map: nonWorking, failed } = await nonWorkingDays(me, from, to)

  // A resolver that cannot be read must not be treated as "no holidays" — that
  // silently over-charges the employee. Refuse and say so.
  if (failed) {
    return bad('The holiday and weekly-off calendar could not be read just now, so this request cannot be counted correctly. Please try again in a moment.', 503)
  }

  const startsOn = nonWorking.get(iso(from))
  if (startsOn) {
    return bad(`${fmtDate(iso(from))} is ${startsOn.label}, so leave cannot start on it.${halfDay ? '' : ' Pick the next working day.'}`)
  }
  // A half day always has from === to, so the check above already covers it —
  // which is the hole this closes. `days` used to be forced to 0.5 BEFORE the
  // emptiness guard, so a half day on a Sunday or on Diwali passed every check
  // and was filed and billed at 0.5.
  const endsOn = nonWorking.get(iso(to))
  if (endsOn) {
    return bad(`${fmtDate(iso(to))} is ${endsOn.label}, so leave cannot end on it. Pick the previous working day.`)
  }

  const offs = eachDay(from, to).filter(d => nonWorking.has(d))
  const wd = daysBetween(from, to) + 1 - offs.length
  const days = halfDay ? 0.5 : wd
  if (days <= 0) return bad('That range contains only weekly-offs and holidays.')

  // ── 8. Balance — enforced ───────────────────────────────────────────────
  //
  // This used to bind only when a leave_balances row existed, and none ever
  // did, so an 11-day Casual Leave request on a 3.5-day balance went straight
  // through. The balance now comes from the same ledger the Leave tab shows,
  // and what is already PENDING counts against it (two 3-day requests on a
  // 4-day balance must not both reach an approver).
  //
  // The usual HRMS behaviour for an over-balance request is to refuse it and
  // offer the rest as Leave Without Pay. That is what happens here: the refusal
  // carries `can_split`, and the form offers "apply X days as CL and Y as LWP",
  // which re-posts with split_with_lwp — two requests, same dates, same reason.
  //
  // A request in a FUTURE financial year is checked against that year, as of
  // its own start date: next April's leave is paid out of next April's accrual.
  const sameFy = leaveYearOf(from) === leaveYearOf()
  const ledger = await ledgerFor(me, sameFy ? undefined : from)
  const bal = ledger?.byType.get(typeId)
  const workingDays = eachDay(from, to).filter(d => !nonWorking.has(d))
  let split: ReturnType<typeof splitWithLwp> | null = null
  if (bal) {
    const check = checkRequest(bal, days)
    if (!check.ok) {
      const lwp = await lwpType()
      // A split is offered for full-day ranges on accrual types, when there is
      // an LWP type to put the rest on. Per-occurrence and zero-quota types say
      // what is wrong instead: the remedy there is HR, not unpaid leave.
      const canSplit = !!lwp && !halfDay && bal.policy === 'ACCRUAL' && !(bal.quota <= 0 && bal.opening <= 0)
      if (body.split_with_lwp === true && canSplit) {
        split = splitWithLwp(workingDays, check.bookable)
      } else {
        const paid = Math.floor(check.bookable)
        return NextResponse.json({
          error: check.reason,
          bookable: check.bookable, available: check.available, pending: check.pending,
          can_split: canSplit,
          split_preview: canSplit ? { paid_days: Math.min(paid, workingDays.length), lwp_days: workingDays.length - Math.min(paid, workingDays.length), lwp_type: lwp?.name } : null,
        }, { status: 409 })
      }
    }
  }

  // ── 9. Insert. employee_id is the SESSION's, never the body's ───────────
  const lwp = split ? await lwpType() : null
  const parts: { typeId: string; typeName: string; shortName: string; from: string; to: string; days: number }[] = split
    ? [
        ...(split.paid ? [{ typeId, typeName: type.name, shortName: type.short_name, ...split.paid }] : []),
        ...(split.lwp && lwp ? [{ typeId: lwp.id, typeName: lwp.name, shortName: lwp.short_name, ...split.lwp }] : []),
      ]
    : [{ typeId, typeName: type.name, shortName: type.short_name, from: iso(from), to: iso(to), days }]

  const inserted: { id: string; approver: string | null; part: (typeof parts)[number] }[] = []
  for (const part of parts) {
    const payload: Record<string, unknown> = {
      employee_id: me,                      // ← the whole point of this route
      leave_type_id: part.typeId,
      from_date: part.from, to_date: part.to,
      days: part.days, half_day: halfDay, reason: reason || null,
      status: 'PENDING',
    }
    if (halfSession) payload.half_session = halfSession

    let ins = await sb.from('leave_applications').insert(payload).select('id, current_approver_id').maybeSingle()
    // Kept from the old data layer: half_session exists live but in no migration,
    // so a database that matches the repo would reject it. Migration 121 captures
    // the drift; this fallback covers anything not yet migrated.
    if (ins.error && /half_session/i.test(ins.error.message || '')) {
      delete payload.half_session
      ins = await sb.from('leave_applications').insert(payload).select('id, current_approver_id').maybeSingle()
    }
    if (ins.error) {
      // Half of a split filed and the other half refused would leave the
      // employee with a request they did not ask for. Take the first one back.
      if (inserted.length) await sb.from('leave_applications').delete().in('id', inserted.map(x => x.id))
      return NextResponse.json({ error: ins.error.message }, { status: 500 })
    }
    inserted.push({ id: ins.data?.id, approver: ins.data?.current_approver_id || null, part })
  }

  // ── 10. Tell the approver — and the employee who it went to ─────────────
  const scope = await employeeScope(me)
  const approverIds = inserted.map(x => x.approver).filter(Boolean) as string[]
  const people = await contacts(approverIds)
  for (const x of inserted) {
    if (!x.approver) continue
    const approverName = people.get(x.approver)?.name || ''
    const role = approverRole(emp, x.approver)
    // Words: Configuration → Leave & attendance, for the applicant's company / branch.
    await deliver({
      to: x.approver, scope,
      bell: { key: 'notify.leave.awaiting', link: '/ess?tab=approvals', vars: {
        employee_name: emp.full_name, days: x.part.days, leave_type: x.part.typeName, from_date: fmtDate(x.part.from),
      } },
      mail: { key: 'leave.request.approver', vars: {
        approver_name: approverName, employee_name: emp.full_name, emp_code: emp.emp_code || '',
        days_label: daysLabel(x.part.days), leave_type: x.part.typeName, dates: fmtRange(x.part.from, x.part.to),
        reason: reason || '', balance_line: x.part.typeId === typeId ? balanceLine(bal, x.part.days) : '',
        portal_url: portalUrl('approvals'),
      } },
    })
    await deliver({
      to: me, scope,
      bell: { key: 'notify.leave.submitted', link: '/ess?tab=leave', vars: {
        days_label: daysLabel(x.part.days), leave_type: x.part.typeName, from_date: fmtDate(x.part.from),
        approver_name: approverName, approver_role: role,
      } },
    })
  }
  const first = inserted[0]
  await audit(ctx.caller, 'LEAVE_APPLIED', me, {
    leave_id: first?.id, type: type.short_name, days, unrouted: !first?.approver,
    split: split ? inserted.map(x => ({ id: x.id, type: x.part.shortName, days: x.part.days })) : undefined,
  })

  const approverId = first?.approver || null
  return NextResponse.json({
    ok: true, id: first?.id, days, excluded: offs,
    // An application with no approver reaches nobody's queue and produces no
    // notification for anyone — which is how the live PENDING request stayed
    // invisible. The employee is told rather than left waiting on silence.
    unrouted: !approverId,
    // Named, so the confirmation can say "sent to Shreya Reddy (HR manager)".
    waiting_on: approverId ? { id: approverId, name: people.get(approverId)?.name || '', role: approverRole(emp, approverId) } : null,
    split: split ? inserted.map(x => ({ id: x.id, leave_type: x.part.shortName, from_date: x.part.from, to_date: x.part.to, days: x.part.days })) : null,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — withdraw your own pending request, or ask to cancel an approved one
//
//   { id }                              PENDING  → CANCELLED, straight away
//   { id, action: 'cancel', reason }    APPROVED → cancellation request, which
//                                       the approver confirms (days come back
//                                       only then). Future-dated leave only.
// ═══════════════════════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active. Sign in again with your own ESS account to cancel this.'
      : 'A cancellation is recorded under your own name, so it cannot be done while you '
        + 'are viewing somebody else\'s portal. Open your own portal to cancel.')
  }

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (body.action === 'cancel') {
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    const out = await requestLeaveCancel(id, me, reason)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    await audit(ctx.caller, 'LEAVE_CANCEL_REQUESTED', me, { leave_id: id, reason: reason || null })
    return NextResponse.json(out)
  }

  const { data: app } = await sb.from('leave_applications')
    .select('id, employee_id, status, from_date, to_date, days, current_approver_id')
    .eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 })
  if (app.employee_id !== me) return forbidden('That is not your leave request.')
  if (app.status === 'APPROVED') return NextResponse.json({ error: 'This leave is already approved — request a cancellation instead.' }, { status: 409 })
  if (app.status !== 'PENDING') return NextResponse.json({ error: `Already ${String(app.status).toLowerCase()}.` }, { status: 409 })

  const { error } = await sb.from('leave_applications')
    .update({ status: 'CANCELLED', resolved_at: new Date().toISOString() }).eq('id', id).eq('status', 'PENDING')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The approver is told, so a request does not simply vanish from their queue.
  if (app.current_approver_id) {
    await notifyFromTemplate(app.current_approver_id, 'notify.leave.withdrawn',
      { from_date: fmtDate(app.from_date) }, { scope: await employeeScope(me), link: '/ess?tab=approvals' })
  }
  await audit(ctx.caller, 'LEAVE_CANCELLED', me, { leave_id: id })
  return NextResponse.json({ ok: true, status: 'CANCELLED' })
}
