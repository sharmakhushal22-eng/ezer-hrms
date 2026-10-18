// app/api/ess/attendance/route.ts — the ESS Attendance API.
//
// WHY THIS ROUTE EXISTS
//
// Attendance was the largest hole in the ESS surface. Four tables —
// attendance_records, attendance_punches, employee_shift_assignment and
// attendance_regularisation — had no endpoint at all, so both clients read
// them straight from the browser and the phone on the anon key, and each
// worked out on its own which mark a day carries.
//
// That is two implementations of one rule, on the most-opened screen in either
// client. Leave already showed where that ends: the same Friday-to-Monday
// request counted 4 days on the phone and 2 on the web, because each side did
// its own arithmetic. The day's mark is decided HERE so that nobody decides it
// twice.
//
// GET  → the whole Attendance screen in one round trip (was four reads).
// POST → file a regularisation, validated server-side, routed to an approver.
// PATCH → withdraw a pending one.
//
// Shaped after app/api/ess/leave/route.ts: one GET for the screen, the server
// annotates and the client renders, diagnostics so an empty grid can say why,
// identity from the session and never from the request.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit } from '@/lib/ess/session'
import { fileRegularisation, withdrawRegularisation } from '@/lib/leave/workflow'
import { approverRole } from '@/lib/leave/policy'
import { contacts } from '@/lib/leave/notify'
import { punchState } from '@/lib/attendance/punch'

export const dynamic = 'force-dynamic'

// ── The rows this route reads, named rather than inferred ──────────────────
interface AttRow {
  attendance_date: string
  work_in: string | null
  work_out: string | null
  total_minutes: number | null
  late_minutes: number | null
  overtime_minutes: number | null
  status: string | null
  lop_applicable: boolean | null
  punch_count: number | null
  source: string | null
  regularized_at: string | null
}
interface HolidayRow {
  holiday_date: string
  description: string | null
  holiday_type: string | null
  is_optional: boolean | null
}
interface OffRow { off_date: string }
interface LeaveRow {
  from_date: string
  to_date: string
  half_day: boolean | null
  leave_types: { short_name: string | null; name: string | null } | null
}
interface PunchRow {
  punch_time: string
  punch_type: string
  source: string | null
  geofence_status: string | null
}
interface ShiftRow {
  shift_code: string | null
  shift_type: string | null
  in_time: string | null
  out_time: string | null
  late_allowed_till: string | null
  max_late_punch: string | null
  lunch_duration_mins: number | null
  overtime_applicable: boolean | null
}
interface AssignmentRow {
  overtime_applicable: boolean | null
  shift_master: ShiftRow | ShiftRow[] | null
}

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : [])

/** The IST calendar date, which is what attendance_date holds. */
const istToday = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Every date from `from` to `to`, inclusive, as ISO days. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** ISO weekday, 1 = Monday … 7 = Sunday, for a plain date string. */
const isoWeekday = (d: string): number => ((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1

type Mark = 'PRESENT' | 'LATE' | 'MISSING' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING'

/**
 * What a day IS, finely — for the web calendar, the attendance list and the
 * regularisation picker. `mark` (below) is the coarse eight-value answer the
 * mobile app already understands and is kept unchanged for it.
 *
 *   PRESENT      both punches, on time
 *   LATE         both punches, first one after the shift start
 *   HALF_DAY     process_daily_attendance() marked it (first IN after the
 *                shift's last allowed punch)
 *   MISS_OUT     an IN and no OUT, on a day that is over
 *   MISS_IN      an OUT and no IN
 *   IN_PROGRESS  today, punched in, not out yet — not an exception at lunchtime
 *   ABSENT       a past working day with nothing recorded
 *   LEAVE        approved full-day leave
 *   HALF_LEAVE   approved half-day leave (the other half is still a working half)
 *   HOLIDAY / WEEKLY_OFF / UPCOMING
 */
type Kind =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'MISS_IN' | 'MISS_OUT' | 'IN_PROGRESS' | 'ABSENT'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING'

/**
 * The precedence, in one place: holiday, then weekly off, then approved leave,
 * then whatever the record says. A half-day leave yields to the record when
 * there is one — the worked half is what needs looking at.
 */
function kindFor(
  date: string, today: string, rec: AttRow | undefined,
  holiday: boolean, off: boolean, leave: LeaveDay | undefined,
): Kind {
  if (holiday) return 'HOLIDAY'
  if (off) return 'WEEKLY_OFF'
  if (leave && !leave.half_day) return 'LEAVE'
  const hasIn = !!rec?.work_in, hasOut = !!rec?.work_out
  if (hasIn || hasOut) {
    if (date === today && hasIn && !hasOut) return 'IN_PROGRESS'
    if (!hasIn) return 'MISS_IN'
    if (!hasOut) return 'MISS_OUT'
    if (String(rec?.status || '').toUpperCase() === 'HALF_DAY') return 'HALF_DAY'
    return Number(rec?.late_minutes || 0) > 0 ? 'LATE' : 'PRESENT'
  }
  if (leave) return 'HALF_LEAVE'
  return date >= today ? 'UPCOMING' : 'ABSENT'
}

/** The coarse mark, from the fine kind — what the mobile app reads. */
const MARK_OF: Record<Kind, Mark> = {
  PRESENT: 'PRESENT', LATE: 'LATE', HALF_DAY: 'LATE', MISS_IN: 'MISSING', MISS_OUT: 'MISSING',
  IN_PROGRESS: 'PRESENT', ABSENT: 'ABSENT', LEAVE: 'LEAVE', HALF_LEAVE: 'LEAVE',
  HOLIDAY: 'HOLIDAY', WEEKLY_OFF: 'WEEKLY_OFF', UPCOMING: 'UPCOMING',
}

interface LeaveDay { short_name: string; name: string; half_day: boolean; half_session: string | null }

interface ShiftOn {
  code: string | null; name: string | null; start: string | null; end: string | null
  grace_until: string | null; last_punch: string | null; break_minutes: number | null; overtime: boolean
}

/** Every active assignment, so each day gets the shift that was in force on it. */
async function shiftsFor(employeeId: string): Promise<{ from: string; till: string | null; shift: ShiftOn }[]> {
  const { data } = await sb.from('employee_shift_assignment')
    .select('effective_from, effective_till, overtime_applicable, shift_master(shift_code, shift_type, in_time, out_time, late_allowed_till, max_late_punch, lunch_duration_mins, overtime_applicable)')
    .eq('employee_id', employeeId).eq('is_active', true)
    .order('effective_from', { ascending: false })
  const out: { from: string; till: string | null; shift: ShiftOn }[] = []
  for (const row of (data || []) as (AssignmentRow & { effective_from: string; effective_till: string | null })[]) {
    const m = Array.isArray(row.shift_master) ? row.shift_master[0] : row.shift_master
    if (!m) continue
    out.push({
      from: row.effective_from, till: row.effective_till,
      shift: {
        code: m.shift_code, name: m.shift_type, start: m.in_time, end: m.out_time,
        grace_until: m.late_allowed_till, last_punch: m.max_late_punch,
        break_minutes: m.lunch_duration_mins, overtime: !!(row.overtime_applicable ?? m.overtime_applicable),
      },
    })
  }
  return out
}
const shiftOn = (list: Awaited<ReturnType<typeof shiftsFor>>, date: string): ShiftOn | null =>
  list.find(a => a.from <= date && (!a.till || a.till >= date))?.shift ?? null

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null)
const MAX_RANGE_DAYS = 62

// ═══════════════════════════════════════════════════════════════════════════
// GET — a month (?month=YYYY-MM) or a range (?from=&to=, up to 62 days)
//
// One call gives the calendar and the attendance list everything: each day's
// kind, punches, expected shift times, leave, holiday, and the correction
// already filed for it (with who it is waiting on). The calendar and the list
// both render from this, so a day cannot read one way on one and another way
// on the other.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const today = istToday()
  const sp = req.nextUrl.searchParams

  let from: string, to: string, month: string
  const qFrom = sp.get('from'), qTo = sp.get('to')
  if (isDay(qFrom) && isDay(qTo)) {
    if (qTo < qFrom) return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 })
    if (eachDay(qFrom, qTo).length > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Pick at most ${MAX_RANGE_DAYS} days at a time.` }, { status: 400 })
    }
    from = qFrom; to = qTo; month = qFrom.slice(0, 7)
  } else {
    const asked = sp.get('month') || ''
    month = /^\d{4}-\d{2}$/.test(asked) ? asked : today.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    from = `${month}-01`
    to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }

  // A single day's raw punches, for the "fix a day" flow. Only when asked for:
  // a month of punch rows is not a month-grid payload.
  const askedDay = sp.get('date')
  const wantDay = isDay(askedDay) ? askedDay : null

  const [recR, holR, offR, lvR, regR, regRangeR, shifts, punchR, mgrR, live] = await Promise.all([
    sb.from('attendance_records')
      .select('attendance_date, work_in, work_out, total_minutes, late_minutes, overtime_minutes, status, lop_applicable, punch_count, source, regularized_at')
      .eq('employee_id', me).gte('attendance_date', from).lte('attendance_date', to),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: me, p_from: from, p_to: to }),
    sb.from('leave_applications')
      .select('from_date, to_date, half_day, half_session, leave_types(short_name, name)')
      .eq('employee_id', me).eq('status', 'APPROVED').lte('from_date', to).gte('to_date', from),
    // The employee's recent corrections, for "My requests".
    sb.from('attendance_regularisation')
      .select('*')
      .eq('employee_id', me).order('created_at', { ascending: false }).limit(30),
    // And every correction inside the range, so each day can say where it stands.
    sb.from('attendance_regularisation')
      .select('*')
      .eq('employee_id', me).gte('attendance_date', from).lte('attendance_date', to)
      .neq('status', 'CANCELLED'),
    shiftsFor(me),
    wantDay
      ? sb.from('attendance_punches')
          .select('punch_time, punch_type, source, geofence_status')
          .eq('employee_id', me).eq('punch_date', wantDay).order('punch_time', { ascending: true })
      : Promise.resolve({ data: [] }),
    sb.from('employees').select('l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id').eq('id', me).maybeSingle(),
    // Today, from the punches: somebody who punched out and back in is at work
    // now, although the record already carries the earlier OUT.
    today >= from && today <= to ? punchState(me, today) : Promise.resolve(null),
  ])

  const recs = new Map<string, AttRow>()
  for (const x of rows<AttRow>(recR.data)) recs.set(x.attendance_date, x)

  // resolve_holidays returns the whole calendar; only this range's matter here.
  const allHolidays = rows<HolidayRow>(holR.data)
  const holidays = allHolidays.filter(h => h.holiday_date >= from && h.holiday_date <= to)
  // Every holiday on the calendar takes the day, optional ones included — the
  // same rule leave uses (app/api/ess/leave/route.ts §7), so a date never reads
  // as a holiday on one screen and a working day on the other.
  const holidayBy = new Map<string, HolidayRow>()
  for (const h of holidays) holidayBy.set(h.holiday_date, h)

  const offs = new Set<string>(rows<OffRow>(offR.data).map(w => w.off_date))

  const leaveBy = new Map<string, LeaveDay>()
  for (const l of rows<LeaveRow & { half_session?: string | null }>(lvR.data)) {
    const info: LeaveDay = {
      short_name: l.leave_types?.short_name || 'LV', name: l.leave_types?.name || l.leave_types?.short_name || 'Leave',
      half_day: !!l.half_day, half_session: l.half_session ?? null,
    }
    for (const d of eachDay(l.from_date, l.to_date)) {
      if (d >= from && d <= to) leaveBy.set(d, info)
    }
  }

  // Each correction says who it is waiting on, or who decided it — by name.
  const mgr = mgrR.data
  const regAll = [...((regR.data ?? []) as Record<string, any>[]), ...((regRangeR.data ?? []) as Record<string, any>[])]
  const people = await contacts(regAll.map(x => x.current_approver_id).filter(Boolean))
  const named = (x: Record<string, any>): Record<string, any> => {
    const c = x.status === 'PENDING' && x.current_approver_id ? people.get(x.current_approver_id) : null
    return {
      ...x,
      waiting_on: c ? { id: c.id, name: c.name, role: approverRole(mgr, c.id) } : null,
      decided_by: x.status === 'APPROVED' || x.status === 'REJECTED' ? (x.reviewed_by || null) : null,
    }
  }
  const regularisations = ((regR.data ?? []) as Record<string, any>[]).map(named)
  // The latest correction per day in the range (the table is unique per day,
  // so "latest" is the only one — CANCELLED ones are left out above).
  const correctionBy = new Map<string, Record<string, any>>()
  for (const x of ((regRangeR.data ?? []) as Record<string, any>[]).map(named)) correctionBy.set(x.attendance_date, x)

  const days = eachDay(from, to).map(date => {
    const rec = recs.get(date)
    const holiday = holidayBy.get(date)
    const leave = leaveBy.get(date)
    const shift = shiftOn(shifts, date)
    let kind = kindFor(date, today, rec, !!holiday, offs.has(date), leave)
    if (date === today && live?.open && kind !== 'HOLIDAY' && kind !== 'WEEKLY_OFF' && kind !== 'LEAVE') kind = 'IN_PROGRESS'
    const c = correctionBy.get(date)
    return {
      date,
      mark: MARK_OF[kind],
      kind,
      work_in: rec?.work_in ?? null,
      work_out: rec?.work_out ?? null,
      total_minutes: rec?.total_minutes ?? null,
      late_minutes: Number(rec?.late_minutes || 0),
      overtime_minutes: Number(rec?.overtime_minutes || 0),
      punch_count: Number(rec?.punch_count || 0),
      status: rec?.status ?? null,
      lop: !!rec?.lop_applicable,
      regularised: !!rec?.regularized_at,
      // What the mark is owed to: the holiday's name, or the leave type.
      note: holiday?.description ?? leave?.name ?? null,
      leave: leave ?? null,
      // The shift in force that day: what was expected.
      shift_code: shift?.code ?? null,
      expected_in: hhmm(shift?.start),
      expected_out: hhmm(shift?.end),
      correction: c ? {
        id: c.id, group: c.request_group ?? null, status: c.status,
        requested_in: hhmm(c.requested_in), requested_out: hhmm(c.requested_out),
        waiting_on: c.waiting_on, decided_by: c.decided_by, review_remark: c.review_remark ?? null,
      } : null,
    }
  })

  const pendingByDate = new Map<string, string | null>()
  for (const x of correctionBy.values()) if (x.status === 'PENDING') pendingByDate.set(x.attendance_date, x.waiting_on?.name ?? null)

  const count = (mk: Mark) => days.filter(d => d.mark === mk).length
  const kinds: Record<string, number> = {}
  for (const d of days) kinds[d.kind] = (kinds[d.kind] || 0) + 1
  const summary = {
    present: count('PRESENT') + count('LATE'),
    late: count('LATE'),
    missing: count('MISSING'),
    absent: count('ABSENT'),
    leave: count('LEAVE'),
    holiday: count('HOLIDAY'),
    weekly_off: count('WEEKLY_OFF'),
    upcoming: count('UPCOMING'),
    worked_minutes: days.reduce((s, d) => s + Number(d.total_minutes || 0), 0),
    // The fine counts, for the list's filter chips.
    by_kind: kinds,
  }
  const shift = shiftOn(shifts, today) ?? (shifts[0]?.shift ?? null)

  return NextResponse.json({
    month, from, to, today,
    days,
    day_punches: wantDay ? rows<PunchRow>((punchR as { data: unknown }).data) : undefined,
    shift,
    weekly_offs: [...offs].sort(),
    // The weekdays those dates fall on, so a client can label a week without
    // re-reading the config. Derived from the resolver, not from a constant.
    weekly_off_weekdays: [...new Set([...offs].map(isoWeekday))].sort(),
    holidays,
    regularisations,
    // Days with a correction waiting, and on whom — for the calendar's day panel.
    pending_corrections: Object.fromEntries(pendingByDate),
    summary,
    // So an empty grid can say WHY, instead of implying the employee simply
    // never came in.
    diagnostics: {
      noShift: !shift,
      noHolidayCalendar: !allHolidays.length,
      noRecords: !recs.size,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — file a regularisation (one day, a list, or a range)
//
// This used to save PENDING rows that reached nobody: there was no approver
// column, no queue and no notification, and the comment here said so. Since
// migration 138 every request is stamped to the reporting manager (HR when
// there is none, never the employee), appears in their Tasks & Approvals, is
// emailed to them, and on approval writes the corrected times into
// attendance_records. The logic lives in lib/leave/workflow.ts so the mobile
// app, the web portal and HR's screen all file and decide the same way.
//
// Past days only: today is still being worked. Weekly offs, holidays and days
// on approved leave are skipped and named in `skipped`.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  // See app/api/ess/mrf/route.ts for why these are two messages, not one.
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so there is no attendance record to regularise. '
        + 'Sign in again with your own ESS account.'
      : 'A regularisation is recorded under your own name, so it cannot be done while you '
        + 'are viewing somebody else\'s portal. Open your own portal to regularise.')
  }

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const out = await fileRegularisation(me, body)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })

  await audit(ctx.caller, 'ATTENDANCE_REGULARISED', me, { dates: out.dates, skipped: out.skipped, group: out.group })
  return NextResponse.json({
    ok: true,
    filed: out.filed,
    dates: out.dates,
    // Days left out, named, so the client can say so rather than silently
    // filing fewer than the employee picked.
    skipped: out.skipped,
    status: 'PENDING',
    group: out.group,
    waiting_on: out.waiting_on,
    unrouted: !out.waiting_on,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — withdraw a pending correction: { id } is one day or a whole group
// ═══════════════════════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('Attendance cannot be changed while viewing as somebody else.')
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  const out = await withdrawRegularisation(ctx.caller.employeeId, id)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  await audit(ctx.caller, 'ATTENDANCE_REGULARISATION_WITHDRAWN', ctx.caller.employeeId, { id })
  return NextResponse.json({ ok: true, status: 'CANCELLED' })
}
