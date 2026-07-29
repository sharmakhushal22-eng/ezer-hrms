// ================================================================
// EZER HRMS — Perquisite Configuration — Data Access
// Path: lib/perquisites/actions.ts
// ================================================================
import { supabase } from '@/lib/supabase'
import type { PerquisiteConfigRow, PerquisiteSlab, ValuationMethod, PerquisiteUnit } from './types'

export async function getPerquisiteConfig(fy: string): Promise<PerquisiteConfigRow[]> {
  const { data, error } = await supabase
    .from('perquisite_config_active')
    .select('*')
    .or(`fy.eq.${fy},fy.is.null`)
    .order('category').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as PerquisiteConfigRow[]
}

export async function getSlabsForValue(perquisiteValueId: string): Promise<PerquisiteSlab[]> {
  const { data } = await supabase
    .from('perquisite_slabs')
    .select('*')
    .eq('perquisite_value_id', perquisiteValueId)
    .order('sort_order')
  return (data ?? []) as PerquisiteSlab[]
}

/** "+ Add new perquisite" — the whole point of this table design: no migration needed for this. */
export async function addPerquisiteType(args: {
  code: string; name: string; category: string; description?: string
  valuationMethod: ValuationMethod; lawReference?: string; createdBy?: string
}) {
  const { data, error } = await supabase.from('perquisite_types').insert({
    code: args.code, name: args.name, category: args.category,
    description: args.description ?? null, valuation_method: args.valuationMethod,
    law_reference: args.lawReference ?? null, created_by: args.createdBy ?? null,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function savePerquisiteValue(args: {
  perquisiteTypeId: string; fy: string
  defaultAmount?: number | null; defaultPercent?: number | null
  unit?: PerquisiteUnit | null; exemptionLimit?: number | null
  isTaxable: boolean; notes?: string; createdBy?: string
}) {
  const { data, error } = await supabase.from('perquisite_values').upsert({
    perquisite_type_id: args.perquisiteTypeId, fy: args.fy,
    default_amount: args.defaultAmount ?? null, default_percent: args.defaultPercent ?? null,
    unit: args.unit ?? null, exemption_limit: args.exemptionLimit ?? null,
    is_taxable: args.isTaxable, notes: args.notes ?? null, created_by: args.createdBy ?? null,
  }, { onConflict: 'perquisite_type_id,fy' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function saveSlab(args: {
  perquisiteValueId: string; slabLabel: string
  conditionKey?: string; conditionValue?: string
  rateAmount?: number | null; ratePercent?: number | null; sortOrder: number
}) {
  const { data, error } = await supabase.from('perquisite_slabs').upsert({
    perquisite_value_id: args.perquisiteValueId, slab_label: args.slabLabel,
    condition_key: args.conditionKey ?? null, condition_value: args.conditionValue ?? null,
    rate_amount: args.rateAmount ?? null, rate_percent: args.ratePercent ?? null,
    sort_order: args.sortOrder,
  }, { onConflict: 'perquisite_value_id,slab_label' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteSlab(slabId: string) {
  const { error } = await supabase.from('perquisite_slabs').delete().eq('id', slabId)
  if (error) throw new Error(error.message)
}

export async function togglePerquisiteActive(typeId: string, isActive: boolean) {
  const { error } = await supabase.from('perquisite_types').update({ is_active: isActive }).eq('id', typeId)
  if (error) throw new Error(error.message)
}
