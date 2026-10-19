// Where a request has got to in its approval chain, in a sentence.
//
// The point of this is the MIDDLE of a chain. "Waiting for approval" covers
// both a trip nobody has looked at and a trip where R1 has signed and only the
// Head of department is left — the same status, and very different news for a
// desk deciding whether to hold a fare today. So the part-way case gets the
// most tests, and every test checks the words, because the words are the whole
// output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chainState, chainTone, shortRole, type ChainStep } from '../approval-chain.ts'

const step = (n: number, role: string, status: string, who: string | null = null): ChainStep =>
  ({ stepNo: n, roleLabel: role, status, who })

const R1 = 'Reporting manager (R1)'
const HOD = 'Head of department'

// ── the case it exists for ──────────────────────────────────────────────────

test('R1 approved and HOD still to come says exactly that', () => {
  const s = chainState([step(1, R1, 'approved'), step(2, HOD, 'pending', 'Kiran Patel')])
  assert.equal(s.state, 'part')
  assert.equal(s.done, 1)
  assert.equal(s.total, 2)
  assert.equal(s.text, 'R1 approved · waiting on Kiran Patel')
  assert.equal(s.waitingOn?.roleLabel, HOD)
})

test('two approved and one left names them all', () => {
  const s = chainState([
    step(1, R1, 'approved'), step(2, HOD, 'approved'), step(3, 'Finance', 'pending', 'Asha Rao'),
  ])
  assert.equal(s.text, 'R1 and Head of department approved · waiting on Asha Rao')
  assert.equal(s.done, 2)
})

test('an auto-approved step counts as approved', () => {
  // The workflow can pass a step without a person, and from the desk's point of
  // view that step is just as done as one somebody clicked.
  const s = chainState([step(1, R1, 'auto'), step(2, HOD, 'pending', 'Kiran Patel')])
  assert.equal(s.done, 1)
  assert.equal(s.text, 'R1 approved · waiting on Kiran Patel')
})

// ── the ends of the story ───────────────────────────────────────────────────

test('nobody has looked yet says who it is sitting with', () => {
  const one = chainState([step(1, R1, 'pending', 'Nisha Verma')])
  assert.equal(one.state, 'waiting')
  assert.equal(one.text, 'Waiting on Nisha Verma')

  // And how much is behind them, because one more approver is a day and three
  // is a week.
  const two = chainState([step(1, R1, 'pending', 'Nisha Verma'), step(2, HOD, 'pending', 'Kiran Patel')])
  assert.equal(two.text, 'Waiting on Nisha Verma, then 1 more')
})

test('fully approved names who approved it', () => {
  const s = chainState([step(1, R1, 'approved'), step(2, HOD, 'approved')])
  assert.equal(s.state, 'approved')
  assert.equal(s.text, 'Approved by R1 and Head of department')
  assert.equal(s.waitingOn, null, 'nothing is waiting')
})

test('a rejection ends the story and does not count the steps after it', () => {
  // Steps after a rejection never ran. Reporting "1 of 3" would suggest the
  // chain is still moving when it has stopped.
  const s = chainState([step(1, R1, 'approved'), step(2, HOD, 'rejected', 'Kiran Patel'), step(3, 'Finance', 'pending')])
  assert.equal(s.state, 'rejected')
  assert.equal(s.text, 'Rejected by Kiran Patel')
  assert.equal(s.waitingOn, null)
})

test('a send-back ends it too, and says who sent it back', () => {
  const s = chainState([step(1, R1, 'sent_back', 'Nisha Verma'), step(2, HOD, 'pending')])
  assert.equal(s.state, 'sent_back')
  assert.equal(s.text, 'Sent back by Nisha Verma')
})

test('no chain at all is not "0 of 0"', () => {
  // A short local trip can need nobody. That is a real state and reads badly
  // as a fraction.
  const s = chainState([])
  assert.equal(s.state, 'none')
  assert.equal(s.text, 'No approval needed')
})

// ── the wording itself ──────────────────────────────────────────────────────

test('a role label is shortened only when it carries a code', () => {
  assert.equal(shortRole('Reporting manager (R1)'), 'R1')
  assert.equal(shortRole('Head of department'), 'Head of department')
  assert.equal(shortRole('Finance (L2)'), 'L2')
})

test('a step with no named person falls back to its role', () => {
  // A team step has no approver_id. "Waiting on Finance" is still useful;
  // "Waiting on null" is not.
  const s = chainState([step(1, 'Finance', 'pending', null)])
  assert.equal(s.text, 'Waiting on Finance')
})

test('the tone matches the state', () => {
  assert.equal(chainTone('approved'), 'pos')
  assert.equal(chainTone('none'), 'pos')
  assert.equal(chainTone('rejected'), 'crit')
  assert.equal(chainTone('sent_back'), 'warn')
  assert.equal(chainTone('part'), 'warn')
  assert.equal(chainTone('waiting'), 'warn')
})
