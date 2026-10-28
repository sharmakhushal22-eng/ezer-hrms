// A text box over a CHECK constraint is a trap, and the screen sets it.
//
// pms_policies.kra_created_by accepts exactly 'EMPLOYEE', 'MANAGER' or
// 'BOTH'. The admin editor rendered it as <input>, so saving a policy failed:
//
//   new row for relation "pms_policies" violates check constraint
//   "pms_policies_kra_created_by_check"
//
// Reported by an admin who had done nothing wrong except type into a box the
// screen offered them. approval_chain and who_can_finalise were the same, and
// frequency — the one next to them — was already a correct <select>, which is
// how three of four came to be wrong without anyone noticing.
//
// The constraint is the authority, so this test reads it out of the migration
// rather than restating the values here. Any CHECK-constrained column the
// policy editor exposes has to be a chooser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CHAINS, CHAIN_LABEL, FINALISERS, FINALISER_LABEL } from '../hierarchy.ts'

const DIR = 'supabase/migrations'

/** The migration that most recently creates pms_policies, found by number. */
function policyTableSql(): string {
  const hits = readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => readFileSync(`${DIR}/${f}`, 'utf8')
      .includes('CREATE TABLE IF NOT EXISTS pms_policies'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  assert.ok(hits.length, 'nothing creates pms_policies')
  const sql = readFileSync(`${DIR}/${hits[hits.length - 1]}`, 'utf8')
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS pms_policies')
  return sql.slice(start, sql.indexOf('\n);', start))
}

/** column -> permitted values, straight from the CHECK (col IN (...)) clauses. */
function enumColumns(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const re = /CHECK\s*\(\s*([a-z_]+)\s+IN\s*\(([^)]*)\)/gi
  for (const m of policyTableSql().matchAll(re)) {
    out[m[1]] = [...m[2].matchAll(/'([A-Z0-9_]+)'/g)].map(x => x[1])
  }
  return out
}

const ENUMS = enumColumns()
const EDITOR = readFileSync('components/pms/AdminEditor.tsx', 'utf8')

test('the policy table really does constrain these columns', () => {
  // Guards the guard: a parsing slip here would make the rest pass vacuously.
  assert.ok(Object.keys(ENUMS).length >= 4,
    `only parsed ${Object.keys(ENUMS).length} CHECK columns — did the table change?`)
  assert.deepEqual(ENUMS.kra_created_by, ['EMPLOYEE', 'MANAGER', 'BOTH'])
})

test('no CHECK-constrained policy column is edited as free text', () => {
  const bad: string[] = []
  for (const col of Object.keys(ENUMS)) {
    // Does the editor touch this column at all? If not, it cannot be broken.
    if (!EDITOR.includes(`'${col}'`)) continue
    // The control that writes it must be a select, not an input.
    //
    // Found by walking BACKWARDS from the setter to the nearest enclosing tag,
    // not by a forward regex. The first version used `<input[^>]*set\('col'`
    // and silently matched nothing: [^>] cannot cross the `>` inside the
    // `=>` of `onChange={e => set(...)}`, so it stopped at the arrow every
    // time. It passed against the broken code it was written to catch —
    // proved by reintroducing the bug and watching it still pass.
    for (const m of EDITOR.matchAll(new RegExp(`set\\('${col}'`, 'g'))) {
      const before = EDITOR.slice(0, m.index)
      const tag = Math.max(before.lastIndexOf('<input'), before.lastIndexOf('<select'))
      if (tag >= 0 && before.slice(tag).startsWith('<input')) bad.push(col)
    }
  }
  assert.deepEqual(bad, [],
    'these write a CHECK-constrained column from a free-text box, so any value '
    + 'outside the enum is rejected by the database with a constraint error')
})

test('the chain and finaliser dropdowns cannot offer a value the DB rejects', () => {
  // The reverse risk: a chooser offering something the CHECK forbids would
  // fail on save just as surely, only less obviously.
  for (const c of CHAINS) {
    assert.ok(ENUMS.approval_chain.includes(c),
      `CHAINS offers ${c}, which approval_chain's CHECK does not permit`)
    assert.ok(CHAIN_LABEL[c], `${c} has no label`)
  }
  for (const f of FINALISERS) {
    assert.ok(ENUMS.who_can_finalise.includes(f),
      `FINALISERS offers ${f}, which who_can_finalise's CHECK does not permit`)
    assert.ok(FINALISER_LABEL[f], `${f} has no label`)
  }
})

test('a chain the schema allows but the module cannot run is NOT offered', () => {
  // SELF_RM1_RM2_HOD_MD is in the CHECK and in §6.2's example policy table,
  // but lib/pms/hierarchy has no MD step: no CHAIN_STEPS entry, no finaliser,
  // nothing in the queues. Offering it would let an admin configure a chain
  // the module cannot execute, which is worse than not offering it at all.
  //
  // This test is the record of that gap, not an endorsement of it. When MD is
  // implemented, add it to CHAINS and this flips to requiring it.
  const dbAllows = ENUMS.approval_chain
  const appKnows = CHAINS as readonly string[]
  const unsupported = dbAllows.filter(c => !appKnows.includes(c))
  assert.deepEqual(unsupported, ['SELF_RM1_RM2_HOD_MD'],
    'the set of chains the schema permits but the app does not implement has '
    + 'changed — either implement it, or update this test deliberately')
})
