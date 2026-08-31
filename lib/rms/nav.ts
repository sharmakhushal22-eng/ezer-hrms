// lib/rms/nav.ts — the admin navigation, once.
//
// Two shells render these entries now: the admin dashboard sidebar
// (app/dashboard/layout.tsx) and the ESS sidebar (components/ess/EmployeePortal.tsx),
// which shows the same modules to whoever holds them so an HR or payroll person never
// has to leave ESS to do their job. Keeping the list in one file is the whole point —
// two copies would drift the first time somebody adds a module to one of them.
//
// Icons stay out of here on purpose: the two shells render at different sizes and the
// ESS bundle should not pull the dashboard's icon set for an employee who holds nothing.
// Each shell maps `key` to its own icon.
import type { Module } from './modules'

export interface NavEntry {
  /** Stable id: the ESS view key, and the dashboard's icon lookup. */
  key: string
  label: string
  href: string
  /** The permission that opens it. null = everyone (Home). */
  module: Module | null
}
export interface NavGroupDef { group: string; items: NavEntry[] }

export const NAV_GROUPS: NavGroupDef[] = [
  { group: '', items: [
    { key: 'home',              label: 'Home',                    href: '/dashboard',                 module: null },
  ]},
  { group: 'People', items: [
    { key: 'recruitment',       label: 'Recruitment',             href: '/dashboard/recruitment',     module: 'Recruitment' },
    { key: 'onboarding',        label: 'Onboarding',              href: '/dashboard/onboarding',      module: 'Onboarding' },
    { key: 'pms',               label: 'Performance',             href: '/dashboard/pms',             module: 'Performance' },
    { key: 'employees',         label: 'Employees',               href: '/dashboard/employees',       module: 'Employees' },
    { key: 'org-chart',         label: 'Org Chart',               href: '/dashboard/org-chart',       module: 'Employees' },
    { key: 'bulk-upload',       label: 'Bulk Uploader',           href: '/dashboard/bulk-upload',     module: 'Bulk Upload' },
    { key: 'transfer',          label: 'Transfer',                href: '/dashboard/transfer',        module: 'Transfer' },
  ]},
  { group: 'Time & Attendance', items: [
    { key: 'attendance',        label: 'Attendance & Leave',      href: '/dashboard/attendance',         module: 'Attendance' },
    { key: 'attendance-reports',label: 'Attendance Reports',      href: '/dashboard/attendance-reports', module: 'Attendance Reports' },
    { key: 'leave-upload',      label: 'Leave & Holiday Config',  href: '/dashboard/leave-upload',       module: 'Leave Config' },
  ]},
  { group: 'Money', items: [
    { key: 'payroll',           label: 'Payroll',                 href: '/dashboard/payroll',         module: 'Payroll' },
    { key: 'finance',           label: 'Finance Department',      href: '/dashboard/finance',         module: 'Finance' },
    { key: 'flexi-claims',      label: 'Flexi Claims',            href: '/dashboard/flexi-claims',    module: 'Flexi Claims' },
    { key: 'travel-claims',     label: 'Travel Claims',           href: '/dashboard/travel-claims',   module: 'Travel Claims' },
    { key: 'loans',             label: 'Loans',                   href: '/dashboard/loans',           module: 'Loans' },
  ]},
  { group: 'Compliance & Docs', items: [
    { key: 'compliance',        label: 'Compliance',              href: '/dashboard/compliance',      module: 'Compliance' },
    { key: 'letters',           label: 'HR Letters',              href: '/dashboard/letters',         module: 'HR Letters' },
    { key: 'policies',          label: 'Company Policies',        href: '/dashboard/policies',        module: 'Policies' },
    { key: 'reports',           label: 'Reports',                 href: '/dashboard/reports',         module: 'Reports' },
  ]},
  { group: 'Setup', items: [
    { key: 'ess',               label: 'ESS & Role Management',   href: '/dashboard/ess',             module: 'ESS & Roles' },
    { key: 'admin',             label: 'Admin Setup',             href: '/dashboard/admin',           module: 'Admin Setup' },
    { key: 'flexi-policy',      label: 'Flexi Policy',            href: '/dashboard/flexi-policy',    module: 'Flexi Claims' },
    { key: 'company-profile',   label: 'Company Profile',         href: '/dashboard/company-profile', module: 'Company Profile' },
    { key: 'db-export',         label: 'Database Export',         href: '/dashboard/db-export',       module: 'Database Export' },
  ]},
  { group: 'Help', items: [
    { key: 'ai',                label: 'Ezer AI',                 href: '/dashboard/ai',              module: 'Ezer AI' },
    { key: 'support',           label: 'Support',                 href: '/dashboard/support',         module: 'Support' },
  ]},
]

/** Everything except Home — what ESS can host. Home is the dashboard's own landing. */
export const ADMIN_NAV_GROUPS: NavGroupDef[] = NAV_GROUPS.filter(g => g.group !== '')

export const NAV_ENTRY_BY_KEY: Record<string, NavEntry> =
  Object.fromEntries(NAV_GROUPS.flatMap(g => g.items).map(i => [i.key, i]))
