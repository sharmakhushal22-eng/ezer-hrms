// Rules 10 and 11, now enforced on the rater's side of the form.
//
// Requested: "mandatory remarks by r1, r2, hod should be in effect". They
// were not.
//
// pms_rating_scale has carried min_comment_chars and
// improvement_feedback_mandatory per band since migration 066. On this
// company's seeded scale:
//
//   5 Outstanding            200 chars   improvement not mandatory
//   4 Exceeds Expectations   100
//   3 Meets Expectations      50
//   2 Needs Improvement      200         improvement MANDATORY
//   1 Unsatisfactory         200         improvement MANDATORY
//
// The only screen that ever read them was HR's publish workspace, through
// checkFeedback. The rating form itself checked nothing, so a rater could
// settle a 1 on an employee with no words at all.
//
// MEASURED rather than assumed: Isha Nair SRS9057 was taken through the
// entire chain and arrived at the HOD with 8 of her 12 ratings carrying any
// comment.
//
// THE BAND COMES FROM THE SCORE, NOT A ROUNDED RATING — bandForScore reads
// the scale's own windows, which is what makes 3.50 and 3.51 different
// bands. Rounding disagrees with them at every boundary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRaterRemark, checkFeedback, type Band } from '../scoring.ts'

const MGR = readFileSync(join(process.cwd(), 'components/pms/ManagerTabs.tsx'), 'utf8')

/** The seeded scale, windows and all. */
const SCALE: Band[] = [
  { value: 5, label: 'Outstanding',          improvementMandatory: false, minCommentChars: 200, scoreFrom: 4.51, scoreTo: 5 },
  { value: 4, label: 'Exceeds Expectations', improvementMandatory: false, minCommentChars: 100, scoreFrom: 3.51, scoreTo: 4.5 },
  { value: 3, label: 'Meets Expectations',   improvementMandatory: false, minCommentChars: 50,  scoreFrom: 2.51, scoreTo: 3.5 },
  { value: 2, label: 'Needs Improvement',    improvementMandatory: true,  minCommentChars: 200, scoreFrom: 1.51, scoreTo: 2.5 },
  { value: 1, label: 'Unsatisfactory',       improvementMandatory: true,  minCommentChars: 200, scoreFrom: 1,    scoreTo: 1.5 },
]
const chars = (n: number) => 'x'.repeat(n)

// ── the demand follows the band ──────────────────────────────────────────

test('each band asks for what the scale says it asks for', () => {
  for (const [score, need] of [[4.8, 200], [4.0, 100], [3.0, 50], [2.0, 200], [1.2, 200]]) {
    assert.equal(checkRaterRemark(score, '', SCALE).need, need,
      `a score of ${score} asks for the wrong number of characters`)
  }
})

test('the window decides the band, not rounding', () => {
  // 3.50 and 3.51 round to the same number and sit in different bands. This
  // is the whole reason pms_rating_scale stores windows.
  assert.equal(checkRaterRemark(3.50, '', SCALE).band!.value, 3)
  assert.equal(checkRaterRemark(3.51, '', SCALE).band!.value, 4)
  assert.equal(checkRaterRemark(2.50, '', SCALE).band!.value, 2)
  assert.equal(checkRaterRemark(2.51, '', SCALE).band!.value, 3)
})

test('a low band demands MORE words than a high one', () => {
  // The rating somebody may have to defend is the one that needs defending.
  assert.ok(checkRaterRemark(1.2, '', SCALE).need > checkRaterRemark(3.0, '', SCALE).need)
  assert.ok(checkRaterRemark(2.0, '', SCALE).need > checkRaterRemark(4.0, '', SCALE).need)
})

// ── what it refuses ──────────────────────────────────────────────────────

test('an empty remark is refused at every band', () => {
  for (const s of [4.8, 4.0, 3.0, 2.0, 1.2]) {
    const r = checkRaterRemark(s, '', SCALE)
    assert.equal(r.ok, false, `a score of ${s} passes with no remark`)
    assert.ok(r.fault, 'nothing explains the refusal')
  }
})

test('whitespace is not a remark', () => {
  assert.equal(checkRaterRemark(3.0, '   \n\t ', SCALE).ok, false)
  assert.equal(checkRaterRemark(3.0, '   \n\t ', SCALE).have, 0)
})

test('a short remark says how many more are needed', () => {
  const r = checkRaterRemark(3.0, chars(30), SCALE)
  assert.equal(r.ok, false)
  assert.equal(r.have, 30)
  assert.equal(r.need, 50)
  assert.match(r.fault!, /20 more characters/)
})

test('one short of the demand still fails, and says "1 more character"', () => {
  // Off-by-one at the boundary, and the singular — a message reading
  // "1 more characters" is the kind of thing nobody fixes later.
  const r = checkRaterRemark(3.0, chars(49), SCALE)
  assert.equal(r.ok, false)
  assert.match(r.fault!, /1 more character —/)
  assert.ok(!/1 more characters/.test(r.fault!))
})

test('exactly the demand passes', () => {
  assert.equal(checkRaterRemark(3.0, chars(50), SCALE).ok, true)
  assert.equal(checkRaterRemark(4.0, chars(100), SCALE).ok, true)
  assert.equal(checkRaterRemark(4.8, chars(200), SCALE).ok, true)
})

test('a mandatory-improvement band says so in the empty message', () => {
  // At 2 and 1 the remark is not just longer, it has to say what would
  // change — and the person being asked should be told that up front.
  const r = checkRaterRemark(1.2, '', SCALE)
  assert.equal(r.improvementNeeded, true)
  assert.match(r.fault!, /what would change/)
  // And a high band does not claim it.
  assert.equal(checkRaterRemark(4.8, '', SCALE).improvementNeeded, false)
  assert.ok(!/what would change/.test(checkRaterRemark(4.8, '', SCALE).fault!))
})

// ── before there is a score ──────────────────────────────────────────────

test('no score means nothing is owed yet', () => {
  // The gate that insists every KRA is rated covers this; demanding 200
  // characters before anything is scored would be a blocker with no band
  // behind it.
  const r = checkRaterRemark(null, '', SCALE)
  assert.equal(r.ok, true)
  assert.equal(r.band, null)
  assert.equal(r.need, 0)
  assert.equal(r.fault, null)
})

test('a score outside every window still lands in a band', () => {
  // bandForScore clamps rather than returning nothing, so a 5.01 rounding
  // artefact is not nameless.
  assert.ok(checkRaterRemark(5.4, '', SCALE).band)
  assert.ok(checkRaterRemark(0.2, '', SCALE).band)
})

test('an empty scale demands nothing rather than crashing', () => {
  const r = checkRaterRemark(3.0, '', [])
  assert.equal(r.ok, true)
  assert.equal(r.band, null)
})

// ── one source for the thresholds ────────────────────────────────────────

test('it reads the same numbers the publish screen does', () => {
  // A second definition of "200 characters at Outstanding" would eventually
  // disagree with checkFeedback about the same remark. Both must move when
  // the band moves.
  const tweaked = SCALE.map(b => b.value === 3 ? { ...b, minCommentChars: 999 } : b)
  assert.equal(checkRaterRemark(3.0, chars(50), tweaked).ok, false,
    'the rater check ignored a changed threshold')
  assert.equal(checkFeedback(3, { appreciation: chars(50) }, tweaked).ok, false,
    'the publish check ignored the same changed threshold')
})

// ── it is actually wired into the gate ───────────────────────────────────

test('approving is blocked until the remark is written', () => {
  // A rule computed and not applied is decoration — this is the assertion
  // that makes it real.
  const ready = MGR.match(/const ready = [^\n]*/)
  assert.ok(ready, 'the readiness gate moved; this test needs updating')
  assert.match(ready![0], /remark\.ok/,
    `the gate does not consult the remark rule: ${ready![0]}`)
})

test('the blockers name it, long and short', () => {
  assert.match(MGR, /\{!remark\.ok && <li>\{remark\.fault\}<\/li>\}/,
    'the banner does not say what the remark owes')
  assert.match(MGR, /Overall remark \{remark\.have\}\/\{remark\.need\}/,
    'the pinned strip does not show the shortfall')
})

test('the field shows the demand live, not only on refusal', () => {
  // A length rule that speaks only on submission makes somebody write blind
  // and then be told they are short.
  assert.match(MGR, /\{r\.have\} \/ \{r\.need\} characters/,
    'the remark field has no live counter')
  assert.match(MGR, /which asks for \{r\.need\}/,
    'the counter does not say which band is asking')
})
