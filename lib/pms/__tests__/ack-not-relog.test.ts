// lib/pms/__tests__/ack-not-relog.test.ts
//
// ACKNOWLEDGING A FINAL REVIEW IS NOT LOGGING ONE.
//
// 199 put a trigger on pms_one_to_one so a final review cannot be logged
// before the chain ahead of it has finished. It is BEFORE INSERT OR UPDATE
// and the check ran on both — so ticking the manager's acknowledgement on a
// row that ALREADY EXISTED re-ran the readiness check and was refused.
//
// Observed: Amit Gupta (STCCON9008) has a FINAL_REVIEW against an appraisal
// that is NOT_STARTED. Acknowledging it returned P0001 "The final review
// cannot be logged yet: their self rating is not in yet." The screen had done
// nothing wrong — it was setting manager_ack on a row whose existence was
// decided long before.
//
// 201 makes exactly this argument about publication and gets it right. This
// is the same mistake, one migration earlier.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/204_pms_acknowledging_a_final_review_is_not_logging_one.sql')
const PERF = read('components/ess/Performance.tsx')

test('an update to a row that was already a final review passes', () => {
  assert.match(SQL, /IF TG_OP = 'UPDATE' AND OLD\.discussion_type = 'FINAL_REVIEW' THEN\s*\n\s*RETURN NEW;/,
    'acknowledging an existing final review is still gated as though it were a new one')
})

test('but turning another discussion INTO a final review is still gated', () => {
  // Otherwise the rule is bypassable: insert an ADHOC row, then edit its type.
  // The exemption has to test OLD, not merely that the operation is an UPDATE.
  assert.ok(!/IF TG_OP = 'UPDATE' THEN\s*\n\s*RETURN NEW;/.test(SQL),
    'every update is exempt, so the rule can be bypassed by editing a row\'s type')
  assert.match(SQL, /OLD\.discussion_type = 'FINAL_REVIEW'/)
})

test('the INSERT path keeps every check 199 added', () => {
  // The fix must not weaken the thing 199 was for.
  assert.match(SQL, /v_why := pms_chain_ready_before\(NEW\.employee_id, NEW\.period_id, v_rung\)/)
  assert.match(SQL, /RAISE EXCEPTION '%', v_why/)
  // And the rung is still read from the logger, not assumed.
  assert.match(SQL, /WHEN NEW\.manager_id = o\.hod_id\s+THEN 'HOD'/)
})

test('204 changes nothing but that function', () => {
  // STATEMENTS AT LINE START, not substrings. The header explains when an
  // UPDATE is still gated, so a bare includes() matched my own prose — the
  // third time that has caught me in this file's history, and the reason the
  // check is anchored.
  const statements = SQL.split('\n')
    .filter(l => /^\s*(ALTER TABLE|DELETE FROM|DROP|UPDATE|INSERT)\b/.test(l))
  assert.deepEqual(statements, [],
    `204 contains statements it should not: ${statements.join(' | ')}`)
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION/gm) ?? []).length, 1)
})

// ── and the reason this took a round trip ────────────────────────────────

test('a Supabase failure logs its message, not an empty object', () => {
  // The refusal above reached the console as `{}` — console.error on a
  // PostgrestError prints nothing useful through the Next dev overlay. A real
  // P0001 with a full sentence explaining itself was reported as an empty
  // object with no cause and no code.
  assert.match(PERF, /function logFail\(where: string, e: unknown\)/,
    'there is no error-logging helper, so refusals will keep arriving as {}')
  const fn = PERF.slice(PERF.indexOf('function logFail'), PERF.indexOf('function logFail') + 600)
  for (const field of ['code', 'message', 'details', 'hint']) {
    assert.ok(fn.includes(`x.${field}`), `logFail drops ${field}`)
  }
})

test('every PMS error path uses it', () => {
  // One missed site is one refusal that still arrives as {}.
  const raw = [...PERF.matchAll(/console\.error\(/g)].length
  // Only the helper's own call and the comment above it may remain.
  assert.ok(raw <= 2, `${raw} raw console.error calls remain in the PMS screen`)
  assert.ok((PERF.match(/logFail\(/g) ?? []).length >= 25,
    'most error paths still log raw')
})
