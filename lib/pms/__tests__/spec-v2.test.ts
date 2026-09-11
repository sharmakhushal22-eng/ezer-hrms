// The PMS v2 spec, as tests.
//
// Every rule in the master list (§11), the policy overlap rule (§6.2), the
// employment flags (§8), the bulk-upload blocking errors (§6.4) and the PIP
// state machine (§7). Where the spec states a number, the number is asserted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resolvePolicy, matches, scopeOf, conflicts, previewPeriods,
  PERIODS_PER_YEAR, SCOPES, type Policy,
} from '../policy.ts'
import {
  flagFor, daysToLwd, queuePriority, actionRequired, FLAG_MEANING, FLAG_LABEL,
} from '../employment.ts'
import { checkUpload, summarise, TEMPLATE_COLUMNS, ERROR_TEXT } from '../upload.ts'
import { canTransition, nextStatus, whatNext, STATUS_LABEL, type Pip } from '../pip.ts'
import { kraSetValid, DEFAULT_RULES } from '../cycle.ts'

// ═══ §6.2 POLICY OVERLAP ═════════════════════════════════════════════════

const pol = (o: Partial<Policy>): Policy => ({
  id: o.id ?? 'p', name: o.name ?? 'P', frequency: o.frequency ?? 'QUARTERLY',
  isActive: o.isActive ?? true, minKra: 4, maxKra: 10, totalWeightage: 100,
  minWeightagePerKra: 5, whoCanFinalise: 'RM1_RM2_HOD', ...o,
})

test('the four scopes are ordered narrowest first — the index IS the precedence', () => {
  assert.deepEqual([...SCOPES], ['location', 'grade', 'department', 'all'])
})

test('scopeOf reads the narrowest dimension a policy constrains', () => {
  assert.equal(scopeOf(pol({ locationId: 'L1', departmentId: 'D1' })), 'location')
  assert.equal(scopeOf(pol({ grades: ['M6'], departmentId: 'D1' })), 'grade')
  assert.equal(scopeOf(pol({ departmentId: 'D1' })), 'department')
  assert.equal(scopeOf(pol({})), 'all')
})

test('THE OVERLAP RULE: location beats grade beats department beats all', () => {
  const all = pol({ id: 'a', name: 'Standard', frequency: 'QUARTERLY' })
  const dept = pol({ id: 'd', name: 'Sales Monthly', frequency: 'MONTHLY', departmentId: 'SALES' })
  const grade = pol({ id: 'g', name: 'Leadership', frequency: 'HALF_YEARLY', grades: ['M6'] })
  const loc = pol({ id: 'l', name: 'Pune Plant', frequency: 'ANNUAL', locationId: 'PUNE' })
  const who = { locationId: 'PUNE', grade: 'M6', departmentId: 'SALES' }

  assert.equal((resolvePolicy([all, dept, grade, loc], who) as any).policy.id, 'l')
  assert.equal((resolvePolicy([all, dept, grade], who) as any).policy.id, 'g')
  assert.equal((resolvePolicy([all, dept], who) as any).policy.id, 'd')
  assert.equal((resolvePolicy([all], who) as any).policy.id, 'a')
})

test('RULE 14: exactly one active policy — a tie is refused, never guessed', () => {
  // Two policies of equal specificity is a configuration mistake. Picking one
  // silently hides it until an appraisal routes to the wrong chain.
  const a = pol({ id: 'a', name: 'Sales A', departmentId: 'SALES' })
  const b = pol({ id: 'b', name: 'Sales B', departmentId: 'SALES' })
  const r = resolvePolicy([a, b], { departmentId: 'SALES' })
  assert.equal(r.ok, false)
  assert.match((r as any).reason, /Exactly one must apply/)
  assert.equal((r as any).candidates.length, 2)
})

test('nobody covered is also refused, and says what it means', () => {
  const r = resolvePolicy([pol({ departmentId: 'SALES' })], { departmentId: 'OPS' })
  assert.equal(r.ok, false)
  assert.match((r as any).reason, /cannot be appraised/)
})

test('an inactive policy never matches, however narrow', () => {
  assert.equal(matches(pol({ locationId: 'PUNE', isActive: false }), { locationId: 'PUNE' }), false)
})

test('a dimension a policy does not set is not a filter', () => {
  // "Sales, any location, any grade" must match a Sales person anywhere.
  assert.equal(matches(pol({ departmentId: 'SALES' }),
    { departmentId: 'SALES', locationId: 'X', grade: 'M1' }), true)
})

test('conflicts() finds both faults across a whole company at config time', () => {
  const ps = [pol({ id: 'a', name: 'A', departmentId: 'SALES' }),
              pol({ id: 'b', name: 'B', departmentId: 'SALES' })]
  const c = conflicts(ps, [
    { id: 'e1', departmentId: 'SALES' },
    { id: 'e2', departmentId: 'OPS' },
  ])
  assert.deepEqual(c.contested.map(x => x.id), ['e1'])
  assert.deepEqual(c.uncovered, ['e2'])
})

// ═══ §6.1 PERIOD GENERATION ══════════════════════════════════════════════

test('the frequency counts match the spec exactly', () => {
  assert.deepEqual(PERIODS_PER_YEAR,
    { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, ANNUAL: 1 })
})

test('a quarterly year from April gives four quarters with real month names', () => {
  const p = previewPeriods('QUARTERLY', '2026-04-01')
  assert.equal(p.length, 4)
  assert.equal(p[0].label, 'April to June 2026')
  assert.equal(p[2].label, 'October to December 2026')
  assert.equal(p[3].label, 'January to March 2027')
  assert.equal(p[0].start, '2026-04-01')
  assert.equal(p[0].end, '2026-06-30')
  assert.equal(p[3].end, '2027-03-31')
})

test('no preview label contains a quarter code', () => {
  // The reader should not need to know the FY starts in April.
  for (const f of ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const) {
    for (const p of previewPeriods(f, '2026-04-01')) {
      assert.doesNotMatch(p.label, /\bQ[1-4]\b/, `${f}: ${p.label}`)
    }
  }
})

test('monthly gives twelve, half-yearly two, annual one', () => {
  assert.equal(previewPeriods('MONTHLY', '2026-04-01').length, 12)
  assert.equal(previewPeriods('MONTHLY', '2026-04-01')[0].label, 'April 2026')
  assert.equal(previewPeriods('HALF_YEARLY', '2026-04-01').length, 2)
  const a = previewPeriods('ANNUAL', '2026-04-01')
  assert.equal(a.length, 1)
  assert.equal(a[0].end, '2027-03-31')
})

test('a bad financial-year start returns nothing rather than nonsense dates', () => {
  assert.deepEqual(previewPeriods('QUARTERLY', 'not-a-date'), [])
})

// ═══ §11 RULES 1-4 — THE KRA SET ═════════════════════════════════════════

test('RULES 1-3: min 4, max 10, total exactly 100', () => {
  assert.equal(DEFAULT_RULES.minKra, 4)
  assert.equal(DEFAULT_RULES.maxKra, 10)
  assert.equal(DEFAULT_RULES.totalWeightage, 100)
  assert.equal(DEFAULT_RULES.minWeightagePerKra, 5)

  assert.equal(kraSetValid({ kraCount: 4, weightageTotal: 100 }), true)
  assert.equal(kraSetValid({ kraCount: 10, weightageTotal: 100 }), true)
  assert.equal(kraSetValid({ kraCount: 3, weightageTotal: 100 }), false)
  assert.equal(kraSetValid({ kraCount: 11, weightageTotal: 100 }), false)
  assert.equal(kraSetValid({ kraCount: 6, weightageTotal: 99 }), false)
  assert.equal(kraSetValid({ kraCount: 6, weightageTotal: 101 }), false)
})

// ═══ §8 EMPLOYMENT FLAGS ═════════════════════════════════════════════════

const T = '2026-11-15'

test('the four flags fire on the spec triggers', () => {
  assert.equal(flagFor({ dateOfLeaving: '2026-11-01' }, T), 'EXITED')
  assert.equal(flagFor({ dateOfLeaving: '2026-12-31' }, T), 'NOTICE_PERIOD')
  assert.equal(flagFor({ resignationDate: '2026-11-10' }, T), 'NOTICE_PERIOD')
  assert.equal(flagFor({ dateOfJoining: '2026-11-01' }, T), 'NEW_JOINER')
  assert.equal(flagFor({ dateOfJoining: '2020-01-01' }, T), 'ACTIVE')
  assert.equal(flagFor({}, T), 'ACTIVE')
})

test('ORDER MATTERS: someone who has already left is EXITED, not on notice', () => {
  // Both a leaving date in the past and a resignation date are set. Checking
  // notice first would leave a departed employee in the active queue with a
  // countdown to a date that has passed.
  assert.equal(flagFor({ dateOfLeaving: '2026-10-01', resignationDate: '2026-09-01' }, T), 'EXITED')
})

test('the last working day is inclusive', () => {
  assert.equal(flagFor({ dateOfLeaving: T }, T), 'EXITED')
})

test('the new-joiner cut-off is configurable, and the boundary is exact', () => {
  // The spec says NEW_JOINER when DOJ > today − cutoff, so 29 days in is
  // still new and 30 days is not. My first version of this asserted ACTIVE
  // at 29 days while its own message said "still new" — the assertion and
  // the label disagreed, and the label was the one telling the truth.
  assert.equal(flagFor({ dateOfJoining: '2026-10-17' }, T), 'NEW_JOINER', '29 days in')
  assert.equal(flagFor({ dateOfJoining: '2026-10-16' }, T), 'ACTIVE', '30 days: no longer new')
  assert.equal(flagFor({ dateOfJoining: '2026-11-14' }, T), 'NEW_JOINER')
  assert.equal(flagFor({ dateOfJoining: '2026-10-01' }, T, { newJoinerCutoffDays: 90 }), 'NEW_JOINER')
})

test('notice rows sort above everything — theirs is the deadline that cannot move', () => {
  const order = (['ACTIVE', 'NEW_JOINER', 'EXITED', 'NOTICE_PERIOD'] as const)
    .slice().sort((a, b) => queuePriority(a) - queuePriority(b))
  assert.deepEqual(order, ['NOTICE_PERIOD', 'EXITED', 'ACTIVE', 'NEW_JOINER'])
})

test('action stops being required once the record is finalised', () => {
  assert.equal(actionRequired('NOTICE_PERIOD', false), true)
  assert.equal(actionRequired('NOTICE_PERIOD', true), false)
  assert.equal(actionRequired('ACTIVE', false), false)
})

test('days to the last working day counts down and goes negative after', () => {
  assert.equal(daysToLwd({ dateOfLeaving: '2026-11-30' }, T), 15)
  assert.equal(daysToLwd({ dateOfLeaving: '2026-11-01' }, T), -14)
  assert.equal(daysToLwd({}, T), null)
})

test('every flag is explained in words, not by colour alone', () => {
  for (const f of ['EXITED', 'NOTICE_PERIOD', 'NEW_JOINER', 'ACTIVE'] as const) {
    assert.ok(FLAG_LABEL[f].length > 3, f)
    assert.ok(FLAG_MEANING[f].length > 15, f)
    assert.doesNotMatch(FLAG_LABEL[f], /_|[A-Z]{4,}/, f)
  }
})

// ═══ §6.4 BULK UPLOAD ════════════════════════════════════════════════════

const known = {
  scale: [1, 2, 3, 4, 5],
  improvementMandatoryAtOrBelow: 2,
  lookup: (e: string, p: string) =>
    e === 'SRS001' && p === 'Q3' ? { computed: 3, eligible: true, readOnly: false }
  : e === 'SRS002' && p === 'Q3' ? { computed: 4, eligible: true, readOnly: false }
  : e === 'GONE'   && p === 'Q3' ? { computed: 3, eligible: true, readOnly: true }
  : e === 'NOTIN'  && p === 'Q3' ? { computed: null, eligible: false, readOnly: false }
  : null,
}

test('the template has the nine columns the spec lists', () => {
  assert.equal(TEMPLATE_COLUMNS.length, 9)
  assert.ok(TEMPLATE_COLUMNS.includes('override_reason'))
  assert.ok(TEMPLATE_COLUMNS.includes('finalised_by_code'))
})

test('a clean file commits', () => {
  const p = checkUpload([{ employee_code: 'SRS001', period_code: 'Q3', final_rating: 3 }], known)
  assert.equal(p.errorCount, 0)
  assert.equal(p.canCommit, true)
})

test('ERROR_NOT_FOUND, NOT_ELIGIBLE, INVALID_RATING and REASON_MISSING all fire', () => {
  const p = checkUpload([
    { employee_code: 'NOPE',   period_code: 'Q3', final_rating: 3 },
    { employee_code: 'NOTIN',  period_code: 'Q3', final_rating: 3 },
    { employee_code: 'GONE',   period_code: 'Q3', final_rating: 3 },
    { employee_code: 'SRS001', period_code: 'Q3', final_rating: 9 },
    { employee_code: 'SRS001', period_code: 'Q3', final_rating: 5 },
  ], known)
  assert.ok(p.rows[0].errors.includes('ERROR_NOT_FOUND'))
  assert.ok(p.rows[1].errors.includes('ERROR_NOT_ELIGIBLE'))
  assert.ok(p.rows[2].errors.includes('ERROR_NOT_ELIGIBLE'), 'read-only is not eligible')
  assert.ok(p.rows[3].errors.includes('ERROR_INVALID_RATING'))
  assert.ok(p.rows[4].errors.includes('ERROR_REASON_MISSING'))
})

test('RULE 13: a reason is owed only when the rating actually CHANGES', () => {
  // Demanding one for an unchanged row trains people to type "n/a", which is
  // worse than not asking.
  const same = checkUpload([{ employee_code: 'SRS001', period_code: 'Q3', final_rating: 3 }], known)
  assert.deepEqual(same.rows[0].errors, [])
  assert.equal(same.changedCount, 0)

  const changed = checkUpload([{ employee_code: 'SRS001', period_code: 'Q3',
    final_rating: 5, override_reason: 'Calibration committee, 12 Jan' }], known)
  assert.deepEqual(changed.rows[0].errors, [])
  assert.equal(changed.changedCount, 1)
  assert.equal(changed.rows[0].delta, 2)
})

test('THE COMMIT IS BLOCKED while any row has an error', () => {
  const p = checkUpload([
    { employee_code: 'SRS001', period_code: 'Q3', final_rating: 3 },
    { employee_code: 'NOPE',   period_code: 'Q3', final_rating: 3 },
  ], known)
  assert.equal(p.canCommit, false, 'one bad row blocks the whole file')
  assert.equal(p.errorCount, 1)
})

test('an empty file cannot be committed either', () => {
  assert.equal(checkUpload([], known).canCommit, false)
})

test('RULE 10 is a warning here, not a block, and says so', () => {
  const p = checkUpload([{ employee_code: 'SRS002', period_code: 'Q3',
    final_rating: 2, override_reason: 'moderation' }], known)
  assert.deepEqual(p.rows[0].errors, [])
  assert.ok(p.rows[0].warnings.some(w => /improvement feedback/i.test(w)))
  assert.equal(p.canCommit, true)
})

test('a big swing is flagged for a reviewer to look at', () => {
  const p = checkUpload([{ employee_code: 'SRS001', period_code: 'Q3',
    final_rating: 5, override_reason: 'x' }], known)
  assert.ok(p.rows[0].warnings.some(w => /2 bands/.test(w)))
})

test('the summary tells an admin what to do, not just a count', () => {
  assert.match(summarise(checkUpload([], known)), /no rows/)
  assert.match(summarise(checkUpload([{ employee_code: 'NOPE', period_code: 'Q3', final_rating: 3 }], known)),
    /nothing is committed until every row is clean/)
  assert.match(summarise(checkUpload([{ employee_code: 'SRS001', period_code: 'Q3', final_rating: 3 }], known)),
    /none of which change a rating/)
  for (const e of Object.values(ERROR_TEXT)) assert.ok(e.length > 20)
})

// ═══ §7 PIP FLOW ═════════════════════════════════════════════════════════

const pip = (o: Partial<Pip> = {}): Pip => ({ status: 'PENDING_HR', areas: [{}], ...o })

test('THE RULE: an RM raises a request but cannot initiate a PIP', () => {
  const v = canTransition(pip(), 'initiate', 'RM')
  assert.equal(v.allowed, false)
  // and the refusal explains WHY, because this is the rule people will push on
  assert.match(v.reason!, /HR initiates it/)
  assert.match(v.reason!, /documentation/)
})

test('HR can initiate from PENDING_HR', () => {
  assert.equal(canTransition(pip(), 'initiate', 'HR').allowed, true)
  assert.equal(nextStatus('initiate', pip()), 'INITIATED')
})

test('a PIP with every area dropped cannot be initiated', () => {
  const v = canTransition(pip({ areas: [{ retained: false }] }), 'initiate', 'HR')
  assert.equal(v.allowed, false)
  assert.match(v.reason!, /nothing to work on/i)
})

test('the full happy path walks end to end', () => {
  let p = pip({ status: 'PENDING_HR' })
  assert.equal(canTransition(p, 'initiate', 'HR').allowed, true)
  p = { ...p, status: nextStatus('initiate', p) }
  assert.equal(p.status, 'INITIATED')

  assert.equal(canTransition(p, 'acknowledge', 'EMPLOYEE').allowed, true)
  p = { ...p, status: nextStatus('acknowledge', p), employeeAck: true }
  assert.equal(p.status, 'ACKNOWLEDGED')

  assert.equal(canTransition(p, 'review', 'RM').allowed, true)
  p = { ...p, status: nextStatus('review', p), reviewsDone: 1 }
  assert.equal(p.status, 'IN_REVIEW')

  assert.equal(canTransition(p, 'close', 'HR').allowed, true)
  assert.equal(nextStatus('close', p), 'CLOSED')
})

test('reviews cannot start before the employee has acknowledged', () => {
  const v = canTransition(pip({ status: 'ACKNOWLEDGED', employeeAck: false }), 'review', 'RM')
  assert.equal(v.allowed, false)
  assert.match(v.reason!, /not acknowledged/)
})

test('a PIP cannot be closed with no review on record', () => {
  const v = canTransition(pip({ status: 'IN_REVIEW', employeeAck: true, reviewsDone: 0 }), 'close', 'HR')
  assert.equal(v.allowed, false)
  assert.match(v.reason!, /at least one review/)
})

test('send back and resubmit round-trip between HR and the RM', () => {
  assert.equal(canTransition(pip(), 'send_back', 'HR').allowed, true)
  assert.equal(nextStatus('send_back', pip()), 'SENT_BACK')
  assert.equal(canTransition(pip({ status: 'SENT_BACK' }), 'resubmit', 'RM').allowed, true)
  assert.equal(nextStatus('resubmit', pip({ status: 'SENT_BACK' })), 'PENDING_HR')
  // and an RM cannot send their own request back to themselves
  assert.equal(canTransition(pip(), 'send_back', 'RM').allowed, false)
})

test('a rejected or closed PIP accepts nothing further', () => {
  for (const status of ['REJECTED', 'CLOSED'] as const) {
    for (const a of ['initiate', 'acknowledge', 'review', 'close'] as const) {
      assert.equal(canTransition(pip({ status }), a, 'HR').allowed, false, `${status}/${a}`)
    }
  }
})

test('an employee cannot act on anybody else’s step', () => {
  assert.equal(canTransition(pip(), 'initiate', 'EMPLOYEE').allowed, false)
  assert.equal(canTransition(pip({ status: 'IN_REVIEW' }), 'close', 'EMPLOYEE').allowed, false)
})

test('every status says what happens next, and who owns it', () => {
  for (const s of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
    const n = whatNext(pip({ status: s }))
    assert.ok(n.what.length > 10, s)
    assert.doesNotMatch(n.what, /[A-Z]{4,}|_/, s)
  }
  assert.equal(whatNext(pip({ status: 'PENDING_HR' })).who, 'HR')
  assert.equal(whatNext(pip({ status: 'INITIATED' })).who, 'EMPLOYEE')
  assert.equal(whatNext(pip({ status: 'CLOSED' })).who, null)
})

// ═══ §0.1 THE NON-NEGOTIABLE ═════════════════════════════════════════════

test('nothing in the PMS logic converts a rating into money', () => {
  for (const f of ['policy.ts', 'employment.ts', 'upload.ts', 'pip.ts', 'cycle.ts']) {
    const src = readFileSync(`lib/pms/${f}`, 'utf8')
    for (const w of ['increment', 'variable_pay', 'bonus', 'ctc', '₹']) {
      assert.doesNotMatch(src, new RegExp(`\\b${w}\\b`, 'i'), `${f}: ${w}`)
    }
  }
})
