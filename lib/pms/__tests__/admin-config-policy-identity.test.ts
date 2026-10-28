// lib/pms/__tests__/admin-config-policy-identity.test.ts
//
// THE BUG THESE GUARD, REPORTED TWICE: "I edit Setup & Controls and the
// changes do not reflect on PMS Configuration."
//
// The edits always saved. The reading screen was looking at a DIFFERENT
// POLICY. Every company is seeded with one called "Standard Quarterly" —
// three of them in this database, one per company — and:
//
//   1. the config screen built its values from row [0] of a policy query with
//      NO ORDER BY, and Postgres promises nothing about unordered row order;
//   2. companyFilter returns NULL for a cross-company admin, so the query was
//      not even scoped to one company, and [0] was one of all three;
//   3. PolicyConfig.companyName was hardcoded null with a comment claiming it
//      was "filled below once company names load" — nothing in the file ever
//      fetched a company, so the screen rendered a bare "Standard Quarterly"
//      and gave the admin no way to notice the mismatch.
//
// Worse than arbitrary: an UPDATE rewrites a row and moves it in the heap, so
// saving a policy could change which one came back first. The screen could
// show a different policy BECAUSE you saved.
//
// Source-matching, because Node cannot load .tsx. The limits of that are
// spelled out in chain-wiring.test.ts; the same reasoning applies.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PAGE = read('app/dashboard/pms/page.tsx')
const ADMIN = read('components/pms/AdminTabs.tsx')

test('the policy query is ordered, so "first" means something', () => {
  // Isolate the pms_policies query rather than searching the whole file: an
  // .order() belonging to the periods query must not count as this one's.
  //
  // Anchored on `let polQ`, NOT on from('pms_policies'). The first match for
  // that in this file is the readiness probe at the top
  // (`await supabase.from('pms_policies').select('id').limit(1)`), so the
  // window landed nowhere near the real query and the test failed against
  // correct code. Found by the test failing on a fix I had just verified
  // by hand.
  const i = PAGE.indexOf("let polQ = supabase.from('pms_policies')")
  assert.ok(i > 0, 'could not find the policy query')
  const q = PAGE.slice(i, i + 1400)
  const exec = q.match(/await polQ[^\n]*/)
  assert.ok(exec, 'could not find where the policy query is executed')
  assert.match(exec![0], /\.order\(/,
    'the policy query has no ORDER BY, so row [0] is whichever policy Postgres '
    + 'happens to return — and an UPDATE moves a row, so saving can change it')
})

test('a config is built for EVERY policy, not just the first', () => {
  // The fix that matters: one entry per policy, so the admin can look at the
  // one they edited instead of whichever came back first.
  assert.match(PAGE, /setConfigs\(polRows\.map\(toConfig\)\)/,
    'the page still derives a single config instead of one per policy')
  assert.ok(!/const first = \(pol\.data \?\? \[\]\)\[0\]/.test(PAGE),
    'the page still picks policy [0] as "the" config')
})

test('company names are actually fetched', () => {
  // companyName was null forever behind a comment claiming otherwise. Without
  // a real company name the three identically-named policies are
  // indistinguishable on screen, which is what hid the bug from the admin.
  assert.match(PAGE, /from\('companies'\)/,
    'nothing fetches company names, so companyName can only ever be null')
  assert.match(PAGE, /companyName: c\.companyId \? companyNames\[c\.companyId\]/,
    'the company name is not resolved onto the config')
})

test('PolicyConfig carries identity, not just labels', () => {
  // A screen cannot offer a choice between policies it cannot tell apart.
  for (const f of ['policyId', 'companyId']) {
    assert.match(ADMIN, new RegExp(`${f}\\?:\\s*string \\| null`),
      `PolicyConfig has no ${f}`)
  }
})

test('the config tab lets the admin pick which policy it describes', () => {
  const i = ADMIN.indexOf('export function ConfigTab')
  assert.ok(i > 0)
  const tab = ADMIN.slice(i, i + 4000)
  assert.match(tab, /choices\.length > 1 && onChoosePolicy/,
    'the tab does not offer a selector when several policies exist')
  assert.match(tab, /onChoosePolicy\(e\.target\.value\)/,
    'the selector does not report the chosen policy')
  // And the page must wire it, or the selector is decoration.
  assert.match(PAGE, /onChoosePolicy=\{setConfigPolicyId\}/,
    'the page does not respond to the policy choice')
  assert.match(PAGE, /choices=\{configChoices\}/,
    'the page does not pass the list of policies')
})

test('the policy shown is always named with its company', () => {
  // All three are "Standard Quarterly". The company is the only thing that
  // distinguishes them, so it cannot be optional in the display.
  const i = ADMIN.indexOf('export function ConfigTab')
  const tab = ADMIN.slice(i, i + 4000)
  // Both branches — the selector's options and the single-policy label.
  const withCompany = tab.match(/companyName \? /g) ?? []
  assert.ok(withCompany.length >= 2,
    'the company name is not shown in both the selector and the fixed label')
})
