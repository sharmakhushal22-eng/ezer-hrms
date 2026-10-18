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
// THE RULE LIVES IN FOUR PLACES, AND THEY WERE FIXED ONE AT A TIME
//
//   1. app/api/ess/mrf/route.ts        refuses an HR_HEAD step with no
//                                      assigned_hr_ids, before any mutation
//   2. ApprovalModal's Approve button  disabled while nothing is picked
//   3. approveMRF()        (page.tsx)  the Review modal's Supabase write
//   4. approveMrf()  (offer-flow-...)  the HR Head TAB's Supabase write
//
// (1) and (2) came first. (3) was missed, and an HR Head approved an MRF
// through the Review modal with nobody assigned. (4) was missed again — and
// (4) is the screen whose own heading says "MRF approvals", reached from the
// HR Head tab in the rail. It had no picker at all: one click wrote
// status 'APPROVED', skipping the assignment, the approval chain and the audit
// log together. A user found it manually after (3) was fixed.
//
// The lesson this file now encodes: a rule enforced at one write is not
// enforced. Every path that writes the approval needs its own check, and this
// test enumerates them so the next one cannot be added quietly.
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
// The picker and the button gate moved into the redesigned view, so the
// courtesy half is asserted where it now lives. The four WRITE-level
// enforcement points below are unchanged.
const VIEW = readFileSync('components/recruitment/rx/views/HRHeadApprovalView.tsx', 'utf8')
const LOGIC = readFileSync('components/recruitment/rx/logic/approvals.ts', 'utf8')
const ESS = readFileSync('app/api/ess/mrf/route.ts', 'utf8')
const OFFER = readFileSync('app/dashboard/recruitment/offer-flow-components.tsx', 'utf8')

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

// ── 5. The HR Head tab — the path a user had to find by hand ───────────────

describe('the HR Head tab enforces the rule at its own write', () => {
  const start = OFFER.indexOf('async function approveMrf(')
  const body = OFFER.slice(start, OFFER.indexOf('\n  async function rejectMrf', start))

  test('approveMrf exists and its body was isolated', () => {
    assert.ok(start !== -1, 'approveMrf not found in offer-flow-components.tsx')
    assert.ok(body.length > 400 && body.length < 12_000,
      `approveMrf body slice looks wrong (${body.length} chars) — the anchors moved`)
  })

  test('it refuses an unassigned hand-off', () => {
    assert.ok(/isHandOff && !picked\.length/.test(body),
      'the HR Head tab wrote status APPROVED with nobody assigned. This screen has its own ' +
      'Supabase write and reaches neither the ESS route nor page.tsx, so it needs its own check.')
  })

  test('a chain with no PENDING step still counts as the hand-off', () => {
    assert.ok(/!cur \|\| cur\.role === 'HR_HEAD'/.test(body),
      'an MRF with no routing is opened outright by one decision, so it is a hand-off too')
  })

  test('the refusal precedes the Supabase update', () => {
    const guard = body.indexOf('!picked.length')
    const write = body.indexOf("from('manpower_requisitions').update")
    assert.ok(guard !== -1 && write !== -1 && guard < write,
      'the check must run before the write, or a refused approval has already happened')
  })

  test('assignees are validated against the assignable list', () => {
    // inCompany, not a flat list: the validation must use the recruiters of THIS
    // requisition's company. An earlier version of this assertion looked for
    // `hmOptions`, the single caller-company-scoped list that allowed an MRF to
    // be assigned across companies — so matching it would now be a regression.
    assert.ok(/allowed/.test(body) && /inCompany/.test(body),
      'mirror the server-side role check, scoped to the MRF\'s own company, rather than ' +
      'trusting the picker')
  })

  test('it advances the approval chain instead of stamping APPROVED', () => {
    assert.ok(/'WAITING'/.test(body) && /approval_chain/.test(body),
      "this screen set status 'APPROVED' outright, so an RM2 step was never recorded and " +
      'the requisition skipped its own routing')
  })

  test('the decision is written to the audit log', () => {
    assert.ok(/auditMrf\(/.test(body),
      'approvals from this screen left no audit trail at all')
  })

  test('the assignee is told they were handed the requisition', () => {
    // Making the assignment mandatory is only half the hand-off. /api/ess/mrf
    // notifies each assignee on its own approve path; this screen did not, so
    // the rule would have assigned somebody SILENTLY — they would find out only
    // by chancing on the "Assigned to you" block in Tasks & Approvals.
    assert.ok(/ess_notifications/.test(body),
      'approving here must notify each assigned hiring manager, as the ESS route does')
    assert.ok(/'\/ess\?tab=approvals'/.test(body),
      'use the same deep link as the route — that is where Acknowledge lives')
  })

  test('both approval paths word the assignment the same way', () => {
    // Two places tell somebody the same thing. If they drift, one assignment
    // reads two different ways depending on which screen the HR Head used.
    const phrase = 'You have been assigned an MRF'
    assert.ok(ESS.includes(phrase),
      `the ESS route's assignment notification changed — it no longer says "${phrase}"`)
    assert.ok(OFFER.includes(phrase),
      `the HR Head tab's assignment notification must match the route's: "${phrase}"`)
  })

  test('the assignable list is scoped to the MRF\'s own company', () => {
    // This screen lists SUBMITTED requisitions from EVERY company (loadMrfs has
    // no company filter), while /api/ess/mrf's hrOptions is scoped to the
    // CALLER's company. One flat list therefore offered the wrong people, and an
    // MRF in company A was assigned to a recruiter in company B — who never saw
    // it, because Recruitment pins every query to the viewer's own company and
    // dropped the row before the "assigned to me" check could run.
    assert.ok(/hmByCompany\[m\.company_id\]/.test(OFFER),
      "the picker must read hmByCompany[m.company_id] — a single flat list of the HR Head's " +
      'own recruiters is what caused the cross-company assignment')
    assert.ok(/hmByCompany\[m\.company_id\]/.test(body),
      'approveMrf must validate against THIS MRF\'s company too, not just the picker')
    // Anchored to the IMPORT and CALL forms, not the bare name: this regex runs
    // over whole-file source, so a plain /toPickerPeople/ also matched the
    // comment in the loader explaining why the helper is no longer used — the
    // test then failed on prose while the code was correct. An assertion about
    // what the code does NOT do has to name code.
    assert.ok(!/import[^\n]*toPickerPeople/.test(OFFER) && !/toPickerPeople\(/.test(OFFER),
      'hrOptions/toPickerPeople is caller-company-scoped and must not feed this screen')
  })

  test('picker rows carry is_recruiter, or the list renders empty beneath its own count', () => {
    // RecruiterPicker's unsearched list is `people.filter(p => p.is_recruiter)`.
    // The route returns {id, name, code} with no such flag, so passing those
    // rows straight through showed "No recruiters suggested" directly under
    // "3 available in <company>" — loaded, findable by typing, never offered.
    // The count and the list read the same array, so they must not disagree.
    assert.ok(/is_recruiter: true/.test(OFFER),
      'rows fed to RecruiterPicker must carry is_recruiter — every one comes from ' +
      "roleHolders(companyId, ['RECRUITER']), so the flag is true by construction")
  })

  test('the company-keyed recruiters come from the guarded route', () => {
    const route = readFileSync('app/api/recruitment/offer-approval/route.ts', 'utf8')
    assert.ok(/roleHolders\(id, \['RECRUITER'\]\)/.test(route),
      'the GET must return RECRUITER holders per company — HR_MANAGER is not assignable')
    assert.ok(/recruiters\[id\]/.test(route),
      'they must be keyed by company id, so each MRF can be scoped to its own')
    assert.ok(/requireModule\(req, 'Recruitment'\)/.test(route),
      'this enumerates named employees per company — it stays session-guarded')
  })

  test('the screen renders the assignment menu', () => {
    // The picker MOVED. This tab renders HRHeadApprovalView now, and the view's
    // PersonGrid is the picker; RecruiterPicker is gone from this file.
    //
    // Matching /RecruiterPicker/ over whole-file source kept PASSING after the
    // swap, because the name survived on a dead import line and in a comment --
    // the same prose-matching trap the toPickerPeople assertion below documents.
    // So this asserts the MOUNT and the view's own grid instead.
    assert.ok(/<HRHeadApprovalView/.test(OFFER),
      'the HR Head tab must render the approvals view, which carries the picker')
    assert.ok(/recruitersByCompany=\{hmByCompany\}/.test(OFFER),
      'the view must be handed the COMPANY-KEYED recruiters — a flat list is what ' +
      'caused the cross-company assignment')
    assert.ok(/function PersonGrid\(/.test(VIEW) && /aria-pressed=\{on\}/.test(VIEW),
      'the view must render a selectable person list — that is the picker now')
    // The SOURCE assertion deliberately inverted. This first demanded
    // toPickerPeople + /api/ess/mrf, which is hrOptions — scoped to the CALLER's
    // company. On a screen listing MRFs from every company that is the wrong
    // list, and it is what produced the cross-company assignment. The people now
    // come from offer-approval's company-keyed `recruiters`; see the scoping
    // test above, which asserts toPickerPeople is absent.
    assert.ok(/offer-approval\?company_ids=/.test(OFFER),
      'the assignable list must be fetched per company from the guarded ' +
      'offer-approval route, so each MRF offers only its own company\'s recruiters')
  })

  test('the Approve button is gated too, as the courtesy half', () => {
    // Also moved into the view, and still only the courtesy half: approveMrf's
    // own refusal above is the rule. A disabled button is not an enforcement
    // point — which is the whole reason this file exists.
    assert.ok(/disabled=\{!ready \|\| busy\}/.test(VIEW),
      'the approve control must be disabled until the hand-off is ready')
    assert.ok(/const ready = isMrf \? canApproveMrf\(mrfPicked\)/.test(VIEW),
      'readiness must come from canApproveMrf, so the gate tracks the ids actually picked')
    assert.ok(/return assigneeIds\.length > 0/.test(LOGIC),
      'canApproveMrf must mean "somebody is named"')
  })

  test('page.tsx passes the employeeId the list needs', () => {
    // No /s flag: tsconfig targets ES2017, where dotAll is a TS1501 error and
    // would push the typecheck baseline off 43. [^>] already spans newlines.
    assert.ok(/<HRHeadApprovalDashboard[^>]*employeeId=\{grant\.employeeId\}/.test(PAGE),
      'without employeeId the hiring-manager fetch has no identity and the menu is empty — ' +
      'which would force the HR Head past the assignment step again')
  })
})

test('only hiring managers / recruiters are assignable', () => {
  assert.ok(/const HR_ROLE_CODES = \['RECRUITER'\]/.test(ESS),
    "the assignable role is RECRUITER (seeded 'Hiring Manager / Recruiter'). HR_MANAGER is " +
    'the senior HR tier and oversees requisitions rather than running them — if this list ' +
    'grows, re-read who should be handed hiring work.')
})
