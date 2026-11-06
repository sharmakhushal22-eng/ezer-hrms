// @ts-nocheck — a node:test file (no @types/node in the app; the .ts import is what node --experimental-strip-types needs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { dayMarks, dayRules, earliestApplyDate, iso, markedTaken, withMonthOffs, type Application, type Payload } from '../logic.ts'

const app = (from: string, to: string, status: string) => ({ from_date: from, to_date: to, status } as Application)
const day = (date: string, kind: string) => ({ date, kind })

test('only absences, half days and leave are marked', () => {
  const m = dayMarks([day('2026-10-05', 'ABSENT'), day('2026-10-06', 'PRESENT'), day('2026-10-12', 'HALF_DAY'), day('2026-10-13', 'LEAVE'), day('2026-10-14', 'HALF_LEAVE'), day('2026-10-15', 'WEEKLY_OFF')], [])
  assert.deepEqual([...m], [['2026-10-05', 'ABSENT'], ['2026-10-12', 'HALF_DAY'], ['2026-10-13', 'LEAVE'], ['2026-10-14', 'HALF_LEAVE']])
})

test('a waiting request covers its absent days, across its whole range, but not approved leave', () => {
  const m = dayMarks([day('2026-10-05', 'ABSENT'), day('2026-10-06', 'ABSENT'), day('2026-10-07', 'LEAVE')], [app('2026-10-05', '2026-10-07', 'PENDING')])
  assert.equal(m.get('2026-10-05'), 'REQUESTED')
  assert.equal(m.get('2026-10-06'), 'REQUESTED')
  assert.equal(m.get('2026-10-07'), 'LEAVE')
})

test('rejected and cancelled requests leave the day open to claim', () => {
  const m = dayMarks([day('2026-10-05', 'ABSENT')], [app('2026-10-05', '2026-10-05', 'REJECTED'), app('2026-10-05', '2026-10-05', 'CANCELLED')])
  assert.equal(m.get('2026-10-05'), 'ABSENT')
})

test('a day already covered says so; an absent day is free to pick', () => {
  assert.match(markedTaken('LEAVE', '2026-10-13')!, /already on approved leave/)
  assert.match(markedTaken('REQUESTED', '2026-10-13')!, /already waiting/)
  assert.equal(markedTaken('ABSENT', '2026-10-13'), null)
  assert.equal(markedTaken(undefined, '2026-10-13'), null)
})

test('a past month uses its exact weekly offs, not the weekday guess', () => {
  // Saturdays are off in the payload's weekday list, but only the 10th was off that month.
  const data = { holidays: [], weekly_offs: [], weekly_off_weekdays: [0, 6] } as unknown as Payload
  const rules = withMonthOffs(dayRules(data, '2026-11-01'), new Set(['2026-10-10']), '2026-10', '2026-11-01')
  assert.equal(rules.isWeeklyOff('2026-10-10'), true)
  assert.equal(rules.isWeeklyOff('2026-10-03'), false)
  assert.equal(rules.isNonWorking('2026-10-03'), false)
  assert.equal(rules.isWeeklyOff('2026-09-05'), true) // another month: still the guess
})

test('the earliest day counts back inclusive, and 0 means today', () => {
  const back = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
  assert.equal(earliestApplyDate(0), back(0))
  assert.equal(earliestApplyDate(90), back(89))
})
