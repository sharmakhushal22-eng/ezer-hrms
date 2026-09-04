// The login lock-out, as tests.
//
// The bug: somebody signs in successfully on the dashboard and is bounced
// straight back to the login screen. Cause — authToken() prefers the ESS
// session over the Supabase one, so anybody who had used the ESS portal kept
// sending that token. Once it expired the server could not verify it as an
// ESS token, could not read it as a Supabase JWT either, and returned an
// empty grant. The valid Supabase session was never tried.
//
// Nothing covered this, because the logic lived inside an async function that
// needed fetch, localStorage and a Supabase client. It is pure now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grantIsUseless, shouldDropEssToken } from '../grant-state.ts'

// ── what "signed in" means to the dashboard gate ──────────────────────────

test('an empty grant is useless — this is what the server returns for a dead token', () => {
  assert.equal(grantIsUseless({ employeeId: null, legacy: false }), true)
  assert.equal(grantIsUseless({}), true)
  assert.equal(grantIsUseless(null), true)
  assert.equal(grantIsUseless(undefined), true)
})

test('a real employee grant is not useless', () => {
  assert.equal(grantIsUseless({ employeeId: 'e-123' }), false)
})

test('the legacy shared login counts as signed in', () => {
  // legacyGrant() sets no employeeId — only this flag. Treating it as useless
  // would log out every dashboard user who is not attached to an employee row.
  assert.equal(grantIsUseless({ employeeId: null, legacy: true }), false)
})

// ── when to throw the ESS token away ──────────────────────────────────────

test('THE BUG: a dead ESS token with a Supabase session behind it is dropped', () => {
  assert.equal(shouldDropEssToken({
    usedEssToken: true,
    grant: { employeeId: null, legacy: false },   // what came back
    hasSupabaseSession: true,                     // what was never tried
  }), true)
})

test('a WORKING ESS login is never disturbed', () => {
  // The regression that would hurt most: signing ESS users out of ESS.
  assert.equal(shouldDropEssToken({
    usedEssToken: true,
    grant: { employeeId: 'e-9' },
    hasSupabaseSession: true,
  }), false)
})

test('nothing is dropped when there is no session to fall back to', () => {
  // Without this guard we would replace a bad token with no token, log the
  // person out of ESS as well, and still show them the login screen.
  assert.equal(shouldDropEssToken({
    usedEssToken: true,
    grant: { employeeId: null },
    hasSupabaseSession: false,
  }), false)
})

test('a token we never used is not thrown away', () => {
  assert.equal(shouldDropEssToken({
    usedEssToken: false,
    grant: { employeeId: null },
    hasSupabaseSession: true,
  }), false)
})

test('it retries once, never in a loop', () => {
  assert.equal(shouldDropEssToken({
    usedEssToken: true,
    grant: { employeeId: null },
    hasSupabaseSession: true,
    alreadyRetried: true,
  }), false)
})

test('a legacy grant from the ESS token is left alone', () => {
  // Useless is the trigger, not "came from ESS". A grant that works is a
  // grant that works, whichever token produced it.
  assert.equal(shouldDropEssToken({
    usedEssToken: true,
    grant: { employeeId: null, legacy: true },
    hasSupabaseSession: true,
  }), false)
})
