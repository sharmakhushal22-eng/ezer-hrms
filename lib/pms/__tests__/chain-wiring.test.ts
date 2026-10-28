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
  assert.match(MGR, /const finalises = approvalFinalises\(chain, myStage\)/)
  assert.match(MGR, /finalises\s*&&\s*\(\s*<input type="number"/)
  assert.match(MGR, /finalises \? 'Approve & finalise' : 'Approve'/)
})

test('the reject button names where the set is going', () => {
  assert.match(MGR, /rejectDestination\(chain, myStage\)/,
    'the rejection dialog does not say where the set will go')
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
