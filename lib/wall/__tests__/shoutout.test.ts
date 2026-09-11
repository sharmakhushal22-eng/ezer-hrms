// The composer's rules, checked against the database's.
//
// These matter because the UI is the only place a person can be told about a
// rule BEFORE they spend two minutes writing. If this file drifts from
// create_shoutout(), somebody gets a green Send button and a red error.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  problems, canSend, problemFor, remainingToday, messageLength,
  visibilityNote, VISIBILITIES, DEFAULT_RULES, EMPTY_DRAFT,
  type Draft, type Context,
} from '../shoutout.ts'

const ME = 'me-1'
const ctx = (over: Partial<Context> = {}): Context => ({ actorId: ME, sentToday: 0, ...over })
const good = (over: Partial<Draft> = {}): Draft => ({
  ...EMPTY_DRAFT, receiverIds: ['a'], categoryCode: 'HELP',
  message: 'Thank you for staying late to close the audit.', ...over,
})

test('a complete draft is sendable', () => {
  assert.deepEqual(problems(good(), ctx()), [])
  assert.equal(canSend(good(), ctx()), true)
})

test('an empty draft reports every unmet rule at once, not one at a time', () => {
  // Revealing problems one per submit is how a five-field form takes five
  // round trips.
  const p = problems(EMPTY_DRAFT, ctx())
  const fields = p.map(x => x.field)
  assert.ok(fields.includes('receivers'))
  assert.ok(fields.includes('category'))
  assert.ok(fields.includes('message'))
})

// ── who ──────────────────────────────────────────────────────────────────

test('you cannot recognise yourself', () => {
  const p = problems(good({ receiverIds: [ME] }), ctx())
  assert.match(problemFor('receivers', p)!, /cannot recognise yourself/)
})

test('the group switch and the receiver cap are separate rules', () => {
  const three = good({ receiverIds: ['a', 'b', 'c'] })
  assert.deepEqual(problems(three, ctx()), [], 'groups allowed by default')

  const noGroup = problems(three, ctx(), { ...DEFAULT_RULES, allowGroup: false })
  assert.match(problemFor('receivers', noGroup)!, /switched off/)

  const capped = problems(three, ctx(), { ...DEFAULT_RULES, maxReceivers: 2 })
  assert.match(problemFor('receivers', capped)!, /up to 2 people/)
})

test('one receiver is never a group, even with groups switched off', () => {
  assert.deepEqual(
    problems(good({ receiverIds: ['a'] }), ctx(), { ...DEFAULT_RULES, allowGroup: false }), [])
})

test('the same person twice is caught — it would silently become one row', () => {
  const p = problems(good({ receiverIds: ['a', 'a'] }), ctx())
  assert.match(problemFor('receivers', p)!, /twice/)
})

test('the cooldown names the person when it is one, counts them when it is more', () => {
  const one = problems(good({ receiverIds: ['a'] }),
    ctx({ recentlyRecognised: ['a'], nameOf: () => 'Priya Nair' }))
  assert.match(problemFor('receivers', one)!, /already recognised Priya Nair in the last 24 hours/)

  const many = problems(good({ receiverIds: ['a', 'b'] }),
    ctx({ recentlyRecognised: ['a', 'b'] }))
  assert.match(problemFor('receivers', many)!, /already recognised 2 of these people/)
})

test('the cooldown window comes from config, not a hardcoded 24', () => {
  const p = problems(good(), ctx({ recentlyRecognised: ['a'] }),
    { ...DEFAULT_RULES, cooldownHours: 72 })
  assert.match(problemFor('receivers', p)!, /72 hours/)
})

// ── what for ─────────────────────────────────────────────────────────────

test('category is required by default and optional when config says so', () => {
  const p = problems(good({ categoryCode: null }), ctx())
  assert.match(problemFor('category', p)!, /what the shoutout is for/)
  assert.deepEqual(
    problems(good({ categoryCode: null }), ctx(), { ...DEFAULT_RULES, requireCategory: false }), [])
})

test('a value is demanded by the CATEGORY or by the company, either alone', () => {
  // Two independent switches. Missing that would let a values-programme
  // company post value-less shoutouts through a category that happens not
  // to demand one.
  const byCategory = problems(good({ categoryRequiresValue: true }), ctx())
  assert.match(problemFor('value', byCategory)!, /needs a company value/)

  const byCompany = problems(good(), ctx(), { ...DEFAULT_RULES, requireValue: true })
  assert.match(problemFor('value', byCompany)!, /needs a company value/)

  assert.deepEqual(problems(good({ categoryRequiresValue: true, valueIds: ['v1'] }), ctx()), [])
})

// ── the words ────────────────────────────────────────────────────────────

test('the minimum is measured on TRIMMED length, as the database measures it', () => {
  // Otherwise twenty spaces passes here and fails there.
  assert.equal(messageLength('   hello   '), 5)
  const spaces = problems(good({ message: ' '.repeat(40) }), ctx())
  assert.ok(problemFor('message', spaces))
})

test('an empty message and a short one say different things', () => {
  const empty = problems(good({ message: '' }), ctx())
  assert.match(problemFor('message', empty)!, /Say why\./)
  const short = problems(good({ message: 'thanks' }), ctx())
  assert.match(problemFor('message', short)!, /Say a little more/)
})

test('exactly the minimum length is allowed', () => {
  const exact = 'x'.repeat(DEFAULT_RULES.minMessageLength)
  assert.deepEqual(problems(good({ message: exact }), ctx()), [])
})

// ── quota ────────────────────────────────────────────────────────────────

test('the daily limit blocks sending and is reported last', () => {
  // Last because it is the only problem that editing the form cannot fix.
  const p = problems(good(), ctx({ sentToday: 5 }))
  assert.equal(p[p.length - 1].field, 'quota')
  assert.match(problemFor('quota', p)!, /all 5 shoutouts for today/)
  assert.equal(canSend(good(), ctx({ sentToday: 5 })), false)
})

test('remaining is shown before writing, and never goes negative', () => {
  assert.equal(remainingToday(ctx({ sentToday: 0 })), 5)
  assert.equal(remainingToday(ctx({ sentToday: 4 })), 1)
  assert.equal(remainingToday(ctx({ sentToday: 9 })), 0)
})

// ── visibility ───────────────────────────────────────────────────────────

test('every visibility says who will actually see it, in plain words', () => {
  for (const v of VISIBILITIES) {
    const note = visibilityNote(v)
    assert.ok(note.length > 20, v)
    assert.match(note, /see this/)
    assert.doesNotMatch(note, /[A-Z]{4,}|_/)
  }
  assert.match(visibilityNote('nonsense'), /HR team decides/)
})

test('the visibility list matches the database CHECK constraint', () => {
  assert.deepEqual([...VISIBILITIES], ['company', 'branch', 'department', 'team'])
})

// ── the rule this module exists under ────────────────────────────────────

test('nothing here converts recognition into money', () => {
  // wall_config.payout_linkage is pinned false by a CHECK. This asserts the
  // client half of that promise: no rate, no total, no currency anywhere.
  // ESM: readFileSync is imported at the top. `require` is not defined here.
  const src = readFileSync('lib/wall/shoutout.ts', 'utf8')
  for (const word of ['salary', 'payout', 'bonus', 'increment', 'currency', 'amount', '₹']) {
    assert.doesNotMatch(src.replace(/payout_linkage/g, ''), new RegExp(word, 'i'), word)
  }
})
