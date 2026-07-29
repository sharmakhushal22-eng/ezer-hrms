// ================================================================
// EZER HRMS — EPF — Data Access
// Path: lib/epf/actions.ts
//
// calculateEpfContribution() handles BOTH domestic employees and
// International Workers in one call — pass isInternationalWorker and
// hasCertificateOfCoverage (both default false, so existing domestic-
// employee call sites don't need to change). calculateEpfCharges() is
// separate — EDLI/Admin are establishment-level employer costs, not
// part of the employee/employer contribution split.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { EpfConfig, EpfCalculationResult, EpfChargesResult } from './types'

export async function getCurrentEpfConfig(): Promise<EpfConfig | null> {
  const { data } = await supabase.from('epf_config').select('*').is('effective_to', null).maybeSingle()
  return data as EpfConfig | null
}

export async function calculateEpfContribution(args: {
  grossWage: number; hra: number; pfGrossLimit: number
  useReducedRate?: boolean
  isInternationalWorker?: boolean; hasCertificateOfCoverage?: boolean
  asOf?: string
}): Promise<EpfCalculationResult> {
  const { data, error } = await supabase.rpc('calculate_epf_contribution', {
    p_gross_wage: args.grossWage, p_hra: args.hra, p_pf_gross_limit: args.pfGrossLimit,
    p_use_reduced_rate: args.useReducedRate ?? false,
    p_is_international_worker: args.isInternationalWorker ?? false,
    p_has_certificate_of_coverage: args.hasCertificateOfCoverage ?? false,
    p_as_of: args.asOf ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw new Error(error.message)
  return (data as EpfCalculationResult[])[0]
}

/** EDLI + Admin charges — establishment-level employer cost, pro-rated by paid days. */
export async function calculateEpfCharges(args: {
  paidDays: number; daysInMonth: number; hasContributingMembers?: boolean; asOf?: string
}): Promise<EpfChargesResult> {
  const { data, error } = await supabase.rpc('calculate_epf_charges', {
    p_paid_days: args.paidDays, p_days_in_month: args.daysInMonth,
    p_has_contributing_members: args.hasContributingMembers ?? true,
    p_as_of: args.asOf ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw new Error(error.message)
  return (data as EpfChargesResult[])[0]
}

export async function getIwReturnDueDate(periodMonth: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_iw_return_due_date', { p_period_month: periodMonth })
  if (error) throw new Error(error.message)
  return data as string | null
}

export async function companyNeedsIwNilReturn(companyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('company_needs_iw_nil_return', { p_company_id: companyId })
  if (error) throw new Error(error.message)
  return data as boolean
}
