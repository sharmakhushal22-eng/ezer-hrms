// lib/pms/__tests__/published-results.test.ts
//
// Requested: a Published Results tab in the HOD's department surface, and a
// published person LEAVING Feedback & Recognition for it.
//
// The second half is the one with teeth. Publishing is the moment the employee
// reads their rating and their feedback (§3.5, §8) — so a published person
// sitting in an editable feedback form means a HOD can rewrite a document
// somebody has already read, and in the worst case formally acknowledged.
// Before this, the picker offered everyone finalised and never asked whether
// the result was out.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')

test('the tab exists in the HOD surface only', () => {
  assert.match(MGR, /k: 'published',\s*label: 'Published Results'/,
    'the tab is not listed in HOD_TABS')
  assert.match(MGR, /export type HodTab =[^\n]*'published'/,
    'HodTab does not allow the new tab')
  // It must NOT appear in the RM list: the requirement is HOD-only, and the
  // department surface is what makes that true (ESS offers scope 'dept' only
  // when roles.isHOD).
  const mgrList = MGR.slice(MGR.indexOf('export const MGR_TABS'),
                            MGR.indexOf('export const HOD_TABS'))
  assert.ok(!/published/.test(mgrList), 'the RM tab list offers Published Results')
  assert.match(PERF, /scope === 'dept' && <DeptSide/,
    'the department surface is not gated on scope')
  assert.match(PERF, /roles\.isHOD \? \[\{ k: 'dept'/,
    'the dept scope is offered to people who are not HODs')
})

test('the tab is rendered, and fed the department roster', () => {
  // `&& (` with the paren: the JSX wraps the element, and a regex that went
  // straight from && to < matched nothing and failed against correct code.
  assert.match(PERF, /tab === 'published' &&\s*\(?\s*<PublishedResultsTab/,
    'the tab is never rendered')
  assert.match(PERF, /<PublishedResultsTab members=\{rows\}/,
    'the tab is not given the roster')
})

test('a published person is REMOVED from Feedback & Recognition', () => {
  // The core of the request.
  assert.match(PERF, /rows\.filter\(r => r\.finalised && !r\.published\)/,
    'the feedback picker still offers published people, so their feedback '
    + 'remains editable after they have read it')
})

test('the Published Results tab has no editable control at all', () => {
  // Not disabled inputs — none. A disabled field still says "this is
  // something you might edit", and the record is closed.
  const tab = MGR.slice(MGR.indexOf('export function PublishedResultsTab'),
                        MGR.indexOf('export function FeedbackTab'))
  assert.ok(tab.length > 800, 'could not isolate the tab body')
  for (const bad of ['<input', '<textarea', '<select', 'onChange', 'onClick']) {
    assert.ok(!tab.includes(bad), `the published record offers ${bad}`)
  }
})

test('it lists only published rows, newest first', () => {
  const tab = MGR.slice(MGR.indexOf('export function PublishedResultsTab'),
                        MGR.indexOf('export function FeedbackTab'))
  assert.match(tab, /\.filter\(m => m\.published\)/, 'it does not filter to published')
  assert.match(tab, /publishedAt/, 'it does not order by publication date')
})

test('published is read from either marker, not one', () => {
  // A publish writes workflow_status PUBLISHED and chain_stage DONE; an
  // acknowledgement moves the status on. Reading only the status misses rows
  // published before 197; only the stage misses rows whose stage was never
  // advanced — the bug that hid finalised appraisals from HR's own queue.
  const m = PERF.match(/published: d\.workflow_status === 'PUBLISHED'[\s\S]{0,220}/)
  assert.ok(m, 'the roster does not derive `published`')
  assert.match(m![0], /ACKNOWLEDGED/)
  assert.match(m![0], /chain_stage === 'DONE'/)
})

test('the feedback loader is driven off the published ids, not the feedback rows', () => {
  // Somebody can be published with no written feedback and still belongs in
  // the list. Keying the list on pms_feedback rows would silently drop them.
  assert.match(PERF, /setPublished\(ids\.map\(id =>/,
    'the published list is built from the feedback rows rather than the roster')
  // And it must only fetch feedback for published people: an unpublished
  // draft is something the employee has not seen.
  assert.match(PERF, /rows\.filter\(r => r\.published\)\.map\(r => r\.employeeId\)/)
})

test('Feedback & Recognition says something useful when everyone is published', () => {
  // "Nobody has been finalised" would be wrong and would send a HOD back to a
  // queue they have already cleared.
  assert.match(PERF, /Every settled result in your department has been published/,
    'there is no empty state for an all-published department')
})
