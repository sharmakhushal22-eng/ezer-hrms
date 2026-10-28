// lib/pms/__tests__/chain.test.ts — the stage machine, and proof that it says
// the same thing as migration 197.
//
// THE TEST THAT MATTERS HERE IS THE LAST ONE. The rest check the movement
// rules in isolation, which is useful but cheap: both this file and chain.ts
// are mine, so they can agree with each other and both be wrong about the
// database. The SQL is what actually refuses things. So the last test parses
// pms_chain_rungs out of the migration and compares it rung for rung with
// rungs(), and fails if either side is edited alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAINS, type Chain } from '../hierarchy.ts'
import {
  rungs, firstRung, nextRung, prevRung, isActorsTurn, approvalFinalises,
  mayReject, rejectDestination, remarkOk, rungFor, heldBy, MIN_REMARK, STAGES,
  STAGE_LABEL,
} from '../chain.ts'

test('HR is the last rung on every chain, and the employee is not a rung', () => {
  for (const c of CHAINS) {
    const r = rungs(c)
    assert.equal(r.at(-1), 'HR', `${c} must end at HR`)
    assert.ok(!r.includes('EMPLOYEE'), `${c} must not list the employee as a rung`)
    assert.ok(!r.includes('DONE'), `${c} must not list DONE as a rung`)
  }
})

test('a submission lands on RM L1 whatever the chain', () => {
  // Every chain in §6.1 starts the same way; it is the middle that varies.
  for (const c of CHAINS) assert.equal(firstRung(c), 'RM_L1')
})

test('approval walks the chain forward and stops', () => {
  assert.deepEqual(rungs('SELF_RM1_RM2_HOD'), ['RM_L1', 'RM_L2', 'HOD', 'HR'])
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'RM_L1'), 'RM_L2')
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'RM_L2'), 'HOD')
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'HOD'), 'HR')
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'HR'), null)

  // The collapsed chain skips RM L2 entirely rather than passing through it.
  assert.deepEqual(rungs('SELF_RM1'), ['RM_L1', 'HR'])
  assert.equal(nextRung('SELF_RM1', 'RM_L1'), 'HR')
})

test('rejection goes back exactly one rung, and to the employee from the first', () => {
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'HOD'), 'RM_L2')
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'RM_L2'), 'RM_L1')
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'RM_L1'), 'EMPLOYEE')

  // On Self → RM L1 → HOD the HOD's rejection must reach RM L1, NOT RM L2 —
  // which is the whole reason prevRung reads the chain instead of subtracting
  // one from a fixed ladder.
  assert.equal(prevRung('SELF_RM1_HOD', 'HOD'), 'RM_L1')
})

test('a stage the chain no longer contains moves nowhere', () => {
  // A policy switched from Self→RM1→RM2→HOD to Self→RM1 leaves in-flight
  // appraisals parked on RM_L2. Guessing would hand one to an unappointed HOD.
  assert.equal(nextRung('SELF_RM1', 'RM_L2'), null)
  assert.equal(prevRung('SELF_RM1', 'RM_L2'), null)
  assert.match(rejectDestination('SELF_RM1', 'RM_L2'), /not part of the chain/)
})

test('only the holder of the stage gets a turn', () => {
  assert.ok(isActorsTurn('RM_L1', 'RM_L1'))
  assert.ok(!isActorsTurn('RM_L1', 'RM_L2'))
  assert.ok(!isActorsTurn('RM_L1', 'EMPLOYEE'))
  // Nobody's turn before submission or after completion.
  assert.ok(!isActorsTurn(null, 'RM_L1'))
  assert.ok(!isActorsTurn('DONE', 'HR_MGR'))
  // HR's rung is held by any of the three HR-ish roles, not by a manager.
  for (const r of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as const) {
    assert.ok(isActorsTurn('HR', r), `${r} should hold the HR rung`)
  }
  assert.ok(!isActorsTurn('HR', 'HOD'))
})

test('the last reviewer finalises, and only the last reviewer', () => {
  assert.ok(approvalFinalises('SELF_RM1_RM2_HOD', 'HOD'))
  assert.ok(!approvalFinalises('SELF_RM1_RM2_HOD', 'RM_L2'))
  assert.ok(!approvalFinalises('SELF_RM1_RM2_HOD', 'RM_L1'))
  // On the collapsed chain that is RM L1 — there is nobody else.
  assert.ok(approvalFinalises('SELF_RM1', 'RM_L1'))
})

test('HR cannot reject, and neither can a stage with nothing in it', () => {
  // The decision is explicit: HR publishes and does not change the rating, so
  // giving them a reject button would make them an approver.
  assert.ok(!mayReject('HR'))
  assert.ok(!mayReject(null))
  assert.ok(!mayReject('EMPLOYEE'))
  assert.ok(!mayReject('DONE'))
  for (const s of ['RM_L1', 'RM_L2', 'HOD'] as const) assert.ok(mayReject(s))
})

test('a remark has to be a sentence, not a shrug', () => {
  assert.ok(!remarkOk(''))
  assert.ok(!remarkOk(null))
  assert.ok(!remarkOk('no'))
  assert.ok(!remarkOk('   .   '))           // whitespace is not a reason
  assert.ok(!remarkOk(' '.repeat(40)))      // nor is a lot of whitespace
  assert.ok(remarkOk('Weightage on KRA 2 is too high for the quarter.'))
})

test('every stage has a label a human can read', () => {
  for (const s of STAGES) {
    assert.ok(STAGE_LABEL[s] && STAGE_LABEL[s].length > 3, `${s} needs a label`)
  }
})

// ── the collapsed chain, which is half the database ──────────────────────

test('an unfilled rung is SKIPPED, not stepped onto', () => {
  // THE BUG THIS EXISTS FOR. 190 of the 395 enrolments in the database have a
  // policy chain of SELF_RM1_RM2_HOD and a snapshot with rm_l2_id NULL,
  // because pms_resolve_chain drops L2 when it equals L1. Stepping to the next
  // LISTED rung parks 48% of the company on an RM_L2 that does not exist —
  // and approve and reject both check identity against the frozen chain, so
  // nobody can move it in either direction. A permanent deadlock.
  const collapsed = heldBy({ rmL1Id: 'u-a', rmL2Id: null, hodId: 'u-c' })
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'RM_L1', collapsed), 'HOD')
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'HOD', collapsed), 'RM_L1')
})

test('a collapsed line means the RM L1 approval finalises', () => {
  // Consequence of the skip, and the reason the UI must know: the button has
  // to read "Approve & finalise" and ask for the rating pms_chain_approve
  // will demand. Said as "Approve" with no field, the manager clicks and gets
  // "a final rating is needed to finalise" with nowhere to type one.
  const noL2noHod = heldBy({ rmL1Id: 'u-a', rmL2Id: null, hodId: null })
  assert.ok(approvalFinalises('SELF_RM1_RM2_HOD', 'RM_L1', noL2noHod))
  // With a HOD present it does not — the HOD's does.
  const withHod = heldBy({ rmL1Id: 'u-a', rmL2Id: null, hodId: 'u-c' })
  assert.ok(!approvalFinalises('SELF_RM1_RM2_HOD', 'RM_L1', withHod))
  assert.ok(approvalFinalises('SELF_RM1_RM2_HOD', 'HOD', withHod))
})

test('a rejection never strands the set on an empty rung', () => {
  // Worse than going forward onto nobody: the employee is left waiting on a
  // correction that can never be made.
  const onlyL1 = heldBy({ rmL1Id: 'u-a', rmL2Id: null, hodId: null })
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'HOD', onlyL1), 'RM_L1')
  // Nothing held below at all falls through to the employee.
  const none = heldBy({ rmL1Id: null, rmL2Id: null, hodId: 'u-c' })
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'HOD', none), 'EMPLOYEE')
  assert.match(rejectDestination('SELF_RM1_RM2_HOD', 'HOD', none),
    /back to the employee/)
})

test('HR counts as held even though no column names a person', () => {
  // HR is a role, not an id in the snapshot. Treated as unfilled, the last
  // reviewer's approval would find no next rung and never finalise.
  const h = heldBy({ rmL1Id: null, rmL2Id: null, hodId: null })
  assert.ok(h('HR'))
  assert.ok(!h('RM_L1'))
})

test('with no holders given, every rung counts — the old behaviour', () => {
  // The default has to stay the policy's own chain, for screens that describe
  // a policy rather than a person.
  assert.equal(nextRung('SELF_RM1_RM2_HOD', 'RM_L1'), 'RM_L2')
  assert.equal(prevRung('SELF_RM1_RM2_HOD', 'HOD'), 'RM_L2')
})

// ── whose rung is it, per employee ───────────────────────────────────────

test('the viewer\'s rung is resolved per employee, not once', () => {
  const me = 'u-me'
  // The real shape this was written for: one manager who is RM L1 to their own
  // reportee and HOD to somebody else's. A single rung computed once is wrong
  // for one of these two whichever way it is computed.
  assert.equal(rungFor({ rmL1Id: me, rmL2Id: 'u-x', hodId: 'u-y' }, me), 'RM_L1')
  assert.equal(rungFor({ rmL1Id: 'u-a', rmL2Id: 'u-b', hodId: me }, me), 'HOD')
  assert.equal(rungFor({ rmL1Id: 'u-a', rmL2Id: me, hodId: 'u-y' }, me), 'RM_L2')
})

test('somebody outside the chain holds no rung', () => {
  assert.equal(rungFor({ rmL1Id: 'u-a', rmL2Id: 'u-b', hodId: 'u-c' }, 'u-me'), null)
  // An empty viewer id must not match an empty/missing chain id. Without the
  // guard, `null === null` style comparisons hand every unassigned row to
  // whoever happens to be looking.
  assert.equal(rungFor({ rmL1Id: null, rmL2Id: null, hodId: null }, ''), null)
  assert.equal(rungFor({ rmL1Id: null, rmL2Id: null, hodId: null }, 'u-me'), null)
})

test('one person holding every rung is placed at L1, as 067 stores them', () => {
  // SRS9009 is RM L1, RM L2 and HOD for his whole team. pms_resolve_chain
  // drops L2 when it equals L1, so L1 is the rung that actually exists.
  assert.equal(rungFor({ rmL1Id: 'u-s', rmL2Id: 'u-s', hodId: 'u-s' }, 'u-s'), 'RM_L1')
})

// ── the one that catches drift ───────────────────────────────────────────

test('migration 197 and rungs() list the same rungs for every chain', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/197_pms_chain_approve_and_reject.sql'),
    'utf8',
  )

  // Pull the body of pms_chain_rungs, then read its WHEN/THEN pairs. Scoped to
  // that function so an ARRAY[...] elsewhere in the file cannot be mistaken
  // for a chain definition.
  const fn = sql.match(
    /FUNCTION pms_chain_rungs[\s\S]*?SELECT CASE p_chain([\s\S]*?)\n\s*END;/,
  )
  assert.ok(fn, 'could not find pms_chain_rungs in 197 — has it been renamed?')

  const fromSql = new Map<string, string[]>()
  const pair = /WHEN\s+'([A-Z0-9_]+)'\s+THEN\s+ARRAY\[([^\]]*)\]/g
  for (const m of fn![1].matchAll(pair)) {
    fromSql.set(m[1], m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')))
  }

  // If the regex silently matched nothing, every comparison below would be
  // vacuous and the test would pass while proving nothing — the exact failure
  // mode that let an earlier enum test pass against the bug it was written
  // for. So assert the parse found something first.
  assert.equal(fromSql.size, CHAINS.length,
    `parsed ${fromSql.size} chains out of 197, expected ${CHAINS.length}: ` +
    `${[...fromSql.keys()].join(', ')}`)

  for (const c of CHAINS) {
    assert.deepEqual(fromSql.get(c), rungs(c as Chain),
      `197 and chain.ts disagree about ${c}`)
  }
})
