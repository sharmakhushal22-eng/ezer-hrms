import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldOther, isOther, MIN_WHY, needsExplanation, OTHER, splitOther, whyLabel, whyProblem } from '../other-reason.ts'

test('a listed reason is never Other and never asks for anything', () => {
  for (const r of ['Client meeting', 'Site or plant visit', 'Phone battery was low', 'Same-day travel']) {
    assert.equal(isOther(r), false, r)
    assert.equal(whyProblem(r, ''), '', r)
    assert.equal(needsExplanation(r), false, r)
  }
})

test('Other is recognised whatever the casing or spacing', () => {
  for (const r of ['Other', 'other', ' OTHER ', 'oThEr']) assert.equal(isOther(r), true, JSON.stringify(r))
})

test('an already-folded value is still recognised as Other', () => {
  // Matters because a saved trip is read back and re-opened for editing.
  assert.equal(isOther('Other — Attending a supplier arbitration'), true)
  assert.equal(isOther('Other - hyphen typed by hand'), true)
})

test('nothing, or next to nothing, is refused', () => {
  assert.match(whyProblem(OTHER, ''), /does not tell your approver/)
  assert.match(whyProblem(OTHER, '   '), /does not tell your approver/)
  assert.match(whyProblem(OTHER, 'na'), /too short/)
  assert.match(whyProblem(OTHER, '-'), /too short/)
  assert.match(whyProblem(OTHER, 'personal'), /too short/)
})

test('restating the word is not explaining it', () => {
  assert.match(whyProblem(OTHER, 'other other'), /not the word/)
  assert.match(whyProblem(OTHER, 'OTHER!!!!!!!!!!'), /not the word/)
})

test('a real reason passes', () => {
  assert.equal(whyProblem(OTHER, 'Supplier arbitration hearing in Indore'), '')
  // Exactly at the floor, so the boundary is not off by one.
  assert.equal('a'.repeat(MIN_WHY).length, MIN_WHY)
  assert.equal(whyProblem(OTHER, 'a'.repeat(MIN_WHY)), '')
  assert.match(whyProblem(OTHER, 'a'.repeat(MIN_WHY - 1)), /too short/)
})

test('leading and trailing space is not length', () => {
  assert.match(whyProblem(OTHER, `  ${'a'.repeat(MIN_WHY - 1)}  `), /too short/)
})

test('a null choice or note never throws', () => {
  assert.equal(whyProblem(null, null), '')
  assert.equal(whyProblem(undefined, undefined), '')
  assert.match(whyProblem(OTHER, null), /does not tell/)
  assert.equal(isOther(null), false)
  assert.equal(isOther(undefined), false)
})

// ── folding, and getting it back ────────────────────────────────────────────

test('a listed reason is stored exactly as it is', () => {
  assert.equal(foldOther('Client meeting', 'ignored'), 'Client meeting')
})

test('an explained Other carries its explanation into the one column', () => {
  assert.equal(foldOther(OTHER, 'Supplier arbitration'), 'Other — Supplier arbitration')
})

test('an unexplained Other folds to the bare word, which SQL then refuses', () => {
  // The browser is not the last word: migration 163 refuses this value, so
  // folding must produce something the database can recognise as bare.
  assert.equal(foldOther(OTHER, ''), OTHER)
  assert.equal(foldOther(OTHER, '   '), OTHER)
})

test('fold then split returns what was typed', () => {
  for (const note of ['Supplier arbitration hearing', 'Client asked at 6am - no time', 'Visa appointment — embassy slot']) {
    const r = splitOther(foldOther(OTHER, note))
    assert.equal(r.choice, OTHER, note)
    assert.equal(r.note, note, note)
  }
})

test('a reason containing a dash is not cut in half by the split', () => {
  const note = 'Client asked at 6am — no time to raise it'
  assert.equal(splitOther(foldOther(OTHER, note)).note, note)
})

test('splitting a value that was never folded gives it back untouched', () => {
  assert.deepEqual(splitOther('Client meeting'), { choice: 'Client meeting', note: '' })
  assert.deepEqual(splitOther(''), { choice: '', note: '' })
  assert.deepEqual(splitOther(null), { choice: '', note: '' })
})

test('a bare other in odd casing normalises to the spelling the picker uses', () => {
  // Otherwise the picker would render with nothing selected and the person
  // would think their choice had been lost.
  assert.deepEqual(splitOther('other'), { choice: OTHER, note: '' })
  assert.deepEqual(splitOther('  OTHER '), { choice: OTHER, note: '' })
})

test('every box has its own wording, and none of them says Other', () => {
  for (const w of ['purpose', 'gps', 'approval', 'journey'] as const) {
    const { label, hint } = whyLabel(w)
    assert.ok(label.length > 5, w)
    assert.ok(hint.length > 5, w)
  }
  assert.notEqual(whyLabel('purpose').label, whyLabel('gps').label)
})
