import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROUTES, tabTarget } from '../schema.ts'

// The portal's nav keys, read from the component so this test fails when a tab
// is renamed there rather than quietly pointing Today at a key nobody serves.
const portal = readFileSync('components/ess/EmployeePortal.tsx', 'utf8')
const NAV_KEYS = new Set([...portal.matchAll(/\bk:\s*'([a-z0-9_]+)'/g)].map(m => m[1]))

test('the portal nav was parsed at all', () => {
  assert.ok(NAV_KEYS.size > 20, `only found ${NAV_KEYS.size} keys — the parse broke, not the routes`)
  assert.ok(NAV_KEYS.has('home') && NAV_KEYS.has('leave'))
})

test('every quick action points at a tab the portal has', () => {
  for (const [name, to] of Object.entries(ROUTES)) {
    const k = tabTarget(to)
    assert.ok(k, `${name} (${to}) is not a tab target`)
    assert.ok(NAV_KEYS.has(k!), `${name} → '${k}' is not a nav key in EmployeePortal`)
  }
})

test('no route is left over from the drop', () => {
  for (const [name, to] of Object.entries(ROUTES))
    assert.ok(!to.startsWith('/ess/'), `${name} still uses the drop's /ess/* tree, which does not exist`)
})

test('tabTarget reads both forms, and lets real links through', () => {
  assert.equal(tabTarget('tab:leave'), 'leave')
  assert.equal(tabTarget('/dashboard/ess?tab=approvals'), 'approvals')
  assert.equal(tabTarget('/ess-portal?foo=1&tab=Inbox'), 'inbox')
  assert.equal(tabTarget('/dashboard/employees'), null)
  assert.equal(tabTarget('https://example.com/x'), null)
  assert.equal(tabTarget('tab:'), null)
})
