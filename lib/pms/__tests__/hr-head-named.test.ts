// "A rating that genuinely needs correcting goes through HR" — which HR?
//
// Requested: the HOD's Published Results banner "should also tell which HR
// with name and employee id", and then "hr head should have these
// authority".
//
// WHY THIS NEEDED A MIGRATION RATHER THAN A LOOKUP.
//
// Checked against the live database before adding a column, because the
// cheapest fix would have been to derive the name from something that was
// already there. All four candidates were wrong:
//
//   user_roles              EXISTS AND IS EMPTY — 0 rows.
//   employees.designation   One match for /HR/ company-wide ("Hr Executive"),
//                           in one of three companies. An authority picked by
//                           string match on a free-text job title is a wrong
//                           name waiting to happen.
//   pms_feedback.given_by   Checked on all three published results: Arjun
//                           Malhotra (RM_L1), Shreya Reddy (HOD), twice.
//                           It is whoever wrote the feedback, never HR.
//   pms_overall_rating      finalised_by, finalised_by_role, published_at,
//                           sent_back_by — and no published_by at all.
//
// So the product could not name the HR Head because nobody had ever told it.
// 205 is where it is told, and the rest of this file is about the two things
// that follow: the screens must say "HR" until somebody is named, and they
// must keep working before the migration is applied at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/205_pms_hr_head.sql')
const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')
const ROUTE = read('app/api/pms/admin/route.ts')
const EDITOR = read('components/pms/AdminEditor.tsx')

// ── the migration ────────────────────────────────────────────────────────

test('205 adds one nullable column and nothing else', () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS hr_head_id uuid REFERENCES employees\(id\)/,
    'the column is not added, or not as a reference to employees')
  assert.ok(!/NOT NULL/.test(SQL.replace(/--.*$/gm, '')),
    'the column is NOT NULL, which would mean picking an HR Head for every company')
  // Re-runnable, and destructive of nothing. STATEMENTS, not words: the
  // first version of this matched the bare word DELETE and failed on
  // `ON DELETE SET NULL`, which is the opposite of destructive — it is the
  // clause that stops a leaver taking the policy with them.
  const body = SQL.replace(/--.*$/gm, '')
  for (const forbidden of [/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|FUNCTION|TRIGGER|POLICY)\b/i,
                           /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /^\s*UPDATE\s+\w/mi]) {
    assert.ok(!forbidden.test(body),
      `205 matches ${forbidden}, and it is supposed to be additive only`)
  }
})

test('the HR Head survives the employee being deleted', () => {
  // CASCADE would take the whole policy — every KRA rule, the chain, the
  // weightage total — with one leaver.
  assert.match(SQL, /ON DELETE SET NULL/,
    'deleting the HR Head employee would cascade into the policy')
})

test('the column documents that it is not a permission', () => {
  // The next person to read this will reasonably assume a column named
  // hr_head_id grants something.
  assert.match(SQL, /COMMENT ON COLUMN pms_policies\.hr_head_id/,
    'the column has no comment')
  assert.match(SQL, /[Nn]ot a permission/,
    'nothing says the column does not grant anything')
})

// ── the column is inert until the API names it ───────────────────────────

test('hr_head_id is allowlisted, or the admin control saves into nothing', () => {
  // This route names every column a caller may write. A new policy field is
  // inert until it is listed — the right default for a table that decides
  // how everybody is rated, and a trap each time.
  const cols = ROUTE.slice(ROUTE.indexOf('const POLICY_COLS'),
                           ROUTE.indexOf('const POLICY_COLS') + 1800)
  assert.match(cols, /'hr_head_id'/,
    'the HR Head cannot be saved, because the route will not accept the column')
})

test('the picker has people to offer', () => {
  assert.match(ROUTE, /sb\.from\('employees'\)\.select\('id,emp_code,full_name,company_id'\)/,
    'the admin snapshot carries no employee list')
  assert.match(ROUTE, /\.is\('date_of_leaving', null\)/,
    'the picker would offer people who have left')
  assert.match(ROUTE, /people: people\.data \?\? \[\]/,
    'the employee list is read but not returned')
})

test('a failed employee read does not break the editor', () => {
  // Same treatment as the company names beside it: the editor still renders
  // and the HR Head field simply has nobody to offer.
  const firstError = ROUTE.slice(ROUTE.indexOf('const firstError'),
                                 ROUTE.indexOf('const firstError') + 200)
  assert.ok(!/people/.test(firstError),
    'a failed employee read fails the whole admin snapshot')
  assert.match(ROUTE, /could not read the employee list/,
    'a failed employee read is silent')
})

test('the picker is scoped to the policy\'s own company', () => {
  // Three organisations share this database and the employee codes repeat
  // across them — SRS9030 and STC9030 are different people.
  assert.match(EDITOR, /s\(pp\.company_id\) === s\(current\.company_id\)/,
    'the HR Head dropdown offers the whole group')
})

test('"nobody named yet" is an option, not an absence', () => {
  // Unsetting has to be possible, and an empty select with no explanation
  // reads as a loading state.
  assert.match(EDITOR, /<option value="">Nobody named yet<\/option>/,
    'the HR Head cannot be cleared once set')
  assert.match(EDITOR, /set\('hr_head_id', e\.target\.value \|\| null\)/,
    'clearing the picker saves an empty string rather than null')
})

// ── the banner ───────────────────────────────────────────────────────────

test('the banner names the HR Head when there is one', () => {
  const tab = MGR.slice(MGR.indexOf('export function PublishedResultsTab'),
                        MGR.indexOf('export function PublishedResultsTab') + 4000)
  assert.match(tab, /the HR Head, <b>\{hrHead\.name\}<\/b>/,
    'the banner does not name the HR Head')
  assert.match(tab, /\{hrHead\.code\}/,
    'the banner does not carry the employee id that was asked for')
})

test('and says "HR" when nobody is named', () => {
  // Naming the wrong person is worse than naming none, and on the day 205
  // lands no company has named anybody.
  const tab = MGR.slice(MGR.indexOf('export function PublishedResultsTab'),
                        MGR.indexOf('export function PublishedResultsTab') + 4000)
  assert.match(tab, /hrHead\?\.name\s*\n?\s*\?/,
    'the banner does not branch on whether an HR Head exists')
  assert.match(tab, /no HR Head is named for this company yet/,
    'the fallback does not say why no name is shown')
  assert.match(tab, /Setup &amp; Controls/,
    'the fallback does not say where to set one')
})

// ── it works before the migration is applied ─────────────────────────────

test('the HR Head is read in its own request', () => {
  // PostgREST fails the WHOLE query on an unknown column. Putting
  // hr_head_id on the policy select every review screen depends on would
  // take the entire PMS down between deploying this and running 205.
  const hook = PERF.slice(PERF.indexOf('function useHrHead('),
                          PERF.indexOf('function useHrHead(') + 1400)
  assert.match(hook, /\.select\('hr_head_id'\)/,
    'the HR Head is not read on its own')
  const policySelect = PERF.slice(PERF.indexOf("const po = await supabase.from('pms_policies')"),
                                  PERF.indexOf("const po = await supabase.from('pms_policies')") + 600)
  assert.ok(!/hr_head_id/.test(policySelect),
    'hr_head_id was added to the shared policy select, which breaks every review screen until 205 is applied')
})

test('a missing column is a waiting state, not an error', () => {
  const hook = PERF.slice(PERF.indexOf('function useHrHead('),
                          PERF.indexOf('function useHrHead(') + 1400)
  assert.match(hook, /if \(p\.error \|\| !p\.data\) \{ if \(live\) setHead\(null\); return \}/,
    'a missing hr_head_id column is treated as a fault rather than "not named yet"')
  assert.ok(!/logFail/.test(hook),
    'the expected pre-migration state is logged as a failure')
})

test('the lookup does not run without a policy', () => {
  const hook = PERF.slice(PERF.indexOf('function useHrHead('),
                          PERF.indexOf('function useHrHead(') + 1400)
  assert.match(hook, /if \(!policyId\) \{ setHead\(null\); return \}/,
    'the HR Head is looked up before there is a policy to look it up on')
})

test('an unmounted screen does not set state', () => {
  // Two awaits deep; the HOD can leave the tab in between.
  const hook = PERF.slice(PERF.indexOf('function useHrHead('),
                          PERF.indexOf('function useHrHead(') + 1400)
  assert.match(hook, /let live = true/)
  assert.match(hook, /return \(\) => \{ live = false \}/)
})
