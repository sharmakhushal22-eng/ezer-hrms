import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvePeriod, previousPeriod, fiscalToMonth, fyLabel, monthEnd, addMonths, istToday, yearFraction,
} from '../period.ts'
import {
  headcountOn, monthlyFlow, periodAttrition, annualise, earlyAttrition, spanOfControl, tenureBand, ageBand,
  summariseAttendance, lateByWeekday, daysWithin, bridgeShare, bradford, isUnplanned, ratingDistribution,
  funnelCounts, pmsStage, probationOverdue, probationDue, pct, median, change, toBuckets, type EmpLite, type AttRec, type LeaveApp,
} from '../metrics.ts'
import { riskSignals, riskLevel } from '../risk.ts'

const emp = (o: Partial<EmpLite>): EmpLite => ({
  id: o.id || Math.random().toString(36).slice(2), code: null, name: 'X', company_id: 'c', department_id: 'd', location_id: 'l',
  designation: null, grade: null, type: 'Employee', gender: null, dob: null, doj: '2020-01-01', exit: null,
  status: 'Active', l1: null, confirmation: 'Confirmed', probation_months: null, confirmation_date: null, ...o,
})

// ── period ──────────────────────────────────────────────────────────────────

test('periods are April-anchored and never run past today', () => {
  const p = resolvePeriod('fytd', '2026-11-12')
  assert.equal(p.from, '2026-04-01')
  assert.equal(p.to, '2026-11-12')
  assert.equal(p.months.length, 8)
  const lf = resolvePeriod('last_fy', '2026-02-10')
  assert.equal(lf.from, '2024-04-01')
  assert.equal(lf.to, '2025-03-31')
  assert.equal(resolvePeriod('last_month', '2026-01-15').from, '2025-12-01')
})

test('a partial month compares with the same number of days before it', () => {
  const p = resolvePeriod('this_month', '2026-11-12')
  const prev = previousPeriod(p)
  assert.equal(prev.from, '2026-10-01')
  assert.equal(prev.to, '2026-10-12')
  const full = previousPeriod(resolvePeriod('last_3', '2026-03-31'))
  assert.equal(full.from, '2025-10-01')
  assert.equal(full.to, '2025-12-31')
})

test('calendar helpers', () => {
  assert.equal(fiscalToMonth('2026-27', 1), '2026-04')
  assert.equal(fiscalToMonth('2026-27', 10), '2027-01')
  assert.equal(fiscalToMonth('2026-27', 13), null)
  assert.equal(fyLabel('2027-03-31'), '2026-27')
  assert.equal(monthEnd('2028-02'), '2028-02-29')
  assert.equal(addMonths('2026-12', 1), '2027-01')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.equal(istToday(Date.parse('2026-11-12T20:00:00Z')), '2026-11-13')
  assert.ok(Math.abs(yearFraction({ from: '2026-01-01', to: '2026-12-31' }) - 1) < 0.01)
})

// ── workforce ──────────────────────────────────────────────────────────────

test('the monthly bridge balances to the person', () => {
  const emps = [
    emp({ doj: '2025-01-10' }),
    emp({ doj: '2026-03-05' }),                         // joins in March
    emp({ doj: '2024-06-01', exit: '2026-03-31' }),     // leaves on the last day of March
    emp({ doj: '2026-03-02', exit: '2026-03-20' }),     // joins and leaves inside March
    emp({ doj: '2027-01-01' }),                         // future joiner
    emp({ doj: '2020-01-01', exit: null, status: 'Resigned' }),  // no LWD: unplaceable
  ]
  const [m] = monthlyFlow(emps, ['2026-03'], '2026-11-12')
  assert.equal(m.opening, 2)
  assert.equal(m.joiners, 2)
  assert.equal(m.exits, 2)
  assert.equal(m.closing, m.opening + m.joiners - m.exits)
  assert.equal(m.closing, 2)
  assert.equal(headcountOn(emps, '2026-03-31'), 2)
})

test('attrition uses the mean of monthly averages and annualises by time', () => {
  const flows = [
    { month: 'a', opening: 100, joiners: 0, exits: 2, closing: 98, attrition: null },
    { month: 'b', opening: 98, joiners: 4, exits: 2, closing: 100, attrition: null },
  ]
  const r = periodAttrition(flows)
  assert.equal(r.exits, 4)
  assert.equal(r.avgHeadcount, 99)
  assert.equal(r.rate, 4.04)
  assert.equal(annualise(r.rate, 2 / 12), 24.2)
  assert.equal(annualise(null, 1), null)
})

test('early attrition only judges cohorts old enough to have reached the mark', () => {
  const today = '2026-11-12'
  const emps = [
    emp({ doj: '2026-01-10', exit: '2026-02-20' }),   // left in 41 days
    emp({ doj: '2026-02-01' }),
    emp({ doj: '2026-03-01', exit: '2026-12-01' }),   // still within cohort, left after 180d
    emp({ doj: '2026-10-01' }),                       // too recent for the 180-day cohort
  ]
  const r = earlyAttrition(emps, 180, today)
  assert.equal(r.cohort, 3)
  assert.equal(r.left, 1)
})

test('span of control ignores self-reporting and managers outside the set', () => {
  const m = emp({ id: 'm' })
  const team = [m, emp({ l1: 'm' }), emp({ l1: 'm' }), emp({ l1: 'gone' }), emp({ id: 's', l1: 's' })]
  const s = spanOfControl(team)
  assert.equal(s.managers, 1)
  assert.equal(s.avgSpan, 2)
  assert.equal(s.narrow, 1)
})

test('bands', () => {
  assert.equal(tenureBand(0.2), 't0')
  assert.equal(tenureBand(1.5), 't2')
  assert.equal(tenureBand(12), 't5')
  assert.equal(ageBand('2000-01-01', '2026-01-02'), 'a1')
  assert.equal(ageBand('2025-01-01', '2026-01-01'), null)
})

test('probation overdue and due', () => {
  const p = emp({ doj: '2026-01-15', confirmation: 'Probation', probation_months: 6 })
  assert.equal(probationOverdue(p, '2026-07-16'), true)
  assert.equal(probationOverdue(p, '2026-07-14'), false)
  assert.equal(probationDue(p, '2026-07-01', 30), true)
  assert.equal(probationDue({ ...p, confirmation: 'Confirmed' }, '2026-07-01', 30), false)
})

// ── attendance ─────────────────────────────────────────────────────────────

test('attendance summary: late, miss-punch, and today is not a miss', () => {
  const r = (o: Partial<AttRec>): AttRec => ({ employee_id: 'a', attendance_date: '2026-11-10', work_in: '2026-11-10T03:30:00Z', work_out: '2026-11-10T12:30:00Z', total_minutes: 540, late_minutes: 0, overtime_minutes: 0, status: 'PRESENT', ...o })
  const recs = [
    r({}),
    r({ attendance_date: '2026-11-09', late_minutes: 12 }),
    r({ attendance_date: '2026-11-11', work_out: null, total_minutes: 0 }),   // miss-out
    r({ employee_id: 'b', attendance_date: '2026-11-12', work_out: null }),   // today, still in
  ]
  const s = summariseAttendance(recs, '2026-11-12')
  assert.equal(s.tracked, 2)
  assert.equal(s.punchedIn, 4)
  assert.equal(s.late, 1)
  assert.equal(s.onTimeRate, 75)
  assert.equal(s.missPunch, 1)
  assert.equal(s.medianIn, 9 * 60)           // 03:30Z = 09:00 IST
  assert.equal(s.avgHours, 9)
  const wk = lateByWeekday(recs)
  assert.equal(wk.find(w => w.label === 'Mon')?.late, 1)   // 2026-11-09 is a Monday
})

// ── leave ──────────────────────────────────────────────────────────────────

const la = (o: Partial<LeaveApp>): LeaveApp => ({ employee_id: 'a', type: 'EL', from_date: '2026-11-02', to_date: '2026-11-02', days: 1, half_day: false, status: 'APPROVED', applied_at: '2026-10-20T10:00:00Z', resolved_at: null, ...o })

test('leave days are pro-rated across a period boundary', () => {
  assert.equal(daysWithin(la({ from_date: '2026-10-30', to_date: '2026-11-02', days: 2 }), '2026-11-01', '2026-11-30'), 1)
  assert.equal(daysWithin(la({ from_date: '2026-12-01', to_date: '2026-12-02' }), '2026-11-01', '2026-11-30'), 0)
  assert.equal(daysWithin(la({ half_day: true, days: 0.5 }), '2026-11-01', '2026-11-30'), 0.5)
})

test('unplanned leave, the long-weekend pattern and Bradford', () => {
  assert.equal(isUnplanned(la({ type: 'SL' })), true)
  assert.equal(isUnplanned(la({ applied_at: '2026-11-02T04:00:00Z' })), true)   // applied on the day
  assert.equal(isUnplanned(la({})), false)
  const apps = [
    la({ type: 'CL', from_date: '2026-11-02', to_date: '2026-11-02' }),   // Monday
    la({ type: 'CL', from_date: '2026-11-06', to_date: '2026-11-06' }),   // Friday
    la({ type: 'CL', from_date: '2026-11-04', to_date: '2026-11-04' }),   // Wednesday
  ]
  const b = bridgeShare(apps)
  assert.equal(b.bridging, 2)
  assert.equal(b.spells, 3)
  assert.deepEqual(bradford(apps), { spells: 3, days: 3, score: 27 })
})

// ── performance & hiring ───────────────────────────────────────────────────

test('rating distribution ignores blanks and orders top to bottom', () => {
  const d = ratingDistribution(['EE', 'ee', 'ME', null, 'XX', 'U'])
  assert.deepEqual(d.map(x => x.value), [0, 2, 1, 0, 1])
  assert.equal(d[1].share, 50)
  assert.equal(pmsStage('ACKNOWLEDGED'), 'published')
  assert.equal(pmsStage('RM_L2_DONE'), 'manager')
  assert.equal(pmsStage(null), 'not_started')
})

test('the funnel only narrows', () => {
  const f = funnelCounts(['Applied', 'Offer Sent', 'L1', 'Rejected', 'Joined', 'telephonic'])
  assert.deepEqual(f.map(x => x.value), [6, 4, 3, 2, 2, 1])
  assert.equal(f[0].conversion, null)
  for (let i = 1; i < f.length; i++) assert.ok(f[i].value <= f[i - 1].value)
})

// ── risk ───────────────────────────────────────────────────────────────────

test('risk is explained and levelled', () => {
  const s = riskSignals({ managerLeaving: true, rating: 'ME', prevRating: 'EE', late30: 5, latePrev30: 1, tenureYears: 1.4 })
  assert.deepEqual(s.map(x => x.code), ['MANAGER_LEAVING', 'RATING_DROP', 'LATE_SPIKE', 'TENURE_WINDOW'])
  assert.equal(riskLevel(s).level, 'high')
  assert.equal(riskSignals({ tenureYears: 1.5 }).length, 0)   // tenure alone is not a signal
  assert.equal(riskLevel(riskSignals({ tenureYears: 1.5, probationOverdue: true })).level, 'low')   // nor does it promote one weak signal
  assert.equal(riskLevel(riskSignals({ unplanned90: 3 })).level, 'low')
  assert.equal(riskLevel(riskSignals({ rating: 'U' })).level, 'low')                       // one heavy signal is not two
  assert.equal(riskLevel(riskSignals({ rating: 'NI', unplanned90: 4 })).level, 'medium')
})

// ── helpers ────────────────────────────────────────────────────────────────

test('helpers', () => {
  assert.equal(pct(1, 0), null)
  assert.equal(pct(1, 3), 33.3)
  assert.equal(median([3, 1, 2, 10]), 2.5)
  assert.equal(change(110, 100), 10)
  assert.equal(change(5, 0), null)
  const b = toBuckets(new Map([['a', 5], ['b', 4], ['c', 3], ['d', 1]]), k => k, 3)
  assert.deepEqual(b.map(x => [x.label, x.value]), [['a', 5], ['b', 4], ['Other', 4]])
})

// ── day kinds ──────────────────────────────────────────────────────────────
import { kindOfDay, tallyDays, onTimeStreak } from '../days.ts'

test('day kinds follow the ESS precedence and respect the joining date', () => {
  const rec = { work_in: '2026-11-10T03:30:00Z', work_out: '2026-11-10T12:30:00Z', late_minutes: 0, total_minutes: 540, status: 'PRESENT' }
  const T = '2026-11-12'
  assert.equal(kindOfDay('2026-11-10', T, rec, true, false, undefined, null), 'HOLIDAY')
  assert.equal(kindOfDay('2026-11-10', T, rec, false, true, undefined, null), 'WEEKLY_OFF')
  assert.equal(kindOfDay('2026-11-10', T, rec, false, false, { half_day: false }, null), 'LEAVE')
  assert.equal(kindOfDay('2026-11-10', T, rec, false, false, undefined, null), 'PRESENT')
  assert.equal(kindOfDay('2026-11-10', T, { ...rec, late_minutes: 5 }, false, false, undefined, null), 'LATE')
  assert.equal(kindOfDay('2026-11-10', T, { ...rec, work_out: null }, false, false, undefined, null), 'MISS_OUT')
  assert.equal(kindOfDay(T, T, { ...rec, work_out: null }, false, false, undefined, null), 'IN_PROGRESS')
  assert.equal(kindOfDay('2026-11-10', T, undefined, false, false, { half_day: true }, null), 'HALF_LEAVE')
  assert.equal(kindOfDay('2026-11-10', T, undefined, false, false, undefined, null), 'ABSENT')
  assert.equal(kindOfDay('2026-11-13', T, undefined, false, false, undefined, null), 'UPCOMING')
  assert.equal(kindOfDay('2026-11-10', T, undefined, false, false, undefined, '2026-11-11'), 'NOT_JOINED')
})

test('tally and streak', () => {
  const r = (late: number) => ({ work_in: '2026-11-10T03:30:00Z', work_out: '2026-11-10T12:30:00Z', late_minutes: late, total_minutes: 540, status: 'PRESENT' })
  const days = [
    { kind: 'LATE' as const, rec: r(10) },
    { kind: 'PRESENT' as const, rec: r(0) },
    { kind: 'WEEKLY_OFF' as const },
    { kind: 'LEAVE' as const },
    { kind: 'PRESENT' as const, rec: r(0) },
    { kind: 'UPCOMING' as const },
  ]
  const t = tallyDays(days)
  assert.equal(t.present, 3)
  assert.equal(t.late, 1)
  assert.equal(t.workdays, 4)
  assert.equal(t.onTimeRate, 66.7)
  assert.equal(t.avgIn, 540)
  assert.equal(onTimeStreak(days), 2)
})
