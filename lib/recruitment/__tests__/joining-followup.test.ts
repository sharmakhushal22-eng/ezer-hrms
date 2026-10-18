// lib/recruitment/__tests__/joining-followup.test.ts — the hiring manager's
// "connect with your candidate" cadence: every 4 days, every 2 days once
// joining is within 6 days, nothing after the joining date.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadenceDays, daysToJoin, followupDue, followupMail, joiningDate } from '../joining-followup.ts'

// 13-Oct-2026 09:00 IST
const NOW = Date.parse('2026-10-13T03:30:00Z')
const iso = (d: string) => `${d}T05:00:00Z`

test('cadence: more than 6 days away → 4 days; 6 or fewer → 2 days', () => {
  assert.equal(cadenceDays(30), 4)
  assert.equal(cadenceDays(7), 4)
  assert.equal(cadenceDays(6), 2)
  assert.equal(cadenceDays(1), 2)
  assert.equal(cadenceDays(0), 2)
})

test('days to join is counted in Indian calendar days', () => {
  assert.equal(daysToJoin('2026-10-13', NOW), 0)
  assert.equal(daysToJoin('2026-10-20', NOW), 7)
  assert.equal(daysToJoin('2026-10-19T00:00:00+00:00', NOW), 6)
  assert.equal(daysToJoin('2026-10-10', NOW), -3)
  // 23:30 UTC on the 13th is already the 14th in India
  assert.equal(daysToJoin('2026-10-14', Date.parse('2026-10-13T23:30:00Z')), 0)
  assert.equal(daysToJoin('garbage', NOW), null)
})

test('first reminder: measured from the day the offer was sent', () => {
  const far = { doj: '2026-11-10', lastAt: null, now: NOW }
  assert.equal(followupDue({ ...far, offerSentAt: iso('2026-10-10') }).due, false)   // 3 days: not yet
  assert.equal(followupDue({ ...far, offerSentAt: iso('2026-10-09') }).due, true)    // 4 days: due
  const near = { doj: '2026-10-18', lastAt: null, now: NOW }                           // 5 days away
  assert.equal(followupDue({ ...near, offerSentAt: iso('2026-10-12') }).due, false)  // 1 day
  assert.equal(followupDue({ ...near, offerSentAt: iso('2026-10-11') }).due, true)   // 2 days
  // No offer_sent_at on record at all: remind now rather than never.
  assert.equal(followupDue({ ...far, offerSentAt: null }).due, true)
})

test('later reminders: measured from the previous one, cadence follows the window', () => {
  const r = followupDue({ doj: '2026-10-17', offerSentAt: iso('2026-09-20'), lastAt: iso('2026-10-11'), now: NOW })
  assert.deepEqual(r, { due: true, daysToJoin: 4, cadence: 2 })
  const tooSoon = followupDue({ doj: '2026-11-17', offerSentAt: iso('2026-09-20'), lastAt: iso('2026-10-11'), now: NOW })
  assert.equal(tooSoon.due, false); assert.equal(tooSoon.reason, 'too-soon'); assert.equal(tooSoon.cadence, 4)
})

test('a reminder sent later in the day than the cron runs does not slip a day', () => {
  // last reminder at 15:00 IST four days ago; cron at 09:00 IST today → still 4 calendar days
  const r = followupDue({ doj: '2026-12-01', offerSentAt: null, lastAt: '2026-10-09T09:30:00Z', now: NOW })
  assert.equal(r.due, true)
})

test('nothing once joining has passed, nothing without a joining date', () => {
  assert.equal(followupDue({ doj: '2026-10-12', offerSentAt: null, lastAt: null, now: NOW }).reason, 'joined-or-passed')
  assert.equal(followupDue({ doj: null, offerSentAt: null, lastAt: null, now: NOW }).reason, 'no-doj')
  // The joining day itself still gets one: "joins today, please check they are coming".
  assert.equal(followupDue({ doj: '2026-10-13', offerSentAt: null, lastAt: null, now: NOW }).due, true)
})

test('the joining date is the most authoritative one on record', () => {
  assert.equal(joiningDate({ onboarding_date: '2026-11-01', doj: '2026-11-02', request_doj: '2026-11-03' }), '2026-11-01')
  assert.equal(joiningDate({ onboarding_date: null, doj: null, letter_doj: null, request_doj: '2026-11-03', negotiation_doj: '2026-11-04' }), '2026-11-03')
  assert.equal(joiningDate({}), null)
})

test('the mail says who, when, and how often', () => {
  const m = followupMail({ managerName: 'Riya', candidate: 'Arun Varma', role: 'Sales Executive', mrfNumber: 'MRF-0042', doj: '2026-10-20', daysToJoin: 7, cadence: 4, candidatePhone: '98765 43210', candidateEmail: 'arun@example.com' })
  assert.equal(m.subject, 'Connect with your candidate — Arun Varma joins in 7 days')
  assert.match(m.text, /Kindly connect with your candidate Arun Varma \(Sales Executive\) · MRF-0042 and ask for their status/)
  assert.match(m.text, /Joining date: 20 Oct 2026 \(in 7 days\)/)
  assert.match(m.text, /every 4 days until they join \(every 2 days once joining is within 6 days\)/)
  const near = followupMail({ managerName: null, candidate: 'A', role: null, mrfNumber: null, doj: '2026-10-14', daysToJoin: 1, cadence: 2, candidatePhone: null, candidateEmail: null })
  assert.equal(near.subject, 'Connect with your candidate — A joins tomorrow')
  assert.match(near.text, /every 2 days until they join\./)
})
