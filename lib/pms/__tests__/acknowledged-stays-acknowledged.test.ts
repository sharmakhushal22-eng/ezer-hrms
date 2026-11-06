// lib/pms/__tests__/acknowledged-stays-acknowledged.test.ts
//
// OBSERVED on Anil Verma (STC9030): he was ACKNOWLEDGED — he had read his
// result and confirmed it — and a second publish from the app put his row
// back to PUBLISHED and overwrote published_at with a later timestamp. The
// fact survived in employee_ack; the status said he had never acknowledged,
// and the record of when his result actually reached him was lost.
//
// Both publish paths set workflow_status and published_at unconditionally.
// 193's readonly guard only polices read-only rows; 190's recompute preserves
// the terminal statuses but a direct UPDATE from a screen bypasses it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(process.cwd(),
  'supabase/migrations/201_pms_an_acknowledged_result_stays_acknowledged.sql'), 'utf8')

test('exactly one transition is blocked, and it is the right one', () => {
  assert.match(sql,
    /OLD\.workflow_status = 'ACKNOWLEDGED' AND NEW\.workflow_status = 'PUBLISHED'/,
    'the guard does not target ACKNOWLEDGED -> PUBLISHED')
  assert.match(sql, /NEW\.workflow_status := 'ACKNOWLEDGED';/,
    'it does not hold the row at ACKNOWLEDGED')
})

test('it does NOT block the backward moves that are meant to happen', () => {
  // Blocking every regression would break two real flows:
  //   190's retraction — "a retracted rating has to move the score back down"
  //   an HR correction — pms_finalise writes FINALISED, so re-finalising an
  //   acknowledged row is ACKNOWLEDGED -> FINALISED by design, and 192's bulk
  //   calibration does it for a whole upload.
  // The guard must therefore be a single named transition, never a general
  // "status may not decrease" rule.
  assert.ok(!/FINALISED'\s*THEN\s*\n?\s*RAISE/.test(sql),
    'the guard interferes with an HR re-finalise')
  assert.ok(!/NOT IN \('PUBLISHED','ACKNOWLEDGED'\)/.test(sql),
    'the guard has become a general backward-move rule and will break '
    + '190\'s retraction path')
  // One IF for the status, by name. Not a ladder comparison.
  const ifs = sql.match(/IF OLD\.workflow_status/g) ?? []
  assert.equal(ifs.length, 1, `expected one status guard, found ${ifs.length}`)
})

test('it keeps the row rather than raising', () => {
  // Publishing a result that is already out is a no-op, not an error. An
  // exception would put a red banner on a button press that did nothing wrong,
  // and would abort the rest of the same UPDATE.
  // Anchored on the STATEMENT at line start, not the substring: the header
  // comment above describes "one DROP TRIGGER IF EXISTS + CREATE TRIGGER",
  // so indexOf('DROP TRIGGER') landed in the prose ABOVE the function and the
  // slice came back empty — a vacuous pass turning into a confusing failure.
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION pms_keep_acknowledged'),
                       sql.search(/^DROP TRIGGER IF EXISTS/m))
  assert.ok(!/RAISE/.test(fn), 'the guard raises instead of silently holding')
  assert.match(fn, /RETURN NEW;/)
})

test('the first delivery date survives a second publish', () => {
  // published_at answers "when did this reach the employee" — the first
  // delivery, not the most recent button press. Anil's was overwritten.
  assert.match(sql, /IF OLD\.published_at IS NOT NULL THEN\s*\n\s*NEW\.published_at := OLD\.published_at;/,
    'published_at is not held to its first value')
})

test('the trigger fires last, so it has the final say', () => {
  // BEFORE triggers run in alphabetical order. This one corrects what
  // trg_pms_publish_needs_signoff (200) and trg_pms_readonly (193/195/197)
  // let through, so its name has to sort after both.
  assert.match(sql, /CREATE TRIGGER trg_pms_settled_stays_settled/)
  for (const earlier of ['trg_pms_publish_needs_signoff', 'trg_pms_readonly']) {
    assert.ok('trg_pms_settled_stays_settled' > earlier,
      `trg_pms_settled_stays_settled must sort after ${earlier}`)
  }
  assert.match(sql, /BEFORE UPDATE ON pms_overall_rating/)
})

test('the repair is scoped, idempotent, and restores a fact rather than inventing one', () => {
  // The only data-changing statement in the series. employee_ack = true is
  // the employee's own acknowledgement; a status of PUBLISHED beside it is the
  // contradiction being repaired.
  const upd = sql.slice(sql.indexOf('UPDATE pms_overall_rating'))
  assert.match(upd, /WHERE workflow_status = 'PUBLISHED'\s*\n\s*AND employee_ack = true;/,
    'the repair has no WHERE, or the wrong one')
  // Running it twice must be a no-op: the first run empties its own WHERE.
  assert.ok(upd.includes("SET workflow_status = 'ACKNOWLEDGED'"))
  // And it must not try to invent a published_at it cannot know.
  assert.ok(!/SET[^;]*published_at/.test(upd),
    'the repair writes published_at, which is not recoverable from this table')
  // Exactly one UPDATE in the whole migration.
  assert.equal((sql.match(/^UPDATE /gm) ?? []).length, 1)
})

test('nothing is dropped or deleted', () => {
  // The SQL editor flagged 200 as destructive on its DROP TRIGGER. This one
  // has the same idempotent idiom and nothing else, and the header says so.
  for (const bad of ['DELETE FROM', 'TRUNCATE', 'DROP TABLE', 'DROP COLUMN',
                     'DROP CONSTRAINT', 'DROP FUNCTION', 'DROP POLICY']) {
    assert.ok(!sql.includes(bad), `201 contains ${bad}`)
  }
  // Statements only — the header prose names the idiom too.
  assert.equal((sql.match(/^DROP TRIGGER IF EXISTS/gm) ?? []).length, 1)
})
