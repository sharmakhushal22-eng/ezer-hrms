// A colleague search is typed by a person, so it contains the characters people
// use in names. Every one of these used to come back 400 from PostgREST because
// the value was interpolated into the filter syntax unquoted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ilikeTerm, orIlike } from '../pg-search.ts'

test('an ordinary term is wrapped and quoted', () => {
  assert.equal(ilikeTerm('full_name', 'priya'), 'full_name.ilike."%priya%"')
})

test('a comma stays inside the value instead of starting a new term', () => {
  // This is the bug: unquoted, everything after the comma was read as the next
  // `column.op.value` and the request was rejected.
  assert.equal(ilikeTerm('full_name', 'Nair, Priya'), 'full_name.ilike."%Nair, Priya%"')
})

test('the other PostgREST reserved characters survive too', () => {
  assert.equal(ilikeTerm('designation', 'Head (Ops)'), 'designation.ilike."%Head (Ops)%"')
  assert.equal(ilikeTerm('designation', 'Sr. Manager'), 'designation.ilike."%Sr. Manager%"')
  assert.equal(ilikeTerm('designation', 'Lead: Payroll'), 'designation.ilike."%Lead: Payroll%"')
})

test('a double quote is escaped, not left to close the value early', () => {
  assert.equal(ilikeTerm('full_name', 'A "Bob" C'), 'full_name.ilike."%A \\"Bob\\" C%"')
})

test('a backslash is escaped before anything else, so it is not doubled twice', () => {
  assert.equal(ilikeTerm('full_name', 'a\\b'), 'full_name.ilike."%a\\\\b%"')
  assert.equal(ilikeTerm('full_name', 'a\\"b'), 'full_name.ilike."%a\\\\\\"b%"')
})

test('LIKE wildcards keep the meaning they have today', () => {
  // Not escaped on purpose — see the note in search.ts. Changing what a search
  // matches is a different decision from stopping it erroring.
  assert.equal(ilikeTerm('emp_code', 'SRS_00'), 'emp_code.ilike."%SRS_00%"')
  assert.equal(ilikeTerm('emp_code', '50%'), 'emp_code.ilike."%50%%"')
})

test('an empty term matches everything rather than producing broken syntax', () => {
  assert.equal(ilikeTerm('full_name', ''), 'full_name.ilike."%%"')
})

test('orIlike joins one term per column', () => {
  assert.equal(
    orIlike(['full_name', 'emp_code'], 'Nair, P'),
    'full_name.ilike."%Nair, P%",emp_code.ilike."%Nair, P%"',
  )
})

test('the separator between terms is the only unquoted comma', () => {
  const filter = orIlike(['a', 'b', 'c'], 'x,y')
  // Three terms — the commas inside the values must not add more.
  assert.equal(filter.split('.ilike.').length - 1, 3)
  assert.equal(filter.replace(/"[^"]*"/g, '""').split(',').length, 3)
})
