// lib/rms/resolve.ts — turning the roles a person holds into what they may open.
//
// Pure, and deliberately narrow: it reads functional roles and nothing else. Being
// somebody's L1 does not appear here at all, because managing people is not the same as
// being allowed into Payroll. The two live in different tables and meet only where a
// screen chooses to use both.
import { MODULES, atLeast, higher, type AccessLevel, type Module } from './modules.ts'
import { moduleKeyOf } from './screens.ts'

export interface RoleRef {
  id: string
  role_code: string
  role_name: string
  scope?: string | null
  salary_visibility?: string | null
}

export interface ApprovalRight {
  approval_type: string
  can_approve: boolean
  can_reject: boolean
  can_initiate: boolean
}

export interface Grant {
  employeeId: string | null
  empCode: string | null
  name: string | null
  /** The caller's own company. The scope gate forces every cross-employee read to this
   *  company_id unless the caller is a group-level (super-admin) role. Null for the legacy
   *  shared login, which has no employee row — treated as "no company gate", see server.ts. */
  companyId: string | null
  roles: RoleRef[]
  modules: Record<string, AccessLevel>
  /** Sub-module (tab) visibility. `screenAllow['recruitment.mrf'] === true` means at least
   *  one held role grants that tab. `screenConfigured['recruitment'] === true` means at
   *  least one held role has ANY screen row for that module — so the module's tabs are
   *  being restricted for this person. A module NOT in screenConfigured is left fully open,
   *  so nothing is hidden until an admin actually restricts it (see canSeeScreen). */
  screenAllow: Record<string, boolean>
  screenConfigured: Record<string, boolean>
  approvals: ApprovalRight[]
  isSuperAdmin: boolean
  /** True when a role lets the caller see beyond their own company (ORG scope /
   *  ADMIN_SUPER / ALL_ACCESS). When false, company data is forced to companyId. */
  crossCompany: boolean
  /** False while the roll-out is still assigning roles. When false the sidebar shows
   *  everything, exactly as it did before roles existed, so a half-seeded permission
   *  table cannot lock the HR team out on the morning it ships. */
  enforced: boolean
  /** True when the caller arrived on the legacy shared dashboard login rather than an
   *  ESS session. Temporary — see lib/rms/server.ts. */
  legacy: boolean
  /** False only when the answer could not be fetched — a timed-out request, say.
   *  "We could not find out" is not "they hold nothing", and treating the two the same
   *  is how a network blip throws a working user out of the dashboard. */
  resolved: boolean
}

/**
 * The company_id a caller's cross-employee reads must be pinned to — or null when they
 * may legitimately see every company.
 *
 * `requested` is an optional company the caller picked (a dashboard dropdown). A
 * cross-company caller (super admin / ORG-scoped) may narrow to it, or see all when it is
 * blank/'ALL'. Everyone else is forced to their own company and `requested` is ignored —
 * this is the single choke-point that stops '' / 'ALL' from leaking other companies.
 */
export function companyFilter(grant: Grant, requested?: string | null): string | null {
  // Cross-company callers, and callers whose own company is unknown (the legacy shared
  // login has no employee row), are not pinned — they may narrow to a requested company
  // or see all. Everyone else is forced to their own company.
  if (grant.crossCompany || !grant.companyId) {
    return requested && requested !== 'ALL' && requested !== '' ? requested : null
  }
  return grant.companyId
}

/** The companies a caller may choose in a dropdown. A cross-company caller sees all;
 *  everyone else sees only their own. Pure — safe on client and server. */
export function scopedCompanies<T extends { id: string }>(grant: Grant, all: T[]): T[] {
  if (grant.crossCompany || !grant.companyId) return all
  return all.filter(c => c.id === grant.companyId)
}

/** What a company selector should default to: '' (All) for a cross-company caller, else
 *  the caller's own company id. '' is only ever offered to cross-company callers. */
export function defaultCompanyId(grant: Grant): string {
  if (grant.crossCompany || !grant.companyId) return ''
  return grant.companyId
}

export const SUPER_ADMIN_CODES = ['ADMIN_SUPER', 'SUPER_ADMIN']
/** Roles allowed to hand out roles. Short on purpose: the screen that grants permissions
 *  is itself permission-gated. */
export const ROLE_ADMIN_CODES = [...SUPER_ADMIN_CODES, 'HR_HEAD', 'CHRO']

export function emptyGrant(): Grant {
  return {
    employeeId: null, empCode: null, name: null, companyId: null,
    roles: [], modules: {}, screenAllow: {}, screenConfigured: {}, approvals: [],
    isSuperAdmin: false, crossCompany: false, enforced: true, legacy: false, resolved: true,
  }
}

export interface ResolveInput {
  employeeId: string | null
  empCode?: string | null
  name?: string | null
  companyId?: string | null
  roles: RoleRef[]
  permissions: { role_id: string; module: string; access_level: AccessLevel }[]
  approvals: (ApprovalRight & { role_id: string })[]
  screens?: { role_id: string; screen_key: string; can_view: boolean }[]
  enforced?: boolean
  legacy?: boolean
}

/**
 * Combine every role a person holds into one answer.
 *
 *   module access   the highest level any of their roles grants
 *   approvals       the union — a right from any role is usable
 *
 * A super-admin role is a floor rather than a row: it resolves to FULL on every module
 * even when role_permissions is empty or wrong. Without that, one bad edit to the matrix
 * would leave nobody able to open the screen that repairs the matrix.
 */
export function resolveGrant(input: ResolveInput): Grant {
  const g = emptyGrant()
  g.employeeId = input.employeeId
  g.empCode = input.empCode ?? null
  g.name = input.name ?? null
  g.companyId = input.companyId ?? null
  g.roles = input.roles
  g.enforced = input.enforced !== false
  g.legacy = !!input.legacy
  g.isSuperAdmin = input.roles.some(r => SUPER_ADMIN_CODES.includes(r.role_code))
  // A caller reaches beyond their own company only via a super-admin role or a role
  // scoped ORG. Everyone else is pinned to companyId by the scope gate.
  g.crossCompany = g.isSuperAdmin ||
    input.roles.some(r => String(r.scope || '').toUpperCase() === 'ORG')

  const held = new Set(input.roles.map(r => r.id))

  if (g.isSuperAdmin) {
    for (const m of MODULES) g.modules[m] = 'FULL'
  } else {
    for (const p of input.permissions) {
      if (!held.has(p.role_id)) continue
      g.modules[p.module] = higher(g.modules[p.module] || 'NONE', (p.access_level || 'NONE') as AccessLevel)
    }
  }

  // Screen (sub-module tab) visibility, unioned across the person's roles. A module is
  // "configured" the moment ANY held role has a screen row for it — and only then are its
  // tabs restricted; otherwise every tab stays visible. Super admin is never restricted.
  for (const s of input.screens || []) {
    if (!held.has(s.role_id)) continue
    g.screenConfigured[moduleKeyOf(s.screen_key)] = true
    if (s.can_view) g.screenAllow[s.screen_key] = true
  }

  const byType = new Map<string, ApprovalRight>()
  for (const a of input.approvals) {
    if (!held.has(a.role_id)) continue
    const prev = byType.get(a.approval_type)
    byType.set(a.approval_type, {
      approval_type: a.approval_type,
      can_approve:  !!(prev?.can_approve  || a.can_approve),
      can_reject:   !!(prev?.can_reject   || a.can_reject),
      can_initiate: !!(prev?.can_initiate || a.can_initiate),
    })
  }
  g.approvals = [...byType.values()]

  return g
}

// ── The questions the UI and the API routes ask ─────────────────────────────

/** May this person see this module at all? While enforcement is off, yes — the sidebar
 *  behaves as it did before roles existed. */
export function canSee(g: Grant, m: Module | null): boolean {
  if (!g.enforced) return true
  if (m === null) return true                       // dashboard landing page
  return atLeast(g.modules[m], 'VIEW')
}

/** May this person see this sub-module tab? Reliability-first, default-VISIBLE:
 *   • super admin → yes, always.
 *   • the tab's module has no screen config for any of this person's roles → yes
 *     (nothing is hidden until an admin actually restricts that module for the role).
 *   • otherwise → only if a held role explicitly grants this tab.
 *
 * Deliberately NOT gated by the global `enforced` (module roll-out) flag. Screen
 * restrictions are opt-in per (role, module) — a module nobody configured is untouched —
 * so they are safe to honour immediately, without flipping app-wide module enforcement.
 * A page that passes an unknown/unregistered key is never wrongly hidden. */
export function canSeeScreen(g: Grant, screenKey: string): boolean {
  if (g.isSuperAdmin) return true
  const mk = moduleKeyOf(screenKey)
  if (!g.screenConfigured[mk]) return true
  return !!g.screenAllow[screenKey]
}

export function canEdit(g: Grant, m: Module): boolean {
  if (!g.enforced) return true
  return atLeast(g.modules[m], 'EDIT')
}

export function canManage(g: Grant, m: Module): boolean {
  if (!g.enforced) return true
  return atLeast(g.modules[m], 'FULL')
}

export function hasLevel(g: Grant, m: Module, need: AccessLevel): boolean {
  if (need === 'NONE') return true
  if (!g.enforced) return true
  return atLeast(g.modules[m], need)
}

/** Does this person belong in the admin dashboard at all? This is what decides whether
 *  the Admin button appears in ESS. It ignores `enforced` deliberately: the button
 *  should appear for people with real roles from the first day, without waiting for the
 *  sidebar to start hiding things. */
export function hasAdminAccess(g: Grant): boolean {
  if (g.isSuperAdmin || g.legacy) return true
  return MODULES.some(m => atLeast(g.modules[m], 'VIEW'))
}

/** Approval power is separate from module access on purpose. A CFO can approve a
 *  requisition holding only VIEW on Recruitment, because approving and administering are
 *  different jobs. */
export function canApprove(g: Grant, approvalType: string): boolean {
  if (g.isSuperAdmin) return true
  if (!g.enforced) return true
  return g.approvals.some(a => a.approval_type === approvalType && a.can_approve)
}

export function canReject(g: Grant, approvalType: string): boolean {
  if (g.isSuperAdmin) return true
  if (!g.enforced) return true
  return g.approvals.some(a => a.approval_type === approvalType && a.can_reject)
}

export function canAdministerRoles(g: Grant): boolean {
  if (g.isSuperAdmin || g.legacy) return true
  return g.roles.some(r => ROLE_ADMIN_CODES.includes(r.role_code))
}

/** The modules this person can reach, in sidebar order — used by the "what will they
 *  see" preview on the role assignment screen. */
export function visibleModules(g: Grant): { module: Module; level: AccessLevel }[] {
  return MODULES
    .map(m => ({ module: m, level: (g.modules[m] || 'NONE') as AccessLevel }))
    .filter(x => x.level !== 'NONE')
}
