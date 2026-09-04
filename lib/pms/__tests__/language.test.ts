// "Q3 FY 2026-27" asks the reader to know that the financial year starts in
// April, that Q3 is therefore October to December, and that 2026-27 is one
// year written as two. These tests are the rule that it never gets to be a
// heading again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  periodSpan, periodSpanShort, frequencyPhrase, periodNoun,
  whenPhrase, positionPhrase, nameThePeriod,
} from '../language.ts'

test('a period is named by the months it covers, in words', () => {
  assert.equal(periodSpan('2026-10-01', '2026-12-31'), 'October to December 2026')
  assert.equal(periodSpan('2027-01-01', '2027-03-31'), 'January to March 2027')
})

test('the year is printed twice only when the period crosses one', () => {
  // Exactly the case where a financial-year code confuses people most.
  assert.equal(periodSpan('2026-12-01', '2027-02-28'), 'December 2026 to February 2027')
  assert.equal(periodSpan('2026-04-01', '2026-06-30'), 'April to June 2026')
})

test('a single month says the month, not a range of one', () => {
  assert.equal(periodSpan('2026-11-01', '2026-11-30'), 'November 2026')
})

test('a bad or missing date falls back rather than printing NaN', () => {
  assert.equal(periodSpan(null, null), '')
  assert.equal(periodSpan('not-a-date', '2026-12-31'), '')
  assert.equal(periodSpan('2026-13-01', '2026-12-31'), '', 'month 13 is not a month')
  assert.equal(periodSpan('2026-10-01', 'rubbish'), 'October 2026')
})

test('the short form fits a chip and still reads', () => {
  assert.equal(periodSpanShort('2026-10-01', '2026-12-31'), 'Oct – Dec 2026')
  assert.equal(periodSpanShort('2026-12-01', '2027-02-28'), 'Dec 2026 – Feb 2027')
  assert.equal(periodSpanShort('2026-11-01', '2026-11-30'), 'Nov 2026')
})

test('frequency is a fact about the calendar, not a category name', () => {
  assert.equal(frequencyPhrase('QUARTERLY'), 'Every three months')
  assert.equal(frequencyPhrase('MONTHLY'), 'Every month')
  assert.equal(frequencyPhrase('HALF_YEARLY'), 'Twice a year')
  assert.equal(frequencyPhrase('ANNUAL'), 'Once a year')
  assert.equal(frequencyPhrase(null), 'Review cycle')
  // no shouting enum names at the reader
  for (const f of ['QUARTERLY', 'MONTHLY', 'HALF_YEARLY', 'ANNUAL', null]) {
    assert.doesNotMatch(frequencyPhrase(f), /[A-Z]{4,}|_/)
  }
})

test('"this quarter" beats any label with a Q in it', () => {
  const s = '2026-10-01', e = '2026-12-31'
  assert.equal(whenPhrase(s, e, '2026-11-15', 'QUARTERLY'), 'This quarter')
  assert.equal(whenPhrase(s, e, '2026-09-30', 'QUARTERLY'), 'Next quarter')
  assert.equal(whenPhrase(s, e, '2027-01-01', 'QUARTERLY'), 'Last quarter')
  assert.equal(whenPhrase(s, e, '2026-11-15', 'MONTHLY'), 'This month')
  assert.equal(periodNoun('HALF_YEARLY'), 'half-year')
})

test('the window edges count as inside it', () => {
  assert.equal(whenPhrase('2026-10-01', '2026-12-31', '2026-10-01', 'QUARTERLY'), 'This quarter')
  assert.equal(whenPhrase('2026-10-01', '2026-12-31', '2026-12-31', 'QUARTERLY'), 'This quarter')
})

test('position is spelled out, because 3/4 reads as a score', () => {
  assert.equal(positionPhrase(1, 4), '1st of 4 this year')
  assert.equal(positionPhrase(2, 4), '2nd of 4 this year')
  assert.equal(positionPhrase(3, 4), '3rd of 4 this year')
  assert.equal(positionPhrase(4, 4), '4th of 4 this year')
  assert.equal(positionPhrase(11, 12), '11th of 12 this year')
  assert.equal(positionPhrase(12, 12), '12th of 12 this year')
  assert.equal(positionPhrase(null, 4), '')
})

// ── the whole decision, in one place ─────────────────────────────────────

const ROW = {
  periodName: 'Q3 2026-27', periodCode: 'Q3', financialYear: '2026-27',
  periodStart: '2026-10-01', periodEnd: '2026-12-31',
  periodNo: 3, totalPeriods: 4, frequency: 'QUARTERLY',
}

test('THE POINT: the heading is months, and never the stored code', () => {
  const n = nameThePeriod(ROW, '2026-11-15')
  assert.equal(n.title, 'October to December 2026')
  assert.doesNotMatch(n.title, /\bQ\d\b/, 'a quarter code reached the heading')
  assert.doesNotMatch(n.title, /FY|financial/i)
})

test('the sub-line orients without jargon', () => {
  const n = nameThePeriod(ROW, '2026-11-15')
  assert.equal(n.sub, 'This quarter · every three months · 3rd of 4 this year')
  assert.doesNotMatch(n.sub, /\bQ\d\b|[A-Z]{4,}|_/)
})

test('the stored code survives — HR files reports under it', () => {
  // Plain language is not the same as throwing information away.
  const n = nameThePeriod(ROW, '2026-11-15')
  assert.equal(n.code, 'Q3 · 2026-27')
})

test('with no dates the code is the best we have, not a choice', () => {
  const n = nameThePeriod(
    { periodName: 'Q3 2026-27', periodCode: 'Q3', financialYear: '2026-27' }, '2026-11-15')
  assert.equal(n.title, 'Q3 2026-27')
  assert.equal(n.sub, 'review cycle')
})

test('nothing at all still produces something sayable', () => {
  const n = nameThePeriod({}, '2026-11-15')
  assert.equal(n.title, 'Review period')
  assert.ok(n.sub.length > 0)
})
