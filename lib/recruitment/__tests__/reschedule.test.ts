// lib/recruitment/__tests__/reschedule.test.ts — editing a scheduled interview round.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rescheduleProblems, changesOf, peopleDiff, type RoundSchedule } from '../reschedule.ts'

const now = Date.UTC(2026, 9, 27, 6)
const later = new Date(now + 86400_000).toISOString()
const prev: RoundSchedule = { mainId: 'a', panelIds: ['b', 'c'], scheduledAt: later, link: 'https://meet.google.com/old', passcode: '1111' }

test('nothing changed is refused', () => {
  assert.ok(rescheduleProblems(prev, { ...prev }, now).includes('Nothing has changed.'))
})

test('any edit must replace BOTH the link and the passcode', () => {
  const moved = { ...prev, scheduledAt: new Date(now + 2 * 86400_000).toISOString() }
  const p = rescheduleProblems(prev, moved, now)
  assert.ok(p.some(x => x.startsWith('Replace the meeting link')))
  assert.ok(p.some(x => x.startsWith('Replace the meeting passcode')))
  assert.ok(rescheduleProblems(prev, { ...moved, link: 'https://meet.google.com/new' }, now).some(x => x.startsWith('Replace the meeting passcode')))
  assert.deepEqual(rescheduleProblems(prev, { ...moved, link: 'https://meet.google.com/new', passcode: '2222' }, now), [])
})

test('blank link / passcode, no main, a past time and a non-URL are refused', () => {
  const p = rescheduleProblems(prev, { mainId: null, panelIds: [], scheduledAt: new Date(now - 86400_000).toISOString(), link: '', passcode: '' }, now)
  for (const m of ['Select the main interviewer.', 'The interview time is in the past.', 'Enter the new meeting link.', 'Enter the new meeting passcode.']) assert.ok(p.includes(m), m)
  assert.ok(rescheduleProblems(prev, { ...prev, link: 'meet.google.com/x', passcode: '2' }, now).some(x => x.includes('https://')))
})

test('changing only the interviewers still needs a new link and passcode, then passes', () => {
  const swap = { ...prev, panelIds: ['b'], link: 'https://zoom.us/j/9', passcode: '9' }
  assert.deepEqual(rescheduleProblems(prev, swap, now), [])
  assert.deepEqual(changesOf(prev, swap), { main: false, panel: true, time: false, link: true, passcode: true })
})

test('peopleDiff: kept, added, removed across main and panel', () => {
  const d = peopleDiff(prev, { ...prev, mainId: 'b', panelIds: ['d'] })
  assert.deepEqual(d, { kept: ['b'], added: ['d'], removed: ['a', 'c'] })
})
