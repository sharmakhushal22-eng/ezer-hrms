// lib/pms/__tests__/signoff-gates-publication.test.ts
//
// THE MUTUAL SIGN-OFF GATES PUBLICATION, NOT FINALISATION.
//
// Reported as: the HOD should be able to give a final rating and finalise
// without the employee's acknowledgement. That is not a relaxation of the
// spec — it IS the spec, and 188 had it on the wrong step:
//
//   Stage 6  "Result PUBLICATION is blocked until the final 1-on-1 log is
//             mutually signed off."
//   §230     "strictly halts score PUBLICATION until this dialogue is logged
//             and acknowledged by both parties."
//   §389     "pms_finalise ... strictly aborts if final review 1-on-1 dialogue
//             LOGS ARE MISSING."
//
// Finalising needs the conversation on record. Publishing needs it signed.
// Demanding both acknowledgements to finalise left a HOD waiting on an
// employee to acknowledge a conversation about a rating that did not exist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finaliseQueue, type TeamMember } from '../team.ts'
import { canPublishResult } from '../oneToOne.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MGR = read('components/pms/ManagerTabs.tsx')

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  employeeId: 'e1', code: 'E1', name: 'Asha Rao',
  kraCount: 4, totalWeightage: 100,
  oneToOneDone: true, kraLocked: true,
  selfSubmitted: true, selfScore: 3.5,
  rmL1Id: 'u-l1', rmL1Score: 4, rmL2Id: 'u-l2', rmL2Score: 4, hodId: 'u-hod',
  finalReviewLogged: true, finalReviewMgrAcked: true, finalReviewDone: false,
  finalised: false, finalRating: null,
  dateOfJoining: '2024-01-01', dateOfLeaving: null, resignationDate: null,
  flagOverride: null,
  ...over,
})
const q = (m: TeamMember) => finaliseQueue([m], '2026-10-28', {
  role: 'HOD', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'HOD_ONLY',
  finalReviewRequired: true,
})[0]

test('THE REQUEST: logged but NOT acknowledged by the employee — finalise is open', () => {
  // finalReviewDone is false (no mutual sign-off) and the HOD may still settle
  // the rating. This is the behaviour that was asked for and the spec's.
  const r = q(member({ finalReviewLogged: true, finalReviewDone: false }))
  assert.equal(r.canFinalise, true, r.insteadDo ?? '')
  assert.equal(r.insteadDo, null)
})

test('no final review on record at all — finalise is still blocked', () => {
  // §389: aborts if the logs are MISSING. Existence is the finalisation gate,
  // so relaxing the signatures must not relax this.
  const r = q(member({ finalReviewLogged: false, finalReviewDone: false }))
  assert.equal(r.canFinalise, false)
  assert.match(r.insteadDo!, /final review one-to-one on record/i)
})

test('the finalise queue no longer chases the employee', () => {
  // A sentence here about waiting on their acknowledgement would send a HOD to
  // chase somebody who cannot unblock this screen.
  const r = q(member({ finalReviewLogged: true, finalReviewDone: false }))
  assert.ok(!/acknowledg/i.test(r.insteadDo ?? ''),
    'the finalise queue still mentions an acknowledgement it does not need')
  const r2 = q(member({ finalReviewLogged: false }))
  assert.ok(!/acknowledg/i.test(r2.insteadDo ?? ''),
    'the not-logged message still asks for acknowledgements')
})

test('PUBLICATION still requires both signatures — nothing was weakened', () => {
  // The gate did not disappear; it moved to the step it protects.
  assert.equal(canPublishResult([
    { discussion_type: 'FINAL_REVIEW', employee_ack: true, manager_ack: false },
  ]).open, false)
  assert.equal(canPublishResult([
    { discussion_type: 'FINAL_REVIEW', employee_ack: false, manager_ack: true },
  ]).open, false)
  assert.equal(canPublishResult([
    { discussion_type: 'FINAL_REVIEW', employee_ack: true, manager_ack: true },
  ]).open, true)
})

test('the sign-off is chased on the tab that publishes', () => {
  const fb = MGR.slice(MGR.indexOf('export function FeedbackTab'))
  assert.match(fb, /onAcknowledgeFinalReview/,
    'the publishing tab offers no way to add the manager\'s half')
  assert.match(fb, /Acknowledge the final review/)
  // And the finalise queue must no longer carry that control.
  const fin = MGR.slice(MGR.indexOf('export function FinaliseTab'),
                        MGR.indexOf('export function FeedbackTab'))
  assert.ok(!/Acknowledge it</.test(fin),
    'the finalise queue still offers an acknowledge button it does not need')
  assert.ok(!/to acknowledge the final review/.test(fin),
    'the finalise queue still says it is waiting on the employee')
})

test('the finalise cell keys off LOGGED, not the mutual sign-off', () => {
  const fin = MGR.slice(MGR.indexOf('export function FinaliseTab'),
                        MGR.indexOf('export function FeedbackTab'))
  assert.match(fin, /finalReviewRequired && !r\.member\.finalReviewLogged && r\.precedingDone/,
    'the cell still branches on finalReviewDone')
})

// ── the SQL side ─────────────────────────────────────────────────────────

test('200 relaxes finalise and adds the publication trigger', () => {
  const sql = read('supabase/migrations/200_pms_signoff_gates_publication_not_finalisation.sql')
  // pms_finalise counts FINAL_REVIEW rows WITHOUT requiring the acks.
  const fin = sql.slice(sql.indexOf('IF pol.final_review_one_to_one THEN'))
  const counter = fin.slice(0, 1400)
  assert.match(counter, /discussion_type='FINAL_REVIEW';/,
    'pms_finalise still requires the acknowledgements to finalise')
  assert.ok(!/discussion_type='FINAL_REVIEW' AND employee_ack AND manager_ack/.test(counter),
    'the finalise gate still demands both acks')
  // And the gate reappears on publication, in the DATABASE — the HOD's button
  // was gated by canPublishResult but HR's Publish Results tab checks nothing,
  // and publishing is a plain UPDATE anon may make directly.
  assert.match(sql, /CREATE TRIGGER trg_pms_publish_needs_signoff/)
  assert.match(sql, /BEFORE UPDATE ON pms_overall_rating/)
  assert.match(sql, /AND discussion_type = 'FINAL_REVIEW' AND employee_ack AND manager_ack/,
    'the publish trigger does not require both acknowledgements')
  // Only on the transition INTO published, or an acknowledgement on an
  // already-published row would be refused and strand it.
  assert.match(sql, /OLD\.workflow_status IN \('PUBLISHED','ACKNOWLEDGED'\)/)
  // And only when the policy asks for a final review at all.
  assert.match(sql, /IF NOT COALESCE\(v_req, false\) THEN RETURN NEW; END IF;/)
})
