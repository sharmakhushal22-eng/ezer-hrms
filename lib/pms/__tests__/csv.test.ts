// Reading and writing CSV. Spec §6.3's export and §6.4's upload.
//
// A CSV mistake does not throw: the file opens, the header looks right, and
// every cell after a stray comma belongs to the wrong heading. For the upload
// that is not cosmetic — override_reason is the LAST template column, so a
// comma in a remark pushes a fragment of prose into it, ERROR_REASON_MISSING
// passes because the cell is not empty, and that fragment becomes the audit
// log's justification for overriding an appraisal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, csvText, parseCsv } from '../csv.ts'

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

// ── reading: §6.4's filled-in template ───────────────────────────────────

const TEMPLATE = 'employee_code,period_code,final_rating,appreciation_remark,'
               + 'improvement_feedback,additional_benefit_type,additional_benefit_note,'
               + 'finalised_by_code,override_reason'

test('a comma inside a remark does not shift override_reason', () => {
  // THE DEFECT THIS FILE EXISTS FOR. override_reason is the LAST template
  // column and four of the nine are free prose. Splitting on every comma
  // moved a fragment of the remark into the reason, so ERROR_REASON_MISSING
  // passed — the cell was not empty, it just said the wrong thing — and that
  // fragment is what the audit log keeps as why an appraisal was overridden.
  const csv = TEMPLATE + '\n'
    + 'SRS9003,Q2-FY202627,2,"Strong on audit, weaker on collections",'
    + '"Ageing ran six weeks, escalate sooner",TRAINING_NOMINATION,'
    + '"Workshop, November intake",SRS9010,"Calibration committee, 14 Oct"\n'
  const [r] = parseCsv<Record<string, string>>(csv)
  assert.equal(r.employee_code, 'SRS9003')
  assert.equal(r.final_rating, '2')
  assert.equal(r.appreciation_remark, 'Strong on audit, weaker on collections')
  assert.equal(r.improvement_feedback, 'Ageing ran six weeks, escalate sooner')
  assert.equal(r.additional_benefit_type, 'TRAINING_NOMINATION')
  assert.equal(r.additional_benefit_note, 'Workshop, November intake')
  assert.equal(r.finalised_by_code, 'SRS9010')
  // The one that mattered.
  assert.equal(r.override_reason, 'Calibration committee, 14 Oct')
})

test('Excel’s byte-order mark does not become part of the first column name', () => {
  // Excel writes a BOM on every CSV it saves. Left in place it makes the
  // first header "﻿employee_code", so row.employee_code is undefined and
  // EVERY row reports ERROR_NOT_FOUND against a file that is perfectly fine.
  const [r] = parseCsv<Record<string, string>>('﻿' + TEMPLATE + '\nE1,P1,3,,,,,,\n')
  assert.equal(r.employee_code, 'E1')
  assert.ok(!Object.keys(r).some(k => k.charCodeAt(0) === 0xFEFF), 'a BOM survived into a key')
})

test('doubled quotes come back as one quote', () => {
  const [r] = parseCsv<Record<string, string>>(
    'a,b\n"he said ""no""",plain\n')
  assert.equal(r.a, 'he said "no"')
  assert.equal(r.b, 'plain')
})

test('a newline inside a quoted remark keeps one record, not two', () => {
  const csv = 'employee_code,override_reason\nE1,"line one\nline two"\n'
  const rows = parseCsv<Record<string, string>>(csv)
  assert.equal(rows.length, 1, 'the embedded newline split the record')
  assert.equal(rows[0].override_reason, 'line one\nline two')
})

test('CRLF, blank lines and a short row are all survivable', () => {
  const rows = parseCsv<Record<string, string>>(
    'a,b,c\r\n1,2,3\r\n\r\n4,5\r\n')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '3' })
  // Missing trailing cells read as empty rather than undefined, so the
  // validator sees "not provided" instead of crashing on .trim().
  assert.deepEqual(rows[1], { a: '4', b: '5', c: '' })
})

test('a header alone, or nothing, yields no rows', () => {
  assert.deepEqual(parseCsv(TEMPLATE + '\n'), [])
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('﻿'), [])
})

test('what the writer writes, the reader reads back — exactly', () => {
  // The two halves live in one file so this can be asserted. Every value here
  // is one that broke a naive implementation of one side or the other.
  const head = ['code', 'name', 'reason', 'score']
  const rows = [
    ['E1', 'Nair, Krishna', 'he said "no"', 3.75],
    ['E2', 'Plain', 'line one\nline two', null],
    ['E3', 'Finance & Accounts', '', 0],
  ]
  const back = parseCsv<Record<string, string>>(csvText(head, rows))
  assert.equal(back.length, 3)
  assert.equal(back[0].name, 'Nair, Krishna')
  assert.equal(back[0].reason, 'he said "no"')
  assert.equal(back[0].score, '3.75')
  assert.equal(back[1].reason, 'line one\nline two')
  assert.equal(back[1].score, '', 'null must round-trip to empty, not "null"')
  assert.equal(back[2].name, 'Finance & Accounts')
  assert.equal(back[2].score, '0', 'zero is a value, not an absence')
})
