// lib/pms/__tests__/no-jumping-the-chain.test.ts
//
// Nobody settles a rating until everyone before them has finished.
//
// THE HOLE THIS CLOSES: pms_finalise checked WHO was acting and nothing about
// whether the work that comes first existed. A HOD could settle a rating with
// no self rating, unlocked weightages and neither RM having scored. Measured
// on the live database: of 390 unfinalised appraisals with a HOD, 390 had no
// RM L1 score, 390 had unlocked weightages, 389 had no self rating, and 0 were
// genuinely ready. Every one was exposed.
//
// 199 enforces it in SQL. These tests cover the SCREEN's mirror of the rule —
// finaliseQueue must refuse to offer a control the function will reject, and
// must name the SAME cause in the SAME order, or it sends somebody to the
// wrong place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finaliseQueue, type TeamMember } from '../team.ts'

const base = (over: Partial<TeamMember> = {}): TeamMember => ({
  employeeId: 'e1', code: 'E1', name: 'Asha Rao',
  kraCount: 4, totalWeightage: 100,
  oneToOneDone: true, kraLocked: true,
  selfSubmitted: true, selfScore: 3.5,
  rmL1Id: 'u-l1', rmL1Score: 4,
  rmL2Id: 'u-l2', rmL2Score: 4,
  hodId: 'u-hod',
  finalReviewDone: true, finalReviewLogged: true, finalReviewMgrAcked: true,
  finalised: false, finalRating: null,
  dateOfJoining: '2024-01-01', dateOfLeaving: null, resignationDate: null,
  flagOverride: null,
  ...over,
})

const q = (m: TeamMember, finalReviewRequired = true) =>
  finaliseQueue([m], '2026-10-28', {
    role: 'HOD', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'HOD_ONLY',
    finalReviewRequired,
  })[0]

test('everything done: the HOD may finalise', () => {
  const r = q(base())
  assert.equal(r.canFinalise, true, r.insteadDo ?? '')
  assert.equal(r.precedingDone, true)
  assert.equal(r.insteadDo, null)
})

test('no self rating blocks it', () => {
  const r = q(base({ selfSubmitted: false, selfScore: null }))
  assert.equal(r.canFinalise, false)
  assert.equal(r.precedingDone, false)
  assert.match(r.insteadDo!, /self rating/i)
})

test('an unacknowledged KRA one-to-one blocks it', () => {
  const r = q(base({ oneToOneDone: false }))
  assert.equal(r.canFinalise, false)
  assert.match(r.insteadDo!, /one-to-one/i)
})

test('unlocked weightages block it', () => {
  // The lock and the acknowledgement are two facts. pms_lock_kras can refuse
  // for its own reasons (bad KRA count, weightage not totalling the policy's
  // figure) leaving a doubly-acknowledged one-to-one beside editable goals.
  const r = q(base({ kraLocked: false }))
  assert.equal(r.canFinalise, false)
  assert.match(r.insteadDo!, /weightages are not locked/i)
})

test('RM L1 not having rated blocks it — the case nothing checked', () => {
  // THE CENTRE OF THE BUG. finaliseQueue checked RM L2 (rule 7) and never
  // RM L1, and pms_finalise checked neither. All 390 live appraisals were in
  // exactly this state.
  const r = q(base({ rmL1Score: null }))
  assert.equal(r.canFinalise, false)
  assert.equal(r.precedingDone, false)
  assert.match(r.insteadDo!, /RM L1 has not submitted/i)
})

test('RM L2 not having rated blocks it', () => {
  const r = q(base({ rmL2Score: null }))
  assert.equal(r.canFinalise, false)
  assert.match(r.insteadDo!, /RM L2 has not submitted/i)
})

test('an EMPTY rung is skipped, not waited for', () => {
  // 190 of 395 enrolments have a chain naming RM L2 and rm_l2_id NULL, because
  // pms_resolve_chain drops L2 when it equals L1. Waiting on that rung blocked
  // half the company in 197 and must not come back here.
  const r = q(base({ rmL2Id: null, rmL2Score: null }))
  assert.equal(r.canFinalise, true, r.insteadDo ?? '')
  assert.equal(r.precedingDone, true)
  // Same for an absent RM L1.
  const r2 = q(base({ rmL1Id: null, rmL1Score: null }))
  assert.equal(r2.canFinalise, true, r2.insteadDo ?? '')
})

test('the blockers are reported in the order the database checks them', () => {
  // A row with EVERYTHING outstanding must name the most fundamental cause —
  // "nudge RM L2" on an employee who never self-rated sends a HOD to chase
  // somebody who is themselves blocked behind the self rating (rule 6).
  const r = q(base({ selfSubmitted: false, selfScore: null, oneToOneDone: false,
                     kraLocked: false, rmL1Score: null, rmL2Score: null }))
  assert.match(r.insteadDo!, /self rating/i)
  // Then the one-to-one, then the lock, then L1, then L2.
  assert.match(q(base({ oneToOneDone: false, kraLocked: false, rmL1Score: null }))!.insteadDo!, /one-to-one/i)
  assert.match(q(base({ kraLocked: false, rmL1Score: null }))!.insteadDo!, /weightages are not locked/i)
  assert.match(q(base({ rmL1Score: null, rmL2Score: null }))!.insteadDo!, /RM L1/i)
})

test('precedingDone gates the final-review log separately from finalising', () => {
  // They are different controls. With the chain complete but no final review
  // logged, the log button must be available and finalise must not.
  const r = q(base({ finalReviewDone: false, finalReviewLogged: false,
                     finalReviewMgrAcked: false }))
  assert.equal(r.precedingDone, true, 'the log button would be withheld')
  assert.equal(r.canFinalise, false, 'finalise must still wait for the review')
  assert.match(r.insteadDo!, /final review/i)
})

test('an undefined kraLocked is not treated as unlocked', () => {
  // Callers that do not load goal statuses must keep working rather than
  // having every row declared blocked.
  const m = base(); delete (m as { kraLocked?: boolean }).kraLocked
  assert.equal(q(m).canFinalise, true, q(m).insteadDo ?? '')
})

// ── the SQL side ─────────────────────────────────────────────────────────

test('199 checks the same five things, and exempts HR', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/199_pms_no_jumping_the_chain.sql'), 'utf8')
  assert.match(sql, /self_rating_mandatory AND o\.self_score IS NULL/)
  assert.match(sql, /discussion_type = 'KRA_SETTING' AND employee_ack AND manager_ack/)
  assert.match(sql, /status = 'LOCKED'/)
  assert.match(sql, /v_holder IS NOT NULL AND v_score IS NULL/,
    'an empty rung is not skipped — this would deadlock the collapsed chains')
  assert.match(sql, /IN \('HR_MANAGER','HR_HEAD','ADMIN','HR'\)/,
    'HR is not exempt, so 192\'s bulk calibration upload would break')
  // pms_finalise must actually call it, and before the final-review gate.
  const call = sql.indexOf('v_why := pms_chain_ready_before(p_employee_id')
  const gate = sql.indexOf('IF pol.final_review_one_to_one THEN')
  assert.ok(call > 0 && gate > 0 && call < gate,
    'the readiness check is missing or runs after the final-review gate')
  // And the log must be guarded by a trigger, not only by pms_finalise:
  // anon holds FOR ALL on pms_one_to_one, so a client can insert directly.
  assert.match(sql, /CREATE TRIGGER trg_pms_no_early_final_review/)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON pms_one_to_one/)
})
