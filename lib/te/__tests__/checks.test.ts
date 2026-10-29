import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENFORCED_ELSEWHERE, NOT_IMPLEMENTED, WHY_NOT, approverWatchEmpty, checkState, checkStateWords, checkTally, fastApproverText, pairedApproverText, tookText,
} from '../checks.ts'

/** Every code the catalogue declares. A1-A6, B1-B7, C1-C11, D1-D10, E1-E4,
 *  F1-F4, G1-G13 — 55 of them, as seeded by migration 149. */
const ALL: string[] = ([['A', 6], ['B', 7], ['C', 11], ['D', 10], ['E', 4], ['F', 4], ['G', 13]] as const)
  .flatMap(([letter, n]) => Array.from({ length: n }, (_, i) => `${letter}${i + 1}`))

/** The engine's catalogue block: lines of the form ['C9', 'C', …]. Those are
 *  declarations, not evaluations, so they are excluded when deciding whether
 *  a code is used. */
const CATALOGUE_LINE = /\['[A-G]\d{1,2}', '[A-G]',/

/** The two migrations that only seed the catalogue. Everything else is code.
 *
 *  MATCHED WITHOUT THE NUMBER, because the number moves. te_journey_wording
 *  was 156 on one branch and 162 on another, and merging renamed it: the guard
 *  stopped matching, the file was scanned as code, and its catalogue
 *  DECLARATIONS of C9, E4 and G6 made all three look evaluated — so this test
 *  reported the list as stale when nothing about the checks had changed.
 *  The trailing `\.sql$` keeps the backfill out of the pattern; it carries no
 *  check codes either way, but the two files are not the same claim. */
const SEED_ONLY = (f: string) => f.includes('149_te_seed') || /^\d+_te_journey_wording\.sql$/.test(f)

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
    // G6 on purpose: a browser may not inspect the device for a mock-location
    // app, so unlike the others this one is not waiting to be written. Using a
    // merely-unbuilt code here means this fixture breaks every time one gets
    // built, which has now happened twice.
    { code: 'G6', on: true, live: false },   // unbuilt, whatever the switch says
    { code: 'G6', on: false, live: false },  // still unbuilt
  ]
  assert.deepEqual(checkTally(rows), { total: 4, running: 1, unbuilt: 2, offByChoice: 1 })
})

// ── F2 and F3 wording ───────────────────────────────────────────────────────

test('a duration is read in the unit a person would use', () => {
  assert.equal(tookText(0), 'under a second')
  assert.equal(tookText(4), '4 seconds')
  assert.equal(tookText(90), '2 minutes')
  assert.equal(tookText(5400), '2 hours')
  assert.equal(tookText(172800), '2 days')
  // Singulars, because "1 minutes" is how a report loses its reader.
  assert.equal(tookText(60), '1 minute')
  assert.equal(tookText(3600), '1 hour')
  assert.equal(tookText(86400), '1 day')
})

test('an F2 line gives the count, the fastest and the typical', () => {
  const s = fastApproverText({ flagged: 9, fast: 7, fastestSecs: 3, medianSecs: 22 }, 60)
  assert.match(s, /7 of 9 flagged claims/)
  assert.match(s, /within 60 seconds/)
  assert.match(s, /Fastest 3 seconds/)
  assert.match(s, /typically 22 seconds/)
})

test('an F2 line says claim, not claims, for one', () => {
  assert.match(fastApproverText({ flagged: 1, fast: 1, fastestSecs: 2, medianSecs: 2 }, 60), /1 of 1 flagged claim decided/)
})

test('an F3 line is a share and says so', () => {
  // The denominator is the point: three of three is a pattern, three of
  // thirty is not, and a bare count cannot tell them apart.
  const s = pairedApproverText({ pairs: 6, theirTotal: 7, pct: 86, employeeName: 'Anil Verma' })
  assert.match(s, /6 of Anil Verma's 7 flagged claims/)
  assert.match(s, /86%/)
})

test('finding nothing reads as a clean result, not a broken report', () => {
  assert.match(approverWatchEmpty('f2', 60, 80), /Nobody has been clearing/)
  assert.match(approverWatchEmpty('f3', 60, 80), /No approver is taking more than 80%/)
  for (const k of ['f2', 'f3'] as const) {
    assert.ok(!/no data|none found|empty/i.test(approverWatchEmpty(k, 60, 80)), k)
  }
})
