// Do the status strings the app filters on actually exist in the schema?
//
// This is the only test here that reads the migration. It exists because a
// wrong status string is SILENT: PostgREST answers 200 with zero rows, the
// screen renders its empty state, and nothing anywhere says "that value is
// not in the CHECK constraint". Three of these were wrong on the first pass
// and none of them would have thrown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PERIOD_STATUS, PERIOD_OPEN, GOAL_STATUS, GOAL_SENT, GOAL_AWAITING_RM,
  WORKFLOW, WORKFLOW_ORDER, reached,
} from '../status.ts'

const SQL = readFileSync('supabase/migrations/066_pms_module.sql', 'utf8')

/** The values a column's CHECK (col IN (...)) actually permits.
 *
 *  The character class must include DIGITS. Written as [A-Z_]+ it silently
 *  skips RM_L1_DONE and RM_L2_DONE — the quote-delimited match fails at the
 *  digit — and the test then reports a legal value as forbidden, which is a
 *  false failure pointing at correct code. */
function allowed(column: string): string[] {
  // No /s flag: the project targets below es2018, and [^)] already crosses
  // newlines, so it was decorative anyway.
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`)
  const m = re.exec(SQL)
  assert.ok(m, `no CHECK found for ${column} — did the migration change?`)
  return [...m![1].matchAll(/'([A-Z0-9_]+)'/g)].map(x => x[1])
}

test('the migration still constrains all three columns', () => {
  // If any of these disappears the tests below would vacuously pass.
  for (const c of ['status', 'workflow_status']) {
    assert.ok(new RegExp(`CHECK\\s*\\(\\s*${c}\\s+IN`).test(SQL), `${c} is unconstrained`)
  }
})

test('every period status the app knows is one the schema allows', () => {
  const ok = allowed('status')
  for (const v of Object.values(PERIOD_STATUS)) {
    assert.ok(ok.includes(v), `${v} is not a permitted period status`)
  }
})

test('ACTIVE is NOT a period status — the bug this file exists for', () => {
  const ok = allowed('status')
  assert.equal(ok.includes('ACTIVE'), false)
  assert.equal((PERIOD_OPEN as string[]).includes('ACTIVE'), false)
  assert.ok(PERIOD_OPEN.length > 0)
  for (const v of PERIOD_OPEN) assert.ok(ok.includes(v), `${v} not permitted`)
})

test('goal statuses are real, and SUBMITTED/APPROVED are not among them', () => {
  const ok = allowed('status')   // first CHECK(status IN ...) in the file
  const goals = [...SQL.matchAll(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/g)]
    .map(m => [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map(x => x[1]))
    .find(list => list.includes('DRAFT'))
  assert.ok(goals, 'goal status CHECK not found')
  for (const v of Object.values(GOAL_STATUS)) {
    assert.ok(goals!.includes(v), `${v} is not a permitted goal status`)
  }
  assert.equal(goals!.includes('SUBMITTED'), false, 'SUBMITTED was guessed and does not exist')
  assert.equal(goals!.includes('APPROVED'), false, 'APPROVED was guessed and does not exist')
  for (const v of [...GOAL_SENT, ...GOAL_AWAITING_RM]) {
    assert.ok(goals!.includes(v), `${v} not permitted`)
  }
  assert.ok(ok.length > 0)
})

test('every workflow value the app knows is one the schema allows', () => {
  const ok = allowed('workflow_status')
  for (const v of Object.values(WORKFLOW)) {
    assert.ok(ok.includes(v), `${v} is not a permitted workflow status`)
  }
  // and the ladder covers the whole vocabulary, so `reached` can never be
  // handed a legal value it does not understand
  for (const v of ok) assert.ok(WORKFLOW_ORDER.includes(v), `${v} missing from WORKFLOW_ORDER`)
})

test('reached() walks the ladder and refuses to guess', () => {
  assert.equal(reached(WORKFLOW.PUBLISHED, WORKFLOW.SELF_SUBMITTED), true)
  assert.equal(reached(WORKFLOW.SELF_SUBMITTED, WORKFLOW.SELF_SUBMITTED), true)
  assert.equal(reached(WORKFLOW.KRA_LOCKED, WORKFLOW.SELF_SUBMITTED), false)
  // An unknown status must never read as further along than it is.
  assert.equal(reached('WHATEVER', WORKFLOW.NOT_STARTED), false)
  assert.equal(reached(null, WORKFLOW.NOT_STARTED), false)
  assert.equal(reached(undefined, WORKFLOW.KRA_DRAFT), false)
})
