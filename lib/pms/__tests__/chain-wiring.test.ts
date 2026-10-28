// lib/pms/__tests__/chain-wiring.test.ts — the chain is wired to the screens,
// not merely implemented.
//
// WHY THESE READ SOURCE INSTEAD OF RENDERING
//
// Node cannot load .tsx, so there is no way to mount Performance.tsx here and
// click an Approve button. The alternative to source-matching is not a better
// test, it is no test — and every bug this file guards against is one where
// the logic was correct and nothing called it. 197's functions can be perfect
// and the module still broken if submitKras never sends the set on.
//
// THE LIMIT, STATED PLAINLY. A regex can prove a call exists; it cannot prove
// the call runs, or runs in the right order. Where order is load-bearing — the
// chain submit must follow the ratings write, or it refuses every first
// submission — the test checks the relative POSITION of the two in the file,
// which is the most a reader of source can honestly claim.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PERF = read('components/ess/Performance.tsx')
const MGR = read('components/pms/ManagerTabs.tsx')
const EMP = read('components/pms/EmployeeTabs.tsx')
const ADMIN = read('components/pms/AdminTabs.tsx')
const PAGE = read('app/dashboard/pms/page.tsx')

test('all three chain RPCs are actually called from a screen', () => {
  // The module had working SQL nobody invoked before — pms_finalise's final
  // review gate was unopenable because no screen supplied the manager's ack.
  for (const fn of ['pms_chain_submit', 'pms_chain_approve', 'pms_chain_reject']) {
    assert.match(PERF, new RegExp(`rpc\\(\\s*'${fn}'`), `${fn} is never called`)
  }
})

test('the chain submit comes AFTER the self ratings are written', () => {
  // pms_chain_submit refuses without a self rating on record, and self_score
  // only exists once trg_pms_sync_role_score has seen the SELF reviews. Called
  // first, it would refuse every first-time submission — and the employee
  // would be told their KRAs saved but went nowhere, with no way to fix it.
  const ratings = PERF.indexOf("rater_role: 'SELF'")
  const submit = PERF.indexOf("rpc('pms_chain_submit'")
  assert.ok(ratings > 0, 'could not find the SELF ratings write')
  assert.ok(submit > 0, 'could not find the chain submit')
  assert.ok(submit > ratings,
    'pms_chain_submit is called before the SELF ratings are written, so it ' +
    'will refuse: no self rating on record yet')
})

test('a BLOCKED reply is shown to the user, not swallowed', () => {
  // Every one of 197's refusals is a sentence written for the person reading
  // it. Treating the reply as success would show "Approved" on an appraisal
  // that did not move, which is the worst available outcome.
  const calls = [...PERF.matchAll(/rpc\(\s*'pms_chain_(submit|approve|reject)'/g)]
  // At least one call per function, and submit legitimately has two sites: the
  // merged KRA+rating step and the separate Self Rating tab are the same event
  // and both have to enter the chain. An exact count here was wrong on the
  // first run — the test asserted 3 and the code correctly had 4.
  const kinds = new Set(calls.map(m => m[1]))
  assert.deepEqual([...kinds].sort(), ['approve', 'reject', 'submit'])
  // Each call site must inspect the reply for BLOCKED within the next 900
  // characters — far enough to cover the error branch, short enough that a
  // check belonging to a different call does not count.
  for (const m of calls) {
    const after = PERF.slice(m.index!, m.index! + 900)
    assert.match(after, /BLOCKED/,
      `the ${m[1]} call does not look at a BLOCKED reply`)
  }
})

test('the rejecting manager\'s rung is resolved per employee', () => {
  // A viewer-level rung would be wrong for any manager who holds two, and the
  // RPC checks identity against the frozen chain — so the wrong rung means a
  // refusal the manager cannot explain.
  assert.match(PERF, /chainRoleFor\s*=\s*useCallback/,
    'the chain rung is not resolved per employee')
  assert.match(PERF, /p_actor_role:\s*myRung/,
    'the RPC is passed something other than the per-employee rung')
  // And it must come from the shared helper rather than a third local copy.
  assert.match(PERF, /rungFor\(m,\s*employeeId\)/)
  assert.match(MGR, /rungFor\(r\.member,\s*viewerId\)/)
})

test('the approval queue filters on the viewer\'s own rung', () => {
  // Offering an approval that is not yours implies the queue is yours to
  // clear. The filter is what keeps a manager's list honest.
  assert.match(MGR,
    /chainStage\s*===\s*rungFor\(r\.member,\s*viewerId\)/,
    'the approval card does not filter rows to the viewer\'s rung')
})

test('the rating field appears only where approval finalises', () => {
  // Asking every rung for a final rating invites a manager to set a number
  // they have no authority to set; asking none means the last rung's approval
  // is refused for want of one.
  assert.match(MGR, /finalises\s*&&\s*\(\s*<input type="number"/)
  assert.match(MGR, /finalises \? 'Approve & finalise' : 'Approve'/)
  // AND IT MUST ASK ABOUT THE HOLDERS, not just the policy's chain. On a
  // collapsed line — 190 of 395 enrolments — RM L2 is unfilled, so the RM L1's
  // approval finalises. Computed from the chain alone the button would say
  // "Approve", offer no rating field, and the database would answer "a final
  // rating is needed to finalise" with nowhere to type one.
  assert.match(MGR, /const held = heldBy\(r\.member\)/,
    'the approval card does not resolve who actually fills each rung')
  assert.match(MGR, /approvalFinalises\(chain, myStage, held\)/,
    'whether approval finalises is computed without the rung holders')
})

test('the reject button names where the set is going', () => {
  // With the holders, for the same reason: a HOD rejecting on a collapsed line
  // sends the set to RM L1, and saying "back to RM L2" names somebody who does
  // not exist for this employee.
  assert.match(MGR, /rejectDestination\(chain, myStage, held\)/,
    'the rejection dialog does not say where the set will really go')
})

test('the remark minimum is checked in the form, not just the database', () => {
  // 197 refuses a short remark. A form that lets it through turns a validation
  // rule into an error message after the fact.
  assert.match(MGR, /disabled=\{!onReject \|\| !remarkOk\(rk\)\}/,
    'the confirm-rejection button does not require a usable remark')
})

test('the employee is shown the remark their set came back with', () => {
  // THE WHOLE POINT OF A MANDATORY REMARK. sent_back_reason existed since 066
  // and was written by the send-back for just as long, with no screen reading
  // it: the employee got a set back and had to guess why.
  assert.match(EMP, /export function ChainBanner/, 'no banner to show it in')
  assert.match(EMP, /sentBackReason/, 'the banner never reads the remark')
  assert.match(PERF, /<ChainBanner/, 'the banner is never rendered')
  assert.match(PERF, /sentBackReason=\{overall\?\.sent_back_reason\}/,
    'the banner is rendered without the remark')
})

test('the stage and the remark are actually selected from the database', () => {
  // A column nobody selects is a column nobody can show. PostgREST returns
  // only what is asked for, so an omission here is silent.
  const sel = PERF.match(/\.select\('workflow_status,self_score[^']*'\)/)
  assert.ok(sel, 'could not find the overall-rating select')
  for (const col of ['chain_stage', 'sent_back_reason', 'sent_back_at']) {
    assert.match(sel![0], new RegExp(col), `${col} is not selected`)
  }
  const roster = PERF.match(/\.select\('employee_id,workflow_status[^']*'\)/)
  assert.ok(roster, 'could not find the roster select')
  for (const col of ['chain_stage', 'hod_id']) {
    assert.match(roster![0], new RegExp(col), `${col} is not selected for the roster`)
  }
})

// ── the HR end of the chain ──────────────────────────────────────────────

test('HR has a publish screen, reachable through a seeded permission', () => {
  assert.match(ADMIN, /export function PublishTab/, 'no publish tab')
  assert.match(ADMIN, /k: 'publish'/, 'the tab is not listed in ADMIN_TABS')
  assert.match(PAGE, /<PublishTab/, 'the tab is never rendered')
  // canSeeScreen denies any key absent from the seeded screen config, so a
  // brand-new 'pms.publish' key would hide the tab from everybody including
  // admins. It borrows the existing HR-only key instead of the roles module
  // being touched.
  assert.match(PAGE, /SCREEN_KEY[\s\S]{0,80}publish:\s*'pms\.upload'/,
    'the publish tab does not borrow a seeded screen key')
  assert.ok(!/'pms\.' ?\+ ?t\.k\)/.test(PAGE),
    'the tab bar still builds the screen key by concatenation, so the mapping '
    + 'is bypassed and the publish tab will be invisible')
})

test('the publish queue cannot miss a settled rating', () => {
  // THIS ASSERTION HAS BEEN WRONG TWICE, in opposite directions, and both
  // times it was encoding the implementation rather than the rule.
  //
  // First it demanded a chain_stage IN ('HR','DONE') filter, which silently
  // dropped every row finalised before 197 existed — their chain_stage is
  // NULL and an IN filter does not match NULL. Then it demanded a
  // workflow_status filter, which 202 removed: one query now feeds both
  // Publish Results and Ratings Summary, and the summary's whole job is "all
  // the employees", including the ones still in the chain.
  //
  // The RULE is that the loader must not narrow in a way that can drop a
  // settled rating. Narrowing by nothing satisfies it; the tab filters what
  // it shows.
  const q = PAGE.slice(PAGE.indexOf('const pub = await supabase'),
                       PAGE.indexOf('const pub = await supabase') + 700)
  assert.ok(q.length > 200, 'could not find the publish/summary loader')
  assert.ok(!/\.in\('chain_stage'/.test(q),
    'the loader filters on chain_stage, which excludes NULL-stage rows — the '
    + 'bug that hid finalised appraisals from HR entirely')
  assert.ok(!/\.eq\('workflow_status'/.test(q),
    'the loader pins a single workflow_status and will miss the rest')
  // It must still be scoped to periods, or it reads the whole table. `in`
  // rather than `eq` since the summary spans every open period: an HR Head
  // over three companies was seeing one company's cycle.
  assert.match(q, /\.in\('period_id', periodIds\)/,
    'the loader is not scoped to the open periods')
})

test('HR cannot change a rating or a KRA from the publish screen', () => {
  // NARROWED, deliberately. This used to assert the tab had no input,
  // textarea, select or onChange at all — true when HR could only publish.
  // 202 moved the appreciation remark, the improvement feedback and the
  // recognition awards to HR, so the tab writes now and that assertion was
  // enforcing a rule that no longer exists.
  //
  // What has NOT moved is the number. HR writes the words beside the rating
  // and releases it; the rating belongs to the chain, and 188's guards would
  // refuse one from here anyway.
  const tab = ADMIN.slice(ADMIN.indexOf('export function PublishTab'),
                          ADMIN.indexOf('// ── the whole company, on one screen'))
  assert.ok(tab.length > 1000, 'could not isolate the publish workspace')
  assert.ok(!/type="number"/.test(tab),
    'the publish workspace offers a numeric input — HR must not set a rating')
  assert.ok(!/final_rating|finalRating:\s/.test(tab.replace(/finalRating[\s)}\]]/g, '')),
    'the workspace writes a final rating')
  // No KRA editing either: that is the employee's set, locked long before.
  assert.ok(!/weightage|kra_title/i.test(tab), 'the workspace touches KRAs')
  // And no reject path — a rating that needs changing goes back through the
  // HOD, which is what the banner tells them.
  assert.ok(!/[Rr]eject/.test(tab), 'the workspace offers a rejection')
})

test('publishing writes only delivery columns', () => {
  const act = PAGE.slice(PAGE.indexOf('const publishOne'),
                         PAGE.indexOf('const publishOne') + 2200)
  assert.ok(act.length > 500, 'could not isolate publishOne')
  // Exactly the three columns 193 and 197 allow on a locked record, so this
  // works for an exited employee too — §8's result-before-the-login-closes.
  assert.match(act, /workflow_status: 'PUBLISHED'/)
  assert.match(act, /published_at:/)
  assert.match(act, /chain_stage: 'DONE'/)
  // Nothing about the number.
  for (const col of ['final_rating', 'final_score', 'hod_score', 'rm_l1_score',
                     'rm_l2_score', 'finalised_by']) {
    assert.ok(!new RegExp(`${col}\\s*:`).test(act),
      `publishing writes ${col}, which HR must not change`)
  }
})

test('publishing opens existing feedback without authoring any', () => {
  const act = PAGE.slice(PAGE.indexOf('const publishOne'),
                         PAGE.indexOf('const publishOne') + 2200)
  // The employee's screen shows feedback only when published AND
  // visible_to_employee — so publishing without this releases a rating with
  // the feedback still hidden.
  assert.match(act, /from\('pms_feedback'\)[\s\S]{0,120}visible_to_employee: true/,
    'publishing does not make the feedback visible')
  // `update`, never `upsert` or `insert`: HR does not write feedback, and an
  // upsert would quietly let them.
  const fb = act.slice(act.indexOf("from('pms_feedback')"))
  assert.ok(!/upsert|insert/.test(fb.slice(0, 200)),
    'HR authors feedback on publish — it must only reveal what exists')
})

test('the HOD publish path also closes the stage out', () => {
  // Two screens can publish — the finaliser's own Finalise tab and HR's queue.
  // A publish that leaves chain_stage at 'HR' makes the employee's banner say
  // it is still with HR while their Result tab shows the rating.
  const st = PERF.slice(PERF.indexOf("workflow_status: 'PUBLISHED'"))
  assert.match(st.slice(0, 200), /chain_stage: 'DONE'/,
    'the manager-side publish leaves the chain stage behind')
})

// ── the final-review gate must be openable from BOTH sides ───────────────

test('a manager or HOD can LOG the final review, not only acknowledge one', () => {
  // THE BUG: pms_finalise refuses until a FINAL_REVIEW one-to-one carries both
  // acknowledgements, and the ONLY code that could create that row was the
  // employee's own one-to-one form. The manager's acknowledge path updates an
  // existing row; it cannot bring one into being. So a HOD with every other
  // gate satisfied was blocked permanently and told to go ask the employee to
  // log a meeting the HOD runs. Observed on Anil Verma (STC9030).
  assert.match(PERF, /async function insertFinalReview/,
    'nothing can create a FINAL_REVIEW row from the manager side')
  // At MODULE scope, because the RM surface and the HOD surface are separate
  // components and the first version of this fix lived inside the RM one —
  // where the HOD, the person actually blocked, could not reach it.
  const fnAt = PERF.indexOf('async function insertFinalReview')
  const firstComponent = PERF.indexOf('function usePeriod')
  assert.ok(fnAt < firstComponent || /^async function insertFinalReview/m.test(PERF),
    'insertFinalReview is nested inside a component, so only one surface has it')
  // Both surfaces must call it.
  const calls = [...PERF.matchAll(/insertFinalReview\(\{/g)]
  assert.ok(calls.length >= 2,
    `only ${calls.length} surface(s) can log a final review; the RM and HOD sides both need it`)
  // And it must set the manager's own tick as it creates the row — logging it
  // IS the manager asserting the conversation happened.
  const body = PERF.slice(fnAt, fnAt + 2500)
  assert.match(body, /manager_ack: true/)
  // It must NOT set the employee's tick: a two-party gate the manager can
  // satisfy alone is not a gate.
  assert.ok(!/employee_ack: true/.test(body),
    'logging from the manager side also ticks the employee — that lets a HOD '
    + 'satisfy a two-party gate unilaterally')
})

test('the employee can acknowledge a one-to-one somebody else logged', () => {
  // The other half. The employee's own form sets employee_ack as it inserts,
  // so the only acknowledged rows were ones they created — a manager-logged
  // final review could never collect the employee's tick, and pms_finalise
  // needs both. Without this the fix above just moves the dead end.
  assert.match(PERF, /const acknowledgeDiscussion = async/,
    'the employee cannot acknowledge a discussion they did not log')
  assert.match(PERF, /onAcknowledge=\{acknowledgeDiscussion\}/,
    'the handler is never wired to the one-to-one tab')
  assert.match(EMP, /onClick=\{\(\) => onAcknowledge\(l\.id!\)\}/,
    'the one-to-one log has no acknowledge control')
  // By ROW ID. Acking by discussion_type would tick every discussion of that
  // type at once, which is wrong the moment a period has two of them.
  const h = PERF.slice(PERF.indexOf('const acknowledgeDiscussion'),
                       PERF.indexOf('const acknowledgeDiscussion') + 800)
  assert.match(h, /\.eq\('id', logId\)/,
    'the acknowledgement is not addressed to a single row')
})

test('the finalise queue offers an action instead of a dead label', () => {
  // The cell used to render insteadDo as plain text when the final review was
  // the blocker — a true sentence about a gate with no door.
  assert.match(MGR, /onLogFinalReview\?\.\(r\.member\.employeeId\)/,
    'the finalise queue has no Log final review action')
  // ONE BUTTON, not three. This test originally pinned a three-state cell —
  // log / acknowledge / waiting-on-them — and 200 collapsed it deliberately:
  // the mutual sign-off gates PUBLICATION, not finalisation, so once the log
  // exists the row is finalisable and the other two states belong on the tab
  // that publishes. The test failed against correct code and was the right
  // kind of failure: it had encoded a structure that turned out to be wrong.
  assert.match(MGR, /finalReviewRequired && !r\.member\.finalReviewLogged && r\.precedingDone/,
    'the finalise cell no longer keys off whether the review is logged')
  assert.ok(!/!r\.member\.finalReviewMgrAcked \? \(/.test(MGR),
    'the finalise queue still branches on the manager acknowledgement, which '
    + '200 moved to the publishing tab')
  // The HOD surface must still pass the log handler — that is who gets stuck.
  assert.match(PERF, /onLogFinalReview=\{logFinalReview\}/)
})

test('finalising hands the appraisal to HR, whichever path was used', () => {
  // Found while proving the fix: Anil Verma came out FINALISED with
  // chain_stage still 'HOD', and HR's publish queue reads chain_stage IN
  // ('HR','DONE') — so a settled rating was invisible to the only screen that
  // could release it. Fixed in pms_finalise itself, because the HOD tab, the
  // bulk upload and HR's override all call it.
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/198_pms_finalise_hands_over_to_hr.sql'),
    'utf8')
  assert.match(sql, /chain_stage\s*=\s*CASE WHEN chain_stage = 'DONE'/,
    '198 does not advance the stage on finalise')
  // 'HR', never straight to 'DONE' — publishing is HR's separate act, and a
  // finalise that jumped to DONE would publish by accident.
  assert.match(sql, /ELSE 'HR' END/)
})
