// lib/analytics/server/access.ts — the one answer to "may this person open People
// Analytics, and on what?". Used by every org analytics route and by ESS Insights to
// decide whether to offer the Organisation tab.
//
// Order: Super Admin (never limited) → an active analytics_access row (migration 232,
// it decides) → a reporting role (Reports / Company Dashboard / ESS Reports) → nothing.
// The table may not exist yet; then rows simply are not looked for.

import type { Grant } from '@/lib/rms/resolve'
import { canAdministerRoles } from '@/lib/rms/resolve'
import { holds, holdsAny } from '@/lib/rms/authz'
import type { Module } from '@/lib/rms/modules'
import { istToday } from '../period.ts'
import { accessFromRow, roleAccess, rowApplies, type AccessRow, type OrgAccess } from '../access.ts'
import { sb } from './db.ts'

export const GATE: Module[] = ['Reports', 'Company Dashboard', 'ESS Reports']

export const ROW_COLS = 'employee_id, company_ids, locations, departments, employment_types, tabs, see_names, see_pay, can_export, valid_until, note, is_active, granted_by_name, updated_at'

/** "relation does not exist" / PostgREST's "could not find the table" — 232 not run. */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''))

let missingUntil = 0

/** Is the analytics_access table there? Re-checked every five minutes once missing, so
 *  running the migration takes effect without a redeploy. */
export async function tableReady(): Promise<boolean> {
  if (Date.now() < missingUntil) return false
  const { error } = await sb.from('analytics_access').select('employee_id').limit(1)
  if (isMissingTable(error)) { missingUntil = Date.now() + 5 * 60_000; return false }
  return true
}

export async function rowFor(employeeId: string): Promise<AccessRow | null> {
  if (Date.now() < missingUntil) return null
  const { data, error } = await sb.from('analytics_access').select(ROW_COLS).eq('employee_id', employeeId).maybeSingle()
  if (error) { if (isMissingTable(error)) missingUntil = Date.now() + 5 * 60_000; return null }
  return (data as AccessRow | null) ?? null
}

/** May hand out analytics access: the people who may hand out roles, or full ESS & Roles. */
export function canManageAnalytics(g: Grant): boolean {
  return canAdministerRoles(g) || holds(g, 'ESS & Roles', 'FULL')
}

/** The organisation-view access this person has, or null for none. */
export async function orgAccessFor(g: Grant): Promise<OrgAccess | null> {
  if (g.isSuperAdmin || g.legacy) return roleAccess({ cost: true, people: true, superAdmin: true })
  if (g.employeeId) {
    const row = await rowFor(g.employeeId)
    if (row && rowApplies(row, istToday())) return accessFromRow(row)
  }
  if (holdsAny(g, GATE)) {
    return roleAccess({ cost: holdsAny(g, ['Payroll', 'Finance', 'Reports']), people: holdsAny(g, ['Reports', 'Employees']) })
  }
  return null
}

/** The reporting module whose company scope applies on the role path. */
export const scopeModuleOf = (g: Grant): Module | null => GATE.find(m => holds(g, m)) ?? null
