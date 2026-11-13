// lib/analytics/server/calendar.ts — a person's days, resolved the way ESS resolves them.
//
// Holidays and weekly offs differ by company, branch and shift, so they come from the
// same two RPCs the attendance screen calls (resolve_holidays, resolve_weekly_offs) —
// per person, which is why this is used for a team or one employee and never for a
// whole organisation.

import { sb } from './db.ts'
import { eachDay } from '../period.ts'
import { kindOfDay, type DayRec } from '../days.ts'
import type { DayKind } from '../types.ts'

export interface PersonDay { date: string; kind: DayKind; rec?: DayRec & { attendance_date: string } }

export async function calendarFor(
  employeeId: string, doj: string | null, from: string, to: string, today: string,
  recs: (DayRec & { attendance_date: string })[],
  leaves: { from_date: string; to_date: string; half_day: boolean }[],
): Promise<PersonDay[]> {
  const [hol, off] = await Promise.all([
    sb.rpc('resolve_holidays', { p_employee_id: employeeId }),
    sb.rpc('resolve_weekly_offs', { p_employee_id: employeeId, p_from: from, p_to: to }),
  ])
  const holidays = new Set<string>(((hol.data || []) as any[]).map(h => h.holiday_date).filter((d: string) => d >= from && d <= to))
  const offs = new Set<string>(((off.data || []) as any[]).map(w => w.off_date))
  const recBy = new Map(recs.map(r => [r.attendance_date, r]))
  const leaveBy = new Map<string, { half_day: boolean }>()
  for (const l of leaves) for (const d of eachDay(l.from_date > from ? l.from_date : from, l.to_date < to ? l.to_date : to)) leaveBy.set(d, { half_day: !!l.half_day })
  return eachDay(from, to).map(date => {
    const rec = recBy.get(date)
    return { date, kind: kindOfDay(date, today, rec, holidays.has(date), offs.has(date), leaveBy.get(date), doj), rec }
  })
}

/** Run `fn` over items a few at a time — enough parallelism to be quick, few enough not
 *  to queue a burst of RPCs behind each other. */
export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(new Array(Math.min(size, items.length)).fill(0).map(async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}
