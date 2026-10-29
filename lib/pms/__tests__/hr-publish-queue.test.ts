// HR's publish queue listed almost everybody.
//
// MEASURED on the live database before the fix, simulating the page's own
// query and PublishTab's own filter:
//
//   rows loaded for the open periods            395
//   "waiting to publish" as the tab computed it 392
//     of those, actually finalised                2
//     with no final rating at all               390   (386 NOT_STARTED)
//
// The card is titled "Waiting to publish" and subtitled "Finalised by the
// chain and now with you", and it was mostly people the chain had not begun
// with. That is not only noise: it is the one screen whose entire job is
// "which results are ready", answered with a list where 99.5% of the rows
// are not — so the two that were ready could not be found, and every count
// above the table was wrong.
//
// The rows still have to be LOADED unfiltered, because the summary tab
// shares them and genuinely needs the whole enrolment ("rated 2 of 395").
// So the narrowing belongs in the publish tab, and the 390 are counted
// rather than dropped silently.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const ADMIN = read('components/pms/AdminTabs.tsx')
const PAGE = read('app/dashboard/pms/page.tsx')

const TAB = ADMIN.slice(ADMIN.indexOf('export function PublishTab('),
                        ADMIN.indexOf('export function SummaryTab('))

/** The filter, applied to rows shaped like PublishRow. */
const settledOf = <T extends { finalRating: number | null; published: boolean }>(rows: T[]) =>
  rows.filter(r => r.finalRating !== null || r.published)

// ── the rule ─────────────────────────────────────────────────────────────

test('only settled results reach the publish queue', () => {
  assert.match(TAB,
    /const settled = scoped\.filter\(r => r\.finalRating !== null \|\| r\.published\)/,
    'the publish tab still lists appraisals the chain has not settled')
  assert.match(TAB, /const waiting = settled\.filter\(r => !r\.published\)/,
    'waiting is computed from the unfiltered set')
  assert.match(TAB, /const done = settled\.filter\(r => r\.published\)/,
    'done is computed from the unfiltered set')
})

test('the live shape of the data, run through that filter', () => {
  // The real proportions, as a fixture: 386 untouched enrolments, one row
  // part-way through the chain, two settled and three already out.
  const rows = [
    ...Array.from({ length: 386 }, (_, i) => (
      { employeeId: `n${i}`, finalRating: null, published: false })),
    { employeeId: 'inflight', finalRating: null, published: false },
    { employeeId: 'nikhil', finalRating: 4, published: false },
    { employeeId: 'nisha', finalRating: 5, published: false },
    { employeeId: 'shreya', finalRating: 4, published: true },
    { employeeId: 'ishaan', finalRating: 3, published: true },
    { employeeId: 'krishna', finalRating: 2, published: true },
  ]
  const settled = settledOf(rows)
  assert.equal(rows.length, 392)
  assert.equal(settled.length, 5, 'the queue is not narrowed to settled results')
  assert.equal(settled.filter(r => !r.published).length, 2,
    'the two publishable results are not the ones offered')
  assert.equal(settled.filter(r => r.published).length, 3)
})

test('a published row with no rating is still shown, not vanished', () => {
  // `|| r.published` is not belt and braces. A row that reached PUBLISHED
  // without a final_rating is a data fault, and dropping it from the record
  // would hide the fault rather than the row.
  const odd = [{ employeeId: 'x', finalRating: null, published: true }]
  assert.equal(settledOf(odd).length, 1,
    'a published result with no rating disappears from the publish tab')
})

test('an unsettled appraisal is never publishable', () => {
  const rows = [{ employeeId: 'a', finalRating: null, published: false }]
  assert.deepEqual(settledOf(rows), [],
    'something the chain has not settled can still be published')
})

// ── the ones that are not listed are still accounted for ─────────────────

test('the appraisals still in the chain are counted, not dropped', () => {
  // A list that shrinks from 392 to 2 with no explanation reads as data
  // loss to whoever saw the old one.
  assert.match(TAB, /const stillInChain = scoped\.length - settled\.length/,
    'nothing counts the appraisals the queue no longer lists')
  assert.match(TAB, /still with the chain and will appear here once settled/,
    'the screen does not say where the rest of the appraisals went')
})

test('the empty state says how many are on their way', () => {
  // "Nothing is waiting" over an organisation mid-cycle is true and
  // alarming; the count is what makes it readable.
  const empty = TAB.slice(TAB.indexOf('<Empty what="Nothing is waiting"'),
                          TAB.indexOf('<Empty what="Nothing is waiting"') + 600)
  assert.match(empty, /stillInChain/,
    'the empty state does not distinguish "none yet" from "none ever"')
})

// ── the shared query stays whole ─────────────────────────────────────────

test('the rows are still loaded unfiltered, for the summary', () => {
  // SummaryTab reports "rated N of M enrolled" off the same rows. Filtering
  // at the query would make M mean "settled", and the denominator of that
  // sentence is the whole point of it.
  const q = PAGE.slice(PAGE.indexOf("const pub = await supabase.from('pms_overall_rating')"),
                       PAGE.indexOf("const pub = await supabase.from('pms_overall_rating')") + 700)
  assert.ok(!/final_rating=not\.is\.null|\.not\('final_rating'/.test(q),
    'the shared query was narrowed, which breaks the summary denominator')
  const summary = ADMIN.slice(ADMIN.indexOf('export function SummaryTab('))
  assert.match(summary, /of \$\{inScope\.length\} enrolled/,
    'the summary no longer reports against the whole enrolment')
})
