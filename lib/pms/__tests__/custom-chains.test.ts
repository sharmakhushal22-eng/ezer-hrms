// Approval chains an administrator composes.
//
// Requested: the chain should be fully customisable and editable — change
// the KRA and approval chains, build a completely new one, all from the
// admin side.
//
// ── WHY THIS WAS A SMALL CHANGE ──────────────────────────────────────────
//
// rungs() was already the single source of the ordered list, and
// nextRung/prevRung already worked on whatever it returned, skipping rungs
// nobody occupies. So a custom chain is: let rungs() take the composed list
// instead of looking one up. Everything downstream was already general.
//
// ── THE TWO THINGS THAT MUST NOT BREAK ───────────────────────────────────
//
// 1. THE THREE PRESETS STILL WORK, IDENTICALLY. chain_id is nullable and
//    null means approval_chain, so every policy that has not been touched
//    must behave exactly as it did.
//
// 2. AN EMPTY RUNG IS STEPPED OVER, NOT BLOCKED ON. RM L2 is absent for
//    about half the company today and the chain already handles it; a
//    composed chain naming REGIONAL_HEAD — populated for nobody — must
//    behave the same way rather than stranding every appraisal.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rungs, firstRung, nextRung, prevRung, heldBy, STAGE_LABEL,
         STAGE_SHORT, STAGES, type Stage } from '../chain.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/218_pms_custom_chains.sql')

// ── the presets are untouched ────────────────────────────────────────────

test('the three presets still produce exactly what they did', () => {
  // chain_id is nullable and null means approval_chain, so a policy nobody
  // has touched must behave identically.
  assert.deepEqual(rungs('SELF_RM1_RM2_HOD'), ['RM_L1', 'RM_L2', 'HOD', 'HR'])
  assert.deepEqual(rungs('SELF_RM1_HOD'), ['RM_L1', 'HOD', 'HR'])
  assert.deepEqual(rungs('SELF_RM1'), ['RM_L1', 'HR'])
})

test('an unknown or missing chain falls back rather than throwing', () => {
  // A policy row read before 218, or one with a chain that was deleted.
  // Returning the default beats an exception in the middle of a queue.
  assert.deepEqual(rungs(null), ['RM_L1', 'RM_L2', 'HOD', 'HR'])
  assert.deepEqual(rungs(undefined), ['RM_L1', 'RM_L2', 'HOD', 'HR'])
})

// ── composed chains ──────────────────────────────────────────────────────

test('a composed chain travels in the order it was written', () => {
  assert.deepEqual(rungs(['RM_L1', 'SITE_HR', 'HOD']),
    ['RM_L1', 'SITE_HR', 'HOD', 'HR'])
  // Order is the data: the same rungs in a different order is a different
  // chain, not the same one.
  assert.deepEqual(rungs(['HOD', 'RM_L1']), ['HOD', 'RM_L1', 'HR'])
})

test('HR is appended when missing and never duplicated', () => {
  // Somebody has to publish, so a chain omitting HR still gets it — no
  // administrator should be able to compose a chain whose results can
  // never come out. And a chain that already names it must not get a
  // second one: the duplicate would park an appraisal on a rung it had
  // just left.
  assert.deepEqual(rungs(['RM_L1']), ['RM_L1', 'HR'])
  assert.deepEqual(rungs(['RM_L1', 'HR']), ['RM_L1', 'HR'])
  assert.equal(rungs(['HR', 'RM_L1']).filter(r => r === 'HR').length, 1)
})

test('the self rating is not a rung of the approval chain', () => {
  // EMPLOYEE is where the appraisal starts, not somewhere it is approved.
  // The presets have always filtered it out and a composed chain must too.
  assert.deepEqual(rungs(['EMPLOYEE', 'RM_L1', 'HOD']), ['RM_L1', 'HOD', 'HR'])
})

test('the same rung twice is a loop, not two approvals', () => {
  assert.deepEqual(rungs(['RM_L1', 'HOD', 'RM_L1']), ['RM_L1', 'HOD', 'HR'])
})

test('DONE is the end of the chain, not a rung of it', () => {
  // The database cannot store DONE in rungs[] — 218's whitelist omits it —
  // but Stage includes it, so a builder offering the stage list would put it
  // on the menu. A chain ending at DONE rather than HR is one whose results
  // never publish.
  assert.deepEqual(rungs(['RM_L1', 'DONE']), ['RM_L1', 'HR'])
  assert.deepEqual(rungs(['DONE']), ['HR'])
})

test('a chain of nothing still ends somewhere', () => {
  // The database refuses an empty rungs[], but the engine must not throw
  // if one reaches it anyway.
  assert.deepEqual(rungs([]), ['HR'])
  assert.equal(firstRung([]), 'HR')
})

test('the first rung is where a fresh submission lands', () => {
  assert.equal(firstRung(['SITE_HR', 'HOD']), 'SITE_HR')
  assert.equal(firstRung('SELF_RM1_RM2_HOD'), 'RM_L1')
})

// ── empty rungs are stepped over ─────────────────────────────────────────

const HELD_ALL = heldBy({ rmL1Id: 'a', rmL2Id: 'b', hodId: 'c',
                          siteHrId: 'd', regionalHeadId: 'e' })
// The real shape of this database: no regional head anywhere, and RM L2
// missing for about half the company.
const TYPICAL = heldBy({ rmL1Id: 'a', hodId: 'c', siteHrId: 'd' })

test('heldBy knows the two rungs 218 adds', () => {
  assert.equal(HELD_ALL('SITE_HR'), true)
  assert.equal(HELD_ALL('REGIONAL_HEAD'), true)
  assert.equal(TYPICAL('SITE_HR'), true)
  assert.equal(TYPICAL('REGIONAL_HEAD'), false, 'an unpopulated rung reads as held')
  assert.equal(TYPICAL('RM_L2'), false)
  // HR is a role, not a person on the snapshot, so it is always held.
  assert.equal(heldBy({})('HR'), true)
})

test('a chain naming a rung nobody occupies steps straight over it', () => {
  // regional_head_id is set for 0 of 401 employees. A chain using it must
  // behave like RM L2 does today for half the company: skipped, not stuck.
  const chain: Stage[] = ['RM_L1', 'REGIONAL_HEAD', 'HOD']
  assert.equal(nextRung(chain, 'RM_L1', TYPICAL), 'HOD',
    'the appraisal stranded on a rung with nobody on it')
  // And with somebody there, it is not skipped.
  assert.equal(nextRung(chain, 'RM_L1', HELD_ALL), 'REGIONAL_HEAD')
})

test('a rejection also skips the empty rung, going back', () => {
  // Skipping matters more backwards: a rejection that strands an appraisal
  // on nobody leaves the employee waiting for a correction that can never
  // be made.
  const chain: Stage[] = ['RM_L1', 'REGIONAL_HEAD', 'HOD']
  assert.equal(prevRung(chain, 'HOD', TYPICAL), 'RM_L1')
  assert.equal(prevRung(chain, 'HOD', HELD_ALL), 'REGIONAL_HEAD')
})

test('the end of a composed chain is the end', () => {
  assert.equal(nextRung(['RM_L1', 'HOD'], 'HR', HELD_ALL), null)
  // A stage the chain does not contain returns null rather than guessing —
  // an in-flight appraisal parked on a rung a chain edit removed.
  assert.equal(nextRung(['RM_L1', 'HOD'], 'RM_L2', HELD_ALL), null)
})

// ── every stage is nameable ──────────────────────────────────────────────

test('both new stages have a label and a short label', () => {
  // A rung with no name renders as blank in the track and the status cell.
  for (const s of STAGES) {
    assert.ok(STAGE_LABEL[s], `${s} has no label`)
    assert.ok(STAGE_SHORT[s], `${s} has no short label`)
    assert.ok(STAGE_SHORT[s].length <= 10, `${s}'s short label is a sentence`)
  }
  assert.equal(STAGE_SHORT.SITE_HR, 'Site HR')
})

// ── 218 ──────────────────────────────────────────────────────────────────

/**
 * ONE statement, not the rest of the file.
 *
 * Slicing from a marker to the end of the file is how a CHECK assertion goes
 * vacuous: SITE_HR appears in both widened CHECKs, so a slice that runs past
 * the first one passes on the second one's text while the constraint under
 * test no longer mentions it at all. Mutation testing is what caught that.
 */
function stmt(marker: string): string {
  const i = SQL.indexOf(marker)
  assert.notEqual(i, -1, `218 has no ${marker}`)
  const end = SQL.indexOf(';', i)
  return SQL.slice(i, end === -1 ? undefined : end + 1)
}

test('218 refuses a chain with no rungs', () => {
  assert.match(SQL, /CONSTRAINT pms_chain_has_rungs CHECK \(array_length\(rungs, 1\) >= 1\)/,
    'an empty chain would leave an appraisal nowhere to go')
})

test('218 refuses a rung that resolves to nobody', () => {
  const c = stmt('CONSTRAINT pms_chain_known_rungs')
  assert.match(c, /rungs <@ ARRAY\['EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR',\s*\n?\s*'REGIONAL_HEAD','HR'\]::text\[\]/,
    'a rung the application cannot resolve to a person would be accepted')
  // The whitelist has to BE the constraint, not sit beside something that
  // makes it always true.
  assert.ok(!/\bOR\b|\btrue\b/i.test(c), `the whitelist is not what decides: ${c}`)
  // DONE is the terminal marker, not somewhere an appraisal waits.
  assert.ok(!c.includes("'DONE'"), 'DONE is storable as a rung')
})

test('218 widens both CHECKs that would have refused a custom chain', () => {
  const cs = stmt('ADD CONSTRAINT pms_overall_rating_chain_stage_allowed')
  const rr = stmt('ADD CONSTRAINT pms_reviews_rater_role_allowed')
  for (const stage of ['SITE_HR', 'REGIONAL_HEAD']) {
    assert.ok(cs.includes(`'${stage}'`), `chain_stage still refuses ${stage}`)
    assert.ok(rr.includes(`'${stage}'`), `rater_role still refuses ${stage}`)
  }
  // And nothing that was allowed before is dropped. A CHECK is recreated
  // whole, so widening it is also the moment a value silently disappears.
  for (const s of ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR', 'DONE']) {
    assert.ok(cs.includes(`'${s}'`), `${s} was dropped from chain_stage`)
  }
  for (const r of ['SELF', 'RM_L1', 'RM_L2', 'HOD', 'MD', 'HR_HEAD']) {
    assert.ok(rr.includes(`'${r}'`), `${r} was dropped from rater_role`)
  }
})

test('chain_stage stays nullable', () => {
  // NULL means "not submitted", which 197 is explicit is distinct from
  // EMPLOYEE — "never started" and "sent back" look identical otherwise.
  const cs = stmt('ADD CONSTRAINT pms_overall_rating_chain_stage_allowed')
  assert.match(cs, /CHECK \(chain_stage IS NULL OR chain_stage IN/)
})

test('218 changes no policy and no appraisal', () => {
  // chain_id is nullable and null means approval_chain, so applying this
  // changes nothing until a chain is built and chosen.
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES pms_chain\(id\)/)
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/^\s*UPDATE\s+\w/mi, /\bDELETE\s+FROM\b/i, /\bINSERT\b/i,
                   /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!f.test(body), `218 matches ${f}`)
  }
})

test('deleting a chain does not delete the policies using it', () => {
  assert.match(SQL, /ON DELETE SET NULL/,
    'removing a chain would cascade into the policies that point at it')
})
