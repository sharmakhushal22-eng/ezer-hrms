// ================================================================
// EZER HRMS — Professional Tax — Data Access
// Path: lib/pt/actions.ts
//
// getPtAmount() is the ONE function payroll calls per employee per
// month — it already resolves the correct salary slab AND the
// correct month's amount (which can genuinely differ within the same
// slab — Maharashtra's February, Tamil Nadu/Kerala's twice-yearly
// pattern) — the caller never special-cases any of that.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { PtConfig, PtResult, Gender } from './types'

export async function getCurrentPtSlabs(state?: string): Promise<PtConfig[]> {
  let query = supabase.from('pt_config').select('*').is('effective_to', null).order('state').order('slab_min')
  if (state) query = query.eq('state', state)
  const { data } = await query
  return (data ?? []) as PtConfig[]
}

export async function getPtStates(): Promise<string[]> {
  const { data } = await supabase.from('pt_config').select('state').is('effective_to', null)
  return Array.from(new Set((data ?? []).map((r: any) => r.state))).sort()
}

/** THE monthly payroll call. */
export async function getPtAmount(args: {
  state: string; grossSalary: number; periodMonth: string; gender?: Gender
}): Promise<PtResult> {
  const { data, error } = await supabase.rpc('get_pt_amount', {
    p_state: args.state, p_gross_salary: args.grossSalary,
    p_period_month: args.periodMonth, p_gender: args.gender ?? 'ALL',
  })
  if (error) throw new Error(error.message)
  return (data as PtResult[])[0]
}

/** Add or revise a single slab row — closes any exact-match open row first (same state+slab+gender), then inserts the new one. */
export async function reviseSlab(args: {
  state: string; slabMin: number; slabMax: number | null; gender: Gender
  amounts: number[] // 12 values, Jan..Dec
  effectiveFrom: string; notificationReference?: string; createdBy?: string
}) {
  const closeDate = new Date(args.effectiveFrom)
  closeDate.setDate(closeDate.getDate() - 1)

  await supabase.from('pt_config')
    .update({ effective_to: closeDate.toISOString().slice(0, 10) })
    .eq('state', args.state).eq('slab_min', args.slabMin).eq('gender', args.gender)
    .is('effective_to', null)

  const [jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec] = args.amounts

  const { data, error } = await supabase.from('pt_config').insert({
    state: args.state, slab_min: args.slabMin, slab_max: args.slabMax, gender: args.gender,
    jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec,
    effective_from: args.effectiveFrom, effective_to: null,
    notification_reference: args.notificationReference ?? null, created_by: args.createdBy ?? null,
  }).select().single()

  if (error) throw new Error(error.message)
  return data as PtConfig
}
