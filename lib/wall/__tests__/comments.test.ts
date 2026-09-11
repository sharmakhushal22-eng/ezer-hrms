// Threading and mention rendering.
//
// The depth rule is the feature: comment_max_depth defaults to 1, and
// add_comment() refuses anything deeper. The UI must never OFFER a reply the
// database would decline, and must never silently drop a comment somebody
// wrote just because its shape is unexpected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { threadComments, renderBody, type CommentRow } from '../comments.ts'

const c = (id: string, over: Partial<CommentRow> = {}): CommentRow => ({
  id, body: `body ${id}`, employee_id: 'e1', parent_comment_id: null,
  mentions: [], created_at: `2026-11-0${id.length}T10:0${id}:00Z`, ...over,
})

test('top-level comments come back in time order', () => {
  const t = threadComments([
    c('3', { created_at: '2026-11-03T00:00:00Z' }),
    c('1', { created_at: '2026-11-01T00:00:00Z' }),
    c('2', { created_at: '2026-11-02T00:00:00Z' }),
  ])
  assert.deepEqual(t.map(x => x.id), ['1', '2', '3'])
})

test('replies hang off their parent, in time order', () => {
  const t = threadComments([
    c('a', { created_at: '2026-11-01T00:00:00Z' }),
    c('r2', { parent_comment_id: 'a', created_at: '2026-11-03T00:00:00Z' }),
    c('r1', { parent_comment_id: 'a', created_at: '2026-11-02T00:00:00Z' }),
  ])
  assert.equal(t.length, 1)
  assert.deepEqual(t[0].replies.map(x => x.id), ['r1', 'r2'])
})

test('THE DEPTH RULE: a reply-to-a-reply is lifted, never dropped', () => {
  // The database refuses depth 3, but a row that predates the constraint
  // must still be readable. Hiding something a colleague wrote is worse
  // than showing it one level up.
  const t = threadComments([
    c('top'),
    c('mid', { parent_comment_id: 'top' }),
    c('deep', { parent_comment_id: 'mid' }),
  ])
  assert.equal(t.length, 1)
  assert.deepEqual(t[0].replies.map(x => x.id).sort(), ['deep', 'mid'])
  // and nothing is nested twice — the shape is exactly two levels
  assert.equal(Object.prototype.hasOwnProperty.call(t[0].replies[0], 'replies'), false)
})

test('a cycle in the data cannot hang the UI', () => {
  const t = threadComments([
    c('x', { parent_comment_id: 'y' }),
    c('y', { parent_comment_id: 'x' }),
  ])
  assert.deepEqual(t, [], 'no top-level comment, so nothing to show')
})

test('an orphaned reply is dropped rather than shown at top level', () => {
  // Its parent is hidden or deleted. Promoting it would put a reply where a
  // comment should be, out of the context it was written in.
  const t = threadComments([c('a'), c('orphan', { parent_comment_id: 'gone' })])
  assert.deepEqual(t.map(x => x.id), ['a'])
  assert.equal(t[0].replies.length, 0)
})

test('hidden comments are not rendered, and take their replies with them', () => {
  const t = threadComments([
    c('a', { is_hidden: true }),
    c('r', { parent_comment_id: 'a' }),
    c('b'),
  ])
  assert.deepEqual(t.map(x => x.id), ['b'])
})

test('an empty thread is an empty array, not a crash', () => {
  assert.deepEqual(threadComments([]), [])
})

// ── mentions ─────────────────────────────────────────────────────────────

const names = new Map([['e1', 'Priya Nair'], ['e2', 'Priya'], ['e3', 'Rajesh Mehta']])

test('a mention becomes a chip and the rest stays text', () => {
  const out = renderBody('Great work @Priya Nair on the audit', names)
  assert.deepEqual(out, ['Great work ', { at: 'Priya Nair' }, ' on the audit'])
})

test('the LONGEST name wins, so "Priya" cannot eat "Priya Nair"', () => {
  // Sorting short-first would chip "Priya" and leave " Nair" as loose text.
  const out = renderBody('thanks @Priya Nair', names)
  assert.deepEqual(out, ['thanks ', { at: 'Priya Nair' }])
})

test('several mentions in one comment all become chips', () => {
  const out = renderBody('@Priya Nair and @Rajesh Mehta both helped', names)
  assert.equal(out.filter(p => typeof p !== 'string').length, 2)
})

test('an @ that matches nobody stays plain text', () => {
  assert.deepEqual(renderBody('email me @noon', names), ['email me @noon'])
})

test('a name with regex characters does not break the matcher', () => {
  const odd = new Map([['x', 'A. B (Ops)']])
  assert.deepEqual(renderBody('hi @A. B (Ops)', odd), ['hi ', { at: 'A. B (Ops)' }])
})

test('with no names known, the body is returned untouched', () => {
  assert.deepEqual(renderBody('hello @someone', new Map()), ['hello @someone'])
})
