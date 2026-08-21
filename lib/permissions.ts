// lib/permissions.ts — what a person may see, in one place.
//
// The dashboard used to ask one question at the door: "is there a Supabase session?"
// One shared login answered yes for everybody, so the question was really "is anyone
// signed in", not "who is this and what may they touch".
//
// Now the door asks the second question. Everything needed to answer it — the module
// list, which route belongs to which module, and how several roles combine into one
// answer — lives here so the sidebar, the page guards and the API routes cannot drift
// apart by each deciding it slightly differently.
//
// Nothing here reads the database. Resolution is a pure function over rows that were
// already fetched, so it runs unchanged on the server (service key, in the API route)
// and in tests.

// ── Access levels ───────────────────────────────────────────────────────────
// Stored in role_permissions.access_level (migration 028's CHECK constraint).
export type AccessLevel = 'NONE' | 'VIEW' | 'EDIT' | 'FULL'

const RANK: Record<AccessLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2, FULL: 3 }

/** Is `have` at least `need`? The only comparison anywhere — levels are ordered, and
 *  comparing them by string equality is how "EDIT can't open a VIEW screen" bugs start. */
export function atLeast(have: AccessLevel | undefined, need: AccessLevel): boolean {
  return RANK[have || 'NONE'] >= RANK[need]
}

/** The higher of two levels. A person holding several roles gets the widest of them. */
export function higher(a: AccessLevel, b: AccessLevel): AccessLevel {
  return RANK[a] >= RANK[b] ? a : b
}

// ── The modules ─────────────────────────────────────────────────────────────
// One entry per thing a role can be granted. Deliberately named after what the user
// sees in the sidebar, not after a table or a route, because these strings are shown
// to HR in the permission matrix.
export const MODULES = [
  'Employees',
  'Recruitment',
  'Onboarding',
  'Attendance',
  'Attendance Reports',
  'Leave Config',
  'Holidays',
  'Payroll',
  'Finance',
  'Flexi Claims',
  'Travel Claims',
  'Loans',
  'Compliance',
  'HR Letters',
  'Policies',
  'Admin Setup',
  'Company Profile',
  'Reports',
  'Database Export',
  'Transfer',
  'Bulk Upload',
  'ESS & Roles',
  'Support',
  'Ezer AI',
] as const

export type Module = (typeof MODULES)[number]

// ── Route → module ──────────────────────────────────────────────────────────
// Every directory under app/dashboard appears here. Six of them are not in the sidebar
// at all (ess-credentials, roles, flexi-invoices, holidays, investment-proofs,
// statutory-leave) — hiding a sidebar entry would never have gated those, and
// ess-credentials can reset every employee's password, so they are mapped explicitly.
//
// Several routes share a module on purpose: flexi-policy and flexi-invoices are the
// configuration and the output of the same thing HR calls "Flexi Claims", and nobody
// should have to grant three permissions to do one job.
export const ROUTE_MODULE: Record<string, Module> = {
  '/dashboard/recruitment':        'Recruitment',
  '/dashboard/onboarding':         'Onboarding',
  '/dashboard/employees':          'Employees',
  '/dashboard/bulk-upload':        'Bulk Upload',
  '/dashboard/transfer':           'Transfer',
  '/dashboard/attendance':         'Attendance',
  '/dashboard/attendance-reports': 'Attendance Reports',
  '/dashboard/leave-upload':       'Leave Config',
  '/dashboard/statutory-leave':    'Leave Config',
  '/dashboard/holidays':           'Holidays',
  '/dashboard/payroll':            'Payroll',
  '/dashboard/investment-proofs':  'Payroll',
  '/dashboard/finance':            'Finance',
  '/dashboard/flexi-claims':       'Flexi Claims',
  '/dashboard/flexi-policy':       'Flexi Claims',
  '/dashboard/flexi-invoices':     'Flexi Claims',
  '/dashboard/travel-claims':      'Travel Claims',
  '/dashboard/loans':              'Loans',
  '/dashboard/compliance':         'Compliance',
  '/dashboard/letters':            'HR Letters',
  '/dashboard/policies':           'Policies',
  '/dashboard/admin':              'Admin Setup',
  '/dashboard/company-profile':    'Company Profile',
  '/dashboard/reports':            'Reports',
  '/dashboard/db-export':          'Database Export',
  '/dashboard/ess':                'ESS & Roles',
  '/dashboard/ess-credentials':    'ESS & Roles',
  '/dashboard/roles':              'ESS & Roles',
  '/dashboard/support':            'Support',
  '/dashboard/ai':                 'Ezer AI',
}

/** The module a path belongs to, or null for the dashboard home, which everyone who
 *  can reach the dashboard at all is allowed to see. Sub-paths resolve to their
 *  section, so /dashboard/payroll/run is still the Payroll module. */
export function moduleForPath(path: string): Module | null {
  if (!path || path === '/dashboard' || path === '/dashboard/') return null
  const hit = Object.keys(ROUTE_MODULE)
    .filter(r => path === r || path.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0]      // longest match wins
  return hit ? ROUTE_MODULE[hit] : null
}

// ── Scope and salary visibility ─────────────────────────────────────────────
// One vocabulary for both, widest first. Migration 055 rewrites the old spellings
// (ORG, DEPT, ALL, OWN) into these, so nothing in the app has to translate at read time.
export const SCOPE_LADDER = ['GROUP', 'COMPANY', 'BRANCH', 'DEPARTMENT', 'TEAM', 'SELF'] as const
export type Scope = (typeof SCOPE_LADDER)[number]
export type SalaryVisibility = Scope | 'NONE'

/** Widest of two scopes. Someone who is both an L1 manager and a HOD sees their
 *  department, not just their team. */
export function widerScope<T extends string>(a: T, b: T, ladder: readonly string[]): T {
  const ia = ladder.indexOf(a), ib = ladder.indexOf(b)
  if (ia < 0) return b
  if (ib < 0) return a
  return ia <= ib ? a : b                        // lower index = wider
}

// ── The shape a resolved person has ─────────────────────────────────────────
export interface RoleRef {
  id: string
  role_code: string
  role_name: string
  scope: Scope | string
  salary_visibility: SalaryVisibility | string
}

export interface ApprovalRight {
  approval_type: string
  can_approve: boolean
  can_reject: boolean
  can_initiate: boolean
}

export interface Grant {
  employeeId: string | null
  name: string | null
  empCode: string | null
  roles: RoleRef[]
  modules: Record<string, AccessLevel>
  approvals: ApprovalRight[]
  scope: Scope | 'SELF'
  salaryVisibility: SalaryVisibility
  isSuperAdmin: boolean
  /** False while the rollout is still seeding roles — see rms_config.enforce_module_access.
   *  When false the sidebar shows everything, so nobody is locked out mid-migration. */
  enforced: boolean
  /** True when this person came in on the legacy Supabase login rather than an ESS
   *  session. Temporary — see the bridge note in app/api/rms/me/route.ts. */
  legacy: boolean
  /** False only when the answer could not be fetched at all — a timed-out request, say.
   *  "We could not find out" is not the same as "they hold nothing", and treating them
   *  the same is how a network blip throws a working admin out of the dashboard. */
  resolved: boolean
}

export const SUPER_ADMIN = 'SUPER_ADMIN'

/** An empty grant. Used for "not signed in" and as the base every resolution builds on,
 *  so a missing row can never accidentally read as access. */
export function emptyGrant(): Grant {
  return {
    employeeId: null, name: null, empCode: null,
    roles: [], modules: {}, approvals: [],
    scope: 'SELF', salaryVisibility: 'NONE',
    isSuperAdmin: false, enforced: true, legacy: false, resolved: true,
  }
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface ResolveInput {
  employeeId: string | null
  name?: string | null
  empCode?: string | null
  roles: RoleRef[]
  /** role_permissions rows for the roles held. */
  permissions: { role_id: string; module: string; access_level: AccessLevel }[]
  /** role_approval_rights rows for the roles held. */
  approvals: (ApprovalRight & { role_id: string })[]
  enforced?: boolean
  legacy?: boolean
}

/** Combine every role a person holds into one answer.
 *
 *  Three rules, all from the decisions doc (C1):
 *    module access     — the highest level any of their roles grants
 *    salary visibility — the widest any of their roles grants
 *    approval rights   — the union; a right from any role is usable
 *
 *  SUPER_ADMIN is a floor rather than a row: it resolves to FULL on every module even
 *  if role_permissions is empty or wrong. Without that, one bad edit to the matrix
 *  would leave nobody able to open the screen that fixes the matrix. */
export function resolveGrant(input: ResolveInput): Grant {
  const g = emptyGrant()
  g.employeeId = input.employeeId
  g.name = input.name ?? null
  g.empCode = input.empCode ?? null
  g.roles = input.roles
  g.enforced = input.enforced !== false
  g.legacy = !!input.legacy
  g.isSuperAdmin = input.roles.some(r => r.role_code === SUPER_ADMIN)

  if (g.isSuperAdmin) {
    for (const m of MODULES) g.modules[m] = 'FULL'
    g.scope = 'GROUP'
    g.salaryVisibility = 'GROUP'
  } else {
    const held = new Set(input.roles.map(r => r.id))
    for (const p of input.permissions) {
      if (!held.has(p.role_id)) continue
      g.modules[p.module] = higher(g.modules[p.module] || 'NONE', p.access_level || 'NONE')
    }
    for (const r of input.roles) {
      g.scope = widerScope(g.scope, (r.scope as Scope) || 'SELF', SCOPE_LADDER)
      if (r.salary_visibility && r.salary_visibility !== 'NONE') {
        g.salaryVisibility = g.salaryVisibility === 'NONE'
          ? (r.salary_visibility as SalaryVisibility)
          : widerScope(g.salaryVisibility as Scope, r.salary_visibility as Scope, SCOPE_LADDER)
      }
    }
  }

  // Union of approval rights, keyed by type. can_* are OR-ed: if one role may reject
  // and another may only approve, the person may do both.
  const held = new Set(input.roles.map(r => r.id))
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

// ── Questions the UI asks ───────────────────────────────────────────────────

/** May this person see this module at all? While enforcement is off, yes — the sidebar
 *  behaves exactly as it did before roles existed, so a half-seeded matrix cannot lock
 *  the HR team out on the morning it ships. */
export function canSee(g: Grant, m: Module | null): boolean {
  if (!g.enforced) return true
  if (m === null) return true                    // dashboard home
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

/** Does this person belong in the admin dashboard at all? This is what decides whether
 *  the Admin button appears in ESS. Note it ignores `enforced` deliberately: the button
 *  should appear for people with real roles from day one, without waiting for the
 *  sidebar to start hiding things. */
export function hasAdminAccess(g: Grant): boolean {
  if (g.isSuperAdmin || g.legacy) return true
  return MODULES.some(m => atLeast(g.modules[m], 'VIEW'))
}

/** May this person act on this approval workflow? Approval power is separate from module
 *  access on purpose (decision B3) — a CFO can approve an MRF with only VIEW on
 *  Recruitment, because approving and administering are different jobs. */
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

/** The modules this person can reach, in sidebar order, for the "what they will see"
 *  preview on the role assignment screen. */
export function visibleModules(g: Grant): { module: Module; level: AccessLevel }[] {
  return MODULES
    .map(m => ({ module: m, level: (g.modules[m] || 'NONE') as AccessLevel }))
    .filter(x => x.level !== 'NONE')
}

/** Roles that may administer roles. Deliberately short, and deliberately checked rather
 *  than assumed: the screen that hands out permissions is itself permission-gated. */
export const ROLE_ADMIN_CODES = ['SUPER_ADMIN', 'HR_HEAD']

export function canAdministerRoles(g: Grant): boolean {
  if (g.isSuperAdmin || g.legacy) return true
  return g.roles.some(r => ROLE_ADMIN_CODES.includes(r.role_code))
}
