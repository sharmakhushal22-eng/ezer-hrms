// What a score invites: a PIP at one end, recognition at the other.
//
// Requested: when R1, R2 or the HOD rates somebody very low, an optional
// checkbox asking whether to issue a PIP; when they rate somebody high, a
// box for a bonus, promotion or other recognition. Both reach the HR Head,
// who publishes and acts.
//
// ── WHICH END IS WHICH IS CONFIGURATION ──────────────────────────────────
//
// The request said "you say rating > 2", deferring the threshold.
// pms_rating_scale.allows_pip_request has decided the low end since 066 —
// seeded true at bands 2 and 1 — and 209 adds allows_recognition as its
// mirror, seeded true for the top two.
//
// A hardcoded "below 2" would mean something different on a three-point or
// ten-point scale, which is one admin setting away. The same trap the
// colour ramp avoided by normalising against the bands in play.
//
// ── ONE PROMPT PER APPRAISAL ─────────────────────────────────────────────
//
// From the rater's own WEIGHTED score through the scale's windows, not per
// KRA. That was the chosen reading, and it is the defensible one: a single
// bad KRA inside a good year is not a performance plan.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scoreInvites, checkPip, checkRecognition, defaultPipWindow,
         RECOGNITION_KINDS, RECOGNITION_LABEL,
         MIN_PIP_REASON, MIN_RECOGNITION_NOTE } from '../training.ts'
import { bandsFromScale, type Band } from '../scoring.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/209_pms_allows_recognition.sql')
const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')
const ROUTE = read('app/api/pms/admin/route.ts')
const EDITOR = read('components/pms/AdminEditor.tsx')

/** The seeded scale once 209 has run. */
const SCALE: Band[] = [
  { value: 5, label: 'Outstanding',          improvementMandatory: false, minCommentChars: 200, scoreFrom: 4.51, scoreTo: 5,   allowsPip: false, allowsRecognition: true },
  { value: 4, label: 'Exceeds Expectations', improvementMandatory: false, minCommentChars: 100, scoreFrom: 3.51, scoreTo: 4.5, allowsPip: false, allowsRecognition: true },
  { value: 3, label: 'Meets Expectations',   improvementMandatory: false, minCommentChars: 50,  scoreFrom: 2.51, scoreTo: 3.5, allowsPip: false, allowsRecognition: false },
  { value: 2, label: 'Needs Improvement',    improvementMandatory: true,  minCommentChars: 200, scoreFrom: 1.51, scoreTo: 2.5, allowsPip: true,  allowsRecognition: false },
  { value: 1, label: 'Unsatisfactory',       improvementMandatory: true,  minCommentChars: 200, scoreFrom: 1,    scoreTo: 1.5, allowsPip: true,  allowsRecognition: false },
]
const chars = (n: number) => 'x'.repeat(n)

// ── which score invites what ─────────────────────────────────────────────

test('a low score invites a PIP and not recognition', () => {
  for (const s of [1.0, 1.4, 1.9, 2.5]) {
    const i = scoreInvites(s, SCALE)
    assert.equal(i.pip, true, `${s} does not offer a PIP`)
    assert.equal(i.recognition, false, `${s} offers recognition`)
  }
})

test('a high score invites recognition and not a PIP', () => {
  for (const s of [3.6, 4.0, 4.9, 5.0]) {
    const i = scoreInvites(s, SCALE)
    assert.equal(i.recognition, true, `${s} does not offer recognition`)
    assert.equal(i.pip, false, `${s} offers a PIP`)
  }
})

test('the middle invites neither', () => {
  // "Meets Expectations" is neither a plan nor a bonus, and offering either
  // would make both meaningless.
  for (const s of [2.6, 3.0, 3.5]) {
    const i = scoreInvites(s, SCALE)
    assert.equal(i.pip, false, `${s} offers a PIP`)
    assert.equal(i.recognition, false, `${s} offers recognition`)
  }
})

test('the boundary follows the window, not rounding', () => {
  // 2.50 and 2.51 round the same and sit in different bands. Getting this
  // wrong puts somebody on a performance plan for a rounding artefact.
  assert.equal(scoreInvites(2.50, SCALE).pip, true)
  assert.equal(scoreInvites(2.51, SCALE).pip, false)
  assert.equal(scoreInvites(3.50, SCALE).recognition, false)
  assert.equal(scoreInvites(3.51, SCALE).recognition, true)
})

test('no score invites nothing', () => {
  const i = scoreInvites(null, SCALE)
  assert.equal(i.band, null)
  assert.equal(i.pip, false)
  assert.equal(i.recognition, false)
})

test('a band with neither flag set offers neither', () => {
  // The default is false for the reason every gate here defaults shut: a
  // band nobody configured must not start offering performance plans.
  const bare: Band[] = [{ value: 3, label: 'Mid', improvementMandatory: false,
                          minCommentChars: 0, scoreFrom: 1, scoreTo: 5 }]
  const i = scoreInvites(3, bare)
  assert.equal(i.pip, false)
  assert.equal(i.recognition, false)
})

test('a ten-point scale is not assumed to break at 2', () => {
  // The whole reason this is a flag. On a 1-10 scale an admin might set the
  // bottom three as PIP bands, and nothing in code should disagree.
  const ten: Band[] = Array.from({ length: 10 }, (_, k) => ({
    value: k + 1, label: `b${k + 1}`, improvementMandatory: false, minCommentChars: 0,
    scoreFrom: k + 0.5, scoreTo: k + 1.5,
    allowsPip: k < 3, allowsRecognition: k >= 8,
  }))
  assert.equal(scoreInvites(3, ten).pip, true)
  assert.equal(scoreInvites(5, ten).pip, false)
  assert.equal(scoreInvites(5, ten).recognition, false)
  assert.equal(scoreInvites(10, ten).recognition, true)
})

// ── a ticked box has to be completable ───────────────────────────────────

test('an unticked PIP asks for nothing', () => {
  assert.equal(checkPip({ wanted: false, reason: '', proposedStart: '', proposedEnd: '' }), null)
})

test('a ticked PIP needs a reason HR can act on', () => {
  // pms_pip.request_reason is NOT NULL, and a plan that begins "rated low"
  // is one nobody can run, review or defend.
  const w = defaultPipWindow('2026-11-03')
  const f = checkPip({ wanted: true, reason: 'rated low', proposedStart: w.start, proposedEnd: w.end })
  assert.ok(f)
  assert.match(f!, new RegExp(`${MIN_PIP_REASON} characters`))
  assert.equal(checkPip({ wanted: true, reason: chars(MIN_PIP_REASON),
                          proposedStart: w.start, proposedEnd: w.end }), null)
})

test('a PIP must end after it starts', () => {
  const base = { wanted: true, reason: chars(MIN_PIP_REASON) }
  assert.match(checkPip({ ...base, proposedStart: '2026-11-03', proposedEnd: '2026-11-03' })!,
    /end after it starts/)
  assert.match(checkPip({ ...base, proposedStart: '2026-11-03', proposedEnd: '2026-10-03' })!,
    /end after it starts/)
  assert.equal(checkPip({ ...base, proposedStart: '2026-11-03', proposedEnd: '2027-02-01' }), null)
})

test('a PIP must have both dates', () => {
  const base = { wanted: true, reason: chars(MIN_PIP_REASON) }
  assert.match(checkPip({ ...base, proposedStart: '', proposedEnd: '2027-01-01' })!, /start and an end/)
  assert.match(checkPip({ ...base, proposedStart: '2026-11-03', proposedEnd: '' })!, /start and an end/)
})

test('the default window is ninety days', () => {
  // Long enough to show a change, short enough that nobody is left on one
  // indefinitely.
  const w = defaultPipWindow('2026-11-03')
  assert.equal(w.start, '2026-11-03')
  const days = (Date.parse(w.end) - Date.parse(w.start)) / 86_400_000
  assert.equal(days, 90)
})

test('the window crosses a year end correctly', () => {
  const w = defaultPipWindow('2026-12-15')
  assert.ok(w.end.startsWith('2027-'), `ninety days from mid-December is ${w.end}`)
})

test('an unticked recognition asks for nothing, a ticked one needs a case', () => {
  assert.equal(checkRecognition({ wanted: false, kind: 'BONUS', note: '' }), null)
  const f = checkRecognition({ wanted: true, kind: 'BONUS', note: 'good' })
  assert.ok(f)
  assert.match(f!, new RegExp(`${MIN_RECOGNITION_NOTE} characters`))
  assert.equal(checkRecognition({ wanted: true, kind: 'PROMOTION',
                                  note: chars(MIN_RECOGNITION_NOTE) }), null)
})

test('every recognition kind has a label', () => {
  for (const k of RECOGNITION_KINDS) assert.ok(RECOGNITION_LABEL[k], `${k} has no label`)
  // The three the request actually named.
  const all = Object.values(RECOGNITION_LABEL).join(' ').toLowerCase()
  for (const w of ['bonus', 'promotion']) {
    assert.ok(all.includes(w), `"${w}" is not offered`)
  }
})

// ── 209 ──────────────────────────────────────────────────────────────────

test('209 adds the flag defaulting to false', () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS allows_recognition boolean NOT NULL DEFAULT false/,
    'a band nobody configured would start offering recognition')
})

test('209 seeds the top two bands per scale, by value', () => {
  // "Top two" has to follow whatever scale the policy has, not assume five.
  assert.match(SQL, /row_number\(\) OVER \(PARTITION BY company_id, policy_id\s*\n?\s*ORDER BY rating_value DESC\)/,
    'the seed does not rank within each scale by rating value')
  assert.match(SQL, /r\.rn <= 2/, 'the seed does not stop at two')
})

test('the seed does not undo an admin decision on a re-run', () => {
  // Replaying migrations must not switch recognition back on for a band
  // somebody deliberately turned off.
  assert.match(SQL, /untouched AS \(/, 'the seed has no guard')
  assert.match(SQL, /EXCEPT/, 'the guard does not exclude already-configured scales')
  assert.match(SQL, /WHERE s\.allows_recognition/,
    'the guard does not look at whether any band is already true')
})

test('209 is otherwise additive', () => {
  const body = SQL.replace(/^\s*--.*$/gm, ' ')
  for (const f of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i]) {
    assert.ok(!f.test(body), `209 matches ${f}`)
  }
})

// ── the column reaches the screen ────────────────────────────────────────

test('both flags are selected, or they are inert', () => {
  // A column absent from the SELECT arrives undefined and reads as false,
  // which would silently switch both prompts off everywhere.
  assert.match(PERF, /allows_pip_request,allows_recognition/,
    'the rating scale query does not fetch the two flags')
})

test('a column that was never selected is not read as a yes', () => {
  // The original worry, and still the important one: a query that does not
  // ask for allows_recognition must not end up offering recognition at
  // every band. It is now undefined rather than false — which the fallback
  // can tell apart from an admin's no — but it is still never true.
  const [band] = bandsFromScale([{ rating_value: 3, label: 'Meets' } as never])
  assert.notEqual(band.allowsPip, true, 'an unasked column reads as a yes')
  assert.notEqual(band.allowsRecognition, true)
  assert.equal(band.allowsPip, undefined, 'absent and false have been collapsed')

  // A row that carries the field keeps the admin's answer, false included.
  const rows = [{ rating_value: 1, allows_pip_request: false, allows_recognition: false },
                { rating_value: 5, allows_pip_request: false, allows_recognition: true }]
  // Found by value, not by index: bandsFromScale orders the bands itself.
  const got = bandsFromScale(rows as never)
  const at = (v: number) => got.find(b => b.value === v)!
  assert.equal(at(1).allowsPip, false, 'an explicit false was lost')
  assert.equal(at(5).allowsRecognition, true, 'an explicit true was lost')
})

test('an admin can change the flags', () => {
  // All three band behaviours had no control at all, and two of them are
  // now enforced — a rule you cannot find reads as a bug.
  assert.match(ROUTE, /'allows_recognition'/,
    'the column is not allowlisted, so the control saves into nothing')
  assert.match(EDITOR, /set\('allows_recognition', e\.target\.value === 'yes'\)/)
  assert.match(EDITOR, /set\('allows_pip_request', e\.target\.value === 'yes'\)/)
  assert.match(EDITOR, /set\('improvement_feedback_mandatory', e\.target\.value === 'yes'\)/)
})

// ── wiring ───────────────────────────────────────────────────────────────

test('one prompt per appraisal, from the weighted score', () => {
  assert.match(MGR, /scoreInvites\(cmp\.myScore, bands\)/,
    'the prompt is not driven by the rater\'s own weighted score')
})

test('a ticked but incomplete box blocks approval', () => {
  const i = MGR.indexOf('const ready = ')
  const expr = MGR.slice(i, MGR.indexOf('return (', i))
  assert.match(expr, /!pipFault && !recFault/,
    'a half-filled PIP request or recognition proposal can be sent on')
})

test('the PIP lands in HR\'s queue as a request, not as a plan', () => {
  const fn = PERF.slice(PERF.indexOf('const savePip'), PERF.indexOf('const saveRecognition'))
  assert.match(fn, /hr_status: 'PENDING_HR'/, 'the PIP does not wait for HR')
  assert.match(fn, /status: 'REQUESTED'/, 'the PIP starts as something other than a request')
  assert.match(fn, /trigger_rating: score/,
    'the score that prompted the plan is not recorded')
})

test('nothing is written when neither box is ticked', () => {
  const pipFn = PERF.slice(PERF.indexOf('const savePip'), PERF.indexOf('const saveRecognition'))
  assert.match(pipFn, /if \(!pip\.wanted \|\| !companyId\) return true/)
  const recFn = PERF.slice(PERF.indexOf('const saveRecognition'), PERF.indexOf('const saveOverall'))
  assert.match(recFn, /if \(!recog\.wanted \|\| !companyId\) return true/)
})

test('both are saved before the chain moves', () => {
  const ra = PERF.slice(PERF.indexOf('const rateAndApprove'), PERF.indexOf('const approveInChain'))
  for (const f of ['savePip', 'saveRecognition']) {
    assert.ok(ra.includes(f), `${f} is never called from the approval`)
    assert.ok(ra.indexOf(f) < ra.indexOf('approveInChain('),
      `${f} runs after the set has already gone up`)
  }
})

test('the score recorded on the PIP is the one the panel showed', () => {
  // Computing it a second way is how the number that triggered a plan comes
  // to disagree with the number the rater saw.
  const ra = PERF.slice(PERF.indexOf('const rateAndApprove'), PERF.indexOf('const approveInChain'))
  assert.match(ra, /const myScore = cmpNow\.myScore/,
    'the PIP score is computed separately from the comparison')
})

// ── normalised to whatever scale is in use ───────────────────────────────
//
// The flags default false, so a scale NOBODY HAS CONFIGURED would offer
// neither prompt, silently — every scale created after 209 runs, and every
// company that builds its own. The band's normalised position is the
// fallback: bottom quarter invites a plan, top quarter invites recognition.

/** A scale of n points with no flags set at all. */
const bare = (vals: number[]): Band[] => vals.map((v, i) => ({
  value: v, label: `b${v}`, improvementMandatory: false, minCommentChars: 0,
  scoreFrom: v - 0.5, scoreTo: v + 0.49,
}))

test('the fallback reproduces the seeded five-point configuration exactly', () => {
  // THE ARGUMENT FOR THESE THRESHOLDS. If the normalised answer disagreed
  // with the flags the product ships with, one of the two would be wrong.
  const unconfigured = bare([1, 2, 3, 4, 5])
  for (const b of SCALE) {
    const viaFlags = scoreInvites(b.value, SCALE)
    const viaPosition = scoreInvites(b.value, unconfigured)
    assert.equal(viaPosition.pip, viaFlags.pip,
      `band ${b.value}: normalised PIP disagrees with the seeded flag`)
    assert.equal(viaPosition.recognition, viaFlags.recognition,
      `band ${b.value}: normalised recognition disagrees with the seeded flag`)
  }
})

test('an unconfigured ten-point scale gets its own bottom and top', () => {
  const ten = bare([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => scoreInvites(v, ten).pip),
    [true, true, true, false, false, false, false, false, false, false])
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => scoreInvites(v, ten).recognition),
    [false, false, false, false, false, false, false, true, true, true])
})

test('an unconfigured three-point scale gets one each', () => {
  const three = bare([1, 2, 3])
  assert.deepEqual([1, 2, 3].map(v => scoreInvites(v, three).pip), [true, false, false])
  assert.deepEqual([1, 2, 3].map(v => scoreInvites(v, three).recognition), [false, false, true])
})

test('a scale that does not start at 1 normalises from its own floor', () => {
  // 0-4 is as valid as 1-5 and would otherwise read as "everything is low".
  const zero = bare([0, 1, 2, 3, 4])
  assert.equal(scoreInvites(0, zero).pip, true)
  assert.equal(scoreInvites(1, zero).pip, true)
  assert.equal(scoreInvites(2, zero).pip, false)
  assert.equal(scoreInvites(4, zero).recognition, true)
  assert.equal(scoreInvites(2, zero).recognition, false)
})

test('a one-rung scale invites nothing', () => {
  // There is no top or bottom quarter of a single band, and dividing by
  // zero would make every answer true.
  const one = bare([3])
  const i = scoreInvites(3, one)
  assert.equal(i.position, null)
  assert.equal(i.pip, false)
  assert.equal(i.recognition, false)
})

test('position runs 0 to 1 and never outside it', () => {
  for (const vals of [[1, 2, 3, 4, 5], [1, 2, 3], [0, 1, 2, 3, 4], [1, 10]]) {
    const sc = bare(vals)
    for (const v of vals) {
      const p = scoreInvites(v, sc).position!
      assert.ok(p >= 0 && p <= 1, `${vals.join('/')} band ${v} → position ${p}`)
    }
    assert.equal(scoreInvites(Math.min(...vals), sc).position, 0)
    assert.equal(scoreInvites(Math.max(...vals), sc).position, 1)
  }
})

// ── configuration still wins, and each half independently ────────────────

test('an admin flag beats the position', () => {
  // Their scale, their policy. A band at the very top marked as a PIP band
  // is a strange choice, and it is still theirs to make.
  const odd = bare([1, 2, 3, 4, 5]).map(b =>
    b.value === 5 ? { ...b, allowsPip: true } : b)
  assert.equal(scoreInvites(5, odd).pip, true, 'the explicit flag was ignored')
  // And with PIP now configured, band 1 no longer gets the normalised answer.
  assert.equal(scoreInvites(1, odd).pip, false,
    'the normalised fallback is still running on a configured half')
})

test('the two halves are judged independently', () => {
  // A scale with PIP bands marked and recognition untouched must not get a
  // mix nobody chose: the configured half follows the flags, the other
  // falls back.
  const half = bare([1, 2, 3, 4, 5]).map(b =>
    b.value <= 2 ? { ...b, allowsPip: true } : b)
  assert.equal(scoreInvites(1, half).pip, true, 'configured half ignored')
  assert.equal(scoreInvites(5, half).recognition, true,
    'the unconfigured half did not fall back to the position')
  assert.equal(scoreInvites(3, half).recognition, false)
})

test('it says where its answer came from', () => {
  // So a screen, or somebody debugging one, can tell "nobody configured
  // this" from "an admin said no".
  assert.equal(scoreInvites(1, SCALE).from, 'configured')
  assert.equal(scoreInvites(1, bare([1, 2, 3, 4, 5])).from, 'normalised')
  assert.equal(scoreInvites(null, SCALE).from, 'none')
})

test('turning every flag off is a configuration, not an absence', () => {
  // THE SUBTLE CASE, and the one the first version of this got wrong. An
  // admin who switches recognition off for every band has said "no
  // recognition on this scale". Reading that as unconfigured switches it
  // back on — the opposite of respecting their choice.
  //
  // It works because undefined and false are kept apart: the columns are
  // NOT NULL in the database, so a band that CARRIES the field has a real
  // answer, and only a band that does not (the query never asked) falls
  // back to the position.
  const allOff = bare([1, 2, 3, 4, 5]).map(b => ({ ...b, allowsRecognition: false }))
  assert.equal(scoreInvites(5, allOff).recognition, false,
    'an explicit false was overridden by the normalised fallback')
  assert.equal(scoreInvites(5, allOff).from, 'configured')
  // And the other half of that scale, which nobody touched, still falls back.
  assert.equal(scoreInvites(1, allOff).pip, true,
    'the untouched half stopped falling back')
})

test('undefined and false are kept apart at the source', () => {
  // The whole rule above rests on bandsFromScale NOT collapsing the two.
  const sc = read('lib/pms/scoring.ts').replace(/\s+/g, ' ')
  for (const col of ['allows_pip_request', 'allows_recognition']) {
    assert.ok(sc.includes(`r.${col} === undefined || r.${col} === null ? undefined`),
      `${col} collapses an absent column to false, which the fallback cannot see past`)
  }
  // And the reader of that distinction asks !== undefined, not === true.
  const tr = read('lib/pms/training.ts').replace(/\s+/g, ' ')
  assert.ok(tr.includes('bands.some(b => b.allowsPip !== undefined)')
         && tr.includes('bands.some(b => b.allowsRecognition !== undefined)'),
    'scoreInvites treats an explicit false as unconfigured')
})

