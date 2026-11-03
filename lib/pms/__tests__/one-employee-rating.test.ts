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
         type Known } from '../upload.ts'

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
