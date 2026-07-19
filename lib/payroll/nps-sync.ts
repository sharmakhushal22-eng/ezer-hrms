// lib/payroll/nps-sync.ts — NPS → payroll calculate-engine helpers (NOT wired yet; payroll is a stub).
// ded_nps = round(basic_monthly × contribution_percent / 100). Only ACTIVE + effective_date <= period start.
export async function loadActiveNps(supabase: any, companyId: string, periodStart: string) {
  const { data } = await supabase.from('nps_declarations').select('*')
    .eq('company_id', companyId).eq('status', 'ACTIVE').lte('effective_date', periodStart)
  const map: Record<string, any> = {}
  for (const n of data ?? []) map[n.employee_id] = n
  return map
}
export function computeEmployeeNps(nps: any, basicMonthly: number): number {
  if (!nps) return 0
  return Math.round(basicMonthly * (nps.contribution_percent / 100))
}
