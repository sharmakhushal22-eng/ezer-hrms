// lib/rms/modules.ts — the list of things a role can be granted, and which URL is which.
//
// Pure. No database, no React, no Supabase. The sidebar, the page guards and the API
// routes all answer from here, so they cannot drift apart by each deciding it slightly
// differently — and it can be unit-tested without a running app.

// ── Access levels ───────────────────────────────────────────────────────────
// Stored in role_permissions.access_level, whose CHECK constraint (migration 028)
// already restricts it to exactly these four.
export type AccessLevel = 'NONE' | 'VIEW' | 'EDIT' | 'FULL'

const RANK: Record<AccessLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2, FULL: 3 }

/** Is `have` at least `need`? Levels are ordered, and comparing them with `===` is how
 *  "EDIT cannot open a VIEW screen" bugs start. */
export function atLeast(have: AccessLevel | undefined | null, need: AccessLevel): boolean {
  return RANK[(have || 'NONE') as AccessLevel] >= RANK[need]
}

/** The wider of two levels. Somebody holding several roles gets the widest of them. */
export function higher(a: AccessLevel, b: AccessLevel): AccessLevel {
  return RANK[a] >= RANK[b] ? a : b
}

// ── The modules ─────────────────────────────────────────────────────────────
// Named after what a person sees in the sidebar rather than after a table or a route,
// because these strings are shown to HR in the permission matrix.
export const MODULES = [
  'Employees',
  'Recruitment',
  'Onboarding',
  'Performance',
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
  // ESS-side read-only tabs (071). They live in the same role_permissions table
  // as the dashboard modules so one grant decides both surfaces — an HR Head who
  // can open Company Dashboard in ESS is the same row that lets her in here.
  'Company Dashboard',
  'ESS Reports',
] as const

export type Module = (typeof MODULES)[number]

// ── Route → module ──────────────────────────────────────────────────────────
// Every directory under app/dashboard appears here, including the six that are not in
// the sidebar at all — ess-credentials, roles, flexi-invoices, holidays,
// investment-proofs, statutory-leave. Hiding a sidebar entry would never have gated
// those, and ess-credentials can reset every employee's password.
//
// Some routes deliberately share a module: flexi-policy and flexi-invoices are the
// configuration and the output of the one thing HR calls "Flexi Claims", and nobody
// should have to be granted three permissions to do one job.
export const ROUTE_MODULE: Record<string, Module> = {
  '/dashboard/recruitment':        'Recruitment',
  '/dashboard/onboarding':         'Onboarding',
  '/dashboard/pms':                'Performance',
  '/dashboard/employees':          'Employees',
  '/dashboard/org-chart':          'Employees',
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

/** The module a path belongs to, or null for the dashboard landing page, which anyone
 *  who can reach the dashboard at all may see. A sub-path resolves to its section, so
 *  /dashboard/payroll/flexi-approval is still the Payroll module — the longest matching
 *  prefix wins, so /dashboard/attendance-reports is not swallowed by
 *  /dashboard/attendance. */
export function moduleForPath(path: string | null | undefined): Module | null {
  if (!path) return null
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/dashboard'
  if (clean === '/dashboard') return null
  const hit = Object.keys(ROUTE_MODULE)
    .filter(r => clean === r || clean.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0]
  return hit ? ROUTE_MODULE[hit] : null
}

// ── The functional roles the org chart actually names ────────────────────────
// The spreadsheet's seven role columns, mapped onto the role codes that already exist
// in ess_roles. Six were already there; FINANCE_EXECUTIVE is added by migration 058
// because nothing in the existing eighteen covers it.
//
// Keys are matched case-insensitively and with punctuation and spacing ignored, because
// the sheet writes "Payroll manager" where the app says "Payroll" — and, in one header,
// "Reportinmg manager L1".
export const EXCEL_ROLE_TO_CODE: Record<string, string> = {
  'hr manager':          'HR_MANAGER',
  'hr head':             'HR_HEAD',
  'payroll manager':     'PAYROLL',
  'payroll':             'PAYROLL',
  'admin manager':       'ADMIN_COMPANY',
  'it manager':          'IT',
  'finance executive':   'FINANCE_EXECUTIVE',
  'branch hr executive': 'BRANCH_HR',
  'recruiter':           'RECRUITER',
  'recruitment':         'RECRUITER',
}

/** Normalises a spreadsheet heading or role name for lookup: lower case, collapsed
 *  whitespace, no punctuation. */
export function normaliseRoleName(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The ess_roles code for a role named in the spreadsheet, or null when the name is one
 *  the application does not know. Callers must report a null rather than guessing — an
 *  unrecognised permission silently dropped is worse than an import that stops. */
export function roleCodeForExcelName(name: string): string | null {
  return EXCEL_ROLE_TO_CODE[normaliseRoleName(name)] ?? null
}
