// Counting is where quiet errors live: an unmapped status lands in the wrong
// bucket, the totals still add up, and nothing looks wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollUp, byDepartment, readiness, distribution, csvCell, csvText,
         type FillRow } from '../rollup.ts'
import { FILL, FILL_ORDER, FILL_MEANING, FILL_LABEL } from '../status.ts'

const rows = (spec: [string, number][], dept = 'd1'): FillRow[] =>
  spec.flatMap(([s, n]) => Array.from({ length: n }, () => ({ fill_status: s, department_id: dept })))

test('counts land in the right buckets and add up to the total', () => {
  const r = rollUp(rows([['NOT_STARTED', 3], ['SUBMITTED', 2], ['FINALISED', 5]]))
  assert.equal(r.total, 10)
  assert.equal(r.counts.NOT_STARTED, 3)
  assert.equal(r.counts.SUBMITTED, 2)
  assert.equal(r.counts.FINALISED, 5)
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0) + r.unknown, r.total)
})

test('an unrecognised status is counted as UNKNOWN, never quietly absorbed', () => {
  // Folding it into "not started" would make the arithmetic tidy and the
  // mistake invisible, which is the worst of both.
  const r = rollUp(rows([['NOT_STARTED', 1], ['WHAT_IS_THIS', 2], ['FINALISED', 1]]))
  assert.equal(r.unknown, 2)
  assert.equal(r.counts.NOT_STARTED, 1)
  assert.equal(r.total, 4)
})

test('a missing status is unknown, not zero', () => {
  const r = rollUp([{ fill_status: null }, {}, { fill_status: '' }])
  assert.equal(r.unknown, 3)
  assert.equal(r.total, 3)
})

test('empty input does not divide by zero', () => {
  const r = rollUp([])
  assert.equal(r.total, 0)
  assert.equal(r.done, 0)
  assert.equal(r.notStarted, 0)
  for (const s of FILL_ORDER) assert.equal(r.counts[s], 0)
})

test('done is finalised over total, not "everything except not-started"', () => {
  const r = rollUp(rows([['FINALISED', 3], ['IN_REVIEW', 1]]))
  assert.equal(r.done, 0.75)
})

// ── departments ──────────────────────────────────────────────────────────

test('departments are ordered worst first — the list exists to be worked down', () => {
  const rs = [...rows([['NOT_STARTED', 1]], 'a'),
              ...rows([['NOT_STARTED', 7]], 'b'),
              ...rows([['FINALISED', 9]], 'c')]
  const d = byDepartment(rs)
  assert.equal(d[0].departmentId, 'b')
  assert.equal(d[0].notStarted, 7)
  assert.equal(d[d.length - 1].departmentId, 'c')
})

test('ties on not-started break on size, so the bigger problem sorts first', () => {
  const rs = [...rows([['NOT_STARTED', 2], ['FINALISED', 1]], 'small'),
              ...rows([['NOT_STARTED', 2], ['FINALISED', 20]], 'big')]
  assert.equal(byDepartment(rs)[0].departmentId, 'big')
})

test('employees with no department are grouped, not dropped', () => {
  // Silently losing them would understate every total on the screen.
  const rs = [{ fill_status: 'NOT_STARTED', department_id: null },
              { fill_status: 'NOT_STARTED' }]
  const d = byDepartment(rs)
  assert.equal(d.length, 1)
  assert.equal(d[0].departmentId, null)
  assert.equal(d[0].total, 2)
})

// ── the headline ─────────────────────────────────────────────────────────

test('the headline leads with the count that blocks, not a percentage', () => {
  // "62% complete" is not something an HR admin can act on.
  const r = readiness(rollUp(rows([['NOT_STARTED', 7], ['FINALISED', 13]])))
  assert.match(r.headline, /7 of 20 have not written any KRAs/)
  assert.match(r.detail, /cannot be rated at all/)
  assert.equal(r.tone, 'warn')
})

test('a majority not started is worse than a minority, and says so', () => {
  assert.equal(readiness(rollUp(rows([['NOT_STARTED', 11], ['FINALISED', 9]]))).tone, 'bad')
  assert.equal(readiness(rollUp(rows([['NOT_STARTED', 1], ['FINALISED', 19]]))).tone, 'warn')
})

test('once everyone has started, the message moves off the employees', () => {
  const r = readiness(rollUp(rows([['IN_REVIEW', 4], ['FINALISED', 6]])))
  assert.match(r.headline, /4 of 10 still to finalise/)
  assert.match(r.detail, /managers and HODs/)
})

test('finished says finished, and empty says empty', () => {
  assert.equal(readiness(rollUp(rows([['FINALISED', 5]]))).tone, 'good')
  const none = readiness(rollUp([]))
  assert.equal(none.tone, 'neutral')
  assert.match(none.headline, /Nobody is enrolled/)
})

test('every headline is a sentence a person could say out loud', () => {
  const cases = [[], rows([['NOT_STARTED', 3]]), rows([['IN_REVIEW', 3]]), rows([['FINALISED', 3]])]
  for (const rs of cases) {
    const r = readiness(rollUp(rs))
    assert.ok(r.headline.length > 12, r.headline)
    assert.ok(r.detail.length > 30, r.detail)
    assert.doesNotMatch(r.headline + r.detail, /[A-Z]{4,}|_|pms_|null|undefined/)
  }
})

// ── distribution ─────────────────────────────────────────────────────────

test('the distribution keeps empty states — an empty column is information', () => {
  // Dropping them would also make the bar change shape between loads.
  const d = distribution(rollUp(rows([['FINALISED', 4]])))
  assert.equal(d.length, FILL_ORDER.length)
  assert.equal(d.find(x => x.key === FILL.NOT_STARTED)!.n, 0)
  assert.equal(d.find(x => x.key === FILL.FINALISED)!.share, 1)
})

test('shares sum to one when nothing is unknown', () => {
  const d = distribution(rollUp(rows([['NOT_STARTED', 1], ['SUBMITTED', 1], ['FINALISED', 2]])))
  assert.equal(+d.reduce((t, x) => t + x.share, 0).toFixed(6), 1)
})

test('every fill state has a label and a plain-language meaning', () => {
  for (const s of FILL_ORDER) {
    assert.ok(FILL_LABEL[s], `${s} has no label`)
    assert.ok(FILL_MEANING[s].length > 30, `${s} has no real meaning line`)
    assert.doesNotMatch(FILL_LABEL[s], /_|[A-Z]{4,}/)
  }
})

// ── §6.3's export ────────────────────────────────────────────────────────
// A misaligned CSV is the worst kind of wrong: it opens, it looks plausible,
// and every column after the stray comma belongs to the wrong heading. This
// lives in lib precisely so it can be tested — the download half cannot be.

test('a cell is quoted exactly when leaving it bare would break the row', () => {
  assert.equal(csvCell('Retail Operations'), 'Retail Operations')
  assert.equal(csvCell(4), '4')
  assert.equal(csvCell(3.75), '3.75')
  // null and undefined are EMPTY, not the words. An unrated employee showed
  // "null" in the Self score column otherwise.
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  // the three characters that must force quotes
  assert.equal(csvCell('Nair, Krishna'), '"Nair, Krishna"')
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"')
  assert.equal(csvCell('carriage\rreturn'), '"carriage\rreturn"')
  // an embedded quote is doubled, per RFC 4180 — not escaped with a backslash,
  // which Excel renders literally
  assert.equal(csvCell('he said "no"'), '"he said ""no"""')
  assert.equal(csvCell('Nair, "KC"'), '"Nair, ""KC"""')
  // & and - are not special and must NOT be quoted; over-quoting is harmless
  // in Excel but makes a diff of two exports unreadable
  assert.equal(csvCell('Finance & Accounts'), 'Finance & Accounts')
})

test('a row with a comma in it still has the right number of columns', () => {
  // The actual failure being prevented, stated as the thing a reader checks.
  const csv = csvText(['Code', 'Name', 'Dept', 'Score'],
                      [['E1', 'Nair, Krishna', 'Finance & Accounts', 3.75],
                       ['E2', 'Plain Name', 'IT', null]])
  const lines = csv.trim().split('\n')
  assert.equal(lines.length, 3)
  // Four headings, so four cells per row once quoted sections are respected.
  // Counted with an explicit scan rather than a regex: the first version of
  // this helper used a clever one and was off by one on the HEADER row, which
  // made a correct export look broken.
  const cells = (l: string) => {
    let n = 1, inQ = false
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (c === '"') { if (inQ && l[i + 1] === '"') i++; else inQ = !inQ }
      else if (c === ',' && !inQ) n++
    }
    return n
  }
  assert.equal(cells(lines[0]), 4)
  assert.equal(cells(lines[1]), 4, 'the comma in "Nair, Krishna" split the row')
  assert.equal(cells(lines[2]), 4)
  assert.match(lines[1], /"Nair, Krishna"/)
  // a null tail stays empty rather than printing the word
  assert.match(lines[2], /,IT,$/)
})

test('the export ends with a newline and has no trailing blank row', () => {
  const csv = csvText(['A'], [['x'], ['y']])
  assert.equal(csv, 'A\nx\ny\n')
})
