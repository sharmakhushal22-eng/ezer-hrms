// The score, as colour: worst red, middle yellow, best green.
//
// Requested directly — "if anyone give 1 rating the KRA will be highlighted
// red, 5 green, 3 yellow, and in between gradients of red > yellow > green",
// confirmed as "best means green, neutral means yellow, worst means red".
//
// THE TRAP THIS FILE EXISTS FOR IS 1..5.
//
// Nothing about this module guarantees a five-point scale. pms_rating_scale
// is policy configuration, bandsFromScale reads whatever is in it, and the
// admin screen can set a three- or ten-point scale without touching code.
// A ramp that assumes 3 is the middle puts YELLOW ON "EXCEEDS" for a
// four-point scale, and on the second-from-bottom band of a ten-point one —
// which is worse than no colour at all, because it is confidently wrong in
// exactly the place somebody is making a judgement about a person.
//
// So the position is normalised: lowest band 0, highest 1, midpoint
// wherever the policy's own middle lands. Most of what follows is that one
// rule, checked on scales that are not 1..5.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ratingTone, toneVars, TONE_LOW, TONE_MID, TONE_HIGH,
         DEFAULT_BANDS, type Band } from '../scoring.ts'

/** A scale of n points, as a policy would give it. */
const scale = (vals: number[]): Band[] => vals.map(v => ({
  value: v, label: `b${v}`, improvementMandatory: false, minCommentChars: 10,
}))

// ── the three anchors ────────────────────────────────────────────────────

test('the worst rating is pure red', () => {
  const t = ratingTone(1, DEFAULT_BANDS)!
  assert.equal(t.from, TONE_LOW)
  assert.equal(t.mix, 0, 'the bottom of the scale is not pure red')
})

test('the best rating is pure green', () => {
  const t = ratingTone(5, DEFAULT_BANDS)!
  assert.equal(t.to, TONE_HIGH)
  assert.equal(t.mix, 100, 'the top of the scale is not pure green')
})

test('the middle rating is pure yellow, from either side', () => {
  // 3 of 5 is exactly the midpoint, which is the boundary between the two
  // segments — it must land on yellow whichever segment claims it.
  const t = ratingTone(3, DEFAULT_BANDS)!
  const yellowEnd = t.to === TONE_MID && t.mix === 100
  const yellowStart = t.from === TONE_MID && t.mix === 0
  assert.ok(yellowEnd || yellowStart,
    `the midpoint is not yellow: ${JSON.stringify(t)}`)
})

test('it never mixes red straight into green', () => {
  // A single red-to-green ramp passes through a muddy olive at the middle
  // rather than yellow, which is the opposite of what the middle band
  // should look like.
  for (let v = 1; v <= 5; v += 0.25) {
    const t = ratingTone(v, DEFAULT_BANDS)!
    assert.ok(!(t.from === TONE_LOW && t.to === TONE_HIGH),
      `${v} blends red directly into green`)
  }
})

// ── the direction, which is the whole request ────────────────────────────

test('colour rises with the rating and never doubles back', () => {
  // Expressed as one number so the two segments can be compared: red is 0,
  // yellow is 1, green is 2.
  const pos = (v: number) => {
    const t = ratingTone(v, DEFAULT_BANDS)!
    return t.from === TONE_LOW ? t.mix / 100 : 1 + t.mix / 100
  }
  let last = -1
  for (let v = 1; v <= 5; v += 0.5) {
    const p = pos(v)
    assert.ok(p >= last, `${v} is further from green than ${v - 0.5} was`)
    last = p
  }
  assert.ok(pos(1) < pos(3) && pos(3) < pos(5),
    'worst, middle and best are not in red, yellow, green order')
})

// ── scales that are not 1..5 ─────────────────────────────────────────────

test('a ten-point scale puts yellow at its own middle', () => {
  const b = scale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  // 5.5 is the midpoint of 1..10. The band at 3 is low — it must be reddish,
  // not the yellow a hardcoded midpoint would give it.
  const three = ratingTone(3, b)!
  assert.equal(three.from, TONE_LOW,
    'a 3 on a ten-point scale is being treated as the middle')
  assert.ok(three.mix < 50, `3 of 10 should be well into the red: ${three.mix}`)
  const ten = ratingTone(10, b)!
  assert.equal(ten.mix, 100, 'the top of a ten-point scale is not green')
  assert.equal(ten.to, TONE_HIGH)
})

test('a three-point scale still has a red, a yellow and a green', () => {
  const b = scale([1, 2, 3])
  assert.equal(ratingTone(1, b)!.mix, 0)
  const mid = ratingTone(2, b)!
  assert.ok((mid.to === TONE_MID && mid.mix === 100)
         || (mid.from === TONE_MID && mid.mix === 0),
    'the middle of a three-point scale is not yellow')
  assert.equal(ratingTone(3, b)!.mix, 100)
})

test('a scale that does not start at 1 still starts at red', () => {
  // pms_rating_scale stores whatever values the policy sets; 0-4 is as
  // valid as 1-5 and would otherwise render the bottom band orange.
  const b = scale([0, 1, 2, 3, 4])
  const t = ratingTone(0, b)!
  assert.equal(t.from, TONE_LOW)
  assert.equal(t.mix, 0, 'the lowest band is not red when the scale starts at 0')
})

test('the band order in the array does not matter', () => {
  // DEFAULT_BANDS is listed highest-first; a scale read from the database
  // comes back lowest-first. Both must give the same colour.
  const down = scale([5, 4, 3, 2, 1])
  const up = scale([1, 2, 3, 4, 5])
  for (const v of [1, 2, 3, 4, 5]) {
    assert.deepEqual(ratingTone(v, down), ratingTone(v, up),
      `rating ${v} depends on how the bands were sorted`)
  }
})

// ── the edges ────────────────────────────────────────────────────────────

test('no rating means no colour', () => {
  // A card nobody has scored must not be painted red — it has not been
  // judged badly, it has not been judged.
  assert.equal(ratingTone(null), null)
  assert.equal(ratingTone(undefined), null)
  assert.equal(ratingTone(Number.NaN), null)
})

test('a one-band scale has no ramp to sit on', () => {
  // Neither red nor green is honest about a scale with one rung, and the
  // normalisation would divide by zero.
  assert.equal(ratingTone(1, scale([1])), null)
  assert.equal(ratingTone(3, []), null)
})

test('a rating off the end of the scale is clamped, not extrapolated', () => {
  // Bad data exists — a 7 against a five-point scale is a migration
  // artefact, not a reason to compute a colour past the end of the ramp.
  assert.deepEqual(ratingTone(9, DEFAULT_BANDS), ratingTone(5, DEFAULT_BANDS))
  assert.deepEqual(ratingTone(-4, DEFAULT_BANDS), ratingTone(1, DEFAULT_BANDS))
})

test('a fractional rating sits between its neighbours', () => {
  const a = ratingTone(2, DEFAULT_BANDS)!, b = ratingTone(2.5, DEFAULT_BANDS)!
  assert.equal(a.from, b.from)
  assert.ok(b.mix > a.mix, 'half a band up is not further along the ramp')
})

// ── it stays a token, so it follows the theme ────────────────────────────

test('the ramp names tokens and never a colour', () => {
  // A hex value here would be a frozen daytime swatch: amber in daylight
  // and still daylight-amber at night, on a dark card.
  for (let v = 1; v <= 5; v++) {
    const t = ratingTone(v, DEFAULT_BANDS)!
    for (const end of [t.from, t.to]) {
      assert.match(end, /^--(ez|pms)-/, `${end} is not a theme token`)
      assert.ok(!/#|rgb|hsl/.test(end), `${end} looks like a literal colour`)
    }
  }
})

test('the style vars are shaped for color-mix', () => {
  const v = toneVars(ratingTone(4, DEFAULT_BANDS))
  assert.equal(v['--kra-from'], 'var(--pms-ramp-mid)')
  assert.equal(v['--kra-to'], 'var(--pms-ramp-high)')
  assert.match(v['--kra-mix'], /^\d+(\.\d)?%$/, 'the mix is not a CSS percentage')
})

test('no tone means no variables, not empty ones', () => {
  // `--kra-from: ` with nothing after it makes color-mix invalid and the
  // card loses its background entirely rather than falling back.
  assert.deepEqual(toneVars(null), {})
})

test('the mix never exceeds a hundred percent', () => {
  for (let v = 0; v <= 6; v += 0.1) {
    const t = ratingTone(v, DEFAULT_BANDS)!
    assert.ok(t.mix >= 0 && t.mix <= 100, `${v} gives mix ${t.mix}`)
  }
})
