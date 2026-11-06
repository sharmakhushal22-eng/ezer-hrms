// Changing a locked weightage reopens the KRA set.
//
// THE DECISION. Open since the start of this work and settled now: a senior
// may change a weightage after the lock, and doing so sends the set back for
// re-agreement — DRAFT, both acknowledgements cleared, the employee asked
// again. The two rejected readings were "locked means locked, send it back
// instead" and "a senior edits freely and the lock stays"; the second was
// rejected for the reason the lock exists at all, which is that a number
// somebody agreed to must not move without them being asked.
//
// WHY THE SQL IS WHAT IS TESTED HERE. The engine's weightageEdit() only
// predicts, so a screen can warn before the click. 206 is what actually
// happens, and it cannot be bypassed by a client — so most of this file
// reads the migration and checks the rule is really in it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { weightageEdit } from '../kra.ts'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/206_pms_weightage_edit_reopens_the_one_to_one.sql'),
  'utf8')
/** The migration with its explanation removed. Four times in this work a
 *  comment has tripped the test enforcing the rule it describes. */
const CODE = SQL.replace(/^\s*--.*$/gm, ' ')

// ── the engine's prediction ──────────────────────────────────────────────

test('an unlocked weightage is an ordinary edit', () => {
  assert.deepEqual(weightageEdit({ status: 'DRAFT' }), { kind: 'FREE' })
  assert.deepEqual(weightageEdit({ status: 'PENDING_RM_APPROVAL' }), { kind: 'FREE' })
})

test('a locked one warns that it reopens the set', () => {
  const e = weightageEdit({ status: 'LOCKED' })
  assert.equal(e.kind, 'REOPENS')
  // The warning has to name the consequences, or it is a shrug with an OK
  // button: the set goes back, and the signatures go with it.
  assert.match(e.because!, /back to the employee/i)
  assert.match(e.because!, /acknowledgement/i)
})

test('a settled rating refuses, and says to go to HR', () => {
  for (const g of [{ status: 'LOCKED', finalRating: 4 },
                   { status: 'LOCKED', workflowStatus: 'FINALISED' },
                   { status: 'LOCKED', workflowStatus: 'PUBLISHED' },
                   { status: 'LOCKED', workflowStatus: 'ACKNOWLEDGED' }]) {
    const e = weightageEdit(g)
    assert.equal(e.kind, 'REFUSED', JSON.stringify(g))
    assert.match(e.because!, /HR/)
  }
})

test('settled beats locked, whichever way round they are read', () => {
  // A finalised set is still LOCKED, so the order of the two checks decides
  // the answer. Refusal has to win.
  assert.equal(weightageEdit({ status: 'LOCKED', finalRating: 2 }).kind, 'REFUSED')
  assert.equal(weightageEdit({ status: 'DRAFT', finalRating: 2 }).kind, 'REFUSED')
})

test('a rating of zero is still a rating', () => {
  // `finalRating && …` would read 0 as "not rated" and allow the edit on a
  // settled record. Scales start at 1 today, but a policy may not.
  assert.equal(weightageEdit({ status: 'LOCKED', finalRating: 0 }).kind, 'REFUSED')
})

// ── 206 itself ───────────────────────────────────────────────────────────

test('the trigger fires only on a weightage that actually moved', () => {
  // A re-lock, a title edit, or the same number written again must not
  // reopen anything — pms_lock_kras itself updates these rows.
  assert.match(CODE, /IF OLD\.status <> 'LOCKED' OR NEW\.weightage IS NOT DISTINCT FROM OLD\.weightage THEN\s*\n\s*RETURN NEW;/,
    'the trigger reopens on edits that did not change the weightage')
})

test('IS DISTINCT FROM, not <>', () => {
  // `NEW.weightage <> OLD.weightage` is NULL when either side is NULL, so a
  // weightage set from or to NULL would slip through silently.
  assert.ok(!/NEW\.weightage <> OLD\.weightage/.test(CODE),
    'a null weightage would compare as unknown and skip the rule')
})

test('it refuses once the rating is settled', () => {
  assert.match(CODE, /v_final IS NOT NULL/,
    'a finalised rating can still have its weightage moved')
  assert.match(CODE, /v_status IN \('FINALISED', 'PUBLISHED', 'ACKNOWLEDGED'\)/,
    'a published result can still have its weightage moved')
  assert.match(CODE, /RAISE EXCEPTION '%', v_why/,
    'the refusal is not raised, or the format is not a literal')
})

test('the whole set reopens, not just the edited row', () => {
  // Weightages must total the policy's figure, so one reopened row inside a
  // locked set is a state the validator will not accept.
  assert.match(CODE, /UPDATE pms_employee_goals[\s\S]{0,400}?id <> NEW\.id[\s\S]{0,80}?status = 'LOCKED'/,
    'the siblings are left locked')
})

test('both acknowledgements are cleared', () => {
  // pms_lock_kras counts a KRA_SETTING row with BOTH acks, so clearing them
  // is precisely what forces the conversation to happen again.
  assert.match(CODE, /UPDATE pms_one_to_one[\s\S]{0,300}?employee_ack = false[\s\S]{0,120}?manager_ack\s*= false/,
    'the one-to-one acknowledgements survive a weightage change')
  assert.match(CODE, /discussion_type = 'KRA_SETTING'/,
    'it clears acknowledgements on discussions other than the KRA one')
})

test('the one-to-one row is kept, only its signatures go', () => {
  // The row is the record that the first conversation happened. Deleting it
  // would erase history to undo a signature.
  assert.ok(!/DELETE FROM pms_one_to_one/.test(CODE),
    'the one-to-one log is deleted rather than un-acknowledged')
})

test('the appraisal goes back to the employee', () => {
  assert.match(CODE, /workflow_status = 'KRA_DRAFT'/,
    'the set reopens but the workflow does not go back')
  assert.match(CODE, /chain_stage\s*= NULL/,
    'the chain still points at a rung although the set is unlocked')
})

test('the derived scores are cleared, because they are arithmetic on weightage', () => {
  // Leaving a stale weighted mean is worse than leaving none: it is a
  // specific wrong number that reads as current.
  for (const c of ['self_score', 'rm_l1_score', 'rm_l2_score', 'hod_score']) {
    assert.match(CODE, new RegExp(`${c}\\s*= NULL`),
      `${c} is left stale after the weightages it averaged have changed`)
  }
})

test('the ratings themselves are not deleted', () => {
  // pms_reviews is evidence of what each rater said, keyed per goal. A rater
  // returning after the re-lock overwrites their own row.
  assert.ok(!/DELETE FROM pms_reviews/.test(CODE),
    'somebody\'s written judgement is deleted because a weightage moved')
})

test('it cannot recurse', () => {
  // The AFTER trigger updates sibling rows, which fires the BEFORE trigger
  // on them. Their weightage has not changed, so it returns them untouched —
  // and the AFTER gate requires a changed weightage too.
  const after = CODE.slice(CODE.indexOf('pms_weightage_edit_reopens_set()'))
  assert.match(after, /IF NOT \(OLD\.status = 'LOCKED' AND NEW\.status = 'DRAFT'\s*\n\s*AND NEW\.weightage IS DISTINCT FROM OLD\.weightage\) THEN\s*\n\s*RETURN NULL;/,
    'the AFTER trigger does not gate on the weightage having changed')
})

test('it does not pretend to be a permission check', () => {
  // A row carries no actor, so SQL cannot tell an HOD's edit from an
  // employee's. If this ever starts naming roles, the split has been lost.
  assert.ok(!/RM_L2|HOD|rater_role|actor/.test(CODE),
    'the trigger reads as an authorisation check, which it cannot be')
})

test('both triggers are replaceable and both are dropped first', () => {
  assert.match(SQL, /DROP TRIGGER IF EXISTS trg_pms_weightage_edit_reopens ON/)
  assert.match(SQL, /DROP TRIGGER IF EXISTS trg_pms_weightage_edit_reopens_set ON/)
  assert.match(SQL, /CREATE OR REPLACE FUNCTION pms_weightage_edit_reopens\(\)/)
  assert.match(SQL, /CREATE OR REPLACE FUNCTION pms_weightage_edit_reopens_set\(\)/)
})

test('206 changes no data when it is applied', () => {
  const body = CODE
  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i]) {
    assert.ok(!forbidden.test(body), `206 matches ${forbidden}`)
  }
  // The UPDATEs it contains are all inside the trigger functions, never at
  // load time — so applying the migration touches nothing.
  const outside = body.split(/CREATE OR REPLACE FUNCTION/)[0]
  assert.ok(!/\bUPDATE\b/i.test(outside), '206 updates rows when applied')
})
