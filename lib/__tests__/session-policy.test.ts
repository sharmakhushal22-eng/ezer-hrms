// lib/__tests__/session-policy.test.ts — when a browser session counts as expired.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionState, tokenExpOf, isGuardedPath, loginPathFor, isStaleBuildError, MAX_SESSION_HOURS } from '../session-policy.ts'

const now = Date.UTC(2026, 9, 25, 12)
const H = 3600_000
const tok = (exp: number) => Buffer.from(JSON.stringify({ sub: 'e1', exp })).toString('base64url') + '.sig'
const dec = (b: string) => Buffer.from(b, 'base64').toString('utf8')

test('ESS token: live, then expired', () => {
  const ess = { employee_id: 'e1', token: tok(now + H) }
  assert.equal(sessionState({ now, ess, tokenExp: tokenExpOf(ess.token, dec), supabase: false, loginAt: now - H }), 'ok')
  const old = { employee_id: 'e1', token: tok(now - 1) }
  assert.equal(sessionState({ now, ess: old, tokenExp: tokenExpOf(old.token, dec), supabase: false, loginAt: now - H }), 'expired')
})

test('an unreadable token is not trusted', () => {
  assert.equal(sessionState({ now, ess: { employee_id: 'e1', token: 'junk' }, tokenExp: tokenExpOf('junk', dec), supabase: true, loginAt: now }), 'expired')
})

test('a Supabase-backed session ends MAX_SESSION_HOURS after login, however it refreshes', () => {
  const ess = { employee_id: 'e1', token: null }
  assert.equal(sessionState({ now, ess, tokenExp: null, supabase: true, loginAt: now - H }), 'ok')
  assert.equal(sessionState({ now, ess, tokenExp: null, supabase: true, loginAt: now - (MAX_SESSION_HOURS + 1) * H }), 'expired')
  assert.equal(sessionState({ now, ess: null, tokenExp: null, supabase: true, loginAt: now - (MAX_SESSION_HOURS + 1) * H }), 'expired')
})

test('an ESS session with no token and no Supabase session is expired; nothing at all is none', () => {
  assert.equal(sessionState({ now, ess: { employee_id: 'e1', token: null }, tokenExp: null, supabase: false, loginAt: now }), 'expired')
  assert.equal(sessionState({ now, ess: null, tokenExp: null, supabase: false, loginAt: null }), 'none')
})

test('guarded paths and where to sign in', () => {
  assert.ok(isGuardedPath('/ess') && isGuardedPath('/ess/leave') && isGuardedPath('/dashboard/payroll'))
  assert.ok(!isGuardedPath('/ess-login') && !isGuardedPath('/') && !isGuardedPath('/onboarding/abc') && !isGuardedPath('/salary-view/x'))
  assert.equal(loginPathFor('/dashboard/x'), '/?expired=1')
  assert.equal(loginPathFor('/ess/today'), '/ess-login?expired=1')
})

test('stale-build errors', () => {
  assert.ok(isStaleBuildError('ChunkLoadError: Loading chunk 123 failed.'))
  assert.ok(isStaleBuildError('Failed to fetch dynamically imported module: https://x/_next/a.js'))
  assert.ok(!isStaleBuildError('TypeError: x is undefined'))
})
