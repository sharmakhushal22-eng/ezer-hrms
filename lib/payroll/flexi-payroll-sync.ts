// lib/payroll/flexi-payroll-sync.ts — pulls approved flexi claims into a payroll run.
// Called by the payroll engine during the CALCULATE step.
import { supabase } from '@/lib/supabase'

export interface FlexiSyncResult {
  employee_id: string
  total_flexi_reimbursement: number
  components: { code: string; amount: number }[]
}

function monthRange(year: number, cmonth: number) {
  const from = `${year}-${String(cmonth).padStart(2, '0')}-01`
  const to = cmonth >= 12 ? `${year + 1}-01-01` : `${year}-${String(cmonth + 1).padStart(2, '0')}-01`
  return { from, to }
}

// Approved (not-yet-processed) flexi claims for a company's calendar month → per-employee totals.
export async function loadApprovedFlexiClaims(companyId: string, year: number, cmonth: number): Promise<Map<string, FlexiSyncResult>> {
  const { from, to } = monthRange(year, cmonth)
  const { data: claims } = await supabase.from('flexi_claims')
    .select('employee_id, component_code, claim_amount')
    .eq('company_id', companyId).eq('status', 'APPROVED').is('payroll_run_id', null)
    .gte('submitted_at', from).lt('submitted_at', to)

  const result = new Map<string, FlexiSyncResult>()
  for (const c of (claims || []) as any[]) {
    const id = c.employee_id
    const e = result.get(id) || { employee_id: id, total_flexi_reimbursement: 0, components: [] }
    e.total_flexi_reimbursement += Number(c.claim_amount) || 0
    e.components.push({ code: c.component_code, amount: Number(c.claim_amount) || 0 })
    result.set(id, e)
  }
  return result
}

// After DISBURSED: stamp claims as processed so they aren't paid twice.
export async function markFlexiAsProcessed(runId: string, companyId: string, year: number, cmonth: number) {
  const { from, to } = monthRange(year, cmonth)
  await supabase.from('flexi_claims')
    .update({ status: 'PAYROLL_PROCESSED', payroll_run_id: runId })
    .eq('company_id', companyId).eq('status', 'APPROVED').is('payroll_run_id', null)
    .gte('submitted_at', from).lt('submitted_at', to)
}

// Auto-claim no-invoice components (MEAL, DEVICE) at window close — auto-approved.
// Source = the employee's Flexi & TDS Calculator declaration (flexi_tds_forms), using
// their CHOSEN regime, mapped code→form-key (meal→meal, device→device).
export async function autoClaimNoInvoiceComponents(windowId: string, companyId: string) {
  const NO_INVOICE: { code: string; key: string }[] = [{ code: 'MEAL', key: 'meal' }, { code: 'DEVICE', key: 'device' }]
  const { data: forms } = await supabase.from('flexi_tds_forms')
    .select('employee_id, regime, form_data').eq('company_id', companyId)
  let created = 0
  for (const f of (forms || []) as any[]) {
    let fd: any = f.form_data
    if (typeof fd === 'string') { try { fd = JSON.parse(fd) } catch { fd = null } }
    if (!fd) continue
    const chosen = String(f.regime || '').toLowerCase().includes('new') ? 'new' : 'old'
    const src = chosen === 'new' ? (fd.nFlexi || {}) : (fd.oFlexi || {})
    for (const { code, key } of NO_INVOICE) {
      const monthly = Math.round((Number(src[key]) || 0) / 12)
      if (!monthly) continue
      const { data: exists } = await supabase.from('flexi_claims').select('id')
        .eq('window_id', windowId).eq('employee_id', f.employee_id).eq('component_code', code).maybeSingle()
      if (exists) continue
      await supabase.from('flexi_claims').insert({
        window_id: windowId, employee_id: f.employee_id, company_id: companyId,
        component_code: code, claim_amount: monthly,
        status: 'APPROVED', ai_flag: 'clear', remark: 'Auto-claimed — no invoice required',
      })
      created++
    }
  }
  return created
}
