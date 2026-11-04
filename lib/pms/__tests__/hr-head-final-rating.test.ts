// The HR Head settling the final rating, and the publication it gates.
//
// Requested: "HR head should have a checkbox before giving final rating ...
// 'do you discussed with your management of company regarding final rating'.
// final rating by hr head will over write the all the ratings of peoples
// behind in chain ... also hr head can continue with ratings that is given
// through out the chain. and only after the final rating is given to a
// employee, there result can be published."
//
// ── THE THREE THINGS THAT MUST NOT SLIP ──────────────────────────────────
//
// 1. Nothing publishes before the HR Head settles it. Both halves: the
//    confirmation AND the attestation. A row with a timestamp and the
//    checkbox false must not count as settled, in the engine or in SQL.
//
// 2. Overriding supersedes the chain without erasing it. rm_l1_score,
//    rm_l2_score and hod_score are untouched, and the band the chain settled
//    is captured before final_rating is written over — the only moment that
//    number still exists.
//
// 3. Only the HR_HEAD role. The owner chose that over "any HR-level user",
//    which would have let an HR Manager override the HOD.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canSettleFinal, checkFinal, hrFinalState, publishFault, finalPatch,
         HR_FINAL_PROMPT, MIN_FINAL_REASON } from '../hrFinal.ts'
import { publishFaults } from '../publishGate.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/211_pms_hr_head_final_rating.sql')

const REASON = 'Moderated down at the November calibration committee.'

// ── who ──────────────────────────────────────────────────────────────────

test('only the HR Head may settle it', () => {
  assert.equal(canSettleFinal('HR_HEAD'), true)
  for (const r of ['HR_MGR', 'HOD', 'RM_L1', 'RM_L2', 'EMPLOYEE'] as const) {
    assert.equal(canSettleFinal(r), false, `${r} can settle the final rating`)
  }
  // ADMIN is deliberately excluded: it is the escalation path for the
  // finalise identity checks, not a second HR Head.
  assert.equal(canSettleFinal('ADMIN'), false)
})

// ── the checkbox ─────────────────────────────────────────────────────────

test('the attestation is required on BOTH paths', () => {
  // The question is as live when the HR Head agrees with the chain as when
  // they overrule it, so keeping the rating does not skip it.
  const keep = checkFinal({ choice: 'KEEP', discussed: false }, 4)
  assert.equal(keep.ok, false)
  assert.ok(keep.faults.some(f => f.includes('management')))

  const replace = checkFinal({ choice: 'REPLACE', rating: 3, reason: REASON,
    discussed: false }, 4)
  assert.equal(replace.ok, false)
  assert.ok(replace.faults.some(f => f.includes('management')))
})

test('the prompt is the question that was asked for', () => {
  assert.match(HR_FINAL_PROMPT, /discussed/i)
  assert.match(HR_FINAL_PROMPT, /management/i)
})

test('with the box ticked, keeping the chain’s rating is enough', () => {
  // The common case — the HR Head agrees with the HOD — must not demand a
  // written explanation of agreeing.
  const c = checkFinal({ choice: 'KEEP', discussed: true }, 4)
  assert.deepEqual(c.faults, [])
  assert.equal(c.ok, true)
})

// ── replacing ────────────────────────────────────────────────────────────

test('replacing needs a reason, and a real one', () => {
  const none = checkFinal({ choice: 'REPLACE', rating: 3, discussed: true }, 4)
  assert.equal(none.ok, false)
  assert.ok(none.faults.some(f => /why this rating replaces/.test(f)))

  const short = checkFinal({ choice: 'REPLACE', rating: 3, reason: 'no',
    discussed: true }, 4)
  assert.ok(short.faults.some(f => f.includes(`${MIN_FINAL_REASON} characters`)))

  const ok = checkFinal({ choice: 'REPLACE', rating: 3, reason: REASON,
    discussed: true }, 4)
  assert.deepEqual(ok.faults, [])
})

test('a rating off the scale is refused', () => {
  const c = checkFinal({ choice: 'REPLACE', rating: 9, reason: REASON,
    discussed: true }, 4)
  assert.ok(c.faults.some(f => /not on this policy/.test(f)))
  // And a scale that is not 1-5 is respected.
  const ten = checkFinal({ choice: 'REPLACE', rating: 9, reason: REASON,
    discussed: true }, 4, [1,2,3,4,5,6,7,8,9,10])
  assert.deepEqual(ten.faults, [])
})

test('choosing replace and typing the same number is caught', () => {
  // Otherwise the reason they write describes a change that never happened.
  const c = checkFinal({ choice: 'REPLACE', rating: 4, reason: REASON,
    discussed: true }, 4)
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /already settled/.test(f)))
})

test('keeping a rating that does not exist is refused', () => {
  const c = checkFinal({ choice: 'KEEP', discussed: true }, null)
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /no rating from the chain/.test(f)))
})

test('every fault is reported, not just the first', () => {
  const c = checkFinal({ choice: 'REPLACE', rating: 99, discussed: false }, 4)
  assert.ok(c.faults.length >= 3,
    'somebody fixing one fault would meet the next on the following try')
})

// ── what gets written ────────────────────────────────────────────────────

test('keeping the rating touches neither the rating nor the chain record', () => {
  const p = finalPatch({ choice: 'KEEP', discussed: true }, 4, 'hr-1', 'T')
  assert.equal(p.final_rating, undefined, 'keeping rewrote the rating')
  assert.equal(p.chain_final_rating, null, 'keeping recorded an override')
  assert.equal(p.rating_source, undefined, 'keeping relabelled the source')
  assert.equal(p.hr_management_discussed, true)
  assert.equal(p.hr_final_confirmed_by, 'hr-1')
  assert.equal(p.hr_final_confirmed_at, 'T')
})

test('replacing captures the chain’s band before overwriting it', () => {
  // THE ONLY MOMENT THAT NUMBER STILL EXISTS. Once final_rating is written
  // over, nothing else on the row remembers what the chain settled.
  const p = finalPatch({ choice: 'REPLACE', rating: 3, reason: REASON,
    discussed: true }, 4, 'hr-1', 'T')
  assert.equal(p.final_rating, 3)
  assert.equal(p.chain_final_rating, 4)
  assert.equal(p.hr_final_reason, REASON)
  assert.equal(p.rating_source, 'HR_OVERRIDE')
})

test('the per-rater scores are never in the patch', () => {
  // Superseding is not erasing: what each person said stays on the record.
  for (const intent of [{ choice: 'KEEP' as const, discussed: true },
                        { choice: 'REPLACE' as const, rating: 2, reason: REASON, discussed: true }]) {
    const p = finalPatch(intent, 4, 'hr-1')
    for (const col of ['rm_l1_score', 'rm_l2_score', 'hod_score', 'self_score',
                       'final_score']) {
      assert.equal(p[col], undefined, `${col} is being overwritten`)
    }
  }
})

test('the reason is trimmed to null when blank', () => {
  const p = finalPatch({ choice: 'REPLACE', rating: 3, reason: '   ',
    discussed: true }, 4, 'hr-1')
  assert.equal(p.hr_final_reason, null)
})

// ── reading it back ──────────────────────────────────────────────────────

test('a confirmation without the attestation is NOT settled', () => {
  // The row the database also refuses. A screen that called this settled
  // would describe a state the trigger disagrees with.
  const s = hrFinalState({ hr_final_confirmed_at: 'T',
    hr_management_discussed: false, final_rating: 4 })
  assert.equal(s.settled, false)
  assert.match(publishFault({ hr_final_confirmed_at: 'T',
    hr_management_discussed: false })!, /settle it again/)
})

test('settled reads true only with both halves', () => {
  assert.equal(hrFinalState({ hr_final_confirmed_at: 'T',
    hr_management_discussed: true }).settled, true)
  assert.equal(hrFinalState({ hr_management_discussed: true }).settled, false)
  assert.equal(hrFinalState({}).settled, false)
  assert.equal(hrFinalState(null).settled, false)
})

test('an override is visible as one, with both numbers', () => {
  const s = hrFinalState({ final_rating: 3, chain_final_rating: 4,
    hr_final_confirmed_at: 'T', hr_management_discussed: true,
    hr_final_reason: REASON })
  assert.equal(s.overrode, true)
  assert.equal(s.rating, 3)
  assert.equal(s.chainRating, 4)
  assert.equal(s.reason, REASON)
})

test('keeping the chain’s rating does not read as an override', () => {
  const s = hrFinalState({ final_rating: 4, chain_final_rating: null,
    hr_final_confirmed_at: 'T', hr_management_discussed: true })
  assert.equal(s.overrode, false)
  assert.equal(s.chainRating, null)
})

test('numeric strings from PostgREST are read as numbers', () => {
  const s = hrFinalState({ final_rating: '3' as never,
    chain_final_rating: '4' as never })
  assert.equal(s.rating, 3)
  assert.equal(s.chainRating, 4)
})

// ── the publish gate ─────────────────────────────────────────────────────

test('an unsettled rating blocks publication', () => {
  const f = publishFault({ final_rating: 4 })
  assert.ok(f)
  assert.match(f!, /cannot be published/)
})

test('a settled rating does not', () => {
  assert.equal(publishFault({ hr_final_confirmed_at: 'T',
    hr_management_discussed: true }), null)
})

test('a policy with the gate switched off never blocks', () => {
  assert.equal(publishFault({}, false), null)
  assert.equal(publishFault(null, false), null)
})

// ── 211 ──────────────────────────────────────────────────────────────────

test('211 adds the columns and the policy switch', () => {
  for (const c of ['hr_final_confirmed_at', 'hr_final_confirmed_by',
                   'hr_management_discussed', 'hr_final_reason',
                   'chain_final_rating']) {
    assert.ok(SQL.includes(`ADD COLUMN IF NOT EXISTS ${c}`), `${c} is missing`)
  }
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS hr_head_final_rating boolean NOT NULL DEFAULT true/,
    'the gate is not a policy setting defaulted on')
})

test('the trigger refuses a publish that is not settled, and the bare checkbox too', () => {
  const fn = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_block_unconfirmed_publish'),
                       SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_publish_needs_hr_final'))
  assert.match(fn, /NEW\.hr_final_confirmed_at IS NULL/)
  assert.match(fn, /NOT COALESCE\(NEW\.hr_management_discussed, false\)/,
    'a row with the attestation false could publish')
  // Default true when the policy row cannot be read: the gate fails CLOSED.
  assert.match(fn, /NOT COALESCE\(v_req, true\)/,
    'an unreadable policy would switch the gate off')
})

test('it only fires on the transition into PUBLISHED', () => {
  // The three results already out must stay out, unchanged and unquestioned.
  const fn = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION pms_block_unconfirmed_publish'),
                       SQL.indexOf('DROP TRIGGER IF EXISTS trg_pms_publish_needs_hr_final'))
  assert.match(fn, /NEW\.workflow_status IS NOT DISTINCT FROM OLD\.workflow_status/)
  assert.match(fn, /OLD\.workflow_status IN \('PUBLISHED','ACKNOWLEDGED'\)/)
})

test('211 is additive and rewrites nothing', () => {
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i,
                   /^\s*UPDATE\s+\w/mi, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!f.test(body), `211 matches ${f}`)
  }
})

test('211 leaves the 207 sign-off rule alone', () => {
  // Its own function and trigger. Folding two gates together means editing
  // either one requires re-reading both.
  // Comments stripped: the header explains WHY it is not a patch into
  // pms_block_unsigned_publish, and naming it there is the point.
  const body = SQL.replace(/^\s*--.*$/gm, ' ')
  assert.ok(!body.includes('pms_block_unsigned_publish'),
    '211 redefines the 207 trigger')
  assert.ok(!body.includes('trg_pms_publish_needs_signoff'),
    '211 drops or replaces the 207 trigger')
  assert.match(SQL, /CREATE OR REPLACE FUNCTION pms_block_unconfirmed_publish/)
})

// ── the wiring ───────────────────────────────────────────────────────────

const TABS = read('components/pms/AdminTabs.tsx')
const PAGE = read('app/dashboard/pms/page.tsx')

test('the publish gate asks the engine, it does not re-derive the rule', () => {
  // A screen that disagreed with the trigger would show an enabled button
  // that throws on click.
  // The rule moved into lib/pms/publishGate.ts when bulk publishing needed
  // the same answer. Asserted where it lives, and behaviourally — a source
  // slice whose anchor has vanished silently matches nothing.
  const GATE = read('lib/pms/publishGate.ts')
  assert.match(GATE, /hrPublishFault\(i\.hrFinal, i\.hrFinalRequired !== false\)/,
    'the HR-final rule is re-implemented instead of reused')
  assert.match(GATE, /faults\.push\(hrFault\)/,
    'the HR-final fault does not block publication')
  assert.equal(publishFaults({ finalRating: 4, appreciation: 'ok',
    signedOff: true, hrFinal: null }).length, 1,
    'an unsettled rating no longer blocks a publish')
  // And the card still hands it the settlement to judge.
  const call = TABS.slice(TABS.indexOf('const faults = publishFaults({'),
                          TABS.indexOf('const publishable ='))
  assert.match(call, /hrFinal: member\?\.hrFinal/,
    'the card does not pass the settlement into the gate')
  assert.match(call, /hrFinalRequired: member\?\.hrFinalRequired/)
})

test('the rating is settled above the words written about it', () => {
  const card = TABS.slice(TABS.indexOf('{!canAct ? ('),
                          TABS.indexOf('Save without publishing'))
  const block = card.indexOf('<HrFinalBlock')
  const appreciation = card.indexOf('Appreciation remark')
  assert.ok(block > 0 && appreciation > 0, 'the card moved')
  assert.ok(block < appreciation,
    'an appreciation remark is written before the rating it describes is settled')
})

test('only an HR Head gets the controls', () => {
  assert.match(PAGE, /canSettleFinal=\{canSettleFinal\(myHrRole\)\}/,
    'the controls are offered without checking the role')
  const block = TABS.slice(TABS.indexOf('function HrFinalBlock'),
                           TABS.indexOf('export function PublishTab'))
  assert.match(block, /if \(!canSettle\)/,
    'everybody gets the settle controls')
  assert.match(block, /Only the HR Head can settle a final rating/,
    'a non-HR-Head is not told who it is waiting on')
})

test('the write re-checks rather than trusting the disabled button', () => {
  // A disabled button is a courtesy, not a control.
  const fn = PAGE.slice(PAGE.indexOf('const settleFinal = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  assert.ok(fn.length > 200, 'settleFinal is gone')
  assert.match(fn, /if \(!canSettleFinal\(myHrRole\)\)/,
    'the write does not check the role')
  assert.match(fn, /const check = checkFinal\(/,
    'the write does not re-run the validation')
  assert.match(fn, /if \(!check\.ok\)/)
  assert.match(fn, /finalPatch\(intent, chainRating, grant\.employeeId \?\? null\)/,
    'the patch is built inline instead of by the shared function')
})

test('the write never touches the per-rater scores', () => {
  const fn = PAGE.slice(PAGE.indexOf('const settleFinal = useCallback'),
                        PAGE.indexOf('const saveFeedback = useCallback'))
  for (const col of ['rm_l1_score', 'rm_l2_score', 'hod_score']) {
    assert.ok(!fn.includes(col), `${col} is written by the settle handler`)
  }
  assert.match(fn, /\.eq\('employee_id', employeeId\)\.eq\('period_id', periodId\)/,
    'the update is not pinned to one person in one period')
})

test('the gate fails closed when the policy cannot be read', () => {
  // An unknown period, an unknown policy, or a policy read before 211 all
  // mean "required". Reading "not required" would let a result out
  // unsettled the one time the trigger did not catch it.
  const fn = PAGE.slice(PAGE.indexOf('const hrGateOf ='),
                        PAGE.indexOf('const hrGateOf =') + 300)
  assert.match(fn, /if \(!pid\) return true/)
  assert.match(fn, /g === undefined \? true : g/)
  assert.match(PAGE, /hrHeadFinalRating: p\.hr_head_final_rating === undefined\s*\n?\s*\? true/,
    'a policy read before 211 reads as gate-off')
})

test('both new selects survive 211 not having run', () => {
  // One unknown column fails the whole request. The policy list feeds the
  // config tab and the company narrowing; the rating select feeds the
  // publish workspace and the ratings summary.
  assert.match(PAGE, /if \(pol\.error && POLICY_SELECT\.includes\('hr_head_final_rating'\)\)/,
    'the policy select has no retry')
  assert.match(PAGE, /if \(pub\.error\) pub = await askPub\(PUB_BASE\)/,
    'the rating select has no retry')
})

test('settling refreshes one row, without closing the card', () => {
  // load() flips `loading` and the tab block sits behind `!loading`, so a
  // full reload unmounts the publish workspace — closing the open card and
  // throwing away an appreciation remark typed before settling. Observed in
  // the browser: text entered, rating settled, text gone.
  //
  // Refetched rather than patched from the intent, because the database
  // decided the result: the trigger could have refused, and
  // chain_final_rating is only populated on an override.
  const fn = PAGE.slice(PAGE.indexOf('const settleFinal = useCallback'),
                        PAGE.indexOf('WRITING AN APPRAISAL THE CHAIN NEVER PICKED UP'))
  assert.ok(fn.length > 400, 'settleFinal moved')
  assert.match(fn, /const fresh = await supabase\.from\('pms_overall_rating'\)/,
    'the settled row is never read back')
  assert.match(fn, /setPubRows\(rows =>/, 'the refreshed row never reaches the screen')
  // The ONLY load() left is the fallback for a row that came back missing.
  // Comments stripped first: the paragraph above this code explains the
  // trap by NAMING load(), and counting that occurrence made the test fail
  // against correct code.
  const code = fn.split('\n').filter(l => !l.trim().startsWith('*')
    && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n')
  assert.equal([...code.matchAll(/\bload\(\)/g)].length, 1,
    'settling still reloads the page and closes the card')
  assert.match(fn, /if \(!got\) \{ load\(\); return \}/,
    'a row that cannot be read back leaves the screen stale')
})
