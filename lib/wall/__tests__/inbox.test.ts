// The Wall of Fame inbox streams.
//
// The rule that matters most is a negative one: no approvals, ever. Workflow
// noise beside a thank-you note is what makes people triage a recognition
// inbox instead of reading it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STREAM_OF, STREAMS, headlineFor, glyphFor, countFor, countsReconcile,
  type WallEvent, type Stream,
} from '../inbox.ts'

const ALL = Object.keys(STREAM_OF) as WallEvent[]

test('the seven event types match the database CHECK exactly', () => {
  const sql = readFileSync('supabase/migrations/087_social_and_inbox.sql', 'utf8')
  // No /s flag: the project targets ES2017 and [^)] already crosses
  // newlines. Second time this session — worth remembering.
  const m = /event_type[^)]*?check\s*\(\s*event_type\s+in\s*\(([^)]*)\)/i.exec(sql)
  assert.ok(m, 'no event_type CHECK found')
  const allowed = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
  assert.deepEqual(ALL.sort(), [...allowed].sort())
})

test('NO APPROVAL is among them, and none can be added here', () => {
  for (const e of ALL) {
    assert.doesNotMatch(e, /approv|endors|publish/i, e)
  }
})

test('every event belongs to exactly one stream', () => {
  for (const e of ALL) {
    assert.ok(['appreciation', 'comments', 'replies'].includes(STREAM_OF[e]), e)
  }
})

test('the stream mapping mirrors get_inbox_counts()', () => {
  // If these disagree, a tab shows a number the list cannot account for.
  const sql = readFileSync('supabase/migrations/087_social_and_inbox.sql', 'utf8')
  const fn = sql.slice(sql.indexOf('function get_inbox_counts'))
  const grab = (label: string) => {
    // [\s\S]*? not [^)]*? — count(*) filter (...) sits between the label and
    // event_type, so a paren-excluding class stops before it ever arrives.
    // That is the third time this session a [^)] class has quietly matched
    // nothing and made a check pass for the wrong reason.
    const re = new RegExp(`'${label}',[\\s\\S]*?event_type\\s*(?:in\\s*\\(([^)]*)\\)|=\\s*'([a-z_]+)')`, 'i')
    const m = re.exec(fn)
    if (!m) return []
    return m[1] ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [m[2]]
  }
  for (const stream of ['appreciation', 'comments', 'replies'] as const) {
    const fromSql = grab(stream).sort()
    const fromTs = ALL.filter(e => STREAM_OF[e] === stream).sort()
    assert.deepEqual(fromTs, fromSql, stream)
  }
})

test('every event has a headline written in the second person', () => {
  for (const e of ALL) {
    const h = headlineFor(e, 'Priya Nair')
    assert.match(h, /Priya Nair/, e)
    assert.ok(h.length > 12, e)
    assert.doesNotMatch(h, /[A-Z]{4,}|_/, e)
  }
})

test('headlines are distinct — a row must say which kind it is', () => {
  const seen = new Set(ALL.map(e => headlineFor(e, 'X')))
  assert.equal(seen.size, ALL.length)
})

test('every event has a glyph, and the glyph is never the only signal', () => {
  for (const e of ALL) {
    assert.ok(glyphFor(e).length > 0, e)
    // the headline always carries the meaning in words as well
    assert.ok(headlineFor(e, 'X').length > 0)
  }
})

test('the tab count is the stream count, and `all` is the total', () => {
  const c = { total_unread: 9, appreciation: 4, comments: 3, replies: 2 }
  assert.equal(countFor('all', c), 9)
  assert.equal(countFor('appreciation', c), 4)
  assert.equal(countFor('comments', c), 3)
  assert.equal(countFor('replies', c), 2)
  assert.equal(countFor('appreciation', {}), 0)
})

test('counts that do not add up are detectable, not hidden', () => {
  // An unclaimed event type shows as a badge nobody can clear by opening
  // anything. Better to know.
  assert.equal(countsReconcile({ total_unread: 9, appreciation: 4, comments: 3, replies: 2 }), true)
  assert.equal(countsReconcile({ total_unread: 10, appreciation: 4, comments: 3, replies: 2 }), false)
  assert.equal(countsReconcile({}), true)
})

test('the four tabs are named and explained', () => {
  assert.equal(STREAMS.length, 4)
  assert.equal(STREAMS[0].k, 'all')
  for (const s of STREAMS) {
    assert.ok(s.label.length > 3, s.k)
    assert.ok(s.blurb.length > 15, s.k)
    assert.doesNotMatch(s.blurb, /approv/i, 'an approval must never be described here')
  }
})
