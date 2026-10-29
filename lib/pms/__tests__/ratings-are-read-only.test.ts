// Rating happens in ONE place, and this screen is not it.
//
// Requested: "nobody can give a rating from Rate My Team — it is just for
// reference of R1, R2, HOD, to show how much rating is given by each. Rating
// will only be given while approving the KRA from KRA Approval &
// One-to-One."
//
// WHY THIS IS A CORRECTNESS RULE AND NOT A PREFERENCE.
//
// Two doors into one act is what kept stalling the chain. 199 refuses to let
// a rung settle anything until every rung ahead has rated, so a manager who
// approved without first visiting the rating tab passed the set up and
// blocked it at the next desk — with nothing on either screen explaining
// why. Reading a KRA, scoring it and approving it are one judgement.
//
// The old tab could also offer a form nobody had the authority to submit: a
// manager opening it for somebody two rungs down got a rating form,
// pms_reviews would have accepted the row, and 197 would then have refused
// the approval it was written for.
//
// So the tests below are mostly one assertion said several ways — there is
// no way to write a rating from this screen — plus the thing that replaces
// it: every rung's rating, side by side, read-only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')

/** RateTab's source, from its declaration to the next section. */
const TAB = MGR.slice(MGR.indexOf('export function RateTab('),
                      MGR.indexOf('// ── §4.4 PIP Request'))

// ── nothing here writes ──────────────────────────────────────────────────

test('the tab takes no handler that could save a rating', () => {
  const sig = TAB.slice(0, TAB.indexOf('}) {'))
  for (const prop of ['onChange', 'onSubmit', 'onOverallComment', 'saving']) {
    assert.ok(!sig.includes(prop),
      `RateTab still accepts ${prop}, so something can write from this screen`)
  }
})

test('there is no rating control on the screen', () => {
  // The chips are how a rating was given. Their absence is the rule.
  assert.ok(!/className="chips"|<RatingChips/.test(TAB),
    'the rating chips are still rendered on the record screen')
  assert.ok(!/role="radiogroup"/.test(TAB), 'there is still a rating group here')
})

test('there is no text input of any kind', () => {
  // The per-KRA comment and the overall comment were both typed here.
  assert.ok(!/<input|<textarea/.test(TAB),
    'the record screen still has a field somebody can type into')
})

test('nothing on it submits', () => {
  assert.ok(!/Submit my rating|onSubmit|disabled=\{unrated/.test(TAB),
    'the record screen still has a submit path')
})

test('the tab no longer calls itself a rating task', () => {
  // "Rate My Team" on a screen that cannot rate is the kind of label that
  // sends somebody looking for a button that is not there.
  const tabs = MGR.slice(MGR.indexOf('export const MGR_TABS'),
                         MGR.indexOf('export const HOD_TABS'))
  assert.ok(!/Rate My Team/.test(tabs), 'the tab is still called "Rate My Team"')
  assert.match(tabs, /label: 'Team Ratings'/, 'the tab has no name')
  assert.match(tabs, /read-only/, 'the tab blurb does not say it is a record')
})

test('it says where ratings are actually given', () => {
  // A read-only screen that does not name the writable one leaves the
  // reader hunting for the form that used to be here.
  assert.match(TAB, /KRA Approval &amp; One-to-One/,
    'the record screen does not point at where rating happens')
  assert.match(TAB, /a record, not a form/,
    'the record screen does not say what it is')
})

// ── what it shows instead ────────────────────────────────────────────────

test('every rung of the chain gets a column', () => {
  assert.match(MGR, /export const CHAIN_RATERS: RaterRole\[\] = \['RM_L1', 'RM_L2', 'HOD'\]/,
    'the chain raters are not listed')
  assert.match(TAB, /raters\.map\(r => <th key=\{r\} className="num">/,
    'the table does not have one column per rung')
})

test('a rung nobody holds and nobody rated gets no column', () => {
  // A collapsed reporting line has no RM L2 for 190 of 395 enrolments. A
  // column of dashes headed RM L2 invites the reader to wonder who is late
  // rather than telling them nobody holds it.
  //
  // "and nobody rated" is the other half, and the two are tested together
  // because they are one expression: see the next test for why an empty
  // rung that HAS a rating must still get its column.
  assert.match(TAB, /const raters = CHAIN_RATERS\.filter\(\s*\n?\s*r => held\(r as Stage\)/,
    'the table draws columns for rungs nobody occupies')
})

test('a rating is never hidden because nobody holds that rung now', () => {
  // Holding the rung is not the only way a row gets into pms_reviews: the
  // chain snapshot can be re-resolved, a manager can move, and a chain
  // cleared afterwards leaves ratings behind that nobody now occupies.
  // Hiding the column would hide a REAL RATING somebody gave, which is the
  // one thing a record screen must never do.
  assert.match(TAB,
    /held\(r as Stage\) \|\| rows\.some\(x => x\.by\[r\]\?\.rating != null\)/,
    'a column is dropped on the strength of the chain alone, so an orphaned rating disappears')
})

test('a rung that has not rated shows a dash, not a zero', () => {
  // A zero is a judgement. "Not yet" is not.
  const dot = MGR.slice(MGR.indexOf('function RatingDot('),
                        MGR.indexOf('function RatingDot(') + 900)
  assert.match(dot, /if \(v === null \|\| v === undefined\) return <span className="k">—<\/span>/,
    'an unrated cell renders as something other than a dash')
})

test('the ratings are coloured on the same ramp as the review panel', () => {
  // A 2 that was orange while being given must not be a different orange
  // when it is read back, or the two screens disagree about one number.
  const dot = MGR.slice(MGR.indexOf('function RatingDot('),
                        MGR.indexOf('function RatingDot(') + 900)
  assert.match(dot, /toneVars\(ratingTone\(v, bands\)\)/,
    'the record screen has its own colours')
})

test('the comments are shown, not just the numbers', () => {
  // A column of numbers says the chain disagreed; only the sentences say
  // why, and this is the one screen where all of them sit together.
  assert.match(TAB, /\.filter\(w => r\.by\[w\]\?\.comment\?\.trim\(\)\)/,
    'the record screen drops what each rung actually wrote')
})

// ── the data comes back by ROLE ──────────────────────────────────────────

test('the loader reads every rung, not just the viewer', () => {
  assert.match(PERF, /\.in\('rater_role', \['SELF', \.\.\.CHAIN_RATERS\]\)/,
    'the loader still reads a subset of the chain')
})

test('rows are kept apart by role, not by who wrote them', () => {
  // It used to sort rows into "mine" and "other" by rater_id, because only
  // one row on the screen was editable. Nothing is editable now, and
  // pms_reviews is unique on the ROLE.
  const loader = PERF.slice(PERF.indexOf("EVERY RUNG'S RATING"),
                            PERF.indexOf("EVERY RUNG'S RATING") + 2200)
  assert.match(loader, /const role = String\(row\.rater_role\) as RaterRole/,
    'the loader does not key the ratings by role')
  assert.ok(!/'MINE'|'OTHER'/.test(loader),
    'the loader still sorts rows into mine and theirs')
})

// ── the capability that moved rather than died ───────────────────────────

test('the overall comment did not disappear with the form', () => {
  // It was collected by the rating tab and saved by submitRating. Deleting
  // it would have quietly dropped the one piece of prose an RM writes for
  // their reportee, and pms_feedback.rm_overall_comment exists for it (189).
  assert.match(PERF, /const saveOverall = async/,
    'the overall comment has no writer any more')
  assert.match(PERF, /rm_overall_comment: overall\.trim\(\)/,
    'the overall comment is not saved')
  assert.match(PERF, /rm_overall_by: employeeId/,
    'the overall comment does not record who wrote it')
})

test('it is written as part of approving, where the rating now is', () => {
  const ra = PERF.slice(PERF.indexOf('const rateAndApprove'),
                        PERF.indexOf('const approveInChain'))
  assert.match(ra, /await saveOverall\(id, myRung\)/,
    'approving does not save the overall comment')
  // Before the approval: a failure must stop the chain moving rather than
  // leave the comment behind a set that has already gone up.
  assert.ok(ra.indexOf('saveOverall') < ra.indexOf('approveInChain('),
    'the comment is saved after the set has already been sent on')
})

test('the panel that rates is the panel that takes the comment', () => {
  assert.match(MGR, /<textarea id="rm-overall"/,
    'the approval panel has no overall comment field')
  assert.match(MGR, /overallComment\?: string/,
    'KraDetail does not accept an overall comment')
})

test('submitRating is gone, not merely unreachable', () => {
  // A dead writer left in place is one refactor away from being wired up
  // again by somebody who assumes it was meant to be there.
  assert.ok(!/const submitRating/.test(PERF),
    'the old rating submitter is still in the file')
})
