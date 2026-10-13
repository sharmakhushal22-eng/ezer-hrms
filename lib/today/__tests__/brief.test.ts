// lib/today/__tests__/brief.test.ts — the hero's one-line brief.
//
// Prose can be wrong in ways a number cannot. This file exists because the
// Home screen was greeting somebody with "and -13.5 days of leave in the
// bank", which is a well-formed sentence saying something impossible.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { leaveClause, pendingClause, teamClause } from '../brief.ts'

describe('the leave clause', () => {
  it('states a real balance', () => {
    assert.equal(leaveClause(12.5), '12.5 days of leave in the bank')
    assert.equal(leaveClause(1), '1 day of leave in the bank')
    assert.equal(leaveClause(20), '20 days of leave in the bank')
  })

  it('drops the trailing zero rather than saying 12.0 days', () => {
    assert.equal(leaveClause(12.0), '12 days of leave in the bank')
    assert.equal(leaveClause(2.25), '2.3 days of leave in the bank')
  })

  it('says nothing at all when the balance is negative', () => {
    // ess_today sums accrued-used over EVERY type, and Leave Without Pay
    // accrues nothing, so 16 days of it makes the "balance" -16. That total is
    // wrong at source; repeating it in a greeting is the part this prevents.
    assert.equal(leaveClause(-13.5), null)
    assert.equal(leaveClause(-0.5), null)
  })

  it('says so plainly when there is none left', () => {
    assert.equal(leaveClause(0), 'no leave left in the bank')
  })

  it('says nothing when the figure is missing or not a number', () => {
    assert.equal(leaveClause(null), null)
    assert.equal(leaveClause(undefined), null)
    assert.equal(leaveClause(Number.NaN), null)
  })
})

describe('the team clause', () => {
  it('counts who is in', () => {
    assert.equal(teamClause(3, 8), '3 of your team are in office today.')
    assert.equal(teamClause(1, 8), '1 of your team is in office today.')
  })

  it('uses words when nobody is in, rather than a zero', () => {
    // "0 of your team are in office today" is correct and reads like a form.
    assert.equal(teamClause(0, 8), 'Nobody from your team is in today.')
  })

  it('does not say "8 of your team" when it is all of them', () => {
    assert.equal(teamClause(8, 8), 'All of your team are in today.')
    assert.equal(teamClause(1, 1), 'Your one teammate is in today.')
  })

  it('says nothing when there is no team', () => {
    assert.equal(teamClause(0, 0), null)
  })
})

describe('the pending clause', () => {
  it('counts what is waiting, and says when nothing is', () => {
    assert.equal(pendingClause(0), 'Nothing is waiting on you')
    assert.equal(pendingClause(1), 'You have 1 thing waiting on you')
    assert.equal(pendingClause(4), 'You have 4 things waiting on you')
  })
})
