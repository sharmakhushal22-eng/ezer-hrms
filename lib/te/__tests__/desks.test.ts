import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coverage, coverageNote, deskRowProblem, isFallback, removalWarning, sameSeat, scopeLabel, type DeskMember,
} from '../desks.ts'

const C1 = 'company-1', C2 = 'company-2'
const PUNE = 'loc-pune', NOIDA = 'loc-noida', LUDH = 'loc-ludhiana'
const GROUP = [C1, C2]

const m = (p: Partial<DeskMember> = {}): DeskMember => ({
  companyId: C1, locationId: null, employeeId: 'e1', active: true, able: true, groupScope: false, ...p,
})

// ── the ladder ──────────────────────────────────────────────────────────────

test('step 1: a person at the branch answers for it', () => {
  const c = coverage([m({ employeeId: 'a', locationId: PUNE })], C1, PUNE, GROUP)
  assert.deepEqual(c, { via: 'branch', who: ['a'] })
})

test('step 1 also counts somebody who answers for every branch', () => {
  // The case that would be wrong if "every branch" fell through to step 2:
  // a company-wide member IS the branch's desk, not a fallback from it.
  const c = coverage([m({ employeeId: 'all', locationId: null })], C1, PUNE, GROUP)
  assert.equal(c.via, 'branch')
  assert.deepEqual(c.who, ['all'])
})

test('step 2: another branch of the same company picks it up', () => {
  const c = coverage([m({ employeeId: 'n', locationId: NOIDA })], C1, LUDH, GROUP)
  assert.deepEqual(c, { via: 'company', who: ['n'] })
})

test('step 3: a group-wide member is the last resort', () => {
  const c = coverage([m({ employeeId: 'g', companyId: C2, groupScope: true })], C1, PUNE, GROUP)
  assert.deepEqual(c, { via: 'group', who: ['g'] })
})

test('a group-wide member of another company does NOT satisfy step 2', () => {
  // Step 2 is "this company's desk". Another company's row must only ever be
  // reachable through step 3, and only when it is flagged group scope.
  const rows = [m({ employeeId: 'other', companyId: C2, groupScope: false })]
  assert.deepEqual(coverage(rows, C1, PUNE, GROUP), { via: 'nobody', who: [] })
})

test('a company outside the group is never reached', () => {
  const rows = [m({ employeeId: 'g', companyId: 'company-elsewhere', groupScope: true })]
  assert.equal(coverage(rows, C1, PUNE, GROUP).via, 'nobody')
})

test('nobody is nobody, and says so', () => {
  assert.deepEqual(coverage([], C1, PUNE, GROUP), { via: 'nobody', who: [] })
})

test('switched off or unable counts as absent at every step', () => {
  assert.equal(coverage([m({ locationId: PUNE, active: false })], C1, PUNE, GROUP).via, 'nobody')
  // On the desk but without the right — a Finance member who cannot approve.
  assert.equal(coverage([m({ locationId: PUNE, able: false })], C1, PUNE, GROUP).via, 'nobody')
})

test('the branch wins over the company even when the company has more people', () => {
  const rows = [
    m({ employeeId: 'p', locationId: PUNE }),
    m({ employeeId: 'n1', locationId: NOIDA }),
    m({ employeeId: 'n2', locationId: NOIDA }),
  ]
  assert.deepEqual(coverage(rows, C1, PUNE, GROUP), { via: 'branch', who: ['p'] })
})

test('a lower step is not consulted once a higher one answers', () => {
  const rows = [m({ employeeId: 'p', locationId: PUNE }), m({ employeeId: 'g', companyId: C2, groupScope: true })]
  assert.equal(coverage(rows, C1, PUNE, GROUP).who.length, 1)
})

// ── what the screen says ────────────────────────────────────────────────────

test('the note names the fallback rather than hiding it', () => {
  assert.match(coverageNote(coverage([m({ employeeId: 'n', locationId: NOIDA })], C1, LUDH, GROUP), 'Ludhiana Factory'), /falls back/)
  assert.match(coverageNote(coverage([], C1, LUDH, GROUP), 'Ludhiana Factory'), /cannot be processed/)
})

test('one person reads as a person, not as 1 people', () => {
  assert.match(coverageNote(coverage([m({ locationId: PUNE })], C1, PUNE, GROUP), 'Pune Branch'), /1 person at Pune Branch/)
  const two = [m({ employeeId: 'a', locationId: PUNE }), m({ employeeId: 'b', locationId: PUNE })]
  assert.match(coverageNote(coverage(two, C1, PUNE, GROUP), 'Pune Branch'), /2 people/)
})

test('a fallback is flagged, its own branch is not', () => {
  assert.equal(isFallback(coverage([m({ locationId: PUNE })], C1, PUNE, GROUP)), false)
  assert.equal(isFallback(coverage([m({ locationId: NOIDA })], C1, PUNE, GROUP)), true)
})

test('scope reads as what it reaches', () => {
  assert.equal(scopeLabel({ locationId: null, groupScope: true }), 'Every company in the group')
  assert.equal(scopeLabel({ locationId: null, groupScope: false }), 'Every branch of this company')
  assert.equal(scopeLabel({ locationId: PUNE, groupScope: false }, 'Pune Branch'), 'Pune Branch')
})

// ── validation ──────────────────────────────────────────────────────────────

test('group scope and one branch are contradictory and refused', () => {
  assert.match(deskRowProblem(m({ groupScope: true, locationId: PUNE }), 'finance'), /whole group cannot also be tied to one branch/)
  assert.equal(deskRowProblem(m({ groupScope: true, locationId: null }), 'finance'), '')
})

test('a zero limit is refused as a disguised switch-off', () => {
  assert.match(deskRowProblem(m({ limit: 0 }), 'finance'), /zero/)
  assert.match(deskRowProblem(m({ limit: -5 }), 'finance'), /negative/)
  assert.equal(deskRowProblem(m({ limit: null }), 'finance'), '')
  assert.equal(deskRowProblem(m({ limit: 50000 }), 'finance'), '')
})

test('a limit is meaningless on the travel desk and is not policed there', () => {
  assert.equal(deskRowProblem(m({ limit: 0 }), 'travel'), '')
})

test('the seat identity treats a null branch as a value', () => {
  // Postgres would let two null-branch rows coexist under a plain unique
  // constraint; 161 uses coalesce to stop it, and this mirrors that.
  assert.equal(sameSeat(m({ locationId: null }), m({ locationId: null })), true)
  assert.equal(sameSeat(m({ locationId: null }), m({ locationId: PUNE })), false)
  assert.equal(sameSeat(m({ employeeId: 'a' }), m({ employeeId: 'b' })), false)
})

// ── the warning before a save ───────────────────────────────────────────────

const LOCS = [{ id: PUNE, name: 'Pune Branch' }, { id: NOIDA, name: 'Noida Branch' }]

test('removing the only person warns that nobody is left', () => {
  const rows = [m({ employeeId: 'a', locationId: null })]
  assert.match(removalWarning(rows, rows[0], C1, LOCS, GROUP), /nobody at all/)
})

test('removing one branch person warns about the fallback, not a disaster', () => {
  const rows = [m({ employeeId: 'p', locationId: PUNE }), m({ employeeId: 'n', locationId: NOIDA })]
  const w = removalWarning(rows, rows[0], C1, LOCS, GROUP)
  assert.match(w, /Pune Branch/)
  assert.match(w, /fall back/)
})

test('removing somebody who changes nothing warns about nothing', () => {
  const rows = [
    m({ employeeId: 'p1', locationId: PUNE }),
    m({ employeeId: 'p2', locationId: PUNE }),
    m({ employeeId: 'n', locationId: NOIDA }),
  ]
  assert.equal(removalWarning(rows, rows[0], C1, LOCS, GROUP), '')
})
