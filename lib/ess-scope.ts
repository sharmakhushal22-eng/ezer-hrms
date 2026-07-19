// lib/ess-scope.ts — determine what an ESS-logged-in employee can see, from their role scope.
// SELF → only own portal. TEAM → direct reports. DEPT → same department.
// BRANCH → same location. ORG → everyone. (Highest scope among the employee's roles wins.)
import { supabase } from '@/lib/supabase'

export type Scope = 'SELF' | 'TEAM' | 'DEPT' | 'BRANCH' | 'ORG'
const RANK: Record<Scope, number> = { SELF: 0, TEAM: 1, DEPT: 2, BRANCH: 3, ORG: 4 }

export interface ScopeEmployee { id: string; emp_code: string; full_name: string; designation: string | null; dept_name: string | null; location_name: string | null }
export interface AccessScope { scope: Scope; roleNames: string[]; canViewOthers: boolean; employees: ScopeEmployee[] }

export async function loadAccessScope(employeeId: string): Promise<AccessScope> {
  const none: AccessScope = { scope: 'SELF', roleNames: [], canViewOthers: false, employees: [] }

  // Employee's ess_account → active roles → scopes.
  const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle()
  if (!acct) return none
  const { data: ur } = await supabase.from('ess_user_roles').select('role_id').eq('ess_account_id', acct.id).eq('is_active', true)
  const roleIds = (ur || []).map((r: any) => r.role_id)
  if (!roleIds.length) return none
  const { data: roles } = await supabase.from('ess_roles').select('role_name, scope').in('id', roleIds)
  if (!roles?.length) return none

  let best: Scope = 'SELF'
  for (const r of roles as any[]) { const s = (r.scope || 'SELF') as Scope; if (RANK[s] > RANK[best]) best = s }
  const roleNames = (roles as any[]).map(r => r.role_name)
  if (best === 'SELF') return { scope: 'SELF', roleNames, canViewOthers: false, employees: [] }

  // This employee's own dept/location for DEPT/BRANCH scoping.
  const { data: me } = await supabase.from('employees').select('department_id, location_id').eq('id', employeeId).maybeSingle()

  const cols = 'id, emp_code, full_name, designation, departments(dept_name), locations!location_id(location_name)'
  let q = supabase.from('employees').select(cols).eq('employment_status', 'Active').neq('is_test', true).order('emp_code')
  if (best === 'TEAM') q = q.eq('l1_manager_id', employeeId)
  else if (best === 'DEPT') q = q.eq('department_id', (me as any)?.department_id || '00000000-0000-0000-0000-000000000000')
  else if (best === 'BRANCH') q = q.eq('location_id', (me as any)?.location_id || '00000000-0000-0000-0000-000000000000')
  // ORG → no extra filter.
  const { data } = await q.limit(5000)
  const employees: ScopeEmployee[] = (data || []).map((e: any) => ({
    id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
    dept_name: e.departments?.dept_name || null, location_name: e.locations?.location_name || null,
  }))
  return { scope: best, roleNames, canViewOthers: employees.length > 0, employees }
}
