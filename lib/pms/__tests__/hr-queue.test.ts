// What the chain asked for, gathered for the HR Head who decides.
//
// Requested: "all this PIP checks, recommendations and recognization by
// r1/r2/hod will be shown to hr head at end so they can publish results and
// give recognizations and act accordingly."
//
// ── THE TWO THINGS THIS FILE IS REALLY GUARDING ──────────────────────────
//
// 1. An undecided proposal must NOT block a publication. A rater can attach
//    a proposal to anybody, so a blocking rule would let any rater stall any
//    result indefinitely. These are warnings; the publish faults stay what
//    they were.
//
// 2. Nothing may be silently dropped. A row fetched without hr_status, a row
//    with no kind, a numeric arriving as a string — each of those, read
//    carelessly, removes work from the queue of the person whose whole job
//    here is to act on it. Most of the assertions below are that.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chainAsks, chainAsksByEmployee, publishWarnings, asksBadge,
         queueTotals, pipLine, type RecRowDb } from '../hrQueue.ts'
import { pipFromRow } from '../pip.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const E = 'emp-1', O = 'emp-2'
const rec = (over: Partial<RecRowDb> = {}): RecRowDb => ({
  id: 'r1', employee_id: E, kind: 'TRAINING', training_name: 'Advanced Excel',
  category: 'TECHNICAL', recommended_by: 'mgr-1', recommended_by_role: 'RM_L1',
  hr_status: 'PENDING', ...over,
})
const pipRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', employee_id: E, requested_by: 'mgr-1', requested_by_role: 'RM_L1',
  request_reason: 'sustained shortfall against the quarter\'s targets',
  trigger_rating: '1.80', proposed_start: '2026-11-03', proposed_end: '2027-02-01',
  hr_status: 'PENDING_HR', status: 'REQUESTED', employee_ack: false, ...over,
})

// ── nothing is dropped ───────────────────────────────────────────────────

test('an employee nobody asked anything for comes back empty, not broken', () => {
  const a = chainAsks(E, [], [])
  assert.equal(a.empty, true)
  assert.deepEqual(a.training, [])
  assert.equal(a.pendingRecommendations, 0)
  // And the no-id case, which is what a table renders before anybody is picked.
  assert.equal(chainAsks(null, [rec()], [pipRow()]).empty, true)
})

test('only this employee\'s asks are gathered', () => {
  const a = chainAsks(E, [rec(), rec({ id: 'r2', employee_id: O })], [pipRow({ employee_id: O })])
  assert.equal(a.training.length, 1)
  assert.equal(a.pips.length, 0, 'another person\'s PIP showed on this card')
  assert.equal(a.pendingRecommendations, 1,
    'the count describes a wider set than the list under it')
})

test('a row with no hr_status still counts as waiting', () => {
  // The column defaults to PENDING, but a query that did not select it
  // returns undefined — and treating that as decided hides work from HR.
  const a = chainAsks(E, [rec({ hr_status: undefined })], [])
  assert.equal(a.training[0].status, 'PENDING')
  assert.equal(a.pendingRecommendations, 1)
})

test('a row with no kind is read as training, never as recognition', () => {
  // 210's default, enforced on the read side too: inventing a recognition
  // proposal puts a bonus in front of HR that nobody proposed.
  const a = chainAsks(E, [rec({ kind: undefined }), rec({ id: 'r2', kind: null })], [])
  assert.equal(a.training.length, 2)
  assert.equal(a.recognition.length, 0)
})

test('the two kinds are separated by kind, not by what somebody typed', () => {
  const a = chainAsks(E, [
    rec({ id: 'r1', kind: 'TRAINING', training_name: 'Excel',
          details: 'RECOGNITION — she has earned a course on this' }),
    rec({ id: 'r2', kind: 'RECOGNITION', training_name: 'Salary bonus',
          details: 'carried the migration single-handed' }),
  ], [])
  assert.equal(a.training.length, 1, 'the word in a training note moved it to recognition')
  assert.equal(a.training[0].name, 'Excel')
  assert.equal(a.recognition.length, 1)
  assert.equal(a.recognition[0].name, 'Salary bonus')
})

test('a numeric trigger rating arriving as a string is read as a number', () => {
  // PostgREST returns numeric as a string. '1.80' * nothing is 1.8, but
  // Number('') is 0 — which would show a trigger rating of zero.
  assert.equal(chainAsks(E, [], [pipRow()]).pips[0].triggerRating, 1.8)
  assert.equal(chainAsks(E, [], [pipRow({ trigger_rating: '' })]).pips[0].triggerRating, null)
  assert.equal(chainAsks(E, [], [pipRow({ trigger_rating: null })]).pips[0].triggerRating, null)
})

// ── the PIP state is derived, not copied ─────────────────────────────────

test('three columns become one lifecycle state', () => {
  assert.equal(pipFromRow(pipRow()).status, 'PENDING_HR')
  assert.equal(pipFromRow(pipRow({ hr_status: 'SENT_BACK' })).status, 'SENT_BACK')
  assert.equal(pipFromRow(pipRow({ hr_status: 'REJECTED' })).status, 'REJECTED')
  // Started but unacknowledged is INITIATED, even though status says ACTIVE.
  assert.equal(pipFromRow(pipRow({ hr_status: 'INITIATED', status: 'ACTIVE' })).status,
    'INITIATED')
  assert.equal(pipFromRow(pipRow({ hr_status: 'INITIATED', status: 'ACTIVE',
    employee_ack: true })).status, 'ACKNOWLEDGED')
  assert.equal(pipFromRow(pipRow({ hr_status: 'INITIATED', status: 'UNDER_REVIEW',
    employee_ack: true })).status, 'IN_REVIEW')
  assert.equal(pipFromRow(pipRow({ hr_status: 'INITIATED', employee_ack: true,
    reviewsDone: 2 })).status, 'IN_REVIEW')
})

test('a finished PIP is never read as a live one', () => {
  // THE MISTAKE THAT MATTERS. Reading the columns in any other order shows a
  // settled PIP in an "active PIPs" count months after it ended.
  for (const st of ['CLOSED', 'CANCELLED']) {
    const p = pipFromRow(pipRow({ status: st, hr_status: 'INITIATED', employee_ack: false }))
    assert.equal(p.status, 'CLOSED', `status ${st} did not read as finished`)
  }
  // A cancelled PIP has no status of its own. Folded into CLOSED on purpose:
  // wrong about why is survivable, wrong about whether it is over is not.
  assert.notEqual(pipFromRow(pipRow({ status: 'CANCELLED' })).status, 'PENDING_HR')
})

test('an unknown hr_status is treated as still waiting on HR', () => {
  // The safe direction: an unrecognised value should put the row in front of
  // somebody, not quietly mark it handled.
  assert.equal(pipFromRow(pipRow({ hr_status: 'SOMETHING_NEW' })).status, 'PENDING_HR')
  assert.equal(pipFromRow({}).status, 'PENDING_HR')
})

test('the outcome placeholder is not an outcome', () => {
  // final_outcome allows 'PENDING', which is not one of the three real ones.
  assert.equal(pipFromRow(pipRow({ final_outcome: 'PENDING' })).outcome, null)
  assert.equal(pipFromRow(pipRow({ final_outcome: 'IMPROVED' })).outcome, 'IMPROVED')
})

test('only a request actually waiting on HR is counted as pending', () => {
  const a = chainAsks(E, [], [
    pipRow({ id: 'p1' }),
    pipRow({ id: 'p2', hr_status: 'INITIATED', employee_ack: true, status: 'UNDER_REVIEW' }),
    pipRow({ id: 'p3', status: 'CLOSED' }),
  ])
  assert.equal(a.pips.length, 3, 'the card hides PIPs it is not asking HR to decide')
  assert.equal(a.pendingPips, 1)
})

// ── warnings, not faults ─────────────────────────────────────────────────

test('an undecided proposal warns and does not block', () => {
  // The rule this file exists to hold: a pending proposal is reported, and
  // publishing stays possible. Blocking would let any rater stall any
  // result by proposing something nobody decides.
  const a = chainAsks(E, [rec({ kind: 'RECOGNITION', training_name: 'Salary bonus' })], [])
  const w = publishWarnings(a)
  assert.equal(w.length, 1)
  assert.match(w[0], /not been decided/)
  // Not a fault: the publish gate's faults are built in PublishTab, and this
  // text must never reach it.
  const src = read('components/pms/AdminTabs.tsx')
  const gate = src.slice(src.indexOf('const faults: string[] = []'),
                         src.indexOf('const publishable ='))
  assert.ok(!/recognition|training|publishWarnings|pendingRec/i.test(gate),
    'a pending proposal has become a publish fault, so a rater can stall a release')
})

test('the warnings say what the employee will and will not read', () => {
  const rejected = chainAsks(E, [rec({ hr_status: 'ACCEPTED' })], [])
  assert.deepEqual(publishWarnings(rejected), [],
    'a decided proposal is still being warned about')

  const tr = publishWarnings(chainAsks(E, [rec()], []))
  assert.match(tr[0], /not shown to the employee/,
    'a training suggestion reads as if it changed what goes out')

  const pip = publishWarnings(chainAsks(E, [], [pipRow()]))
  assert.match(pip[0], /can be released without it/,
    'the PIP warning reads as a blocker')
})

test('singular and plural are both written', () => {
  // "1 recognition proposals have not been decided" is the kind of line that
  // makes somebody distrust the whole screen.
  const one = publishWarnings(chainAsks(E, [rec({ kind: 'RECOGNITION' })], []))[0]
  assert.match(one, /A recognition proposal from the chain has/)
  const two = publishWarnings(chainAsks(E, [
    rec({ id: 'r1', kind: 'RECOGNITION', training_name: 'Salary bonus' }),
    rec({ id: 'r2', kind: 'RECOGNITION', training_name: 'Promotion' }),
  ], []))[0]
  assert.match(two, /2 recognition proposals from the chain have/)
})

test('nothing asked for means nothing to warn about', () => {
  assert.deepEqual(publishWarnings(chainAsks(E, [], [])), [])
})

// ── the glanceable bits ──────────────────────────────────────────────────

test('the badge names what is there, and is absent when nothing is', () => {
  assert.equal(asksBadge(chainAsks(E, [], [])), null)
  assert.equal(asksBadge(undefined), null)
  const a = chainAsks(E, [rec(), rec({ id: 'r2', kind: 'RECOGNITION', training_name: 'Bonus' })],
                      [pipRow()])
  assert.equal(asksBadge(a), '1 recognition · 1 training · 1 PIP')
})

test('a PIP line says where it is and who moves next', () => {
  const a = chainAsks(E, [], [pipRow()])
  const line = pipLine(a.pips[0])
  assert.match(line, /waiting with HR/)
  assert.match(line, /initiate, send it back or decline/,
    'the line states a status with no next step')
})

test('the period tally counts each kind separately', () => {
  const t = queueTotals([
    rec({ id: 'r1' }),
    rec({ id: 'r2', hr_status: 'ACCEPTED' }),
    rec({ id: 'r3', kind: 'RECOGNITION', training_name: 'Bonus' }),
    rec({ id: 'r4', employee_id: O, kind: 'RECOGNITION', training_name: 'Promotion',
          hr_status: 'DECLINED' }),
  ])
  assert.equal(t.training.total, 2)
  assert.equal(t.training.pending, 1)
  assert.equal(t.recognition.total, 2)
  assert.equal(t.recognition.pending, 1)
  assert.equal(t.recognition.declined, 1)
})

test('the by-employee map keys everybody who was asked about', () => {
  const m = chainAsksByEmployee([rec(), rec({ id: 'r2', employee_id: O })],
                                [pipRow({ id: 'p9', employee_id: 'emp-3' })])
  assert.deepEqual(Object.keys(m).sort(), ['emp-1', 'emp-2', 'emp-3'])
  assert.equal(m['emp-3'].pips.length, 1)
  assert.equal(m['emp-3'].training.length, 0)
  // Nobody appears twice, and nobody's asks leak into somebody else's entry.
  assert.equal(m['emp-1'].training.length, 1)
})

test('a name is resolved when known and left null when not', () => {
  // A role with no name reads as "RM_L1 asked for this", which is usable.
  // A wrong name would not be.
  const a = chainAsks(E, [rec()], [pipRow()], { 'mgr-1': 'Rohit Sharma' })
  assert.equal(a.training[0].byName, 'Rohit Sharma')
  assert.equal(a.pips[0].byName, 'Rohit Sharma')
  const b = chainAsks(E, [rec()], [], {})
  assert.equal(b.training[0].byName, null)
  assert.equal(b.training[0].byRole, 'RM_L1')
})

// ── the wiring ───────────────────────────────────────────────────────────
//
// Source-matched: Node cannot load .tsx, and these are the parts where a
// correct rule gets attached to the wrong thing.

const PAGE = read('app/dashboard/pms/page.tsx')
const TABS = read('components/pms/AdminTabs.tsx')

test('the PIP tab is fed real rows, not a constant', () => {
  // IT WAS A HARDCODED EMPTY ARRAY. Raters could raise a request and the tab
  // whose entire job is reviewing them always said "No PIP requests" — a
  // write with no reader, which is invisible precisely because the screen
  // renders perfectly.
  assert.ok(!/<PipTab queue=\{PIP_QUEUE\}/.test(PAGE),
    'the PIP tab still renders a hardcoded queue')
  assert.match(PAGE, /<PipTab queue=\{pipQueue\} \/>/)
  assert.match(PAGE, /setPipQueue\(pipRows\.map\(/,
    'the queue is never filled from pms_pip')
  assert.match(PAGE, /from\('pms_pip'\)/, 'pms_pip is never read')
})

test('the PIP state shown to HR is derived, not a raw column', () => {
  assert.match(PAGE, /pip: pipFromRow\(r\)/,
    'a raw hr_status is being passed as the lifecycle state')
})

test('the publish card shows what the chain asked for', () => {
  assert.match(TABS, /<ChainAsksBlock asks=\{asks\?\.\[member\.employeeId\]\}/,
    'the block is not rendered, or not for the picked member')
  // Keyed by the PICKED member, not by the row being mapped — the bug that
  // shows everybody the first person's proposals.
  assert.ok(!/<ChainAsksBlock asks=\{asks\?\.\[r\.employeeId\]\}/.test(TABS))
})

test('the warnings are rendered apart from the faults', () => {
  // Same shape, different meaning: one list stops the button and one does
  // not. Rendering them in one block is how people learn to ignore both.
  assert.match(TABS, /\{warnings\.length > 0 && \(/)
  assert.match(TABS, /None of these stops the publication\./,
    'the non-blocking list does not say it is non-blocking')
  const i = TABS.indexOf('const publishable = !!member && faults.length === 0')
  assert.ok(i > 0, 'the publish gate moved')
  // Computed AFTER the gate, so it cannot be folded into it by a later edit
  // without the edit being obvious.
  assert.ok(TABS.indexOf('const warnings = member ? publishWarnings') > i,
    'warnings are computed before the gate, where they can leak into it')
})

test('a decision writes the decision and never the proposal', () => {
  // A rater's words stay a rater's words. HR's agreement is its own column,
  // which is the reason 208 gave these rows a lifecycle instead of filing
  // them as awards.
  const fn = PAGE.slice(PAGE.indexOf('const decideAsk = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.ok(fn.length > 100, 'decideAsk is gone')
  assert.match(fn, /\.update\(\{/)
  for (const col of ['training_name', 'details', 'category', 'recommended_by']) {
    assert.ok(!fn.includes(col), `decideAsk overwrites ${col}, which is the rater's`)
  }
  for (const col of ['hr_status', 'hr_note', 'hr_actioned_by', 'hr_actioned_at']) {
    assert.ok(fn.includes(col), `${col} is not recorded, so the decision has no author`)
  }
  assert.match(fn, /\.eq\('id', id\)/,
    'the update is not pinned to one row')
})

test('accepting a proposal does not award anything', () => {
  // The recognition that reaches the employee is the benefits list HR writes
  // and publishing releases. If acceptance created a benefit row, one click
  // on a rater's proposal would put an award in front of an employee, and
  // there would be no way to accept the intent while wording it differently.
  const fn = PAGE.slice(PAGE.indexOf('const decideAsk = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.ok(!/pms_additional_benefits/.test(fn),
    'accepting a proposal writes an award')
  assert.ok(!/visible_to_employee/.test(fn),
    'accepting a proposal changes what the employee can see')
})

test('the read survives 210 not having run', () => {
  // Selecting a column PostgREST does not know about fails the WHOLE
  // request with a 400 — which would empty the publish workspace, not just
  // this block. So the narrow select is retried without kind.
  assert.match(PAGE, /recsTry\.error/,
    'a 400 on the kind column is not handled')
  assert.match(PAGE, /recSel\.replace\('kind, ', ''\)/,
    'the retry does not drop the column that caused the failure')
})

test('a reload follows the decision rather than a hand-patched copy', () => {
  // The same row feeds the badge in the table, the counts and the warnings.
  // Three hand-updated copies is how one of them goes stale.
  const fn = PAGE.slice(PAGE.indexOf('const decideAsk = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.match(fn, /\n\s*load\(\)/, 'nothing refreshes after a decision')
})

test('the decision is offered only to whoever owns this step', () => {
  // canRunPostFinal already decides who writes the feedback and publishes.
  // Deciding a proposal is the same authority, so it reuses the same test
  // rather than inventing a second answer that could disagree with it.
  assert.match(PAGE, /onDecideAsk=\{canRunPostFinal \? decideAsk : undefined\}/,
    'anybody who can open the tab can accept a recognition proposal')
})
