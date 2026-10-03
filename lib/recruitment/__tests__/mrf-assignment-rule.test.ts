// lib/recruitment/__tests__/mrf-assignment-rule.test.ts — approving at the
// HR Head step must hand the requisition to somebody.
//
// WHY THIS FILE EXISTS
//
// The HR Head's approval IS the hand-off. "Assigned to you" reads
// manpower_requisitions.assigned_recruiter_ids, so approving with an empty one
// opens a requisition that reaches no queue at all — nobody is working it and
// nothing says so.
//
// THE RULE LIVES IN THREE PLACES, AND ONE OF THEM WAS MISSING
//
//   1. app/api/ess/mrf/route.ts        refuses an HR_HEAD step with no
//                                      assigned_hr_ids, before any mutation
//   2. ApprovalModal's Approve button  disabled while nothing is picked
//   3. approveMRF()                    the dashboard's own Supabase write
//
// (1) and (2) were added together. (3) was not, and (3) is the one the Review
// modal actually calls — it writes straight to Supabase and reached neither
// guard. An HR Head approved an MRF through it with nobody assigned.
//
// A disabled button is not an enforcement point. Two routes past (2):
// a chain with no PENDING step made the modal's atHrHead false (so Approve
// enabled), and apprPeople was only fetched when the Approvals sub-tab had been
// opened — so from the Requisitions list the picker offered nobody at all.
//
// This reads the source rather than driving the UI: approveMRF is a closure
// inside a 6,000-line client component, and reaching it needs React, Supabase
// and a session. A test needing all three to check a guard is a test nobody
// runs. The cost is that a rename breaks it, which is the point — a human then
// re-reads the rule.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync('app/dashboard/recruitment/page.tsx', 'utf8')
const ESS = readFileSync('app/api/ess/mrf/route.ts', 'utf8')

// ── The parse, guarded ──────────────────────────────────────────────────────
// Every assertion below is worthless if these anchors moved and matched nothing.

test('both sources were actually read', () => {
  assert.ok(PAGE.length > 50_000, `recruitment/page.tsx looks truncated (${PAGE.length} chars)`)
  assert.ok(ESS.length > 10_000, `ess/mrf/route.ts looks truncated (${ESS.length} chars)`)
  assert.ok(/async function approveMRF\(/.test(PAGE),
    'approveMRF not found — it was renamed, so re-check that the assignment rule moved with it')
  assert.ok(/function ApprovalModal\(/.test(PAGE), 'ApprovalModal not found')
})

// ── 1. The server route ─────────────────────────────────────────────────────

describe('the ESS route refuses an unassigned hand-off', () => {
  test('an HR_HEAD step with no assigned_hr_ids is rejected', () => {
    assert.ok(/cur\.role === 'HR_HEAD' && !wantHr\.length/.test(ESS),
      'the ESS approve action must refuse an HR_HEAD step carrying no assigned_hr_ids')
  })

  test('the assignees are validated against the company hiring-manager list', () => {
    assert.ok(/hrTeamFor\(ctx\.companyId\)/.test(ESS) && /strays/.test(ESS),
      'posting an arbitrary employee id must be refused, or the picker is decoration')
  })

  test('the refusal happens before the row is mutated', () => {
    const guard = ESS.indexOf("cur.role === 'HR_HEAD' && !wantHr.length")
    const approve = ESS.indexOf("cur.status = 'APPROVED'")
    assert.ok(guard !== -1 && approve !== -1 && guard < approve,
      'the assignment check must precede the approval write, so a refusal leaves the chain untouched')
  })
})

// ── 2. The dashboard write — the path that was missing ──────────────────────

describe('approveMRF enforces the rule itself, not via a button', () => {
  // Slice approveMRF's body so a guard living in some other function cannot
  // satisfy these assertions by accident.
  const start = PAGE.indexOf('async function approveMRF(')
  const body = PAGE.slice(start, PAGE.indexOf('\n  async function', start + 10))

  test('the body was isolated', () => {
    assert.ok(start !== -1 && body.length > 400 && body.length < 12_000,
      `approveMRF body slice looks wrong (${body.length} chars)`)
  })

  test('it refuses when the hand-off carries no assignee', () => {
    assert.ok(/!\(assignIds\|\|\[\]\)\.length/.test(body),
      'approveMRF must refuse an empty assignIds at the hand-off step. Without this the ' +
      'rule exists only in a disabled button, which the Review modal can bypass.')
  })

  test('a chain with no PENDING step still counts as the hand-off', () => {
    assert.ok(/!pend \|\| pend\.role === 'HR_HEAD'/.test(body),
      'an MRF with no pending step is opened outright by one decision, so it is a ' +
      'hand-off too. Checking only === HR_HEAD let that case through.')
  })

  test('the refusal precedes the Supabase update', () => {
    const guard = body.indexOf('!(assignIds||[]).length')
    const write = body.indexOf("from('manpower_requisitions').update")
    assert.ok(guard !== -1 && write !== -1 && guard < write,
      'the check must run before the write, or a refused approval has already happened')
  })

  test('assignees are checked against the assignable list', () => {
    assert.ok(/allowed/.test(body) && /strays/.test(body),
      'approveMRF should mirror the server-side role check rather than trusting the picker')
  })
})

// ── 3. The modal, as a courtesy rather than the rule ────────────────────────

describe('ApprovalModal still guides the HR Head', () => {
  test('Approve stays disabled while nothing is picked at the hand-off', () => {
    assert.ok(/const canApprove = !atHrHead \|\| assignIds\.length > 0/.test(PAGE),
      'the button gate is the courtesy half — keep it, but it is not the enforcement')
  })

  test('atHrHead treats a missing pending step as the hand-off', () => {
    assert.ok(/const atHrHead = !pending \|\| pending\.role === 'HR_HEAD'/.test(PAGE),
      'reading === HR_HEAD alone enabled Approve on a chainless MRF')
  })
})

// ── 4. The picker must actually offer somebody ──────────────────────────────

test('the assignable list is loaded without waiting for the Approvals sub-tab', () => {
  // apprPeople comes from loadApprovals(). Gating that on mrfSub === 'approvals'
  // meant the Review modal, reachable from the Requisitions list, rendered
  // "No hiring managers are set up for this company" and left the HR Head
  // unable to assign anyone — pushing them past the step the rule exists for.
  assert.ok(/useEffect\(\(\)=>\{ loadApprovals\(\) \}, \[loadApprovals\]\)/.test(PAGE),
    'loadApprovals must run on mount, not only when the Approvals sub-tab opens, or the ' +
    'picker can be empty exactly when the rule is being enforced')
  assert.ok(!/if \(mrfSub==='approvals'\) loadApprovals\(\)/.test(PAGE),
    'the sub-tab-gated load should be gone, not merely duplicated')
})

test('only hiring managers / recruiters are assignable', () => {
  assert.ok(/const HR_ROLE_CODES = \['RECRUITER'\]/.test(ESS),
    "the assignable role is RECRUITER (seeded 'Hiring Manager / Recruiter'). HR_MANAGER is " +
    'the senior HR tier and oversees requisitions rather than running them — if this list ' +
    'grows, re-read who should be handed hiring work.')
})
