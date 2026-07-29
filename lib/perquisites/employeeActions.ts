// ================================================================
// EZER HRMS — Employee Perquisites + Statutory Integration
// Path: lib/perquisites/employeeActions.ts
//
// This is the link between "what's the configured rate" (actions.ts,
// migration 056) and "what does THIS employee actually have"
// (employee_perquisites, migration 057) — plus the Statutory-tab
// hookup: getTaxableIncomeWithPerquisites() hands back the correct
// combined taxable income; it does NOT compute TDS/Cess/Surcharge
// itself. That stays in EZER's existing computeTax() engine — see the
// clearly-marked stub at the bottom, which exists only so this file's
// demo/UI has something to call. Replace it with the real engine.
// ================================================================
import { supabase } from '@/lib/supabase'

export interface EmployeePerquisite {
  id: string
  employee_id: string
  perquisite_type_id: string
  fy: string
  amount: number
  notes: string | null
  computed_at: string
}

export interface EmployeePerquisiteSummary {
  employee_id: string
  fy: string
  total_perquisite_amount: number
  breakdown_by_type: Record<string, number>
}

export interface TaxableIncomeResult {
  base_taxable_salary: number
  total_perquisite_amount: number
  taxable_income_with_perquisite: number
  breakdown_by_type: Record<string, number>
}

export async function getEmployeePerquisites(employeeId: string, fy: string): Promise<EmployeePerquisite[]> {
  const { data } = await supabase
    .from('employee_perquisites')
    .select('*, perquisite_types(name)')
    .eq('employee_id', employeeId).eq('fy', fy)
  return (data ?? []) as any
}

export async function saveEmployeePerquisite(args: {
  employeeId: string; perquisiteTypeId: string; fy: string; amount: number; notes?: string; computedBy?: string
}) {
  const { data, error } = await supabase.from('employee_perquisites').upsert({
    employee_id: args.employeeId, perquisite_type_id: args.perquisiteTypeId, fy: args.fy,
    amount: args.amount, notes: args.notes ?? null, computed_by: args.computedBy ?? null,
  }, { onConflict: 'employee_id,perquisite_type_id,fy' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function removeEmployeePerquisite(id: string) {
  const { error } = await supabase.from('employee_perquisites').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * THE Statutory-tab integration point. Returns the taxable income
 * figure ALREADY INCLUDING this employee's perquisites for the FY —
 * pass taxable_income_with_perquisite straight into computeTax(),
 * don't add the perquisite total again on the caller's side.
 */
export async function getTaxableIncomeWithPerquisites(
  employeeId: string, fy: string, baseTaxableSalary: number
): Promise<TaxableIncomeResult> {
  const { data, error } = await supabase.rpc('get_taxable_income_with_perquisites', {
    p_employee_id: employeeId, p_fy: fy, p_base_taxable_salary: baseTaxableSalary,
  })
  if (error) throw new Error(error.message)
  return (data as any[])[0] as TaxableIncomeResult
}

// ================================================================
// STUB — replace with EZER's actual computeTax() engine.
// This exists only so the Statutory summary UI has something to call
// while wiring happens; the real engine already handles slabs, cess,
// and surcharge correctly (old vs new regime, HRA methods, employer
// NPS, etc.) per the earlier TDS Declaration Portal work — do not
// treat the numbers below as authoritative.
// ================================================================
export interface TaxBreakdown { tds: number; cess: number; surcharge: number; total: number }

export function computeTaxSTUB(taxableIncome: number): TaxBreakdown {
  // Placeholder slabs only — wire to the real computeTax() before relying on this for actual payroll.
  let tds = 0
  if (taxableIncome > 1500000) tds = (taxableIncome - 1500000) * 0.3 + 187500
  else if (taxableIncome > 1200000) tds = (taxableIncome - 1200000) * 0.2 + 90000
  else if (taxableIncome > 1000000) tds = (taxableIncome - 1000000) * 0.15 + 60000
  else if (taxableIncome > 700000) tds = (taxableIncome - 700000) * 0.1 + 20000
  else if (taxableIncome > 300000) tds = (taxableIncome - 300000) * 0.05

  const cess = tds * 0.04
  const surcharge = taxableIncome > 5000000 ? tds * 0.1 : 0
  return { tds: Math.round(tds), cess: Math.round(cess), surcharge: Math.round(surcharge), total: Math.round(tds + cess + surcharge) }
}
