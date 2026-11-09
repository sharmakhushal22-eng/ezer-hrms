// DEFAULT_RULES is a FALLBACK. It was being used as the rule.
//
// pms_policies carries min_kra_count, max_kra_count, total_weightage and
// min_weightage_per_kra, and every one of them is editable from the admin
// screen. But the employee's KRA validation, all of its copy, the cycle
// header and the manager's approve check all read DEFAULT_RULES — the
// constant 4/10/100/5 — directly. So an admin could change the minimum KRA
// count, see "Policy saved.", and nothing anywhere would behave differently.
//
// Reported as "changing configuration from setup and control is not getting
// in effect, also not reflected the new configuration on pms configuration".
// Both halves of that were true and they had the same cause.
//
// The rule this pins: a component may DEFAULT a rules prop to DEFAULT_RULES,
// but it may not read DEFAULT_RULES.<field> in its own logic or copy. The
// first is a fallback; the second is a hardcoded rule wearing a constant's
// clothes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DEFAULT_RULES } from '../cycle.ts'
import { DEFAULT_FLAG_RULES } from '../employment.ts'

/** Every .ts/.tsx under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(e.name) && !full.includes('__tests__')) out.push(full)
  }
  return out
}

/**
 * COMMENTS ARE NOT CODE PATHS, AND THIS TEST KEPT FORGETTING THAT.
 *
 * The scans below look for `DEFAULT_RULES.<field>` in source text. A comment
 * EXPLAINING the rule — "reading DEFAULT_RULES.minKpi here is the bug" — is
 * the most natural thing to write next to the fix, and it tripped this test
 * as though it were the bug it describes. That has now happened often enough
 * in this repo to be worth solving once: blanking comments before scanning,
 * rather than asking every author to avoid naming the thing.
 *
 * Replaced with spaces rather than deleted, so byte offsets survive and the
 * line numbers in the failure message still point at the real line.
 */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
}

const FILES = walk('components').concat(walk('app')).concat(walk('lib'))
  .map(f => ({ f, src: blankComments(readFileSync(f, 'utf8')) }))

test('blanking comments does not blank code', () => {
  // A scrubber that eats too much turns this whole file into a test that
  // passes because it can no longer see anything.
  assert.equal(blankComments('const a = 1 // DEFAULT_RULES.minKra\n').trimEnd(),
    'const a = 1')
  assert.match(blankComments('/* DEFAULT_RULES.minKra */\nconst a = DEFAULT_RULES.minKra'),
    /const a = DEFAULT_RULES\.minKra$/)
  // A URL is not a comment, and `https://x` contains `//`.
  assert.match(blankComments("const u = 'https://example.com/x'"), /https:\/\/example/)
  // Line count must survive, or the reported line numbers mislead.
  const many = '// a\n// b\nconst c = 1\n/* d\n e */\n'
  assert.equal(blankComments(many).split('\n').length, many.split('\n').length)
  // And the scan still finds a real offender.
  assert.ok(FILES.length > 100)
})

test('there are files to check', () => {
  assert.ok(FILES.length > 100, `only found ${FILES.length} source files — wrong path?`)
})

test('nothing reads a KRA rule off the constant instead of the policy', () => {
  const RULE_FIELDS = Object.keys(DEFAULT_RULES)   // minKra, maxKra, …
  const offenders: string[] = []
  for (const { f, src } of FILES) {
    // lib/pms/cycle.ts DEFINES the constant and legitimately names its own
    // fields; and a `= DEFAULT_RULES` default is exactly the fallback this
    // test wants to allow.
    if (f.endsWith('lib/pms/cycle.ts')) continue
    for (const field of RULE_FIELDS) {
      const re = new RegExp(`DEFAULT_RULES\\.${field}\\b`, 'g')
      for (const m of src.matchAll(re)) {
        // A FALLBACK is fine and is the point: `Number(p.min_kra_count) ||
        // DEFAULT_RULES.minKra` reads the policy and only lands on the
        // constant when there is no policy. What is not fine is reading the
        // constant where the policy's value belongs. The two are told apart
        // by what immediately precedes it.
        const lead = src.slice(Math.max(0, m.index - 40), m.index)
        // Three fallback forms are allowed, and only these three:
        //   x || DEFAULT_RULES.f        a null-ish fallback
        //   x ?? DEFAULT_RULES.f        the same, nullish-only
        //   name = DEFAULT_RULES.f      a default parameter or initialiser
        // The single = must not be part of == / === / != / <= / >=, which is
        // the comparison form — `wt === DEFAULT_RULES.totalWeightage` is
        // exactly the bug, and it reads a constant where the policy belongs.
        if (/(\|\||\?\?)\s*$/.test(lead)) continue
        if (/[^=!<>]=\s*$/.test(lead)) continue
        offenders.push(`${f}:${src.slice(0, m.index).split('\n').length} DEFAULT_RULES.${field}`)
      }
    }
  }
  assert.deepEqual(offenders, [],
    'these read a KRA rule from the constant, so changing the policy in the '
    + 'admin screen will not change them — take a `rules` prop defaulting to '
    + 'DEFAULT_RULES and read that instead')
})

test('DEFAULT_RULES is still the documented fallback, and still 4/10/100/5', () => {
  // If the seed ever changes these, the fallback should follow — but
  // deliberately, not by surprise. Pinned so a casual edit is visible.
  assert.deepEqual(DEFAULT_RULES,
    { minKra: 4, maxKra: 10, totalWeightage: 100, minWeightagePerKra: 5,
      minKpi: 1, maxKpi: 5 })
  // And it must still be USED as a default somewhere, or the fallback has
  // quietly disappeared and a period with no policy would render NaN.
  const usedAsDefault = FILES.some(({ src }) => /=\s*DEFAULT_RULES\b/.test(src))
  assert.ok(usedAsDefault, 'nothing defaults to DEFAULT_RULES any more')
})

test('the policy columns behind these rules all exist in the schema', () => {
  // The mapping is minKra -> min_kra_count and so on. A rename on either side
  // would otherwise fail silently at runtime via `Number(undefined) || 4`,
  // which lands back on the constant and looks exactly like the bug this file
  // is about.
  //
  // A COLUMN CAN ARRIVE BY ALTER, NOT ONLY BY CREATE. This used to read only
  // the newest file containing `CREATE TABLE IF NOT EXISTS pms_policies` —
  // which is 066 — so a column added later by `ALTER TABLE pms_policies ADD
  // COLUMN` was reported missing even though it is in the live schema. Every
  // policy column since 196 arrived that way, including 221's KPI pair. The
  // fix is to read the whole migration directory, which is also what the
  // database does.
  const dir = 'supabase/migrations'
  const files = readdirSync(dir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  const creates = files.filter(f =>
    readFileSync(`${dir}/${f}`, 'utf8').includes('CREATE TABLE IF NOT EXISTS pms_policies'))
  assert.ok(creates.length, 'nothing creates pms_policies')

  // Only the statements that touch pms_policies, so a column name that
  // happens to appear in an unrelated table cannot vouch for this one.
  const schema = files.map(f => readFileSync(`${dir}/${f}`, 'utf8'))
    .flatMap(sql => [
      ...sql.matchAll(/CREATE TABLE IF NOT EXISTS pms_policies\b[\s\S]*?;/g),
      ...sql.matchAll(/ALTER TABLE pms_policies\b[\s\S]*?;/g),
    ].map(m => m[0]))
    .join('\n')
  assert.ok(schema.length > 500, 'no pms_policies statements found — wrong path?')

  const COLS: Record<keyof typeof DEFAULT_RULES, string> = {
    minKra: 'min_kra_count', maxKra: 'max_kra_count',
    totalWeightage: 'total_weightage', minWeightagePerKra: 'min_weightage_per_kra',
    minKpi: 'min_kpi_per_kra', maxKpi: 'max_kpi_per_kra',
  }
  // Every RULE needs a column. Driven off DEFAULT_RULES rather than a literal
  // list so adding a rule without a column fails here instead of at runtime.
  for (const field of Object.keys(DEFAULT_RULES)) {
    const col = COLS[field as keyof typeof COLS]
    assert.ok(col, `DEFAULT_RULES.${field} has no column mapped in this test`)
    assert.ok(new RegExp(`\\b${col}\\b`).test(schema),
      `pms_policies has no ${col} — the rules mapping is broken`)
  }
})

test('every rule reaches every read path, and the write path allows it', () => {
  // FOUR SELECTS AND A WRITE ALLOWLIST, and a rule is inert if it misses any
  // of them. 221 had to touch all five; the dashboard config tab, the ESS
  // API, the employee screen and the cycle header each build their own
  // `Rules` from their own select, and app/api/pms/admin/route.ts refuses to
  // write a column it does not name.
  //
  // This is the test that was missing when "changing configuration from setup
  // and control is not getting in effect" was reported: every individual
  // mapping looked right, and one of them did not exist.
  const READERS = [
    'app/dashboard/pms/page.tsx',
    'app/api/ess/pms/route.ts',
    'components/ess/Performance.tsx',
    'components/pms/CycleHeader.tsx',
  ]
  const KPI_COLS = ['min_kpi_per_kra', 'max_kpi_per_kra']
  for (const f of READERS) {
    const src = readFileSync(f, 'utf8')
    for (const col of KPI_COLS) {
      assert.ok(src.includes(col),
        `${f} never selects ${col}, so its Rules will fall back to the `
        + 'default and this screen will ignore the policy')
    }
  }
  for (const key of ['minKpi', 'maxKpi']) {
    for (const f of READERS) {
      assert.ok(readFileSync(f, 'utf8').includes(key),
        `${f} selects the column but never maps it to ${key}`)
    }
  }
  const route = readFileSync('app/api/pms/admin/route.ts', 'utf8')
  const allow = route.slice(route.indexOf('const POLICY_COLS'),
                            route.indexOf('] as const', route.indexOf('const POLICY_COLS')))
  for (const col of KPI_COLS) {
    assert.ok(allow.includes(`'${col}'`),
      `POLICY_COLS does not allow ${col}, so the admin screen will save it `
      + 'into nothing and report success')
  }
})

// ── §8's eligibility cut-off, the same mistake in a second place ─────────
//
// new_joiner_cutoff_days is policy configuration per §13.2, the admin screen
// now edits it, and §8 computes NEW_JOINER from it. It was enforced NOWHERE:
// no caller passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and
// a policy set to 45 changed nothing anybody could see.

test('nothing reads the new-joiner cut-off off the constant', () => {
  const offenders: string[] = []
  for (const { f, src } of FILES) {
    if (f.endsWith('lib/pms/employment.ts')) continue   // defines it
    for (const m of src.matchAll(/DEFAULT_FLAG_RULES\.newJoinerCutoffDays/g)) {
      const lead = src.slice(Math.max(0, m.index - 40), m.index)
      if (/(\|\||\?\?)\s*$/.test(lead)) continue
      if (/[^=!<>]=\s*$/.test(lead)) continue
      offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(offenders, [],
    'these read the cut-off from the constant, so a policy change will not '
    + 'reach them — take a FlagRules and pass it to flagFor/teamQueue')
})

test('every queue call site supplies the policy rules', () => {
  // The bug was not a wrong value, it was an ABSENT argument: teamQueue's
  // third parameter is optional, so omitting it compiles, runs, and silently
  // falls back to 30 days. A type cannot catch that; this can.
  const mgr = FILES.find(x => x.f.endsWith('components/pms/ManagerTabs.tsx'))
  assert.ok(mgr, 'ManagerTabs not found')
  const bare = [...mgr!.src.matchAll(/teamQueue\(\s*members\s*,\s*today\s*\)/g)]
  assert.equal(bare.length, 0,
    'teamQueue called without FlagRules — the policy cut-off will be ignored '
    + 'and DEFAULT_FLAG_RULES used instead')
})

test('DEFAULT_FLAG_RULES is still the documented 30-day fallback', () => {
  assert.deepEqual(DEFAULT_FLAG_RULES, { newJoinerCutoffDays: 30 })
})
