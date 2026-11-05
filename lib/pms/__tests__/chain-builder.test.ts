// Composing an approval chain, and refusing a bad one.
//
// ── WHAT THESE TESTS ARE FOR ─────────────────────────────────────────────
//
// chainFault exists to say the same NO the database says, earlier and in a
// sentence. So the thing worth testing is not that it refuses — it is that
// what it refuses and what 218's CHECK refuses are the same set. Those
// drifting apart is the actual failure mode: either the builder accepts
// something that then dies at the write with a constraint name in it, or it
// refuses something the database would have taken and an administrator
// cannot build the chain they need.
//
// So the whitelist is asserted against the migration's own text, not against
// a list retyped here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chainFault, normaliseRungs, chainWarnings, chainSummary, usedBy,
         RUNG_CHOICES, STORABLE_RUNGS, MAX_CHAIN_NAME } from '../chainBuilder.ts'
import { rungs as engineRungs, type Stage } from '../chain.ts'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/218_pms_custom_chains.sql'), 'utf8')

const ok = (r: string[]) => ({ name: 'A chain', rungs: r })

// ── the builder and the database agree ───────────────────────────────────

test('STORABLE_RUNGS is exactly what 218 accepts', () => {
  // Retyped, these two lists drift and the symptom is a constraint-violation
  // error reaching an administrator. Read the migration instead.
  const m = SQL.match(/rungs <@ ARRAY\[([^\]]+)\]::text\[\]/)
  assert.ok(m, '218 no longer has a rungs whitelist in the shape this reads')
  const fromSql = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
  assert.deepEqual([...STORABLE_RUNGS].sort(), fromSql.sort())
})

test('every offerable rung is one 218 will store', () => {
  for (const c of RUNG_CHOICES) {
    assert.ok(STORABLE_RUNGS.includes(c.stage),
      `${c.stage} is on the menu and the database would refuse it`)
  }
})

test('every offerable rung names the column 218 says resolves it', () => {
  // A rung with no column is a job title: nothing can say who it is for a
  // given employee, which is the whole reason the menu is not free text.
  //
  // Checked against the migration's own COMMENT rather than against the
  // shape of the string. "rm_l1_id" matching /_id$/ proves nothing; matching
  // what 218 documents as the resolving column proves the menu and the
  // schema have not drifted.
  const doc = SQL.slice(SQL.indexOf('COMMENT ON COLUMN pms_chain.rungs'))
  for (const c of RUNG_CHOICES) {
    assert.ok(c.label && c.hint, `${c.stage} has no label or hint`)
    assert.ok(doc.includes(c.column),
      `218 does not document ${c.column} as resolving a rung`)
    // And documented AGAINST THIS STAGE, not merely mentioned somewhere.
    assert.match(doc.replace(/'\s*\n\s*'/g, ''), new RegExp(`${c.stage} ${c.column}`),
      `218 maps ${c.stage} to something other than ${c.column}`)
  }
  const cols = RUNG_CHOICES.map(c => c.column)
  assert.equal(new Set(cols).size, cols.length, 'two rungs share a column')
})

test('the two fixed ends are not on the menu', () => {
  // Offering them invites a chain with no self rating or no publisher, which
  // the engine then silently puts back.
  const onMenu = RUNG_CHOICES.map(c => c.stage)
  assert.ok(!onMenu.includes('EMPLOYEE' as Stage))
  assert.ok(!onMenu.includes('HR' as Stage))
})

test('the menu is the storable list minus those two ends, exactly', () => {
  // chainFault relies on this to need only one whitelist check: having
  // rejected everything outside STORABLE_RUNGS and dropped the fixed ends,
  // what remains must be offerable. Widen 218's whitelist without adding to
  // the menu and chainFault would start accepting a rung the builder cannot
  // draw.
  //
  // Computed HERE rather than read from a helper in the source. A first
  // attempt exported `offerableIsStorableMinusTheEnds()` and asserted its
  // return value — which a mutation to `return true` sailed through, because
  // a test that asks the code under test whether it is correct will always
  // be told yes.
  const ends = new Set(['EMPLOYEE', 'HR'])
  assert.deepEqual(
    [...RUNG_CHOICES.map(c => String(c.stage))].sort(),
    STORABLE_RUNGS.filter(r => !ends.has(r)).slice().sort(),
    'chainFault now needs a separate check for a storable, unofferable rung')
})

// ── what is refused ──────────────────────────────────────────────────────

test('a chain needs a name', () => {
  assert.match(chainFault({ name: '', rungs: ['HOD'] }) ?? '', /name/i)
  assert.match(chainFault({ name: '   ', rungs: ['HOD'] }) ?? '', /name/i)
  assert.match(chainFault({ rungs: ['HOD'] }) ?? '', /name/i)
})

test('a name too long to read on a dropdown is refused with the count', () => {
  const f = chainFault({ name: 'x'.repeat(MAX_CHAIN_NAME + 1), rungs: ['HOD'] })
  assert.ok(f?.includes(String(MAX_CHAIN_NAME + 1)),
    'the refusal does not say how long the name actually is')
  assert.equal(chainFault({ name: 'x'.repeat(MAX_CHAIN_NAME), rungs: ['HOD'] }), null)
})

test('a chain with no approver is refused, and says why that matters', () => {
  const f = chainFault({ name: 'Straight through', rungs: [] })
  assert.match(f ?? '', /straight to publishing/i)
  // EMPLOYEE and HR on their own are the two fixed ends, not approvers.
  assert.ok(chainFault({ name: 'n', rungs: ['EMPLOYEE', 'HR'] }))
})

test('a rung nothing can resolve is refused, quoting it back', () => {
  const f = chainFault({ name: 'n', rungs: ['HOD', 'FINANCE'] })
  assert.ok(f?.includes('FINANCE'), 'the refusal does not say which rung')
  assert.match(f ?? '', /relationship on the employee record/i)
  // DONE is storable nowhere and is a plausible thing to pick off a stage list.
  assert.ok(chainFault({ name: 'n', rungs: ['HOD', 'DONE'] }))
})

test('a duplicate rung is refused rather than quietly dropped', () => {
  // chain.ts dedupes, so nothing breaks either way. The point is that an
  // administrator who typed the HOD twice meant something, and a chain that
  // silently disagrees with what they entered is one they stop trusting.
  const f = chainFault({ name: 'n', rungs: ['HOD', 'RM_L1', 'HOD'] })
  assert.ok(f?.includes('Head of department'), 'the refusal does not name the rung')
  assert.match(f ?? '', /twice/i)
})

test('the self rating cannot sit in the middle, nor HR anywhere but last', () => {
  assert.match(chainFault({ name: 'n', rungs: ['HOD', 'EMPLOYEE', 'RM_L1'] }) ?? '',
    /where a chain starts/i)
  assert.match(chainFault({ name: 'n', rungs: ['HOD', 'HR', 'RM_L1'] }) ?? '',
    /never be reached/i)
  // At their own ends, both are fine.
  assert.equal(chainFault({ name: 'n', rungs: ['EMPLOYEE', 'HOD', 'HR'] }), null)
})

test('an ordinary chain is accepted', () => {
  assert.equal(chainFault(ok(['RM_L1', 'HOD'])), null)
  assert.equal(chainFault(ok(['RM_L1', 'RM_L2', 'HOD', 'SITE_HR'])), null)
  assert.equal(chainFault(ok(['SITE_HR'])), null)
  // Lower case and stray whitespace are an administrator typing, not an error.
  assert.equal(chainFault({ name: 'n', rungs: [' hod ', 'rm_l1'] }), null)
})

// ── what is stored ───────────────────────────────────────────────────────

test('what is stored has both fixed ends, once each', () => {
  assert.deepEqual(normaliseRungs(['RM_L1', 'HOD']),
    ['EMPLOYEE', 'RM_L1', 'HOD', 'HR'])
  assert.deepEqual(normaliseRungs(['EMPLOYEE', 'HOD', 'HR']),
    ['EMPLOYEE', 'HOD', 'HR'])
  assert.deepEqual(normaliseRungs([]), ['EMPLOYEE', 'HR'])
  assert.deepEqual(normaliseRungs(null), ['EMPLOYEE', 'HR'])
})

test('what is stored keeps the order it was given', () => {
  assert.deepEqual(normaliseRungs(['HOD', 'RM_L1']),
    ['EMPLOYEE', 'HOD', 'RM_L1', 'HR'])
})

test('what is stored is normalised, not merely trusted', () => {
  assert.deepEqual(normaliseRungs([' hod ', 'rm_l1']),
    ['EMPLOYEE', 'HOD', 'RM_L1', 'HR'])
  assert.deepEqual(normaliseRungs(['HOD', 'HOD']), ['EMPLOYEE', 'HOD', 'HR'])
  assert.deepEqual(normaliseRungs(['HOD', 'FINANCE']), ['EMPLOYEE', 'HOD', 'HR'])
})

test('what the builder stores is what the engine walks', () => {
  // The round trip is the thing that matters: a chain saved from this screen
  // has to produce the rungs the appraisal actually travels. These two files
  // normalise independently — EMPLOYEE out, HR last — and if they ever
  // disagree the chain on screen is not the chain being run.
  for (const draft of [['RM_L1', 'HOD'], ['SITE_HR'], ['HOD', 'RM_L1'],
                       ['RM_L1', 'RM_L2', 'HOD', 'SITE_HR', 'REGIONAL_HEAD']]) {
    const stored = normaliseRungs(draft)
    assert.deepEqual(engineRungs(stored as Stage[]),
      [...draft.map(d => d.toUpperCase()), 'HR'],
      `the engine walks a different chain than ${chainSummary(draft)} saved`)
  }
})

// ── coverage is a warning, not a refusal ─────────────────────────────────

test('a rung nobody occupies warns and does not refuse', () => {
  // regional_head_id is set for 0 of 401. chain.ts steps over an empty rung,
  // so this chain works — it just does less than it looks like it does.
  const draft = ok(['RM_L1', 'REGIONAL_HEAD', 'HOD'])
  assert.equal(chainFault(draft), null, 'an empty rung must not block a save')
  const w = chainWarnings(draft.rungs, {
    RM_L1: { have: 401, of: 401 }, HOD: { have: 401, of: 401 },
    REGIONAL_HEAD: { have: 0, of: 401 },
  })
  assert.equal(w.length, 1)
  assert.match(w[0], /skipped for everybody/i)
})

test('a partly populated rung says how many it skips for', () => {
  const w = chainWarnings(['RM_L2', 'HOD'], {
    RM_L2: { have: 205, of: 401 }, HOD: { have: 401, of: 401 },
  })
  assert.equal(w.length, 1)
  assert.ok(w[0].includes('196') && w[0].includes('401'),
    `the warning does not say how many: ${w[0]}`)
})

test('a fully populated chain warns about nothing', () => {
  assert.deepEqual(chainWarnings(['RM_L1', 'HOD'], {
    RM_L1: { have: 401, of: 401 }, HOD: { have: 401, of: 401 },
  }), [])
})

test('unknown coverage warns about nothing rather than guessing', () => {
  // The count read is non-fatal in the route, so it can be absent. Inventing
  // "0 employees have one" from a failed read would be a false alarm about
  // every rung at once.
  assert.deepEqual(chainWarnings(['RM_L1', 'HOD'], null), [])
  assert.deepEqual(chainWarnings(['RM_L1'], { RM_L1: { have: 0, of: 0 } }), [])
})

// ── reading a chain back ─────────────────────────────────────────────────

test('the summary reads as a chain, both ends included', () => {
  assert.equal(chainSummary(['RM_L1', 'HOD']), 'Self → L1 → HOD → HR')
  assert.equal(chainSummary(['SITE_HR', 'REGIONAL_HEAD']),
    'Self → Site HR → Regional → HR')
  assert.equal(chainSummary([]), 'Self → HR')
})

test('a chain knows which policies are running it', () => {
  // Shown before an edit: a chain looks standalone in the builder and is not.
  const pols = [
    { id: 'p1', policy_name: 'Annual — Unit A', chain_id: 'c1' },
    { id: 'p2', policy_name: 'Annual — Unit B', chain_id: 'c2' },
    { id: 'p3', policy_name: '  ', chain_id: 'c1' },
    { id: 'p4', policy_name: 'Legacy', chain_id: null },
  ]
  assert.deepEqual(usedBy('c1', pols), ['Annual — Unit A', 'an unnamed policy'])
  assert.deepEqual(usedBy('c2', pols), ['Annual — Unit B'])
  assert.deepEqual(usedBy('nobody', pols), [])
})
