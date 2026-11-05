// What the HR Head may do, read from the policy rather than from the code.
//
// Requested: whether the HR Head can finalise, override the HOD's rating,
// and the rest, should be flexible and changeable from admin configuration.
//
// ── THE THREE RULES ──────────────────────────────────────────────────────
//
// 1. THE ROLE COMES FIRST, THE POLICY ONLY NARROWS. A setting answers "may
//    the HR Head", never "who may" — switching one on must not hand an RM a
//    power they never had.
//
// 2. EVERYTHING DEFAULTS TO TODAY'S BEHAVIOUR. A missing, unreadable or
//    pre-217 policy must leave the module working exactly as it does now.
//    Failing closed sounds safer and would stop a cycle the moment a row
//    could not be read, hitting the people with no way to fix it.
//
// 3. SWITCHING A POWER OFF PREVENTS NEW USE AND NOTHING ELSE. Settled
//    ratings stay settled. The audit trail keeps saying what happened.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { authorityOf, whyNot, authorityFromRow,
         type AuthorityPolicy } from '../authority.ts'
import type { Role } from '../hierarchy.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/217_pms_hr_head_authority.sql')

const ALL_ON: AuthorityPolicy = {
  hrHeadFinalRating: true, hrHeadCanOverride: true,
  hrHeadCanDirect: true, ratingUploadBy: 'HR_ANY',
}
const EVERY_ROLE: Role[] = ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR_MGR',
                            'HR_HEAD', 'ADMIN']

// ── the defaults are today's behaviour ───────────────────────────────────

test('a missing policy leaves everything as it is today', () => {
  // THE RULE THAT MATTERS ON DEPLOY. 217 defaults every column to current
  // behaviour, and the engine has to agree — otherwise applying a
  // permissions migration silently removes a power mid-cycle.
  for (const p of [null, undefined, {}]) {
    const a = authorityOf('HR_HEAD', p as AuthorityPolicy)
    assert.deepEqual(a, { settle: true, override: true, direct: true, upload: true },
      'an unconfigured policy changed what the HR Head can do')
  }
})

test('a pre-217 policy row reads as today’s behaviour', () => {
  // The columns simply are not there, so they arrive undefined.
  const p = authorityFromRow({ hr_head_final_rating: true })
  assert.equal(p.hrHeadCanOverride, undefined)
  assert.equal(p.hrHeadCanDirect, undefined)
  assert.deepEqual(authorityOf('HR_HEAD', p),
    { settle: true, override: true, direct: true, upload: true })
})

// ── the role comes first ─────────────────────────────────────────────────

test('a policy cannot hand the HR Head’s powers to anybody else', () => {
  // Switching hr_head_can_direct on does not let an RM build an appraisal
  // outside the chain: the question that setting answers is "may the HR
  // Head", not "who may".
  for (const role of EVERY_ROLE.filter(r => r !== 'HR_HEAD')) {
    const a = authorityOf(role, ALL_ON)
    assert.equal(a.settle, false, `${role} can settle the final rating`)
    assert.equal(a.override, false, `${role} can override the chain`)
    assert.equal(a.direct, false, `${role} can build an appraisal outside the chain`)
  }
})

test('the upload is the one power that was never the HR Head’s alone', () => {
  // HR Manager and Admin have always been able to commit one.
  assert.equal(authorityOf('HR_MGR', ALL_ON).upload, true)
  assert.equal(authorityOf('ADMIN', ALL_ON).upload, true)
  assert.equal(authorityOf('HOD', ALL_ON).upload, false)
  assert.equal(authorityOf('RM_L1', ALL_ON).upload, false)
})

// ── each switch ──────────────────────────────────────────────────────────

test('override can be taken away without taking away settling', () => {
  // The distinction the request drew, and the one the old code could not
  // make: keep the step, remove the power to change the number.
  const a = authorityOf('HR_HEAD', { ...ALL_ON, hrHeadCanOverride: false })
  assert.equal(a.settle, true, 'removing the override removed the settlement too')
  assert.equal(a.override, false)
})

test('no settlement means no override either', () => {
  // There is nothing to override if the HR Head is not settling at all.
  const a = authorityOf('HR_HEAD', { ...ALL_ON, hrHeadFinalRating: false })
  assert.equal(a.settle, false)
  assert.equal(a.override, false, 'an override survived the settlement being off')
})

test('the direct appraisal has its own switch', () => {
  const a = authorityOf('HR_HEAD', { ...ALL_ON, hrHeadCanDirect: false })
  assert.equal(a.direct, false)
  assert.equal(a.settle, true, 'switching off the direct appraisal took settling with it')
})

test('the upload narrows to the HR Head, or closes entirely', () => {
  const headOnly: AuthorityPolicy = { ...ALL_ON, ratingUploadBy: 'HR_HEAD' }
  assert.equal(authorityOf('HR_HEAD', headOnly).upload, true)
  assert.equal(authorityOf('HR_MGR', headOnly).upload, false)
  assert.equal(authorityOf('ADMIN', headOnly).upload, false)

  const closed: AuthorityPolicy = { ...ALL_ON, ratingUploadBy: 'NOBODY' }
  for (const role of EVERY_ROLE) {
    assert.equal(authorityOf(role, closed).upload, false, `${role} can still upload`)
  }
})

test('an unrecognised upload mode falls back to today’s behaviour', () => {
  const p = authorityFromRow({ rating_upload_by: 'SOMETHING_NEW' })
  assert.equal(p.ratingUploadBy, null)
  assert.equal(authorityOf('HR_MGR', p).upload, true)
})

// ── the refusals explain themselves ──────────────────────────────────────

test('"you are not the HR Head" and "the policy says no" are different', () => {
  // They wear the same disabled button otherwise, and send somebody to
  // completely different places — only one is worth asking an
  // administrator about.
  const notHead = whyNot('direct', 'HR_MGR', ALL_ON)
  assert.match(notHead!, /Only the HR Head/)

  const policySaysNo = whyNot('direct', 'HR_HEAD', { ...ALL_ON, hrHeadCanDirect: false })
  assert.match(policySaysNo!, /switched off for this policy/)
  assert.match(policySaysNo!, /administrator/,
    'the refusal does not say who could change it')
  assert.notEqual(notHead, policySaysNo)
})

test('a permitted power has nothing to explain', () => {
  for (const k of ['settle', 'override', 'direct', 'upload'] as const) {
    assert.equal(whyNot(k, 'HR_HEAD', ALL_ON), null, `${k} refused when allowed`)
  }
})

test('the override refusal tells them what they CAN do', () => {
  const s = whyNot('override', 'HR_HEAD', { ...ALL_ON, hrHeadCanOverride: false })
  assert.match(s!, /settle the rating but not change it/)
  assert.match(s!, /Keep the chain/, 'the refusal offers no way forward')
})

test('each upload refusal names its own reason', () => {
  assert.match(whyNot('upload', 'HR_MGR', { ratingUploadBy: 'NOBODY' })!,
    /switched off for this policy/)
  assert.match(whyNot('upload', 'HR_MGR', { ratingUploadBy: 'HR_HEAD' })!,
    /Only the HR Head/)
  assert.match(whyNot('upload', 'HOD', { ratingUploadBy: 'HR_ANY' })!,
    /HR Manager, HR Head or Admin/)
})

// ── reading the row ──────────────────────────────────────────────────────

test('only a real false is false', () => {
  // A column absent from the SELECT arrives undefined, which must read as
  // "unconfigured" and not as "switched off".
  assert.equal(authorityFromRow({ hr_head_can_direct: false }).hrHeadCanDirect, false)
  assert.equal(authorityFromRow({}).hrHeadCanDirect, undefined)
  assert.equal(authorityFromRow(null).hrHeadCanDirect, undefined)
  assert.equal(authorityOf('HR_HEAD', authorityFromRow({})).direct, true)
  assert.equal(authorityOf('HR_HEAD', authorityFromRow({ hr_head_can_direct: false })).direct,
    false)
})

// ── 217 ──────────────────────────────────────────────────────────────────

test('217 defaults every switch to current behaviour', () => {
  assert.match(SQL, /hr_head_can_override boolean NOT NULL DEFAULT true/)
  assert.match(SQL, /hr_head_can_direct\s+boolean NOT NULL DEFAULT true/)
  assert.match(SQL, /rating_upload_by\s+text NOT NULL DEFAULT 'HR_ANY'/)
  assert.match(SQL, /CHECK \(rating_upload_by IN \('HR_HEAD','HR_ANY','NOBODY'\)\)/)
})

test('217 does not add a second settle switch', () => {
  // hr_head_final_rating already decides that. Two columns that can
  // contradict each other is a worse answer than one.
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  assert.ok(!/hr_head_can_settle/.test(body),
    'a second settlement switch was added beside hr_head_final_rating')
})

test('217 changes no data', () => {
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/^\s*UPDATE\s+\w/mi, /\bDELETE\s+FROM\b/i, /\bDROP\b/i, /\bINSERT\b/i]) {
    assert.ok(!f.test(body), `217 matches ${f}`)
  }
})

// ── the tab ──────────────────────────────────────────────────────────────

const EDITOR = read('components/pms/AdminEditor.tsx')
const ROUTE = read('app/api/pms/admin/route.ts')

test('the tab exists and is per policy', () => {
  assert.match(EDITOR, /\['authority','HR Head authority'\]/)
  assert.match(EDITOR, /<AuthorityPanel policies=\{snap\.policies\}/)
  const panel = EDITOR.slice(EDITOR.indexOf('function AuthorityPanel'),
                             EDITOR.indexOf('// ══ 3b. TRAINING CATALOGUE'))
  assert.ok(panel.length > 800, 'the panel is gone')
  // The policy selector names the COMPANY, because every policy here is
  // called "Standard Quarterly" and changing the wrong one is not a
  // mistake anybody notices.
  assert.match(panel, /\{coName\(p\.company_id\)\} — \{s\(p\.policy_name\)/)
})

test('an unset switch shows as ON, matching the engine', () => {
  // A policy written before 217 has no value in these columns and the
  // module behaves as it always did. A screen showing them off would
  // describe a state the code disagrees with.
  const panel = EDITOR.slice(EDITOR.indexOf('function AuthorityPanel'),
                             EDITOR.indexOf('// ══ 3b. TRAINING CATALOGUE'))
  assert.match(panel, /const yes = \(k: string\) => draft\[k\] !== false/)
  assert.equal(authorityOf('HR_HEAD', {}).direct, true,
    'the engine and the screen disagree about an unset switch')
})

test('the override only appears when settling is on', () => {
  // There is nothing to override if the HR Head is not settling at all,
  // and offering the switch would imply otherwise.
  const panel = EDITOR.slice(EDITOR.indexOf('function AuthorityPanel'),
                             EDITOR.indexOf('// ══ 3b. TRAINING CATALOGUE'))
  assert.match(panel, /\{yes\('hr_head_final_rating'\) && \(\s*\n?\s*<Toggle col="hr_head_can_override"/)
})

test('every switch the tab writes is allowlisted on the route', () => {
  // A policy column is inert until the route names it — the "my
  // configuration changes do not take effect" bug this module has had
  // once already.
  const panel = EDITOR.slice(EDITOR.indexOf('function AuthorityPanel'),
                             EDITOR.indexOf('// ══ 3b. TRAINING CATALOGUE'))
  const written = [...panel.matchAll(/(?:col="|set\(')([a-z_]+)/g)].map(m => m[1])
  assert.ok(written.length >= 4, 'no columns were found, so this proves nothing')
  // Comments stripped before reading the allowlist: an apostrophe in prose
  // opens a bogus string and swallows the entries after it. That is
  // exactly how this check first reported two listed columns as missing.
  const a = ROUTE.indexOf('const POLICY_COLS = [')
  const body = ROUTE.slice(a, ROUTE.indexOf('] as const', a))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const allowed = [...body.matchAll(/'([^']+)'/g)].map(m => m[1])
  for (const col of new Set(written)) {
    assert.ok(allowed.includes(col), `${col} is written by the tab but not allowlisted`)
  }
})

test('the screen says the HR Head cannot reach it', () => {
  // The whole point of putting it behind admin: a person who can grant
  // themselves a power is not limited by it.
  const panel = EDITOR.slice(EDITOR.indexOf('function AuthorityPanel'),
                             EDITOR.indexOf('// ══ 3b. TRAINING CATALOGUE'))
  const flat = panel.replace(/\s+/g, ' ')
  assert.match(flat, /not visible to the HR Head/)
  assert.match(flat, /A power somebody can grant themselves is not a limit on them/)
})
