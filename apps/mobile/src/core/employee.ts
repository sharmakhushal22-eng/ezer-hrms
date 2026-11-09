// src/core/employee.ts — the signed-in employee's record.
//
// The website's portal loads this with lib/supabase-ess.ts loadEmployeeDetail():
// four reads straight from Supabase with the public key. The app runs the same
// four, with the same columns, for the same id — the one the server put in the
// signed session token. See docs/mobile-app-architecture.md § Security for why
// these should move behind an /api route on both clients.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useEmployeeId } from './session'

const EMP_FIELDS = `id, emp_code, common_code, full_name, first_name, last_name, designation, grade,
gender, date_of_birth, blood_group, marital_status, nationality, religion, birth_place,
father_name, mother_name, spouse_name,
mobile, alternate_mobile, personal_email, office_email,
res_address1, res_city, res_state, res_pin,
perm_address1, perm_city, perm_state, perm_pin,
emergency_name, emergency_relation, emergency_mobile,
emergency2_name, emergency2_relation, emergency2_mobile,
pan_number, aadhar_last4, uan_number, group_doj, company_doj, confirmation_status,
employment_status, employment_type, collar_type, employee_function, employee_category,
notice_period_days, intern_pay, consultant_pay, contract_pay,
company_id, l1_manager_id, hr_manager_id,
pf_applicable, esic_applicable, pt_applicable, lwf_applicable,
bank_name, account_type, bank_account_last4, ifsc_code,
date_of_resignation, last_working_date, rehire_eligible, blacklisted,
departments!employees_department_id_fkey(dept_name), companies!employees_company_id_fkey(company_name), locations!location_id(location_name, city)`

export interface EmployeeDetail {
  id: string
  emp_code: string
  full_name: string
  first_name: string | null
  designation: string | null
  company_id: string | null
  department_id?: string | null
  l1_manager_id: string | null
  hr_manager_id: string | null
  dept_name: string | null
  company_name: string | null
  location_name: string | null
  city: string | null
  l1_manager_name: string | null
  hr_manager_name: string | null
  profile_photo: string | null
  account_status: string | null
  password_reset_allowed: boolean
  [k: string]: any
}

export async function loadEmployeeDetail(employeeId: string): Promise<EmployeeDetail | null> {
  const { data: e, error } = await supabase.from('employees').select(EMP_FIELDS).eq('id', employeeId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!e) return null
  const emp: any = e
  const mgrIds = [emp.l1_manager_id, emp.hr_manager_id].filter(Boolean)
  const [mgrs, acct, photo] = await Promise.all([
    mgrIds.length ? supabase.from('employees').select('id, full_name').in('id', mgrIds) : Promise.resolve({ data: [] as any[] }),
    supabase.from('ess_accounts').select('status, password_reset_allowed').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('employees').select('profile_photo').eq('id', employeeId).maybeSingle(),
  ])
  const nameOf = (id: string | null) => (mgrs.data || []).find((m: any) => m.id === id)?.full_name || null
  return {
    ...emp,
    dept_name: emp.departments?.dept_name || null,
    company_name: emp.companies?.company_name || null,
    location_name: emp.locations?.location_name || null,
    city: emp.locations?.city || null,
    l1_manager_name: nameOf(emp.l1_manager_id),
    hr_manager_name: nameOf(emp.hr_manager_id),
    profile_photo: (photo.data as any)?.profile_photo || null,
    account_status: (acct.data as any)?.status || null,
    password_reset_allowed: (acct.data as any)?.password_reset_allowed !== false,
  }
}

export function useEmployee() {
  const employeeId = useEmployeeId()
  const q = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => loadEmployeeDetail(employeeId),
    enabled: !!employeeId,
  })
  return { emp: q.data || null, loading: q.isLoading, error: q.error, refetch: q.refetch }
}
