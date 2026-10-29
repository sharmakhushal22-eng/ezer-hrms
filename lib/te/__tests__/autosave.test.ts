// The three decisions behind "your work is saved": whether a form has been
// touched, whether it has changed since the last save, and what to call it.
//
// WHY THESE ARE TESTED AND THE SAVING ITSELF IS NOT. Writing a draft is one
// RPC with no rules in it — the server stores the body verbatim, on purpose.
// Every judgement that can be wrong is in these functions, and each has a
// failure a person would notice: a Drafts list full of forms nobody typed, a
// draft that keeps jumping to the top of the list while a tab sits open, or a
// list of rows all called the same thing.
//
// Both directions are asserted throughout. A "has this changed" that always
// says yes is as useless as one that always says no, and the second half of
// each test is what catches the comparison written the wrong way round.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftTitle, sameBody, savedAgo, stableStringify, worthSaving } from '../autosave.ts'

// ── the same work, however the object was built ─────────────────────────────

test('key order does not make two identical forms different', () => {
  // React state is rebuilt by spreading, which reorders keys constantly. If
  // this were JSON.stringify, autosave would write on every single tick.
  assert.ok(sameBody({ a: 1, b: 2 }, { b: 2, a: 1 }))
  assert.ok(sameBody({ x: { p: 1, q: [1, 2] } }, { x: { q: [1, 2], p: 1 } }))
  // And a real difference is still a difference.
  assert.ok(!sameBody({ a: 1, b: 2 }, { a: 1, b: 3 }))
})

test('array order DOES matter, because it is the route', () => {
  // Points and segments are ordered: Delhi → Mumbai is not Mumbai → Delhi.
  assert.ok(!sameBody({ points: ['del', 'bom'] }, { points: ['bom', 'del'] }))
  assert.ok(sameBody({ points: ['del', 'bom'] }, { points: ['del', 'bom'] }))
})

test('a key set to undefined is the same as a key that is not there', () => {
  // Clearing an optional field is what the planner does to say "no answer".
  assert.ok(sameBody({ a: 1, stayWanted: undefined }, { a: 1 }))
  // But null is an answer, and must not read as absent.
  assert.ok(!sameBody({ a: 1, stayWanted: null }, { a: 1 }))
})

test('stableStringify handles the awkward values without throwing', () => {
  assert.equal(stableStringify(null), 'null')
  assert.equal(stableStringify(undefined), 'null')
  assert.equal(stableStringify([]), '[]')
  assert.equal(stableStringify({}), '{}')
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}')
})

// ── has it been touched? ────────────────────────────────────────────────────

test('an untouched form is not worth saving, a typed one is', () => {
  // Opening the planner and closing it must leave nothing behind.
  const pristine = { name: '', purpose: '', points: [{ place: 'off' }, { place: '' }], step: 1 }
  assert.ok(!worthSaving({ ...pristine }, pristine), 'nothing typed yet')
  assert.ok(!worthSaving({ step: 1, purpose: '', name: '', points: [{ place: 'off' }, { place: '' }] }, pristine),
    'same form, keys in another order')

  assert.ok(worthSaving({ ...pristine, name: 'Pune visit' }, pristine), 'a name was typed')
  assert.ok(worthSaving({ ...pristine, step: 2 }, pristine), 'they moved on a step')
  assert.ok(worthSaving({ ...pristine, points: [{ place: 'off' }, { place: 'bom' }] }, pristine), 'a place was chosen')
})

test('editing a saved trip is measured against that trip, not against blank', () => {
  // Opening a real trip to edit it and changing nothing must not create a
  // draft either — otherwise every look at a trip spawns one.
  const existing = { name: 'Mumbai review', purpose: 'client', points: [{ place: 'off' }, { place: 'bom' }], step: 1 }
  assert.ok(!worthSaving({ ...existing }, existing))
  assert.ok(worthSaving({ ...existing, name: 'Mumbai review (moved)' }, existing))
})

// ── what to call it ─────────────────────────────────────────────────────────

test('a trip draft is named by the planner, or by its purpose, or not at all', () => {
  assert.equal(draftTitle('trip', { name: 'Pune Branch client meeting' }), 'Pune Branch client meeting')
  assert.equal(draftTitle('trip', { name: '  ', purpose: 'client' }), 'client trip')
  // A trip abandoned on the first screen has no name, and saying so beats
  // inventing one.
  assert.equal(draftTitle('trip', { name: '', purpose: '' }), null)
  assert.equal(draftTitle('trip', {}), null)
})

test('an expense draft is named by its category and what it cost', () => {
  const label = (c: string) => ({ air: 'Flight', taxi: 'Taxi' })[c] ?? c
  assert.equal(draftTitle('expense', { f: { cat: 'taxi', claimed: '480' } }, label), 'Taxi · ₹480')
  // The claimed amount is what they are asking for; the bill is the fallback.
  assert.equal(draftTitle('expense', { f: { cat: 'air', bill: 7420 } }, label), 'Flight · ₹7,420')
  assert.equal(draftTitle('expense', { f: { cat: 'taxi', claimed: '' } }, label), 'Taxi')
  assert.equal(draftTitle('expense', { f: { merchant: 'Taj', claimed: '9000' } }, label), 'Taj · ₹9,000')
  assert.equal(draftTitle('expense', { f: { cat: '', claimed: '' } }, label), null)
  // An unknown code still shows as itself rather than disappearing.
  assert.equal(draftTitle('expense', { f: { cat: 'mystery', claimed: '10' } }, label), 'mystery · ₹10')
})

test('a typed amount that is not a number does not become one', () => {
  // The form holds what was typed. '' must not read as ₹0, which would put a
  // figure in the list that the person never entered.
  assert.equal(draftTitle('expense', { f: { cat: 'taxi', claimed: '' } }, c => c), 'taxi')
  assert.equal(draftTitle('expense', { f: { cat: 'taxi', claimed: 'abc' } }, c => c), 'taxi')
  assert.equal(draftTitle('expense', { f: { cat: 'taxi', claimed: '0' } }, c => c), 'taxi · ₹0')
})

test('a claim draft is named by the first line of the reply', () => {
  assert.equal(draftTitle('claim', { text: 'The hotel bill is for two nights.' }), 'The hotel bill is for two nights.')
  assert.equal(draftTitle('claim', { text: 'First line\nsecond line' }), 'First line')
  assert.equal(draftTitle('claim', { text: '   ' }), null)
  const long = 'x'.repeat(100)
  const got = draftTitle('claim', { text: long }) ?? ''
  assert.equal(got.length, 60, 'a long first line is cut to fit a row')
  assert.ok(got.endsWith('…'))
})

// ── how long ago ────────────────────────────────────────────────────────────

test('savedAgo reads like a person would say it', () => {
  const t = 1_700_000_000_000
  assert.equal(savedAgo(t, t), 'Saved just now')
  assert.equal(savedAgo(t, t + 44_000), 'Saved just now')
  assert.equal(savedAgo(t, t + 120_000), 'Saved 2 minutes ago')
  assert.equal(savedAgo(t, t + 60_000), 'Saved 1 minute ago')
  assert.equal(savedAgo(t, t + 3_600_000), 'Saved 1 hour ago')
  assert.equal(savedAgo(t, t + 7_200_000), 'Saved 2 hours ago')
  // A clock that went backwards must not produce "Saved -3 minutes ago".
  assert.equal(savedAgo(t, t - 5_000), 'Saved just now')
})
