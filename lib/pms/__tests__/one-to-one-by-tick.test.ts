// lib/pms/__tests__/one-to-one-by-tick.test.ts
//
// Requested: the one-to-one log should be automatic — a mandatory checkbox at
// every stage saying the discussion happened, which records the log when it is
// ticked, instead of a separate form. Confirmed: all three manager stages
// (RM L1, RM L2, HOD) get one, and manager == RM L1.
//
// A CHANGE OF MECHANISM, NOT OF RULE. Both gates still need two
// acknowledgements. What goes away is the form standing between the intent and
// the record — which is why FINAL_REVIEW rows existed for 7 of 395 enrolments
// and why a HOD could be blocked by a gate only the employee could open.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoLogFor, CONFIRM_STAGES, CONFIRM_LABEL, CONFIRM_SHORT, CONFIRM_WHY,
         DISCUSSION_TYPES } from '../oneToOne.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PERF = read('components/ess/Performance.tsx')
const MGR = read('components/pms/ManagerTabs.tsx')
const EMP = read('components/pms/EmployeeTabs.tsx')

test('the employee and RM L1 land on the SAME row', () => {
  // One conversation, two acknowledgements — which is exactly what
  // pms_lock_kras counts. A second row would leave both halves
  // unacknowledged and the weightage permanently unlockable.
  const emp = autoLogFor('EMPLOYEE')
  const l1 = autoLogFor('RM_L1')
  assert.equal(emp.discussion_type, 'KRA_SETTING')
  assert.equal(l1.discussion_type, 'KRA_SETTING')
  assert.equal(emp.manager_role, l1.manager_role)
  // Opposite sides of it.
  assert.equal(emp.side, 'employee')
  assert.equal(l1.side, 'manager')
})

test('manager and RM L1 are the same stage, not two', () => {
  // There is no separate 'MANAGER' stage: the employee's reporting manager IS
  // RM L1, and a second concept would mean two rows for one conversation.
  assert.deepEqual([...CONFIRM_STAGES], ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD'])
  assert.ok(!CONFIRM_STAGES.includes('MANAGER' as never))
})

test('the later rungs get their own rows, correctly attributed', () => {
  const l2 = autoLogFor('RM_L2')
  const hod = autoLogFor('HOD')
  assert.equal(l2.manager_role, 'RM_L2')
  assert.equal(hod.manager_role, 'HOD')
  assert.equal(hod.discussion_type, 'FINAL_REVIEW')
  // ADHOC is the only remaining type that fits an L2's review: the schema
  // allows KRA_SETTING, MID_PERIOD, FINAL_REVIEW and ADHOC, and MID_PERIOD
  // would be a lie about when it happened.
  assert.equal(l2.discussion_type, 'ADHOC')
  assert.ok(DISCUSSION_TYPES.includes(l2.discussion_type))
})

test('manager_role is set for every stage — it never was before', () => {
  // The column has existed since 066 and NOTHING ever wrote it: all 13 rows in
  // the live database say RM_L1 because that is the default, including
  // FINAL_REVIEW rows a HOD logged. A log that cannot say which stage it
  // belongs to is most of the way to not being a log.
  for (const s of CONFIRM_STAGES) {
    const spec = autoLogFor(s)
    assert.ok(['RM_L1', 'RM_L2', 'HOD'].includes(spec.manager_role), `${s}`)
    // discussion_points is NOT NULL, so a tick has to supply one.
    assert.ok(spec.discussion_points.length > 30, `${s} has no usable record text`)
  }
})

test('every stage has a label and a reason, in the first person', () => {
  for (const s of CONFIRM_STAGES) {
    assert.ok(CONFIRM_LABEL[s]?.startsWith('I have'),
      `${s}: the label is not what the person is asserting`)
    assert.ok(CONFIRM_WHY[s]?.length > 20, `${s} has no explanation`)
  }
})

// ── the wiring ───────────────────────────────────────────────────────────

test('the employee cannot submit without ticking it', () => {
  // ANCHORED ON THE `disabled` EXPRESSION, not on the condition anywhere in
  // the file. The condition appears twice — once gating the button and once
  // choosing its label — so a bare match passed with the gate removed and
  // only the label left. Found by mutation: deleting the gate did not fail
  // this test until it was anchored.
  const btn = EMP.slice(EMP.indexOf('{(!locked || !selfSubmitted) && (\n          <div className="btnrow">'))
  const dis = btn.slice(btn.indexOf('disabled={'), btn.indexOf('onClick={onSubmit}'))
  assert.ok(dis.length > 20, 'could not isolate the submit button\'s disabled expression')
  assert.match(dis, /oneToOneRequired && !oneToOneAlready && !confirmOneToOne/,
    'the submit button is not gated on the confirmation')
  assert.match(EMP, /Confirm the one-to-one above first/,
    'the button does not say what is missing')
  // And it must not be demanded where the policy does not ask for the
  // conversation at all.
  assert.match(EMP, /oneToOneRequired && !oneToOneAlready && onConfirmOneToOne/,
    'the checkbox renders regardless of policy')
  assert.match(PERF, /oneToOneRequired=\{policy\?\.one_to_one_mandatory !== false\}/,
    'the requirement is not read from the policy')
})

test('a manager cannot approve without ticking it', () => {
  assert.match(MGR, /const mayApprove = alreadyConfirmed \|\| !!confirmed\[id\]/,
    'approval is not gated on the confirmation')
  assert.match(MGR, /disabled=\{!onApprove \|\| !ratingOk \|\| !mayApprove\}/)
  assert.match(MGR, /Confirm the one-to-one first/)
  // Already-confirmed rows show it ticked and disabled, so a manager can see
  // the confirmation stands rather than wondering whether it saved.
  assert.match(MGR, /disabled=\{alreadyConfirmed\}/)
})

test('rejecting does NOT require a confirmation', () => {
  // Sending a set back with a remark is not a claim that a conversation
  // happened, and demanding one would stop a manager returning an obviously
  // wrong set until they had held a meeting about it.
  const cell = MGR.slice(MGR.indexOf('if (rejecting[id])'),
                         MGR.indexOf('if (rejecting[id])') + 1800)
  assert.ok(cell.length > 500, 'could not isolate the rejection branch')
  assert.ok(!/mayApprove|confirmed\[id\]/.test(cell),
    'the rejection path is gated on the one-to-one confirmation')
})

test('each stage is recorded as its own stage', () => {
  for (const s of ["'EMPLOYEE'", "'RM_L1'", "'HOD'"]) {
    assert.ok(PERF.includes(`stage: ${s}`), `nothing records stage ${s}`)
  }
  assert.match(PERF, /stage: myRung/,
    'the chain approval does not record the rung it is acting as')
})

// ── the detailed KRA view ────────────────────────────────────────────────

test('L1, L2 and the HOD can read the form the employee filled', () => {
  assert.match(MGR, /export function KraDetail/, 'there is no detailed view')
  assert.match(MGR, /View their form/, 'nothing opens it')
  assert.match(PERF, /const openKras = useCallback/, 'nothing loads it')
  // The employee's OWN rating is the half a manager most needs before
  // approving — rater_role SELF, not their own rating of them.
  assert.match(PERF, /\.eq\('rater_role', 'SELF'\)/,
    'the detail view does not load the employee\'s self rating')
  // Loaded on demand: a manager with 30 reportees must not pull 30 KRA sets
  // to render a table of counts.
  assert.ok(!/select\('id,seq_no,kra_title[\s\S]{0,400}\.in\('employee_id'/.test(PERF),
    'the KRA detail is loaded for the whole roster rather than on demand')
})

test('the detailed view is read-only', () => {
  // Editing a reportee's KRA changes what somebody is measured against after
  // they agreed it. That belongs behind its own control, not inside a view
  // opened to have a look — the chain's edit path is the send-back.
  const v = MGR.slice(MGR.indexOf('export function KraDetail'),
                      MGR.indexOf('// ── §4.3 Rate My Team'))
  assert.ok(v.length > 800, 'could not isolate the detail view')
  for (const bad of ['<input', '<textarea', '<select', 'onChange']) {
    assert.ok(!v.includes(bad), `the detail view offers ${bad}`)
  }
})

// ── the checkbox has to fit where it is put ──────────────────────────────

test('the queue uses the SHORT label, not the full sentence', () => {
  // REPORTED: the checkbox content overflowed. CONFIRM_LABEL is a full
  // sentence — right on a form, and in the action column of a ten-column
  // queue it forced the table wider than its container, so the whole table
  // scrolled sideways.
  // Anchored on the label element, not on a fixed window after mayApprove —
  // the first version sliced 3000 characters from that declaration and the
  // JSX it was looking for sits further down, so it failed against correct
  // code.
  const i = MGR.indexOf('title={CONFIRM_LABEL[myStage as ConfirmStage]}')
  assert.ok(i > 0, 'the full assertion is no longer available as the title')
  const cell = MGR.slice(i, i + 900)
  assert.match(cell, /CONFIRM_SHORT\[myStage as ConfirmStage\]/,
    'the queue renders the full sentence in a table cell')
  // Short enough to mean it: a label over ~24 characters defeats the purpose.
  for (const [k, v] of Object.entries(CONFIRM_SHORT)) {
    assert.ok(v.length <= 24, `CONFIRM_SHORT.${k} is ${v.length} chars — too long for a cell`)
  }
})

test('both checkbox labels can actually wrap', () => {
  // THE REAL CAUSE, in both places: a flex child will not shrink below its
  // content's intrinsic width without min-width: 0, so a long sentence pushes
  // its container instead of breaking. Neither label had it.
  for (const [file, src] of [['ManagerTabs', MGR], ['EmployeeTabs', EMP]] as const) {
    const i = src.indexOf("alignItems: 'flex-start'")
    assert.ok(i > 0, `${file}: could not find the checkbox label`)
    const label = src.slice(i, i + 700)
    assert.match(label, /minWidth: 0/,
      `${file}: the label's text is a flex child with no minWidth: 0, so it cannot wrap`)
    assert.match(label, /flex: '0 0 auto'/,
      `${file}: the checkbox itself is not pinned, so it will squash`)
  }
})

test('the action cell is bounded, not merely given a minimum', () => {
  // minWidth alone lets the cell grow without limit, which is what widened
  // the table. A width caps it and lets the text wrap inside.
  // BOTH action cells. The first attempt at this fix replaced by string and
  // the two cells turned out to have different indentation, so it bounded the
  // Finalise queue's cell and left the one actually holding the checkbox
  // unbounded — the reported bug, untouched, with a passing-looking edit.
  assert.ok(!/minWidth: 180/.test(MGR),
    'an action cell still only sets a minimum width, so it can widen the table')
  const bounded = MGR.match(/display: 'grid', gap: 5, width: 200, maxWidth: '100%'/g) ?? []
  assert.equal(bounded.length, 2,
    `expected both action cells bounded, found ${bounded.length}`)
})

test('no block element is nested inside an inline one', () => {
  // The employee's label had a <div> inside a <span> — invalid markup that
  // browsers paper over differently, and one of the ways it differs is layout.
  const i = EMP.indexOf("alignItems: 'flex-start'")
  const label = EMP.slice(i, i + 700)
  assert.ok(!/<span>\s*\n?\s*<b>[\s\S]{0,200}<div/.test(label),
    'a div is nested inside a span in the checkbox label')
})

// ── the KRA detail panel fits its container ─────────────────────────────

test('every free-text field in the detail panel can break', () => {
  // REPORTED and then MEASURED IN A BROWSER rather than reasoned about: at
  // 1432px the panel is clean; below 700px it gives way, and at 360px it
  // escaped its container by 160px. Every offender was the same thing — a
  // long UNBROKEN token with the default overflow-wrap: normal, which has
  // nowhere legal to break:
  //
  //   a snake_case title   Reconciliation_automation_programme_phase_two…
  //   a camelCase KPI      ReconciliationBreaksClosedWithinSLAPercentage…
  //   a URL in achievement https://internal.example.com/reports/…
  //
  // None contrived: the live rows top out at 48 characters WITH spaces, which
  // is why it did not show on real data at desktop width, and pasting a
  // dashboard link into "what I delivered" is an ordinary thing to do.
  const v = MGR.slice(MGR.indexOf('export function KraDetail'),
                      MGR.indexOf('// ── §4.3 Rate My Team'))
  assert.ok(v.length > 800, 'could not isolate the detail view')

  // `anywhere`, not `break-word`: break-word does not shrink an element's
  // intrinsic minimum, so a flex or grid child still pushes its parent.
  assert.match(MGR, /const BREAK = \{ overflowWrap: 'anywhere' as const, minWidth: 0 \}/,
    'there is no breakable-text style, or it uses break-word')

  // Every field the employee can type into has to carry it. A missed one is
  // the whole bug back.
  // CHECKED FORWARDS from each BREAK element, not backwards from the field.
  // Looking backwards found the wrong tag for anything inside a conditional:
  // `{l.selfComment && <span style={BREAK}>` puts the field name BEFORE the
  // element that carries the style, so the test failed against correct code.
  const covered = [...v.matchAll(/style=\{BREAK\}>([\s\S]{0,80})/g)]
    .map(m => m[1]).join(' | ')
  for (const field of ['l.title', 'l.kpi', 'l.target', 'l.achievement', 'l.selfComment']) {
    assert.ok(v.includes(field), `${field} is not rendered at all`)
    assert.ok(covered.includes(field),
      `${field} is rendered without BREAK, so a long token will push the panel`)
  }
})

test('the rating row wraps rather than pushing', () => {
  // The self comment sits in a flex row beside the rating. Without wrapping,
  // a sentence there widens the card.
  const v = MGR.slice(MGR.indexOf('export function KraDetail'),
                      MGR.indexOf('// ── §4.3 Rate My Team'))
  assert.match(v, /display: 'flex', gap: 10,\s*\n?\s*alignItems: 'baseline', flexWrap: 'wrap'/,
    'the rating row cannot wrap')
})

test('the preview harness carries content harder than the real data', () => {
  // A preview case is only worth having if it is harder than production. The
  // live maximum is a 48-character field with spaces; these are the shapes
  // that actually break layout.
  const prev = read('app/pms-preview/page.tsx')
  assert.match(prev, /<KraDetail key="kd"/, 'the detail panel has no preview case')
  assert.match(prev, /Reconciliation_automation_programme_phase_two/,
    'no long unbroken snake_case token in the fixture')
  assert.match(prev, /ReconciliationBreaksClosedWithinSLAPercentage/,
    'no long unbroken camelCase token in the fixture')
  assert.match(prev, /https:\/\/internal\.example\.com/,
    'no URL in the fixture — the commonest real cause')
})
