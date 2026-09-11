// The direct channel. Its limits ARE the feature, so they are tested as
// hard as any other rule: a note needs a category, cannot go to yourself,
// is throttled on its own counter, and never grows a thread.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  directProblems, canSendDirect, directProblemFor, notesLeftToday,
  modeNote, REPLY_RULE, DEFAULT_DIRECT, EMPTY_DIRECT,
  type DirectDraft, type DirectContext,
} from '../appreciation.ts'

const ME = 'me'
const ctx = (o: Partial<DirectContext> = {}): DirectContext => ({ actorId: ME, sentToday: 0, ...o })
const good = (o: Partial<DirectDraft> = {}): DirectDraft => ({
  ...EMPTY_DIRECT, receiverIds: ['a'], categoryCode: 'HELP', body: 'Thanks for the cover.', ...o,
})

test('a complete note is sendable', () => {
  assert.deepEqual(directProblems(good(), ctx()), [])
  assert.equal(canSendDirect(good(), ctx()), true)
})

test('a switched-off channel says so and stops there', () => {
  // Listing five other faults on a feature that is off is noise.
  const p = directProblems(EMPTY_DIRECT, ctx(), { ...DEFAULT_DIRECT, enabled: false })
  assert.equal(p.length, 1)
  assert.match(p[0].message, /switched off/)
})

test('you cannot appreciate yourself', () => {
  const p = directProblems(good({ receiverIds: [ME] }), ctx())
  assert.match(directProblemFor('receivers', p)!, /cannot send appreciation to yourself/)
})

test('duplicates are caught before the database collapses them', () => {
  assert.match(directProblemFor('receivers', directProblems(good({ receiverIds: ['a','a'] }), ctx()))!,
    /twice/)
})

test('a category is required by default, and optional when config says so', () => {
  assert.match(directProblemFor('category', directProblems(good({ categoryCode: null }), ctx()))!,
    /what you are appreciating them for/)
  assert.deepEqual(
    directProblems(good({ categoryCode: null }), ctx(), { ...DEFAULT_DIRECT, requireCategory: false }), [])
})

test('THERE IS NO MINIMUM LENGTH — but there is a minimum of something', () => {
  // A shoutout is published and must say something. "Thank you" sent
  // privately to one person is already a complete thought.
  assert.deepEqual(directProblems(good({ body: 'ta' }), ctx()), [])
  assert.match(directProblemFor('body', directProblems(good({ body: '   ' }), ctx()))!,
    /Say something/)
})

test('its quota is its own, not the shoutout counter', () => {
  assert.equal(DEFAULT_DIRECT.dailyLimit, 10)
  assert.equal(notesLeftToday(ctx({ sentToday: 3 })), 7)
  assert.match(directProblemFor('quota', directProblems(good(), ctx({ sentToday: 10 })))!,
    /all 10 appreciation notes/)
})

test('posting to the feed is refused when the company disallows it', () => {
  const p = directProblems(good({ mode: 'also_post' }), ctx(),
    { ...DEFAULT_DIRECT, allowShareToFeed: false })
  assert.match(directProblemFor('mode', p)!, /does not allow/)
  assert.deepEqual(directProblems(good({ mode: 'also_post' }), ctx()), [], 'allowed by default')
})

test('each send mode says plainly what it does, before it is chosen', () => {
  assert.match(modeNote('private', true), /Only they will see this/)
  assert.match(modeNote('private', true), /one thank-you back/)
  assert.match(modeNote('also_post', true), /company feed/)
  assert.match(modeNote('also_post', false), /does not allow/)
})

test('THE LIMIT IS STATED, not discovered', () => {
  // Somebody who sends a note and gets one reply must not be left wondering
  // why they cannot answer it.
  assert.match(REPLY_RULE, /reply once/)
  assert.match(REPLY_RULE, /not a chat/)
})

test('nothing in this module grows a thread', () => {
  // The rule from CLAUDE.md, asserted against the source. No replies table,
  // no conversation, no typing indicator, no "continue this thread".
  const src = readFileSync('lib/wall/appreciation.ts', 'utf8')
  for (const banned of ['conversationId', 'threadId', 'replies:', 'typing', 'continueThread']) {
    assert.doesNotMatch(src, new RegExp(banned, 'i'), banned)
  }
})

test('and nothing converts appreciation into money', () => {
  const src = readFileSync('lib/wall/appreciation.ts', 'utf8')
  for (const w of ['salary', 'bonus', 'payout', 'increment', '₹']) {
    assert.doesNotMatch(src, new RegExp('\\b' + w + '\\b', 'i'), w)
  }
})
