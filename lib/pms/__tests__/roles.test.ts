// Spec §3, §4 and §5 — the rules the employee, RM and HOD surfaces enforce.
// Each of these decides whether a button is available, so getting one wrong
// either blocks somebody from their own appraisal or lets a step be skipped.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkKras, canAdd, canDelete, meter, suggestSplit,
         CATEGORIES, type Kra } from '../kra.ts'
import { canLockWeightage, canPublishResult, ackState, waitingOn, logRows,
         type Log } from '../oneToOne.ts'
import { score, gap, byCategory, bandFor, bandForScore, checkFeedback,
         canManagerRate, DEFAULT_BANDS, type Line } from '../scoring.ts'
import { teamQueue, finaliseQueue, teamStats, distribution,
         type TeamMember } from '../team.ts'
import { DEFAULT_RULES } from '../cycle.ts'

const kra = (seq: number, w: number, cat = 'BUSINESS'): Kra => ({
  seq_no: seq, kra_title: `KRA ${seq}`, kpi_metric: 'm', target_value: 't',
  category: cat as Kra['category'], weightage: w,
})
const four = [kra(1, 25), kra(2, 25), kra(3, 25), kra(4, 25)]

// ── §3.2 the KRA set ─────────────────────────────────────────────────────

test('RULE 3: the total must be exactly 100 — not at least', () => {
  assert.equal(checkKras(four).canSubmit, true)
  assert.equal(checkKras([kra(1, 30), kra(2, 30), kra(3, 30), kra(4, 30)]).canSubmit, false,
    '120 must be refused, not accepted as "more than enough"')
  assert.equal(checkKras([kra(1, 20), kra(2, 20), kra(3, 20), kra(4, 20)]).canSubmit, false)
})

test('the shortfall message names the number and the direction', () => {
  const over = checkKras([kra(1, 40), kra(2, 40), kra(3, 40), kra(4, 40)])
  assert.match(over.faults[0].says, /60 over/)
  assert.match(over.faults[0].says, /take 60 off/i)
  const under = checkKras([kra(1, 10), kra(2, 10), kra(3, 10), kra(4, 10)])
  assert.match(under.faults[0].says, /60 short/)
})

test('RULE 1 and 2: below four and above ten are both refused', () => {
  assert.equal(checkKras([kra(1, 50), kra(2, 50)]).canSubmit, false)
  const eleven = Array.from({ length: 11 }, (_, i) => kra(i + 1, i === 0 ? 10 : 9))
  assert.equal(checkKras(eleven).canSubmit, false)
})

test('RULE 1 is enforced at the DELETE, not reported after it', () => {
  // Letting the row go and then complaining leaves somebody with a set they
  // cannot submit and no obvious way back — the row is gone.
  assert.equal(canDelete(four).allowed, false)
  assert.match(canDelete(four).reason ?? '', /minimum/i)
  assert.equal(canDelete([...four, kra(5, 0)]).allowed, true)
})

test('RULE 2 is enforced at the ADD', () => {
  const ten = Array.from({ length: 10 }, (_, i) => kra(i + 1, 10))
  assert.equal(canAdd(ten).allowed, false)
  assert.match(canAdd(ten).reason ?? '', /maximum/i)
  assert.equal(canAdd(four).allowed, true)
})

test('RULE 4: a KRA below the per-KRA minimum is flagged by row number', () => {
  const c = checkKras([kra(1, 93), kra(2, 3), kra(3, 2), kra(4, 2)])
  assert.deepEqual(c.thin, [2, 3, 4])
  assert.ok(c.faults.some(f => f.seq === 2 && /below the minimum/i.test(f.says)))
  assert.equal(c.canSubmit, false)
})

test('a blank row is a fault, and is not silently counted as a KRA', () => {
  const blank: Kra = { ...kra(4, 25), kra_title: '   ' }
  const c = checkKras([kra(1, 25), kra(2, 25), kra(3, 25), blank])
  assert.deepEqual(c.blank, [4])
  assert.equal(c.canSubmit, false)
})

test('the meter never claims to be full while the total is wrong', () => {
  assert.equal(meter(checkKras(four)).tone, 'good')
  assert.equal(meter(checkKras([kra(1, 20), kra(2, 20), kra(3, 20), kra(4, 20)])).tone, 'warn')
  const over = meter(checkKras([kra(1, 40), kra(2, 40), kra(3, 40), kra(4, 40)]))
  assert.equal(over.tone, 'bad')
  assert.equal(over.pct, 100, 'an over-full bar must not render past its track')
})

test('the meter says in words what the colour says', () => {
  // Colour is never the only signal — this is the text a screen reader gets.
  for (const set of [four, [kra(1, 10)], [kra(1, 200)]]) {
    assert.match(meter(checkKras(set)).says, /\d/)
  }
})

test('an even split always totals exactly 100, for every legal count', () => {
  for (let n = DEFAULT_RULES.minKra; n <= DEFAULT_RULES.maxKra; n++) {
    assert.equal(suggestSplit(n).reduce((a, b) => a + b, 0), DEFAULT_RULES.totalWeightage,
      `${n} KRAs did not split to 100`)
  }
})

test('every category in the spec is offered', () => {
  for (const c of ['BUSINESS', 'PROCESS', 'PEOPLE', 'CUSTOMER', 'COMPLIANCE', 'LEARNING']) {
    assert.ok((CATEGORIES as readonly string[]).includes(c), `${c} missing`)
  }
})

// ── §3.3 the one-to-one gates ────────────────────────────────────────────

const logOf = (t: Log['discussion_type'], e: boolean, m: boolean): Log =>
  ({ discussion_type: t, discussion_date: '2026-10-05', employee_ack: e, manager_ack: m })

test('RULE 5: one acknowledgement is not enough to lock the weightage', () => {
  assert.equal(canLockWeightage([]).open, false)
  assert.equal(canLockWeightage([logOf('KRA_SETTING', true, false)]).open, false,
    'employee alone must not lock it')
  assert.equal(canLockWeightage([logOf('KRA_SETTING', false, true)]).open, false,
    'a manager ticking their own box is a manager asserting a conversation happened')
  assert.equal(canLockWeightage([logOf('KRA_SETTING', true, true)]).open, true)
})

test('the wrong TYPE of discussion does not open the gate', () => {
  // A mid-period chat, however well acknowledged, is not the KRA-setting one.
  assert.equal(canLockWeightage([logOf('MID_PERIOD', true, true)]).open, false)
  assert.equal(canPublishResult([logOf('KRA_SETTING', true, true)]).open, false)
  assert.equal(canPublishResult([logOf('FINAL_REVIEW', true, true)]).open, true)
})

test('a shut gate names the side that has not acknowledged', () => {
  assert.match(canLockWeightage([logOf('KRA_SETTING', true, false)]).because, /manager/i)
  assert.match(canLockWeightage([logOf('KRA_SETTING', false, true)]).because, /employee/i)
  assert.match(canLockWeightage([]).because, /no kra setting discussion/i)
})

test('ackState and waitingOn agree with each other', () => {
  assert.equal(ackState(logOf('ADHOC', true, true)), 'both')
  assert.equal(waitingOn(logOf('ADHOC', true, true)), null)
  assert.equal(ackState(logOf('ADHOC', false, false)), 'neither')
  assert.ok(waitingOn(logOf('ADHOC', false, false)))
})

test('a mandatory discussion that has not happened is still a row', () => {
  // Its absence has to be VISIBLE. Simply not listing it reads as "nothing
  // outstanding", which is the opposite of what it means.
  const rows = logRows([logOf('MID_PERIOD', true, true)])
  assert.equal(rows.filter(r => r.placeholder).length, 2)
  assert.ok(rows.some(r => r.discussion_type === 'KRA_SETTING' && r.placeholder))
  assert.ok(rows.some(r => r.discussion_type === 'FINAL_REVIEW' && r.placeholder))
})

// ── §3.5 / §3.6 scoring ──────────────────────────────────────────────────

const line = (id: string, w: number, self: number | null, final: number | null,
              cat = 'BUSINESS'): Line =>
  ({ goalId: id, title: id, category: cat as Line['category'], weightage: w, self, final })

test('the weighted score weights by weightage, not by row count', () => {
  const lines = [line('a', 90, 5, 5), line('b', 10, 1, 1)]
  assert.equal(score(lines, 'self'), 4.6)   // not 3, which a plain mean gives
})

test('an unrated KRA is excluded, never counted as zero', () => {
  // Counting it as zero makes a half-finished appraisal read as a terrible
  // one, and that number lands on a dashboard beside somebody's name.
  const lines = [line('a', 50, 4, null), line('b', 50, null, null)]
  assert.equal(score(lines, 'self'), 4)
  assert.equal(score(lines, 'final'), null, 'nothing rated at all must be null, not 0')
})

test('RULE: a gap of two or more is major, and the wording blames neither side', () => {
  assert.equal(gap(5, 3).flag, 'MAJOR_GAP')
  assert.equal(gap(3, 5).flag, 'MAJOR_GAP', 'a manager rating higher is just as much a gap')
  assert.equal(gap(4, 3).flag, 'MINOR_GAP')
  assert.equal(gap(4, 4).flag, 'ALIGNED')
  assert.doesNotMatch(gap(5, 3).says, /over-?rated|overestimat/i)
})

test('a gap needs both numbers before it says anything', () => {
  assert.equal(gap(4, null).delta, null)
  assert.equal(gap(null, 4).flag, 'ALIGNED')
  assert.match(gap(null, null).says, /not enough/i)
})

test('a category nobody was measured on is omitted, not shown at zero', () => {
  const cats = byCategory([line('a', 100, 4, 4, 'PEOPLE')])
  assert.equal(cats.length, 1)
  assert.equal(cats[0].category, 'PEOPLE')
})

test('RULE 10: improvement feedback is mandatory at 2 and below', () => {
  for (const r of [1, 2]) {
    assert.equal(bandFor(r)!.improvementMandatory, true)
    const c = checkFeedback(r, { appreciation: 'x'.repeat(200) })
    assert.equal(c.ok, false)
    assert.ok(c.faults.some(f => /improvement feedback is required/i.test(f)))
  }
  for (const r of [3, 4, 5]) assert.equal(bandFor(r)!.improvementMandatory, false)
})

test('RULE 11: the low bands demand MORE words, not fewer', () => {
  // A 5 can stand on "consistently excellent". A 1 is the rating somebody may
  // have to defend, and "needs to improve" defends nothing.
  const low = DEFAULT_BANDS.find(b => b.value === 1)!
  const high = DEFAULT_BANDS.find(b => b.value === 5)!
  assert.ok(low.minCommentChars > high.minCommentChars)
  assert.equal(checkFeedback(1, { improvement: 'too short' }).ok, false)
  assert.equal(checkFeedback(1, { improvement: 'x'.repeat(low.minCommentChars) }).ok, true)
})

test('no feedback at all is a fault even at a good rating', () => {
  assert.equal(checkFeedback(5, {}).ok, false)
  assert.equal(checkFeedback(5, { appreciation: 'x'.repeat(60) }).ok, true)
})

test('a score maps to a band by rounding, so 3.5 is not silently a 3', () => {
  assert.equal(bandForScore(3.5)!.value, 4)
  assert.equal(bandForScore(3.4)!.value, 3)
  assert.equal(bandForScore(null), null)
})

test('RULE 6: a manager cannot rate before the self rating is in', () => {
  assert.equal(canManagerRate(false).open, false)
  assert.match(canManagerRate(false).because, /anchor/i)
  assert.equal(canManagerRate(true).open, true)
})

// ── §4.1 / §5.1 the queues ───────────────────────────────────────────────

const member = (over: Partial<TeamMember> & { employeeId: string; name: string }): TeamMember => ({
  code: over.employeeId, kraCount: 6, totalWeightage: 100, oneToOneDone: true,
  selfSubmitted: true, selfScore: 4, rmL1Score: null, rmL2Score: null,
  finalRating: null, finalised: false, ...over,
})

const TODAY = '2026-09-04'

test('RULE §8: notice first, then exited, and the active rows below both', () => {
  // §5.1 wants exit AND notice on top — both have a date the queue cannot
  // outrun. Notice outranks exited because their rating can still be given;
  // once somebody has left, the record is heading for read-only either way.
  // An earlier version of this test asserted exited sorted LAST, which
  // contradicted the spec it was meant to be checking.
  const rows = teamQueue([
    member({ employeeId: 'a', name: 'Active' }),
    member({ employeeId: 'x', name: 'Exited', flagOverride: 'EXITED' }),
    member({ employeeId: 'n', name: 'Notice', flagOverride: 'NOTICE_PERIOD' }),
    member({ employeeId: 'j', name: 'Joiner', flagOverride: 'NEW_JOINER' }),
  ], TODAY)
  assert.deepEqual(rows.map(r => r.member.employeeId), ['n', 'x', 'a', 'j'])
})

test('a notice row carries the reason it is at the top, not just a colour', () => {
  const rows = teamQueue([member({
    employeeId: 'n', name: 'N', flagOverride: 'NOTICE_PERIOD',
    dateOfLeaving: '2026-09-20',
  })], TODAY)
  assert.match(rows[0].priorityNote ?? '', /16 days/)
  assert.match(rows[0].priorityNote ?? '', /locks/i)
})

test('the database flag wins over one derived from two dates', () => {
  // vw_pms_employment_flag sees columns this client never selected. A row
  // reading ACTIVE on one screen and NOTICE on another is worse than either.
  const rows = teamQueue([member({
    employeeId: 'a', name: 'A', flagOverride: 'NOTICE_PERIOD',
  })], TODAY)
  assert.equal(rows[0].flag, 'NOTICE_PERIOD')
})

test('each row names the ONE next thing, in the order the flow requires', () => {
  const cases: [Partial<TeamMember>, RegExp][] = [
    [{ kraCount: 0 }, /no kras/i],
    [{ totalWeightage: 80 }, /total 80.*not 100|totals? 80/i],
    [{ oneToOneDone: false }, /one-to-one/i],
    [{ selfSubmitted: false, selfScore: null }, /self rating/i],
    [{ rmL1Score: null }, /your rating is owed/i],
    [{ rmL1Score: 4, rmL2Score: null }, /rm l2/i],
    [{ rmL1Score: 4, rmL2Score: 4 }, /finalis/i],
  ]
  for (const [patch, want] of cases) {
    const r = teamQueue([member({ employeeId: 'e', name: 'E', ...patch })], TODAY)[0]
    assert.match(r.next, want, `wrong next step for ${JSON.stringify(patch)}`)
  }
})

test('a finalised row asks nothing further of anybody', () => {
  const r = teamQueue([member({ employeeId: 'e', name: 'E', finalised: true,
                               finalRating: 4 })], TODAY)[0]
  assert.equal(r.actionable, false)
})

test('RULE 7: finalise is shut while RM L2 is pending, and says to nudge them', () => {
  const rows = finaliseQueue([member({ employeeId: 'e', name: 'E', rmL1Score: 4 })], TODAY,
    { role: 'HOD', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'RM1_RM2_HOD' })
  assert.equal(rows[0].canFinalise, false)
  assert.match(rows[0].insteadDo ?? '', /nudge/i)
})

test('...but a chain with no RM L2 finalises without waiting for one', () => {
  const rows = finaliseQueue([member({ employeeId: 'e', name: 'E', rmL1Score: 4 })], TODAY,
    { role: 'HOD', chain: 'SELF_RM1_HOD', whoCanFinalise: 'RM1_RM2_HOD' })
  assert.equal(rows[0].canFinalise, true, 'this row would otherwise wait forever')
})

test('a role the policy did not appoint is told WHO can, not just "no"', () => {
  const rows = finaliseQueue([member({ employeeId: 'e', name: 'E', rmL1Score: 4, rmL2Score: 4 })],
    TODAY, { role: 'RM_L1', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'HOD_ONLY' })
  assert.equal(rows[0].canFinalise, false)
  assert.match(rows[0].insteadDo ?? '', /HOD/)
  // and the two shut-reasons must not be collapsed into one greyed-out button
  assert.doesNotMatch(rows[0].insteadDo ?? '', /nudge/i)
})

test('nothing can be finalised before a self rating exists', () => {
  const rows = finaliseQueue([member({ employeeId: 'e', name: 'E', selfSubmitted: false,
                                       selfScore: null, rmL1Score: 4, rmL2Score: 4 })],
    TODAY, { role: 'HOD', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'RM1_RM2_HOD' })
  assert.equal(rows[0].canFinalise, false)
  assert.match(rows[0].insteadDo ?? '', /chain has not started/i)
})

test('when NOTHING has started, the block reported is that — not "nudge RM L2"', () => {
  // The case a screenshot caught and the tests had missed: an employee with
  // no self rating also has no RM L2 rating, so both blocks are true at once.
  // Reporting the RM L2 one sends a HOD to chase somebody who is themselves
  // blocked behind rule 6, and the real problem goes unnamed.
  const rows = finaliseQueue([member({
    employeeId: 'new', name: 'New', selfSubmitted: false, selfScore: null,
    rmL1Score: null, rmL2Score: null,
  })], TODAY, { role: 'HOD', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'RM1_RM2_HOD' })
  assert.equal(rows[0].canFinalise, false)
  assert.match(rows[0].insteadDo ?? '', /chain has not started/i)
  assert.doesNotMatch(rows[0].insteadDo ?? '', /nudge/i)
})

test('a role check still outranks everything — it is not the HOD\'s move at all', () => {
  const rows = finaliseQueue([member({
    employeeId: 'e', name: 'E', selfSubmitted: false, selfScore: null, rmL2Score: null,
  })], TODAY, { role: 'RM_L1', chain: 'SELF_RM1_RM2_HOD', whoCanFinalise: 'HOD_ONLY' })
  assert.match(rows[0].insteadDo ?? '', /your role cannot finalise/i)
})

test('team stats count the notice cases separately from everything else', () => {
  const rows = teamQueue([
    member({ employeeId: 'a', name: 'A', rmL1Score: null }),
    member({ employeeId: 'n', name: 'N', flagOverride: 'NOTICE_PERIOD' }),
    member({ employeeId: 'f', name: 'F', finalised: true, finalRating: 5 }),
  ], TODAY)
  const s = teamStats(rows)
  assert.equal(s.size, 3)
  assert.equal(s.noticePeriod, 1)
  assert.equal(s.finalised, 1)
})

test('the distribution reports every band, including the empty ones', () => {
  const rows = teamQueue([
    member({ employeeId: 'a', name: 'A', finalRating: 4, finalised: true }),
    member({ employeeId: 'b', name: 'B', finalRating: 4, finalised: true }),
  ], TODAY)
  const d = distribution(rows)
  assert.equal(d.length, 5, 'a missing band would read as a band nobody can be given')
  assert.equal(d.find(x => x.rating === 4)!.n, 2)
  assert.equal(d.find(x => x.rating === 1)!.n, 0)
})
