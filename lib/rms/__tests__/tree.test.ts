import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildForest, flatten, pathTo, countNodes } from '../tree.ts'

interface R { id: string; managerId: string | null; fullName: string }
const r = (id: string, managerId: string | null, fullName: string): R => ({ id, managerId, fullName })

describe('buildForest', () => {
  test('a manager id that is not in the list becomes a root', () => {
    const forest = buildForest([r('a', 'ghost', 'A')])
    assert.equal(forest.length, 1)
    assert.equal(forest[0].node.id, 'a')
  })

  test('nests children under their manager', () => {
    const forest = buildForest([r('md', null, 'MD'), r('a', 'md', 'A'), r('b', 'a', 'B')])
    assert.equal(forest.length, 1)
    assert.equal(forest[0].children[0].node.id, 'a')
    assert.equal(forest[0].children[0].children[0].node.id, 'b')
  })

  test('several roots produce a forest, not a single tree', () => {
    const forest = buildForest([r('a', null, 'A'), r('b', null, 'B')])
    assert.equal(forest.length, 2)
  })

  test('siblings and roots are sorted by name, deterministically', () => {
    const forest = buildForest([r('md', null, 'MD'), r('z', 'md', 'Zara'), r('a', 'md', 'Amit')])
    assert.deepEqual(forest[0].children.map(c => c.node.id), ['a', 'z'])
  })

  test('an empty list produces an empty forest', () => {
    assert.deepEqual(buildForest([]), [])
  })
})

describe('flatten', () => {
  test('visits root before children, depth-first', () => {
    const forest = buildForest([r('md', null, 'MD'), r('a', 'md', 'A'), r('b', 'a', 'B'), r('c', 'md', 'C')])
    assert.deepEqual(flatten(forest).map(n => n.node.id), ['md', 'a', 'b', 'c'])
  })
})

describe('pathTo', () => {
  const forest = buildForest([r('md', null, 'MD'), r('a', 'md', 'A'), r('b', 'a', 'B')])

  test('returns the chain from the root down to the node, inclusive', () => {
    assert.deepEqual(pathTo(forest, 'b').map(n => n.node.id), ['md', 'a', 'b'])
  })

  test('the root\'s own path is just itself', () => {
    assert.deepEqual(pathTo(forest, 'md').map(n => n.node.id), ['md'])
  })

  test('an id not in the forest returns an empty path rather than throwing', () => {
    assert.deepEqual(pathTo(forest, 'nobody'), [])
  })
})

describe('countNodes', () => {
  test('counts every node in every tree of the forest', () => {
    const forest = buildForest([r('a', null, 'A'), r('b', 'a', 'B'), r('c', null, 'C')])
    assert.equal(countNodes(forest), 3)
  })

  test('an empty forest counts zero', () => {
    assert.equal(countNodes([]), 0)
  })
})
