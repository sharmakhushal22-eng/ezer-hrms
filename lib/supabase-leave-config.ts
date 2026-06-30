// lib/supabase-leave-config.ts — Leave Configuration data layer (migration 030)
// CATALOG (leave_types + 16 behaviour flags) + QUOTA (leave_policy per company/branch)
// + resolve_leave_quota wrapper. "Leave types are data" — add/edit = a row, no code.
import { supabase } from '@/lib/supabase'

export type AppMode = 'EMPLOYEE' | 'HR_MARK' | 'EARN_AVAIL'
export type EligibleFrom = 'DOJ' | 'ON_DOJ' | 'AFTER_DAYS' | 'AFTER_PROBATION'
export type Gender = 'ANY' | 'M' | 'F'
export type ApprovalBy = 'L1' | 'HR_MANAGER' | 'ASSIGNED' | 'BOTH'

export interface LeaveType {
  id: string
  name: string
  short_name: string
  application_mode: AppMode
  eligible_from: EligibleFrom
  min_tenure_days: number
  probation_eligible: boolean
  probation_limit: number | null
  laps: boolean
  encashment_after: number | null
  max_times_in_tenure: number | null
  allow_without_balance: boolean
  auto_mark_absent: boolean
  deduct_salary: boolean
  gender: Gender
  approval_by: ApprovalBy
  company_id?: string | null
  branch_id?: string | null
  carry_forward_unlimited: boolean
  is_system: boolean
  annual_quota: number
  carry_forward_max: number
  is_paid: boolean
  is_encashable: boolean
  allow_half_day: boolean
  accrual: string
  doc_required_after: number | null
  color: string
  sort_order: number
  is_active: boolean
}

export interface LeavePolicy {
  id: string
  leave_type_id: string
  company_id: string
  branch_id: string | null
  fy: string
  annual_quota: number
  max_carry_forward: number
  laps: boolean
  is_encashable: boolean
  encashment_after: number | null
  accrual: string
  is_active: boolean
}

export interface ResolvedQuota {
  leave_type_id: string
  short_name: string
  name: string
  application_mode: AppMode
  gender: Gender
  annual_quota: number
  max_carry_forward: number
  source: 'branch' | 'company' | 'catalog'
}

export interface OrgLite { id: string; name: string; code?: string; company_id?: string }

// ── Lookups ─────────────────────────────────────────────────────────
export async function loadCompanies(): Promise<OrgLite[]> {
  const { data } = await supabase.from('companies').select('id, company_name, company_code').eq('status', 'Active').order('company_name')
  return (data || []).map((c: any) => ({ id: c.id, name: c.company_name, code: c.company_code }))
}
export async function loadBranches(): Promise<OrgLite[]> {
  const { data } = await supabase.from('locations').select('id, location_name, company_id').eq('status', 'Active').order('location_name')
  return (data || []).map((b: any) => ({ id: b.id, name: b.location_name, company_id: b.company_id }))
}

// ── Leave types (CATALOG) ───────────────────────────────────────────
export async function loadLeaveTypes(): Promise<LeaveType[]> {
  const { data } = await supabase.from('leave_types').select('*').order('sort_order')
  return (data || []) as LeaveType[]
}
// New leave type = a row. Pass id to edit. Returns the saved row.
export async function upsertLeaveType(row: Partial<LeaveType>) {
  const payload: any = { ...row }
  if (!payload.id) {
    delete payload.id
    return supabase.from('leave_types').insert(payload).select().maybeSingle()
  }
  const { id, ...rest } = payload
  return supabase.from('leave_types').update(rest).eq('id', id).select().maybeSingle()
}
export async function setLeaveTypeActive(id: string, is_active: boolean) {
  return supabase.from('leave_types').update({ is_active }).eq('id', id)
}
// System types are protected — caller should block, this is the final guard.
export async function deleteLeaveType(id: string) {
  return supabase.from('leave_types').delete().eq('id', id).eq('is_system', false)
}

// ── Leave policy (QUOTA per company / branch) ───────────────────────
export async function loadPolicies(company_id: string, fy: string): Promise<LeavePolicy[]> {
  const { data } = await supabase.from('leave_policy').select('*').eq('company_id', company_id).eq('fy', fy)
  return (data || []) as LeavePolicy[]
}
// Null-aware upsert (partial unique indexes guard the DB). branch_id null = company default.
export async function upsertPolicy(row: {
  leave_type_id: string; company_id: string; branch_id: string | null; fy: string
  annual_quota: number; max_carry_forward: number; laps: boolean; is_encashable: boolean; encashment_after?: number | null; accrual: string
}) {
  let q = supabase.from('leave_policy').select('id')
    .eq('leave_type_id', row.leave_type_id).eq('company_id', row.company_id).eq('fy', row.fy)
  q = row.branch_id ? q.eq('branch_id', row.branch_id) : q.is('branch_id', null)
  const { data: existing } = await q.maybeSingle()
  const payload = { ...row, is_active: true }
  return existing
    ? supabase.from('leave_policy').update(payload).eq('id', existing.id)
    : supabase.from('leave_policy').insert(payload)
}
export async function deletePolicy(id: string) {
  return supabase.from('leave_policy').delete().eq('id', id)
}

// ── Resolve effective quota for a branch (branch → company → catalog) ──
export async function resolveQuota(company_id: string, branch_id: string | null, fy = '2026-27'): Promise<ResolvedQuota[]> {
  const { data, error } = await supabase.rpc('resolve_leave_quota', { p_company_id: company_id, p_branch_id: branch_id, p_fy: fy })
  if (error) throw error
  return (data || []) as ResolvedQuota[]
}
