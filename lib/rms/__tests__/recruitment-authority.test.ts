// lib/rms/__tests__/recruitment-authority.test.ts — who may see which Recruitment tab.
//
// WHY THIS FILE EXISTS
//
// Recruitment has eleven tabs and three places that must agree about them:
//
//   1. app/dashboard/recruitment/page.tsx   the TABS array the page renders
//   2. lib/rms/screens.ts                   the catalogue the admin matrix offers
//   3. migration 123_role_screen_access     the seeded role → tab rows
//
// Drift between any two is silent and it fails OPEN. A tab the page renders but
// the catalogue does not list cannot be restricted by an admin at all, because
// canSeeScreen() returns true for any module with no rows — the deliberate floor
// that stops a half-seeded permission table locking the HR team out. So a
// missing catalogue entry does not hide a tab; it makes it permanently visible.
//
// resolve.test.ts covers module-level access (canSee/canEdit/canManage) and had
// no canSeeScreen coverage at all when this was written. This is the sub-module
// half, and it drives the real resolveGrant() rather than hand-assembling a
// Grant, so it tests the code that ships rather than a restatement of it.
//
// NOTE ON SCOPE. This asserts VISIBILITY, which is not enforcement. Hiding a tab
// stops nobody from calling the API by hand — see lib/api-auth.ts, which says so
// in its own header. Route guards are a separate concern and are not tested here.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveGrant, canSeeScreen, SUPER_ADMIN_CODES, type RoleRef } from '../resolve.ts'
import { SCREEN_MODULES } from '../screens.ts'

// ── The three sources, read rather than restated ─────────────────────────────
const PAGE = readFileSync('app/dashboard/recruitment/page.tsx', 'utf8')
const afterTabs = PAGE.slice(PAGE.indexOf('const TABS = ['))
const TAB_KEYS = [...afterTabs.slice(0, afterTabs.indexOf(']')).matchAll(/k:'([a-z]+)'/g)].map(m => m[1])

const CATALOGUE = SCREEN_MODULES.find(m => m.moduleKey === 'recruitment')!
const CATALOGUE_KEYS = CATALOGUE.screens.map(s => s.key)

const SQL = readFileSync('supabase/migrations/123_role_screen_access.sql', 'utf8')
const SEEDED = [...SQL.matchAll(/\('([A-Z0-9_]+)','recruitment\.([a-z]+)'\)/g)]
  .map(m => ({ role: m[1], key: m[2] }))

const role = (id: string, code: string): RoleRef => ({ id, role_code: code, role_name: code })

/** One role, carrying exactly the screen rows migration 123 seeds for it. */
function grantForRole(code: string) {
  const r = role(`r-${code}`, code)
  return resolveGrant({
    employeeId: 'e1',
    roles: [r],
    permissions: [{ role_id: r.id, module: 'Recruitment', access_level: 'VIEW' as const }],
    approvals: [],
    screens: SEEDED.filter(s => s.role === code)
      .map(s => ({ role_id: r.id, screen_key: `recruitment.${s.key}`, can_view: true })),
    enforced: true,
  })
}

const visibleFor = (code: string) =>
  TAB_KEYS.filter(k => canSeeScreen(grantForRole(code), `recruitment.${k}`))

// ── The parse itself, guarded ────────────────────────────────────────────────
// Every assertion below is worthless if the regexes silently matched nothing.

test('all three sources were actually parsed', () => {
  // Twelve since Offer Letter landed beside Send Offers: the read-only view of
  // offers in flight stays with the recruiters, dispatch moved to the assigned
  // HR Manager's screen. These two counts are a tripwire for the regexes
  // silently matching nothing — they are not the access assertions, which are
  // the three "page, catalogue and migration agree" checks below and hold at
  // any size.
  assert.equal(TAB_KEYS.length, 12,
    `parsed ${TAB_KEYS.length} tab keys from page.tsx, expected 12 — the parse broke, not the tabs`)
  assert.ok(TAB_KEYS.includes('hrhead') && TAB_KEYS.includes('negotiation'),
    `parsed keys look wrong: ${TAB_KEYS.join(',')}`)
  assert.equal(CATALOGUE_KEYS.length, 12, 'the recruitment catalogue should list twelve screens')
  assert.ok(SEEDED.length >= 15, `parsed ${SEEDED.length} seeded rows from migration 123 — the parse broke`)
})

// ── Drift, in all three directions ───────────────────────────────────────────

describe('the page, the catalogue and the migration agree', () => {
  test('every tab the page renders can be configured by an admin', () => {
    for (const k of TAB_KEYS) {
      assert.ok(CATALOGUE_KEYS.includes(k),
        `page.tsx renders recruitment.${k} but lib/rms/screens.ts does not list it — ` +
        'it can never be restricted, because an unlisted screen leaves the module unconfigured')
    }
  })

  test('the catalogue offers no tab the page does not render', () => {
    for (const k of CATALOGUE_KEYS) {
      assert.ok(TAB_KEYS.includes(k),
        `the admin matrix offers recruitment.${k}, which the page does not render — ` +
        'an admin would be toggling something invisible')
    }
  })

  test('every screen_key the migration seeds is a real screen', () => {
    for (const s of SEEDED) {
      assert.ok(CATALOGUE_KEYS.includes(s.key),
        `migration 123 seeds ${s.role} → recruitment.${s.key}, which is not in the catalogue`)
    }
  })
})

// ── The seeded matrix, through the real resolver ─────────────────────────────

describe('the seeded visibility matrix', () => {
  test('a recruiter sees every tab EXCEPT the HR-Head console', () => {
    const v = visibleFor('RECRUITER')
    assert.ok(!v.includes('hrhead'),
      'a recruiter reached the HR Head console — that is the approval authority, not theirs')
    for (const k of ['dashboard', 'mrf', 'screening', 'pipeline', 'negotiation',
                     'offerapproval', 'sendoffer', 'offers', 'preonboarding', 'jobstatus']) {
      assert.ok(v.includes(k), `a recruiter should see recruitment.${k}`)
    }
  })

  test('the reporting-manager roles raise MRFs and nothing else', () => {
    for (const code of ['L1_MANAGER', 'L2_MANAGER', 'HOD']) {
      assert.deepEqual(visibleFor(code), ['mrf'],
        `${code} should see only the MRF tab — their interview feedback happens in ESS`)
    }
  })

  test('CFO and MD get the dashboard only', () => {
    for (const code of ['CFO', 'MD']) {
      assert.deepEqual(visibleFor(code), ['dashboard'],
        `${code} is a reporting view, not a hiring seat`)
    }
  })

  test('a role with no screen rows is not restricted — the documented floor', () => {
    // HR Head / HR Manager are deliberately left unconfigured by migration 123.
    assert.equal(SEEDED.filter(s => s.role === 'HR_HEAD').length, 0,
      'HR_HEAD is expected to have no seeded screen rows')
    assert.deepEqual(visibleFor('HR_HEAD'), TAB_KEYS,
      'an unconfigured role must see every tab, or a half-seeded table locks people out')
  })
})

// ── The rules canSeeScreen itself encodes ────────────────────────────────────

describe('the screen gate', () => {
  test('a super admin is never restricted, even when every screen denies', () => {
    for (const code of SUPER_ADMIN_CODES) {
      const g = resolveGrant({
        employeeId: 'e1', roles: [role('r-sup', code)], permissions: [], approvals: [],
        screens: TAB_KEYS.map(k => ({ role_id: 'r-sup', screen_key: `recruitment.${k}`, can_view: false })),
        enforced: true,
      })
      for (const k of TAB_KEYS) {
        assert.equal(canSeeScreen(g, `recruitment.${k}`), true, `${code} must not be restricted`)
      }
    }
  })

  test('can_view false is a denial, not merely an absent row', () => {
    const g = resolveGrant({
      employeeId: 'e1', roles: [role('r-x', 'RECRUITER')], permissions: [], approvals: [],
      screens: [{ role_id: 'r-x', screen_key: 'recruitment.mrf', can_view: false }],
      enforced: true,
    })
    // The row still CONFIGURES the module, which is what makes the denial bite.
    assert.equal(g.screenConfigured['recruitment'], true)
    assert.equal(canSeeScreen(g, 'recruitment.mrf'), false)
  })

  test('a screen row from a role the person does not hold is ignored entirely', () => {
    const g = resolveGrant({
      employeeId: 'e1', roles: [role('r-mine', 'RECRUITER')], permissions: [], approvals: [],
      screens: [{ role_id: 'r-someone-else', screen_key: 'recruitment.hrhead', can_view: true }],
      enforced: true,
    })
    assert.equal(g.screenConfigured['recruitment'] ?? false, false,
      'another role\'s row must not configure this person\'s module')
    assert.equal(g.screenAllow['recruitment.hrhead'] ?? false, false,
      'another role\'s row must not grant this person a tab')
  })
})

// ── The page's own wiring, which the resolver cannot enforce ─────────────────
//
// These read the source. If a refactor renames something the assertion fails and
// asks a human to re-check the gate, which is the point — the alternative is a
// gate that quietly stops being applied.

describe('page.tsx applies the gate it computes', () => {
  test('the HR Head tab carries a second gate, independent of screens', () => {
    assert.ok(PAGE.includes("t.k !== 'hrhead' || isHrHead"),
      'the hrhead rail entry must be gated by isHrHead as well as by canSeeScreen')
    assert.ok(PAGE.includes("tab==='hrhead' && isHrHead &&"),
      'the hrhead tab BODY must be gated too — gating only the rail entry leaves it reachable by state')
  })

  test('isHrHead is derived from the grant, never from a screen row', () => {
    assert.ok(PAGE.includes('const isHrHead = grant.legacy || grant.isSuperAdmin ||'),
      'the isHrHead derivation changed — re-check who reaches the HR Head console')
    assert.ok(PAGE.includes("r.role_code === 'HR_HEAD'"),
      'isHrHead should still key off the HR_HEAD role code')
  })

  test('the rail is built from the same filter that decides visibility', () => {
    assert.ok(PAGE.includes('const railTabs: RailTab[] = visibleTabs.map'),
      'the rail must be built from visibleTabs — building it from TABS would render hidden tabs')
  })

  test('a tab the role cannot see cannot stay selected', () => {
    assert.ok(PAGE.includes('if (visibleTabs.length && !visibleTabs.some(t => t.k === tab)) setTab(visibleTabs[0].k'),
      'without the fallback, a role landing on a tab it may not see would keep it open')
  })
})
