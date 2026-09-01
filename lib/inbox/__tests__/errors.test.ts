// The exact errors this has to recognise, in the exact shape PostgREST and
// supabase-js hand them over. The first case is the one that shipped broken:
// the detector read `message || code`, so with a message present it never
// looked at the code, and the employee saw the raw PostgREST string.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notInstalled } from '../errors.ts'

test('the real PostgREST "table not in schema cache" error', () => {
  assert.equal(notInstalled({
    code: 'PGRST205',
    details: null,
    hint: "Perhaps you meant the table 'public.inbox_desks'",
    message: "Could not find the table 'public.inbox_conversations' in the schema cache",
  }), true)
})

test('the plain Postgres undefined_table error', () => {
  assert.equal(notInstalled({
    code: '42P01', message: 'relation "inbox_messages" does not exist',
  }), true)
})

test('recognised from the code alone, and from the message alone', () => {
  // Either half has to be enough — depending on both being present is how
  // the original broke.
  assert.equal(notInstalled({ code: 'PGRST205' }), true)
  assert.equal(notInstalled({ message: "Could not find the table 'public.x' in the schema cache" }), true)
  assert.equal(notInstalled('relation "inbox_desks" does not exist'), true)
})

test('a real failure is NOT mistaken for a missing migration', () => {
  // Reporting "not switched on yet" for a genuine fault would hide it, which
  // is worse than the error message it replaces.
  assert.equal(notInstalled({ code: '23505', message: 'duplicate key value violates unique constraint' }), false)
  assert.equal(notInstalled({ code: '42703', message: 'column inbox_messages.foo does not exist' }), true) // partial apply — still "not installed"
  assert.equal(notInstalled({ code: 'PGRST301', message: 'JWT expired' }), false)
  assert.equal(notInstalled({ message: 'fetch failed' }), false)
})

test('nothing at all is not a missing migration', () => {
  assert.equal(notInstalled(null), false)
  assert.equal(notInstalled(undefined), false)
  assert.equal(notInstalled({}), false)
})
