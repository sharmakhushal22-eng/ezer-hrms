// Releasing many results at once.
//
// Requested: "Bulk publish at one click for multiple employees with
// different employee ids in multiple departments filter by
// group/branch/company. Default filter: selected all."
//
// ── WHAT THIS FILE IS REALLY GUARDING ────────────────────────────────────
//
// A bulk action is the natural place for rules to get quietly relaxed,
// because the thing that makes it useful — not stopping for each person —
// is exactly the thing that makes skipping a check tempting. The owner
// chose the strict reading on all three questions: already-written remarks
// only, already-settled ratings only, skip-and-explain rather than waive.
//
// So most of this file is: bulk refuses everything the single card refuses,
// through the SAME function, and nobody is published silently.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectRows, split, blockedSummary, choices, outcomeText,
         type BulkRow } from '../bulkPublish.ts'
import { publishFaults, canPublish } from '../publishGate.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TABS = read('components/pms/AdminTabs.tsx')

const SETTLED = { hr_final_confirmed_at: 'T', hr_management_discussed: true }

const row = (over: Partial<BulkRow> = {}): BulkRow => ({
  employeeId: 'e1', code: 'SRS0001', name: 'Ready Person',
  finalRating: 4, appreciation: 'Strong quarter.', signedOff: true,
  hrFinal: SETTLED, companyName: 'Sharma Retail Solutions Pvt Ltd',
  departmentId: 'd1', departmentName: 'Retail Operations',
  locationId: 'l1', locationName: 'Noida Branch', ...over,
})

// ── the gate is shared, not copied ───────────────────────────────────────

test('bulk refuses exactly what the card refuses', () => {
  // THE WHOLE POINT OF THE SHARED FUNCTION. If these ever diverge, the
  // looser one becomes the way to release a result the other refuses.
  assert.equal(canPublish(row()), true)
  assert.deepEqual(publishFaults(row()), [])

  const cases: [string, Partial<BulkRow>][] = [
    ['no final rating',   { finalRating: null }],
    ['no remark',         { appreciation: '' }],
    ['whitespace remark', { appreciation: '   ' }],
    ['not settled',       { hrFinal: null }],
    ['not signed off',    { signedOff: false }],
  ]
  for (const [what, over] of cases) {
    assert.equal(canPublish(row(over)), false, `${what} was allowed through`)
  }
})

test('the card and bulk call the same function', () => {
  // Asserted in the source, because the risk is a future edit reinstating
  // an inline copy in the component.
  assert.match(TABS, /publishFaults\(/, 'the card no longer uses the shared gate')
  const gate = TABS.slice(TABS.indexOf('const faults = publishFaults('),
                          TABS.indexOf('const publishable ='))
  assert.ok(gate.length > 20 && gate.length < 700,
    'the card has grown its own fault logic again')
  assert.ok(!/An appreciation remark is needed/.test(gate),
    'a fault sentence has been re-written inline in the component')
})

test('a direct appraisal still skips the sign-off, in bulk too', () => {
  // 212's waiver has to travel with the rule, or a batch would refuse what
  // the database allows — the bug already fixed once on the card.
  assert.equal(canPublish(row({ signedOff: false, hrDirect: true })), true)
  assert.equal(canPublish(row({ signedOff: false, hrDirect: false })), false)
})

test('mandatory improvement feedback still applies', () => {
  assert.equal(canPublish(row({ finalRating: 2, improvementRequired: true,
    improvement: '' })), false)
  assert.equal(canPublish(row({ finalRating: 2, improvementRequired: true,
    improvement: 'Collections cadence.' })), true)
})

test('a policy that does not require settlement does not block', () => {
  assert.equal(canPublish(row({ hrFinal: null, hrFinalRequired: false })), true)
})

// ── the filters ──────────────────────────────────────────────────────────

const ROSTER: BulkRow[] = [
  row({ employeeId:'a', code:'SRS0001', companyName:'Sharma Retail Solutions Pvt Ltd',
        departmentId:'d1', locationId:'l1' }),
  row({ employeeId:'b', code:'SRS0002', companyName:'Sharma Retail Solutions Pvt Ltd',
        departmentId:'d2', departmentName:'Finance & Accounts', locationId:'l2',
        locationName:'Pune Branch' }),
  row({ employeeId:'c', code:'STC0003', companyName:'Sharma Trading Corporation',
        departmentId:'d1', locationId:'l2', locationName:'Pune Branch' }),
  row({ employeeId:'d', code:'SSM0004', companyName:'Sharma Sons Manufacturing Pvt Ltd',
        departmentId:'d3', departmentName:'Production', locationId:'l3',
        locationName:'Panipat Factory' }),
]

test('no filter means everybody — the default is all', () => {
  assert.equal(selectRows(ROSTER).length, 4)
  assert.equal(selectRows(ROSTER, {}).length, 4)
  assert.equal(selectRows(ROSTER, { company: null, department: null, location: null }).length, 4)
})

test('each filter narrows, and they combine', () => {
  assert.equal(selectRows(ROSTER, { company: 'Sharma Trading Corporation' }).length, 1)
  assert.equal(selectRows(ROSTER, { department: 'd1' }).length, 2)
  assert.equal(selectRows(ROSTER, { location: 'l2' }).length, 2)
  // Department d1 AND location l2 is only the Trading person.
  const both = selectRows(ROSTER, { department: 'd1', location: 'l2' })
  assert.deepEqual(both.map(r => r.code), ['STC0003'])
})

test('a filter matching nobody returns nobody, not everybody', () => {
  assert.deepEqual(selectRows(ROSTER, { department: 'nope' }), [])
})

test('already-published people are dropped, not reported as blocked', () => {
  // They are not a problem to explain. Listing them as skipped in every
  // batch would bury the people who need attention.
  const withDone = [...ROSTER, row({ employeeId:'z', code:'SRS9999', published: true })]
  assert.equal(selectRows(withDone).length, 4)
  assert.ok(!selectRows(withDone).some(r => r.code === 'SRS9999'))
})

test('the filter choices come from the rows in hand', () => {
  const c = choices(ROSTER)
  assert.deepEqual(c.companies, ['Sharma Retail Solutions Pvt Ltd',
    'Sharma Sons Manufacturing Pvt Ltd', 'Sharma Trading Corporation'])
  assert.deepEqual(c.departments.map(d => d.name),
    ['Finance & Accounts', 'Production', 'Retail Operations'])
  assert.deepEqual(c.locations.map(l => l.name),
    ['Noida Branch', 'Panipat Factory', 'Pune Branch'])
  // Each appears once however many people are in it.
  assert.equal(c.locations.filter(l => l.name === 'Pune Branch').length, 1)
})

test('choices survive missing names and an empty roster', () => {
  assert.deepEqual(choices([]), { companies: [], departments: [], locations: [] })
  assert.deepEqual(choices(null).companies, [])
  const odd = choices([row({ departmentId: 'd9', departmentName: null,
                             locationId: 'l9', locationName: '' })])
  assert.equal(odd.departments[0].name, 'Unnamed department')
  assert.equal(odd.locations[0].name, 'Unnamed location')
})

// ── ready and blocked ────────────────────────────────────────────────────

test('the split names everybody, with reasons for the blocked', () => {
  const s = split([
    row({ code: 'A1' }),
    row({ code: 'B2', appreciation: '' }),
    row({ code: 'C3', hrFinal: null }),
  ])
  assert.deepEqual(s.ready.map(r => r.code), ['A1'])
  assert.deepEqual(s.blocked.map(b => b.row.code), ['B2', 'C3'])
  assert.match(s.blocked[0].faults[0], /appreciation remark/)
  assert.match(s.blocked[1].faults[0], /has not settled/)
  // Nobody is lost between the lists.
  assert.equal(s.ready.length + s.blocked.length + s.inChain, 3)
})

test('people the chain has not rated are counted, never listed', () => {
  // THE MISTAKE THIS AVOIDS, measured on the live database: the first
  // version reported 129 "not ready", of which 128 were simply people the
  // chain had not started — and the single row that genuinely needed
  // attention was the last line of a table nobody would read to the end.
  // The same mistake the publish queue once made with 392 rows.
  const s = split([
    row({ code: 'A1' }),
    row({ code: 'B2', appreciation: '' }),
    ...Array.from({ length: 20 }, (_, i) =>
      row({ code: `NS${i}`, finalRating: null })),
  ])
  assert.equal(s.inChain, 20)
  assert.equal(s.ready.length, 1)
  assert.equal(s.blocked.length, 1, 'unrated people are being listed as blocked')
  for (const b of s.blocked) {
    assert.ok(!b.row.code.startsWith('NS'), 'an unstarted appraisal is in the blocked list')
    assert.ok(!/no final rating/.test(b.faults[0]),
      'the blocked list is reporting a missing rating as something HR can fix')
  }
})

test('an unrated person is never publishable', () => {
  // Belt and braces: they are excluded from `ready` by the split AND
  // refused by the gate, so a future change to either cannot release one.
  const s = split([row({ code: 'X1', finalRating: null })])
  assert.deepEqual(s.ready, [])
  assert.equal(canPublish(row({ finalRating: null })), false)
})

test('both lists are ordered by code', () => {
  const s = split([row({ code: 'Z9' }), row({ code: 'A1' }), row({ code: 'M5' })])
  assert.deepEqual(s.ready.map(r => r.code), ['A1', 'M5', 'Z9'])
})

test('somebody with three problems is counted once', () => {
  // Under the FIRST one, so the totals add up to the number of people
  // rather than the number of problems.
  const s = split([row({ code: 'X1', finalRating: 2, improvementRequired: true,
    improvement: '', appreciation: '', hrFinal: null })])
  assert.ok(s.blocked[0].faults.length >= 3)
  const sum = blockedSummary(s.blocked)
  assert.equal(sum.reduce((t, x) => t + x.n, 0), 1)
})

test('the summary groups by reason, commonest first', () => {
  const s = split([
    row({ code: 'A1', appreciation: '' }),
    row({ code: 'B2', appreciation: '' }),
    row({ code: 'C3', appreciation: '' }),
    row({ code: 'D4', hrFinal: null }),
  ])
  const sum = blockedSummary(s.blocked)
  assert.equal(sum[0].n, 3)
  assert.match(sum[0].reason, /appreciation remark/)
  assert.equal(sum[1].n, 1)
  assert.equal(sum.reduce((t, x) => t + x.n, 0), 4, 'the counts do not add up to the people')
})

// ── what it says afterwards ──────────────────────────────────────────────

test('the outcome sentence matches what happened', () => {
  assert.match(outcomeText({ published: ['a','b','c'], failed: [] }, 0),
    /3 results are now with the employees\./)
  assert.match(outcomeText({ published: ['a'], failed: [] }, 0),
    /1 result is now with the employee\./)
  assert.match(outcomeText({ published: [], failed: [] }, 0), /Nothing was published\./)
})

test('refusals and skips are both reported, with the right grammar', () => {
  const t = outcomeText({ published: ['a'],
    failed: [{ code:'B2', name:'X', message:'refused' }] }, 2)
  assert.match(t, /1 result is now/)
  assert.match(t, /1 was refused by the server/)
  assert.match(t, /2 were not ready/)
  const one = outcomeText({ published: [], failed: [] }, 1)
  assert.match(one, /1 was not ready and was left alone/)
})

// ── the wiring ───────────────────────────────────────────────────────────

const PAGE = read('app/dashboard/pms/page.tsx')

test('the batch publishes row by row, not in one statement', () => {
  // A single UPDATE with `in` is fewer round trips and the wrong shape: the
  // publish triggers RAISE, so one unexpected refusal would abort the whole
  // statement and release nobody.
  const fn = PAGE.slice(PAGE.indexOf('const publishMany = useCallback'),
                        PAGE.indexOf('const publishOne = useCallback'))
  assert.ok(fn.length > 400, 'publishMany is gone')
  assert.match(fn, /for \(const employeeId of ids\)/, 'the batch is not per-row')
  assert.ok(!/\.in\('employee_id'/.test(fn),
    'the batch updates many rows in one statement, so one refusal loses all of them')
})

test('it does not stop at the first failure', () => {
  // Unlike the direct appraisal, where four writes build one record and
  // half of it is worse than none. Here each publish is independent.
  const fn = PAGE.slice(PAGE.indexOf('const publishMany = useCallback'),
                        PAGE.indexOf('const publishOne = useCallback'))
  assert.match(fn, /failed\.push\(/)
  assert.match(fn, /continue/, 'a refusal skips to the next person')
  // NO EARLY EXIT OF ANY KIND. Asserting only on `return` missed a mutation
  // that used `break`, which strands the rest of the batch just as surely.
  const loop = fn.slice(fn.indexOf('for (const employeeId of ids)'))
  for (const exit of [/\bbreak\b/, /\breturn\b(?![^\n]*published, failed)/]) {
    assert.ok(!exit.test(loop), `the loop exits early on ${exit}`)
  }
})

test('every row is re-checked against the shared gate before writing', () => {
  // The list was built when the screen rendered; something may have settled
  // or unsettled since.
  const fn = PAGE.slice(PAGE.indexOf('const publishMany = useCallback'),
                        PAGE.indexOf('const publishOne = useCallback'))
  assert.match(fn, /const faults = publishFaults\(\{/,
    'the batch trusts the screen instead of re-checking')
  assert.match(fn, /if \(faults\.length\) \{ failed\.push/)
  // And the company narrowing from 203 still applies to every row.
  assert.match(fn, /if \(!inPublishScope\(employeeId\)\)/,
    'a batch can reach another company\'s employees')
})

test('the feedback is opened before the rating is released', () => {
  // Same order as the single publish: a failure there must not leave a
  // rating visible with its words still hidden.
  const fn = PAGE.slice(PAGE.indexOf('const publishMany = useCallback'),
                        PAGE.indexOf('const publishOne = useCallback'))
  assert.ok(fn.indexOf("from('pms_feedback')") < fn.indexOf("from('pms_overall_rating')"),
    'the rating goes out before its feedback is made visible')
})

test('the screen defaults to everything selected', () => {
  const comp = TABS.slice(TABS.indexOf('function BulkPublish'),
                          TABS.indexOf('export function PublishTab'))
  assert.ok(comp.length > 500, 'the bulk screen is gone')
  assert.match(comp, /const \[filter, setFilter\] = useState<BulkFilter>\(\{\}\)/,
    'the filters do not start at all')
  // Anchored on the CHECKBOX, not on the expression: the same pattern
  // appears in `chosen`, so a mutation that inverted only the checkbox
  // still matched and the test passed.
  const box = comp.slice(comp.indexOf('aria-label={`Publish ${r.name}`}'))
  assert.match(box.slice(0, 200), /checked=\{picked === null \|\| picked\.has\(r\.employeeId\)\}/,
    'rows do not start selected')
  // Changing a filter must clear the selection, or a stale tick publishes
  // somebody who is no longer on screen.
  assert.match(comp, /setPicked\(null\); setOutcome\(null\); setConfirming\(false\)/,
    'changing a filter leaves a stale selection behind')
})

test('an irreversible batch asks first, and says the number', () => {
  const comp = TABS.slice(TABS.indexOf('function BulkPublish'),
                          TABS.indexOf('export function PublishTab'))
  assert.match(comp, /This cannot be\s*\n?\s*undone/,
    'the confirmation does not say it is irreversible')
  assert.match(comp, /Yes, publish \$\{chosen\.length\}/,
    'the confirmation does not name the number')
  assert.match(comp, /Publishing… \$\{running\} of \$\{chosen\.length\}/,
    'a long batch gives no sign of progress')
})

test('the blocked are shown, counted and never touched', () => {
  const comp = TABS.slice(TABS.indexOf('function BulkPublish'),
                          TABS.indexOf('export function PublishTab'))
  assert.match(comp, /Settled, but not ready to go out \(\{blocked\.length\}\)/,
    'the blocked section no longer separates them from the unrated')
  assert.match(comp, /Still with the chain/,
    'people the chain has not rated are not counted separately')
  assert.match(comp, /These are left exactly as they are/)
  assert.match(comp, /blockedSummary\(blocked\)/, 'the reasons are not grouped')
  // Only the ready rows can ever be submitted.
  assert.match(comp, /const chosen = ready\.filter/,
    'a blocked person can be selected for publishing')
})

test('the outcome survives the batch that produced it', () => {
  // THE THIRD TIME THIS SESSION. load() flips `loading`, the tab block
  // sits behind `!loading`, and the bulk screen unmounts — taking with it
  // the panel listing who went out and who was refused. On a bulk
  // irreversible action that is the worst possible moment to say nothing.
  //
  // Patched in place rather than refetched, which is safe here and was not
  // for the settlement: what changed is known exactly (these ids are
  // published) rather than decided by a trigger.
  const fn = PAGE.slice(PAGE.indexOf('const publishMany = useCallback'),
                        PAGE.indexOf('const publishOne = useCallback'))
  const code = fn.split('\n').filter(l => !l.trim().startsWith('*')
    && !l.trim().startsWith('//')).join('\n')
  assert.ok(!/\bload\(\)/.test(code),
    'the batch reloads the page, destroying the outcome panel')
  assert.match(code, /setPubRows\(rows =>/, 'the published rows are never updated')
  assert.match(code, /done\.has\(r\.employeeId\) \? \{ \.\.\.r, published: true \}/,
    'the rows are not marked published, so the screen still offers them')
})
