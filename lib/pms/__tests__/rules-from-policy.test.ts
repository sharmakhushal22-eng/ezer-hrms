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

const FILES = walk('components').concat(walk('app')).concat(walk('lib'))
  .map(f => ({ f, src: readFileSync(f, 'utf8') }))

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
    { minKra: 4, maxKra: 10, totalWeightage: 100, minWeightagePerKra: 5 })
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
  const dir = 'supabase/migrations'
  const create = readdirSync(dir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => readFileSync(`${dir}/${f}`, 'utf8')
      .includes('CREATE TABLE IF NOT EXISTS pms_policies'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop()
  assert.ok(create, 'nothing creates pms_policies')
  const sql = readFileSync(`${dir}/${create}`, 'utf8')
  for (const col of ['min_kra_count', 'max_kra_count',
                     'total_weightage', 'min_weightage_per_kra']) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(sql),
      `pms_policies has no ${col} — the rules mapping is broken`)
  }
})
