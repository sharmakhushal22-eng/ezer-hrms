// lib/pms/__tests__/rating-bands.test.ts — the bands the admin configured are
// the bands that get enforced.
//
// WHAT WAS WRONG. There were two definitions of the rating scale and they did
// not agree. pms_rating_scale ships seeded with
//
//     5 Outstanding            4.51-5.00   200 chars
//     4 Exceeds Expectations   3.51-4.50   100 chars
//     3 Meets Expectations     2.51-3.50    50 chars
//     2 Needs Improvement      1.51-2.50   200 chars   improvement mandatory
//     1 Unsatisfactory         1.00-1.50   200 chars   improvement mandatory
//
// and scoring.ts hardcoded 40/30/30/80/120 with different labels. Every rule
// that reads a band — rule 10 (improvement mandatory) and rule 11 (minimum
// comment length) — enforced the hardcoded numbers. An admin who raised a
// minimum saw it save and saw nothing change, and the same rating was called
// "Partially meets" on one screen and "Needs Improvement" on another.
//
// The ranges mattered too: bandForScore rounded, so a weighted score of
// exactly 3.50 became "Exceeds" when the table puts it in "Meets".
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  bandsFromScale, bandFor, bandForScore, checkFeedback, DEFAULT_BANDS, type ScaleRow,
} from '../scoring.ts'

/** The rows as PMS-SETUP-ready-to-run.sql seeds them, numbers verbatim. */
const SEEDED: ScaleRow[] = [
  { rating_value: 5, rating_code: 'O',  rating_label: 'Outstanding',          score_from: 4.51, score_to: 5.00, min_comment_chars: 200, improvement_feedback_mandatory: false, sort_order: 1 },
  { rating_value: 4, rating_code: 'EE', rating_label: 'Exceeds Expectations', score_from: 3.51, score_to: 4.50, min_comment_chars: 100, improvement_feedback_mandatory: false, sort_order: 2 },
  { rating_value: 3, rating_code: 'ME', rating_label: 'Meets Expectations',   score_from: 2.51, score_to: 3.50, min_comment_chars:  50, improvement_feedback_mandatory: false, sort_order: 3 },
  { rating_value: 2, rating_code: 'NI', rating_label: 'Needs Improvement',    score_from: 1.51, score_to: 2.50, min_comment_chars: 200, improvement_feedback_mandatory: true,  sort_order: 4 },
  { rating_value: 1, rating_code: 'U',  rating_label: 'Unsatisfactory',       score_from: 1.00, score_to: 1.50, min_comment_chars: 200, improvement_feedback_mandatory: true,  sort_order: 5 },
]

describe('bands come from the configured scale', () => {
  it('maps a seeded scale, highest band first', () => {
    const b = bandsFromScale(SEEDED)
    assert.equal(b.length, 5)
    assert.deepEqual(b.map(x => x.value), [5, 4, 3, 2, 1])
    assert.deepEqual(b.map(x => x.label),
      ['Outstanding', 'Exceeds Expectations', 'Meets Expectations', 'Needs Improvement', 'Unsatisfactory'])
    assert.deepEqual(b.map(x => x.minCommentChars), [200, 100, 50, 200, 200])
    assert.deepEqual(b.map(x => x.improvementMandatory), [false, false, false, true, true])
    assert.deepEqual(b.map(x => x.code), ['O', 'EE', 'ME', 'NI', 'U'])
  })

  it('sorts by rating even when the rows arrive in another order', () => {
    const shuffled = [SEEDED[2], SEEDED[4], SEEDED[0], SEEDED[3], SEEDED[1]]
    assert.deepEqual(bandsFromScale(shuffled).map(b => b.value), [5, 4, 3, 2, 1])
  })

  it('drops a band that has been switched off', () => {
    const off = SEEDED.map(r => r.rating_value === 1 ? { ...r, is_active: false } : r)
    assert.deepEqual(bandsFromScale(off).map(b => b.value), [5, 4, 3, 2])
  })

  it('reads numbers that arrive as strings, which PostgREST does for numeric', () => {
    const asText: ScaleRow[] = [{
      rating_value: '4.00', rating_label: 'Exceeds Expectations',
      score_from: '3.51', score_to: '4.50', min_comment_chars: '100',
      improvement_feedback_mandatory: false,
    }]
    const [b] = bandsFromScale(asText)
    assert.equal(b.value, 4)
    assert.equal(b.minCommentChars, 100)
    assert.equal(b.scoreFrom, 3.51)
    assert.equal(b.scoreTo, 4.5)
  })

  it('gives back nothing for an empty or unreadable table, so callers can fall back', () => {
    assert.deepEqual(bandsFromScale([]), [])
    assert.deepEqual(bandsFromScale(null), [])
    assert.deepEqual(bandsFromScale(undefined), [])
  })
})

describe('a score lands in the band the table says it does', () => {
  const bands = bandsFromScale(SEEDED)

  // THE CASE THAT WAS WRONG. 3.50 is the top of "Meets Expectations"
  // (2.51-3.50). Rounding sent it to 4.
  it('puts exactly 3.50 in Meets Expectations, not Exceeds', () => {
    assert.equal(bandForScore(3.50, bands)?.label, 'Meets Expectations')
    assert.equal(bandForScore(3.50, DEFAULT_BANDS)?.label, 'Exceeds',
      'the old rounding behaviour, kept for bands that carry no window')
  })

  it('honours every boundary in the seeded scale', () => {
    const at: [number, string][] = [
      [5.00, 'Outstanding'], [4.51, 'Outstanding'],
      [4.50, 'Exceeds Expectations'], [3.51, 'Exceeds Expectations'],
      [3.50, 'Meets Expectations'], [2.51, 'Meets Expectations'],
      [2.50, 'Needs Improvement'], [1.51, 'Needs Improvement'],
      [1.50, 'Unsatisfactory'], [1.00, 'Unsatisfactory'],
    ]
    for (const [score, label] of at) {
      assert.equal(bandForScore(score, bands)?.label, label, `${score} should be ${label}`)
    }
  })

  it('clamps rather than returning nothing outside the windows', () => {
    // A rounding artefact above the top band still has a name.
    assert.equal(bandForScore(5.004, bands)?.label, 'Outstanding')
    assert.equal(bandForScore(0.4, bands)?.label, 'Unsatisfactory')
  })

  it('still answers null for no score', () => {
    assert.equal(bandForScore(null, bands), null)
  })

  it('bandFor keeps matching on the rating itself, not the window', () => {
    assert.equal(bandFor(2, bands)?.label, 'Needs Improvement')
    assert.equal(bandFor(null, bands), null)
  })
})

describe('rules 10 and 11 use the configured numbers', () => {
  const bands = bandsFromScale(SEEDED)

  // The worked example: a manager rates 3 and writes 35 characters.
  // The table wants 50 at that band; the hardcoded list wanted 30.
  it('refuses a 35-character comment at Meets Expectations, where the table asks 50', () => {
    const r = checkFeedback(3, { appreciation: 'x'.repeat(35) }, bands)
    assert.equal(r.ok, false)
    assert.ok(r.faults.some(f => /At least 50 characters/.test(f)), r.faults.join(' | '))
  })

  it('and the hardcoded fallback would have let that through', () => {
    assert.equal(checkFeedback(3, { appreciation: 'x'.repeat(35) }, DEFAULT_BANDS).ok, true)
  })

  it('accepts it once it meets the configured minimum', () => {
    assert.equal(checkFeedback(3, { appreciation: 'x'.repeat(50) }, bands).ok, true)
  })

  it('still demands improvement feedback where the scale marks it mandatory', () => {
    const r = checkFeedback(2, { appreciation: 'x'.repeat(200) }, bands)
    assert.equal(r.ok, false)
    assert.ok(r.faults.some(f => /Improvement feedback is required at 2/.test(f)))
    // and names the configured label, not the hardcoded one
    assert.ok(r.faults.some(f => /needs improvement/i.test(f)), r.faults.join(' | '))
  })

  it('an admin raising a minimum changes what is enforced', () => {
    const stricter = SEEDED.map(r => r.rating_value === 3 ? { ...r, min_comment_chars: 150 } : r)
    const text = 'x'.repeat(60)
    assert.equal(checkFeedback(3, { appreciation: text }, bandsFromScale(SEEDED)).ok, true)
    assert.equal(checkFeedback(3, { appreciation: text }, bandsFromScale(stricter)).ok, false,
      'this is the whole point: editing the scale must change the rule')
  })
})
