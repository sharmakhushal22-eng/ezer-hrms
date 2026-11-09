// 223 — one person, one row. A file naming somebody twice is refused whole.
//
// FOUND BY UPLOADING ONE, during an end-to-end check of the HR bulk upload as
// SRS9047 (Kiran Reddy, HR Head).
//
// checkUpload judged every row on its own, and the commit RPC did the same:
// both compared each row against the rating the database holds NOW, and that
// value does not move during validation. So two rows for one employee were
// each judged against the original number and both passed. The apply loop
// then called pms_finalise once per row in file order and the LAST row
// silently decided the rating.
//
//   row 7    SRS9088  4   matches the current 4 — "No change", no reason owed
//   row 180  SRS9088  1   "panel moderated"
//
// MEASURED IN THE BROWSER: the preview rendered row 7 as `No change` and
// enabled "Commit upload (2 rows)". The person would have ended two bands
// down, authorised by a screen that said nothing had changed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { checkUpload, ERROR_TEXT, type Known, type UploadRow } from '../upload.ts'

const read = (p: string) => readFileSync(p, 'utf8')

/** Everybody known, everybody on 4, scale 1..5 — so nothing but the rule
 *  under test can make a row fail. */
const KNOWN: Known = {
  lookup: (emp) => emp.toUpperCase().startsWith('SRS')
    ? { computed: 4, eligible: true, readOnly: false } : null,
  scale: [1, 2, 3, 4, 5],
  improvementMandatoryAtOrBelow: null,
}

const row = (o: Partial<UploadRow>): UploadRow =>
  ({ employee_code: 'SRS9088', period_code: 'Q2-FY202627', final_rating: 4, ...o })

// ── the engine ───────────────────────────────────────────────────────────

test('the same person twice is refused, and both rows are named', () => {
  const p = checkUpload([
    row({ final_rating: 4 }),
    row({ final_rating: 1, override_reason: 'panel moderated' }),
  ], KNOWN)
  assert.equal(p.canCommit, false, 'the exact file that would have silently dropped two bands')
  assert.equal(p.errorCount, 2, 'only one row of the pair was flagged')
  // EVERY row of the set, not just the later one. Flagging only the second
  // teaches the reader the first is the good one — the assumption this error
  // exists to refuse.
  for (const r of p.rows) assert.ok(r.errors.includes('ERROR_DUPLICATE'))
})

test('a clean file of distinct people still commits', () => {
  const p = checkUpload([
    row({ employee_code: 'SRS9001' }),
    row({ employee_code: 'SRS9002' }),
    row({ employee_code: 'SRS9003' }),
  ], KNOWN)
  assert.deepEqual(p.rows.flatMap(r => r.errors), [])
  assert.equal(p.canCommit, true)
})

test('duplicate detection normalises the way the lookup does', () => {
  // The employee lookup is case- and whitespace-insensitive on both sides —
  // live, "srs9088" resolved to the same person as "SRS9088". If this check
  // were stricter than the lookup, the two rows would resolve to one record
  // and still both apply, which is the whole bug.
  const p = checkUpload([
    row({ employee_code: '  srs9088 ' }),
    row({ employee_code: 'SRS9088', final_rating: 1, override_reason: 'moderated' }),
  ], KNOWN)
  assert.equal(p.canCommit, false, 'case or padding let a duplicate through')
  assert.equal(p.errorCount, 2)
})

test('the same code in a DIFFERENT period is not a duplicate', () => {
  // The key is the pair. One person can legitimately appear once per period
  // in a legacy-migration file.
  const p = checkUpload([
    row({ period_code: 'Q1-FY202627' }),
    row({ period_code: 'Q2-FY202627' }),
  ], KNOWN)
  assert.deepEqual(p.rows.flatMap(r => r.errors), [])
})

test('rows missing a code are not all branded duplicates of each other', () => {
  // They are already ERROR_NOT_FOUND. Grouping them under one empty key would
  // add a second, wrong complaint to every one of them and bury the real one.
  const p = checkUpload([
    row({ employee_code: '' }),
    row({ employee_code: '   ' }),
  ], KNOWN)
  for (const r of p.rows) {
    assert.ok(r.errors.includes('ERROR_NOT_FOUND'))
    assert.ok(!r.errors.includes('ERROR_DUPLICATE'),
      'a blank code was reported as a duplicate of another blank code')
  }
})

test('three rows for one person flag all three', () => {
  const p = checkUpload([row({}), row({}), row({})], KNOWN)
  assert.equal(p.errorCount, 3)
})

test('the sentence says what to do, not just what is wrong', () => {
  const t = ERROR_TEXT.ERROR_DUPLICATE
  assert.match(t, /more than once/)
  assert.match(t, /Keep one row/, 'the reader is not told the fix')
  // And it says WHY it will not choose for them.
  assert.match(t, /cannot be guessed/)
})

// ── the SQL half ─────────────────────────────────────────────────────────

const DIR = 'supabase/migrations'
const M223 = read(`${DIR}/223_pms_upload_refuses_duplicate_rows.sql`)
const M192 = read(`${DIR}/192_pms_rating_upload_commit.sql`)
const M224 = read(`${DIR}/224_pms_upload_duplicate_message_agrees.sql`)

function fnOf(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(i >= 0, `${name} not found`)
  return sql.slice(i, sql.indexOf('END $$;', i) + 'END $$;'.length)
}
const codeOnly = (sql: string) =>
  sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

test('the refusal agrees with the number of codes it names', () => {
  // 223 HARDCODED THE PLURAL: `v_dups || ' appear more than once '`. With one
  // duplicated code — the ordinary case, a single row pasted twice — that
  // read "SRS9030 appear more than once".
  //
  // Nothing caught it. The repo test and both verify checks matched on
  // "more than once" and never looked at the verb, so all three passed while
  // quoting the broken sentence back. 224 makes it agree.
  //
  // This matters because the sentence is the entire explanation an HR
  // administrator gets for why a calibration file was rejected.
  const fn = codeOnly(fnOf(M224, 'pms_commit_rating_upload'))
  const msg = fn.slice(fn.indexOf('IF v_dups IS NOT NULL THEN'), fn.indexOf('FOR r IN'))
  assert.match(msg, /CASE WHEN v_ndups = 1 THEN ' appears' ELSE ' appear' END/,
    'the verb is fixed rather than chosen by the count')
  assert.ok(!/\|\| ' appear more than once '/.test(msg),
    'the hardcoded plural is still there')
  // And the count it branches on is actually computed.
  assert.match(fn, /INTO v_dups, v_ndups/, 'v_ndups is branched on but never set')
})

test('224 is the newest definition of the commit function', () => {
  // The last CREATE OR REPLACE wins at apply time, so a later migration
  // restating 192's body would drop this check without a word.
  const latest = readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => read(`${DIR}/${f}`).includes('CREATE OR REPLACE FUNCTION pms_commit_rating_upload('))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop()
  assert.equal(latest, '224_pms_upload_duplicate_message_agrees.sql')
})

test('the database refuses the duplicate too, before it validates anything', () => {
  // ENGINE COMPUTES, SQL DECIDES. The browser check is what tells the admin;
  // this is what makes it true for anything that reaches the function by
  // another route.
  const fn = codeOnly(fnOf(M223, 'pms_commit_rating_upload'))
  assert.match(fn, /HAVING count\(\*\) > 1/)
  assert.match(fn, /appear more than once/)
  // AND IT ACTS ON WHAT IT COMPUTED. Asserting the query alone let a mutation
  // through that computed v_dups and then ignored it — `IF false THEN` kept
  // every string this test was looking for. The guard has to read the
  // variable and return.
  const guard = fn.slice(fn.indexOf('INTO v_dups'), fn.indexOf('FOR r IN'))
  assert.match(guard, /IF v_dups IS NOT NULL THEN/,
    'the duplicate list is computed and then not acted on')
  assert.match(guard, /RETURN jsonb_build_object\('ok', false/,
    'a duplicate file is not refused')
  assert.match(guard, /'applied', 0/, 'the refusal does not say nothing was applied')
  // Before the per-row loop: the complaint is about the file, and reporting
  // it row by row would say the same thing once per duplicate.
  assert.ok(fn.indexOf('HAVING count(*) > 1')
          < fn.indexOf('FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP'),
    'the duplicate check runs after the validation loop has already started')
  // And it normalises the way the employee lookup does, or the two disagree.
  assert.match(fn, /upper\(btrim\(COALESCE\(e\.value->>'employee_code', ''\)\)\)/)
})

test('224 reproduces 223 exactly, apart from the message', () => {
  const strip = (t: string) => t.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--')).map(l => l.trim())
  const old = strip(fnOf(M223, 'pms_commit_rating_upload'))
  const now = strip(fnOf(M224, 'pms_commit_rating_upload'))
  const removed = old.filter(l => !now.includes(l))
  const added = now.filter(l => !old.includes(l))
  // Only the message construction and the count that feeds it.
  assert.ok(removed.every(l => /appear more than once|string_agg|INTO v_dups|meant cannot be guessed|in this file/.test(l)),
    '224 changed something other than the message:\n  ' + removed.join('\n  '))
  assert.ok(added.length <= 8,
    `224 added ${added.length} lines, more than the message needs:\n  ` + added.join('\n  '))
})

test('223 reproduces 192 exactly, apart from the duplicate check', () => {
  // 221 restated a deployed function from memory and silently dropped the
  // UPDATE that advances the workflow; what was left looked complete. So this
  // is diffed, not read.
  const strip = (t: string) => t.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--')).map(l => l.trim())
  const old = strip(fnOf(M192, 'pms_commit_rating_upload'))
  const now = strip(fnOf(M223, 'pms_commit_rating_upload'))
  const removed = old.filter(l => !now.includes(l))
  assert.deepEqual(removed, [],
    '223 DROPPED these lines from the deployed function:\n  ' + removed.join('\n  '))
  const added = now.filter(l => !old.includes(l))
  assert.ok(added.length <= 16,
    `223 added ${added.length} lines, more than the check needs:\n  ` + added.join('\n  '))
})

test('the two-pass apply the whole feature rests on is intact', () => {
  // Validate every row, THEN apply every row — so a bad row anywhere means
  // nothing is written. Asserted directly as well as by the diff above,
  // because it is the guarantee the admin is shown on screen.
  const fn = codeOnly(fnOf(M224, 'pms_commit_rating_upload'))
  const loops = [...fn.matchAll(/FOR r IN SELECT \* FROM jsonb_array_elements\(p_rows\) LOOP/g)]
  assert.equal(loops.length, 2, 'the validate pass and the apply pass are not both there')
  assert.match(fn, /IF v_errors > 0 THEN/)
  assert.match(fn, /rows failed validation, so /)
  assert.match(fn, /SELECT pms_finalise\(v_emp, p_period_id, p_actor_id, p_actor_role, v_up, v_reason\)/)
  assert.match(fn, /UPDATE pms_rating_upload_log SET committed = true WHERE batch_id = v_batch/)
})
