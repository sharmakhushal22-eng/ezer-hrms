// PMS authority comes from the roles module, not from a constant.
//
// Requested: "it will be good if there is the option to give permissions of
// pms and finalization, result publish from roles and access."
//
// ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────
//
// The option half-existed and was being ignored, in a way that over-granted.
//
// The admin dashboard computed the viewer's PMS role as:
//
//     const myHrRole = grant.isSuperAdmin ? 'ADMIN' : 'HR_MGR'
//
// Everybody who reached the page was HR Manager. mayWritePostFinal('HR',
// 'HR_MGR') is true, so the publish workspace was writable by whoever got in.
//
// And getting in was easy. Publish Results had no screen key of its own — a
// new key is denied to every role the module is configured for, so it
// borrowed 'pms.upload'. MEASURED in role_screen_access on the live
// database:
//
//   PMS is configured for   L1_MANAGER, L2_MANAGER, HOD   (5 keys each)
//   all three hold          pms.overview, pms.fill, pms.upload,
//                           pms.pip, pms.reports
//   HR_HEAD / HR_MANAGER    no PMS rows at all → default-visible
//
// So every line manager held the key the publish tab borrowed, was then
// treated as HR Manager, and could write the feedback an employee reads and
// release the result. Ratings Summary had the same shape through 'pms.fill'.
//
// ── THE FIX TOUCHES NOTHING IN THE ROLES MODULE ──────────────────────────
//
// No migration, no seeding, no schema change — the module is read, not
// written. Registering the two screens makes them switchable in Roles &
// Access AND resolves correctly on its own, because the roles that should
// keep the tabs are precisely the ones with no PMS rows:
//
//   L1 / L2 / HOD    module configured, no row for the new key  → hidden
//   HR Head / Admin  module unconfigured                        → visible
//
// Seeding rows for HR would have configured the module FOR HR and started
// hiding every tab they lack a row for — a privilege removal disguised as a
// grant, which is the trap migration 142 documents at length.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pmsRoleOf, mayWritePostFinal, mayPublish } from '../postFinal.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PAGE = read('app/dashboard/pms/page.tsx')
const SCREENS = read('lib/rms/screens.ts')

/**
 * The page with its comments removed.
 *
 * "Does the code still do X" has to be asked of the CODE. Four times in this
 * work an assertion has been tripped by the comment that explains the rule
 * it enforces — here, the comment above myHrRole quotes the old line
 * verbatim (`grant.isSuperAdmin ? 'ADMIN' : 'HR_MGR'`) to say what it
 * replaced, and a raw-source check read that as the bug still being present.
 * Explaining a fix should never look like the absence of one.
 */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const r = (...codes: string[]) => codes.map(role_code => ({ role_code }))

// ── the role is read, not assumed ────────────────────────────────────────

test('HR roles map to HR', () => {
  assert.equal(pmsRoleOf(r('HR_HEAD')), 'HR_HEAD')
  assert.equal(pmsRoleOf(r('HR_MANAGER')), 'HR_MGR')
  assert.equal(pmsRoleOf(r('CHRO')), 'HR_HEAD')
})

test('line roles map to the line', () => {
  assert.equal(pmsRoleOf(r('L1_MANAGER')), 'RM_L1')
  assert.equal(pmsRoleOf(r('L2_MANAGER')), 'RM_L2')
  assert.equal(pmsRoleOf(r('HOD')), 'HOD')
})

test('an unmapped role is an employee, not an HR Manager', () => {
  // THE WHOLE BUG IN ONE ASSERTION. The old fallback was HR_MGR — the most
  // privileged answer available — for anybody the code could not place.
  for (const code of ['RECRUITER', 'FINANCE_EXECUTIVE', 'IT', 'BRANCH_EXEC',
                      'CFO', 'MD', 'SOMETHING_NEW', '']) {
    assert.equal(pmsRoleOf(r(code)), 'EMPLOYEE',
      `${code} is treated as something other than an ordinary employee`)
  }
  assert.equal(pmsRoleOf([]), 'EMPLOYEE', 'holding no roles grants authority')
  assert.equal(pmsRoleOf(null), 'EMPLOYEE')
  assert.equal(pmsRoleOf(undefined), 'EMPLOYEE')
})

test('a super admin is ADMIN whatever else they hold', () => {
  // Disagreeing with the roles module here would render a screen that then
  // refuses every action on it.
  assert.equal(pmsRoleOf(r('RECRUITER'), true), 'ADMIN')
  assert.equal(pmsRoleOf([], true), 'ADMIN')
})

test('the strongest role held wins, not the first in the array', () => {
  // Roles are additive: an HR Manager with reportees is still an HR Manager,
  // and their authority must not depend on how the grant was sorted.
  assert.equal(pmsRoleOf(r('L1_MANAGER', 'HR_MANAGER')), 'HR_MGR')
  assert.equal(pmsRoleOf(r('HR_MANAGER', 'L1_MANAGER')), 'HR_MGR')
  assert.equal(pmsRoleOf(r('HOD', 'HR_HEAD')), 'HR_HEAD')
  assert.equal(pmsRoleOf(r('HR_HEAD', 'HOD')), 'HR_HEAD')
})

test('role codes are matched case-insensitively', () => {
  assert.equal(pmsRoleOf(r('hr_head')), 'HR_HEAD')
})

// ── what that role is then allowed to do ─────────────────────────────────

test('a line manager cannot write or publish under an HR-owned policy', () => {
  // This is what the hardcoded HR_MGR was silently permitting.
  for (const role of ['RM_L1', 'RM_L2', 'HOD', 'EMPLOYEE'] as const) {
    assert.equal(mayWritePostFinal('HR', role), false,
      `${role} can write HR's post-final feedback`)
    assert.equal(mayPublish('HR', role), false, `${role} can publish a result`)
  }
})

test('HR still can, and so does the finaliser when the policy says so', () => {
  for (const role of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as const) {
    assert.equal(mayWritePostFinal('HR', role), true)
    assert.equal(mayPublish('HR', role), true)
  }
  // 202's other setting hands these back to the line that finalised.
  assert.equal(mayWritePostFinal('FINALISER', 'HOD'), true)
  assert.equal(mayPublish('FINALISER', 'HOD'), true)
  assert.equal(mayWritePostFinal('FINALISER', 'EMPLOYEE'), false)
})

test('the page asks the grant instead of assuming', () => {
  assert.match(CODE, /const myHrRole = pmsRoleOf\(grant\.roles, grant\.isSuperAdmin\)/,
    'the dashboard still decides the viewer\'s PMS role without reading it')
  assert.ok(!/isSuperAdmin \? 'ADMIN' : 'HR_MGR'/.test(CODE),
    'everybody who reaches the page is still treated as HR Manager')
})

// ── the screens are settable in Roles & Access ───────────────────────────

test('publish and summary are registered screens', () => {
  const pms = SCREENS.slice(SCREENS.indexOf("moduleKey: 'pms'"),
                            SCREENS.indexOf("moduleKey: 'attendance'"))
  assert.match(pms, /\{ key: 'publish', label: 'Publish Results' \}/)
  assert.match(pms, /\{ key: 'summary', label: 'Ratings Summary' \}/)
})

test('nothing borrows another tab\'s key any more', () => {
  // Borrowing is what made a line manager's 'pms.upload' open HR's
  // workspace. An empty map is the assertion.
  assert.match(CODE, /const SCREEN_KEY: Partial<Record<Tab, string>> = \{\}/,
    'a tab is still gated by a different tab\'s permission')
})

test('the screen key a tab asks for is its own', () => {
  assert.match(CODE, /const screenKeyOf = \(t: Tab\) => SCREEN_KEY\[t\] \?\? 'pms\.' \+ t/,
    'the tab-to-key derivation changed; check nothing is borrowing again')
})

test('every PMS tab the page renders is a registered screen', () => {
  // A tab whose key is not in the registry cannot be switched in Roles &
  // Access — which is how publish and summary ended up borrowing. Catches
  // the next one at the point it is added.
  const tabList = PAGE.match(/\(\['overview'[^\]]*\] as Tab\[\]\)/)
  assert.ok(tabList, 'the tab list moved; this test needs updating')
  const tabs = [...tabList[0].matchAll(/'([a-z]+)'/g)].map(m => m[1])
  assert.ok(tabs.length >= 10, `only found ${tabs.length} tabs`)
  const pms = SCREENS.slice(SCREENS.indexOf("moduleKey: 'pms'"),
                            SCREENS.indexOf("moduleKey: 'attendance'"))
  for (const t of tabs) {
    assert.match(pms, new RegExp(`key: '${t}'`),
      `pms.${t} is rendered but not registered, so it cannot be set per role`)
  }
})
