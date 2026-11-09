// lib/letters/__tests__/record-save.test.ts — saving the details HR filled in on a letter back to
// the employee record: only what the record lacked, never over a value already there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filledMissing, saveFilledToRecord } from '../record-save.ts'

test('only fields the record lacked and HR filled in are offered', () => {
  const original = { father_name: '........', designation: 'Manager', grade: '', doj: '2026-10-23', uan: '' }
  const current = { father_name: 'Ramesh Sharma', designation: 'Senior Manager', grade: 'L5', doj: '2026-10-23', uan: '', name: 'Asha' }
  assert.deepEqual(filledMissing(original, current), ['father_name', 'grade'])
  assert.deepEqual(filledMissing(original, original), [])
})

/** A Supabase stand-in: one employee row, one department, one location; records the update. */
function fakeSb(emp: Record<string, any>) {
  const updates: any[] = []
  const table = (name: string) => {
    const q: any = { _f: {} as Record<string, any> }
    q.select = () => q; q.eq = (k: string, v: any) => { q._f[k] = v; return q }; q.ilike = (k: string, v: any) => { q._f[k] = v; return q }; q.or = () => q; q.limit = () => q
    q.maybeSingle = async () => ({ data: name === 'employees' ? emp : null })
    q.then = (res: any) => res({ data: name === 'departments' ? (String(q._f.dept_name).toLowerCase() === 'finance' ? [{ id: 'dep-fin' }] : []) : name === 'locations' ? [{ id: 'loc-jp' }] : [] })
    q.update = (patch: any) => ({ eq: async () => { updates.push(patch); return { error: null } } })
    return q
  }
  return { sb: { from: table }, updates }
}

test('writes only empty columns, looks up the department, refuses an unknown one', async () => {
  const { sb, updates } = fakeSb({ company_id: 'co1', father_name: '', grade: 'M2', department_id: null, company_doj: null })
  const r = await saveFilledToRecord(sb, 'e1',
    { father_name: '', grade: '', department: '', doj: '' },
    { father_name: 'Ramesh Sharma', grade: 'L5', department: 'Finance', doj: '2026-11-01' })
  assert.deepEqual(updates, [{ father_name: 'Ramesh Sharma', company_doj: '2026-11-01', department_id: 'dep-fin' }])
  assert.deepEqual(r.saved, ["Father's / husband's name", 'Date of joining', 'Department'])
  assert.deepEqual(r.skipped, ['Grade / band (already on record)'])

  const two = fakeSb({ company_id: 'co1', department_id: null })
  const r2 = await saveFilledToRecord(two.sb, 'e1', { department: '' }, { department: 'Rocketry' })
  assert.deepEqual(two.updates, [])
  assert.match(r2.skipped[0], /not a department/)
})

test('nothing ticked in, nothing written', async () => {
  const { sb, updates } = fakeSb({ company_id: 'co1' })
  const r = await saveFilledToRecord(sb, 'e1', { grade: 'L5' }, { grade: 'L5' })
  assert.deepEqual(r, { saved: [], skipped: [] })
  assert.deepEqual(updates, [])
})
