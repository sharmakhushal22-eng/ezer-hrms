// lib/attendance/punch.ts — the one place a punch is decided. SERVER ONLY.
//
// THE BUG THIS FIXES. Punch In could be pressed again and again. Each screen
// decided which button to offer from its own copy of "am I punched in", and
// none of them was the database:
//
//   · Today (the dial) read ess_today_payload(), which finds today's record with
//     `attendance_date = current_date` — and current_date is UTC, so from
//     midnight to 05:30 IST it looked at yesterday. /api/ess/today also told the
//     browser to cache the reply for 30 seconds, so leaving the page and coming
//     back inside that window showed the pre-punch state: Punch In, live again.
//   · Home's card asked an unauthenticated route that took employee_id from the
//     request, and offered Punch Out forever once anything was punched.
//   · And the server accepted whatever arrived: ess_punch() inserts a row and
//     re-processes the day, no questions asked.
//
// So the rule now lives here and nowhere else: punches alternate. IN is refused
// while an IN is open today; OUT is refused when nothing is open. After an OUT
// another IN is allowed — stepping out and coming back is a real day — and the
// day's record still spans first IN to last OUT, exactly as
// process_daily_attendance() computes it. "Today" is the IST date, the same
// day attendance_punches.punch_date is stamped with.
import { rmsServiceClient as sb } from '@/lib/rms/server'

export interface PunchRow { punch_time: string; punch_type: 'IN' | 'OUT' | string; source: string | null; geofence_status: string | null }

export interface PunchState {
  /** IST calendar date the state is for. */
  date: string
  /** An IN with no OUT after it — the employee is at work right now. */
  open: boolean
  /** First IN of the day (what the record's work_in is). */
  first_in: string | null
  /** Most recent IN — the start of the current stretch when open. */
  last_in: string | null
  /** Most recent OUT. */
  last_out: string | null
  punches: PunchRow[]
}

/** The IST calendar date, which is what punch_date and attendance_date hold. */
export const istDate = (d: Date = new Date()): string =>
  new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export async function punchState(employeeId: string, date: string = istDate()): Promise<PunchState> {
  const { data } = await sb.from('attendance_punches')
    .select('punch_time, punch_type, source, geofence_status')
    .eq('employee_id', employeeId).eq('punch_date', date)
    .order('punch_time', { ascending: true })
  const punches = (data || []) as PunchRow[]
  let open = false, firstIn: string | null = null, lastIn: string | null = null, lastOut: string | null = null
  for (const p of punches) {
    const t = String(p.punch_type).toUpperCase()
    if (t === 'IN') { open = true; lastIn = p.punch_time; firstIn = firstIn ?? p.punch_time }
    else if (t === 'OUT') { open = false; lastOut = p.punch_time }
  }
  return { date, open, first_in: firstIn, last_in: lastIn, last_out: lastOut, punches }
}

export type PunchOutcome =
  | { ok: true; at: string; result: unknown; state: PunchState }
  | { ok: false; status: number; error: string; state?: PunchState }

const clock = (ts: string) =>
  new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

export async function punch(
  employeeId: string, kind: 'in' | 'out',
  opts: { lat?: number | null; lng?: number | null } = {},
): Promise<PunchOutcome> {
  const before = await punchState(employeeId)
  if (kind === 'in' && before.open) {
    return { ok: false, status: 409, state: before,
      error: `You are already punched in (since ${clock(before.last_in!)}). Punch out first.` }
  }
  if (kind === 'out' && !before.open) {
    return { ok: false, status: 409, state: before,
      error: before.last_out ? `You already punched out at ${clock(before.last_out)}. Punch in first.` : 'Punch in first.' }
  }

  // The employee's own branch, so ess_punch() can measure the geofence. It was
  // passed as null, so the fence status of every web punch was UNKNOWN.
  const { data: emp } = await sb.from('employees').select('location_id').eq('id', employeeId).maybeSingle()
  const { data, error } = await sb.rpc('ess_punch', {
    p_employee_id: employeeId,
    p_punch_type: kind === 'in' ? 'IN' : 'OUT',
    p_latitude: typeof opts.lat === 'number' ? opts.lat : null,
    p_longitude: typeof opts.lng === 'number' ? opts.lng : null,
    p_branch_id: (emp as { location_id?: string | null } | null)?.location_id ?? null,
  })
  if (error) return { ok: false, status: 400, error: error.message }

  const at = (data as { punch_time?: string } | null)?.punch_time ?? new Date().toISOString()
  return { ok: true, at, result: data, state: await punchState(employeeId) }
}
