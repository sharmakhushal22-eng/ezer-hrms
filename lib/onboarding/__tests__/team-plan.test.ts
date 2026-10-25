import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTeam, chainUnder, withJoinerId, summarisePlan, parseCodes, autoRoleCodes, NEW, type TeamPerson } from '../team-plan.ts'

test('the manager roles follow the depth of the team: reports → L1, their reports → L2 too, three levels → HOD as well', () => {
  assert.deepEqual(autoRoleCodes([]), [])
  assert.deepEqual(autoRoleCodes([{ level: 1 }]), ['L1_MANAGER'])
  assert.deepEqual(autoRoleCodes([{ level: 1 }, { level: 2 }]), ['L1_MANAGER', 'L2_MANAGER'])
  assert.deepEqual(autoRoleCodes([{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }]), ['L1_MANAGER', 'L2_MANAGER', 'HOD'])
})

// The company: Arun (the joiner) will manage Bina and Chetan. Dev reports to Bina today, Esha to Dev.
// Arun's managers (from Assign managers): L1 Meera, L2 Rajan, HOD Suresh.
const P = (id: string, l1: string | null, l2: string | null, hod: string | null): TeamPerson => ({ id, emp_code: id.toUpperCase(), full_name: id[0].toUpperCase() + id.slice(1), l1, l2, hod })
const people = new Map<string, TeamPerson>([
  ['bina', P('bina', 'meera', 'rajan', 'suresh')],
  ['chetan', P('chetan', 'old', null, 'suresh')],
  ['dev', P('dev', 'bina', 'meera', 'rajan')],
  ['esha', P('esha', 'dev', 'bina', 'meera')],
  ['meera', P('meera', 'rajan', 'suresh', 'suresh')],
  ['loner', P('loner', 'dev', null, null)],
])
const reportsOf = (m: string) => [...people.values()].filter(p => p.l1 === m).map(p => p.id)
const arun = { l1: 'meera', l2: 'rajan', hod: 'suresh' }

test('a direct report gets the joiner as L1, the joiner\'s L1 as L2 and the joiner\'s L2 as HOD', () => {
  const { members, problems } = planTeam(arun, ['bina'], people, () => [])
  assert.deepEqual(problems, [])
  assert.equal(members.length, 1)
  assert.deepEqual(members[0].after, { l1: NEW, l2: 'meera', hod: 'rajan' })
  assert.deepEqual(members[0].changed, ['L1', 'L2', 'HOD'])
  assert.equal(members[0].level, 1)
})

test('the team under a direct report shifts with them: the joiner becomes their L2, the joiner\'s L1 their HOD, and so on down', () => {
  const { members } = planTeam(arun, ['bina', 'chetan'], people, reportsOf)
  const by = Object.fromEntries(members.map(m => [m.id, m]))
  assert.deepEqual(Object.keys(by).sort(), ['bina', 'chetan', 'dev', 'esha', 'loner'])
  assert.deepEqual(by.dev.after, { l1: 'bina', l2: NEW, hod: 'meera' }, 'Dev keeps Bina as L1; the joiner is his L2')
  assert.equal(by.dev.level, 2); assert.equal(by.dev.via, 'bina')
  assert.deepEqual(by.esha.after, { l1: 'dev', l2: 'bina', hod: NEW }, 'Esha: the joiner is her HOD')
  assert.equal(by.esha.level, 3)
  assert.deepEqual(by.loner.after, { l1: 'dev', l2: 'bina', hod: NEW })
  assert.deepEqual(by.chetan.changed, ['L1', 'L2', 'HOD'])
})

test('somebody HR unticks is left alone, and the tree is not followed below them', () => {
  const { members } = planTeam(arun, ['bina'], people, reportsOf, { exclude: ['dev'] })
  assert.deepEqual(members.map(m => m.id), ['bina'])
})

test('the joiner\'s own managers cannot be in the team; unknown ids are reported, never silently dropped', () => {
  const { members, problems } = planTeam(arun, ['meera', 'ghost', 'chetan'], people, reportsOf)
  assert.deepEqual(members.map(m => m.id), ['chetan'])
  assert.equal(problems.length, 2)
  assert.match(problems[0], /Meera .*own manager/)
  assert.match(problems[1], /ghost was not found/)
})

test('a loop in today\'s data — the joiner\'s manager found deeper in the tree — is skipped with a warning, not a block', () => {
  // Meera (Arun's L1) reports to Dev today, who reports to Bina, who will report to Arun.
  const loop = new Map(people)
  loop.set('meera', P('meera', 'dev', 'bina', 'suresh'))
  const reports = (m: string) => [...loop.values()].filter(p => p.l1 === m).map(p => p.id)
  const { members, problems, warnings } = planTeam(arun, ['bina'], loop, reports)
  assert.deepEqual(problems, [])
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Meera .*own manager.*under Dev/)
  assert.ok(!members.some(m => m.id === 'meera'), 'Meera is left alone')
  assert.ok(members.some(m => m.id === 'esha'), 'the rest of Dev\'s team still shifts')
})

test('a joiner without an L2 passes their HOD down as the reports\' HOD', () => {
  assert.deepEqual(chainUnder('x', { l1: 'a', l2: null, hod: 'h' }), { l1: 'x', l2: 'a', hod: 'h' })
  assert.deepEqual(chainUnder('x', { l1: 'a', l2: 'b', hod: 'h' }), { l1: 'x', l2: 'a', hod: 'b' })
})

test('NEW is replaced by the employee id once the row exists; the summary counts levels and changes', () => {
  const { members } = planTeam(arun, ['bina'], people, reportsOf)
  const real = withJoinerId(members, 'emp-1')
  assert.equal(real.find(m => m.id === 'bina')!.after.l1, 'emp-1')
  assert.equal(real.find(m => m.id === 'dev')!.after.l2, 'emp-1')
  assert.equal(real.find(m => m.id === 'esha')!.after.hod, 'emp-1')
  assert.equal(summarisePlan(members), '1 direct report and 3 people under them · 8 reporting-line changes')
  assert.equal(summarisePlan([]), 'Nobody reports to them yet')
})

test('pasted codes are split on commas, spaces, new lines and upper-cased, duplicates dropped', () => {
  assert.deepEqual(parseCodes('stc9022, stc9007\nSTC9073;stc9022 '), ['STC9022', 'STC9007', 'STC9073'])
  assert.deepEqual(parseCodes(''), [])
})
