// A Performance admin scoped to one company cannot write another's.
//
// ── THE GAP ──────────────────────────────────────────────────────────────
//
// app/api/pms/admin/route.ts gated every write on canManage(grant,
// 'Performance'). That is an ACCESS LEVEL — atLeast(g.modules[m], 'FULL') —
// and it says nothing about WHICH company. Company scoping is a separate
// choke-point: companyFilter in lib/rms/resolve.ts.
//
// companyFilter was called on the four INSERT paths and on NONE of the
// eleven that address an existing row, each of which took its id straight
// from the request body and ran through rmsServiceClient — the service-role
// key, so RLS was not behind it either. Three organisations share this
// database; the route's own GET returns all of their policies, periods,
// bands, KRAs and chains to anyone who passes the same gate. The ids needed
// were not guessable, they were handed over.
//
// ── WHAT IS TESTED HERE, AND HOW ─────────────────────────────────────────
//
// The decision is pure and lives in lib/pms/tenancy.ts, so most of this file
// asks it questions rather than reading source for the shape of an if.
//
// The rest checks the WIRING, where regex is the only tool available — Node
// cannot mount the route with a live Supabase behind it, as
// chain-admin-route.test.ts explains. The most important of those is
// completeness: the fix is only as good as the list of actions it covers,
// and the failure mode it is guarding against is somebody adding a
// sixteenth action and not thinking about companies at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scopeVerdict, scopeRefusal } from '../tenancy.ts'

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
}
const RAW   = readFileSync(join(process.cwd(), 'app/api/pms/admin/route.ts'), 'utf8')
const ROUTE = code(RAW)

/** One company's admin: Performance = FULL, valid in ACME only. */
const scoped = {
  crossCompany: false, companyId: 'acme', allowed: ['acme'],
}

// ═══ the decision ════════════════════════════════════════════════════════

test('a scoped admin may act on their own company\'s row', () => {
  assert.equal(scopeVerdict({ ...scoped, owner: 'acme' }), 'ALLOWED')
})

test('a scoped admin may NOT act on another company\'s row', () => {
  assert.equal(scopeVerdict({ ...scoped, owner: 'beta' }), 'ANOTHER_COMPANY')
})

test('a role valid in several companies covers all of them', () => {
  const multi = { crossCompany: false, companyId: 'acme',
                  allowed: ['acme', 'beta'] }
  assert.equal(scopeVerdict({ ...multi, owner: 'beta' }), 'ALLOWED')
  assert.equal(scopeVerdict({ ...multi, owner: 'gamma' }), 'ANOTHER_COMPANY')
})

test('editing a group row takes group reach; referencing one does not', () => {
  // The two libraries that allow a null company — the chain library and the
  // training catalogue — are shared deliberately. Changing a shared row
  // changes it for everybody, so that needs the reach. Pointing a policy at
  // one is the whole purpose of having it.
  assert.equal(scopeVerdict({ ...scoped, owner: null }), 'WHOLE_GROUP')
  assert.equal(scopeVerdict({ ...scoped, owner: null, groupIsFine: true }),
    'ALLOWED')
})

test('nobody who already reaches across companies is narrowed', () => {
  // All three shapes companyFilter treats as unrestricted, including the
  // legacy shared dashboard login — no employee row, so no companyId. If
  // this ever stopped being true the current dashboard would lock itself
  // out of two companies' configuration.
  const everywhere = [
    { crossCompany: true,  companyId: 'acme', allowed: ['acme'] },   // ORG / super admin
    { crossCompany: false, companyId: null,   allowed: [] },         // legacy login
    { crossCompany: false, companyId: undefined, allowed: [] },
  ]
  for (const who of everywhere) {
    for (const owner of ['acme', 'beta', null]) {
      assert.equal(scopeVerdict({ ...who, owner }), 'ALLOWED',
        `${JSON.stringify(who)} was narrowed on owner=${owner}`)
    }
  }
})

test('an empty company list is not read as "everywhere"', () => {
  // The dangerous reading of allowedCompanies returning []. It only does so
  // when there is no company at all, which the branch above already allows;
  // reaching here with [] means the roles are valid nowhere.
  assert.equal(scopeVerdict({ crossCompany: false, companyId: 'acme',
                              allowed: [], owner: 'acme' }), 'ANOTHER_COMPANY')
})

test('a refusal does not name the other company', () => {
  // A refusal must not double as a way to enumerate the database.
  const msg = scopeRefusal('ANOTHER_COMPANY')
  assert.ok(!/beta|acme/i.test(msg))
  assert.notEqual(scopeRefusal('WHOLE_GROUP'), msg,
    'both refusals read the same, so neither says what to do next')
})

// ═══ the wiring ══════════════════════════════════════════════════════════

/** Every `case 'x':` in the POST switch. */
function switchCases(): string[] {
  const post = ROUTE.slice(ROUTE.indexOf('switch (action)'))
  return [...post.matchAll(/case '([a-z_]+)'/g)].map(m => m[1])
}

/** Every key of the SCOPED_BY map. */
function scopedActions(): string[] {
  const m = ROUTE.match(/const SCOPED_BY[^=]*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(m, 'SCOPED_BY is not in the route in the shape this reads')
  return [...m![1].matchAll(/^\s{2}([a-z_]+):/gm)].map(x => x[1])
}

test('EVERY action that writes is declared in SCOPED_BY', () => {
  // The point of the whole arrangement. A check written inside the switch
  // would have been fifteen chances to leave one out; declared in a map, an
  // omission is a missing key and this fails.
  const cases = switchCases()
  assert.ok(cases.length >= 15,
    `only found ${cases.length} cases — the switch has changed shape`)
  const declared = new Set(scopedActions())
  const missing = cases.filter(c => !declared.has(c))
  assert.deepEqual(missing, [],
    'these actions write but no company check covers them. Add each to '
    + 'SCOPED_BY with the table its id lives in — or, if it genuinely names '
    + 'no row, say so there rather than leaving it absent.')
})

test('SCOPED_BY has no entry for an action that no longer exists', () => {
  // The other direction: a stale entry is a check that silently guards
  // nothing, and reads as coverage.
  const cases = new Set(switchCases())
  const stale = scopedActions().filter(a => !cases.has(a))
  assert.deepEqual(stale, [], 'SCOPED_BY names actions the switch does not')
})

test('each declared table is one a company owns', () => {
  const m = ROUTE.match(/const SCOPED_BY[^=]*=\s*\{([\s\S]*?)\n\}/)!
  const tables = [...m[1].matchAll(/table:\s*'([a-z_]+)'/g)].map(x => x[1])
  assert.equal(tables.length, scopedActions().length,
    'an entry has no table')
  for (const t of tables) {
    assert.match(t, /^pms_(policies|periods|rating_scale|kra_master|chain|training_catalogue)$/,
      `${t} is not a table this guard knows how to find a company on`)
  }
})

test('the gate runs the check, before the switch and after the level', () => {
  const g = ROUTE.slice(ROUTE.indexOf('async function gate(req'),
                        ROUTE.indexOf('// ─── GET'))
  assert.ok(/outOfScope\(grant, action, body/.test(g),
    'gate does not run the company check, so the switch is reached unguarded')
  // Order matters both ways: what a caller may do is asked first, whose row
  // it is second — and both before an actor is resolved and anything runs.
  assert.ok(g.indexOf('canManage(grant') < g.indexOf('outOfScope(grant'),
    'the company check runs before the access level is known')
  assert.ok(g.indexOf('outOfScope(grant') < g.indexOf('actorFromRequest'),
    'the company check runs after the request has already been acted on')
})

test('an unreadable row is refused, not waved through', () => {
  // uploadAllowed deliberately falls back to permissive when its read fails,
  // and says why. That reasoning is right for "what does this feature
  // allow" and wrong for a tenancy boundary: a database hiccup must not
  // hand somebody another company's data.
  const f = ROUTE.slice(ROUTE.indexOf('async function rowOutOfScope'),
                        ROUTE.indexOf('async function outOfScope'))
  assert.match(f, /if \(r\.error\) \{[\s\S]*?return bad\(/,
    'a failed read does not refuse')
  assert.ok(!/if \(r\.error\) return null/.test(f),
    'a failed read is waved through')
  assert.match(f, /if \(!r\.data\) \{[\s\S]*?return bad\(/,
    'a missing row does not refuse')
})

test('the destination of a move is checked, not just the row moved', () => {
  // Both are the same leak wearing different clothes: a row of ours pointed
  // at another company's.
  const scale = ROUTE.slice(ROUTE.indexOf("case 'scale_upsert'"),
                            ROUTE.indexOf("case 'periods_generate'"))
  assert.ok(/rowOutOfScope\(\s*g\.grant, 'pms_policies'/.test(scale),
    'scale_upsert sets policy_id without checking whose policy it is')

  const policy = ROUTE.slice(ROUTE.indexOf("case 'policy_update'"),
                             ROUTE.indexOf("case 'scale_upsert'"))
  assert.ok(/rowOutOfScope\(\s*g\.grant, 'pms_chain'[\s\S]*?groupIsFine: true/.test(policy),
    'policy_update sets chain_id without checking whose chain it is — or '
    + 'checks it without allowing the group library, which would break the '
    + 'shared chains that feature exists for')
})

test('the unrestricted test is companyFilter\'s own, word for word', () => {
  // If these two ever disagree the product has two contradictory ideas of
  // who is scoped, and the quieter one wins silently.
  const resolve = readFileSync(
    join(process.cwd(), 'lib/rms/resolve.ts'), 'utf8')
  assert.match(resolve, /if \(grant\.crossCompany \|\| !grant\.companyId\)/,
    'companyFilter no longer begins the way tenancy.ts copied')
  const tenancy = readFileSync(
    join(process.cwd(), 'lib/pms/tenancy.ts'), 'utf8')
  assert.match(tenancy, /if \(q\.crossCompany \|\| !q\.companyId\) return 'ALLOWED'/)
})
