// lib/recruitment/__tests__/mrf-assignment-rule.test.ts — approving the step that opens an
// MRF must hand the requisition to somebody.
//
// WHY THIS FILE EXISTS
//
// The approval that opens a requisition IS the hand-off. "Assigned to you" reads
// manpower_requisitions.assigned_recruiter_ids, so approving with an empty one opens a
// requisition that reaches no queue at all.
//
// The rule was fixed once at four separate writes (a767c8a, 3823b5f, 1cce8cc, ac37d83) and
// then lost in later merges ("main's recruitment flow wins"), so an HR Head could again
// approve from the HR Head tab with one click and nobody assigned. It now lives in ONE
// server function, lib/recruitment/mrf-approve.ts, and every screen that approves an MRF
// calls an endpoint that uses it. This file checks the rule itself and that no screen
// writes APPROVED on its own again.
//
// The hand-off is the LAST step, not merely the one called HR_HEAD: when the HR Head is
// also the raiser's manager the chain is a single RM2 step, and a chainless MRF is opened
// by one decision.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isHandOff, cleanIds, strays } from '../mrf-handoff.ts'

describe('isHandOff', () => {
  test('the HR Head step is the hand-off', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'APPROVED' }, { role: 'HR_HEAD', status: 'PENDING' }]), true)
  })
  test('an RM2 step with the HR Head still waiting is not', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'PENDING' }, { role: 'HR_HEAD', status: 'WAITING' }]), false)
  })
  test('a lone RM2 step (the HR Head is the raiser\'s manager) is the hand-off', () => {
    assert.equal(isHandOff([{ role: 'RM2', status: 'PENDING' }]), true)
  })
  test('no chain, or nothing pending, is opened by one decision', () => {
    assert.equal(isHandOff([]), true)
    assert.equal(isHandOff(null), true)
    assert.equal(isHandOff([{ role: 'RM2', status: 'APPROVED' }]), true)
  })
})

test('cleanIds and strays', () => {
  assert.deepEqual(cleanIds(['a', 'a', ' b ', '', null]), ['a', 'b'])
  assert.deepEqual(cleanIds('a'), [])
  assert.deepEqual(strays(['a', 'x'], ['a', 'b']), ['x'])
})

const read = (p: string) => readFileSync(p, 'utf8')
const LIB = read('lib/recruitment/mrf-approve.ts')
const ESS = read('app/api/ess/mrf/route.ts')
const DECIDE = read('app/api/recruitment/mrf-decision/route.ts')
const PAGE = read('app/dashboard/recruitment/page.tsx')
const OFFER = read('app/dashboard/recruitment/offer-flow-components.tsx')
const ESSLIB = read('lib/supabase-ess.ts')
const ROLETABS = read('components/ess/RoleTabs.tsx')

describe('the server refuses an unassigned hand-off', () => {
  test('before anything is written', () => {
    const guard = LIB.indexOf('if (handOff && !inp.assignIds.length)')
    const write = LIB.indexOf(".from('manpower_requisitions').update(")
    assert.ok(guard !== -1 && write !== -1 && guard < write)
  })
  test('assignees must be recruiters of the MRF\'s own company', () => {
    assert.ok(/hrTeamFor\(sb, mrf\.company_id\)/.test(LIB) && /strays\(/.test(LIB))
  })
  test('both endpoints approve through it', () => {
    assert.ok(/approveMrf\(sb as any, \{/.test(ESS), 'ESS approve must use lib/recruitment/mrf-approve')
    assert.ok(/approveMrf\(sb as any, \{/.test(DECIDE), 'dashboard approve must use lib/recruitment/mrf-approve')
    assert.ok(/requireModule\(req, 'Recruitment'\)/.test(DECIDE))
  })
})

describe('no screen writes an MRF approval itself', () => {
  // A browser write of status APPROVED on manpower_requisitions skips the rule. Reopening a
  // CLOSED requisition (status back to APPROVED on an already-assigned MRF) is the one
  // legitimate case, and it never carries approved_at.
  for (const [name, src] of [['recruitment/page.tsx', PAGE], ['offer-flow-components.tsx', OFFER], ['lib/supabase-ess.ts', ESSLIB]] as const) {
    test(name, () => {
      assert.ok(!/manpower_requisitions'\)\s*\.update\(\{[^}]*approved_at/.test(src), `${name} writes approved_at directly`)
      assert.ok(!/status: ?'APPROVED', ?approved_at/.test(src), `${name} stamps APPROVED directly`)
    })
  }
  test('the dashboard screens call the decision endpoint', () => {
    for (const src of [PAGE, OFFER, ESSLIB]) assert.ok(src.includes("'/api/recruitment/mrf-decision'"))
  })
  test('the pickers use the hand-off rule, not role === HR_HEAD', () => {
    assert.ok(/isHandOff\(m\.approval_chain\)/.test(ROLETABS))
    assert.ok(/isHandOff\(reviewMrf\.approval_chain\)/.test(PAGE))
  })
  test('the HR Head tab asks for the assignment before approving', () => {
    assert.ok(/function MrfAssignPanel\(/.test(OFFER) && /<MrfAssignPanel /.test(OFFER))
  })
})
