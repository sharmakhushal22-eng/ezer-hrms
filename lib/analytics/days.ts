// lib/analytics/days.ts — what one day was, for one person.
//
// The same precedence as the ESS attendance screen (app/api/ess/attendance kindFor):
// holiday → weekly off → full-day leave → the punches → half-day leave → absent. It is
// repeated here, not imported, because that function lives inside a route file; the
// tests below pin the two to the same answers so they cannot drift apart silently.
// One addition: days before someone joined are NOT_JOINED rather than ABSENT, so a new
// joiner's first month does not read as a month of absences.

import type { DayKind } from './types.ts'
import { istMinutes } from './metrics.ts'

export interface DayRec {
  work_in: string | null
  work_out: string | null
  late_minutes: number | null
  total_minutes: number | null
  status: string | null
}

export function kindOfDay(
  date: string, today: string, rec: DayRec | undefined,
  holiday: boolean, off: boolean, leave: { half_day: boolean } | undefined, doj: string | null,
): DayKind {
  if (doj && date < doj) return 'NOT_JOINED'
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

/** Days the person was expected at work and the day has started. */
export const isWorkday = (k: DayKind): boolean => !['HOLIDAY', 'WEEKLY_OFF', 'NOT_JOINED', 'UPCOMING'].includes(k)
export const isPresent = (k: DayKind): boolean => ['PRESENT', 'LATE', 'HALF_DAY', 'IN_PROGRESS', 'MISS_IN', 'MISS_OUT'].includes(k)

export interface DayTally {
  present: number; late: number; absent: number; leave: number; miss: number; workdays: number
  onTimeRate: number | null; avgIn: number | null; avgHours: number | null
}

export function tallyDays(days: { kind: DayKind; rec?: DayRec }[]): DayTally {
  let present = 0, late = 0, absent = 0, leave = 0, miss = 0, workdays = 0, punchedIn = 0
  const ins: number[] = [], hrs: number[] = []
  for (const d of days) {
    if (isWorkday(d.kind)) workdays++
    if (isPresent(d.kind)) present++
    if (d.kind === 'ABSENT') absent++
    if (d.kind === 'LEAVE') leave++
    if (d.kind === 'HALF_LEAVE') leave += 0.5
    if (d.kind === 'MISS_IN' || d.kind === 'MISS_OUT') miss++
    if (d.rec?.work_in) {
      punchedIn++
      const m = istMinutes(d.rec.work_in)
      if (Number.isFinite(m)) ins.push(m)
    }
    if (d.rec?.work_in && d.rec?.work_out && Number(d.rec.total_minutes) > 0) hrs.push(Number(d.rec.total_minutes) / 60)
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  // Late = punched in after the grace time, whatever else the day turned into (a late
  // half-day is still a late mark). The same rule the on-time rate uses, so the two agree.
  late = days.filter(d => isWorkday(d.kind) && d.rec?.work_in && Number(d.rec.late_minutes || 0) > 0).length
  const lateOnPunch = days.filter(d => d.rec?.work_in && Number(d.rec.late_minutes || 0) > 0).length
  return {
    present, late, absent, leave, miss, workdays,
    onTimeRate: punchedIn ? Math.round(((punchedIn - lateOnPunch) / punchedIn) * 1000) / 10 : null,
    avgIn: ins.length ? Math.round(avg(ins) as number) : null,
    avgHours: hrs.length ? Math.round((avg(hrs) as number) * 10) / 10 : null,
  }
}

/** Consecutive on-time working days, counting back from the most recent. Leave, holidays
 *  and weekly offs neither break nor extend it. A day still in progress counts if it
 *  started on time. */
export function onTimeStreak(days: { kind: DayKind }[]): number {
  let n = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const k = days[i].kind
    if (k === 'UPCOMING' || k === 'HOLIDAY' || k === 'WEEKLY_OFF' || k === 'LEAVE' || k === 'HALF_LEAVE') continue
    if (k === 'NOT_JOINED') break
    if (k === 'PRESENT' || k === 'IN_PROGRESS') { n++; continue }
    break
  }
  return n
}
