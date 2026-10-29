// The HOD could not finalise, and there were two separate reasons.
//
// Reported: "HOD is unable to give final ratings, and log ratings should be
// activated after selecting a rating at HOD level."
//
// ── ONE: THE ROSTER NEVER ASKED ABOUT THE HOD RUNG ───────────────────────
//
// Rating and approving happen in KRA Approval & One-to-One. That screen is
// fed by the manager roster, which selected on rm_l1_id and rm_l2_id and
// nothing else. ChainApprovals shows a row only when
// `chainStage === rungFor(member, viewerId)` — and rungFor has always been
// able to return 'HOD'. The row simply never arrived for it to say so.
//
// MEASURED on the live database, Kiran Patel (STC9022):
//
//   appraisals where he is HOD           13
//   appraisals where he is RM L1 / L2     3
//   HOD-only, invisible in the roster    13
//
// One of those thirteen — Divya Singh — was sitting at his HOD rung with
// 199 reporting every preceding gate satisfied and a FINAL_REVIEW log
// already on record. There was no screen in the product that could rate her.
//
// ── TWO: CHOOSING AND SETTLING WERE ONE CONTROL ──────────────────────────
//
// On Review & Finalise the rating dropdown was disabled on canFinalise,
// which is false until the final-review one-to-one exists. A HOD whose only
// outstanding gate was that log saw a dead dropdown — which reads as "I am
// not allowed to rate", not as "log the meeting first".
//
// It also inverted the cycle. The final review is the conversation ABOUT
// the rating; being made to log it first asks somebody to minute a meeting
// whose conclusion they have not reached. Choose, log, settle.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finaliseQueue, type TeamMember } from '../team.ts'
import { rungFor } from '../chain.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PERF = read('components/ess/Performance.tsx')
const MGR = read('components/pms/ManagerTabs.tsx')

const HOD = 'hod-1'
const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  employeeId: 'e1', code: 'STC9032', name: 'Divya Singh',
  selfSubmitted: true, selfScore: 3.8,
  rmL1Id: 'rm1', rmL1Score: 3.9, rmL2Id: 'rm2', rmL2Score: 3.9,
  hodId: HOD, oneToOneDone: true, kraLocked: true,
  kraCount: 4, totalWeightage: 100, finalised: false, finalRating: null,
  finalReviewLogged: false, finalReviewDone: false,
  workflowStatus: 'RM_L2_DONE', chainStage: 'HOD',
  ...over,
} as TeamMember)

const QOPTS = { role: 'HOD' as const, chain: 'SELF_RM1_RM2_HOD' as const,
                whoCanFinalise: 'HOD_ONLY' as const, finalReviewRequired: true }

// ── one: the roster ──────────────────────────────────────────────────────

test('the manager roster selects on the HOD rung too', () => {
  assert.match(PERF,
    /rm_l1_id\.eq\.\$\{employeeId\},rm_l2_id\.eq\.\$\{employeeId\},hod_id\.eq\.\$\{employeeId\}/,
    'the roster still ignores hod_id, so nothing at the HOD rung reaches the approval queue')
})

test('the scope count asks the same question as the roster', () => {
  // It counted direct reportees while the roster returned everyone whose
  // chain names this person — a HOD saw "My team (5)" over a list of 18.
  const probe = PERF.slice(PERF.indexOf('const { count: reportees }'),
                           PERF.indexOf('const { count: reportees }') + 420)
  assert.match(probe, /hod_id\.eq\.\$\{employeeId\}/,
    'the label counts a different set of people than the list below it')
})

test('rungFor already answers HOD — it was never the problem', () => {
  // Worth pinning: the fix was upstream of this, and somebody reading the
  // bug report could reasonably have come here first.
  assert.equal(rungFor(member(), HOD), 'HOD')
  assert.equal(rungFor(member(), 'rm1'), 'RM_L1')
  assert.equal(rungFor(member(), 'nobody'), null)
})

test('a set at the HOD rung is the HOD\'s to act on', () => {
  // The exact condition ChainApprovals filters on.
  const m = member()
  assert.equal(m.chainStage, rungFor(m, HOD),
    'a set parked at HOD does not match the HOD viewing it')
})

// ── two: choose, log, settle ─────────────────────────────────────────────

test('the rating can be chosen before the final review is logged', () => {
  const [r] = finaliseQueue([member({ finalReviewLogged: false })], '2026-10-29', QOPTS)
  assert.equal(r.canChoose, true,
    'the HOD cannot even pick a number until the meeting is minuted')
  assert.equal(r.canFinalise, false,
    'the rating can be SETTLED without the final review on record')
})

test('once logged, the same row can be settled', () => {
  const [r] = finaliseQueue([member({ finalReviewLogged: true })], '2026-10-29', QOPTS)
  assert.equal(r.canChoose, true)
  assert.equal(r.canFinalise, true, 'a logged final review still cannot be settled')
})

test('neither is offered while the chain ahead is unfinished', () => {
  // 199 refuses an early FINAL_REVIEW with a database exception, so the log
  // button must be withheld — and a number chosen against a half-rated set
  // is a number nobody can act on.
  for (const gap of [{ rmL1Score: null }, { rmL2Score: null },
                     { selfSubmitted: false }, { kraLocked: false },
                     { oneToOneDone: false }]) {
    const [r] = finaliseQueue([member(gap)], '2026-10-29', QOPTS)
    assert.equal(r.canChoose, false, `choosing is offered despite ${JSON.stringify(gap)}`)
    assert.equal(r.canFinalise, false, `settling is offered despite ${JSON.stringify(gap)}`)
    assert.ok(r.insteadDo, `nothing explains the block for ${JSON.stringify(gap)}`)
  }
})

test('a role that cannot finalise cannot choose either', () => {
  // Offering the dropdown to somebody whose role may not settle the rating
  // is a form that ends in a refusal.
  const [r] = finaliseQueue([member()], '2026-10-29',
    { ...QOPTS, role: 'RM_L1' as const })
  assert.equal(r.canChoose, false)
  assert.match(r.insteadDo ?? '', /cannot finalise under this policy/)
})

test('choosing is never wider than settling plus the log', () => {
  // canChoose exists to open exactly ONE gate earlier than canFinalise —
  // the final review — and no others. Stated plainly: with the log in
  // place the two must agree; without it, settling must be shut while
  // choosing follows whatever the rest of the chain says.
  for (const l1 of [3.9, null]) {
    const withLog = finaliseQueue([member({ finalReviewLogged: true, rmL1Score: l1 })],
                                  '2026-10-29', QOPTS)[0]
    assert.equal(withLog.canFinalise, withLog.canChoose,
      `with the log on record the two gates disagree (l1=${l1})`)

    const noLog = finaliseQueue([member({ finalReviewLogged: false, rmL1Score: l1 })],
                                '2026-10-29', QOPTS)[0]
    assert.equal(noLog.canFinalise, false,
      `settling is allowed with no final review on record (l1=${l1})`)
    assert.equal(noLog.canChoose, withLog.canChoose,
      `the log is changing whether a rating may be CHOSEN (l1=${l1})`)
  }
})

// ── the screen follows that order ────────────────────────────────────────

test('the dropdown opens on choosing, not on settling', () => {
  assert.match(MGR, /disabled=\{!r\.canChoose\}/,
    'the rating dropdown is still disabled until the final review is logged')
  assert.ok(!/disabled=\{!r\.canFinalise\}/.test(MGR),
    'something is still gated on canFinalise that should gate on canChoose')
})

test('the log button waits for a rating', () => {
  assert.match(MGR, /disabled=\{!onLogFinalReview \|\| saving\s*\n?\s*\|\| !picked\[r\.member\.employeeId\]\}/,
    'the final review can be logged before a rating has been chosen')
})

test('and says why it is waiting', () => {
  // A disabled button with no sentence is the thing that made this bug look
  // like a permission problem in the first place.
  assert.match(MGR, /Choose the rating first — this records the\s*\n?\s*conversation about it\./,
    'the disabled log button does not say what it is waiting for')
})

test('the finalise button still needs the rating it will settle', () => {
  assert.match(MGR, /disabled=\{!picked\[r\.member\.employeeId\] \|\| !onFinalise \|\| saving\}/,
    'finalise can be pressed without a rating')
})
