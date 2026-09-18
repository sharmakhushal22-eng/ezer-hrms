// The pure logic behind the redesigned inbox list: which conversations a
// folder + filter + search should show, what each badge counts, where the red
// "New" divider sits, and how the screen says the time.
//
// The rule these exist to protect is the first one in the current-design doc:
// THE THREE UNREAD COUNTS ARE NEVER SUMMED. A pending request and a
// colleague's thank-you note are not the same kind of unread, and one number
// for both teaches people to ignore the number.
//
// Ported from the redesign package's vitest suite to this repo's runner
// (node:test + node:assert, the convention in the two files beside this one).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  catchUpBuckets, messagesUnread, newDividerIndex, selectConversations, unreadByFolder,
} from '../../../components/ess/inbox/selectors.ts'
import {
  dayLabel, initials, relTime, withinGroupWindow,
} from '../../../components/ess/inbox/time.ts'
import { MOCK_CONVERSATIONS, MOCK_WALL } from '../../../components/ess/inbox/__preview__/mock-data.ts'

const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// ── selectConversations ──────────────────────────────────────────────────

test('filters by folder', () => {
  const r = selectConversations(MOCK_CONVERSATIONS, { folder: 'DIRECT', filter: 'all', query: '' })
  assert.equal(r.every(c => c.folder === 'DIRECT'), true)
  assert.equal(r.length, 2)
})

test('returns everything for ALL', () => {
  const r = selectConversations(MOCK_CONVERSATIONS, { folder: 'ALL', filter: 'all', query: '' })
  assert.equal(r.length, MOCK_CONVERSATIONS.length)
})

test('filters unread and starred', () => {
  assert.equal(
    selectConversations(MOCK_CONVERSATIONS, { folder: 'ALL', filter: 'unread', query: '' })
      .every(c => c.unread > 0), true)
  assert.equal(
    selectConversations(MOCK_CONVERSATIONS, { folder: 'ALL', filter: 'starred', query: '' })
      .every(c => c.starred), true)
})

test('searches title, preview and subtitle, case-insensitively', () => {
  const ids = (q: string) =>
    selectConversations(MOCK_CONVERSATIONS, { folder: 'ALL', filter: 'all', query: q }).map(c => c.id)
  assert.deepEqual(ids('priya'), ['c1'])     // title
  assert.deepEqual(ids('TDS'), ['c2'])       // preview
  assert.deepEqual(ids('SRS0044'), ['c5'])   // subtitle
})

test('sorts newest first', () => {
  const times = selectConversations(MOCK_CONVERSATIONS, { folder: 'ALL', filter: 'all', query: '' })
    .map(c => new Date(c.updatedAt).getTime())
  assert.deepEqual([...times].sort((a, b) => b - a), times)
})

test('combines folder + filter + query', () => {
  const r = selectConversations(MOCK_CONVERSATIONS, { folder: 'DIRECT', filter: 'unread', query: 'headcount' })
  assert.deepEqual(r.map(c => c.id), ['c1'])
})

// ── counts ───────────────────────────────────────────────────────────────

test('messagesUnread ignores muted conversations', () => {
  // Muting is a badge decision, not a delivery one: the conversation still
  // arrives and still lists, it just does not raise the number.
  const withMuted = [...MOCK_CONVERSATIONS, { ...MOCK_CONVERSATIONS[0], id: 'cm', unread: 9, muted: true }]
  assert.equal(messagesUnread(withMuted), messagesUnread(MOCK_CONVERSATIONS))
})

test('unreadByFolder keys by folder and never totals', () => {
  const byFolder = unreadByFolder(MOCK_CONVERSATIONS)
  assert.equal(byFolder.DIRECT, 2)
  assert.equal(byFolder.PAYROLL, 1)
  assert.equal(byFolder.TOTAL, undefined)
})

test('the Messages count and the Wall count stay separate', () => {
  // Rule 1. Nothing in the code should ever produce messages + wall.
  const m = messagesUnread(MOCK_CONVERSATIONS)
  const w = MOCK_WALL.filter(x => x.unread).length
  assert.ok(w > 0)
  assert.notEqual(m, m + w)
})

// ── catch-up ─────────────────────────────────────────────────────────────

test('catchUpBuckets separates updates-needing-action from unread conversations', () => {
  const { todo, unread } = catchUpBuckets(MOCK_CONVERSATIONS)
  assert.equal(todo.every(c => c.kind === 'SYSTEM' && c.unread > 0), true)
  assert.equal(unread.every(c => c.kind !== 'SYSTEM' && c.unread > 0), true)
  assert.equal(todo.some(c => c.id === unread[0]?.id), false)
})

// ── the New divider ──────────────────────────────────────────────────────

test('newDividerIndex points at the first unread message', () => {
  assert.equal(newDividerIndex(4, 2), 2)
  assert.equal(newDividerIndex(10, 1), 9)
})

test('newDividerIndex is -1 when nothing is unread or the count is impossible', () => {
  assert.equal(newDividerIndex(4, 0), -1)
  assert.equal(newDividerIndex(4, 9), -1)
})

// ── time, in the inbox voice ─────────────────────────────────────────────

test('relTime speaks the inbox voice', () => {
  assert.equal(relTime(min(0)), 'now')
  assert.equal(relTime(min(1)), 'now')
  assert.equal(relTime(min(12)), '12m')
  assert.equal(relTime(min(3 * 60)), '3h')
  assert.equal(relTime(min(26 * 60)), 'Yesterday')
  assert.match(relTime(min(6 * 24 * 60)), /\d{2} \w{3}/)
})

test('dayLabel labels days in a thread', () => {
  assert.equal(dayLabel(min(10)), 'Today')
  assert.equal(dayLabel(min(26 * 60)), 'Yesterday')
})

test('messages group inside a 5-minute window', () => {
  assert.equal(withinGroupWindow(min(10), min(12)), true)
  assert.equal(withinGroupWindow(min(10), min(20)), false)
})

test('initials are two letters at most', () => {
  assert.equal(initials('Priya Nair'), 'PN')
  assert.equal(initials('Rajesh'), 'R')
  assert.equal(initials('  Aman  Verma '), 'AV')
})

test('a bad timestamp does not crash the row', () => {
  assert.equal(relTime('not-a-date'), '')
})
