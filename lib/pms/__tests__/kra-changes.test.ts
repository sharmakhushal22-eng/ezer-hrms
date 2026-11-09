// §3's old-to-new change log, which only has to be right once: the record it
// writes is the evidence of what was agreed in a one-to-one, and a wrong
// entry is worse than none because somebody will believe it.
//
// The failure mode is silence. A diff that misses a change writes nothing and
// nothing complains; a diff that invents one writes a row claiming the
// employee altered a KRA they never touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffKras } from '../kra.ts'

const kra = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `id-${seq}`, seq_no: seq, kra_title: `KRA ${seq}`, kpi_metric: 'metric',
  target_value: '10', category: 'BUSINESS', weightage: 25, ...over,
})

test('an unchanged set produces no log at all', () => {
  // The common case after a send-back is a re-submit with one field fixed.
  // Logging the untouched rows would drown the one that moved.
  const set = [kra(1), kra(2), kra(3), kra(4)]
  assert.deepEqual(diffKras(set, set.map(k => ({ ...k }))), [])
})

test('an edited field is logged with both the old and the new value', () => {
  const before = [kra(1, { weightage: 30 })]
  const after = [kra(1, { weightage: 25 })]
  const [c] = diffKras(before, after)
  assert.equal(c.action, 'EDIT')
  assert.equal(c.seq_no, 1)
  assert.equal(c.record_id, 'id-1')
  assert.equal(c.old_value!.weightage, 30)
  assert.equal(c.new_value!.weightage, 25)
})

test('a new KRA is an ADD with no old value', () => {
  const [c] = diffKras([kra(1)], [kra(1), kra(2)])
  assert.equal(c.action, 'ADD')
  assert.equal(c.seq_no, 2)
  assert.equal(c.old_value, null)
  assert.equal(c.new_value!.kra_title, 'KRA 2')
  // No id yet: the row does not exist until the upsert runs.
  assert.equal(c.record_id, null)
})

test('a dropped KRA is a DELETE — the change most worth recording', () => {
  // submitKras removes the tail when a set shrinks. Without this branch,
  // deleting a KRA would be the one modification the log stayed silent about.
  const [c] = diffKras([kra(1), kra(2)], [kra(1)])
  assert.equal(c.action, 'DELETE')
  assert.equal(c.seq_no, 2)
  assert.equal(c.old_value!.kra_title, 'KRA 2')
  assert.equal(c.new_value, null)
  assert.equal(c.record_id, 'id-2')
})

test('weightage is compared as a number, not as text', () => {
  // Postgres returns numeric as a string through PostgREST, so '25' and 25
  // are the same weightage arriving by different routes. Comparing them as
  // strings would log an edit on every single submit.
  assert.deepEqual(diffKras([kra(1, { weightage: '25' })], [kra(1, { weightage: 25 })]), [])
  assert.deepEqual(diffKras([kra(1, { weightage: 25.0 })], [kra(1, { weightage: '25.00' })]), [])
  // and a real change is still caught
  assert.equal(diffKras([kra(1, { weightage: '25' })], [kra(1, { weightage: 30 })]).length, 1)
})

test('null and empty string are the same absence', () => {
  // An untouched optional field comes back null from the database and '' from
  // the form. Treating those as different would log a phantom edit on the
  // first submit after any reload.
  assert.deepEqual(diffKras([kra(1, { kpi_metric: null })], [kra(1, { kpi_metric: '' })]), [])
})

test('status and lock columns are NOT changes', () => {
  // These move for reasons that are not the employee editing a KRA — the
  // manager locking the set, HR correcting it. Logging them as edits would
  // bury the agreed changes under workflow noise.
  assert.deepEqual(
    diffKras([kra(1, { status: 'DRAFT', locked_at: null })],
             [kra(1, { status: 'LOCKED', locked_at: '2026-10-28' })]), [])
})

test('several changes at once come back in seq order, each named', () => {
  const before = [kra(1), kra(2, { kra_title: 'Old two' }), kra(3)]
  const after = [kra(1), kra(2, { kra_title: 'New two' }), kra(4)]
  const cs = diffKras(before, after)
  assert.deepEqual(cs.map(c => [c.seq_no, c.action]),
    [[2, 'EDIT'], [3, 'DELETE'], [4, 'ADD']])
})

test('a set replaced wholesale logs every row, not one summary', () => {
  // An employee who rewrites all four KRAs has made four changes, and the
  // log has to show four — a single "set replaced" entry would lose what each
  // KRA was before.
  const before = [1, 2, 3, 4].map(n => kra(n))
  const after = [1, 2, 3, 4].map(n => kra(n, { kra_title: `Rewritten ${n}` }))
  const cs = diffKras(before, after)
  assert.equal(cs.length, 4)
  assert.ok(cs.every(c => c.action === 'EDIT' && c.old_value && c.new_value))
})
