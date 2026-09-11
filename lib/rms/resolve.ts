// lib/rms/resolve.ts — turning the roles a person holds into what they may open.
//
// Pure, and deliberately narrow: it reads functional roles and nothing else. Being
// somebody's L1 does not appear here at all, because managing people is not the same as
// being allowed into Payroll. The two live in different tables and meet only where a
// screen chooses to use both.
import { MODULES, atLeast, higher, type AccessLevel, type Module } from './modules.ts'

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
  roles: RoleRef[]
  modules: Record<string, AccessLevel>
  approvals: ApprovalRight[]
  isSuperAdmin: boolean
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

export const SUPER_ADMIN_CODES = ['ADMIN_SUPER', 'SUPER_ADMIN']
/** Roles allowed to hand out roles. Short on purpose: the screen that grants permissions
 *  is itself permission-gated. */
export const ROLE_ADMIN_CODES = [...SUPER_ADMIN_CODES, 'HR_HEAD', 'CHRO']

export function emptyGrant(): Grant {
  return {
    employeeId: null, empCode: null, name: null,
    roles: [], modules: {}, approvals: [],
    isSuperAdmin: false, enforced: true, legacy: false, resolved: true,
  }
}

export interface ResolveInput {
  employeeId: string | null
  empCode?: string | null
  name?: string | null
  roles: RoleRef[]
  permissions: { role_id: string; module: string; access_level: AccessLevel }[]
  approvals: (ApprovalRight & { role_id: string })[]
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
  g.roles = input.roles
  g.enforced = input.enforced !== false
  g.legacy = !!input.legacy
  g.isSuperAdmin = input.roles.some(r => SUPER_ADMIN_CODES.includes(r.role_code))

  const held = new Set(input.roles.map(r => r.id))

  if (g.isSuperAdmin) {
    for (const m of MODULES) g.modules[m] = 'FULL'
  } else {
    for (const p of input.permissions) {
      if (!held.has(p.role_id)) continue
      g.modules[p.module] = higher(g.modules[p.module] || 'NONE', (p.access_level || 'NONE') as AccessLevel)
    }
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
