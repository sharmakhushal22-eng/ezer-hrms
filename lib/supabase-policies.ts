// lib/supabase-policies.ts — Company Policies config (migration 033)
// Admin manages per-company policies that drive the onboarding Phase-9 ACK step.
import { supabase } from '@/lib/supabase'

export interface CompanyPolicy {
  id: string
  company_id: string
  policy_code: string
  policy_title: string
  policy_body: string
  is_mandatory: boolean
  sort_order: number
  is_active: boolean
  version: string
  created_at?: string
  updated_at?: string
}
export interface CompanyLite { id: string; name: string; code?: string }

export async function loadCompaniesLite(): Promise<CompanyLite[]> {
  const { data } = await supabase.from('companies').select('id, company_name, company_code').eq('status', 'Active').order('company_name')
  return (data || []).map((c: any) => ({ id: c.id, name: c.company_name, code: c.company_code }))
}

// All policies for a company (admin sees inactive too).
export async function loadPolicies(company_id: string): Promise<CompanyPolicy[]> {
  const { data } = await supabase.from('company_policies').select('*').eq('company_id', company_id).order('sort_order')
  return (data || []) as CompanyPolicy[]
}

// Bump minor version on edit (1.0 → 1.1), keep major.
function bumpVersion(v: string): string {
  const [maj, min] = (v || '1.0').split('.').map(n => parseInt(n, 10))
  return `${Number.isFinite(maj) ? maj : 1}.${(Number.isFinite(min) ? min : 0) + 1}`
}

// Add or edit. On edit (existing row) the version auto-increments so already-acked
// candidates keep their original version in onboarding_policy_acks.
export async function savePolicy(input: {
  id?: string; company_id: string; policy_code: string; policy_title: string
  policy_body: string; is_mandatory: boolean; sort_order: number; version?: string
}) {
  if (input.id) {
    const { data: cur } = await supabase.from('company_policies').select('version').eq('id', input.id).maybeSingle()
    return supabase.from('company_policies').update({
      policy_code: input.policy_code, policy_title: input.policy_title, policy_body: input.policy_body,
      is_mandatory: input.is_mandatory, sort_order: input.sort_order,
      version: bumpVersion(cur?.version || '1.0'), updated_at: new Date().toISOString(),
    }).eq('id', input.id)
  }
  return supabase.from('company_policies').insert({
    company_id: input.company_id, policy_code: input.policy_code, policy_title: input.policy_title,
    policy_body: input.policy_body, is_mandatory: input.is_mandatory, sort_order: input.sort_order,
    is_active: true, version: input.version || '1.0',
  })
}

export async function togglePolicy(id: string, is_active: boolean) {
  return supabase.from('company_policies').update({ is_active, updated_at: new Date().toISOString() }).eq('id', id)
}
// Soft delete (compliance: keep the row, hide from new flows).
export async function softDeletePolicy(id: string) {
  return supabase.from('company_policies').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id)
}
