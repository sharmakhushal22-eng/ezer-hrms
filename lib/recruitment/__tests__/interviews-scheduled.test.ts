// lib/recruitment/__tests__/interviews-scheduled.test.ts — who sees which
// scheduled interview, and how its progress is described.
//
// WHY THIS FILE EXISTS
//
// The "Interviews Scheduled" tab shows interviews across the whole
// interview_invites table, so the scoping rule is the only thing standing
// between a recruiter and every other recruiter's hiring. That rule is a pure
// function precisely so it can be tested without React, Supabase or a session —
// the component around it does nothing but render what this returns.
//
// The status vocabulary is pinned too. ESS -> Tasks & Approvals
// (components/ess/RoleTabs.tsx) describes the SAME rows to the interviewer, and
// if the two screens drift a row reads one way to the person who scheduled it
// and another to the person conducting it.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// The .ts logic module, NOT the component. `node --experimental-strip-types`
// strips TypeScript but cannot load .tsx (ERR_UNKNOWN_FILE_EXTENSION), so
// importing these from InterviewsScheduled.tsx made the whole file unrunnable.
import {
  visibleInvites, statusOf, byWhen, type ScheduledInterview,
} from '../interviews-scheduled.ts'

type Row = ScheduledInterview

/** A row that passes, so each test can spoil exactly one thing. */
const row = (o: Partial<Row> = {}): Row => ({
  id: 'i1',
  candidate_id: 'c1',
  candidate_name: 'A Candidate',
  round: 'L1',
  interviewer_id: 'emp-1',
  interviewer_name: 'An Interviewer',
  interviewer_email: null,
  role: 'MAIN',
  scheduled_at: '2026-10-06T10:00:00.000Z',
  meet_link: null,
  meet_passcode: null,
  scheduled_by: 'me',
  scheduled_by_name: 'Me',
  status: 'invited',
  decision: null,
  submitted_at: null,
  company_id: 'co-1',
  ...o,
} as Row)

describe('who sees which interview', () => {
  const all = [
    row({ id: 'mine', scheduled_by: 'me', company_id: 'co-1' }),
    row({ id: 'theirs', scheduled_by: 'someone-else', company_id: 'co-1' }),
    row({ id: 'other-co', scheduled_by: 'me', company_id: 'co-2' }),
  ]

  test('THE RULE THAT MATTERS: a recruiter sees only what THEY scheduled', () => {
    const seen = visibleInvites(all, { employeeId: 'me', isOversight: false, companyId: null })
    assert.deepEqual(seen.map(r => r.id).sort(), ['mine', 'other-co'])
    assert.ok(!seen.some(r => r.id === 'theirs'),
      "another recruiter's interview must never appear on this tab")
  })

  test('an oversight role sees every row', () => {
    const seen = visibleInvites(all, { employeeId: 'me', isOversight: true, companyId: null })
    assert.equal(seen.length, 3)
  })

  test('a pinned company is applied to oversight too', () => {
    // companyFilter() returns the caller's own company for anyone who is not
    // cross-company. Oversight must not mean cross-company.
    const seen = visibleInvites(all, { employeeId: 'me', isOversight: true, companyId: 'co-1' })
    assert.deepEqual(seen.map(r => r.id).sort(), ['mine', 'theirs'])
  })

  test('a null companyId means every company, not none', () => {
    // companyFilter() returns null for a cross-company caller. Reading that as
    // "no company" would empty the screen for the people meant to see all of it.
    assert.equal(visibleInvites(all, { employeeId: 'me', isOversight: true, companyId: null }).length, 3)
  })

  test('a row with no company is not hidden by a company pin', () => {
    // company_id is nullable on interview_invites; dropping those rows would
    // silently lose interviews rather than scope them.
    const rows = [row({ id: 'nullco', company_id: null, scheduled_by: 'me' })]
    assert.equal(visibleInvites(rows, { employeeId: 'me', isOversight: false, companyId: 'co-1' }).length, 1)
  })

  test('no employee id and no oversight sees nothing, rather than everything', () => {
    // The legacy dashboard login has no employee row. Failing OPEN here would
    // show every recruiter's interviews to a session with no identity at all.
    assert.deepEqual(visibleInvites(all, { employeeId: null, isOversight: false, companyId: null }), [])
  })
})

describe('the status vocabulary matches ESS', () => {
  test('invited reads as not yet acknowledged', () => {
    const s = statusOf(row({ status: 'invited' }))
    assert.equal(s.tone, 'warn')
    assert.match(s.label, /not acknowledged/i)
  })

  test('a main interviewer who acknowledged is awaiting feedback', () => {
    const s = statusOf(row({ status: 'acknowledged', role: 'MAIN' }))
    assert.match(s.label, /awaiting feedback/i)
  })

  test('a panelist who acknowledged is simply done', () => {
    // Panelists never give feedback, so "awaiting feedback" would be a false
    // outstanding item on the recruiter's screen.
    const s = statusOf(row({ status: 'acknowledged', role: 'PANELIST' }))
    assert.equal(s.label, 'Acknowledged')
  })

  test('submitted carries the decision when there is one', () => {
    assert.match(statusOf(row({ status: 'submitted', decision: 'SHORTLIST' })).label, /Shortlisted/)
    assert.match(statusOf(row({ status: 'submitted', decision: 'HOLD' })).label, /On hold/)
    assert.match(statusOf(row({ status: 'submitted', decision: 'REJECT' })).label, /Rejected/)
  })

  test('submitted without a decision still reads as feedback in', () => {
    // migration 131 added `decision`; rows written before it have none.
    const s = statusOf(row({ status: 'submitted', decision: null }))
    assert.equal(s.label, 'Feedback in')
    assert.equal(s.tone, 'ok')
  })
})

describe('ordering', () => {
  test('newest scheduled first', () => {
    const older = row({ id: 'older', scheduled_at: '2026-10-01T10:00:00.000Z' })
    const newer = row({ id: 'newer', scheduled_at: '2026-10-09T10:00:00.000Z' })
    assert.deepEqual([older, newer].sort(byWhen).map(r => r.id), ['newer', 'older'])
  })

  test('rows with no date sort LAST, not first', () => {
    // scheduled_at is nullable (a round added but not yet scheduled). Sorting
    // those to the top would bury the interviews that actually have a time.
    const dated = row({ id: 'dated', scheduled_at: '2026-10-01T10:00:00.000Z' })
    const undated = row({ id: 'undated', scheduled_at: null })
    assert.deepEqual([undated, dated].sort(byWhen).map(r => r.id), ['dated', 'undated'])
    assert.deepEqual([dated, undated].sort(byWhen).map(r => r.id), ['dated', 'undated'])
  })
})

describe('the tab writes nothing', () => {
  test('the component contains no Supabase mutation', () => {
    // The whole safety argument for this tab is that it cannot affect the round
    // flow. That is worth asserting rather than trusting, because a later edit
    // adding one "quick action" would silently make it untrue.
    const src = readFileSync('components/recruitment/InterviewsScheduled.tsx', 'utf8')
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.ok(!src.includes(verb),
        `InterviewsScheduled.tsx must stay read-only, found ${verb} — the round flow and the ` +
        'shortlist gate depend on this screen not writing')
    }
  })

  test('it never selects a credential column from ess_accounts', () => {
    // The ESS-login flag needs only employee_id. Selecting '*' would pull the
    // password hash and salt into the browser for no reason.
    const src = readFileSync('components/recruitment/InterviewsScheduled.tsx', 'utf8')
    const i = src.indexOf("from('ess_accounts')")
    assert.notEqual(i, -1, 'the ESS-login flag was removed — re-check what this test protects')
    const call = src.slice(i, i + 160)
    assert.ok(/select\('employee_id'\)/.test(call),
      'ess_accounts must be queried for employee_id alone, never * — it holds password_hash and password_salt')
  })
})
