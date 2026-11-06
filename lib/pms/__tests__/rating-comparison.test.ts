// The rating comparison panel: theirs, mine, the distance, and the reason.
//
// Requested: while rating during the approval process, an interactive panel
// showing what they rated themselves, what you rate them, the difference
// between the two, and asking for the reason — "like a window summary".
//
// TWO THINGS HERE ARE WORTH TESTING AND ONE OF THEM IS BORING.
//
// The boring one is the arithmetic, which is score()'s, already tested in
// rollup.test.ts. What is not boring is THE SIGN. compareRatings returns
// mine − self; gap() returns self − final. Those are opposite, deliberately,
// because they address different people. Get it backwards and the panel tells
// a manager they rated somebody UP when they rated them down — on the screen
// whose entire purpose is to make that judgement visible before it is
// recorded. Several tests below exist only to pin the direction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareRatings, gap } from '../scoring.ts'

const L = (goalId: string, weightage: number,
            self: number | null, mine: number | null, comment?: string) =>
  ({ goalId, title: `KRA ${goalId}`, weightage, self, mine, comment })

// ── the sign convention ───────────────────────────────────────────────────

test('rating them lower than they rated themselves is a NEGATIVE delta', () => {
  const s = compareRatings([L('a', 100, 5, 3)])
  assert.equal(s.lines[0].delta, -2)
  assert.equal(s.lower, 1)
  assert.equal(s.higher, 0)
})

test('rating them higher is a POSITIVE delta', () => {
  const s = compareRatings([L('a', 100, 2, 4)])
  assert.equal(s.lines[0].delta, 2)
  assert.equal(s.higher, 1)
  assert.equal(s.lower, 0)
})

test('the overall delta carries the same sign as the lines', () => {
  const s = compareRatings([L('a', 50, 5, 3), L('b', 50, 4, 3)])
  assert.ok(s.delta !== null && s.delta < 0,
    'scoring everybody down must not read as an overall increase')
})

test('it is the OPPOSITE sign to gap(), on purpose', () => {
  // gap() speaks to the employee: self − final. compareRatings speaks to the
  // rater: mine − self. The same facts, mirrored. If somebody ever "tidies"
  // one to match the other, this fails and says why.
  const self = 5, mine = 3
  assert.equal(gap(self, mine).delta, 2)
  assert.equal(compareRatings([L('a', 100, self, mine)]).lines[0].delta, -2)
})

// ── the flag comes from gap(), not from a second opinion ──────────────────

test('a two-point difference is a major gap, either direction', () => {
  assert.equal(compareRatings([L('a', 100, 5, 3)]).lines[0].flag, 'MAJOR_GAP')
  assert.equal(compareRatings([L('a', 100, 1, 3)]).lines[0].flag, 'MAJOR_GAP')
})

test('one point is minor, nil is aligned', () => {
  assert.equal(compareRatings([L('a', 100, 4, 3)]).lines[0].flag, 'MINOR_GAP')
  assert.equal(compareRatings([L('a', 100, 3, 3)]).lines[0].flag, 'ALIGNED')
})

test('the thresholds are gap()s — not restated here', () => {
  // Mutation guard: move gap()'s boundary and this must move with it, which
  // is only true if compareRatings delegates. Three thresholds would mean a
  // manager and an employee being shown different verdicts on one number.
  for (const [self, mine] of [[5, 3], [4, 3], [3, 3], [1, 4], [2, 2.5]]) {
    assert.equal(compareRatings([L('a', 100, self, mine)]).lines[0].flag,
                 gap(self, mine).flag, `self ${self} vs mine ${mine}`)
  }
})

// ── the reason ────────────────────────────────────────────────────────────

test('agreeing needs no reason', () => {
  const s = compareRatings([L('a', 100, 3, 3)])
  assert.equal(s.lines[0].needsReason, false)
  assert.deepEqual(s.missingReasons, [])
})

test('ANY difference needs a reason, including one point', () => {
  const s = compareRatings([L('a', 100, 4, 3)])
  assert.equal(s.lines[0].needsReason, true)
  assert.equal(s.missingReasons.length, 1)
})

test('a written reason clears it', () => {
  const s = compareRatings([L('a', 100, 5, 3, 'Target slipped two quarters.')])
  assert.equal(s.lines[0].needsReason, true, 'the difference is still a difference')
  assert.equal(s.lines[0].hasReason, true)
  assert.deepEqual(s.missingReasons, [])
})

test('whitespace is not a reason', () => {
  const s = compareRatings([L('a', 100, 5, 3, '   \n ')])
  assert.equal(s.missingReasons.length, 1)
})

test('an unrated line is not yet a difference', () => {
  // Demanding a reason for a rating nobody has given yet would block the
  // panel before the manager has done anything.
  const s = compareRatings([L('a', 100, 4, null)])
  assert.equal(s.lines[0].delta, null)
  assert.equal(s.lines[0].needsReason, false)
  assert.deepEqual(s.missingReasons, [])
})

test('a self rating nobody gave does not demand a reason either', () => {
  // The employee can submit without self-rating every line. Comparing
  // against nothing and calling it a gap would make the manager explain
  // their own rating against an absence.
  const s = compareRatings([L('a', 100, null, 4)])
  assert.equal(s.lines[0].delta, null)
  assert.equal(s.lines[0].needsReason, false)
})

// ── the totals ────────────────────────────────────────────────────────────

test('both scores are weighted, not averaged flat', () => {
  // 70/30 split. A flat mean would give 4; weighted gives 4.7.
  const s = compareRatings([L('a', 70, 5, 5), L('b', 30, 3, 3)])
  assert.equal(s.selfScore, 4.4)
  assert.equal(s.myScore, 4.4)
  assert.equal(s.delta, 0)
})

test('a partly-rated set still scores what is there', () => {
  const s = compareRatings([L('a', 50, 4, 4), L('b', 50, 4, null)])
  assert.equal(s.rated, 1)
  assert.equal(s.total, 2)
  assert.equal(s.myScore, 4, 'the unrated half must not count as zero')
})

test('counts add up to the rated lines', () => {
  const s = compareRatings([
    L('a', 25, 5, 3), L('b', 25, 3, 3), L('c', 25, 2, 4), L('d', 25, 4, null),
  ])
  assert.equal(s.lower, 1)
  assert.equal(s.agreed, 1)
  assert.equal(s.higher, 1)
  assert.equal(s.lower + s.agreed + s.higher, s.rated)
})

test('nothing at all does not throw', () => {
  const s = compareRatings([])
  assert.deepEqual(s.lines, [])
  assert.equal(s.selfScore, null)
  assert.equal(s.delta, null)
  assert.equal(s.total, 0)
})

// ── the panel is wired to it ──────────────────────────────────────────────

const TABS = readFileSync('components/pms/ManagerTabs.tsx', 'utf8')

test('the review panel uses compareRatings rather than subtracting inline', () => {
  assert.match(TABS, /compareRatings/,
    'the panel must read the comparison from scoring.ts')
})

test('approval is blocked while a difference is unexplained', () => {
  // The whole point of asking for the reason is that it is asked BEFORE the
  // rating is recorded. If `ready` does not consult missingReasons, the panel
  // is decoration.
  const ready = TABS.match(/const ready = [^\n]*/)
  assert.ok(ready, 'the readiness gate moved; this test needs updating')
  assert.match(ready![0], /reason|explained/i,
    `the gate does not mention reasons: ${ready![0]}`)
})

test('the panel shows all three numbers, not just the difference', () => {
  // "what they self rate them, what you rate them, whats the difference
  // between both" — three columns. A panel showing only the delta makes the
  // manager do the arithmetic backwards to see what they actually typed.
  //
  // READ OFF THE HEADER ROW, not the file. The first version of this asserted
  // TABS.includes('Difference') and passed with the column renamed to Delta,
  // because "Difference" also appears as a Stat label further down the file.
  // A test that matches anywhere in a 1,400-line file is not testing a table.
  const thead = TABS.match(
    /<th>KRA<\/th>[\s\S]{0,400}?<\/tr>\s*<\/thead>/)
  assert.ok(thead, 'the summary table header moved; this test needs updating')
  for (const label of ['Their rating', 'Your rating', 'Difference', 'Your reason']) {
    assert.ok(thead![0].includes(`>${label}<`),
      `the summary table has no "${label}" column: ${thead![0]}`)
  }
})
