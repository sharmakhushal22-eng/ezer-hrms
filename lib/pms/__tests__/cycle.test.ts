// The rules that decide what every user is told to do.
//
// Worth testing properly rather than eyeballing: the pms_* tables do not
// exist yet, so none of this can be exercised end to end in the app, and a
// wrong answer here does not look like a bug — it looks like confident,
// plausible instructions pointing somebody at the wrong screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGES, currentStage, stageStates, nextAction, kraSetValid,
  inWindow, daysLeft, DEFAULT_RULES, humanDate, settled,
  type Progress, type Period,
} from '../cycle.ts'

const TODAY = '2026-11-15'
const PERIOD: Period = {
  label: 'Q3 FY 2026-27',
  kra:      { from: '2026-10-01', to: '2026-10-15' },
  self:     { from: '2027-01-01', to: '2027-01-10' },
  review:   { from: '2027-01-11', to: '2027-01-20' },
  finalise: { from: '2027-01-21', to: '2027-01-28' },
}
const NOBODY = {}

// ── the stage ladder ─────────────────────────────────────────────────────

test('the seven stages are in order and numbered from one', () => {
  assert.equal(STAGES.length, 7)
  STAGES.forEach((s, i) => assert.equal(s.n, i + 1))
  assert.deepEqual(STAGES.map(s => s.key),
    ['kra', 'oneToOne', 'lock', 'self', 'review', 'finalise', 'result'])
})

test('every stage explains itself — the stepper is the instruction', () => {
  // A stepper of seven bare nouns teaches nothing. Each one carries a
  // sentence a reader who knows nothing about appraisals can follow.
  for (const s of STAGES) {
    assert.ok(s.blurb.length > 25, `${s.key} has no real blurb`)
    assert.ok(s.blurb.endsWith('.'), `${s.key} blurb is not a sentence`)
  }
})

test('an empty cycle sits at the first stage', () => {
  assert.equal(currentStage({}), 'kra')
})

test('the stage walks forward as each piece of evidence appears', () => {
  const steps: [Progress, string][] = [
    [{}, 'kra'],
    [{ kraSubmitted: true }, 'oneToOne'],
    [{ kraSubmitted: true, oneToOneBothConfirmed: true }, 'lock'],
    [{ kraApproved: true }, 'self'],
    [{ kraApproved: true, selfSubmitted: true }, 'review'],
    [{ rmL1Done: true }, 'review'],
    [{ rmL2Done: true }, 'finalise'],
    [{ finalised: true }, 'result'],
    [{ published: true }, 'result'],
  ]
  for (const [p, want] of steps) assert.equal(currentStage(p), want, JSON.stringify(p))
})

test('the stage is DERIVED, so undoing a step moves it back', () => {
  // A stored stage column would be stuck at 'self' here. Unlocking a KRA set
  // for correction has to walk the cycle back, or the screen tells somebody
  // to rate against KRAs that are being rewritten.
  assert.equal(currentStage({ kraApproved: true }), 'self')
  assert.equal(currentStage({ kraApproved: false, kraSubmitted: true }), 'oneToOne')
})

// ── the stepper's states ─────────────────────────────────────────────────

test('stages behind the current one are done, ahead of it upcoming', () => {
  const st = stageStates(PERIOD, { kraApproved: true }, '2027-01-05')
  assert.equal(st.kra, 'done')
  assert.equal(st.oneToOne, 'done')
  assert.equal(st.lock, 'done')
  assert.equal(st.self, 'active')
  assert.equal(st.review, 'upcoming')
  assert.equal(st.result, 'upcoming')
})

test('BLOCKED is the state that teaches: the window is open, the work is not possible', () => {
  // Self-rating window is open, but the KRAs were never approved. Without
  // this state the stepper says "active" and the reader hunts for a control
  // that is correctly disabled, with nothing saying why.
  const st = stageStates(PERIOD, { kraSubmitted: true, oneToOneBothConfirmed: true }, '2027-01-05')
  assert.equal(currentStage({ kraSubmitted: true, oneToOneBothConfirmed: true }), 'lock')
  assert.equal(st.lock, 'active')

  const stalled = stageStates(PERIOD, { kraApproved: true }, '2027-01-15')
  assert.equal(stalled.self, 'blocked', 'self window closed with nothing submitted')
})

test('a stage whose window has not started is upcoming, not blocked', () => {
  const st = stageStates(PERIOD, { kraApproved: true }, '2026-11-15')
  assert.equal(st.self, 'upcoming')
})

test('a missing window never locks anybody out', () => {
  // An unconfigured period is a config gap, not a reason to freeze somebody
  // out of their own appraisal.
  const bare: Period = { label: 'unconfigured' }
  const st = stageStates(bare, {}, TODAY)
  assert.equal(st.kra, 'active')
  assert.equal(inWindow(undefined, TODAY), true)
})

// ── the KRA rules ────────────────────────────────────────────────────────

test('a KRA set is valid only on both count AND weightage', () => {
  assert.equal(kraSetValid({ kraCount: 6, weightageTotal: 100 }), true)
  assert.equal(kraSetValid({ kraCount: 3, weightageTotal: 100 }), false, 'under the minimum')
  assert.equal(kraSetValid({ kraCount: 11, weightageTotal: 100 }), false, 'over the maximum')
  assert.equal(kraSetValid({ kraCount: 6, weightageTotal: 95 }), false, 'weightage short')
  assert.equal(kraSetValid({ kraCount: 6, weightageTotal: 105 }), false, 'weightage over')
  assert.equal(kraSetValid({}), false, 'nothing written yet')
})

// ── what am I told to do ─────────────────────────────────────────────────

const act = (p: Progress, roles = { isEmployee: true }, q = {}, today = TODAY) =>
  nextAction(PERIOD, p, roles, q, today)

test('a blank cycle tells you to write KRAs, and states both rules', () => {
  const a = act({})!
  assert.equal(a.tab, 'mine')
  assert.match(a.title, /Write your KRAs/)
  // The numbers must be IN the sentence — "between 4 and 10" and "exactly
  // 100". A reader should not have to find the policy screen to learn them.
  assert.match(a.why, /4/)
  assert.match(a.why, /10/)
  assert.match(a.why, /100/)
})

test('a half-finished set says exactly what is short, not just "invalid"', () => {
  const few = act({ kraCount: 2, weightageTotal: 100 })!
  assert.match(few.why, /2 of at least 4/)

  const heavy = act({ kraCount: 6, weightageTotal: 90 })!
  assert.match(heavy.why, /adds to 90, not 100/)

  const many = act({ kraCount: 12, weightageTotal: 100 })!
  assert.match(many.why, /12, more than the 10/)
})

test('a valid unsent set asks you to send it', () => {
  const a = act({ kraCount: 6, weightageTotal: 100 })!
  assert.match(a.title, /Send your KRAs/)
  assert.match(a.why, /6 KRAs totalling 100/)
})

test('waiting on somebody else says so, and says what it is waiting FOR', () => {
  // The worst version of this screen shows a disabled button and no reason.
  const a = act({ kraSubmitted: true, oneToOneBothConfirmed: true })!
  assert.ok(a.blockedBy, 'no blockedBy on a blocked action')
  assert.match(a.blockedBy!, /not been approved/)
  assert.match(a.why, /opens once your manager approves/)
})

test('an open self-rating window asks for the rating', () => {
  const a = nextAction(PERIOD, { kraApproved: true }, { isEmployee: true }, {}, '2027-01-05')!
  assert.equal(a.tab, 'self')
  assert.match(a.title, /Rate yourself/)
})

test('urgency escalates as the window closes, and flips overdue past it', () => {
  const p: Progress = { kraApproved: true }
  assert.equal(nextAction(PERIOD, p, { isEmployee: true }, {}, '2027-01-02')!.urgency, 'info')
  assert.equal(nextAction(PERIOD, p, { isEmployee: true }, {}, '2027-01-08')!.urgency, 'due')
  // Past the close the action is still shown — the work does not stop being
  // owed because the window shut — and it is OVERDUE, not merely info. This
  // line asserted 'info' when it was written, which is exactly the bug the
  // before/after test below was added to kill: a missed deadline that reads
  // as relaxed.
  const late = nextAction(PERIOD, p, { isEmployee: true }, {}, '2027-01-14')!
  assert.equal(late.urgency, 'overdue')
  assert.ok(late.blockedBy)
})

test('YOUR OWN work outranks other people\'s queues', () => {
  // Somebody who is both an RM and an employee. Their own missing self
  // rating is the one nobody else can unblock; a queue of ten is volume.
  const a = nextAction(PERIOD,
    { kraApproved: true },
    { isEmployee: true, isRM: true },
    { kraApprovals: 10, ratingsDue: 4 },
    '2027-01-05')!
  assert.match(a.title, /Rate yourself/)
})

test('once their own is done, the RM is pointed at the queue that blocks others', () => {
  // Approvals before ratings: an unapproved KRA set stops that person from
  // doing anything at all, an unrated one only stops the manager.
  const a = nextAction(PERIOD,
    { kraApproved: true, selfSubmitted: true },
    { isEmployee: true, isRM: true },
    { kraApprovals: 3, ratingsDue: 4 },
    '2027-01-05')!
  assert.match(a.title, /Approve 3 KRA sets/)
  assert.match(a.why, /cannot start rating themselves/)
})

test('singular and plural both read correctly', () => {
  const one = nextAction(PERIOD, { kraApproved: true, selfSubmitted: true },
    { isRM: true, isEmployee: false }, { kraApprovals: 1 }, TODAY)!
  assert.match(one.title, /Approve 1 KRA set$/)
  const many = nextAction(PERIOD, { kraApproved: true, selfSubmitted: true },
    { isRM: true, isEmployee: false }, { kraApprovals: 2 }, TODAY)!
  assert.match(many.title, /Approve 2 KRA sets$/)
})

test('the HOD is pointed at finalisation, HR at the people who never started', () => {
  const hod = nextAction(PERIOD, { published: true }, { isHOD: true, isEmployee: false },
    { finalisationsDue: 12 }, '2027-01-25')!
  assert.match(hod.title, /Finalise 12 ratings/)
  assert.equal(hod.tab, 'dept')

  const hr = nextAction(PERIOD, { published: true }, { isHRAdmin: true, isEmployee: false },
    { notStartedInDept: 7 }, TODAY)!
  assert.match(hr.title, /7 people have not written KRAs/)
  assert.equal(hr.tab, 'fill')
})

test('nothing owed returns null rather than inventing busywork', () => {
  assert.equal(nextAction(PERIOD, { published: true }, { isEmployee: true }, {}, TODAY), null)
  assert.equal(nextAction(PERIOD, { published: true }, { isEmployee: true, isRM: true },
    { kraApprovals: 0, ratingsDue: 0 }, TODAY), null)
})

test('every action is actionable: a title, a reason, a control and a tab', () => {
  // Guards the shape rather than the wording. An action with no cta is a
  // dead end, and one with no `why` is an instruction without a reason —
  // which is the thing this redesign exists to remove.
  const cases: [Progress, object, object][] = [
    [{}, { isEmployee: true }, {}],
    [{ kraCount: 2 }, { isEmployee: true }, {}],
    [{ kraCount: 6, weightageTotal: 100 }, { isEmployee: true }, {}],
    [{ kraSubmitted: true }, { isEmployee: true }, {}],
    [{ kraApproved: true }, { isEmployee: true }, {}],
    [{ published: true }, { isRM: true }, { kraApprovals: 2 }],
    [{ published: true }, { isRM: true }, { ratingsDue: 2 }],
    [{ published: true }, { isHOD: true }, { finalisationsDue: 2 }],
    [{ published: true }, { isHRAdmin: true }, { notStartedInDept: 2 }],
  ]
  for (const [p, roles, q] of cases) {
    const a = nextAction(PERIOD, p, roles, q, TODAY)
    assert.ok(a, JSON.stringify([p, roles, q]))
    assert.ok(a!.title.length > 5, 'title')
    assert.ok(a!.why.length > 25, `why too thin: ${a!.why}`)
    assert.ok(a!.cta.length > 3, 'cta')
    assert.ok(a!.tab.length > 2, 'tab')
  }
})

test('no instruction is written in jargon the reader has not been given', () => {
  // "KRA" is taught by the first action's own sentence. These are the words
  // that would send somebody to ask a colleague what the screen means.
  const banned = /\bPGRST|\bpms_|\bnull\b|\bundefined\b|RM L1 ->|weightage_total/i
  const cases: [Progress, object, object][] = [
    [{}, { isEmployee: true }, {}],
    [{ kraCount: 3 }, { isEmployee: true }, {}],
    [{ kraSubmitted: true }, { isEmployee: true }, {}],
    [{ kraApproved: true }, { isEmployee: true }, {}],
    [{ published: true }, { isHOD: true }, { finalisationsDue: 1 }],
  ]
  for (const [p, roles, q] of cases) {
    const a = nextAction(PERIOD, p, roles, q, TODAY)!
    assert.doesNotMatch(a.title + ' ' + a.why + ' ' + a.cta, banned, a.why)
  }
})

// ── dates ────────────────────────────────────────────────────────────────

test('daysLeft counts to the close and goes negative after it', () => {
  assert.equal(daysLeft({ from: '2027-01-01', to: '2027-01-10' }, '2027-01-01'), 9)
  assert.equal(daysLeft({ from: '2027-01-01', to: '2027-01-10' }, '2027-01-10'), 0)
  assert.equal(daysLeft({ from: '2027-01-01', to: '2027-01-10' }, '2027-01-13'), -3)
  assert.equal(daysLeft(undefined, TODAY), null)
})

test('window edges are inclusive on both sides', () => {
  const w = { from: '2027-01-01', to: '2027-01-10' }
  assert.equal(inWindow(w, '2026-12-31'), false)
  assert.equal(inWindow(w, '2027-01-01'), true)
  assert.equal(inWindow(w, '2027-01-10'), true)
  assert.equal(inWindow(w, '2027-01-11'), false)
})

test('the default rules match the shipped policy', () => {
  assert.deepEqual(DEFAULT_RULES,
    { minKra: 4, maxKra: 10, totalWeightage: 100, minWeightagePerKra: 5 })
})

test('dates shown to a reader are human, never ISO', () => {
  // A deadline printed as 2027-01-01 is storage leaking into the interface.
  assert.equal(humanDate('2027-01-01'), '1 Jan 2027')
  assert.equal(humanDate('2026-12-31'), '31 Dec 2026')
  assert.equal(humanDate(undefined), '')
  assert.equal(humanDate('not a date'), 'not a date')

  const early = nextAction(PERIOD, { kraApproved: true }, { isEmployee: true }, {}, '2026-11-15')!
  assert.doesNotMatch(early.why, /\d{4}-\d{2}-\d{2}/, 'ISO date leaked into an instruction')
  assert.match(early.why, /1 Jan 2027/)
})

test('BEFORE and AFTER a closed window are never the same message', () => {
  // Telling somebody who has MISSED the deadline that it "has not started"
  // is worse than silence: it tells them to relax on the day they should be
  // talking to their manager.
  const before = nextAction(PERIOD, { kraApproved: true }, { isEmployee: true }, {}, '2026-12-20')!
  const after  = nextAction(PERIOD, { kraApproved: true }, { isEmployee: true }, {}, '2027-01-14')!

  assert.match(before.title, /not open yet/)
  assert.equal(before.urgency, 'info')

  assert.match(after.title, /missed/i)
  assert.equal(after.urgency, 'overdue')
  assert.match(after.blockedBy!, /closed on 10 Jan 2027/)
  assert.doesNotMatch(after.why, /not started|not open yet/i)
  assert.notEqual(before.title, after.title)
})

test('a missed window still offers a way forward, not just a scolding', () => {
  const after = nextAction(PERIOD, { kraApproved: true }, { isEmployee: true }, {}, '2027-01-14')!
  assert.match(after.cta, /reopen/i)
  assert.match(after.why, /manager/)
})
