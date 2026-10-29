// Who must confirm a GPS sub-trip, and what state its review is in.
//
// The rules here mirror te_leg_confirm / te_leg_send_back in migration 180 word
// for word. SQL is the floor; this is so a screen can disable a button and show
// the reason instead of letting somebody press it and read a server error. When
// the two disagree the SQL wins and this is the bug — which is why the refusal
// sentences are asserted literally, not loosely.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canConfirm, canSendBack, confirmPolicy, evidenceNotes, holdsClaim, mustConfirm,
  reviewState, reviewTone, type ConfirmPolicy,
} from '../journey-review.ts'
import type { TeLegReview } from '../types.ts'

const NOBODY: TeLegReview = {
  deskAt: null, deskBy: null, deskName: null,
  finAt: null, finBy: null, finName: null,
  backAt: null, backBy: null, backName: null, backDesk: '', backWhy: '', answer: '',
}
const AT = '2026-10-20T09:00:00Z'
const deskOk: TeLegReview = { ...NOBODY, deskAt: AT, deskBy: 'e1', deskName: 'Priya' }
const finOk: TeLegReview = { ...NOBODY, finAt: AT, finBy: 'e2', finName: 'Arjun' }
const bothOk: TeLegReview = { ...deskOk, finAt: AT, finBy: 'e2', finName: 'Arjun' }
const sentBack: TeLegReview = { ...NOBODY, backAt: AT, backBy: 'e1', backName: 'Priya', backDesk: 'travel_desk', backWhy: 'The route does not reach the client office.' }

// ── reading the setting ─────────────────────────────────────────────────────

test('the four policies are read as themselves', () => {
  for (const p of ['both', 'finance', 'desk', 'none']) assert.equal(confirmPolicy(p), p)
  assert.equal(confirmPolicy(' both '), 'both', 'trimmed')
})

test('a typo in the settings box does not switch the checks off', () => {
  // The dangerous failure is silent: 'Both' or 'finanace' reading as "nobody
  // need confirm anything" would turn the whole feature off and look fine.
  for (const bad of ['Both', 'finanace', '', '   ', 'yes', null, undefined, 7, {}]) {
    assert.equal(confirmPolicy(bad), 'both', `${JSON.stringify(bad)} falls back to the strictest`)
  }
})

// ── who must confirm ────────────────────────────────────────────────────────

test('both means both', () => {
  assert.equal(mustConfirm('both', 'travel'), true)
  assert.equal(mustConfirm('both', 'finance'), true)
})

test('one desk policies exclude the other', () => {
  assert.equal(mustConfirm('finance', 'finance'), true)
  assert.equal(mustConfirm('finance', 'travel'), false)
  assert.equal(mustConfirm('desk', 'travel'), true)
  assert.equal(mustConfirm('desk', 'finance'), false)
})

test('none means nobody', () => {
  assert.equal(mustConfirm('none', 'travel'), false)
  assert.equal(mustConfirm('none', 'finance'), false)
})

// ── the state of one review ─────────────────────────────────────────────────

test('a reported journey nobody has looked at is waiting', () => {
  assert.equal(reviewState(NOBODY, 'both'), 'waiting')
  assert.equal(reviewState(null, 'both'), 'waiting')
})

test('under both, one confirmation is not finished', () => {
  assert.equal(reviewState(deskOk, 'both'), 'desk-ok')
  assert.equal(reviewState(finOk, 'both'), 'fin-ok')
  assert.equal(reviewState(bothOk, 'both'), 'done')
})

test('under a single-desk policy, that desk alone finishes it', () => {
  assert.equal(reviewState(finOk, 'finance'), 'done')
  assert.equal(reviewState(deskOk, 'desk'), 'done')
})

test('a confirmation nobody required still counts as having happened', () => {
  // Under 'finance' the travel desk is not a gate, but if somebody there did
  // look and agree, that is a fact and the screen should say it. What it must
  // not do is call the review finished — Finance has still not looked.
  assert.equal(reviewState(deskOk, 'finance'), 'desk-ok')
  assert.equal(reviewState(finOk, 'desk'), 'fin-ok')
})

test('under none, everything reads as finished', () => {
  // The list and the routes stay as a record; nobody is being waited on.
  assert.equal(reviewState(NOBODY, 'none'), 'done')
})

test('sent back beats every confirmation', () => {
  // Somebody is being waited on, and the claim is held. That has to show even
  // if one desk had already agreed before the other asked.
  assert.equal(reviewState(sentBack, 'both'), 'back')
  assert.equal(reviewState({ ...sentBack, finAt: AT }, 'both'), 'back')
  assert.equal(reviewState(sentBack, 'none'), 'back', 'even where nobody must confirm')
})

test('an answered question is not the same as an unexamined journey', () => {
  // A plain 'waiting' would lose the fact that a person asked something and is
  // expecting to look again.
  const answered: TeLegReview = { ...NOBODY, answer: 'Bad signal in the basement --- I went in via the service road.' }
  assert.equal(reviewState(answered, 'both'), 'answered')
})

test('only a sent-back journey holds the claim', () => {
  assert.equal(holdsClaim(sentBack), true)
  assert.equal(holdsClaim(NOBODY), false)
  assert.equal(holdsClaim(bothOk), false)
  assert.equal(holdsClaim(null), false)
})

// ── may this desk confirm ───────────────────────────────────────────────────

const ask = (over: Partial<Parameters<typeof canConfirm>[0]> = {}) =>
  canConfirm({ desk: 'travel', policy: 'both' as ConfirmPolicy, status: 'SUBMITTED', review: NOBODY, ...over })

test('the travel desk may confirm a reported journey', () => {
  assert.deepEqual(ask(), { ok: true })
})

test('Finance waits for the desk, under both', () => {
  // The order is the whole reason 'both' is in turn: "should we pay for this"
  // means nothing until "did it happen" has been answered.
  assert.deepEqual(ask({ desk: 'finance' }), { ok: false, why: 'The travel desk has not confirmed this journey yet.' })
  assert.deepEqual(ask({ desk: 'finance', review: deskOk }), { ok: true })
})

test('a journey that is not reported cannot be confirmed, and says which', () => {
  assert.deepEqual(ask({ status: 'ENDED' }), { ok: false, why: 'The traveller has not reported this journey yet.' })
  assert.deepEqual(ask({ status: 'ACTIVE' }), { ok: false, why: 'This journey is still running.' })
  assert.deepEqual(ask({ status: 'PAUSED' }), { ok: false, why: 'This journey is still running.' })
  assert.deepEqual(ask({ status: 'PLANNED' }), { ok: false, why: 'This journey has not been recorded yet.' })
  assert.deepEqual(ask({ status: 'SKIPPED' }), { ok: false, why: 'This journey was skipped, so there is nothing to confirm.' })
})

test('a desk that is not a gate is told so, and told it can still ask', () => {
  assert.deepEqual(ask({ policy: 'finance' }),
    { ok: false, why: 'Here, Finance confirms journeys. You can still send one back.' })
  assert.deepEqual(ask({ desk: 'finance', policy: 'desk' }),
    { ok: false, why: 'Here, the travel desk confirms journeys. You can still send one back.' })
})

test('nobody confirms twice', () => {
  assert.deepEqual(ask({ review: deskOk }), { ok: false, why: 'The travel desk has already confirmed this journey.' })
  assert.deepEqual(ask({ desk: 'finance', review: bothOk }), { ok: false, why: 'Finance has already confirmed this journey.' })
})

test('where nobody must confirm, nobody can', () => {
  assert.deepEqual(ask({ policy: 'none' }), { ok: false, why: 'This company does not ask anyone to confirm journeys.' })
})

// ── may this desk ask ───────────────────────────────────────────────────────

test('either desk may send a reported journey back, whatever the policy', () => {
  // A desk that is not a gate can still have a question, and a company that
  // asks nobody to confirm has not said a wrong route must be accepted.
  for (const p of ['both', 'finance', 'desk', 'none'] as ConfirmPolicy[]) {
    assert.deepEqual(canSendBack({ status: 'SUBMITTED', review: NOBODY }), { ok: true }, p)
  }
})

test('an unreported journey cannot be sent back', () => {
  assert.deepEqual(canSendBack({ status: 'ENDED', review: NOBODY }),
    { ok: false, why: 'Only a journey that has been reported can be sent back.' })
})

test('it cannot be sent back twice', () => {
  assert.deepEqual(canSendBack({ status: 'SUBMITTED', review: sentBack }),
    { ok: false, why: 'This journey has already been sent back and is waiting on the traveller.' })
})

// ── the badge ───────────────────────────────────────────────────────────────

test('every state has its own wording, and sent back is the only bad one', () => {
  const states = ['waiting', 'desk-ok', 'fin-ok', 'done', 'back', 'answered'] as const
  const seen = new Set<string>()
  for (const s of states) {
    const t = reviewTone(s)
    assert.ok(t.text, `${s} has wording`)
    assert.ok(!seen.has(t.text), `${s} wording is its own: ${t.text}`)
    seen.add(t.text)
  }
  assert.equal(reviewTone('back').tone, 'bad')
  assert.equal(reviewTone('done').tone, 'ok')
})

// ── what a reviewer is told before confirming ───────────────────────────────

test('an untracked journey says so, with the reason given', () => {
  assert.deepEqual(evidenceNotes({ manual: true, noGps: 'Phone battery died' }),
    ['No GPS record: Phone battery died'])
  assert.deepEqual(evidenceNotes({ manual: true }),
    ['No GPS record. The traveller entered the distance themselves.'])
})

test('a tracked journey with no route explains the empty map', () => {
  // Otherwise the reviewer is left wondering why there is nothing to see.
  assert.deepEqual(evidenceNotes({ routeLine: '' }),
    ['No route was kept for this journey, so it cannot be drawn.'])
  assert.deepEqual(evidenceNotes({ routeLine: '_p~iF~ps|U' }), [])
})

test('a missing bill is named only where the bill is the amount', () => {
  assert.deepEqual(evidenceNotes({ routeLine: 'abc', basis: 'bill', fileCount: 0 }),
    ['No bill is attached, and this mode is paid on the bill.'])
  assert.deepEqual(evidenceNotes({ routeLine: 'abc', basis: 'bill', fileCount: 1 }), [])
  // Own vehicle is paid per km and auto is paid without a bill: neither is
  // missing anything.
  assert.deepEqual(evidenceNotes({ routeLine: 'abc', basis: 'km', fileCount: 0 }), [])
  assert.deepEqual(evidenceNotes({ routeLine: 'abc', basis: 'nobill', fileCount: 0 }), [])
})

test('an untracked cab with no bill says both things', () => {
  assert.deepEqual(evidenceNotes({ manual: true, noGps: 'Forgot to start it', basis: 'bill', fileCount: 0 }), [
    'No GPS record: Forgot to start it',
    'No bill is attached, and this mode is paid on the bill.',
  ])
})
