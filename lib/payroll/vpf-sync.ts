// lib/payroll/vpf-sync.ts — VPF → payroll calculate-engine helpers.
// NOT wired yet (the payroll calculate engine + payroll_lines table are a future module).
// When the engine exists: call loadActiveVpf() at run start, computeEmployeeVpf() per employee
// (after earnings), add ded_vpf to totalDeductions, and bulk-insert SYNCED_TO_PAYROLL audit at run end.
// VPF = EPF wage base × percent. base = min(monthly_gross − monthly_hra, epf_wage_limit).

const EPF_CEILING = 15000

// Fetch all ACTIVE VPF declarations for a company (once, outside the employee loop).
export async function loadActiveVpf(supabase: any, companyId: string, currentMonth: number) {
  const { data: vpfList } = await supabase
    .from('vpf_declarations').select('*')
    .eq('company_id', companyId).eq('status', 'ACTIVE')
    .lte('effective_from_month', currentMonth)
  const vpfMap: Record<string, any> = {}
  for (const v of vpfList ?? []) vpfMap[v.employee_id] = v
  return vpfMap
}

export function computeEpfWageBase(monthlyGross: number, monthlyHra: number, limit: number): number {
  const actual = Math.max(0, monthlyGross - monthlyHra)
  return Math.round(Math.min(actual, limit ?? EPF_CEILING))
}

export function computeEmployeeVpf(vpf: any, monthlyGross: number, monthlyHra: number): number {
  if (!vpf) return 0
  const base = computeEpfWageBase(monthlyGross, monthlyHra, vpf.epf_wage_limit)
  return Math.round(base * (vpf.vpf_percent / 100))
}
