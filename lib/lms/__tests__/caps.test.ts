// Content and assignment are separate jobs. These pin the separation to the levels HR sets.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasAnyLmsCap, lmsCaps, moduleOfCap } from '../caps.ts'
import { canSeeAny } from '../../rms/resolve.ts'
import { modulesForPath } from '../../rms/modules.ts'

const g = (modules: Record<string, string>, o = {}) => ({ modules, isSuperAdmin: false, legacy: false, ...o }) as any

describe('learning capabilities', () => {
  it('a content author writes and does nothing else', () => {
    const c = lmsCaps(g({ 'Learning Content': 'EDIT' }))
    assert.deepEqual([c.editContent, c.publish, c.assign, c.reports], [true, false, false, false])
  })
  it('a coordinator assigns and cannot change content', () => {
    const c = lmsCaps(g({ 'Learning Content': 'VIEW', 'Learning Assignment': 'EDIT', 'Learning Reports': 'VIEW' }))
    assert.deepEqual([c.viewContent, c.editContent, c.assign, c.automate, c.reports], [true, false, true, false, true])
  })
  it('publishing and automation take FULL', () => {
    const c = lmsCaps(g({ 'Learning Content': 'FULL', 'Learning Assignment': 'FULL' }))
    assert.deepEqual([c.publish, c.automate], [true, true])
  })
  it('a super admin and the legacy login hold everything', () => {
    assert.ok(Object.values(lmsCaps(g({}, { isSuperAdmin: true }))).every(Boolean))
    assert.ok(Object.values(lmsCaps(g({}, { legacy: true }))).every(Boolean))
  })
  it('an employee holds nothing here, even while module enforcement is off', () => {
    assert.equal(hasAnyLmsCap(lmsCaps(g({}, { enforced: false }))), false)
  })
  it('each capability is judged by its own module', () => {
    assert.equal(moduleOfCap('publish'), 'Learning Content')
    assert.equal(moduleOfCap('automate'), 'Learning Assignment')
    assert.equal(moduleOfCap('reports'), 'Learning Reports')
  })
})

describe('the shared screen', () => {
  it('opens for any one of the three modules', () => {
    const mods = modulesForPath('/dashboard/learning')
    assert.equal(mods.length, 3)
    for (const m of mods) assert.equal(canSeeAny({ enforced: true, modules: { [m]: 'VIEW' } } as any, mods), true)
    assert.equal(canSeeAny({ enforced: true, modules: {} } as any, mods), false)
  })
  it('leaves every other screen on its single module', () => {
    assert.deepEqual(modulesForPath('/dashboard/payroll/run'), ['Payroll'])
    assert.deepEqual(modulesForPath('/dashboard'), [])
  })
})
