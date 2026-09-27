// lib/idcard/authz.ts — who may download somebody else's ID card, and whose.
//
// Pure. No React, no Supabase, no request object — so the thing that decides
// whether a recruiter can pull 398 people's emergency contacts is testable, and
// tested, rather than inferred from reading a route.
//
// WHY THIS IS NOT requireModule('Employees', 'VIEW')
//
// Two reasons, and both of them are the whole point of the file.
//
// 1. The module is too wide. role_permissions grants ('RECRUITER','Employees',
//    'VIEW'), ('FINANCE_EXECUTIVE','Employees','VIEW') and ('ADMIN_COMPANY',
//    'Employees','VIEW'). A module-level gate would therefore let a recruiter
//    and a finance executive download every card in the company — each one
//    carrying a photograph, a blood group and a family member's mobile number.
//    Reading the employee master is not the same permission as exporting
//    identity documents from it.
//
// 2. hasLevel() opens when enforcement is off. Every helper in lib/rms/resolve
//    begins `if (!g.enforced) return true`, and rms_config.enforce_module_access
//    is `not null default false` — seeded false, still false. So requireModule
//    currently answers "are you signed in", not "are you allowed". Nothing here
//    consults `enforced`: this feature is restricted from the day it ships, or
//    it is not restricted at all.
//
// Scope is a separate question from permission, deliberately. Branch HR holds
// the same ID-card permission as an HR Manager; what differs is how far it
// reaches. Conflating the two is how "limit them to their branch" turns into a
// second, weaker permission that somebody later grants by accident.

import type { Grant } from '@/lib/rms/resolve'

/** Roles that may export any card within their company reach.
 *
 *  HR_HEAD is included although the brief named only HR Manager, CHRO and
 *  Superadmin: the role matrix makes CHRO an exact mirror of HR_HEAD, and
 *  granting one while refusing the other would be an accident rather than a
 *  policy. HR_EXECUTIVE is deliberately NOT here — scope DEPT, salary
 *  visibility NONE, the junior HR bench (~31 people). Add the string if that is
 *  wrong; the point is that it is a decision someone made, not a default. */
export const ID_CARD_ANY_ROLES = [
  'ADMIN_SUPER', 'SUPER_ADMIN',
  'HR_MANAGER', 'HR_HEAD', 'CHRO',
] as const

/** Roles that may export, but only within one location. */
export const ID_CARD_BRANCH_ROLES = ['BRANCH_HR'] as const

const has = (grant: Grant, codes: readonly string[]) =>
  grant.roles.some(r => codes.includes(String(r.role_code || '').toUpperCase()))

/**
 * May this caller export ID cards at all?
 *
 * Note what is absent: no `enforced` check, and no module-level fallback. A
 * caller either holds one of the named roles or they do not.
 *
 * The legacy shared dashboard login is refused. It is a single shared
 * credential attached to no employee record, so a download it makes cannot be
 * attributed to a person — and an audit trail that cannot name anybody is not
 * an audit trail. Those users sign in through ESS for everything else already.
 */
export function canExportIdCards(grant: Grant): boolean {
  if (!grant.resolved) return false   // "we could not find out" is not "yes"
  if (grant.legacy) return false
  return has(grant, ID_CARD_ANY_ROLES) || has(grant, ID_CARD_BRANCH_ROLES)
}

export type IdCardScope =
  /** Nothing. Also what an unresolvable branch produces — see below. */
  | { kind: 'none' }
  /** Every company. Super admin, or a role scoped ORG. */
  | { kind: 'all' }
  /** One company, every location in it. */
  | { kind: 'company'; companyId: string }
  /** Specific locations within one company. */
  | { kind: 'locations'; companyId: string | null; locationIds: string[] }

/**
 * How far this caller reaches.
 *
 * `assignedLocationIds` are the locations recorded against their BRANCH-scoped
 * role assignments (ess_user_roles.location_id, migration 131). `ownLocationId`
 * is where the caller themselves sits, used when no assignment names a
 * location — which is every existing assignment until somebody sets one, and
 * the reason the feature works before 131 is applied as well as after.
 *
 * FAILS CLOSED. A Branch HR whose branch cannot be determined — no assignment
 * location, and no location on their own employee row — gets `none`, not the
 * whole company. An unknown boundary is the one case where guessing wide is
 * indefensible: it would hand every card in the business to somebody the system
 * just admitted it cannot place.
 */
export function idCardScope(
  grant: Grant,
  assignedLocationIds: (string | null | undefined)[] = [],
  ownLocationId: string | null = null,
): IdCardScope {
  if (!canExportIdCards(grant)) return { kind: 'none' }

  // Super admin, or any role that legitimately reaches beyond one company.
  if (grant.isSuperAdmin || grant.crossCompany) {
    if (has(grant, ID_CARD_ANY_ROLES)) return { kind: 'all' }
  }

  if (has(grant, ID_CARD_ANY_ROLES)) {
    return grant.companyId
      ? { kind: 'company', companyId: grant.companyId }
      : { kind: 'all' }
  }

  // Branch HR. Assignment first, own desk second, nothing third.
  const ids = [...new Set(assignedLocationIds.filter((v): v is string => !!v))]
  if (ids.length) return { kind: 'locations', companyId: grant.companyId, locationIds: ids }
  if (ownLocationId) return { kind: 'locations', companyId: grant.companyId, locationIds: [ownLocationId] }
  return { kind: 'none' }
}

/** One employee row, as far as scope is concerned. */
export interface ScopedEmployee {
  company_id?: string | null
  location_id?: string | null
}

/**
 * Is this employee inside that scope?
 *
 * The server filters its query by the scope too — this is the second check, run
 * per row on the way out, so a filter that is wrong or forgotten cannot leak a
 * card. Cheap, and the failure it prevents is somebody else's identity document.
 */
export function scopeAllows(scope: IdCardScope, emp: ScopedEmployee): boolean {
  switch (scope.kind) {
    case 'none': return false
    case 'all': return true
    case 'company':
      return !!emp.company_id && emp.company_id === scope.companyId
    case 'locations':
      if (scope.companyId && emp.company_id && emp.company_id !== scope.companyId) return false
      return !!emp.location_id && scope.locationIds.includes(emp.location_id)
  }
}

/**
 * A card may only be exported while the credential is live.
 *
 * Migration 092's trg_employee_card_guard already revokes on leaving,
 * suspension or exit, so this reads the answer the database keeps rather than
 * re-deriving employment status here and drifting from it. "Downloads stop on
 * exit" is therefore enforced by the same row the gate reader trusts.
 */
export function cardIsExportable(state: string | null | undefined): boolean {
  return String(state || '').toLowerCase() === 'active'
}

/** The employment states that stop a download. Copied from migration 092's
 *  trg_employee_card_guard so the two cannot drift: if the database would
 *  revoke the credential for this state, the export refuses for it too. */
const LEFT = new Set(['separated', 'suspended', 'inactive', 'exited', 'resigned'])

export interface ExportSubject {
  employment_status?: string | null
  date_of_leaving?: string | null
}

/**
 * May this particular employee's card be exported? Null means yes.
 *
 * EMPLOYMENT STATUS IS THE RULE, not the credential. I nearly wrote this the
 * other way round — refuse unless id_card_credentials.state is 'active' — and
 * it would have refused almost everybody. Credentials are issued lazily, by
 * issueToken() when a person opens their digital card in ESS; an employee who
 * has never done that has no credential row at all. Gating on a row that
 * usually does not exist would have meant HR could download nobody, and the
 * tests would have passed because a fixture always has one.
 *
 * So: the status decides, and a credential blocks only when it exists and has
 * been revoked or suspended. The printed card carries no working gate code
 * anyway — the credential supplies the card number and validity date, not
 * permission.
 *
 * NEVER ISSUE A CREDENTIAL FROM AN EXPORT. It is tempting to call
 * issue_id_card() when a row is missing so the card can print a number, and
 * migration 103 spells out why that is destructive: issue_id_card(<anyone>)
 * ROTATES THAT EMPLOYEE'S SECRET and bumps card_version — which invalidates
 * the live QR they walk through the gate with. An HR download must never
 * change what an employee's phone is displaying. Read; do not issue. A missing
 * card number prints as blank, which is the correct outcome.
 */
export function exportRefusal(
  emp: ExportSubject,
  credentialState?: string | null,
): string | null {
  const status = String(emp.employment_status ?? '').toLowerCase().trim()
  if (LEFT.has(status)) return 'Downloads stop on exit — this employee has left.'

  if (emp.date_of_leaving) {
    const lwd = new Date(String(emp.date_of_leaving))
    if (!isNaN(lwd.getTime()) && lwd <= new Date()) {
      return 'Downloads stop on exit — the last working day has passed.'
    }
  }

  // Present but not active: revoked or suspended by HR, or by the 092 trigger.
  if (credentialState != null && credentialState !== '' && !cardIsExportable(credentialState)) {
    return `This card is ${String(credentialState).toLowerCase()}. Ask HR to reissue it.`
  }
  return null
}

/** What to tell somebody who is refused. Said plainly: a person denied access
 *  should learn whether they lack the permission or merely the reach. */
export function refusalFor(scope: IdCardScope): string {
  return scope.kind === 'none'
    ? 'ID card download is not part of your access.'
    : 'That employee is outside the locations your role covers.'
}
