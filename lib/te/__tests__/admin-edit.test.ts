// lib/te/__tests__/admin-edit.test.ts — editing the policy.
//
// A broken approval chain is not discovered by the admin who saved it. It is
// discovered days later by the first employee whose claim went nowhere, or to
// nobody. So the chain rules are pinned down here, and each is about what
// happens to a real claim travelling through it rather than about tidiness.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  chainBlocked, chainProblems, changedRows, isDirty, newLevel, whatChangingAffects,
} from '../admin-edit.ts'
import type { TeWorkflowLevel } from '../types.ts'

const level = (over: Partial<TeWorkflowLevel> = {}): TeWorkflowLevel =>
  ({ kind: 'approve', label: 'Approval', who: 'rm', person: '', when: [], ...over })

const blockers = (levels: TeWorkflowLevel[]) => chainProblems(levels).filter(p => p.blocks).map(p => p.text)

describe('knowing whether anything changed', () => {
  it('sees an edit, and sees none', () => {
    assert.equal(isDirty({ a: 1 }, { a: 1 }), false)
    assert.equal(isDirty({ a: 1 }, { a: 2 }), true)
    assert.equal(isDirty([{ x: 1 }], [{ x: 1 }]), false)
  })

  it('picks out only the rows that moved', () => {
    const before = [{ id: 'a', rate: 10 }, { id: 'b', rate: 20 }, { id: 'c', rate: 30 }]
    const after = [{ id: 'a', rate: 10 }, { id: 'b', rate: 25 }, { id: 'c', rate: 30 }]
    assert.deepEqual(changedRows(before, after).map(r => r.id), ['b'])
  })

  it('counts a new row as changed', () => {
    const before = [{ id: 'a', rate: 10 }]
    const after = [{ id: 'a', rate: 10 }, { id: 'new', rate: 5 }]
    assert.deepEqual(changedRows(before, after).map(r => r.id), ['new'])
  })

  it('keys checks by their code, which is what they have instead of an id', () => {
    const before = [{ c: 'D10', on: true }]
    const after = [{ c: 'D10', on: false }]
    assert.deepEqual(changedRows(before, after).map(r => r.c), ['D10'])
  })

  it('sends nothing when nothing moved', () => {
    const rows = [{ id: 'a', rate: 10 }]
    assert.deepEqual(changedRows(rows, [...rows]), [])
  })
})

describe('what is wrong with an approval chain', () => {
  it('accepts a plain manager-then-finance chain', () => {
    const ok = [level(), level({ kind: 'finance', who: 'finance', label: 'Finance check' })]
    assert.deepEqual(chainProblems(ok), [])
    assert.equal(chainBlocked(ok), false)
  })

  it('refuses an empty chain, which would leave claims waiting for nobody', () => {
    assert.match(blockers([])[0], /waiting for nobody/)
    assert.equal(chainBlocked([]), true)
  })

  it('refuses a level naming nobody', () => {
    // The claim stops dead at a level that cannot resolve to a person.
    assert.match(blockers([level({ who: 'person', person: '' })])[0], /stops the claim here/)
    assert.equal(chainBlocked([level({ who: 'person', person: 'emp-1' })]), false)
  })

  it('refuses a level with no name, because the employee reads it', () => {
    assert.match(blockers([level({ label: '  ' })])[0], /Give the level a name/)
  })

  it('refuses a Finance level placed before an approval level', () => {
    // Finance verifies what a manager has already agreed to.
    const inverted = [level({ kind: 'finance', who: 'finance' }), level()]
    assert.match(blockers(inverted)[0], /cannot come before an approval level/)
  })

  it('allows Finance after approval, and several approvals in a row', () => {
    const fine = [level(), level({ who: 'hod', label: 'HOD' }), level({ kind: 'finance', who: 'finance', label: 'Finance' })]
    assert.equal(chainBlocked(fine), false)
  })

  it('warns about the same approver twice without blocking it', () => {
    const twice = [level({ who: 'rm' }), level({ who: 'rm', label: 'Again' })]
    const problems = chainProblems(twice)
    assert.equal(problems.length, 1)
    assert.equal(problems[0].blocks, false, 'a duplicate is worth saying, not worth refusing')
    assert.match(problems[0].text, /adds a step but not a check/)
  })

  it('does not call two unnamed person-levels duplicates', () => {
    // They are both already blocked for naming nobody; calling them duplicates
    // as well would be noise on top of the real problem.
    const problems = chainProblems([level({ who: 'person', person: '' }), level({ who: 'person', person: '' })])
    assert.equal(problems.filter(p => /adds a step/.test(p.text)).length, 0)
  })

  it('treats two different named people as different approvers', () => {
    const two = [level({ who: 'person', person: 'a' }), level({ who: 'person', person: 'b' })]
    assert.deepEqual(chainProblems(two), [])
  })

  it('refuses a condition that was left half-set', () => {
    assert.match(blockers([level({ when: [{ t: 'amount' }] })])[0], /Set the amount/)
    assert.match(blockers([level({ when: [{ t: 'amount', v: 0 }] })])[0], /Set the amount/)
    assert.match(blockers([level({ when: [{ t: 'scope' }] })])[0], /which kind of trip/)
    assert.match(blockers([level({ when: [{ t: 'risk' }] })])[0], /which risk band/)
  })

  it('accepts the conditions that need no value', () => {
    assert.equal(chainBlocked([level({ when: [{ t: 'postFacto' }, { t: 'exception' }] })]), false)
  })

  it('points each problem at its own level', () => {
    const problems = chainProblems([level(), level({ label: '' })])
    assert.equal(problems[0].at, 1)
  })
})

describe('a new level', () => {
  it('starts somewhere sensible for its kind', () => {
    assert.equal(newLevel('approve').who, 'rm')
    assert.equal(newLevel('finance').who, 'finance')
    assert.equal(chainBlocked([newLevel('approve')]), false, 'a fresh level should not be born broken')
  })
})

describe('telling the admin what a change affects', () => {
  it('says past trips keep the policy they were approved under', () => {
    // The thing people assume wrongly in both directions.
    assert.match(whatChangingAffects('rates'), /Trips already approved keep the policy/)
    assert.match(whatChangingAffects('limits'), /Trips already approved keep the policy/)
  })

  it('does not claim that about things trips do not freeze', () => {
    assert.doesNotMatch(whatChangingAffects('checks'), /already approved keep the policy/)
    assert.match(whatChangingAffects('checks'), /Flags already raised stay as they are/)
    assert.match(whatChangingAffects('workflow'), /keeps the chain it started in/)
  })
})
