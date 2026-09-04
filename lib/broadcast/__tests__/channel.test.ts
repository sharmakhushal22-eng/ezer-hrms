// The broadcast channel. Two of these rules ARE the feature — a channel that
// grows a public reply is just a group chat with a nicer name, and a private
// response that leaks is a broken promise to the person who typed it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canPublish, canRespond, canReadResponse, checkDraft, ordered, unreadCount,
  audienceLine, REPLIES_DISABLED, PRIORITY_LABEL, PRIORITY_MEANING,
  type Broadcast, type Publisher, type Draft,
} from '../channel.ts'

const pub = (id: string, active = true): Publisher =>
  ({ employeeId: id, name: id, isActive: active })

const bc = (o: Partial<Broadcast> & { id: string }): Broadcast => ({
  title: 'Title', body: 'Body', priority: 'NORMAL', publishedBy: 'hr',
  publishedAt: '2026-09-01T09:00:00Z', isPinned: false, isActive: true, ...o,
})

// ── rule 3: who may publish ──────────────────────────────────────────────

test('publishing is a list membership, never a role', () => {
  const list = [pub('alice')]
  assert.equal(canPublish('alice', list).allowed, true)
  assert.equal(canPublish('bob', list).allowed, false)
})

test('a revoked publisher is refused, and told it was revoked rather than never granted', () => {
  const list = [pub('alice', false)]
  const v = canPublish('alice', list)
  assert.equal(v.allowed, false)
  assert.match(v.because, /revoked/i)
  assert.doesNotMatch(v.because, /not on the publisher list/i)
})

test('a refusal says where to get it fixed', () => {
  assert.match(canPublish('bob', []).because, /inbox setup/i)
})

// ── rule 1: no public replies ────────────────────────────────────────────

test('the no-reply rule is stated once, and says WHY', () => {
  // If it only said "replies are disabled", the first person to ask would get
  // it re-enabled. The reason is the load-bearing part.
  assert.match(REPLIES_DISABLED, /cannot be replied to/i)
  assert.match(REPLIES_DISABLED, /everybody in the company/i)
  // And it must name the private path, because this text sits directly above
  // a "Reply privately" button. Saying only "no replies" there reads as a
  // contradiction, and somebody eventually assumes the button posts publicly.
  assert.match(REPLIES_DISABLED, /privately/i)
  assert.match(REPLIES_DISABLED, /only they will see it/i)
})

test('the module exposes no public-reply capability at all', async () => {
  const mod = await import('../channel.ts')
  const names = Object.keys(mod)
  const offenders = names.filter(n => /^(reply|postReply|addComment|thread)/i.test(n))
  assert.deepEqual(offenders, [],
    'a public reply helper here would eventually get a UI wired to it')
})

// ── rule 2: a response is private ────────────────────────────────────────

test('every recipient may respond privately — not only the senior ones', () => {
  // The point of the private path is that somebody who spots an error can say
  // so without contradicting the notice in front of 400 people. Limiting it
  // to seniors removes the group most likely to spot the error.
  for (const who of ['junior', 'anyone', 'md']) {
    assert.equal(canRespond(who, bc({ id: 'a' })).allowed, true)
  }
})

test('the publisher does not respond to their own broadcast', () => {
  const v = canRespond('hr', bc({ id: 'a', publishedBy: 'hr' }))
  assert.equal(v.allowed, false)
})

test('a withdrawn notice takes its response path with it', () => {
  const v = canRespond('anyone', bc({ id: 'a', isActive: false }))
  assert.equal(v.allowed, false)
  assert.match(v.because, /withdrawn/i)
})

test('a private response is readable by exactly two people', () => {
  const r = { authorId: 'emp', recipientId: 'hr' }
  assert.equal(canReadResponse('emp', r), true)
  assert.equal(canReadResponse('hr', r), true)
  for (const nosy of ['md', 'colleague', 'admin', '']) {
    assert.equal(canReadResponse(nosy, r), false, `${nosy} must not read a private response`)
  }
})

// ── ordering ─────────────────────────────────────────────────────────────

test('urgency outranks recency, and pinned outranks both', () => {
  // A safety notice from Tuesday matters more than this morning's canteen
  // menu; strict reverse-chronology buries it by lunchtime.
  const list = [
    bc({ id: 'menu',   priority: 'NORMAL',    publishedAt: '2026-09-04T08:00:00Z' }),
    bc({ id: 'safety', priority: 'URGENT',    publishedAt: '2026-09-01T08:00:00Z' }),
    bc({ id: 'policy', priority: 'IMPORTANT', publishedAt: '2026-09-02T08:00:00Z' }),
    bc({ id: 'pinned', priority: 'NORMAL',    publishedAt: '2026-08-01T08:00:00Z', isPinned: true }),
  ]
  assert.deepEqual(ordered(list).map(b => b.id), ['pinned', 'safety', 'policy', 'menu'])
})

test('same priority falls back to newest first', () => {
  const list = [
    bc({ id: 'old', publishedAt: '2026-09-01T08:00:00Z' }),
    bc({ id: 'new', publishedAt: '2026-09-04T08:00:00Z' }),
  ]
  assert.deepEqual(ordered(list).map(b => b.id), ['new', 'old'])
})

test('a withdrawn notice never appears in the feed', () => {
  const list = [bc({ id: 'gone', isActive: false }), bc({ id: 'live' })]
  assert.deepEqual(ordered(list).map(b => b.id), ['live'])
  assert.equal(unreadCount(list, new Set()), 1, 'and it is not counted as unread either')
})

test('unread counts only what is still live and not yet read', () => {
  const list = [bc({ id: 'a' }), bc({ id: 'b' }), bc({ id: 'c', isActive: false })]
  assert.equal(unreadCount(list, new Set(['a'])), 1)
  assert.equal(unreadCount(list, new Set(['a', 'b'])), 0)
})

// ── composing ────────────────────────────────────────────────────────────

const draft = (o: Partial<Draft> = {}): Draft => ({
  title: 'Office closed on Friday',
  body: 'The Gurugram office is closed this Friday for the annual electrical audit. Work from home; the VPN is unaffected.',
  priority: 'NORMAL', ...o,
})

test('a valid draft from a listed publisher passes', () => {
  assert.equal(checkDraft(draft(), [pub('alice')], 'alice').ok, true)
})

test('somebody not on the list cannot compose, however good the draft', () => {
  const c = checkDraft(draft(), [pub('alice')], 'bob')
  assert.equal(c.ok, false)
  assert.match(c.faults[0], /not on the publisher list/i)
})

test('a body too short to answer the obvious question is refused', () => {
  // Nobody can reply to ask what it meant. That is exactly why the bar is
  // higher here than for an ordinary message.
  const c = checkDraft(draft({ body: 'Please note the below.' }), [pub('a')], 'a')
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /nobody can reply to ask/i.test(f)))
})

test('an empty subject or body is named specifically, not lumped together', () => {
  const c = checkDraft(draft({ title: '', body: '' }), [pub('a')], 'a')
  assert.ok(c.faults.some(f => /subject line/i.test(f)))
  assert.ok(c.faults.some(f => /no message/i.test(f)))
})

test('an over-long subject is refused before it is silently truncated in a list', () => {
  const c = checkDraft(draft({ title: 'x'.repeat(130) }), [pub('a')], 'a')
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /120/.test(f)))
})

test('warnings do not block — they are the sender\'s judgement to make', () => {
  const c = checkDraft(draft({ priority: 'URGENT', isPinned: false }), [pub('a')], 'a')
  assert.equal(c.ok, true, 'an urgent unpinned notice is allowed')
  assert.ok(c.warnings.some(w => /slide down/i.test(w)))
})

test('a subject that shouts is flagged, with the screen-reader reason', () => {
  const c = checkDraft(draft({ title: 'OFFICE CLOSED ON FRIDAY' }), [pub('a')], 'a')
  assert.ok(c.warnings.some(w => /screen reader/i.test(w)))
})

test('a subject claiming urgency at Notice priority is flagged', () => {
  const c = checkDraft(draft({ title: 'Payroll cut-off — URGENT action needed' }),
                       [pub('a')], 'a')
  assert.ok(c.warnings.some(w => /priority is set to Notice/i.test(w)))
})

test('the audience line says the number and that it cannot be unsent', () => {
  assert.match(audienceLine(402), /402/)
  assert.match(audienceLine(402), /cannot be unsent/i)
  assert.match(audienceLine(1), /1 person\b/)
  assert.match(audienceLine(null), /everybody/i)
})

test('every priority has a label and a plain-language meaning', () => {
  for (const p of ['NORMAL', 'IMPORTANT', 'URGENT'] as const) {
    assert.match(PRIORITY_LABEL[p], /\S/)
    assert.ok(PRIORITY_MEANING[p].length > 25,
      `${p} needs to say what it is FOR, or everything becomes urgent`)
  }
})
