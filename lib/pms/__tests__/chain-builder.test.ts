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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chainFault, normaliseRungs, chainWarnings, chainSummary, usedBy,
         RUNG_CHOICES, STORABLE_RUNGS, MAX_CHAIN_NAME } from '../chainBuilder.ts'
import { rungs as engineRungs, type Stage } from '../chain.ts'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/218_pms_custom_chains.sql'), 'utf8')
/** 219 corrects two things 218 got wrong — see the tests at the end. */
const SQL219 = readFileSync(
  join(process.cwd(),
       'supabase/migrations/219_pms_chain_rungs_really_checked.sql'), 'utf8')

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

test('every offerable rung names the column 219 says resolves it', () => {
  // A rung with no column is a job title: nothing can say who it is for a
  // given employee, which is the whole reason the menu is not free text.
  //
  // ── THIS TEST ALONE IS NOT ENOUGH, AND THAT IS THE POINT ───────────────
  //
  // It compares this file against a migration's COMMENT. When 218 shipped,
  // both said rm_l1_id and rm_l2_id — columns that do not exist on employees
  // — and this test passed, because this file had been WRITTEN FROM that
  // COMMENT. Two sources agreeing is not evidence when one is a copy.
  //
  // What found it was probing the live schema; what prevents it recurring is
  // 219_pms_chain_rungs_verify.sql, which asks information_schema. This test
  // keeps the two in-repo copies from drifting, which is all it can do, and
  // the test below pins the names against code that is not a copy of either.
  const doc = SQL219.slice(SQL219.indexOf('COMMENT ON COLUMN pms_chain.rungs'))
  for (const c of RUNG_CHOICES) {
    assert.ok(c.label && c.hint, `${c.stage} has no label or hint`)
    assert.ok(doc.includes(c.column),
      `219 does not document ${c.column} as resolving a rung`)
    // And documented AGAINST THIS STAGE, not merely mentioned somewhere.
    assert.match(doc.replace(/'\s*\n\s*'/g, ''), new RegExp(`${c.stage} ${c.column}`),
      `219 maps ${c.stage} to something other than ${c.column}`)
  }
  const cols = RUNG_CHOICES.map(c => c.column)
  assert.equal(new Set(cols).size, cols.length, 'two rungs share a column')
})

/**
 * Every file that names an employees column WITHOUT being a copy of the
 * chain builder: the product code that queried the reporting line long
 * before any of this, and every migration except the two chain ones.
 *
 * 218 and 219 are excluded DELIBERATELY. Including them is what let the
 * first version of this test pass while a column name was invented in both
 * the builder and the migration at once — a corpus that contains the file
 * under test is not an independent source, it is the same claim twice.
 */
const INDEPENDENT = [
  'lib/ess-scope.ts', 'lib/supabase-ess.ts', 'lib/attendance/reports.ts',
].map(p => readFileSync(join(process.cwd(), p), 'utf8')).join('\n')
  + readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter(f => !/^21[89]_/.test(f))
      .map(f => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8'))
      .join('\n')

test('the reporting-line columns match what the product already reads', () => {
  // lib/ess-scope.ts queries employees by l1_manager_id and predates all of
  // this, so it cannot be a copy of the chain builder or of a COMMENT
  // written for it. When RUNG_CHOICES said rm_l1_id, this would have failed.
  assert.ok(INDEPENDENT.includes('l1_manager_id'),
    'the independent source no longer reads the reporting line; find another')
  for (const [stage, col] of [['RM_L1', 'l1_manager_id'],
                              ['RM_L2', 'l2_manager_id'],
                              ['HOD', 'hod_id']] as const) {
    assert.ok(RUNG_CHOICES.some(c => c.stage === stage && c.column === col),
      `${stage} does not resolve through the column the rest of the product uses`)
    assert.ok(INDEPENDENT.includes(col),
      `employees.${col} is named nowhere outside the chain builder`)
  }
})

test('the two columns nothing in this repo can vouch for are verified in SQL', () => {
  // ── A GAP, NAMED RATHER THAN PAPERED OVER ──────────────────────────────
  //
  // site_hr_id and regional_head_id appear in NO migration and nowhere else
  // in the product. They were added to employees outside this folder, so
  // there is no independent in-repo source for them and no unit test here
  // can prove they exist — the honest answer is that only the database can.
  //
  // MEASURED on the live database 2026-11-05: both exist; site_hr_id is set
  // for 395 of 398 active employees, regional_head_id for 0.
  //
  // What keeps them honest from here is the verify script, which asks
  // information_schema. So what this test can check is that the script
  // actually asks about every rung on the menu — including these two.
  const verify = readFileSync(join(process.cwd(),
    'supabase/verify/219_pms_chain_rungs_verify.sql'), 'utf8')
  const list = verify.match(/column_name IN \(([^)]*'regional_head_id'[^)]*)\)/)
  assert.ok(list, 'the verify script no longer checks the rung columns')
  const checked = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(checked.slice().sort(), RUNG_CHOICES.map(c => c.column).slice().sort(),
    'the verify script and the menu disagree about which columns to check')
  for (const c of RUNG_CHOICES) {
    if (INDEPENDENT.includes(c.column)) continue
    assert.ok(checked.includes(c.column),
      `nothing in this repo can vouch for employees.${c.column} and the `
      + 'verify script does not check it either')
  }

  // ── THE LIMIT, STATED ──────────────────────────────────────────────────
  //
  // Renaming site_hr_id consistently in the builder, in 219 and here would
  // pass every test in this file. Mutation testing confirmed it: that
  // mutation survives, and no assertion written in this repo can kill it,
  // because the only thing that knows the real column name is the database.
  //
  // So the test is "the script that asks still asks", and the script has to
  // be RUN. It is not decoration.
})

test('the verify script tests the empty chain by trying to insert one', () => {
  // 218's defect was a CHECK that read correctly and did nothing. The only
  // test that could have caught it is one where Postgres refuses the INSERT
  // — so the verify script must actually attempt an empty array, not merely
  // mention the constraint.
  const verify = readFileSync(join(process.cwd(),
    'supabase/verify/219_pms_chain_rungs_verify.sql'), 'utf8')
  assert.match(verify, /INSERT INTO pms_chain[\s\S]{0,200}ARRAY\[\]::text\[\]/,
    'the verify script does not try to insert an empty chain')
  assert.match(verify, /EXCEPTION WHEN check_violation/,
    'the verify script does not expect the insert to be refused')
  assert.match(verify, /ROLLBACK/, 'the verify script would leave its fixtures behind')
})

test('218 is left alone and 219 is the correction', () => {
  // 218 is applied on the live database, so its text is history. Editing a
  // migration that has run means the file and the database disagree, and the
  // next person reads the file.
  assert.match(SQL, /rm_l1_id/,
    '218 was edited after being applied; corrections belong in a new migration')
  assert.match(SQL219, /cardinality\(rungs\) >= 1/,
    '219 does not fix the empty-chain CHECK')
  assert.ok(!SQL219.includes('rm_l1_id,') && !SQL219.includes('RM_L2 rm_l2_id'),
    '219 still documents the columns that do not exist')
})

test('219 replaces the CHECK rather than adding a second one', () => {
  // Two constraints with the same intent and different definitions is how a
  // later reader concludes the stricter one is dead.
  assert.match(SQL219, /DROP CONSTRAINT IF EXISTS pms_chain_has_rungs/)
  assert.match(SQL219, /ADD CONSTRAINT pms_chain_has_rungs CHECK \(cardinality\(rungs\) >= 1\)/)
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
    RM_L2: { have: 261, of: 398 }, HOD: { have: 398, of: 398 },
  })
  assert.equal(w.length, 1)
  assert.ok(w[0].includes('137') && w[0].includes('398'),
    `the warning does not say how many: ${w[0]}`)
})

test('a warning keeps the acronyms in the rung name', () => {
  // Seen on screen: "3 of 398 employees have no reporting manager (l1)" and
  // "have no site hr". Lower-casing the whole label to fit it mid-sentence
  // destroyed every initialism in it. Only the first letter should drop.
  const w = chainWarnings(['RM_L1', 'SITE_HR'], {
    RM_L1: { have: 395, of: 398 }, SITE_HR: { have: 0, of: 398 },
  })
  assert.ok(w[0].includes('reporting manager (L1)'), w[0])
  assert.ok(!w[0].includes('(l1)'), `the acronym was lower-cased: ${w[0]}`)
  assert.ok(w[1].includes('site HR'), w[1])
  assert.ok(!w[1].includes('site hr'), `the acronym was lower-cased: ${w[1]}`)
  // And it still reads as mid-sentence, not a capital mid-clause.
  assert.ok(!w[0].includes('no Reporting'), `not lower-cased at all: ${w[0]}`)
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
