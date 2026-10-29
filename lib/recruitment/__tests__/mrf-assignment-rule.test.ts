// lib/recruitment/__tests__/mrf-assignment-rule.test.ts — approving the step that opens an
// MRF must hand the requisition to somebody.
//
// WHY THIS FILE EXISTS
//
// The approval that opens a requisition IS the hand-off. "Assigned to you" reads
// manpower_requisitions.assigned_recruiter_ids, so approving with an empty one opens a
// requisition that reaches no queue at all.
//
// The rule was fixed once at four separate writes (a767c8a, 3823b5f, 1cce8cc, ac37d83) and
// then lost in later merges ("main's recruitment flow wins"), so an HR Head could again
// approve from the HR Head tab with one click and nobody assigned. It now lives in ONE
// server function, lib/recruitment/mrf-approve.ts, and every screen that approves an MRF
// calls an endpoint that uses it. This file checks the rule itself and that no screen
// writes APPROVED on its own again.
//
// The hand-off is the LAST step, not merely the one called HR_HEAD: when the HR Head is
// also the raiser's manager the chain is a single RM2 step, and a chainless MRF is opened
// by one decision.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isHandOff, cleanIds, strays } from '../mrf-handoff.ts'

describe('isHandOff', () => {
  test('the HR Head step is the hand-off', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'APPROVED' }, { role: 'HR_HEAD', status: 'PENDING' }]), true)
  })
  test('an RM2 step with the HR Head still waiting is not', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'PENDING' }, { role: 'HR_HEAD', status: 'WAITING' }]), false)
  })
  test('a lone RM2 step (the HR Head is the raiser\'s manager) is the hand-off', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'PENDING' }]), true)
  })
  test('no chain, or nothing pending, is opened by one decision', () => {
    assert.equal(isHandOff([]), true)
    assert.equal(isHandOff(null), true)
    assert.equal(isHandOff([{ role: 'RM2', status: 'APPROVED' }]), true)
  })
})

test('cleanIds and strays', () => {
  assert.deepEqual(cleanIds(['a', 'a', ' b ', '', null]), ['a', 'b'])
  assert.deepEqual(cleanIds('a'), [])
  assert.deepEqual(strays(['a', 'x'], ['a', 'b']), ['x'])
})

const read = (p: string) => readFileSync(p, 'utf8')
const LIB = read('lib/recruitment/mrf-approve.ts')
const ESS = read('app/api/ess/mrf/route.ts')
const DECIDE = read('app/api/recruitment/mrf-decision/route.ts')
const PAGE = read('app/dashboard/recruitment/page.tsx')
const OFFER = read('app/dashboard/recruitment/offer-flow-components.tsx')
const ESSLIB = read('lib/supabase-ess.ts')
const ROLETABS = read('components/ess/RoleTabs.tsx')

describe('the server refuses an unassigned hand-off', () => {
  test('before anything is written', () => {
    const guard = LIB.indexOf('if (handOff && !inp.assignIds.length)')
    const write = LIB.indexOf(".from('manpower_requisitions').update(")
    assert.ok(guard !== -1 && write !== -1 && guard < write)
  })
  test('assignees must be recruiters of the MRF\'s own company', () => {
    assert.ok(/hrTeamFor\(sb, mrf\.company_id\)/.test(LIB) && /strays\(/.test(LIB))
  })
  test('both endpoints approve through it', () => {
    assert.ok(/approveMrf\(sb as any, \{/.test(ESS), 'ESS approve must use lib/recruitment/mrf-approve')
    assert.ok(/approveMrf\(sb as any, \{/.test(DECIDE), 'dashboard approve must use lib/recruitment/mrf-approve')
    assert.ok(/requireModule\(req, 'Recruitment'\)/.test(DECIDE))
  })
})

describe('no screen writes an MRF approval itself', () => {
  // A browser write of status APPROVED on manpower_requisitions skips the rule. Reopening a
  // CLOSED requisition (status back to APPROVED on an already-assigned MRF) is the one
  // legitimate case, and it never carries approved_at.
  for (const [name, src] of [['recruitment/page.tsx', PAGE], ['offer-flow-components.tsx', OFFER], ['lib/supabase-ess.ts', ESSLIB]] as const) {
    test(name, () => {
      assert.ok(!/manpower_requisitions'\)\s*\.update\(\{[^}]*approved_at/.test(src), `${name} writes approved_at directly`)
      assert.ok(!/status: ?'APPROVED', ?approved_at/.test(src), `${name} stamps APPROVED directly`)
    })
  }
  test('the admin approvals queue calls the decision endpoint', () => {
    assert.ok(ESSLIB.includes("'/api/recruitment/mrf-decision'"))
  })
  // The Recruitment MRF tab (dashboard AND ESS) decides ONE step, as the pending approver,
  // through /api/ess/mrf — never the one-decision 'final' approval of mrf-decision, which
  // let anyone with the module open a requisition on behalf of the RM2 and the HR Head.
  test('the MRF tab decides through /api/ess/mrf, step by step', () => {
    assert.ok(/essApi\('\/api\/ess\/mrf', employeeId, \{ method:'POST'/.test(PAGE),
      'decideMRF must post the decision to /api/ess/mrf')
    assert.ok(!/fetch\('\/api\/recruitment\/mrf-decision', \{ method:'POST'/.test(PAGE),
      'the MRF tab must not approve through the one-decision mrf-decision endpoint')
  })
  test('the pickers use the hand-off rule, not role === HR_HEAD', () => {
    assert.ok(/isHandOff\(m\.approval_chain\)/.test(ROLETABS))
    assert.ok(/isHandOff\(asArray\(m\.approval_chain\)\)/.test(PAGE), 'approveMRF must require assignees by the hand-off rule')
    assert.ok(/isHandOff\(asArray\(mrf\.approval_chain\)\)/.test(PAGE), 'ApprovalModal must show the picker by the hand-off rule')
    assert.ok(!/cur\?\.role==='HR_HEAD'/.test(PAGE) && !/pend\.role === 'HR_HEAD'/.test(PAGE),
      'role === HR_HEAD misses the lone-RM2 chain, which also opens the requisition')
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

// ── 5. The HR Head tab — the path a user had to find by hand ───────────────
//
// This tab used to carry its own approveMrf / rejectMrf: a one-click Supabase
// write of status 'APPROVED' that skipped the chain, the assignment and the
// audit log (17 seeded MRFs ended up APPROVED with their HR_HEAD step still
// PENDING). An earlier fix gave that write its own guards; a later merge lost
// them. Rather than keep a fourth copy of the rule, the write is GONE: the tab
// shows the read-only tracker, and "Review & decide" — offered only to the
// pending approver — opens the MRF tab's review, which posts to /api/ess/mrf.
// So enforcement point (4) no longer exists, and these tests keep it that way.

describe('the HR Head tab does not write an MRF decision itself', () => {
  const start = OFFER.indexOf('export function HRHeadApprovalDashboard(')
  const body = OFFER.slice(start, OFFER.indexOf('\n// ── Documents on the review screen', start))

  test('the dashboard body was isolated', () => {
    assert.ok(start !== -1, 'HRHeadApprovalDashboard not found in offer-flow-components.tsx')
    assert.ok(body.length > 2_000 && body.length < 60_000,
      `HRHeadApprovalDashboard slice looks wrong (${body.length} chars) — the anchors moved`)
  })

  test('there is no direct requisition write on this screen', () => {
    assert.ok(!/from\('manpower_requisitions'\)\s*\.update/.test(body),
      'the HR Head tab must not update manpower_requisitions — that is the chain-skipping write')
    assert.ok(!/async function approveMrf\(/.test(body) && !/async function rejectMrf\(/.test(body),
      'approveMrf / rejectMrf came back — route the decision through /api/ess/mrf instead')
  })

  test('the decision is handed to the MRF review, and only for the pending approver', () => {
    assert.ok(/mine && onReviewMrf/.test(body),
      'Review & decide must be offered only when the viewer IS the pending approver')
    assert.ok(/pendingStep\?\.approverId === employeeId/.test(body),
      '"mine" must compare the PENDING step\'s approver with the viewer')
    assert.ok(/<ApprovalTracker /.test(body),
      'the screen shows where each requisition sits with the read-only tracker')
  })

  test('page.tsx wires the hand-off to the MRF tab\'s review', () => {
    assert.ok(/<HRHeadApprovalDashboard[^>]*employeeId=\{grant\.employeeId\}/.test(PAGE),
      'without employeeId the tab cannot tell which requisitions wait on the viewer')
    assert.ok(/onReviewMrf=\{\(id:string\)=>\{ setMrfDeep\(\{ sub:'approvals', id \}\); setTab\('mrf'\) \}\}/.test(PAGE),
      'onReviewMrf must open the MRF tab on its Approvals review for that requisition')
  })
})

test('only hiring managers / recruiters are assignable', () => {
  assert.ok(/const HR_ROLE_CODES = \['RECRUITER'\]/.test(LIB),
    "the assignable role is RECRUITER (seeded 'Hiring Manager / Recruiter'). HR_MANAGER is " +
    'the senior HR tier and oversees requisitions rather than running them — if this list ' +
    'grows, re-read who should be handed hiring work.')
})

// ── 6. Who may decide, on the ESS route ─────────────────────────────────────
//
// approveMrf enforces the hand-off; the route in front of it decides WHO may act and
// WHEN. Both halves have been lost in merges before, so both are pinned here.

describe('the ESS route gates the decision before approveMrf runs', () => {
  const start = ESS.indexOf("if (action === 'approve' || action === 'reject' || action === 'revise')")
  const call = ESS.indexOf('approveMrf(sb as any, {', start)

  test('only a requisition in approval can be decided', () => {
    const gate = ESS.indexOf("['SUBMITTED', 'ON_HOLD'].includes(String(mrf.status))", start)
    assert.ok(start !== -1 && gate !== -1 && gate < call,
      'an APPROVED / CLOSED MRF carrying a stale PENDING step must be refused, not decided')
  })

  test('only the pending approver (or a super admin) may approve, reject or send back', () => {
    const gate = ESS.indexOf('cur.approver_id !== me && !ctx.grant.isSuperAdmin', start)
    assert.ok(gate !== -1 && gate < call, 'the approver check must run before any decision is written')
    assert.ok(/mustBeApprover: !ctx\.grant\.isSuperAdmin/.test(ESS), 'approveMrf must repeat the approver check')
  })

  test('a super-admin override is recorded on the step, under the real actor', () => {
    assert.ok(/cur\.acted_by_id = me/.test(ESS), 'reject / send back by an override must record who acted')
    assert.ok(/cur!\.acted_by_id = inp\.actor\.id/.test(LIB), 'an approval by an override must record who acted')
    assert.ok(/actor: \{ id: me, name: meB\?\.name/.test(ESS),
      'the actor is the caller, not the named approver: an override must not pass as theirs')
  })
})
