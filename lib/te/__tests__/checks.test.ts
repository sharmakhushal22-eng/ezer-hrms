import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkState, checkStateWords, checkTally, ENFORCED_ELSEWHERE, NOT_IMPLEMENTED, WHY_NOT } from '../checks.ts'

/** Every code the catalogue declares. A1-A6, B1-B7, C1-C11, D1-D10, E1-E4,
 *  F1-F4, G1-G13 — 55 of them, as seeded by migration 149. */
const ALL: string[] = ([['A', 6], ['B', 7], ['C', 11], ['D', 10], ['E', 4], ['F', 4], ['G', 13]] as const)
  .flatMap(([letter, n]) => Array.from({ length: n }, (_, i) => `${letter}${i + 1}`))

/** The engine's catalogue block: lines of the form ['C9', 'C', …]. Those are
 *  declarations, not evaluations, so they are excluded when deciding whether
 *  a code is used. */
const CATALOGUE_LINE = /\['[A-G]\d{1,2}', '[A-G]',/

/** The two migrations that only seed the catalogue. Everything else is code. */
const SEED_ONLY = (f: string) => f.includes('149_te_seed') || f.includes('156_te_journey_wording')

function evaluatedCodes(): Set<string> {
  const root = join(import.meta.dirname, '..', '..', '..')
  const used = new Set<string>()

  const engine = readFileSync(join(root, 'lib/te/engine/te-engine.js'), 'utf8')
    .split('\n')
    .filter(l => !CATALOGUE_LINE.test(l))
    .join('\n')
  for (const c of ALL) if (new RegExp(`'${c}'`).test(engine)) used.add(c)

  const dir = join(root, 'supabase/migrations')
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql') || SEED_ONLY(f)) continue
    const sql = readFileSync(join(dir, f), 'utf8')
    for (const c of ALL) if (new RegExp(`'${c}'`).test(sql)) used.add(c)
  }
  return used
}

test('the catalogue is 55 checks', () => {
  assert.equal(ALL.length, 55)
})

test('NOT_IMPLEMENTED is exactly what the source never evaluates', () => {
  // THE POINT OF THIS TEST. Admin → Checks tells an administrator which
  // controls run. If somebody implements C8 and forgets this list, the screen
  // keeps calling it unbuilt; if somebody deletes an evaluation, the screen
  // keeps calling it live. Either way the screen lies, so the list is
  // re-derived from the source here rather than trusted.
  const used = evaluatedCodes()
  const never = ALL.filter(c => !used.has(c)).sort()
  const claimed = [...NOT_IMPLEMENTED, ...Object.keys(ENFORCED_ELSEWHERE)].sort()
  assert.deepEqual(never, claimed,
    `\n  source says never evaluated: ${never.join(' ')}\n  this file claims:            ${claimed.join(' ')}\n`
    + '  Update NOT_IMPLEMENTED / ENFORCED_ELSEWHERE in lib/te/checks.ts.')
})

test('every unimplemented check says why', () => {
  for (const c of NOT_IMPLEMENTED) {
    assert.ok(WHY_NOT[c], `${c} has no reason in WHY_NOT`)
    assert.ok(WHY_NOT[c].length > 20, `${c}'s reason is too short to be one`)
  }
})

test('C9 is called enforced, not unbuilt', () => {
  // It raises no flag, but te_assert_active refuses a leaver outright at trip
  // save, expense save and claim submit. Calling that "not built" would be
  // the opposite of the truth.
  assert.equal(checkState('C9', false), 'enforced')
  assert.ok(!(NOT_IMPLEMENTED as readonly string[]).includes('C9'))
})

test('te_assert_active really is called by the three claim paths', () => {
  // The claim that C9 is enforced rests entirely on this, so it is checked
  // against the SQL rather than asserted. Each function is read from its
  // CURRENT definition — the last migration that defines it — because an
  // older copy proves nothing about what is deployed.
  const dir = join(import.meta.dirname, '..', '..', '..', 'supabase/migrations')
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  for (const fn of ['te_trip_save', 'te_expense_save', 'te_claim_submit']) {
    let latest: string | null = null
    let body = ''
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8')
      const at = sql.indexOf(`create or replace function ${fn}(`)
      if (at < 0) continue
      const open = sql.indexOf('$'.repeat(2), at)
      const close = sql.indexOf('$'.repeat(2), open + 2)
      latest = f
      body = sql.slice(at, close)
    }
    assert.ok(latest, `${fn} is defined nowhere`)
    assert.ok(body.includes('te_assert_active'),
      `${fn}'s current definition (${latest}) does not call te_assert_active — a leaver could claim`)
  }
})

test('a live check and a later check are told apart', () => {
  assert.equal(checkState('A1', true), 'live')
  assert.equal(checkState('A1', false), 'later')
})

test('an unimplemented check is never dressed up as live', () => {
  // is_live is true on some of these in the seed, which is exactly the trap:
  // "Checked as they type" was being shown for a check that runs nowhere.
  for (const c of NOT_IMPLEMENTED) {
    assert.equal(checkState(c, true), 'unbuilt', c)
    assert.equal(checkState(c, false), 'unbuilt', c)
  }
})

test('the words warn rather than reassure when nothing runs', () => {
  const w = checkStateWords('unbuilt')
  assert.equal(w.tone, 't-warn')
  assert.match(w.help, /Do not rely on it/)
  assert.notEqual(checkStateWords('live').label, w.label)
})

test('the tally separates what is off by choice from what cannot run', () => {
  const rows = [
    { code: 'A1', on: true, live: true },    // running
    { code: 'A2', on: false, live: true },   // switched off deliberately
    { code: 'C8', on: true, live: false },   // unbuilt, whatever the switch says
    { code: 'C8', on: false, live: false },  // still unbuilt
  ]
  assert.deepEqual(checkTally(rows), { total: 4, running: 1, unbuilt: 2, offByChoice: 1 })
})
