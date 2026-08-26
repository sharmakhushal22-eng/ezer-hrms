import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChain, findCycle, directReports, allReports, upwardChain,
  isRelationshipType, type Relationship, type ManagerRef,
} from '../hierarchy.ts'

const person = (id: string, name: string): ManagerRef => ({
  id, emp_code: id, full_name: name, designation: 'Manager',
  department: 'Ops', office_email: null, personal_email: null,
})

const managers: Record<string, ManagerRef> = {
  shyam: person('shyam', 'Shyam'),
  rahul: person('rahul', 'Rahul'),
  amit:  person('amit',  'Amit'),
}

const rel = (e: string, m: string, t: any): Relationship => ({
  employee_id: e, manager_employee_id: m, relationship_type: t,
})

describe('the management chain', () => {
  test('comes back in display order, whatever order the rows arrive in', () => {
    const chain = buildChain(
      [rel('a', 'amit', 'HOD'), rel('a', 'shyam', 'L1'), rel('a', 'rahul', 'L2')],
      managers,
    )
    assert.deepEqual(chain.map(c => c.relationship_type), ['L1', 'L2', 'HOD'])
    assert.equal(chain[0].manager?.full_name, 'Shyam')
    assert.equal(chain[2].manager?.full_name, 'Amit')
  })

  test('a level nobody is mapped to is absent, not present-and-empty', () => {
    const chain = buildChain([rel('a', 'shyam', 'L1')], managers)
    assert.equal(chain.length, 1)
    assert.equal(chain[0].relationship_type, 'L1')
  })

  test('an employee at the top of the chain has no levels at all', () => {
    assert.deepEqual(buildChain([], managers), [])
  })

  test('a manager the lookup does not know renders as null rather than throwing', () => {
    const chain = buildChain([rel('a', 'ghost', 'L1')], managers)
    assert.equal(chain.length, 1)
    assert.equal(chain[0].manager, null)
  })

  test('only real relationship types are accepted', () => {
    assert.equal(isRelationshipType('L1'), true)
    assert.equal(isRelationshipType('HOD'), true)
    assert.equal(isRelationshipType('L9'), false)
    assert.equal(isRelationshipType('MENTOR'), false)
  })
})

describe('cycle detection', () => {
  test('somebody cannot be their own manager', () => {
    assert.deepEqual(findCycle('a', 'a', new Map()), ['a', 'a'])
  })

  test('a straight chain is not a cycle', () => {
    const edges = new Map([['b', 'c'], ['c', 'd']])
    assert.equal(findCycle('a', 'b', edges), null)
  })

  test('a loop back to the employee is caught', () => {
    // a -> b -> c, and we are asked to make c report to a
    const edges = new Map([['a', 'b'], ['b', 'c']])
    const cycle = findCycle('c', 'a', edges)
    assert.ok(cycle, 'expected a cycle')
    assert.equal(cycle![0], 'c')
    assert.equal(cycle![cycle!.length - 1], 'c')
  })

  test('a loop that does not include the employee is still reported', () => {
    const edges = new Map([['b', 'c'], ['c', 'b']])
    assert.ok(findCycle('a', 'b', edges))
  })

  test('a chain longer than the depth limit is treated as suspect rather than walked forever', () => {
    const edges = new Map<string, string>()
    for (let i = 0; i < 200; i++) edges.set(`n${i}`, `n${i + 1}`)
    const out = findCycle('start', 'n0', edges, 10)
    assert.ok(out, 'expected the walk to give up and report')
    assert.ok(out!.length <= 13)
  })
})

describe('reports', () => {
  const rels = [
    rel('e1', 'm1', 'L1'), rel('e2', 'm1', 'L1'),
    rel('e3', 'm2', 'L1'), rel('m2', 'm1', 'L1'),
    rel('e1', 'm9', 'L2'),
  ]

  test('direct reports are the people one level below', () => {
    assert.deepEqual(directReports(rels, 'm1', 'L1').sort(), ['e1', 'e2', 'm2'])
  })

  test('asking without a level returns every relationship pointing at the manager', () => {
    assert.deepEqual(directReports(rels, 'm9').sort(), ['e1'])
  })

  test('a manager nobody reports to gets an empty list', () => {
    assert.deepEqual(directReports(rels, 'nobody'), [])
  })

  test('the full tree follows L1 downward', () => {
    assert.deepEqual(allReports(rels, 'm1').sort(), ['e1', 'e2', 'e3', 'm2'])
    assert.deepEqual(allReports(rels, 'm2').sort(), ['e3'])
  })

  test('bad data cannot hang the walk', () => {
    const looped = [rel('x', 'y', 'L1'), rel('y', 'x', 'L1')]
    const out = allReports(looped, 'x')
    assert.ok(out.length <= 2)
  })
})

describe('upward chain', () => {
  test('walks to the top', () => {
    const edges = new Map([['a', 'b'], ['b', 'c'], ['c', 'd']])
    assert.deepEqual(upwardChain(edges, 'a'), ['b', 'c', 'd'])
  })

  test('stops at somebody with no manager', () => {
    assert.deepEqual(upwardChain(new Map(), 'a'), [])
  })

  test('stops instead of looping when the data is circular', () => {
    const edges = new Map([['a', 'b'], ['b', 'a']])
    assert.deepEqual(upwardChain(edges, 'a'), ['b'])
  })
})
