// ================================================================
// EZER HRMS — Letter Merge Fields
// Path: lib/letters/mergeFields.ts
//
// The registry the template designer's "Insert field" picker reads
// from, and the resolver that turns one employee_id into actual
// values for every token. Reconciled to EZER's live employees schema
// (res_address*, office_email, company_doj, locations table).
// ================================================================
import { supabase } from '@/lib/supabase'

export interface MergeField {
  token: string          // used in template content as {{token}}
  label: string          // shown in the "Insert field" picker
  group: 'Employee' | 'Employment' | 'Company' | 'System'
}

export const MERGE_FIELDS: MergeField[] = [
  { token: 'letter_date',       label: 'Date on letter',        group: 'System' },
  { token: 'employee_name',     label: 'Employee Name',         group: 'Employee' },
  { token: 'employee_code',     label: 'Employee Code',         group: 'Employee' },
  { token: 'father_name',       label: "Father's Name",         group: 'Employee' },
  { token: 'address',           label: 'Address',               group: 'Employee' },
  { token: 'designation',       label: 'Designation',           group: 'Employment' },
  { token: 'department',        label: 'Department',            group: 'Employment' },
  { token: 'date_of_joining',   label: 'Date of Joining',       group: 'Employment' },
  { token: 'company_name',      label: 'Company Name',          group: 'Company' },
  { token: 'branch_name',       label: 'Branch / Location',     group: 'Company' },
]

export type ResolvedFields = Record<string, string>

const FALLBACK = '[Not available]'

function formatDate(d: string | null): string {
  if (!d) return FALLBACK
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return FALLBACK
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatAddress(row: any): string {
  const parts = [row.res_address1, row.res_address2, [row.res_city, row.res_state, row.res_pin].filter(Boolean).join(', ')]
    .filter(Boolean)
  return parts.length ? parts.join(', ') : FALLBACK
}

/**
 * Resolve every merge field for one employee. Never throws on missing
 * data — a field EZER doesn't have yet renders as "[Not available]"
 * rather than breaking letter generation for that employee.
 */
export async function resolveMergeFieldsForEmployee(employeeId: string): Promise<{
  fields: ResolvedFields
  companyId: string | null
  locationId: string | null
  employeeName: string
  employeeEmail: string | null
} | null> {
  const { data: emp, error } = await supabase
    .from('employees')
    .select(`
      id, emp_code, full_name, designation, company_doj, father_name,
      res_address1, res_address2, res_city, res_state, res_pin,
      personal_email, office_email,
      company_id, location_id,
      department:departments(dept_name),
      company:companies(company_name),
      location:locations!location_id(location_name)
    `)
    .eq('id', employeeId)
    .maybeSingle()

  if (error || !emp) return null

  const fields: ResolvedFields = {
    letter_date:     formatDate(new Date().toISOString()),
    employee_name:   emp.full_name ?? FALLBACK,
    employee_code:   emp.emp_code ?? FALLBACK,
    father_name:     emp.father_name ?? FALLBACK,
    address:         formatAddress(emp),
    designation:     emp.designation ?? FALLBACK,
    department:      (emp as any).department?.dept_name ?? FALLBACK,
    date_of_joining: formatDate((emp as any).company_doj),
    company_name:    (emp as any).company?.company_name ?? FALLBACK,
    branch_name:     (emp as any).location?.location_name ?? FALLBACK,
  }

  return {
    fields,
    companyId: emp.company_id ?? null,
    locationId: emp.location_id ?? null,
    employeeName: emp.full_name ?? 'Employee',
    employeeEmail: (emp as any).office_email ?? emp.personal_email ?? null,
  }
}

/** Sample data for the template designer's "Preview sample" — never touches real employee records. */
export function sampleMergeFields(): ResolvedFields {
  return {
    letter_date: formatDate(new Date().toISOString()),
    employee_name: 'Rajesh Mehta',
    employee_code: 'SRS0001',
    father_name: 'Suresh Mehta',
    address: 'B-204, Palm Residency, Sector 49, Gurugram, Haryana, 122018',
    designation: 'Senior HR Manager',
    department: 'HR & Admin',
    date_of_joining: formatDate('2026-08-01'),
    company_name: 'Sharma Retail Solutions Pvt Ltd',
    branch_name: 'Gurugram HQ',
  }
}
