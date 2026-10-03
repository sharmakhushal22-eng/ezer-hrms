// lib/ess/__tests__/viewas-messages.test.ts — an ESS write refusal must say WHICH
// of the two situations it is.
//
// WHY THIS FILE EXISTS
//
// essCaller() sets viewAs for two unrelated reasons (lib/ess/session.ts):
//
//   · a real person is looking at a colleague's portal   → actorEmployeeId set
//   · the session is not attached to an employee at all  → actorEmployeeId null
//
// The second case catches the legacy dashboard login AND — the one that bit a
// user — an ESS employee whose token has simply EXPIRED. authToken() falls back
// to the Supabase session when essToken() returns null, verifyEssToken then
// fails server-side, and requireDashboardUser returns kind:'legacy' with
// employeeId null. The route's GET still answers, because it reads the employee
// id from the query string, so a form fills in perfectly and only the submit is
// refused — with a message telling the person they were impersonating somebody.
//
// Four routes (wall, funzone, profile, profile/requests) were fixed to split on
// actorEmployeeId. Eight were missed, which is how the MRF one survived. This
// test is the thing that would have caught that, so the next route to grow a
// viewAs guard cannot repeat it.
//
// It reads the routes as text rather than invoking them: calling a Next route
// handler needs a NextRequest, a verified token and a live database, and a test
// that needs all three to check a string is a test nobody runs. The cost is
// that a rename breaks it — which is the point, because a human then re-reads
// the gate.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ESS_API = 'app/api/ess'

/** Every route.ts under app/api/ess, recursively. */
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (entry === 'route.ts') out.push(p)
  }
  return out
}

const ROUTES = routeFiles(ESS_API).map(path => ({ path, src: readFileSync(path, 'utf8') }))

/**
 * Routes that REFUSE on viewAs — not merely mention it.
 *
 * menu and session report `view_as` as data for the UI and refuse nothing, so
 * the rule below does not apply to them; an earlier version of this file
 * demanded an actorEmployeeId branch from them and failed, which was the test
 * being wrong rather than the routes.
 *
 * Refusals take three shapes in this tree, and all three must be recognised:
 * forbidden(...), bad(..., 403) and a direct NextResponse.json(..., {status:403}).
 * Matching only the first two mislabelled social and id-card/token as harmless
 * reporters when they in fact carried the bug.
 */
const REFUSAL = /(forbidden\(|bad\(|status:\s*403)/
// `caller.viewAs` with no leading dot on purpose. The accessor is spelled three
// ways in this tree — ctx.caller.viewAs, c.caller.viewAs and a destructured
// caller.viewAs (session/route.ts) — and an earlier /\.caller\.viewAs/ missed
// the third, leaving any route written that way outside this check altogether.
// A guard with a blind spot is worse than no guard, because it reads as covered.
const GATED = ROUTES.filter(r => /caller\.viewAs/.test(r.src) && REFUSAL.test(r.src))

// ── The parse itself, guarded ────────────────────────────────────────────────
// Every assertion below is worthless if these lists came back empty.

test('the ESS route tree was actually read', () => {
  assert.ok(ROUTES.length >= 15,
    `found ${ROUTES.length} route.ts files under ${ESS_API}, expected 15+ — the walk broke, not the routes`)
  assert.ok(GATED.length >= 8,
    `found ${GATED.length} routes gating on viewAs, expected 8+ — the regex matched nothing`)
  // Sentinels: the two ends of the behaviour this file is about.
  const paths = GATED.map(r => r.path)
  assert.ok(paths.some(p => p.includes('ess/mrf')), `mrf route missing from: ${paths.join(', ')}`)
  assert.ok(paths.some(p => p.includes('ess/wall')), `wall route missing from: ${paths.join(', ')}`)
})

// ── The rule ────────────────────────────────────────────────────────────────

describe('a viewAs refusal distinguishes the two situations', () => {
  for (const { path, src } of GATED) {
    test(`${path} splits on actorEmployeeId`, () => {
      assert.ok(/actorEmployeeId/.test(src),
        `${path} refuses on viewAs but never reads actorEmployeeId, so it cannot tell ` +
        '"an admin is viewing a colleague" from "this session has no employee behind it ' +
        '— sign in again". An ESS employee with a lapsed token gets accused of ' +
        'impersonating somebody. See the header of this file.')
    })
  }

  test('no route refuses on bare viewAs in a single undifferentiated line', () => {
    const offenders: string[] = []
    for (const { path, src } of GATED) {
      // The shape that caused the bug: the whole refusal on one line, with no
      // branch on who the caller actually is.
      for (const line of src.split('\n')) {
        if (/\.caller\.viewAs\)\s*return\s+(forbidden|bad)\(/.test(line) && !/actorEmployeeId/.test(line)) {
          offenders.push(`${path}: ${line.trim()}`)
        }
      }
    }
    assert.deepEqual(offenders, [],
      'these refuse on viewAs without saying which situation it is:\n  ' + offenders.join('\n  '))
  })
})

// ── The wording, for the case people actually hit ───────────────────────────

describe('the no-employee branch tells the person what to do', () => {
  for (const { path, src } of GATED) {
    test(`${path} says to sign in again`, () => {
      // Scoped to the null branch, NOT the whole file: an earlier version
      // grepped the file and would have passed on any route that happened to
      // contain the words elsewhere — a check that cannot fail is not a check.
      const i = src.indexOf('actorEmployeeId === null')
      assert.ok(i !== -1, `${path}: no actorEmployeeId === null branch to inspect`)
      // The branch is the next ~400 characters: the ternary's first arm.
      const branch = src.slice(i, i + 400)
      assert.ok(/sign in/i.test(branch),
        `${path} has an actorEmployeeId === null branch but it never tells the person to ` +
        'sign in with their own ESS account, which is the only thing that fixes a lapsed ' +
        `session. Branch text was:\n${branch.slice(0, 220)}`)
    })
  }
})

// ── The client half ─────────────────────────────────────────────────────────

test('the MRF form checks for a lapsed session before submitting', () => {
  const form = readFileSync('components/ess/MrfForm.tsx', 'utf8')
  assert.ok(/essSessionExpired\(\)/.test(form),
    'MrfForm must check essSessionExpired() before POSTing: the GET that loads the form ' +
    'succeeds under a lapsed ESS token, so without this the whole form is filled in ' +
    'before anything says the session is dead')
  assert.ok(/import \{ essSessionExpired \}/.test(form),
    'essSessionExpired must be imported, not assumed global')
})

test('essSessionExpired is exported for that purpose', () => {
  const client = readFileSync('lib/ess-session-client.ts', 'utf8')
  assert.ok(/export function essSessionExpired/.test(client),
    'the helper the form depends on must stay exported')
})
