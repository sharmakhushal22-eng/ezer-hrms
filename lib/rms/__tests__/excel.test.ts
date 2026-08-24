import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGroup, detectGroups, parseOrgSheet, relationshipRows, summarise } from '../excel.ts'

// A miniature of the real workbook: two header rows, three reporting blocks and one role
// block, each block being Code / Name / Email id.
const BAND = [
  null, null, null,
  'Reportinmg manager L1', null, null,
  'Reportinmg manager L2', null, null,
  'HOD', null, null,
  'Payroll manager', null, null,
]
const HEADER = [
  'Emp Code', 'Full Name', 'Designation',
  'Code', 'Name', 'Email id',
  'Code', 'Name', 'Email id',
  'Code', 'Name', 'Email id',
  'Code', 'Name', 'Email id',
]
const row = (code: string, name: string, l1: string, l2: string, hod: string, pay = 'P001') => ([
  code, name, 'Executive',
  l1, l1, `${l1}@x.com`,
  l2, l2, `${l2}@x.com`,
  hod, hod, `${hod}@x.com`,
  pay, 'Payroll Person', 'p@x.com',
])

describe('classifying a header band', () => {
  test('reads the reporting levels, including the sheet’s own misspelling', () => {
    assert.deepEqual(classifyGroup('Reportinmg manager L1'), { kind: 'hierarchy', level: 'L1' })
    assert.deepEqual(classifyGroup('Reporting Manager L2'), { kind: 'hierarchy', level: 'L2' })
    assert.deepEqual(classifyGroup('Reporting manager 3'), { kind: 'hierarchy', level: 'L3' })
    assert.deepEqual(classifyGroup('HOD'), { kind: 'hierarchy', level: 'HOD' })
  })

  test('reads the functional roles', () => {
    assert.deepEqual(classifyGroup('HR Head'), { kind: 'role', roleCode: 'HR_HEAD' })
    assert.deepEqual(classifyGroup('Payroll manager'), { kind: 'role', roleCode: 'PAYROLL' })
  })

  test('"HR Manager" is a role, not level 1 — the digit rule must not catch it', () => {
    assert.deepEqual(classifyGroup('HR Manager'), { kind: 'role', roleCode: 'HR_MANAGER' })
  })

  test('anything else is unknown rather than guessed at', () => {
    assert.equal(classifyGroup('Chief Vibes Officer').kind, 'unknown')
    assert.equal(classifyGroup('').kind, 'unknown')
  })
})

describe('detecting blocks', () => {
  test('finds each block and where it starts', () => {
    const { groups } = detectGroups(BAND, HEADER)
    assert.equal(groups.length, 4)
    assert.deepEqual(groups.map(g => g.startCol), [3, 6, 9, 12])
    assert.deepEqual(groups.map(g => g.level ?? g.roleCode), ['L1', 'L2', 'HOD', 'PAYROLL'])
  })

  test('a band label with something other than "Code" under it is skipped and reported', () => {
    const badHeader = [...HEADER]; badHeader[6] = 'Something else'
    const { groups, issues } = detectGroups(BAND, badHeader)
    assert.equal(groups.length, 3)
    assert.ok(issues.some(i => i.code === 'GROUP_LAYOUT'))
  })

  test('an unrecognised block is kept but flagged, so nothing is silently dropped', () => {
    const band = [...BAND]; band[3] = 'Mentor'
    const { groups, issues } = detectGroups(band, HEADER)
    assert.equal(groups.find(g => g.label === 'Mentor')?.kind, 'unknown')
    assert.ok(issues.some(i => i.code === 'UNKNOWN_GROUP'))
  })
})

describe('the two encodings in the sheet', () => {
  test('pointing at yourself means nobody is above you, not that you manage yourself', () => {
    const p = parseOrgSheet([BAND, HEADER, row('E1', 'Top', 'E1', 'E1', 'E1')])
    assert.deepEqual(p.rows[0].hierarchy, {})
    assert.equal(relationshipRows(p).length, 0)
  })

  test('a level that repeats the person named below it does not exist for that employee — except HOD', () => {
    // L1 and L2 are both M1: L2 collapses into L1, one real relationship there.
    // HOD is M1 too, but HOD is never collapsed — "who heads my department" stands on
    // its own even when the head is also this employee's L1.
    const p = parseOrgSheet([BAND, HEADER, row('E1', 'Emp', 'M1', 'M1', 'M1'), row('M1', 'Mgr', 'M1', 'M1', 'M1')])
    assert.deepEqual(p.rows[0].hierarchy, { L1: 'M1', HOD: 'M1' })
    assert.equal(relationshipRows(p).length, 2)
  })

  test('genuinely distinct levels are all kept', () => {
    const grid = [BAND, HEADER,
      row('E1', 'Emp', 'M1', 'M2', 'M3'),
      row('M1', 'A', 'M1', 'M1', 'M1'), row('M2', 'B', 'M2', 'M2', 'M2'), row('M3', 'C', 'M3', 'M3', 'M3')]
    const p = parseOrgSheet(grid)
    assert.deepEqual(p.rows[0].hierarchy, { L1: 'M1', L2: 'M2', HOD: 'M3' })
    assert.equal(relationshipRows(p).length, 3)
  })

  test('HOD is kept even when it names the same person as L2', () => {
    const grid = [BAND, HEADER,
      row('E1', 'Emp', 'M1', 'M2', 'M2'),
      row('M1', 'A', 'M1', 'M1', 'M1'), row('M2', 'B', 'M2', 'M2', 'M2')]
    assert.deepEqual(parseOrgSheet(grid).rows[0].hierarchy, { L1: 'M1', L2: 'M2', HOD: 'M2' })
  })
})

describe('functional roles', () => {
  test('the holder named in a role block gets that role', () => {
    const grid = [BAND, HEADER, row('E1', 'Emp', 'E1', 'E1', 'E1', 'P001'), row('P001', 'Payroll Person', 'P001', 'P001', 'P001', 'P001')]
    const p = parseOrgSheet(grid)
    assert.deepEqual(p.roleHolders, { PAYROLL: ['P001'] })
  })

  test('a role holder who is not an employee in the sheet is reported', () => {
    const grid = [BAND, HEADER, row('E1', 'Emp', 'E1', 'E1', 'E1', 'GHOST')]
    const p = parseOrgSheet(grid)
    assert.ok(p.issues.some(i => i.code === 'ROLE_HOLDER_NOT_IN_SHEET'))
  })

  test('holding a role says nothing about the hierarchy — they are read separately', () => {
    const grid = [BAND, HEADER, row('E1', 'Emp', 'M1', 'M1', 'M1', 'P001'),
      row('M1', 'Mgr', 'M1', 'M1', 'M1', 'P001'), row('P001', 'Pay', 'M1', 'M1', 'M1', 'P001')]
    const p = parseOrgSheet(grid)
    // P001 holds Payroll but is not anybody's manager
    assert.deepEqual(p.roleHolders.PAYROLL, ['P001'])
    assert.equal(relationshipRows(p).some(r => r.manager_code === 'P001'), false)
  })
})

describe('validation', () => {
  test('a row with data but no employee code is skipped and reported', () => {
    const bad = row('', 'No Code', 'M1', 'M1', 'M1')
    const p = parseOrgSheet([BAND, HEADER, bad, row('M1', 'Mgr', 'M1', 'M1', 'M1')])
    assert.equal(p.rows.length, 1)
    assert.ok(p.issues.some(i => i.code === 'MISSING_EMP_CODE'))
  })

  test('a repeated employee code keeps the first row and reports the second', () => {
    const p = parseOrgSheet([BAND, HEADER, row('E1', 'First', 'E1', 'E1', 'E1'), row('E1', 'Second', 'E1', 'E1', 'E1')])
    assert.equal(p.rows.length, 1)
    assert.equal(p.rows[0].full_name, 'First')
    assert.ok(p.issues.some(i => i.code === 'DUPLICATE_EMP_CODE'))
  })

  test('a manager who does not appear as an employee is reported', () => {
    const p = parseOrgSheet([BAND, HEADER, row('E1', 'Emp', 'GHOST', 'GHOST', 'GHOST')])
    assert.ok(p.issues.some(i => i.code === 'MANAGER_NOT_IN_SHEET'))
  })

  test('a circular chain is caught rather than written', () => {
    const grid = [BAND, HEADER,
      row('A', 'A', 'B', 'B', 'B'),
      row('B', 'B', 'A', 'A', 'A')]
    const p = parseOrgSheet(grid)
    assert.ok(p.issues.some(i => i.code === 'CIRCULAR_HIERARCHY'), 'expected a circular hierarchy issue')
  })

  test('an empty sheet is an error, not an empty success', () => {
    assert.ok(parseOrgSheet([]).issues.some(i => i.code === 'EMPTY'))
  })

  test('a sheet with no Emp Code column stops instead of importing nothing quietly', () => {
    const p = parseOrgSheet([BAND, ['A', 'B', 'C'], ['1', '2', '3']])
    assert.ok(p.issues.some(i => i.code === 'NO_EMP_CODE'))
    assert.equal(p.rows.length, 0)
  })

  test('duplicate names are noted but do not stop the import, because matching is on code', () => {
    const grid = [BAND, HEADER, row('E1', 'Same Name', 'E1', 'E1', 'E1'), row('E2', 'Same Name', 'E2', 'E2', 'E2')]
    const p = parseOrgSheet(grid)
    assert.equal(p.rows.length, 2)
    assert.ok(p.issues.some(i => i.code === 'DUPLICATE_NAMES' && i.severity === 'info'))
  })
})

describe('summary', () => {
  test('counts what an import would actually write', () => {
    const grid = [BAND, HEADER,
      row('E1', 'Emp', 'M1', 'M2', 'M3'),
      row('M1', 'A', 'M1', 'M1', 'M1'), row('M2', 'B', 'M2', 'M2', 'M2'), row('M3', 'C', 'M3', 'M3', 'M3'),
      row('P001', 'Pay', 'M1', 'M1', 'M1')]
    const s = summarise(parseOrgSheet(grid))
    assert.equal(s.employees, 5)
    // E1: L1, L2, HOD all distinct — 3. P001: L1=M1, L2 collapses into it, HOD=M1 is
    // kept regardless — 2.
    assert.equal(s.relationships, 5)
    assert.deepEqual(s.byLevel, { L1: 2, L2: 1, HOD: 2 })
    assert.equal(s.errors, 0)
  })
})
