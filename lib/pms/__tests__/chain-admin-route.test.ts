// The chain library is reachable from the admin route, and the route refuses
// what the builder refuses.
//
// ── WHY THESE READ SOURCE ────────────────────────────────────────────────
//
// Same reason as chain-wiring.test.ts: Node cannot mount the route handler
// here with a live Supabase behind it. A regex can prove a call exists and
// cannot prove it runs. Where that limit bites, it is stated against the
// assertion rather than papered over.
//
// COMMENTS ARE STRIPPED FIRST, EVERY TIME. Six tests in this module have
// tripped over their own prose — a column named in a comment reads exactly
// like a column named in an allowlist, and an apostrophe in a sentence ends
// a naive string match early. The route is 600 lines of explanation; none of
// it is code.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RUNG_CHOICES } from '../chainBuilder.ts'

/** Line comments, block comments and string bodies gone. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

const RAW = readFileSync(join(process.cwd(), 'app/api/pms/admin/route.ts'), 'utf8')
const ROUTE = code(RAW)

/** The body of a named `const X = [...] as const` allowlist. */
function allowlist(name: string): string[] {
  const m = ROUTE.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`))
  assert.ok(m, `${name} is not in the route in the shape this reads`)
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

/** One `case 'x': { ... }` block, brace-matched. */
function block(action: string): string {
  const i = ROUTE.indexOf(`case '${action}':`)
  assert.notEqual(i, -1, `the route has no ${action} action`)
  let depth = 0
  for (let j = ROUTE.indexOf('{', i); j < ROUTE.length; j++) {
    if (ROUTE[j] === '{') depth++
    else if (ROUTE[j] === '}' && --depth === 0) return ROUTE.slice(i, j + 1)
  }
  assert.fail(`${action}'s block never closes`)
}

// ── the policy can point at a chain ──────────────────────────────────────

test('chain_id is writable on a policy', () => {
  // A policy column is INERT until it is named here — the exact shape of the
  // "my configuration changes do not take effect" bug this module has already
  // had once. The chain builder would save a chain nothing could ever select.
  assert.ok(allowlist('POLICY_COLS').includes('chain_id'),
    'a policy cannot be pointed at a chain')
})

test('approval_chain is still writable alongside it', () => {
  // 218 adds a chain, it does not retire the presets: chain_id null falls
  // back to approval_chain. Dropping it here would strand every policy that
  // has not been migrated to a composed chain.
  assert.ok(allowlist('POLICY_COLS').includes('approval_chain'))
})

test('the policy allowlist has no duplicates', () => {
  const cols = allowlist('POLICY_COLS')
  const dup = cols.find((c, i) => cols.indexOf(c) !== i)
  assert.equal(dup, undefined, `${dup} is listed twice`)
})

// ── rungs are rebuilt, never passed through ──────────────────────────────

test('rungs is not an allowlisted column', () => {
  // THIS IS THE LOAD-BEARING ONE. pick() copies whatever the browser sent for
  // every column it names, so listing rungs would let a caller store a rung
  // the builder cannot draw and chain.ts cannot resolve to a person —
  // straight past chainFault, straight into an appraisal that goes nowhere.
  assert.ok(!allowlist('CHAIN_COLS').includes('rungs'),
    'a caller can post the rungs array verbatim')
})

test('what reaches the rungs column comes out of normaliseRungs', () => {
  const b = block('chain_upsert')
  assert.match(b, /patch\.rungs = normaliseRungs\(posted\)/,
    'the rungs stored are not the normalised ones')

  // And nothing else can put them there. Three things together close it:
  // `patch` is the only payload either write sends, the sole assignment into
  // patch.rungs is the one above, and the only other source feeding patch is
  // pick(body, CHAIN_COLS) — which cannot carry rungs, asserted separately.
  //
  // (An earlier version of this scanned the block for any `rungs =` that was
  // not normaliseRungs, and passed vacuously: `\s*` before a negative
  // lookahead matches zero characters, so the lookahead was tested against a
  // space and never failed. It also flagged the chainFault argument, which is
  // a validation input rather than a write.)
  const into = [...b.matchAll(/patch\.rungs\s*=/g)]
  assert.equal(into.length, 1, 'patch.rungs is assigned more than once')
  assert.match(b, /const patch: Record<string, unknown> = \{ \.\.\.fields \}/,
    'patch is built from something other than the allowlisted fields')
  for (const m of [...b.matchAll(/\.(update|insert)\(([^)]*)/g)]) {
    assert.ok(m[2].includes('...patch'),
      `a ${m[1]} sends something other than patch: ${m[2]}`)
  }
})

test('the route validates before it writes, not only the browser', () => {
  // The browser's chainFault exists to explain; this one exists to refuse. A
  // posted body never went near the browser.
  const b = block('chain_upsert')
  const fault = b.indexOf('chainFault(')
  const write = Math.min(
    ...['\.update(', '\.insert('].map(s => {
      const i = b.indexOf(s.replace('\\', ''))
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }))
  assert.notEqual(fault, -1, 'the route never calls chainFault')
  assert.ok(fault < write,
    'chainFault runs after the write, which is no check at all')
  assert.match(b, /if \(fault\) return bad\(fault\)/,
    'the fault is computed and not returned')
})

test('an edit that touches only the notes leaves the rungs alone', () => {
  // Otherwise renaming a chain would have to re-send its rungs, and a screen
  // that forgot to would silently empty it.
  const b = block('chain_upsert')
  assert.match(b, /const posted = Array\.isArray\(body\.rungs\)/,
    'the route cannot tell "no rungs sent" from "empty rungs sent"')
  assert.match(b, /if \(posted \|\| !id\)/,
    'validation runs on an edit that did not send rungs')
  assert.match(b, /if \(posted\) patch\.rungs =/,
    'an edit without rungs still writes the column')
})

test('a new chain belongs to a company unless the actor spans them', () => {
  // Same rule as a KRA or a course: null company_id means the whole group and
  // is a deliberate choice, so it is honoured only for somebody who actually
  // works across companies. Three organisations share this database.
  const b = block('chain_upsert')
  assert.match(b, /body\.company_id === null/)
  assert.match(b, /g\.grant\.crossCompany/)
  assert.match(b, /companyFilter\(g\.grant,/)
})

test('a company nobody could resolve is refused, not read as the group', () => {
  // The teeth of the rule above, and a real escalation without it:
  // companyFilter returns null for an admin scoped to one company who sent no
  // company_id, and null company_id is exactly how "the whole group" is
  // stored. So the two nulls mean opposite things, and dropping this guard
  // would let a single-company admin publish a chain to all three.
  const b = block('chain_upsert')
  assert.match(b, /if \(!company && !wantsGroup\) return bad\(/,
    'an unresolved company is stored as a group-wide chain')
})

test('a duplicate name is explained, not returned as a constraint', () => {
  const b = block('chain_upsert')
  assert.match(b, /pms_chain_company_id_name_key/,
    'a name clash reaches the administrator as raw Postgres')
})

// ── retiring a chain ─────────────────────────────────────────────────────

test('a chain in use cannot be switched off', () => {
  // Deactivating it would leave the policy's chain_id pointing at it and the
  // chain still deciding: the switch would read as off and behave as on.
  const b = block('chain_set_active')
  assert.match(b, /\.eq\('chain_id', id\)/,
    'the route does not look for policies using this chain')
  assert.match(b, /usedBy\(id,/, 'the route does not work out which policies')
  assert.match(b, /if \(names\.length\) \{[\s\S]*?return bad\(/,
    'a chain in use is switched off anyway')
})

test('the refusal names the policies, because that is the fix', () => {
  const b = block('chain_set_active')
  assert.match(b, /names\.join\(/, 'the refusal does not say which policies')
  const guard = b.slice(b.indexOf('if (names.length)'))
  const ret = guard.slice(0, guard.indexOf('\n      }'))
  assert.ok(/names\.length === 1 \? 'is' : 'are'/.test(ret),
    'the refusal reads ungrammatically for one policy or for several')
})

test('a chain is retired, not deleted', () => {
  // A policy that pointed at it, and chain_shape on every appraisal that ran
  // it, are both references to this row. DELETE would strand them.
  assert.ok(!/from\('pms_chain'\)[\s\S]{0,80}\.delete\(/.test(ROUTE),
    'the route can delete a chain')
  assert.match(block('chain_set_active'), /\.update\(\{ is_active: !off/)
})

// ── what the editor is given ─────────────────────────────────────────────

test('the GET returns the chain library and the rung coverage', () => {
  const g = ROUTE.slice(ROUTE.indexOf('export async function GET'),
                        ROUTE.indexOf('export async function POST'))
  assert.match(g, /from\('pms_chain'\)/, 'the editor is never sent the chains')
  const body = g.slice(g.indexOf('return NextResponse.json'))
  assert.match(body, /chains:/, 'the chains are read and not returned')
  assert.match(body, /coverage/, 'the coverage is read and not returned')
})

test('an unreadable chain table does not take the whole editor down', () => {
  // 218 may not have run. The rest of Setup & Controls has nothing to do
  // with chains and must still render — the same call made for the training
  // catalogue in 215.
  const g = ROUTE.slice(ROUTE.indexOf('export async function GET'),
                        ROUTE.indexOf('export async function POST'))
  const fatal = g.match(/const firstError = \[([^\]]*)\]/)
  assert.ok(fatal, 'the GET no longer has a fatal-error list in this shape')
  assert.ok(!fatal[1].includes('chains'),
    'a missing pms_chain table returns 500 for the entire editor')
  assert.match(g, /if \(chains\.error\) console\.error/,
    'a chain read failure is silent')
})

test('the coverage columns come from RUNG_CHOICES, not a second list', () => {
  // Retyped here, the count would drift from the menu and the builder would
  // show a number for the wrong column — the most convincing kind of wrong.
  const fn = ROUTE.slice(ROUTE.indexOf('async function rungCoverage'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /RUNG_CHOICES\.map\(/,
    'rungCoverage does not derive its columns from the menu')
  for (const c of RUNG_CHOICES) {
    assert.ok(!body.includes(`'${c.column}'`),
      `${c.column} is hardcoded in rungCoverage as well as on the menu`)
  }
})

test('coverage counts rows rather than fetching them', () => {
  const fn = ROUTE.slice(ROUTE.indexOf('async function rungCoverage'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /count: 'exact', head: true/,
    '401 employees cross the wire to be counted in JS')
  assert.match(body, /\.is\('date_of_leaving', null\)/,
    'leavers are counted, so coverage reads lower than it is')
})

test('an unreadable count says nothing rather than zero', () => {
  // chainWarnings treats absent coverage as "no warning". Reporting a failed
  // read as have:0 would raise a false alarm on every rung at once.
  const fn = ROUTE.slice(ROUTE.indexOf('async function rungCoverage'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /if \(total\.error \|\| total\.count == null\)[\s\S]{0,120}return null/,
    'a failed total is not reported as unknown')
  assert.match(body, /if \(r\.error \|\| r\.count == null\) return/,
    'a failed per-rung count lands in the result as a number')
})

// ── the gate is unchanged ────────────────────────────────────────────────

test('building a chain is admin configuration, not an HR action', () => {
  // HR_ACTIONS is the one hole in the Performance-manage gate, opened for the
  // rating upload because that is HR's own job. Composing the approval chain
  // decides how everybody in the company is appraised; it is not.
  const m = ROUTE.match(/const HR_ACTIONS = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, 'HR_ACTIONS is not in the route in the shape this reads')
  for (const a of ['chain_upsert', 'chain_set_active']) {
    assert.ok(!m[1].includes(a), `${a} is reachable without managing Performance`)
  }
  assert.ok(m[1].includes('upload_commit'), 'the rating upload lost its exemption')
})
