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
  group: 'Employee' | 'Employment' | 'Company' | 'System' | 'Appraisal'
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
  { token: 'branch_name',       label: 'Branch / Location',      group: 'Company' },

  // Appraisal. These resolve from the employee's most recent saved appraisal, so an
  // Appraisal Letter template fills itself through the ordinary generate flow — HR picks
  // employees and a template exactly as they do for any other letter.
  //
  // Every figure comes from calculate_appraisal_breakup(), the same function the
  // Appraisal screen previews and the arrear run computes against. A letter that quoted
  // its own arithmetic would eventually promise a number the payslip does not pay.
  { token: 'appraisal_effective_date', label: 'Effective from',        group: 'Appraisal' },
  { token: 'appraisal_fy_previous',    label: 'Previous FY',           group: 'Appraisal' },
  { token: 'appraisal_fy_revised',     label: 'Revised FY',            group: 'Appraisal' },
  { token: 'previous_ctc',             label: 'Previous CTC (annual)', group: 'Appraisal' },
  { token: 'revised_ctc',              label: 'Revised CTC (annual)',  group: 'Appraisal' },
  { token: 'hike_percent',             label: 'Hike %',                group: 'Appraisal' },
  { token: 'appr_basic_m',             label: 'Basic — monthly',       group: 'Appraisal' },
  { token: 'appr_basic_a',             label: 'Basic — annual',        group: 'Appraisal' },
  { token: 'appr_hra_m',               label: 'HRA — monthly',         group: 'Appraisal' },
  { token: 'appr_hra_a',               label: 'HRA — annual',          group: 'Appraisal' },
  { token: 'appr_special_m',           label: 'Special — monthly',     group: 'Appraisal' },
  { token: 'appr_special_a',           label: 'Special — annual',      group: 'Appraisal' },
  { token: 'appr_bonus_m',             label: 'Statutory bonus — monthly', group: 'Appraisal' },
  { token: 'appr_bonus_a',             label: 'Statutory bonus — annual',  group: 'Appraisal' },
  { token: 'appr_er_pf_m',             label: 'Employer PF — monthly', group: 'Appraisal' },
  { token: 'appr_er_pf_a',             label: 'Employer PF — annual',  group: 'Appraisal' },
  { token: 'appr_er_esic_m',           label: 'Employer ESIC — monthly', group: 'Appraisal' },
  { token: 'appr_er_esic_a',           label: 'Employer ESIC — annual',  group: 'Appraisal' },
  { token: 'appr_gross_m',             label: 'Gross pay — monthly',   group: 'Appraisal' },
  { token: 'appr_gross_a',             label: 'Gross pay — annual',    group: 'Appraisal' },
  { token: 'appr_fixed_m',             label: 'Fixed CTC — monthly',   group: 'Appraisal' },
  { token: 'appr_fixed_a',             label: 'Fixed CTC — annual',    group: 'Appraisal' },
  { token: 'appr_variable_a',          label: 'Variable — annual',     group: 'Appraisal' },
  { token: 'appr_final_ctc_a',         label: 'Final CTC — annual',    group: 'Appraisal' },
]

export type ResolvedFields = Record<string, string>

const FALLBACK = '[Not available]'

function formatDate(d: string | null): string {
  if (!d) return FALLBACK
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return FALLBACK
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

const inr = (n: number) => Math.round(n || 0).toLocaleString('en-IN')

// Financial year a date falls in: April starts it, so 1 Apr 2026 → "2026-27".
function fyOf(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(-2)}`
}

/**
 * Appraisal tokens for one employee, from their latest saved appraisal.
 * Returns blanks rather than throwing when there is no appraisal — an Offer Letter
 * generated for the same employee must not fail because of an unrelated feature.
 */
async function resolveAppraisalFields(employeeId: string): Promise<ResolvedFields> {
  const blank: ResolvedFields = {}
  const { data: a } = await supabase.from('appraisal_records')
    .select('previous_ctc, new_ctc, new_variable, hike_percent, effective_from')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!a) return blank

  // Statutory bonus carries forward from the current structure — an appraisal revises
  // CTC, it does not restate the bonus, and inventing one here would put a figure in the
  // letter that no payslip produces.
  const { data: ss } = await supabase.from('salary_structures')
    .select('statutory_bonus').eq('employee_id', employeeId)
    .order('effective_date', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()

  // Every figure below comes out of this one call — including employer PF/ESIC and the
  // gross. Recomputing any of them here would be a second implementation of the same
  // arithmetic, and the letter would eventually quote a number the payslip does not pay.
  const { data: bk } = await supabase.rpc('calculate_appraisal_breakup', {
    p_new_fixed_ctc_annual: (a as any).new_ctc,
    p_flexi_monthly_total: 0,
    p_effective_from: (a as any).effective_from,
    p_statutory_bonus_monthly: Number((ss as any)?.statutory_bonus) || 0,
  })
  const b = (bk as any[])?.[0]
  if (!b) return blank

  const basic = Number(b.basic_monthly) || 0
  const hra = Number(b.hra_monthly) || 0
  const special = Number(b.special_allowance_monthly) || 0
  const bonus = Number(b.statutory_bonus_monthly) || 0
  const gross = Number(b.gross_monthly) || 0
  const erPf = Number(b.employer_pf_monthly) || 0
  const erEsic = Number(b.employer_esic_monthly) || 0
  const fixed = Number(b.fixed_monthly) || 0
  const variable = Number((a as any).new_variable) || 0

  const eff = new Date(String((a as any).effective_from) + 'T00:00:00')
  const prevFy = fyOf(new Date(eff.getFullYear() - 1, eff.getMonth(), 1))

  const pair = (k: string, m: number): ResolvedFields => ({ [`${k}_m`]: inr(m), [`${k}_a`]: inr(m * 12) })

  return {
    appraisal_effective_date: formatDate(String((a as any).effective_from)),
    appraisal_fy_previous: prevFy,
    appraisal_fy_revised: fyOf(eff),
    previous_ctc: inr(Number((a as any).previous_ctc) || 0),
    revised_ctc: inr(Number((a as any).new_ctc) || 0),
    hike_percent: (a as any).hike_percent != null ? `${(a as any).hike_percent}%` : FALLBACK,
    ...pair('appr_basic', basic),
    ...pair('appr_hra', hra),
    ...pair('appr_special', special),
    ...pair('appr_bonus', bonus),
    ...pair('appr_er_pf', erPf),
    ...pair('appr_er_esic', erEsic),
    ...pair('appr_gross', gross),
    ...pair('appr_fixed', fixed),
    appr_variable_a: inr(variable),
    appr_final_ctc_a: inr(fixed * 12 + variable),
  }
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
      department:departments!employees_department_id_fkey(dept_name),
      company:companies!employees_company_id_fkey(company_name),
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

  // Appraisal tokens are folded in only if this employee has one; otherwise the tokens
  // stay unresolved and renderTemplate reports them, exactly as it would for any typo.
  Object.assign(fields, await resolveAppraisalFields(employeeId))

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
