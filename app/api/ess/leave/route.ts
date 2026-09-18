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
import { essRoute, forbidden, notify, audit, fmtDate } from '@/lib/ess/session'
import { leaveYearOf, leaveFyLabel } from '@/lib/ess/leave-year'

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

/** Available = (opening + accrued) − used − encashed. Same arithmetic as the card. */
const availOf = (b: any) =>
  (Number(b?.opening || 0) + Number(b?.accrued || 0)) - Number(b?.used || 0) - Number(b?.encashed || 0)

/**
 * Working days in a range: calendar days minus weekly-offs minus holidays.
 *
 * The old client counted calendar days, so a Friday-to-Monday request was
 * billed as 4. resolve_weekly_offs() has existed since migration 026 and was
 * never called from Leave. Verified live: it returns the four Sundays for
 * September 2026 from a single global `weekday 0 / EVERY` config row.
 *
 * Falls back to calendar days if either resolver errors — under-counting a
 * request is worse than over-counting it, but silently failing the whole
 * application because a holiday table is misconfigured is worse than both.
 */
async function workingDays(employeeId: string, from: Date, to: Date): Promise<{ days: number; offs: string[] }> {
  const all = eachDay(from, to)
  try {
    const [{ data: offRows }, { data: holRows }] = await Promise.all([
      sb.rpc('resolve_weekly_offs', { p_employee_id: employeeId, p_from: iso(from), p_to: iso(to) }),
      sb.rpc('resolve_holidays', { p_employee_id: employeeId }),
    ])
    const off = new Set<string>((offRows || []).map((r: any) => String(r.off_date)))
    // Optional holidays are the employee's to take or skip, so they still cost
    // a leave day. Only mandatory ones are excluded.
    for (const h of (holRows || []) as any[]) if (!h.is_optional) off.add(String(h.holiday_date))
    const working = all.filter(d => !off.has(d))
    return { days: working.length, offs: all.filter(d => off.has(d)) }
  } catch {
    return { days: all.length, offs: [] }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET — everything the tab renders, in one round trip
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const year = leaveYearOf()

  const [{ data: emp }, { data: balances }, { data: types }, { data: apps }, { data: hols }] = await Promise.all([
    sb.from('employees')
      .select('gender, company_doj, group_doj, confirmation_status, l1_manager_id, hr_manager_id')
      .eq('id', me).maybeSingle(),
    sb.from('leave_balances').select('*, leave_types(short_name, name)').eq('employee_id', me).eq('year', year),
    sb.from('leave_types').select('*').eq('is_active', true).neq('application_mode', 'HR_MARK').order('sort_order'),
    sb.from('leave_applications')
      .select('*, leave_types(short_name, name)')
      .eq('employee_id', me).order('applied_at', { ascending: false }).limit(10),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
  ])

  const balByType = new Map<string, any>()
  for (const b of balances || []) balByType.set(b.leave_type_id, b)

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
      reasons.push(gender ? 'Not available for your gender' : 'Your gender is not on file — ask HR to update it')
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
    const bal = balByType.get(t.id)
    return {
      id: t.id, short_name: t.short_name, name: t.name,
      application_mode: t.application_mode,
      allow_half_day: !!t.allow_half_day,          // ← the client no longer hardcodes this
      allow_without_balance: !!t.allow_without_balance,
      approval_by: t.approval_by,
      available: bal ? availOf(bal) : null,
      eligible: reasons.length === 0,
      reason: reasons[0] || null,
    }
  })

  return NextResponse.json({
    year,
    fyLabel: leaveFyLabel(year),
    balances: balances || [],
    types: annotated,
    applications: apps || [],
    holidays: hols || [],
    // Surfaced so the tab can say WHY a card is empty instead of implying the
    // employee simply has nothing — the two are indistinguishable today.
    diagnostics: {
      noBalances: !(balances || []).length,
      noHolidays: !(hols || []).length,
      noApprover: !emp?.l1_manager_id && !emp?.hr_manager_id,
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
  if (ctx.caller.viewAs) return forbidden('Leave cannot be applied for while viewing as somebody else.')

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
    .select('full_name, gender, company_doj, group_doj, confirmation_status, l1_manager_id, hr_manager_id')
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

  // ── 7. Days — working days, not calendar days ───────────────────────────
  const { days: wd, offs } = await workingDays(me, from, to)
  const days = halfDay ? 0.5 : wd
  if (days <= 0) return bad('That range contains only weekly-offs and holidays.')

  // ── 8. Balance ──────────────────────────────────────────────────────────
  // DELIBERATELY CONDITIONAL. leave_balances is empty for all 398 employees
  // (nobody has run the HR upload), so enforcing this unconditionally would
  // stop everyone from applying — turning the one part of Leave that works
  // into a total outage. It binds as soon as a balance row exists.
  if (!type.allow_without_balance) {
    const year = leaveYearOf(from)
    const { data: bal } = await sb.from('leave_balances')
      .select('opening, accrued, used, encashed')
      .eq('employee_id', me).eq('leave_type_id', typeId).eq('year', year).maybeSingle()
    if (bal) {
      const have = availOf(bal)
      if (days > have) return bad(`You have ${have} day(s) of ${type.short_name} left; this request is ${days}.`, 409)
    }
  }

  // ── 9. Insert. employee_id is the SESSION's, never the body's ───────────
  const payload: Record<string, unknown> = {
    employee_id: me,                      // ← the whole point of this route
    leave_type_id: typeId,
    from_date: iso(from), to_date: iso(to),
    days, half_day: halfDay, reason: reason || null,
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
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })

  // ── 10. Tell the approver the trigger picked ────────────────────────────
  const approver = ins.data?.current_approver_id || null
  if (approver) {
    await notify(approver, 'Leave request awaiting you',
      `${emp.full_name} has applied for ${days} day(s) of ${type.name} from ${fmtDate(iso(from))}.`,
      '/ess?tab=approvals')
  }
  await audit(ctx.caller, 'LEAVE_APPLIED', me, { leave_id: ins.data?.id, type: type.short_name, days, unrouted: !approver })

  return NextResponse.json({
    ok: true, id: ins.data?.id, days, excluded: offs,
    // An application with no approver reaches nobody's queue and produces no
    // notification for anyone — which is how the live PENDING request stayed
    // invisible. The employee is told rather than left waiting on silence.
    unrouted: !approver,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — cancel your own pending request
// ═══════════════════════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('Leave cannot be cancelled while viewing as somebody else.')

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: app } = await sb.from('leave_applications')
    .select('id, employee_id, status, from_date, to_date, days, current_approver_id')
    .eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 })
  if (app.employee_id !== me) return forbidden('That is not your leave request.')
  if (app.status !== 'PENDING') return NextResponse.json({ error: `Already ${String(app.status).toLowerCase()}.` }, { status: 409 })

  const { error } = await sb.from('leave_applications')
    .update({ status: 'CANCELLED', resolved_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The approver is told, so a request does not simply vanish from their queue.
  if (app.current_approver_id) {
    await notify(app.current_approver_id, 'Leave request withdrawn',
      `A leave request for ${fmtDate(app.from_date)} was cancelled by the employee.`, '/ess?tab=approvals')
  }
  await audit(ctx.caller, 'LEAVE_CANCELLED', me, { leave_id: id })
  return NextResponse.json({ ok: true, status: 'CANCELLED' })
}
