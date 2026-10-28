import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimAmount, dashboardEmpty, decisionOf, holder, monthAround, rangeLabel, scoreTiles, teamNote,
} from '../dashboard.ts'

const score = (p: Partial<{ cameToMe: number; approved: number; rejected: number; sentBack: number; waiting: number }> = {}) => ({
  cameToMe: 0, approved: 0, rejected: 0, sentBack: 0, waiting: 0, ...p,
})

test('an automatic step is never dressed up as somebody\u2019s judgement', () => {
  assert.equal(decisionOf('approved').label, 'Approved')
  assert.equal(decisionOf('auto').label, 'Approved automatically')
  assert.notEqual(decisionOf('auto').tone, decisionOf('approved').tone)
})

test('every status the step table allows has a word for it', () => {
  // The check constraint in migration 144 is the list; a status with no case
  // here would be shown to a person as the raw database value.
  for (const s of ['pending', 'approved', 'auto', 'rejected', 'sent_back', 'cancelled']) {
    assert.notEqual(decisionOf(s).label, s, s)
  }
})

test('an unknown step status is shown as it is rather than hidden', () => {
  assert.equal(decisionOf('escalated').label, 'escalated')
  assert.equal(decisionOf('escalated').tone, 'plain')
})

test('the scorecard is five tiles and waiting is the last of them', () => {
  const t = scoreTiles(score({ cameToMe: 11, approved: 7, rejected: 2, sentBack: 1, waiting: 1 }))
  assert.equal(t.length, 5)
  assert.equal(t[4].k, 'waiting')
  assert.equal(t[1].sub, '7 of 10')
})

test('waiting says it is not in the date window', () => {
  const t = scoreTiles(score({ waiting: 3 }))
  assert.match(t[4].sub, /any month/)
})

test('a clear desk says so rather than showing a bare zero', () => {
  assert.equal(scoreTiles(score()).at(-1)?.sub, 'your desk is clear')
})

test('a decided count of zero never divides by it', () => {
  const t = scoreTiles(score({ cameToMe: 4, waiting: 4 }))
  assert.equal(t[0].sub, 'nothing decided yet')
  assert.equal(t[1].sub, 'none yet')
})

test('holder names the person, or says plainly that nobody holds it', () => {
  assert.equal(holder('Asha Menon'), 'with Asha Menon')
  assert.equal(holder(null), 'with nobody — no step is open')
  assert.equal(holder(''), 'with nobody — no step is open')
})

test('a whole calendar month is named, not printed as two dates', () => {
  assert.deepEqual(rangeLabel('2026-04-01', '2026-04-30'), { text: 'April 2026', isMonth: true })
  // February, so a month-end test that is wrong by a fixed 30 or 31 fails here.
  assert.deepEqual(rangeLabel('2026-02-01', '2026-02-28'), { text: 'February 2026', isMonth: true })
})

test('a window that is not a whole month prints both dates', () => {
  assert.deepEqual(rangeLabel('2026-04-01', '2026-04-15'), { text: '1 Apr 2026 – 15 Apr 2026', isMonth: false })
  assert.equal(rangeLabel('2026-03-15', '2026-04-14').isMonth, false)
})

test('a window spanning two whole months is not called one month', () => {
  assert.equal(rangeLabel('2026-04-01', '2026-05-31').isMonth, false)
})

test('monthAround steps months without landing on an impossible date', () => {
  assert.deepEqual(monthAround('2026-03-31', -1), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthAround('2026-01-15', -1), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(monthAround('2026-12-02', 1), { from: '2027-01-01', to: '2027-01-31' })
  assert.deepEqual(monthAround('2024-01-31', 1), { from: '2024-02-01', to: '2024-02-29' })
})

test('a date that is not a date is refused rather than guessed at', () => {
  assert.equal(monthAround('not a date'), null)
  assert.equal(rangeLabel('', '').text, 'All dates')
})

test('the team note says read-only and says pay is excluded', () => {
  const note = teamNote({ people: 4, trips: [], claims: [] })
  assert.match(note, /4 people report/)
  const busy = teamNote({ people: 1, trips: [{} as never], claims: [] })
  assert.match(busy, /1 person reports/)
  assert.match(busy, /never what they were paid/)
})

test('a manager with nobody reporting to them gets no team sentence at all', () => {
  assert.equal(teamNote({ people: 0, trips: [], claims: [] }), '')
})

test('an empty dashboard is recognised, and one single pending step is not', () => {
  const base = {
    from: '2026-04-01', to: '2026-04-30', me: 'u1',
    mine: { trips: [], claims: [] }, score: score(), acted: [],
    team: { people: 0, trips: [], claims: [] },
  }
  assert.equal(dashboardEmpty(base as never), true)
  assert.equal(dashboardEmpty({ ...base, score: score({ waiting: 1 }) } as never), false)
})

test('a claim shows the approved figure once there is one, and says which it is', () => {
  assert.deepEqual(claimAmount({ claimed: 900, approved: 750 } as never), { amount: 750, label: 'approved' })
  assert.deepEqual(claimAmount({ claimed: 900, approved: null } as never), { amount: 900, label: 'claimed' })
  // Approved to nothing is a decision, not a missing value.
  assert.deepEqual(claimAmount({ claimed: 900, approved: 0 } as never), { amount: 0, label: 'approved' })
})
