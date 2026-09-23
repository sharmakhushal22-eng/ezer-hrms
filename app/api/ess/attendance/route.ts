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
// POST → file a miss-punch regularisation, validated server-side.
//
// Shaped after app/api/ess/leave/route.ts: one GET for the screen, the server
// annotates and the client renders, diagnostics so an empty grid can say why,
// identity from the session and never from the request.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, fmtDate } from '@/lib/ess/session'

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
interface RegRow { attendance_date: string; status: string | null }
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
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

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
 * The precedence, in one place: holiday, then weekly off, then approved leave,
 * then whatever the record says.
 *
 * A present day short of either punch is a miss-punch — except today, which is
 * still in progress and must not be accused of one at lunchtime.
 */
function markFor(
  date: string,
  today: string,
  rec: AttRow | undefined,
  holiday: boolean,
  off: boolean,
  leave: boolean,
): Mark {
  if (holiday) return 'HOLIDAY'
  if (off) return 'WEEKLY_OFF'
  if (leave) return 'LEAVE'
  if (rec && (rec.work_in || rec.work_out)) {
    if (date === today && !rec.work_out) return 'PRESENT'
    if (!rec.work_in || !rec.work_out) return 'MISSING'
    return Number(rec.late_minutes || 0) > 0 ? 'LATE' : 'PRESENT'
  }
  return date >= today ? 'UPCOMING' : 'ABSENT'
}

/** The shift in force for this employee, or null when none is assigned. */
async function shiftFor(employeeId: string, on: string) {
  const { data } = await sb.from('employee_shift_assignment')
    .select('effective_from, effective_till, overtime_applicable, shift_master(shift_code, shift_type, in_time, out_time, late_allowed_till, max_late_punch, lunch_duration_mins, overtime_applicable)')
    .eq('employee_id', employeeId).eq('is_active', true)
    .lte('effective_from', on)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()

  const row = (data ?? null) as AssignmentRow | null
  const joined = row?.shift_master
  const m = Array.isArray(joined) ? joined[0] : joined
  if (!m) return null
  return {
    code: m.shift_code,
    name: m.shift_type,
    start: m.in_time,
    end: m.out_time,
    grace_until: m.late_allowed_till,
    last_punch: m.max_late_punch,
    break_minutes: m.lunch_duration_mins,
    overtime: !!(row?.overtime_applicable ?? m.overtime_applicable),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET — the month grid, punches, shift and regularisations, in one call
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const today = istToday()

  const asked = req.nextUrl.searchParams.get('month') || ''
  const month = /^\d{4}-\d{2}$/.test(asked) ? asked : today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`

  // A single day's raw punches, for the "fix a day" flow. Only when asked for:
  // a month of punch rows is not a month-grid payload.
  const askedDay = req.nextUrl.searchParams.get('date')
  const wantDay = isDay(askedDay) ? askedDay : null

  const [recR, holR, offR, lvR, regR, shift, punchR] = await Promise.all([
    sb.from('attendance_records')
      .select('attendance_date, work_in, work_out, total_minutes, late_minutes, overtime_minutes, status, lop_applicable, punch_count, source, regularized_at')
      .eq('employee_id', me).gte('attendance_date', from).lte('attendance_date', to),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: me, p_from: from, p_to: to }),
    sb.from('leave_applications')
      .select('from_date, to_date, half_day, leave_types(short_name, name)')
      .eq('employee_id', me).eq('status', 'APPROVED').lte('from_date', to).gte('to_date', from),
    sb.from('attendance_regularisation')
      .select('id, attendance_date, recorded_in, recorded_out, requested_in, requested_out, reason, status, reviewed_at, review_remark, created_at')
      .eq('employee_id', me).order('created_at', { ascending: false }).limit(20),
    shiftFor(me, today),
    wantDay
      ? sb.from('attendance_punches')
          .select('punch_time, punch_type, source, geofence_status')
          .eq('employee_id', me).eq('punch_date', wantDay).order('punch_time', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  const recs = new Map<string, AttRow>()
  for (const x of rows<AttRow>(recR.data)) recs.set(x.attendance_date, x)

  // resolve_holidays returns the whole calendar; only this month's matter here.
  const allHolidays = rows<HolidayRow>(holR.data)
  const holidays = allHolidays.filter(h => h.holiday_date >= from && h.holiday_date <= to)
  // Every holiday on the calendar takes the day, optional ones included.
  //
  // This used to keep an optional holiday as a working day, on the reasoning
  // that it was "the employee's to take or skip". That reasoning depended on a
  // pick mechanism that does not exist: there is no table, route or screen
  // anywhere that lets an employee choose an optional holiday, so the flag only
  // ever removed the day from holiday treatment. Leave now refuses to start or
  // end on any configured holiday (app/api/ess/leave/route.ts §7), and the
  // attendance grid has to agree with it — otherwise the same date reads as a
  // holiday on one screen and a working day on the other.
  const holidayBy = new Map<string, HolidayRow>()
  for (const h of holidays) holidayBy.set(h.holiday_date, h)

  const offs = new Set<string>(rows<OffRow>(offR.data).map(w => w.off_date))

  const leaveBy = new Map<string, string>()
  for (const l of rows<LeaveRow>(lvR.data)) {
    const name = l.leave_types?.name || l.leave_types?.short_name || 'Leave'
    for (const d of eachDay(l.from_date, l.to_date)) {
      if (d >= from && d <= to) leaveBy.set(d, name)
    }
  }

  const days = eachDay(from, to).map(date => {
    const rec = recs.get(date)
    const holiday = holidayBy.get(date)
    const leave = leaveBy.get(date)
    return {
      date,
      mark: markFor(date, today, rec, !!holiday, offs.has(date), !!leave),
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
      note: holiday?.description ?? leave ?? null,
    }
  })

  const count = (mk: Mark) => days.filter(d => d.mark === mk).length
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
  }

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
    regularisations: regR.data ?? [],
    summary,
    // So an empty grid can say WHY, instead of implying the employee simply
    // never came in.
    diagnostics: {
      // employee_shift_assignment is empty for everybody today: no shift is
      // assigned anywhere, which is why late-marking never fires.
      noShift: !shift,
      // resolve_holidays needs a PUBLISHED calendar; FY 2026-27 is still DRAFT.
      noHolidayCalendar: !allHolidays.length,
      noRecords: !recs.size,
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — file a miss-punch regularisation
//
// The second of the app's two direct writes (leave was the first). It upserts
// on (employee_id, attendance_date), exactly as lib/supabase-attendance.ts
// does, so re-filing a day that is still pending updates it rather than
// failing on a duplicate.
//
// There is no approver flow for regularisation anywhere in this product — no
// current_approver_id, no stamping trigger, no queue; HR reviews these in the
// dashboard's regularisation report. That is why, unlike leave, this notifies
// nobody: a notification pointing at a screen that does not exist is worse
// than none.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('Attendance cannot be regularised while viewing as somebody else.')

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

  const requestedIn = body.requested_in
  const requestedOut = body.requested_out
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

  if (!isTime(requestedIn) || !isTime(requestedOut)) return bad('Give both times as HH:mm.')
  if (requestedOut <= requestedIn) return bad('The out time has to be after the in time.')
  if (!reason) return bad('Say why the punch is being corrected. Whoever reviews it reads this.')

  // One day, a list of days, or a range — one row per day either way, because
  // HR approves days individually.
  let dates: string[] = []
  if (Array.isArray(body.dates)) dates = body.dates.filter(isDay)
  else if (isDay(body.date)) dates = [body.date]
  else if (isDay(body.from) && isDay(body.to)) dates = eachDay(body.from, body.to)
  else if (isDay(body.from)) dates = [body.from]
  if (!dates.length) return bad('Pick the day to correct.')
  if (dates.length > 31) return bad('Regularise one month at a time.')

  const today = istToday()
  const first = dates[0]
  const last = dates[dates.length - 1]

  const [recR, holR, offR, existingR] = await Promise.all([
    sb.from('attendance_records').select('attendance_date, work_in, work_out')
      .eq('employee_id', me).in('attendance_date', dates),
    sb.rpc('resolve_holidays', { p_employee_id: me }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: me, p_from: first, p_to: last }),
    sb.from('attendance_regularisation').select('attendance_date, status')
      .eq('employee_id', me).in('attendance_date', dates),
  ])

  const recBy = new Map<string, AttRow>(rows<AttRow>(recR.data).map(x => [x.attendance_date, x]))
  const offSet = new Set<string>(rows<OffRow>(offR.data).map(w => w.off_date))
  const holBy = new Map<string, HolidayRow>(
    rows<HolidayRow>(holR.data).filter(h => !h.is_optional).map(h => [h.holiday_date, h]),
  )
  const decided = new Map<string, string>(
    rows<RegRow>(existingR.data).map(x => [x.attendance_date, String(x.status ?? '')]),
  )

  const skipped: { date: string; why: string }[] = []
  const toFile: Record<string, unknown>[] = []

  for (const date of dates) {
    if (date > today) { skipped.push({ date, why: 'that day has not happened yet' }); continue }
    if (offSet.has(date)) { skipped.push({ date, why: 'it was a weekly off' }); continue }
    const holiday = holBy.get(date)
    if (holiday) { skipped.push({ date, why: `it was ${holiday.description ?? 'a holiday'}` }); continue }
    // An approved correction is a decided fact; re-filing would quietly
    // overwrite it through the upsert.
    if (decided.get(date) === 'APPROVED') { skipped.push({ date, why: 'it has already been regularised' }); continue }

    const rec = recBy.get(date)
    toFile.push({
      employee_id: me,                       // the session's, never the body's
      attendance_date: date,
      recorded_in: rec?.work_in ?? null,
      recorded_out: rec?.work_out ?? null,
      requested_in: requestedIn,
      requested_out: requestedOut,
      reason,
      status: 'PENDING',
    })
  }

  if (!toFile.length) {
    const only = skipped.length === 1 ? skipped[0] : null
    return bad(only
      ? `${fmtDate(only.date)}: ${only.why}.`
      : 'None of those days can be regularised.')
  }

  const { error } = await sb.from('attendance_regularisation')
    .upsert(toFile, { onConflict: 'employee_id,attendance_date' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit(ctx.caller, 'ATTENDANCE_REGULARISED', me, {
    dates: toFile.map(x => x.attendance_date),
    skipped,
  })

  return NextResponse.json({
    ok: true,
    filed: toFile.length,
    dates: toFile.map(x => x.attendance_date),
    // Days left out, named, so the client can say so rather than silently
    // filing fewer than the employee picked.
    skipped,
    status: 'PENDING',
  })
}
