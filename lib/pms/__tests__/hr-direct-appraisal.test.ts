// The HR Head building an appraisal outside the chain.
//
// Requested: "HR head can give and set final rating of any employee even if
// he do not undergo the complete pms chain ... set any employee kras rate
// them and set the final rating and publish them. this is a special case
// feature."
//
// ── WHAT THIS FILE IS GUARDING ───────────────────────────────────────────
//
// A feature whose whole purpose is bypassing controls is the one place a
// test suite earns its keep. Three things must stay true:
//
// 1. It waives the final-review sign-off and NOTHING else. The KRA rules,
//    the rating scale and 211's settlement all still apply.
//
// 2. Never-started only, enforced in the database as well as the screen. A
//    rule that lives only in a component is a rule until somebody writes a
//    script.
//
// 3. The waiver is visible forever: a stamp, a named person and a reason.
//    An exception nobody can find afterwards is indistinguishable from a
//    control that was never there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canActDirect, whyNotDirect, neverStarted, checkDirect,
         suggestedFinal, directStamp, isDirect,
         MIN_DIRECT_REASON } from '../hrDirect.ts'
import type { Kra } from '../kra.ts'
import { publishFaults } from '../publishGate.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/212_pms_hr_direct_appraisal.sql')
const SQL207 = read('supabase/migrations/207_pms_publish_needs_the_manager_not_the_employee.sql')

const REASON = 'Joined on a transfer after the cycle opened; no chain was assigned.'

const kra = (seq: number, weightage: number): Kra => ({
  seq_no: seq, kra_title: `Objective ${seq}`, kpi_metric: 'Delivery',
  target_value: '100%', category: 'BUSINESS', weightage,
})
// Four KRAs at 25 each: the minimum count and the full weightage.
const KRAS = [kra(1, 25), kra(2, 25), kra(3, 25), kra(4, 25)]
const SCORES = { 1: 4, 2: 3, 3: 4, 4: 5 }

// ── who ──────────────────────────────────────────────────────────────────

test('only the HR Head may do this', () => {
  assert.equal(canActDirect('HR_HEAD'), true)
  for (const r of ['HR_MGR', 'HOD', 'RM_L1', 'RM_L2', 'EMPLOYEE', 'ADMIN'] as const) {
    assert.equal(canActDirect(r), false, `${r} can build an appraisal outside the chain`)
  }
})

// ── never-started only ───────────────────────────────────────────────────

test('an untouched appraisal is eligible', () => {
  assert.equal(whyNotDirect({ workflow_status: 'NOT_STARTED' }), null)
  assert.equal(neverStarted({ workflow_status: 'NOT_STARTED', kra_count: 0 }), true)
  // A row with nothing on it at all is the common case: 386 of the 395 in
  // the open period.
  assert.equal(neverStarted({}), true)
})

test('anything the chain has touched is refused, and says why', () => {
  // The SENTENCE matters as much as the refusal: a hidden row cannot answer
  // "why is Priya not in this list".
  const cases: [string, Record<string, unknown>][] = [
    ['already has a final rating', { final_rating: 3 }],
    ['has already started', { workflow_status: 'SELF_SUBMITTED' }],
    ['has already started', { workflow_status: 'RM_L2_DONE' }],
    ['already has KRAs', { workflow_status: 'NOT_STARTED', kra_count: 5 }],
    ['rated themselves', { workflow_status: 'NOT_STARTED', self_score: 4.2 }],
  ]
  for (const [expect, row] of cases) {
    const why = whyNotDirect(row)
    assert.ok(why, `${JSON.stringify(row)} was treated as never started`)
    assert.ok(why!.includes(expect), `wrong explanation for ${JSON.stringify(row)}: ${why}`)
    assert.equal(neverStarted(row), false)
  }
})

test('a missing row is refused rather than assumed empty', () => {
  assert.ok(whyNotDirect(null))
  assert.equal(neverStarted(undefined), false)
})

// ── the content rules are NOT waived ─────────────────────────────────────

test('a valid direct appraisal passes', () => {
  const c = checkDirect({ reason: REASON, kras: KRAS, scores: SCORES, finalRating: 4 })
  assert.deepEqual(c.faults, [])
  assert.equal(c.ok, true)
})

test('the KRA rules still apply, through the same checkKras', () => {
  // Skipping the chain is not a reason to accept a scorecard that would be
  // invalid from anybody else.
  const tooFew = checkDirect({ reason: REASON, kras: [kra(1, 100)],
    scores: { 1: 4 }, finalRating: 4 })
  assert.equal(tooFew.ok, false, 'one KRA was accepted as a scorecard')

  const wrongTotal = checkDirect({ reason: REASON,
    kras: [kra(1, 25), kra(2, 25), kra(3, 25), kra(4, 10)],
    scores: SCORES, finalRating: 4 })
  assert.equal(wrongTotal.ok, false, 'a weightage total of 85 was accepted')
})

test('every KRA has to be rated, on the scale', () => {
  const missing = checkDirect({ reason: REASON, kras: KRAS,
    scores: { 1: 4, 2: 3, 3: 4 }, finalRating: 4 })
  assert.ok(missing.faults.some(f => /KRA 4 has no rating/.test(f)))

  const off = checkDirect({ reason: REASON, kras: KRAS,
    scores: { ...SCORES, 2: 9 }, finalRating: 4 })
  assert.ok(off.faults.some(f => /KRA 2 is rated 9/.test(f)))
})

test('the final rating has to be on the scale', () => {
  assert.ok(checkDirect({ reason: REASON, kras: KRAS, scores: SCORES,
    finalRating: 9 }).faults.some(f => /not on this policy/.test(f)))
  assert.ok(checkDirect({ reason: REASON, kras: KRAS, scores: SCORES,
    finalRating: null }).faults.some(f => /Choose the final rating/.test(f)))
  // A ten-point scale is respected rather than assumed away.
  assert.equal(checkDirect({ reason: REASON, kras: KRAS, scores: SCORES,
    finalRating: 9 }, [1,2,3,4,5,6,7,8,9,10]).ok, true)
})

test('a reason is required, and a real one', () => {
  const none = checkDirect({ kras: KRAS, scores: SCORES, finalRating: 4 })
  assert.ok(none.faults.some(f => /why this appraisal is being taken outside/.test(f)))

  const thin = checkDirect({ reason: 'transfer', kras: KRAS, scores: SCORES,
    finalRating: 4 })
  assert.ok(thin.faults.some(f => f.includes(`${MIN_DIRECT_REASON} characters`)))
})

test('every fault is reported at once', () => {
  const c = checkDirect({ kras: [], scores: {}, finalRating: null })
  assert.ok(c.faults.length >= 3,
    'somebody fixing one fault would meet the next on the following try')
})

// ── the suggestion ───────────────────────────────────────────────────────

test('the weighted average is offered, not imposed', () => {
  // 25*4 + 25*3 + 25*4 + 25*5 over 100 = 4.
  assert.equal(suggestedFinal({ kras: KRAS, scores: SCORES }), 4)
  // Weighting actually applies.
  assert.equal(suggestedFinal({ kras: [kra(1, 90), kra(2, 10)],
    scores: { 1: 5, 2: 1 } }), 4.6)
})

test('nothing rated suggests nothing, not zero', () => {
  // Zero is a rating; "nothing yet" is not.
  assert.equal(suggestedFinal({ kras: KRAS, scores: {} }), null)
  assert.equal(suggestedFinal({ kras: [], scores: {} }), null)
  assert.equal(suggestedFinal({ kras: [kra(1, 0)], scores: { 1: 4 } }), null,
    'a zero-weightage set divided by zero')
})

test('a partly rated set averages only what is rated', () => {
  assert.equal(suggestedFinal({ kras: KRAS, scores: { 1: 4, 2: 4 } }), 4)
})

// ── the stamp ────────────────────────────────────────────────────────────

test('the stamp records who and why, always', () => {
  const s = directStamp(REASON, 'hr-1', 'T')
  assert.equal(s.hr_direct, true)
  assert.equal(s.hr_direct_by, 'hr-1')
  assert.equal(s.hr_direct_at, 'T')
  assert.equal(s.hr_direct_reason, REASON)
})

test('isDirect is strict', () => {
  assert.equal(isDirect({ hr_direct: true }), true)
  assert.equal(isDirect({ hr_direct: false }), false)
  assert.equal(isDirect({}), false)
  assert.equal(isDirect(null), false)
})

// ── 212 ──────────────────────────────────────────────────────────────────

test('212 waives the sign-off rule and nothing else', () => {
  // THE DIFF IS THE ASSERTION. 207's function is reproduced verbatim with
  // ONE early return added; anything else moving means a second rule
  // changed under cover of this one.
  const fn = (s: string) => {
    const a = s.indexOf('CREATE OR REPLACE FUNCTION pms_block_unsigned_publish')
    const b = s.indexOf('END $$;', a)
    return s.slice(a, b).split('\n')
  }
  const before = fn(SQL207), after = fn(SQL)
  // CODE lines only. An earlier version matched the added lines against
  // /212|hr_direct/ and failed on its own continuation comments — which
  // tested the prose, not the rule. What matters is that exactly one
  // executable line appeared and none disappeared.
  const code = (ls: string[]) => ls.filter(l => l.trim() && !l.trim().startsWith('--'))
  const added = code(after).filter(l => !code(before).includes(l))
  assert.deepEqual(added,
    ['  IF COALESCE(NEW.hr_direct, false) THEN RETURN NEW; END IF;'],
    '212 changed executable lines beyond the waiver')
  const removed = code(before).filter(l => !code(after).includes(l))
  assert.deepEqual(removed, [], 'a line of the 207 rule was dropped')
  assert.ok(after.some(l => /IF COALESCE\(NEW\.hr_direct, false\) THEN RETURN NEW; END IF;/.test(l)),
    'the waiver is not there')
})

test('the waiver sits after the "not a publish" guard', () => {
  // Before it, every unrelated update to a stamped row would return early
  // from a trigger that had not yet decided whether it was a publish.
  const a = SQL.indexOf('OLD.workflow_status IN (\'PUBLISHED\',\'ACKNOWLEDGED\')')
  const b = SQL.indexOf('IF COALESCE(NEW.hr_direct, false) THEN RETURN NEW; END IF;')
  const c = SQL.indexOf('SELECT p.final_review_one_to_one INTO v_req')
  assert.ok(a > 0 && b > a && c > b, 'the waiver is in the wrong place')
})

test('the guard refuses a stamp on an appraisal the chain has touched', () => {
  const g = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_guard_hr_direct'),
                      SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_guard_hr_direct'))
  assert.match(g, /OLD\.final_rating IS NOT NULL/)
  assert.match(g, /COALESCE\(OLD\.workflow_status, 'NOT_STARTED'\) <> 'NOT_STARTED'/)
  assert.match(g, /FROM pms_reviews/, 'a submitted chain rating does not block the stamp')
  assert.match(g, /FROM pms_employee_goals/, 'an existing KRA set does not block the stamp')
})

test('the guard reads the OLD row, not the new one', () => {
  // The same statement that sets the stamp may be writing the HR Head's own
  // rating. Judging the new values would refuse the very thing this allows.
  const g = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_guard_hr_direct'),
                      SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_guard_hr_direct'))
  assert.ok(!/NEW\.final_rating IS NOT NULL/.test(g),
    'the guard judges the rating being written')
  assert.ok(!/NEW\.workflow_status\s*<>/.test(g))
})

test('the guard demands the name and the reason', () => {
  const g = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_guard_hr_direct'),
                      SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_guard_hr_direct'))
  assert.match(g, /NEW\.hr_direct_by IS NULL/)
  assert.match(g, /btrim\(NEW\.hr_direct_reason\), ''\) = ''/,
    'a reason of spaces would satisfy the requirement')
})

test('the guard only fires when the stamp is switched on', () => {
  const g = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_guard_hr_direct'),
                      SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_guard_hr_direct'))
  assert.match(g, /COALESCE\(OLD\.hr_direct, false\) = true/,
    'every later update to a direct appraisal would be re-judged')
})

test('212 is additive and rewrites nothing', () => {
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i,
                   /^\s*UPDATE\s+\w/mi, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!f.test(body), `212 matches ${f}`)
  }
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS hr_direct\s+boolean NOT NULL DEFAULT false/)
})

test('211’s settlement is not waived by 212', () => {
  // The HR Head is the one acting, so they settle it like any other. If 212
  // touched that trigger, a direct appraisal could publish with no
  // attestation at all.
  // THE FUNCTION **AND** THE TRIGGER. An earlier version named only the
  // function, so a mutation that dropped 211's trigger — disabling the
  // attestation gate entirely — passed this test untouched.
  const body = SQL.replace(/^\s*--.*$/gm, ' ')
  for (const name of ['pms_block_unconfirmed_publish',
                      'trg_pms_publish_needs_hr_final',
                      'hr_management_discussed',
                      'hr_final_confirmed_at']) {
    assert.ok(!body.includes(name), `212 touches ${name}, which is 211's gate`)
  }
  // And it must not drop the 207 trigger it reuses, either.
  assert.ok(!body.includes('DROP TRIGGER IF EXISTS trg_pms_publish_needs_signoff'),
    '212 drops the 207 trigger it depends on')
})

// ── the wiring ───────────────────────────────────────────────────────────

const TABS = read('components/pms/AdminTabs.tsx')
const PAGE = read('app/dashboard/pms/page.tsx')

test('the stamp is written BEFORE the KRAs', () => {
  // THE ORDER IS LOAD-BEARING. 212's guard refuses the stamp on a row that
  // already has KRAs, so writing the goals first would make the database
  // refuse the very appraisal this feature exists to create.
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.ok(fn.length > 400, 'saveDirect is gone')
  const stamp = fn.indexOf('directStamp(')
  const goals = fn.indexOf("from('pms_employee_goals')")
  const reviews = fn.indexOf("from('pms_reviews')")
  const settle = fn.indexOf('workflow_status: \'FINALISED\'')
  assert.ok(stamp > 0 && goals > stamp, 'the KRAs are written before the stamp')
  assert.ok(reviews > goals, 'the ratings are written before the KRAs they belong to')
  assert.ok(settle > reviews, 'the rating is settled before the KRAs are rated')
})

test('it stops at the first failure', () => {
  // A half-built appraisal looks finished on the publish queue, which is
  // worse than none at all.
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  for (const step of ['stamp.error', 'goals.error', 'reviews.error', 'fin.error']) {
    assert.ok(fn.includes(`if (${step})`), `${step} is not checked`)
  }
})

test('it does not publish — it joins the queue like everybody else', () => {
  // 211's attestation is MORE live for an appraisal nobody else saw. This
  // must leave the record FINALISED, not PUBLISHED.
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.ok(!fn.includes("'PUBLISHED'"), 'a direct appraisal publishes itself')
  assert.ok(!fn.includes('published_at'))
  assert.ok(!fn.includes('hr_final_confirmed_at'),
    'a direct appraisal settles its own 211 attestation')
  assert.match(fn, /workflow_status: 'FINALISED'/)
})

test('the write re-checks eligibility and the role', () => {
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.match(fn, /if \(!canActDirect\(myHrRole\)\)/, 'the write skips the role check')
  assert.match(fn, /const why = whyNotDirect\(/, 'the write skips the eligibility check')
  assert.match(fn, /if \(why\) return why/)
  assert.match(fn, /const check = checkDirect\(/, 'the write skips the content check')
})

test('the ratings are attributed to the HR Head, not to a manager', () => {
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.match(fn, /rater_role: 'HR_HEAD'/,
    'the HR Head\'s ratings are filed under somebody else\'s role')
  assert.match(fn, /finalised_by_role: 'HR_HEAD'/)
  assert.match(fn, /rating_source: 'HR_OVERRIDE'/,
    'a report cannot tell this from a rating the chain produced')
})

test('the form is offered only to an HR Head', () => {
  assert.match(PAGE, /canBuildDirect=\{canActDirect\(myHrRole\)\}/)
  const comp = TABS.slice(TABS.indexOf('function DirectAppraisal'),
                          TABS.indexOf('export function UploadTab'))
  assert.match(comp, /if \(!canAct\) return null/,
    'the form renders for anybody who can open the tab')
})

test('an ineligible person is shown with the reason, not hidden', () => {
  // A name missing from a list cannot explain itself.
  const comp = TABS.slice(TABS.indexOf('function DirectAppraisal'),
                          TABS.indexOf('export function UploadTab'))
  assert.match(comp, /const why = whyNotDirect\(/)
  assert.match(comp, /\{why \?\? 'Never started — can be built here'\}/,
    'the reason is not shown on the row')
  assert.match(comp, /disabled=\{!!why\}/,
    'an ineligible person can still be chosen')
})

test('the form says that saving does not publish', () => {
  const comp = TABS.slice(TABS.indexOf('function DirectAppraisal'),
                          TABS.indexOf('export function UploadTab'))
  assert.match(comp, /Saving does not publish/,
    'the form implies it releases the result')
  assert.match(comp, /Publish Results/)
})

// ── 213: the second rule a direct appraisal cannot satisfy ───────────────

const SQL213 = read('supabase/migrations/213_pms_direct_needs_no_self_rating.sql')
const SQL066 = read('supabase/migrations/066_pms_module.sql')

test('213 waives the self-rating-first rule, and nothing else', () => {
  // FOUND BY RUNNING IT, not by reading. The four-step write failed at step
  // 3 against the live database with "Self rating must be submitted before
  // manager rating" — after the stamp and the KRAs were already written.
  // An employee the chain never started has no self rating and never will.
  const fn = (s: string) => {
    const a = s.indexOf('CREATE OR REPLACE FUNCTION pms_check_self_first')
    return s.slice(a, s.indexOf('END $$;', a)).split('\n')
  }
  const before = fn(SQL066), after = fn(SQL213)
  const code = (ls: string[]) => ls.filter(l => l.trim() && !l.trim().startsWith('--'))
  const added = code(after).filter(l => !code(before).includes(l))
  // The declaration gains v_direct, plus the lookup and the early return.
  assert.equal(added.length, 4, `unexpected changes:\n${added.join('\n')}`)
  assert.ok(added.some(l => /IF COALESCE\(v_direct, false\) THEN RETURN NEW; END IF;/.test(l)))
  const removed = code(before).filter(l => !code(after).includes(l))
  assert.deepEqual(removed, ['DECLARE v_self int; v_req boolean;'],
    'a line of the 066 rule was dropped')
})

test('the waiver reads hr_direct from the appraisal, keyed on both columns', () => {
  // Keyed on period AND employee: pms_overall_rating is one row per person
  // per period, and keying on the employee alone would read another
  // period's stamp.
  assert.match(SQL213, /WHERE o\.period_id = NEW\.period_id AND o\.employee_id = NEW\.employee_id/)
})

test('213 does not write a self rating on the employee’s behalf', () => {
  // The alternative, and the worse one: it puts words in the employee's
  // mouth and leaves nobody able to tell which self ratings were real.
  const body = SQL213.replace(/^\s*--.*$/gm, ' ')
  for (const f of [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i]) {
    assert.ok(!f.test(body), `213 matches ${f}`)
  }
  assert.ok(!/rater_role\s*=\s*'SELF'\s*,/.test(body))
})

test('213 leaves the other gates alone', () => {
  const body = SQL213.replace(/^\s*--.*$/gm, ' ')
  for (const name of ['pms_block_unsigned_publish', 'pms_block_unconfirmed_publish',
                      'pms_guard_hr_direct', 'trg_pms_publish_needs_hr_final',
                      'trg_pms_guard_hr_direct']) {
    assert.ok(!body.includes(name), `213 touches ${name}`)
  }
})

// ── 214: the HR Head is a rater ──────────────────────────────────────────

const SQL214 = read('supabase/migrations/214_pms_hr_head_can_be_a_rater.sql')

test('214 widens rater_role without dropping anybody', () => {
  // Found the same way as 213 — by running the write, not by reading the
  // code. 066's list was complete until something outside the chain could
  // rate, which 212 introduced.
  const m = SQL214.match(/CHECK \(rater_role IN \(([^)]*)\)\)/)
  assert.ok(m, 'the widened constraint is gone')
  const allowed = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])
  for (const r of ['SELF', 'RM_L1', 'RM_L2', 'HOD', 'MD']) {
    assert.ok(allowed.includes(r), `${r} was dropped from rater_role`)
  }
  assert.ok(allowed.includes('HR_HEAD'), 'the HR Head still cannot be a rater')
})

test('214 drops the old constraint by its real name', () => {
  // The database told us the name in the error it raised, so there is no
  // guessing here — but it is dropped IF EXISTS, and the new one is named,
  // so a second run is a no-op rather than a duplicate.
  assert.match(SQL214, /DROP CONSTRAINT IF EXISTS pms_reviews_rater_role_check/)
  assert.match(SQL214, /DROP CONSTRAINT IF EXISTS pms_reviews_rater_role_allowed/)
  assert.match(SQL214, /ADD CONSTRAINT pms_reviews_rater_role_allowed/)
})

test('214 changes no data and no other table', () => {
  const body = SQL214.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/\bINSERT\b/i, /^\s*UPDATE\s+\w/mi, /\bDELETE\s+FROM\b/i,
                   /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!f.test(body), `214 matches ${f}`)
  }
  assert.ok(!/pms_overall_rating|pms_employee_goals/.test(body),
    '214 touches a table it has no business in')
})

test('the HR Head’s rating is not filed under a manager’s role', () => {
  // The whole reason 214 exists rather than reusing 'HOD'.
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.match(fn, /rater_role: 'HR_HEAD'/)
  for (const r of ["rater_role: 'HOD'", "rater_role: 'RM_L1'", "rater_role: 'SELF'"]) {
    assert.ok(!fn.includes(r), `the HR Head's rating is filed as ${r}`)
  }
})

test('the success message survives the reload that follows it', () => {
  // THE FORM CANNOT HOLD IT. load() flips `loading` and the whole tab block
  // sits behind `!loading`, so the form unmounts and any banner it set goes
  // with it. Observed in the browser: the appraisal saved correctly and the
  // screen said nothing — on the one action that creates a result out of
  // nothing, leaving no way to tell success from silent failure.
  //
  // UploadTab documents the same trap on its onCommitted prop.
  const fn = PAGE.slice(PAGE.indexOf('const saveDirect = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  const note = fn.indexOf('setCommitNote(')
  const reload = fn.indexOf('\n    load()')
  assert.ok(note > 0, 'nothing tells the HR Head the appraisal was saved')
  assert.ok(reload > note,
    'the message is set after the reload that destroys the component holding it')
})

// ── the screen must waive exactly what the database waives ──────────────

test('the sign-off fault is skipped for a direct appraisal', () => {
  // THE MIRROR OF THE USUAL BUG. Normally the danger is a screen that
  // allows what the trigger refuses; here the screen REFUSED what the
  // trigger allows, so the publish button stayed disabled forever and the
  // whole feature was unusable through the UI while working perfectly
  // underneath it. Found by building a direct appraisal and reading the
  // card, not by reading the code.
  // ASSERTED BEHAVIOURALLY NOW. Bulk publishing turned this rule into a
  // shared function, so pinning it to lines inside the component stopped
  // describing where it lives — and a source slice whose anchor has
  // vanished passes a negative assertion for free.
  const ok = { finalRating: 4, appreciation: 'ok',
               hrFinal: { hr_final_confirmed_at: 'T', hr_management_discussed: true } }
  assert.deepEqual(publishFaults({ ...ok, signedOff: false, hrDirect: true }), [],
    'a direct appraisal is blocked on the sign-off that 212 waives')
  assert.equal(publishFaults({ ...ok, signedOff: false, hrDirect: false }).length, 1,
    'the sign-off rule stopped applying to everybody else')
  // The OTHER gates must still apply to a direct appraisal.
  assert.equal(publishFaults({ ...ok, hrFinal: null, signedOff: false, hrDirect: true }).length,
    1, '211 was waived for direct appraisals too')
  assert.equal(publishFaults({ ...ok, appreciation: '', signedOff: false, hrDirect: true }).length,
    1, 'the appreciation requirement was waived for direct appraisals')
})

test('the row and the card say it was built outside the chain', () => {
  // A waived rule that looks like an unmet one invites somebody to go
  // chasing a manager who does not exist.
  assert.match(TABS, /<Pill tone="grey">waived · direct<\/Pill>/,
    'a direct row still reads as "not signed"')
  assert.match(TABS, /<b>Built outside the chain\.<\/b>/)
  assert.match(TABS, /\{member\.hrDirectReason &&/,
    'the reason for the exception is not shown where the decision is made')
})

test('the flag reaches the screen from the row', () => {
  assert.match(PAGE, /hr_direct, hr_direct_reason/,
    'hr_direct is not selected, so it is inert')
  assert.match(PAGE, /hrDirect: \(r as \{ hr_direct\?: boolean \}\)\.hr_direct === true/)
})
