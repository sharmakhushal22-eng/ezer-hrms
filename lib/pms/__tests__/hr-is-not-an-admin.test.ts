// Who may configure the module, and who may upload final ratings.
//
// Settled by the owner, in these words: "No admin controls should not be
// accessed by hr" — and, separately, "hr can access final rating upload
// system and module. hr is authorized to final rating upload."
//
// Those pull in opposite directions and both were wrong in the code:
//
//   Setup & Controls — the policy, KRA library, rating scale and period
//   calendar — was VISIBLE to HR. It refused every save, so nothing could be
//   changed, but the tab was there because the screen permission governing
//   it is default-visible to roles with no PMS rows, which is every HR role.
//
//   Final Rating Upload was visible AND refused. It shares /api/pms/admin
//   with the editor and so inherited the editor's gate, so HR could choose a
//   file, parse it, read a validation preview and press Commit — and only
//   then be told the action was not theirs. §2 grants bulk_upload_ratings to
//   HR Manager, HR Head and Admin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isHrRole, pmsRoleOf } from '../postFinal.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const ROUTE = read('app/api/pms/admin/route.ts')
const PAGE = read('app/dashboard/pms/page.tsx')

const roles = (...codes: string[]) => codes.map(role_code => ({ role_code }))

// ── the upload is HR's ───────────────────────────────────────────────────

test('HR Head and HR Manager count as HR, the line does not', () => {
  // The real role codes, read from the live roles table rather than assumed:
  // Kiran Reddy, the seeded HR Head, holds HR_HEAD and EMPLOYEE.
  assert.equal(isHrRole(pmsRoleOf(roles('HR_HEAD', 'EMPLOYEE'))), true)
  assert.equal(isHrRole(pmsRoleOf(roles('HR_MANAGER'))), true)
  assert.equal(isHrRole(pmsRoleOf(roles('CHRO'))), true)
  for (const r of ['L1_MANAGER', 'L2_MANAGER', 'HOD', 'EMPLOYEE', 'RECRUITER']) {
    assert.equal(isHrRole(pmsRoleOf(roles(r))), false, `${r} is being read as HR`)
  }
  // An unknown code must not fall through to anything privileged.
  assert.equal(isHrRole(pmsRoleOf(roles('SOMETHING_NEW'))), false)
})

test('only the upload is opened up, not the editor', () => {
  const m = ROUTE.match(/const HR_ACTIONS = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, 'HR_ACTIONS is gone')
  const opened = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])
  assert.deepEqual(opened, ['upload_commit'],
    'an admin configuration action has been handed to HR')
  // Every other action must still be admin-only. Named explicitly, because
  // adding one to the set is a one-word change with large consequences.
  for (const a of ['policy_update', 'scale_upsert', 'kra_upsert', 'kra_lock',
                   'periods_generate', 'period_open', 'period_update', 'finalise']) {
    assert.ok(!opened.includes(a), `${a} is no longer admin-only`)
  }
})

test('the gate reads the action, and the body is parsed before it', () => {
  // The gate depends on WHICH action is asked for, so the body has to be
  // read first. Parsing JSON has no side effects; an unparseable body gives
  // an empty action, which matches no case and is refused as admin-only.
  // 217 added a third argument: the period, because who may commit an
  // upload is now a policy question and the policy is per company.
  assert.match(ROUTE, /async function gate\(req: NextRequest, action\?: string, periodId\?: string \| null\)/)
  const post = ROUTE.slice(ROUTE.indexOf('export async function POST'),
                           ROUTE.indexOf('switch (action)'))
  assert.ok(post.indexOf('await req.json()') < post.indexOf('await gate(req, action'),
    'the gate runs before the action it depends on is known')
  assert.match(post, /await gate\(req, action,/)
})

test('the upload is NOT gated on the screen key', () => {
  // canSeeScreen('pms.upload') looks like the natural test and is the
  // dangerous one: L1_MANAGER, L2_MANAGER and HOD hold that key too — which
  // is exactly how Publish Results became reachable by every line manager
  // when it borrowed it. Gating a bulk override on it would let any line
  // manager rewrite the whole period's final ratings.
  // 217 moved the role reading into uploadAllowed, which the gate calls.
  const g = ROUTE.slice(ROUTE.indexOf('async function uploadAllowed('),
                        ROUTE.indexOf('// ─── GET'))
  assert.ok(!/canSeeScreen/.test(g), 'the bulk override is gated on a screen key')
  assert.match(g, /pmsRoleOf\(grant\.roles, grant\.isSuperAdmin\)/,
    'the gate does not reuse the reading the publish path already uses')
  // EVERY path through uploadAllowed checks the role. Asserting that
  // isHrRole merely APPEARS let a mutation through that returned true when
  // no period was given — the fallback is the path a caller controls.
  assert.match(g, /if \(!periodId\) return isHrRole\(role\)/,
    'an upload with no period named skips the role check entirely')
  assert.match(g, /if \(r\.error \|\| !r\.data\) return isHrRole\(role\)/,
    'an unreadable policy skips the role check')
  // And the policy only NARROWS — it cannot hand the upload to a line manager.
  assert.match(g, /authorityOf\(role, authorityFromRow\(pol\)\)\.upload/)
})

test('GET stays admin-only', () => {
  // GET returns the whole editor payload: policies, the KRA library, the
  // scale and the period calendar. The upload tab does not use it.
  const get = ROUTE.slice(ROUTE.indexOf('export async function GET'),
                          ROUTE.indexOf('export async function POST'))
  assert.match(get, /await gate\(req\)/,
    'GET passes an action, which could open the editor payload to HR')
  assert.ok(!/gate\(req, /.test(get))
})

// ── the editor is not HR's ───────────────────────────────────────────────

test('Setup & Controls is hidden from anyone who cannot manage the module', () => {
  assert.match(PAGE, /const CONFIGURES_THE_MODULE = new Set<Tab>\(\['setup'\]\)/,
    'the admin-only tab set is gone or has changed shape')
  // Both places that decide which tabs exist must agree, or the strip and
  // the default-tab logic disagree about what is reachable.
  assert.equal([...PAGE.matchAll(/CONFIGURES_THE_MODULE\.has\(/g)].length, 2,
    'only one of the two tab filters applies the rule')
  assert.match(PAGE, /canManage\(grant, 'Performance'\)/,
    'the page does not use the same test the API enforces')
})

test('the upload tab is NOT hidden', () => {
  // The whole point of the correction: it is HR's screen.
  const m = PAGE.match(/const CONFIGURES_THE_MODULE = new Set<Tab>\(\[([^\]]*)\]\)/)
  const hidden = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])
  for (const t of ['upload', 'publish', 'summary', 'fill', 'pip', 'reports']) {
    assert.ok(!hidden.includes(t), `${t} is hidden from HR, and it is theirs`)
  }
})

test('nothing is written to the roles module to achieve it', () => {
  // Adding screen rows for a role configures the module FOR that role, and
  // then every tab it has no row for disappears — a privilege removal
  // disguised as a grant, which is the trap migration 142 documents. The
  // rule therefore lives in the page, not in seeded permissions.
  assert.match(PAGE, /SCREEN_KEY: Partial<Record<Tab, string>> = \{\}/,
    'a tab has started borrowing another tab\'s screen key again')
})
