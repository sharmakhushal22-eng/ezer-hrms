// Spec §1 and §2 — the flow and the role matrix, checked against the spec's
// own tables. These are the rules that decide who sees which button, so a
// wrong cell here is not a cosmetic bug: it is somebody finalising an
// appraisal they had no standing to finalise.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLES, ACTIONS, may, canFinalise, blockedByRmL2, FLOW, FLOW_ENDS,
  CHAIN_STEPS, FINALISERS, ROLE_LABEL, ACTION_LABEL, SCOPE_NOTE,
  REPORTING_LINE, type Role,
} from '../hierarchy.ts'
import { windowsFor, periodState, previewPeriods } from '../policy.ts'

// ── §2, the cells that carry consequences ────────────────────────────────

test('RULE: an RM cannot initiate a PIP — only HR can', () => {
  for (const r of ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD'] as Role[]) {
    assert.equal(may(r, 'initiate_pip'), 'no', `${r} must not initiate a PIP`)
  }
  for (const r of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as Role[]) {
    assert.equal(may(r, 'initiate_pip'), 'yes')
  }
})

test('an RM CAN raise a PIP request — the gate is on initiating, not asking', () => {
  assert.equal(may('RM_L1', 'raise_pip_request'), 'yes')
  assert.equal(may('HOD', 'raise_pip_request'), 'yes')
  // and HR, who initiates, is not the one who raises
  assert.equal(may('HR_MGR', 'raise_pip_request'), 'no')
})

test('finalise is three-valued for the manager roles, never a plain boolean', () => {
  for (const r of ['RM_L1', 'RM_L2', 'HOD'] as Role[]) {
    assert.equal(may(r, 'finalise_rating'), 'policy',
      `${r} must defer to who_can_finalise, not be hardcoded`)
  }
  assert.equal(may('EMPLOYEE', 'finalise_rating'), 'no')
})

test('canFinalise resolves the policy cell, and HOD_ONLY really does exclude the RMs', () => {
  assert.equal(canFinalise('RM_L1', 'RM1_RM2_HOD'), true)
  assert.equal(canFinalise('RM_L1', 'RM2_HOD'), false)
  assert.equal(canFinalise('RM_L1', 'HOD_ONLY'), false)
  assert.equal(canFinalise('RM_L2', 'RM2_HOD'), true)
  assert.equal(canFinalise('HOD', 'HOD_ONLY'), true)
  // An employee is never a finaliser under any setting.
  for (const f of FINALISERS) assert.equal(canFinalise('EMPLOYEE', f), false)
  // HR is not governed by the setting: it picks which LINE MANAGER signs off,
  // not whether HR can correct a stuck record.
  for (const f of FINALISERS) assert.equal(canFinalise('HR_HEAD', f), true)
})

test('only HR Head and Admin configure policy — an HR Manager cannot', () => {
  assert.equal(may('HR_MGR', 'configure_policy'), 'no')
  assert.equal(may('HR_HEAD', 'configure_policy'), 'yes')
  assert.equal(may('ADMIN', 'configure_policy'), 'yes')
  // but an HR Manager CAN bulk upload ratings, which is a different power
  assert.equal(may('HR_MGR', 'bulk_upload_ratings'), 'yes')
})

test('everybody writes their own KRAs and rates themselves, including HR', () => {
  for (const r of ROLES) {
    assert.equal(may(r, 'create_own_kras'), 'yes')
    assert.equal(may(r, 'self_rating'), 'yes')
    assert.equal(may(r, 'view_own_analytics'), 'yes')
  }
})

test('HR does not sit in the one-to-one — it is between the employee and their manager', () => {
  for (const r of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as Role[]) {
    assert.equal(may(r, 'log_one_to_one'), 'no')
    assert.equal(may(r, 'ack_one_to_one'), 'no')
    assert.equal(may(r, 'lock_weightage'), 'no')
    assert.equal(may(r, 'rate_reportees'), 'no')
  }
})

test('an RM L1 cannot upload an additional benefit, but an RM L2 can', () => {
  assert.equal(may('RM_L1', 'upload_benefit'), 'no')
  assert.equal(may('RM_L2', 'upload_benefit'), 'yes')
})

test('a yes on team analytics is not the same size of yes for everybody', () => {
  assert.equal(SCOPE_NOTE.view_team_analytics?.RM_L1, 'own team')
  assert.equal(SCOPE_NOTE.view_team_analytics?.HOD, 'own department')
  assert.equal(SCOPE_NOTE.view_team_analytics?.HR_HEAD, 'all')
  // an employee has no team scope at all, because they have no team view
  assert.equal(may('EMPLOYEE', 'view_team_analytics'), 'no')
  assert.equal(SCOPE_NOTE.view_team_analytics?.EMPLOYEE, undefined)
})

test('every role and every action is labelled — no raw enum reaches a screen', () => {
  for (const r of ROLES) assert.match(ROLE_LABEL[r], /\S/)
  for (const a of ACTIONS) {
    assert.match(ACTION_LABEL[a], /\S/)
    assert.ok(!ACTION_LABEL[a].includes('_'), `${a} label still looks like an enum`)
  }
})

// ── rule 7: the RM L2 gate ───────────────────────────────────────────────

test('RULE 7: a HOD cannot finalise while RM L2 is still pending', () => {
  assert.equal(blockedByRmL2('SELF_RM1_RM2_HOD', false), true)
  assert.equal(blockedByRmL2('SELF_RM1_RM2_HOD', true), false)
})

test('...but a chain WITHOUT an RM L2 must not deadlock waiting for one', () => {
  // This is the failure mode worth guarding: apply the rule blindly and a
  // record on Self → RM L1 → HOD waits forever for a step that has nobody in
  // it, and no screen can explain why the finalise button never enables.
  assert.equal(blockedByRmL2('SELF_RM1_HOD', false), false)
  assert.equal(blockedByRmL2('SELF_RM1', false), false)
})

test('every chain starts with the employee and ends with a manager', () => {
  for (const [, steps] of Object.entries(CHAIN_STEPS)) {
    assert.equal(steps[0], 'EMPLOYEE')
    assert.notEqual(steps[steps.length - 1], 'EMPLOYEE')
  }
})

// ── §1 the flow ──────────────────────────────────────────────────────────

test('the flow is the spec’s twelve steps, in order, with no gaps', () => {
  assert.equal(FLOW.length, 12)
  FLOW.forEach((s, i) => assert.equal(s.n, i + 1))
})

test('the PIP branch is steps 9 to 12, and step 11 names the HR-only gate', () => {
  assert.match(FLOW[8].what, /PIP/i)
  assert.match(FLOW[10].gate ?? '', /RM cannot/i)
})

test('the gates that block are stated, not left for somebody to discover', () => {
  const gated = [3, 4, 5, 6, 7, 8]          // spec steps with a real gate
  for (const n of gated) {
    const step = FLOW.find(s => s.n === n)!
    assert.ok(step.gate && step.gate.length > 10,
      `step ${n} has a gate in the spec but does not state it`)
  }
})

test('the flow ends at development, and says so in as many words', () => {
  assert.match(FLOW_ENDS, /payroll/i)
  assert.match(FLOW_ENDS, /feedback|development/i)
})

test('the reporting line runs MD down to employee', () => {
  assert.equal(REPORTING_LINE[0], 'MD')
  assert.equal(REPORTING_LINE[REPORTING_LINE.length - 1], 'Employee')
})

// ── §6.1 the four windows ────────────────────────────────────────────────

const Q = previewPeriods('QUARTERLY', '2026-04-01')

test('KRAs open WITH the period; every rating window opens after it ends', () => {
  const w = windowsFor(Q[0], 'QUARTERLY')
  assert.equal(w.kra.start, Q[0].start, 'KRAs must be agreed at the start')
  assert.ok(w.kra.end <= Q[0].end)
  // You cannot rate a quarter you have not finished.
  for (const win of [w.self, w.rm, w.finalise]) {
    assert.ok(win.start > Q[0].end, `${win.label} must open after the period ends`)
  }
})

test('the rating windows run in order and do not overlap each other', () => {
  const w = windowsFor(Q[0], 'QUARTERLY')
  assert.ok(w.self.end < w.rm.start, 'self must close before RM review opens')
  assert.ok(w.rm.end < w.finalise.start, 'RM review must close before finalise opens')
})

test('a monthly cycle’s RATING windows never collide with the next month’s', () => {
  // The case a naive plan breaks on: hang 28 days of rating windows off a
  // 30-day period and April's finalise window is still open when May's
  // ratings start, so an RM has two live cycles for the same person.
  //
  // Note what is NOT asserted. May's KRA window (01-08 May) sits INSIDE
  // April's rating windows, and that is correct — KRAs look forward while
  // ratings look back, so the two always overlap on a short cycle. An earlier
  // version of this test compared against the next KRA window and failed
  // honest code.
  const M = previewPeriods('MONTHLY', '2026-04-01')
  for (let i = 0; i < M.length - 1; i++) {
    const w = windowsFor(M[i], 'MONTHLY')
    const next = windowsFor(M[i + 1], 'MONTHLY')
    assert.ok(w.finalise.end < next.self.start,
      `month ${i + 1} is still being finalised when month ${i + 2}'s self rating opens`)
  }
})

test('every frequency produces windows that are at least a day long', () => {
  for (const f of ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const) {
    for (const p of previewPeriods(f, '2026-04-01')) {
      const w = windowsFor(p, f)
      for (const win of [w.kra, w.self, w.rm, w.finalise]) {
        assert.ok(win.start <= win.end, `${f} ${p.code} ${win.label} ends before it starts`)
      }
    }
  }
})

// ── §6.1 the status column ───────────────────────────────────────────────

test('a period stays OPEN until its last window closes, not when the period ends', () => {
  const p = Q[0]                                   // April to June 2026
  const w = windowsFor(p, 'QUARTERLY')
  // The day after the quarter ends, the ratings for it are only just starting.
  assert.equal(periodState(p, 'QUARTERLY', '2026-07-02'), 'active')
  assert.equal(periodState(p, 'QUARTERLY', w.finalise.end), 'active')
  assert.equal(periodState(p, 'QUARTERLY', '2026-12-01'), 'closed')
})

test('a period that has not begun reads as scheduled, not closed', () => {
  assert.equal(periodState(Q[3], 'QUARTERLY', '2026-04-15'), 'scheduled')
  assert.equal(periodState(Q[0], 'QUARTERLY', '2026-04-15'), 'active')
})

test('exactly one quarter is open on any day inside the rating windows', () => {
  // Overlapping "open now" rows would tell an admin two cycles are live.
  for (const day of ['2026-05-10', '2026-08-20', '2026-11-05', '2027-02-14']) {
    const open = Q.filter(p => periodState(p, 'QUARTERLY', day) === 'active')
    assert.equal(open.length, 1, `${day} shows ${open.length} open periods`)
  }
})
