// The admin route's column allowlists say, in prose, what they deliberately
// leave out. Nothing checked that they still do.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
//
// app/api/pms/admin/route.ts opens with a rule it states twice:
//
//   "Columns are allowlisted per table. A pass-through update would let a
//    caller set company_id and move a policy between companies."
//
// and against PERIOD_COLS:
//
//   "period_start, period_end, period_code and period_no are NOT here. Those
//    are the period's identity; moving them would silently re-date work
//    already recorded against it."
//
// Seven test files reach into POLICY_COLS and every one of them asserts that
// a column IS present — chain_id, approval_chain, post_final_owner,
// hr_head_id, min_kpi_per_kra and the rest. That is the easy half. The half
// that matters is the omissions, because a column is added to one of these
// lists by hand, in a hurry, next to thirty-four others that all look alike,
// and the cost of getting it wrong is a cross-company write rather than a
// screen that fails to save.
//
// Only CATALOGUE_COLS and CHAIN_COLS had a negative assertion anywhere
// (training-ai.test.ts:697, chain-admin-route.test.ts:83). The two lists the
// route's own threat model names had none.
//
// ── COMMENTS ARE STRIPPED FIRST ──────────────────────────────────────────
//
// Same reason as chain-admin-route.test.ts and chain-wiring.test.ts: the
// route is 690 lines and most of it is explanation. Every column this file
// asserts is ABSENT is also NAMED, in prose, a few lines above the list it
// must be absent from — `periods_per_year` appears in POLICY_COLS' own
// comment explaining why it is excluded. A naive match would find it there
// and report the opposite of the truth.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Line comments, block comments gone. Strings are kept — the allowlists ARE
 *  string literals, so stripping those would leave nothing to read. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

const RAW = readFileSync(
  join(process.cwd(), 'app/api/pms/admin/route.ts'), 'utf8')
const ROUTE = code(RAW)

/** The body of a named `const X = [...] as const` allowlist. */
function allowlist(name: string): string[] {
  const m = ROUTE.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`))
  assert.ok(m, `${name} is not in the route in the shape this reads`)
  return [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

// ── the comment stripper, before anything trusts it ──────────────────────

test('the stripper removes prose that names an excluded column', () => {
  // periods_per_year is named in POLICY_COLS' comment and must not be in the
  // list. If the stripper ever stops working, this file would start passing
  // for the wrong reason, so prove the hazard is real and handled.
  assert.ok(RAW.includes('periods_per_year'),
    'the route no longer mentions periods_per_year at all — if the column is '
    + 'gone from the table, drop its assertion below rather than keeping a '
    + 'check that can never fail')
  const stripped = code(RAW)
  const inList = allowlist('POLICY_COLS').includes('periods_per_year')
  assert.equal(inList, false)
  // The prose mention is gone; only a real list entry could have matched.
  assert.ok(!/periods_per_year/.test(
    stripped.slice(stripped.indexOf('const POLICY_COLS'),
                   stripped.indexOf('] as const', stripped.indexOf('const POLICY_COLS')))),
    'periods_per_year survives inside the stripped POLICY_COLS block')
})

// ── POLICY_COLS: the route's own threat model ────────────────────────────

test('POLICY_COLS cannot move a policy between companies', () => {
  const cols = allowlist('POLICY_COLS')
  assert.ok(!cols.includes('company_id'),
    'company_id is writable on policy_update. The route updates '
    + 'pms_policies with the SERVICE ROLE client filtered on id alone, so '
    + 'this would let a caller re-home another company\'s policy.')
  assert.ok(!cols.includes('id'),
    'id is writable, so an update could repoint itself at another row')
})

test('POLICY_COLS does not offer a write Postgres or a CHECK will refuse', () => {
  const cols = allowlist('POLICY_COLS')
  // periods_per_year is GENERATED ALWAYS: any write is an error, so offering
  // it would turn every policy save into a failure once the UI sent it.
  assert.ok(!cols.includes('periods_per_year'),
    'periods_per_year is GENERATED ALWAYS — Postgres rejects any write to it')
  // payout_linkage_enabled is locked false by a CHECK in 066. A toggle for it
  // fails every time it is used.
  assert.ok(!cols.includes('payout_linkage_enabled'),
    'payout_linkage_enabled is pinned false by CHECK in 066')
})

test('POLICY_COLS keeps provenance out of the caller\'s hands', () => {
  const cols = allowlist('POLICY_COLS')
  for (const c of ['created_at', 'created_by']) {
    assert.ok(!cols.includes(c), `${c} is provenance, not configuration`)
  }
})

// ── PERIOD_COLS: windows are scheduling, dates are identity ──────────────

test('PERIOD_COLS cannot re-date a period that already holds work', () => {
  const cols = allowlist('PERIOD_COLS')
  for (const c of ['period_start', 'period_end', 'period_code', 'period_no']) {
    assert.ok(!cols.includes(c),
      `${c} is writable on period_update. Appraisals, goals and reviews are `
      + `already recorded against this period; moving its dates re-dates all `
      + `of them silently.`)
  }
  assert.ok(!cols.includes('company_id'),
    'company_id is writable, so a period could be moved to another company')
  assert.ok(!cols.includes('id'))
})

test('PERIOD_COLS still offers every window the editor edits', () => {
  // The negative assertions above are only safe to add if the positive case
  // is held down too — an over-eager "remove the risky columns" change that
  // emptied the list would otherwise pass this file completely.
  const cols = allowlist('PERIOD_COLS')
  for (const c of ['kra_window_from', 'kra_window_to',
                   'self_rating_from', 'self_rating_to',
                   'rm_review_from', 'rm_review_to',
                   'finalise_from', 'finalise_to', 'status']) {
    assert.ok(cols.includes(c), `${c} is what period_update exists to set`)
  }
})

// ── the remaining lists ──────────────────────────────────────────────────

test('no allowlist lets a caller set company_id or id', () => {
  // The four insert paths resolve company_id through companyFilter and merge
  // it themselves. A company_id inside an allowlist would be spread over that
  // resolved value by `{ ...fields, company_id: company }` ordering in some
  // cases and under it in others — a difference nobody should have to reason
  // about per call site.
  for (const name of ['POLICY_COLS', 'PERIOD_COLS', 'KRA_COLS',
                      'CATALOGUE_COLS', 'CHAIN_COLS', 'SCALE_COLS']) {
    const cols = allowlist(name)
    assert.ok(!cols.includes('company_id'), `${name} must not allow company_id`)
    assert.ok(!cols.includes('id'), `${name} must not allow id`)
    assert.ok(!cols.includes('created_at'), `${name} must not allow created_at`)
    assert.ok(!cols.includes('created_by'), `${name} must not allow created_by`)
  }
})

test('every insert path resolves the company through companyFilter', () => {
  // The positive half of the rule above: a new row's company must come from
  // the grant, never from the body. Four cases insert; each must call
  // companyFilter and each must name company_id in the inserted object.
  const inserts = [...ROUTE.matchAll(/\.insert\(\{([^}]*)\}\)/g)].map(m => m[1])
  assert.ok(inserts.length >= 4,
    `expected at least four insert sites, found ${inserts.length}`)
  for (const body of inserts) {
    assert.ok(/company_id\s*:/.test(body),
      `an insert does not set company_id explicitly: {${body.trim()}}`)
  }
  const calls = (ROUTE.match(/companyFilter\(/g) ?? []).length
  assert.ok(calls >= 4,
    `companyFilter is called ${calls} times; every insert path needs it`)
})
