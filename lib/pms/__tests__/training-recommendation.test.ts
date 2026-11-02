// Training a rater suggests while rating somebody.
//
// Requested: "training recommendation block should be shown to r1, r2, hod
// during giving rating in pms (optional) where they can suggest training to
// the employee they are giving rating to — like python training / excel /
// other trainings — and can explain it in details", reaching the HR Head at
// the end.
//
// ── WHY ITS OWN TABLE, AND NOT THE TWO THAT NEARLY FIT ───────────────────
//
// pms_additional_benefits already has a TRAINING_NOMINATION type, a note and
// an attachment — reusing it would have been one line. But it records
// awarded_by: it is the list of things GIVEN. A suggestion HR has not agreed
// to is not an award, filing it as one makes the recognition list wrong, and
// there is nowhere for HR to decline it.
//
// pms_feedback.development_plan exists and is unused — but pms_feedback is
// UNIQUE (period_id, employee_id), so three raters would overwrite each
// other and HR could not accept one suggestion and decline another.
//
// ── THE RULE THAT IS EASY TO GET BACKWARDS ───────────────────────────────
//
// THE BLOCK IS OPTIONAL. An untouched one must save nothing and must never
// stop somebody approving. A HALF-FILLED one is a different thing: details
// typed against no training reach HR as a row they cannot act on, so that
// is a fault. Most of this file is that distinction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkTraining, checkTrainingBlock, filled, trainingSummary,
         TRAINING_CATEGORIES, TRAINING_CATEGORY_LABEL, TRAINING_EXAMPLE,
         MIN_TRAINING_NAME, HR_STATUSES, kindOf,
         type TrainingRecommendation } from '../training.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/208_pms_training_recommendation.sql')
const SQL210 = read('supabase/migrations/210_pms_recognition_is_not_training.sql')
const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')

// ── optional means optional ──────────────────────────────────────────────

test('an untouched block is fine', () => {
  assert.deepEqual(checkTrainingBlock([]), [])
  assert.deepEqual(checkTrainingBlock([{ trainingName: '', details: '' }]), [])
  assert.deepEqual(checkTrainingBlock([{}]), [])
})

test('an untouched block saves nothing', () => {
  // The difference between "no suggestion" and "an empty suggestion" is a
  // row in HR's queue that nobody meant to create.
  assert.deepEqual(filled([{ trainingName: '', details: '' }]), [])
  assert.deepEqual(filled([{ trainingName: '   ', details: '  \n ' }]), [])
  assert.equal(filled([{ trainingName: 'Advanced Excel', details: '' }]).length, 1)
  assert.equal(filled([{ trainingName: '', details: 'needs help with pivots' }]).length, 1)
})

test('whitespace is not a suggestion', () => {
  assert.deepEqual(checkTrainingBlock([{ trainingName: '  ', details: '\t\n' }]), [])
})

// ── half-filled is not ───────────────────────────────────────────────────

test('details with no training named is a fault', () => {
  const c = checkTraining({ trainingName: '', details: 'struggles with pivot tables' })
  assert.equal(c.ok, false)
  assert.match(c.fault!, /Name the training/)
})

test('a two-character name is a fault', () => {
  const c = checkTraining({ trainingName: 'ab' })
  assert.equal(c.ok, false)
  assert.match(c.fault!, new RegExp(`${MIN_TRAINING_NAME} characters`))
})

test('a real suggestion passes, with or without the detail', () => {
  assert.equal(checkTraining({ trainingName: 'Advanced Excel' }).ok, true)
  assert.equal(checkTraining({ trainingName: 'Python for analysts',
                               details: 'the reporting work is moving to pandas' }).ok, true)
})

test('the block reports every fault, not just the first', () => {
  const faults = checkTrainingBlock([
    { trainingName: 'Advanced Excel' },            // fine
    { trainingName: '', details: 'needs this' },   // no name
    { trainingName: 'x' },                         // too short
  ])
  assert.equal(faults.length, 2, 'a rater fixing one fault would find the next on the next try')
})

// ── the categories ───────────────────────────────────────────────────────

test('every category has a label and an example', () => {
  // A free-text field with no examples fills up with "training needed".
  for (const c of TRAINING_CATEGORIES) {
    assert.ok(TRAINING_CATEGORY_LABEL[c], `${c} has no label`)
    assert.ok(TRAINING_EXAMPLE[c], `${c} has no example`)
  }
})

test('the examples are concrete, not restatements of the bucket', () => {
  // "Technical: technical training" helps nobody.
  for (const c of TRAINING_CATEGORIES) {
    assert.ok(TRAINING_EXAMPLE[c].toLowerCase() !== TRAINING_CATEGORY_LABEL[c].toLowerCase(),
      `${c}'s example just repeats its label`)
  }
  assert.match(TRAINING_EXAMPLE.TECHNICAL, /Excel|Python/,
    'the two examples the request actually named are gone')
})

// ── HR's side ────────────────────────────────────────────────────────────

test('a row with no status counts as pending', () => {
  // The column defaults to PENDING, but a row read before HR touches it may
  // arrive with the field absent — and silently dropping it from the count
  // would hide work from HR.
  const rows = [{ trainingName: 'A', category: 'TECHNICAL' }] as TrainingRecommendation[]
  assert.equal(trainingSummary(rows).pending, 1)
  assert.equal(trainingSummary(rows).total, 1)
})

test('the summary adds up', () => {
  const rows = [
    { trainingName: 'A', category: 'TECHNICAL', hrStatus: 'PENDING' },
    { trainingName: 'B', category: 'OTHER', hrStatus: 'ACCEPTED' },
    { trainingName: 'C', category: 'OTHER', hrStatus: 'DECLINED' },
    { trainingName: 'D', category: 'OTHER' },
  ] as TrainingRecommendation[]
  const s = trainingSummary(rows)
  assert.equal(s.total, 4)
  assert.equal(s.pending + s.accepted + s.declined, s.total)
  assert.equal(s.pending, 2)
})

// ── 208 ──────────────────────────────────────────────────────────────────

test('208 creates the table with its own lifecycle', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS pms_training_recommendation/)
  assert.match(SQL, /hr_status\s+text NOT NULL DEFAULT 'PENDING'/,
    'a recommendation does not start as undecided')
  for (const s of HR_STATUSES) {
    assert.ok(SQL.includes(`'${s}'`), `${s} is not a legal hr_status in the table`)
  }
})

test('it records who suggested it, and in which role', () => {
  // The role is stored beside the id for the reason pms_reviews stores
  // rater_role: the chain is frozen per period, and a reorg must not
  // relabel last quarter's recommendation.
  assert.match(SQL, /recommended_by\s+uuid NOT NULL REFERENCES employees\(id\)/)
  assert.match(SQL, /recommended_by_role text NOT NULL\s*\n\s*CHECK \(recommended_by_role IN \('RM_L1','RM_L2','HOD'\)\)/)
})

test('many per person, from many raters — only exact duplicates are blocked', () => {
  // An RM L1 may suggest two courses and the HOD a third. The only thing
  // that is not a second opinion is the same rater naming the same training
  // twice, which is a double-submit.
  //
  // 208 wrote it over four columns; 210 widened it with kind, because one
  // table now holds both kinds and the NAMES collide across them. Asserted
  // against the migration in force, not only the one that introduced it.
  assert.match(SQL, /UNIQUE \(period_id, employee_id, recommended_by, training_name\)/,
    'the uniqueness is wrong, and either blocks a second opinion or allows a double-submit')
  assert.match(SQL210, /UNIQUE \(period_id, employee_id, recommended_by, kind, training_name\)/,
    'the widened key is wrong, so a recognition named after a training overwrites it')
})

// ── 210: the kind is a column, not a prefix ─────────────────────────

test('210 adds the kind, and defaults it to the safe one', () => {
  assert.match(SQL210, /ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'TRAINING'/,
    'an older row would default to RECOGNITION, inventing a bonus nobody proposed')
  assert.match(SQL210, /CHECK \(kind IN \('TRAINING','RECOGNITION'\)\)/)
})

test('kindOf defaults an unmarked row to training', () => {
  assert.equal(kindOf({}), 'TRAINING')
  assert.equal(kindOf({ kind: null }), 'TRAINING')
  assert.equal(kindOf({ kind: 'RECOGNITION' }), 'RECOGNITION')
  // Not a loose truthiness check: an unexpected value is not a bonus.
  assert.equal(kindOf({ kind: 'recognition' }), 'TRAINING')
  assert.equal(kindOf({ kind: 'SOMETHING_ELSE' }), 'TRAINING')
})

test('210 reads the old constraint name instead of guessing it', () => {
  // 208 wrote the unique inline, so Postgres named it — and the name built
  // from four column names is past the 63-byte identifier limit, so what is
  // in the database is a truncation. A wrong guess would leave the narrow
  // constraint in force BESIDE the new one, which is the failure that looks
  // like the migration worked.
  assert.match(SQL210, /FROM pg_constraint/,
    'the old constraint is dropped by a guessed name')
  assert.match(SQL210, /ARRAY\['employee_id','period_id','recommended_by','training_name'\]/,
    'the match is not on the exact 208 column set, so it could drop the wrong unique')
  assert.match(SQL210, /contype = 'u'/)
})

test('210 does not reinterpret anybody\'s words', () => {
  // The prefix could only be translated into a kind by guessing which of
  // somebody's sentences meant what. It is safe here because both tables
  // were empty when it ran — which is a fact about WHEN, so it is recorded
  // in the migration rather than left to memory.
  // Comments AND string literals stripped: the prose in a COMMENT ON
  // legitimately spells out both kinds and names the details column, and a
  // non-greedy match to the next ";" stops inside it — the literal itself
  // contains one. Quoted text is documentation; this test is about code.
  const body = SQL210.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  assert.ok(!/\bUPDATE\b/i.test(body), '210 rewrites existing rows')
  // The only honest test of "it does not reinterpret the prose": it never
  // reads the prose. No WHERE, no split, no LIKE on details.
  assert.ok(!/\bdetails\b/.test(body),
    '210 touches the details column, so it is parsing free text after all')
  assert.match(SQL210, /0 rows/, 'the measurement that made this safe is not recorded')
})

test('nothing reads the prefix any more', () => {
  // The writer stopped emitting it; a reader still looking for it would be
  // silently classifying everything as training.
  for (const [name, src] of [['Performance.tsx', PERF], ['ManagerTabs.tsx', MGR]] as const) {
    assert.ok(!/RECOGNITION — \$\{|startsWith\('RECOGNITION/.test(src),
      `${name} still uses the details prefix as a discriminator`)
  }
  assert.match(PERF, /kind: 'RECOGNITION'/, 'the recognition writer does not set the kind')
  assert.match(PERF, /kind: 'TRAINING' as const/,
    'the training writer leans on the column default rather than naming it')
})

test('208 is additive and re-runnable', () => {
  const body = SQL.replace(/^\s*--.*$/gm, ' ')
  for (const f of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /^\s*UPDATE\s+\w/mi]) {
    assert.ok(!f.test(body), `208 matches ${f}`)
  }
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS/)
  assert.match(SQL, /ENABLE ROW LEVEL SECURITY/, 'the table has no RLS')
  assert.match(SQL, /CREATE POLICY "allow_all_pms_training_recommendation"/)
})

// ── wiring ───────────────────────────────────────────────────────────────

test('the block is offered whatever the score', () => {
  // Unlike the PIP prompt. A form that only offers training to people rated
  // badly turns a development conversation into a punishment.
  const panel = MGR.slice(MGR.indexOf('export function KraDetail'),
                          MGR.indexOf('// ── §4.3'))
  assert.match(panel, /\{onTraining && \(/,
    'the training block is gated on something')
  const gate = panel.slice(panel.indexOf('{onTraining && ('), panel.indexOf('{onTraining && (') + 200)
  assert.ok(!/myScore|band|allows_pip|rating/i.test(gate),
    'the training block is gated by the rating, which it must not be')
})

test('a half-filled row blocks approval, an empty one does not', () => {
  // Sliced to the next statement, not matched with a lazy window: the
  // expression spans two lines and a non-greedy match stops at the first.
  const i = MGR.indexOf('const ready = ')
  assert.ok(i > 0, 'the gate moved')
  const expr = MGR.slice(i, MGR.indexOf('return (', i))
  assert.match(expr, /trainingFaults\.length === 0/,
    'a half-filled training row can still be sent on')
  // And the empty case must NOT block: checkTrainingBlock returns [] for an
  // untouched block, which is what makes `=== 0` the right test.
  assert.deepEqual(checkTrainingBlock([{ trainingName: '', details: '' }]), [])
})

test('it is saved with the same act as the rating, before the chain moves', () => {
  const ra = PERF.slice(PERF.indexOf('const rateAndApprove'),
                        PERF.indexOf('const approveInChain'))
  assert.match(ra, /await saveTraining\(id, myRung\)/,
    'approving does not save the training suggestions')
  assert.ok(ra.indexOf('saveTraining') < ra.indexOf('approveInChain('),
    'the suggestions are saved after the set has already gone up')
})

test('only filled rows are written', () => {
  const fn = PERF.slice(PERF.indexOf('const saveTraining'),
                        PERF.indexOf('const saveOverall'))
  assert.match(fn, /const rows = filled\(training\)/,
    'an untouched block would write empty rows')
  assert.match(fn, /if \(!rows\.length \|\| !companyId\) return true/,
    'an untouched block is treated as a failure rather than as nothing to do')
})

test('re-approving does not duplicate a suggestion', () => {
  // A rater sent back and approving again must not leave two copies.
  const fn = PERF.slice(PERF.indexOf('const saveTraining'),
                        PERF.indexOf('const saveOverall'))
  assert.match(fn, /onConflict: 'period_id,employee_id,recommended_by,kind,training_name'/,
    'the upsert key does not match the table\'s unique constraint')
})
