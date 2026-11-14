// lib/analytics/movers.ts — what moved between two months, and which group moved it.
//
// The question a leader asks of any figure is "why?". The answer is nearly always "it
// moved in one place": one department, one weekday, one leave type. This computes, for
// each headline measure, the figure in two windows and the same figure for every group,
// with each group's EFFECT — how much of the overall change it accounts for:
//
//   counts (exits, joiners, leave days)   effect = the group's own change
//   rates  (on-time, unplanned share)     effect = the group's change in rate, weighted
//                                         by its share of the volume now — so a 12-point
//                                         fall in a team of 5 does not outrank a 4-point
//                                         fall in a team of 200.
//
// Pure arithmetic on rows already read for the page. The executive briefing and "Why?"
// are written from this — by the AI when it is on, from plain templates when not.

import type { EmpLite, AttRec, LeaveApp } from './metrics.ts'
import { onBooks, isUnplanned, daysWithin, round, weekdayName, exitedIn, joinedIn } from './metrics.ts'
import { addDays, addMonths, monthOf } from './period.ts'
import type { Area, Fmt, Mover, MoverBreakdown, MoverRow, MoverSet, MoverWindow, MoverWindowKey } from './types.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const mName = (ym: string, long = false) => (long ? LONG : MONTHS)[Number(ym.slice(5, 7)) - 1]
const monthEnd = (ym: string) => addDays(`${addMonths(ym, 1)}-01`, -1)

/** The two windows of a comparison. A month-to-date window is compared with the same
 *  days of the month before, so a half-month is never set against a whole one. */
export function moverWindow(key: MoverWindowKey, today: string): MoverWindow {
  const thisM = monthOf(today)
  if (key === 'mtd') {
    const lastM = addMonths(thisM, -1)
    const day = Number(today.slice(8, 10))
    const prevTo = [addDays(`${lastM}-01`, day - 1), monthEnd(lastM)].sort()[0]
    return {
      key, month: `${mName(thisM)} ${thisM.slice(0, 4)}`,
      label: `1–${day} ${mName(thisM)} against 1–${Number(prevTo.slice(8, 10))} ${mName(lastM)}`,
      from: `${thisM}-01`, to: today, prevFrom: `${lastM}-01`, prevTo,
    }
  }
  const a = addMonths(thisM, -1), b = addMonths(thisM, -2)
  return {
    key, month: `${mName(a)} ${a.slice(0, 4)}`,
    label: `${mName(a, true)} against ${mName(b, true)}`,
    from: `${a}-01`, to: monthEnd(a), prevFrom: `${b}-01`, prevTo: monthEnd(b),
  }
}

/** The earliest day the movers need attendance and leave for. */
export const moversReadFrom = (today: string) => moverWindow('last', today).prevFrom

export interface Candidate { applied: string; offered: string | null; source: string | null; department: string | null }
export interface PayRun { month: string; cost: number; employees: number }

export interface MoverInput {
  today: string
  emps: EmpLite[]
  att: AttRec[]
  approved: LeaveApp[]
  candidates: Candidate[]
  runs?: PayRun[] | null
  dept: (e: EmpLite) => string
  loc: (e: EmpLite) => string
  reason: (e: EmpLite) => string
  kind: (e: EmpLite) => string
  leaveType: (code: string) => string
}

/** Groups smaller than this are not shown on a rate breakdown — their rate is noise. */
const MIN_RATE_N = 20
const MAX_ROWS = 8

const r1 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : round(x, 1))
const rate = (num: number, den: number) => (den ? (num / den) * 100 : null)
const within = (d: string, from: string, to: string) => d >= from && d <= to

function group<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = key(x) || 'Unassigned'; const l = m.get(k); if (l) l.push(x); else m.set(k, [x]) }
  return m
}

/** A count measure's breakdown: each group's change is its effect. */
function countRows<T>(now: T[], before: T[], key: (x: T) => string, value: (xs: T[]) => number = xs => xs.length): MoverRow[] {
  const a = group(now, key), b = group(before, key)
  const rows: MoverRow[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const n = value(a.get(k) || []), p = value(b.get(k) || [])
    if (!n && !p) continue
    rows.push({ label: k, now: r1(n), before: r1(p), delta: r1(n - p), n: (a.get(k) || []).length, nBefore: (b.get(k) || []).length, effect: r1(n - p) })
  }
  return top(rows)
}

/** A rate measure's breakdown, weighted by each group's volume now. */
function rateRows<T>(now: T[], before: T[], key: (x: T) => string, parts: (xs: T[]) => { num: number; den: number }): MoverRow[] {
  const a = group(now, key), b = group(before, key)
  const denNow = parts(now).den
  const rows: MoverRow[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = parts(a.get(k) || []), y = parts(b.get(k) || [])
    if (x.den < MIN_RATE_N && y.den < MIN_RATE_N) continue
    const rn = x.den >= MIN_RATE_N ? rate(x.num, x.den) : null
    const rb = y.den >= MIN_RATE_N ? rate(y.num, y.den) : null
    const d = rn != null && rb != null ? rn - rb : null
    rows.push({ label: k, now: r1(rn), before: r1(rb), delta: r1(d), n: x.den, nBefore: y.den, effect: d != null && denNow ? r1(d * (x.den / denNow)) : null })
  }
  return top(rows)
}

const top = (rows: MoverRow[]) => rows
  .sort((x, y) => Math.abs(y.effect ?? 0) - Math.abs(x.effect ?? 0) || y.n - x.n)
  .slice(0, MAX_ROWS)

function mover(key: string, area: Area, label: string, fmt: Fmt, good: Mover['good'], now: number | null, before: number | null, by: MoverBreakdown[], notes: string[] = []): Mover {
  return { key, area, label, fmt, good, now: r1(now), before: r1(before), delta: now != null && before != null ? r1(now - before) : null, notes, by: by.filter(b => b.rows.length > 0) }
}

const onTime = (rs: AttRec[]) => { let den = 0, late = 0; for (const r of rs) if (r.work_in) { den++; if (Number(r.late_minutes || 0) > 0) late++ } return { num: den - late, den } }
const missed = (today: string) => (rs: AttRec[]) => { let num = 0; for (const r of rs) if (!!r.work_in !== !!r.work_out && r.attendance_date < today) num++; return { num, den: rs.length } }

export function computeMovers(input: MoverInput, key: MoverWindowKey): MoverSet {
  const { today, emps } = input
  const w = moverWindow(key, today)
  const byId = new Map(emps.map(e => [e.id, e]))
  const deptOfId = (id: string) => { const e = byId.get(id); return e ? input.dept(e) : 'Unassigned' }
  const locOfId = (id: string) => { const e = byId.get(id); return e ? input.loc(e) : 'Unassigned' }
  const items: Mover[] = []

  // ── Attendance ──────────────────────────────────────────────────────────
  const attA = input.att.filter(r => within(r.attendance_date, w.from, w.to))
  const attB = input.att.filter(r => within(r.attendance_date, w.prevFrom, w.prevTo))
  const oa = onTime(attA), ob = onTime(attB)
  if (oa.den >= MIN_RATE_N || ob.den >= MIN_RATE_N) {
    const trackedA = new Set(attA.map(r => r.employee_id)).size, trackedB = new Set(attB.map(r => r.employee_id)).size
    const notes = [`${oa.den} punch-ins against ${ob.den}`, `${trackedA} people tracked against ${trackedB}`]
    items.push(mover('ontime', 'attendance', 'On-time punch-ins', 'pct', 'up', oa.den >= MIN_RATE_N ? rate(oa.num, oa.den) : null, ob.den >= MIN_RATE_N ? rate(ob.num, ob.den) : null, [
      { dim: 'department', label: 'By department', unit: 'punch-ins', rows: rateRows(attA, attB, r => deptOfId(r.employee_id), onTime) },
      { dim: 'location', label: 'By location', unit: 'punch-ins', rows: rateRows(attA, attB, r => locOfId(r.employee_id), onTime) },
      { dim: 'weekday', label: 'By weekday', unit: 'punch-ins', rows: rateRows(attA, attB, r => weekdayName(new Date(r.attendance_date + 'T00:00:00Z').getUTCDay()), onTime) },
    ], notes))
    const ma = missed(today)(attA), mb = missed(today)(attB)
    items.push(mover('misspunch', 'attendance', 'Days with a missing punch', 'pct', 'down', rate(ma.num, ma.den), rate(mb.num, mb.den), [
      { dim: 'location', label: 'By location', unit: 'days', rows: rateRows(attA, attB, r => locOfId(r.employee_id), missed(today)) },
      { dim: 'department', label: 'By department', unit: 'days', rows: rateRows(attA, attB, r => deptOfId(r.employee_id), missed(today)) },
    ], [`${ma.num} days against ${mb.num}`]))
  }

  // ── Leave ───────────────────────────────────────────────────────────────
  const lvA = input.approved.filter(l => daysWithin(l, w.from, w.to) > 0)
  const lvB = input.approved.filter(l => daysWithin(l, w.prevFrom, w.prevTo) > 0)
  const daysA = (xs: LeaveApp[]) => xs.reduce((s, l) => s + daysWithin(l, w.from, w.to), 0)
  const daysB = (xs: LeaveApp[]) => xs.reduce((s, l) => s + daysWithin(l, w.prevFrom, w.prevTo), 0)
  const leaveRows = (key: (l: LeaveApp) => string): MoverRow[] => {
    const a = group(lvA, key), b = group(lvB, key)
    const rows: MoverRow[] = []
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const n = daysA(a.get(k) || []), p = daysB(b.get(k) || [])
      if (!n && !p) continue
      rows.push({ label: k, now: r1(n), before: r1(p), delta: r1(n - p), n: (a.get(k) || []).length, nBefore: (b.get(k) || []).length, effect: r1(n - p) })
    }
    return top(rows)
  }
  const totA = daysA(lvA), totB = daysB(lvB)
  if (totA || totB) {
    items.push(mover('leave', 'leave', 'Leave days taken', 'days', 'neutral', totA, totB, [
      { dim: 'type', label: 'By leave type', unit: 'spells', fmt: 'days', rows: leaveRows(l => input.leaveType(l.type)) },
      { dim: 'department', label: 'By department', unit: 'spells', fmt: 'days', rows: leaveRows(l => deptOfId(l.employee_id)) },
    ], [`${lvA.length} leave spells against ${lvB.length}`]))
    const unA = daysA(lvA.filter(isUnplanned)), unB = daysB(lvB.filter(isUnplanned))
    items.push(mover('unplanned', 'leave', 'Unplanned share of leave', 'pct', 'down', rate(unA, totA), rate(unB, totB), [
      { dim: 'type', label: 'Unplanned days by type', unit: 'spells', fmt: 'days', rows: leaveRows(l => (isUnplanned(l) ? input.leaveType(l.type) : '')).filter(r => r.label !== 'Unassigned') },
    ], [`${r1(unA)} unplanned days against ${r1(unB)}`]))
  }

  // ── Headcount, joiners, exits ───────────────────────────────────────────
  const onA = emps.filter(e => onBooks(e, w.to)), onB = emps.filter(e => onBooks(e, w.prevTo))
  items.push(mover('headcount', 'workforce', 'Headcount at the end of the window', 'count', 'neutral', onA.length, onB.length, [
    { dim: 'department', label: 'Net change by department', unit: 'people', rows: countRows(onA, onB, input.dept).filter(r => r.delta) },
    { dim: 'location', label: 'Net change by location', unit: 'people', rows: countRows(onA, onB, input.loc).filter(r => r.delta) },
  ]))
  const jA = joinedIn(emps, w.from, w.to), jB = joinedIn(emps, w.prevFrom, w.prevTo)
  items.push(mover('joiners', 'attrition', 'Joiners', 'count', 'up', jA.length, jB.length, [
    { dim: 'department', label: 'By department', unit: 'people', rows: countRows(jA, jB, input.dept) },
    { dim: 'location', label: 'By location', unit: 'people', rows: countRows(jA, jB, input.loc) },
  ]))
  const xA = exitedIn(emps, w.from, w.to), xB = exitedIn(emps, w.prevFrom, w.prevTo)
  items.push(mover('exits', 'attrition', 'Exits', 'count', 'down', xA.length, xB.length, [
    { dim: 'department', label: 'By department', unit: 'people', rows: countRows(xA, xB, input.dept) },
    { dim: 'kind', label: 'Voluntary or not', unit: 'people', rows: countRows(xA, xB, input.kind) },
    { dim: 'reason', label: 'By reason given', unit: 'people', rows: countRows(xA, xB, input.reason) },
  ]))

  // ── Hiring ──────────────────────────────────────────────────────────────
  const cA = input.candidates.filter(c => within(c.applied, w.from, w.to)), cB = input.candidates.filter(c => within(c.applied, w.prevFrom, w.prevTo))
  if (cA.length || cB.length) {
    items.push(mover('applicants', 'hiring', 'Applicants', 'count', 'up', cA.length, cB.length, [
      { dim: 'source', label: 'By source', unit: 'people', rows: countRows(cA, cB, c => c.source || 'Not recorded') },
      { dim: 'department', label: 'By department', unit: 'people', rows: countRows(cA, cB, c => c.department || 'Unassigned') },
    ]))
  }
  const fA = input.candidates.filter(c => c.offered && within(c.offered, w.from, w.to)), fB = input.candidates.filter(c => c.offered && within(c.offered, w.prevFrom, w.prevTo))
  if (fA.length || fB.length) {
    items.push(mover('offers', 'hiring', 'Offers made', 'count', 'up', fA.length, fB.length, [
      { dim: 'source', label: 'By source', unit: 'people', rows: countRows(fA, fB, c => c.source || 'Not recorded') },
      { dim: 'department', label: 'By department', unit: 'people', rows: countRows(fA, fB, c => c.department || 'Unassigned') },
    ]))
  }

  // ── Payroll cost: whole months only ─────────────────────────────────────
  if (key === 'last' && input.runs?.length) {
    const a = input.runs.find(r => r.month === w.from.slice(0, 7)), b = input.runs.find(r => r.month === w.prevFrom.slice(0, 7))
    if (a && b) {
      items.push(mover('cost', 'cost', 'Payroll cost to company', 'money', 'neutral', a.cost, b.cost, [], [
        `${a.employees} people paid against ${b.employees}`,
        `cost per person paid ${Math.round(a.cost / Math.max(a.employees, 1))} against ${Math.round(b.cost / Math.max(b.employees, 1))}`,
      ]))
    }
  }

  return { window: w, items }
}

/** How big a change is, comparable across measures: points for a rate, and the share of
 *  the old value for a count. Used to put the largest changes first. */
export function moveSize(m: Mover): number {
  if (m.delta == null) return 0
  if (m.fmt === 'pct') return Math.abs(m.delta) / 5
  const base = Math.max(Math.abs(m.before ?? 0), 3)
  return Math.abs(m.delta) / base
}

/** Did it move the good way? null for measures with no good direction. */
export function moveIsGood(m: Mover): boolean | null {
  if (m.delta == null || m.delta === 0 || m.good === 'neutral') return null
  return m.good === 'up' ? m.delta > 0 : m.delta < 0
}
