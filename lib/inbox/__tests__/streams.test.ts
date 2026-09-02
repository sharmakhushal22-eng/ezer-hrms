// Which department owns a notification. This decides the folder every
// message lands in, so a wrong answer here is a message the employee looks
// for in the wrong place — and it is pure, so it can be tested properly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamFor, STREAMS, STREAM, streamInk, streamLabel } from '../streams.ts'

test('real catalogue codes land in the department that owns them', () => {
  // Straight from lib/notifications/catalogue.ts — not invented for the test.
  assert.equal(streamFor('LEAVE_APPROVED'), 'TIME')
  assert.equal(streamFor('LEAVE_REJECTED'), 'TIME')
  assert.equal(streamFor('PAYSLIP_READY'), 'PAYROLL')
  assert.equal(streamFor('DECLARATION_WINDOW_OPEN'), 'PAYROLL')
  assert.equal(streamFor('PROOF_VERIFIED'), 'PAYROLL')
  assert.equal(streamFor('PROOF_REJECTED'), 'PAYROLL')
  assert.equal(streamFor('TRAVEL_APPROVED'), 'FINANCE')
  assert.equal(streamFor('TRAVEL_PAID'), 'FINANCE')
  assert.equal(streamFor('RESIGNATION_ACKNOWLEDGED'), 'EXIT')
  assert.equal(streamFor('FNF_PROCESSED'), 'EXIT')
  assert.equal(streamFor('EXIT_CLEARANCE_ASSIGNED'), 'EXIT')
  assert.equal(streamFor('ROLE_CHANGED'), 'IT')
  assert.equal(streamFor('MAGIC_LINK_SENT'), 'RECRUITMENT')
  assert.equal(streamFor('OFFER_LETTER_SENT'), 'RECRUITMENT')
})

test('celebrations are people-news, so they go to HR', () => {
  assert.equal(streamFor('BIRTHDAY'), 'HR')
  assert.equal(streamFor('ANNIVERSARY'), 'HR')
})

test('an unknown code falls to HR rather than vanishing', () => {
  // The failure mode being guarded against is a notification with no folder,
  // which would be delivered and then be invisible.
  assert.equal(streamFor('SOMETHING_NOBODY_HAS_WRITTEN_YET'), 'HR')
  assert.equal(streamFor(''), 'HR')
  assert.equal(streamFor(null), 'HR')
  assert.equal(streamFor(undefined), 'HR')
})

test('matching is case-insensitive and prefix-based, so new codes route themselves', () => {
  // The point of prefix matching: a LEAVE_* code added next month should land
  // in the leave folder on the day it is added, not the day somebody
  // remembers to list it.
  assert.equal(streamFor('leave_cancelled'), 'TIME')
  assert.equal(streamFor('LEAVE_ENCASHMENT_APPROVED'), 'TIME')
  assert.equal(streamFor('PMS_ANYTHING_AT_ALL'), 'PERFORMANCE')
  assert.equal(streamFor('KRA_LOCKED'), 'PERFORMANCE')
})

test('every stream has an ink pair, and light and dark are different', () => {
  for (const s of STREAMS) {
    assert.match(s.ink.l, /^#[0-9A-Fa-f]{6}$/, s.code + ' light ink')
    assert.match(s.ink.d, /^#[0-9A-Fa-f]{6}$/, s.code + ' dark ink')
    assert.notEqual(s.ink.l, s.ink.d,
      s.code + ': one ink cannot serve both themes — that is the bug this guards')
  }
})

test('every stream a code can resolve to actually exists as a folder', () => {
  // streamFor must never return something the UI has no folder for; that
  // would be a message routed to nowhere.
  const codes = [
    'LEAVE_X', 'PAYSLIP_X', 'TRAVEL_X', 'PMS_X', 'MRF_X',
    'RESIGNATION_X', 'ROLE_X', 'BIRTHDAY', 'TOTALLY_UNKNOWN',
  ]
  for (const c of codes) assert.ok(STREAM.has(streamFor(c)), c + ' resolved to an unknown stream')
})

test('lookup helpers survive rubbish rather than throwing', () => {
  // These run inside a render; an exception here blanks the inbox.
  assert.ok(streamInk('NOT_A_STREAM').l.startsWith('#'))
  assert.equal(streamLabel('NOT_A_STREAM'), 'HR')
})

test('stream codes are unique', () => {
  const seen = new Set(STREAMS.map(s => s.code))
  assert.equal(seen.size, STREAMS.length, 'two streams share a code')
})
