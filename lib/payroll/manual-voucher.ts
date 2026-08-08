// lib/payroll/manual-voucher.ts — Manual Voucher (Additional Heads) data layer.
// One-off Addition/Deduction amounts per employee per payroll month.
// Individual and Bulk both go through saveVoucher(), which is the only write path —
// so the replace behaviour and the audit trail can't diverge between the two tabs.
import { supabase } from '@/lib/supabase'

export interface VoucherHead { id: string; head_name: string; head_type: 'Addition' | 'Deduction'; sort_order: number; note: string | null }
export interface VoucherEntry {
  id: string; run_id: string; employee_id: string; employee_code: string
  head_name: string; head_type: string; amount: number; remark: string | null
  uploaded_via: string; source_file: string | null; updated_at: string
}
export interface VoucherAudit {
  id: string; employee_code: string; head_name: string; head_type: string
  action: 'CREATED' | 'REPLACED' | 'DELETED'
  old_amount: number | null; new_amount: number | null
  remark: string | null; uploaded_via: string | null; source_file: string | null; created_at: string
}

export async function loadVoucherHeads(): Promise<VoucherHead[]> {
  const { data } = await supabase.from('manual_voucher_heads').select('*').eq('is_active', true).order('sort_order')
  return (data as any) || []
}

export async function loadVoucherEntries(runIds: string[]): Promise<VoucherEntry[]> {
  if (!runIds.length) return []
  const { data } = await supabase.from('manual_voucher_entries').select('*').in('run_id', runIds).order('employee_code')
  return (data as any) || []
}

export async function loadVoucherAudit(runIds: string[], limit = 200): Promise<VoucherAudit[]> {
  if (!runIds.length) return []
  const { data } = await supabase.from('manual_voucher_audit_log').select('*')
    .in('run_id', runIds).order('created_at', { ascending: false }).limit(limit)
  return (data as any) || []
}

// The single write path. Returns CREATED or REPLACED.
export async function saveVoucher(args: {
  runId: string; empCode: string; headName: string; amount: number
  remark?: string | null; via?: 'INDIVIDUAL' | 'BULK'
  // The uploaded file's name, so the lists can say where an amount came from.
  // Null for a hand-typed entry, and a hand edit never blanks an existing file (sql95).
  sourceFile?: string | null
}): Promise<{ error: string | null; action: string | null }> {
  const base = {
    p_run_id: args.runId, p_employee_code: args.empCode, p_head_name: args.headName,
    p_amount: args.amount, p_remark: args.remark ?? null, p_via: args.via || 'INDIVIDUAL',
  }
  let { data, error } = await supabase.rpc('save_manual_voucher', { ...base, p_source_file: args.sourceFile ?? null })
  // Until sql95 is applied the function has no p_source_file and PostgREST can't resolve
  // the call at all. Fall back to the old signature so saving keeps working in that window
  // — the amount matters more than remembering which file it came from.
  if (error && /source_file|schema cache|could not find/i.test(error.message)) {
    ;({ data, error } = await supabase.rpc('save_manual_voucher', base))
  }
  if (error) return { error: error.message, action: null }
  return { error: null, action: ((data as any[]) || [])[0]?.action || null }
}

export async function deleteVoucher(entryId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('delete_manual_voucher', { p_entry_id: entryId })
  return { error: error?.message || null }
}
