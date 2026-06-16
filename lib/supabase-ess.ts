// lib/supabase-ess.ts — ESS data helpers (Phase 1: admin access & roles)
import { supabase } from '@/lib/supabase'

export interface EssRole {
  id: string; role_code: string; role_name: string
  salary_visibility: 'NONE' | 'OWN' | 'TEAM' | 'DEPT' | 'BRANCH' | 'ALL'
  scope: 'SELF' | 'TEAM' | 'DEPT' | 'BRANCH' | 'ORG'
  sort_order: number
}
export interface EssAccount {
  id: string; employee_id: string; status: 'ACTIVE' | 'INACTIVE' | 'LOCKED'
  last_login_at: string | null; login_count: number
  deactivated_at: string | null; deactivation_reason: string | null
  password_reset_allowed: boolean
}
export interface EssUser {
  employee_id: string; emp_code: string; full_name: string; designation: string | null
  dept_name: string | null; company_name: string | null; location_name: string | null
  date_of_resignation: string | null; last_working_date: string | null
  account: EssAccount | null
  roles: EssRole[]
}
export interface AuditRow {
  id: string; action: string; performed_by_name: string | null; reason: string | null
  details: any; created_at: string; ess_account_id: string | null
}

export async function loadRoles(): Promise<EssRole[]> {
  const { data } = await supabase.from('ess_roles').select('*').order('sort_order')
  return (data as any) || []
}

export async function loadUsers(): Promise<EssUser[]> {
  const [{ data: emps }, { data: accts }, { data: ur }, { data: roles }] = await Promise.all([
    supabase.from('employees')
      .select('id, emp_code, full_name, designation, date_of_resignation, last_working_date, departments(dept_name), companies(company_name), locations(location_name)')
      .order('emp_code'),
    supabase.from('ess_accounts').select('*'),
    supabase.from('ess_user_roles').select('ess_account_id, role_id').eq('is_active', true),
    supabase.from('ess_roles').select('*'),
  ])
  const acctByEmp = new Map<string, any>((accts || []).map((a: any) => [a.employee_id, a]))
  const roleById = new Map<string, any>((roles || []).map((r: any) => [r.id, r]))
  const rolesByAcct = new Map<string, EssRole[]>()
  for (const x of ur || []) {
    const arr = rolesByAcct.get(x.ess_account_id) || []
    const r = roleById.get(x.role_id); if (r) arr.push(r)
    rolesByAcct.set(x.ess_account_id, arr)
  }
  return (emps || []).map((e: any) => {
    const account = acctByEmp.get(e.id) || null
    return {
      employee_id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      dept_name: e.departments?.dept_name || null, company_name: e.companies?.company_name || null,
      location_name: e.locations?.location_name || null,
      date_of_resignation: e.date_of_resignation, last_working_date: e.last_working_date,
      account, roles: account ? (rolesByAcct.get(account.id) || []) : [],
    } as EssUser
  })
}

export async function loadAudit(): Promise<AuditRow[]> {
  const { data } = await supabase.from('ess_access_audit').select('*').order('created_at', { ascending: false }).limit(25)
  return (data as any) || []
}

// Set ACTIVE / INACTIVE. Deactivation also blocks password reset (per spec).
export async function setStatus(u: EssUser, status: 'ACTIVE' | 'INACTIVE', opts: { reason?: string; byName?: string } = {}) {
  const patch: any = { employee_id: u.employee_id, status }
  if (status === 'INACTIVE') {
    patch.password_reset_allowed = false
    patch.deactivated_at = new Date().toISOString()
    patch.deactivation_reason = opts.reason || null
  } else {
    patch.password_reset_allowed = true
    patch.deactivated_at = null
    patch.deactivation_reason = null
  }
  const { data: acct, error } = await supabase.from('ess_accounts')
    .upsert(patch, { onConflict: 'employee_id' }).select('*').single()
  if (error) return { error }
  await supabase.from('ess_access_audit').insert({
    ess_account_id: acct?.id,
    action: status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
    performed_by_name: opts.byName || null, reason: opts.reason || null,
    details: { emp_code: u.emp_code, full_name: u.full_name },
  })
  return { account: acct as EssAccount }
}

// Replace the user's roles with exactly the selected set. Auto-creates an account if needed.
export async function assignRoles(u: EssUser, roleIds: string[], byName?: string) {
  let acctId = u.account?.id
  if (!acctId) {
    const { data } = await supabase.from('ess_accounts')
      .upsert({ employee_id: u.employee_id, status: u.account?.status || 'INACTIVE' }, { onConflict: 'employee_id' })
      .select('id').single()
    acctId = data?.id
  }
  if (!acctId) return { error: { message: 'Could not create ESS account' } }
  await supabase.from('ess_user_roles').delete().eq('ess_account_id', acctId)
  if (roleIds.length) {
    const rows = roleIds.map(rid => ({ ess_account_id: acctId, role_id: rid }))
    const { error } = await supabase.from('ess_user_roles').insert(rows)
    if (error) return { error }
  }
  await supabase.from('ess_access_audit').insert({
    ess_account_id: acctId, action: 'ROLE_ASSIGN', performed_by_name: byName || null,
    details: { emp_code: u.emp_code, role_count: roleIds.length },
  })
  return { ok: true }
}

export async function startImpersonation(u: EssUser, adminName?: string): Promise<string | null> {
  let adminId: string | null = null
  try { const { data } = await supabase.auth.getUser(); adminId = data?.user?.id || null } catch {}
  const { data } = await supabase.from('ess_impersonation_log').insert({
    admin_id: adminId || '00000000-0000-0000-0000-000000000000',
    admin_name: adminName || 'Admin', employee_id: u.employee_id,
  }).select('id').single()
  return data?.id || null
}
export async function endImpersonation(logId: string) {
  await supabase.from('ess_impersonation_log').update({ ended_at: new Date().toISOString() }).eq('id', logId)
}

// ════════════════════════════════════════════════════════════════
// PHASE 2 — Employee Portal data
// ════════════════════════════════════════════════════════════════
export interface EmployeeDetail {
  id: string; emp_code: string; full_name: string; first_name: string | null; last_name: string | null
  designation: string | null; grade: string | null
  gender: string | null; date_of_birth: string | null; blood_group: string | null; marital_status: string | null
  mobile: string | null; personal_email: string | null; office_email: string | null
  pan_number: string | null; aadhar_last4: string | null; uan_number: string | null
  group_doj: string | null; company_doj: string | null
  confirmation_status: string | null; employment_status: string | null; employment_type: string | null
  dept_name: string | null; company_name: string | null; location_name: string | null; city: string | null
  l1_manager_name: string | null; hr_manager_name: string | null
  date_of_resignation: string | null; last_working_date: string | null
  account_status: string | null; password_reset_allowed: boolean
}
export interface DirectoryEntry {
  id: string; emp_code: string; full_name: string; designation: string | null
  dept_name: string | null; location_name: string | null
  mobile: string | null; office_email: string | null; personal_email: string | null
}
export interface EssNotification { id: string; category: string | null; title: string; body: string | null; link: string | null; is_read: boolean; created_at: string }
export interface ServiceRequest { id: string; request_type: string; request_data: any; is_confidential: boolean; status: string; assigned_to: string | null; submitted_at: string; resolution_note: string | null }
export interface LetterRequest { id: string; letter_type: string; purpose: string | null; status: string; requested_at: string; letter_url: string | null; rejection_reason: string | null }
export interface Announcement { id: string; title: string; body: string | null; category: string | null; published_at: string }
export interface Kudo { id: string; from_name?: string; message: string | null; badge: string | null; points: number; created_at: string }

const EMP_FIELDS = `id, emp_code, full_name, first_name, last_name, designation, grade,
  gender, date_of_birth, blood_group, marital_status, mobile, personal_email, office_email,
  pan_number, aadhar_last4, uan_number, group_doj, company_doj, confirmation_status,
  employment_status, employment_type, l1_manager_id, hr_manager_id,
  date_of_resignation, last_working_date,
  departments(dept_name), companies(company_name), locations(location_name, city)`

export async function loadEmployeeDetail(employeeId: string): Promise<EmployeeDetail | null> {
  const { data: e } = await supabase.from('employees').select(EMP_FIELDS).eq('id', employeeId).maybeSingle()
  if (!e) return null
  const mgrIds = [ (e as any).l1_manager_id, (e as any).hr_manager_id ].filter(Boolean)
  let mgrNames: Record<string, string> = {}
  if (mgrIds.length) {
    const { data: mgrs } = await supabase.from('employees').select('id, full_name').in('id', mgrIds)
    mgrNames = Object.fromEntries((mgrs || []).map((m: any) => [m.id, m.full_name]))
  }
  const { data: acct } = await supabase.from('ess_accounts').select('status, password_reset_allowed').eq('employee_id', employeeId).maybeSingle()
  const x: any = e
  return {
    id: x.id, emp_code: x.emp_code, full_name: x.full_name, first_name: x.first_name, last_name: x.last_name,
    designation: x.designation, grade: x.grade, gender: x.gender, date_of_birth: x.date_of_birth,
    blood_group: x.blood_group, marital_status: x.marital_status, mobile: x.mobile,
    personal_email: x.personal_email, office_email: x.office_email, pan_number: x.pan_number,
    aadhar_last4: x.aadhar_last4, uan_number: x.uan_number, group_doj: x.group_doj, company_doj: x.company_doj,
    confirmation_status: x.confirmation_status, employment_status: x.employment_status, employment_type: x.employment_type,
    dept_name: x.departments?.dept_name || null, company_name: x.companies?.company_name || null,
    location_name: x.locations?.location_name || null, city: x.locations?.city || null,
    l1_manager_name: mgrNames[x.l1_manager_id] || null, hr_manager_name: mgrNames[x.hr_manager_id] || null,
    date_of_resignation: x.date_of_resignation, last_working_date: x.last_working_date,
    account_status: acct?.status || null, password_reset_allowed: acct?.password_reset_allowed !== false,
  }
}

export async function loadDirectory(): Promise<DirectoryEntry[]> {
  const { data } = await supabase.from('employees')
    .select('id, emp_code, full_name, designation, mobile, office_email, personal_email, blacklisted, last_working_date, departments(dept_name), locations(location_name)')
    .order('full_name')
  const t0 = new Date(); t0.setHours(0, 0, 0, 0)
  return (data || [])
    .filter((e: any) => !e.blacklisted && !(e.last_working_date && new Date(e.last_working_date) < t0))
    .map((e: any) => ({
      id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      dept_name: e.departments?.dept_name || null, location_name: e.locations?.location_name || null,
      mobile: e.mobile, office_email: e.office_email, personal_email: e.personal_email,
    }))
}

export async function loadNotifications(employeeId: string): Promise<EssNotification[]> {
  const { data } = await supabase.from('ess_notifications').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(50)
  return (data as any) || []
}
export async function markNotification(id: string, read = true) { await supabase.from('ess_notifications').update({ is_read: read }).eq('id', id) }
export async function markAllNotifications(employeeId: string) { await supabase.from('ess_notifications').update({ is_read: true }).eq('employee_id', employeeId) }

export async function loadServiceRequests(employeeId: string): Promise<ServiceRequest[]> {
  const { data } = await supabase.from('ess_service_requests').select('*').eq('employee_id', employeeId).order('submitted_at', { ascending: false })
  return (data as any) || []
}
export async function createServiceRequest(employeeId: string, request_type: string, request_data: any, opts: { is_confidential?: boolean; assigned_to?: string } = {}) {
  const { error } = await supabase.from('ess_service_requests').insert({
    employee_id: employeeId, request_type, request_data,
    is_confidential: opts.is_confidential || false, assigned_to: opts.assigned_to || 'HR',
  })
  return { error }
}

export async function loadLetterRequests(employeeId: string): Promise<LetterRequest[]> {
  const { data } = await supabase.from('ess_letter_requests').select('*').eq('employee_id', employeeId).order('requested_at', { ascending: false })
  return (data as any) || []
}
export async function createLetterRequest(employeeId: string, letter_type: string, purpose: string, custom_details: string) {
  const { error } = await supabase.from('ess_letter_requests').insert({ employee_id: employeeId, letter_type, purpose, custom_details })
  return { error }
}

export async function loadAnnouncements(): Promise<Announcement[]> {
  const { data } = await supabase.from('ess_announcements').select('*').eq('is_active', true).order('published_at', { ascending: false }).limit(20)
  return (data as any) || []
}
export async function loadKudos(employeeId: string): Promise<Kudo[]> {
  const { data } = await supabase.from('ess_kudos').select('*').eq('to_employee_id', employeeId).order('created_at', { ascending: false }).limit(20)
  return (data as any) || []
}
