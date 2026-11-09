// Giving one person a final rating, by employee code or name.
//
// Requested: "final rating can be uploaded in bulk or hr can also give
// rating per employee basis using there employee code and name."
//
// ── THE RULE THE WHOLE FILE EXISTS TO HOLD ───────────────────────────────
//
// It is the SAME ENGINE, with a batch of one. The single-employee form
// builds an UploadRow, hands it to checkUpload, and commits it through the
// same RPC as the file.
//
// A second write path would be a second set of rules, and the moment they
// disagreed the single-employee route would be the way to get a rating past
// a check the bulk route enforces: eligibility, a locked record, the
// policy's scale, a reason for an override, the audit row. Most of the
// assertions below are that the one-row path is indistinguishable from a
// row that arrived in a CSV.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { searchEnrolled, oneRow, checkUpload, TEMPLATE_COLUMNS,
         finalisedQueue, QUEUE_STATUS_LABEL, type Known } from '../upload.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TABS = read('components/pms/AdminTabs.tsx')

const ROSTER = [
  { employee_code: 'SRS9057', employee_name: 'Isha Nair', final_rating: 4,
    employment_flag: 'ACTIVE', period_code: 'Q2-FY202627' },
  { employee_code: 'SRS9088', employee_name: 'Nikhil Reddy', final_rating: 4,
    employment_flag: 'ACTIVE', period_code: 'Q2-FY202627' },
  { employee_code: 'SRS9003', employee_name: 'Krishna Mehta', final_rating: 2,
    employment_flag: 'ACTIVE', period_code: 'Q2-FY202627' },
  { employee_code: 'SRS9030', employee_name: 'Shreya Singh', final_rating: null,
    employment_flag: 'NEW_JOINER', period_code: 'Q2-FY202627' },
  { employee_code: 'SRS9099', employee_name: 'Nisha Rao', final_rating: 3,
    employment_flag: 'EXITED', period_code: 'Q2-FY202627' },
]

const known: Known = {
  lookup: (code, period) => {
    const r = ROSTER.find(x => x.employee_code === code.toUpperCase())
    if (!r) return null
    if (period && r.period_code.toUpperCase() !== period.toUpperCase()) return null
    const rated = r.final_rating !== null
    return {
      computed: rated ? Number(r.final_rating) : null,
      eligible: r.employment_flag !== 'NEW_JOINER',
      readOnly: r.employment_flag === 'EXITED' && rated,
    }
  },
  scale: [1, 2, 3, 4, 5],
  improvementMandatoryAtOrBelow: 2,
}

// ── finding the person ───────────────────────────────────────────────────

test('an empty query matches nobody', () => {
  // NOT the whole roster. This control overwrites a final rating, and an
  // empty box returning 133 people invites picking the first by accident.
  assert.deepEqual(searchEnrolled(ROSTER, ''), [])
  assert.deepEqual(searchEnrolled(ROSTER, '   '), [])
  assert.deepEqual(searchEnrolled(null, 'x'), [])
})

test('a full code puts that person first, ahead of longer codes and names', () => {
  // Somebody typing a full code knows who they mean; making them scan
  // partial matches to find it turns a lookup into a search.
  //
  // The competitors are the ones that actually compete: a LONGER code
  // sharing the prefix, and a name containing the same text. An earlier
  // version searched a code only one person could match, so it passed with
  // the ranking disabled — it asserted nothing.
  const roster = [
    { employee_code: 'AAA0001', employee_name: 'Srs9003 Lookalike' },
    { employee_code: 'SRS90031', employee_name: 'Someone Else' },
    { employee_code: 'SRS9003', employee_name: 'Krishna Mehta' },
  ]
  assert.deepEqual(searchEnrolled(roster, 'SRS9003').map(c => c.code),
    ['SRS9003', 'SRS90031', 'AAA0001'])
})

test('a code prefix beats a name prefix', () => {
  const roster = [
    { employee_code: 'ZZZ9999', employee_name: 'Nair Kumar' },
    { employee_code: 'NAIR001', employee_name: 'Someone Else' },
  ]
  assert.deepEqual(searchEnrolled(roster, 'NAIR').map(c => c.code),
    ['NAIR001', 'ZZZ9999'])
})

test('a name that starts with the text beats one that merely contains it', () => {
  // Typing "Kri" means Krishna far more often than it means Krishnan's
  // colleague. Untested until a mutation showed that collapsing the two
  // ranks changed no result.
  //
  // The codes are chosen so the RANK is what decides, not the tie-break:
  // Krishna's code sorts LAST, so if the two ranks collapse he drops to
  // second. A first attempt gave him the alphabetically first code, and the
  // tie-break kept him on top with the rank disabled — passing while
  // proving nothing.
  const roster = [
    { employee_code: 'A001', employee_name: 'Ravi Krishnan' },
    { employee_code: 'Z999', employee_name: 'Krishna Mehta' },
  ]
  assert.deepEqual(searchEnrolled(roster, 'Kri').map(c => c.name),
    ['Krishna Mehta', 'Ravi Krishnan'])
})

test('it finds people by name as well as by code', () => {
  assert.equal(searchEnrolled(ROSTER, 'isha')[0].code, 'SRS9057')
  assert.equal(searchEnrolled(ROSTER, 'Krishna')[0].name, 'Krishna Mehta')
})

test('case and surrounding space do not matter', () => {
  for (const q of ['srs9057', '  SRS9057  ', 'Srs9057']) {
    assert.equal(searchEnrolled(ROSTER, q)[0]?.code, 'SRS9057', `"${q}" found nobody`)
  }
})

test('a partial match returns several, ranked', () => {
  const hits = searchEnrolled(ROSTER, 'SRS90')
  assert.ok(hits.length > 1, 'a prefix matched only one person')
  assert.ok(hits.every(h => h.code.startsWith('SRS90')))
})

test('a substring inside a name still matches', () => {
  // "Nair" is not a prefix of either field.
  assert.equal(searchEnrolled(ROSTER, 'nair')[0].code, 'SRS9057')
})

test('nothing matching returns nothing, not everything', () => {
  assert.deepEqual(searchEnrolled(ROSTER, 'ZZZZZ'), [])
})

test('the limit is respected', () => {
  assert.equal(searchEnrolled(ROSTER, 'SRS', 2).length, 2)
  assert.equal(searchEnrolled(ROSTER, 'SRS', 99).length, 5)
})

test('the candidate carries the rating on record', () => {
  // So the reviewer sees what they are replacing BEFORE they replace it.
  const [isha] = searchEnrolled(ROSTER, 'SRS9057')
  assert.equal(isha.rating, 4)
  const [shreya] = searchEnrolled(ROSTER, 'SRS9030')
  assert.equal(shreya.rating, null, 'an unrated person reads as some number')
  assert.equal(shreya.flag, 'NEW_JOINER')
})

// ── the row it builds is an ordinary upload row ──────────────────────────

test('oneRow uses the template\'s own column names', () => {
  const r = oneRow({ employeeCode: 'SRS9057', periodCode: 'Q2-FY202627',
                     finalRating: 5, overrideReason: 'Calibration committee' })
  for (const k of Object.keys(r)) {
    assert.ok((TEMPLATE_COLUMNS as readonly string[]).includes(k),
      `${k} is not a template column, so the commit will ignore it`)
  }
  assert.equal(r.employee_code, 'SRS9057')
  assert.equal(r.final_rating, 5)
})

test('blank text becomes null, not an empty string', () => {
  // An empty override_reason must read as ABSENT, or the reason check
  // passes on a reason nobody wrote.
  const r = oneRow({ employeeCode: 'SRS9057', finalRating: 5,
                     overrideReason: '   ', improvementFeedback: '' })
  assert.equal(r.override_reason, null)
  assert.equal(r.improvement_feedback, null)
  assert.equal(r.period_code, null)
})

// ── and the engine treats it exactly like a file row ─────────────────────

test('a one-row batch is validated by the same checkUpload', () => {
  const p = checkUpload([oneRow({ employeeCode: 'SRS9057', periodCode: 'Q2-FY202627',
    finalRating: 4 })], known)
  assert.equal(p.rows.length, 1)
  assert.equal(p.errorCount, 0)
  assert.equal(p.canCommit, true)
})

test('changing a rating without a reason is refused here too', () => {
  // THE CHECK MOST WORTH KEEPING. Isha is on record at 4; moving her to 5
  // is an override, and an override needs a reason whether it arrived in a
  // spreadsheet or through a form.
  const p = checkUpload([oneRow({ employeeCode: 'SRS9057', periodCode: 'Q2-FY202627',
    finalRating: 5 })], known)
  assert.deepEqual(p.rows[0].errors, ['ERROR_REASON_MISSING'])
  assert.equal(p.canCommit, false)

  const ok = checkUpload([oneRow({ employeeCode: 'SRS9057', periodCode: 'Q2-FY202627',
    finalRating: 5, overrideReason: 'Calibration committee, 2 November' })], known)
  assert.equal(ok.errorCount, 0)
  assert.equal(ok.rows[0].delta, 1, 'the change is not reported to the reviewer')
})

test('an off-scale rating is refused', () => {
  const p = checkUpload([oneRow({ employeeCode: 'SRS9057', periodCode: 'Q2-FY202627',
    finalRating: 7, overrideReason: 'whatever' })], known)
  assert.ok(p.rows[0].errors.includes('ERROR_INVALID_RATING'))
  assert.equal(p.canCommit, false)
})

test('an unknown code is refused', () => {
  const p = checkUpload([oneRow({ employeeCode: 'NOPE1', periodCode: 'Q2-FY202627',
    finalRating: 3 })], known)
  assert.ok(p.rows[0].errors.includes('ERROR_NOT_FOUND'))
})

test('the ineligible and the locked are refused', () => {
  // A new joiner is not in this period; an exited person already rated is
  // read-only under rule 12. Neither may be reached through the short form.
  const joiner = checkUpload([oneRow({ employeeCode: 'SRS9030',
    periodCode: 'Q2-FY202627', finalRating: 3, overrideReason: 'x' })], known)
  assert.ok(joiner.rows[0].errors.includes('ERROR_NOT_ELIGIBLE'))

  const exited = checkUpload([oneRow({ employeeCode: 'SRS9099',
    periodCode: 'Q2-FY202627', finalRating: 5, overrideReason: 'x' })], known)
  assert.ok(exited.rows[0].errors.includes('ERROR_NOT_ELIGIBLE'))
})

// ── the screen ───────────────────────────────────────────────────────────

test('the form commits through the shared path, not its own', () => {
  // One commit function, used by both. Two call sites writing their own
  // fetch is how the file route and the form route drift apart.
  assert.match(TABS, /^async function commitRatings\(/m,
    'there is no single shared commit')
  assert.equal([...TABS.matchAll(/await commitRatings\(/g)].length, 2,
    'the bulk and single paths do not both go through the shared commit')
  assert.equal([...TABS.matchAll(/pmsAdmin<[^>]*>\(\s*'upload_commit'/g)].length, 1,
    'upload_commit is called from more than one place')
})

test('the single form validates with checkUpload before committing', () => {
  const form = TABS.slice(TABS.indexOf('function OneEmployeeRating'),
                          TABS.indexOf('export function UploadTab'))
  assert.ok(form.length > 200, 'the single-employee form is gone')
  assert.match(form, /checkUpload\(/,
    'the form commits without running the shared validation')
  assert.match(form, /searchEnrolled\(/)
  assert.match(form, /oneRow\(/)
})

test('the banner no longer tells HR not to use this for one person', () => {
  // It said: "Use it for an offline calibration or a legacy migration, not
  // to correct one person." That was the rule before there was a way to do
  // it; leaving it would contradict the form directly beneath it.
  assert.ok(!/not to correct one person/.test(TABS),
    'the warning still forbids what the screen now offers')
})

// ── who the chain has finished with ──────────────────────────────────────

const QROSTER = [
  { employee_code: 'SRS9057', employee_name: 'Isha Nair', final_rating: 4,
    workflow_status: 'FINALISED', finalised_by_role: 'HOD', employment_flag: 'ACTIVE' },
  { employee_code: 'SRS9088', employee_name: 'Nikhil Reddy', final_rating: 4,
    workflow_status: 'FINALISED', finalised_by_role: 'HR_MANAGER', employment_flag: 'ACTIVE' },
  { employee_code: 'STC9028', employee_name: 'Nisha Verma', final_rating: 5,
    workflow_status: 'FINALISED', finalised_by_role: 'HOD', employment_flag: 'ACTIVE' },
  { employee_code: 'SRS9003', employee_name: 'Krishna Mehta', final_rating: 2,
    workflow_status: 'PUBLISHED', finalised_by_role: 'HOD', employment_flag: 'ACTIVE' },
  { employee_code: 'SRS9030', employee_name: 'Shreya Singh', final_rating: 4,
    workflow_status: 'ACKNOWLEDGED', finalised_by_role: 'HOD', employment_flag: 'ACTIVE' },
  { employee_code: 'SRS9099', employee_name: 'Exited Person', final_rating: 3,
    workflow_status: 'FINALISED', finalised_by_role: 'HOD', employment_flag: 'EXITED' },
  ...Array.from({ length: 20 }, (_, i) => ({
    employee_code: `NS${String(i).padStart(3, '0')}`, employee_name: `Not Started ${i}`,
    final_rating: null, workflow_status: 'NOT_STARTED',
    finalised_by_role: null, employment_flag: 'ACTIVE',
  })),
]

test('a rating settled by anyone in the chain is ready, not only the HOD\'s', () => {
  // THE DECISION THE OWNER MADE, and the one a literal reading of the
  // request would have got wrong. who_can_finalise is a policy setting, so
  // on this database one rating was settled by an HR Manager — every bit as
  // finished, and invisible if the list filtered on the role.
  const q = finalisedQueue(QROSTER)
  const codes = q.ready.map(r => r.code)
  assert.ok(codes.includes('SRS9088'), 'the HR Manager\'s finalisation was hidden')
  assert.ok(codes.includes('SRS9057') && codes.includes('STC9028'))
  assert.deepEqual(q.ready.map(r => r.finalisedBy).sort(),
    ['HOD', 'HOD', 'HOD', 'HR_MANAGER'])
})

test('released results are separated, not counted as work', () => {
  const q = finalisedQueue(QROSTER)
  assert.deepEqual(q.done.map(r => r.code), ['SRS9003', 'SRS9030'])
  assert.deepEqual(q.done.map(r => r.status), ['PUBLISHED', 'ACKNOWLEDGED'])
  for (const r of q.ready) {
    assert.equal(r.status, 'READY', `${r.code} is already out and listed as waiting`)
  }
})

test('the ones still with the chain are counted, never listed', () => {
  // 386 of 395 on the live database. Listing them is what made the publish
  // queue useless — 392 rows of which 2 were actionable.
  const q = finalisedQueue(QROSTER)
  assert.equal(q.inChain, 20)
  assert.equal(q.ready.length + q.done.length, 6)
  for (const r of [...q.ready, ...q.done]) {
    assert.ok(!r.code.startsWith('NS'), 'an unstarted appraisal is being listed')
  }
})

test('a rating is the marker, not the status label', () => {
  // The finalise step is what writes final_rating, so a row without one has
  // not been settled however far along its workflow_status looks.
  const q = finalisedQueue([
    { employee_code: 'X1', employee_name: 'No rating', final_rating: null,
      workflow_status: 'FINALISED' },
  ])
  assert.equal(q.ready.length, 0, 'a row with no rating was offered as ready')
  assert.equal(q.inChain, 1)
})

test('a released row with no rating still shows', () => {
  // The odd case, kept visible rather than vanished: something was sent to
  // an employee, and the screen must not deny it.
  const q = finalisedQueue([
    { employee_code: 'X2', employee_name: 'Odd', final_rating: null,
      workflow_status: 'PUBLISHED' },
  ])
  assert.equal(q.done.length, 1)
  assert.equal(q.inChain, 0)
})

test('an exited person already rated is flagged locked, up front', () => {
  // Rule 12 locks them, so the commit would refuse. Saying so on the row is
  // better than offering a "Set rating" button that fails on click.
  const q = finalisedQueue(QROSTER)
  const exited = q.ready.find(r => r.code === 'SRS9099')!
  assert.equal(exited.locked, true)
  assert.ok(q.ready.filter(r => r.code !== 'SRS9099').every(r => !r.locked))
})

test('both lists are ordered by code, so a row stays where it was', () => {
  const q = finalisedQueue(QROSTER)
  for (const list of [q.ready, q.done]) {
    const codes = list.map(r => r.code)
    assert.deepEqual(codes, [...codes].sort(), 'the list order is arbitrary')
  }
})

test('an empty or missing roster is not an error', () => {
  for (const r of [[], null, undefined]) {
    const q = finalisedQueue(r)
    assert.deepEqual([q.ready, q.done, q.inChain], [[], [], 0])
  }
})

test('every status has a label HR can read', () => {
  for (const s of ['READY', 'PUBLISHED', 'ACKNOWLEDGED'] as const) {
    assert.ok(QUEUE_STATUS_LABEL[s]?.length > 3, `${s} has no label`)
  }
  assert.match(QUEUE_STATUS_LABEL.READY, /waiting on you/)
})

// ── the queue is wired to the form ───────────────────────────────────────

test('a queue row hands the person to the form', () => {
  const qc = TABS.slice(TABS.indexOf('function FinalisedQueue'),
                        TABS.indexOf('function OneEmployeeRating'))
  assert.ok(qc.length > 200, 'the queue component is gone')
  assert.match(qc, /onClick=\{\(\) => onPick\(toCandidate\(r\)\)\}/,
    'the row action does not load the person into the form')
  assert.match(qc, /disabled=\{r\.locked\}/,
    'a locked row offers an action that will be refused')
})

test('the form remounts when a different person is chosen', () => {
  // Otherwise the previous rating, reason and feedback stay in the boxes
  // under the new name — on a control that overrides a final rating.
  assert.match(TABS, /<OneEmployeeRating key=\{picked\?\.code \?\? 'none'\}/,
    'the form is not keyed on the person')
})

test('the queue does not re-derive what the form already knows', () => {
  // Both read the same `enrolled` rows the tab was given. A second query
  // here would be a second answer to "who is finalised".
  const tab = TABS.slice(TABS.indexOf('export function UploadTab'))
  assert.match(tab, /<FinalisedQueue rows=\{enrolled\}/)
  assert.ok(!/supabase\./.test(tab.slice(0, tab.indexOf('return ('))),
    'the upload tab has started querying on its own')
})
