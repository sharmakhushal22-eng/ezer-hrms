// ================================================================
// EZER HRMS — Minimum Wage — Wide Zone Entry
// Path: lib/minimum-wage/zoneActions.ts
// ================================================================
import { supabase } from '@/lib/supabase'

export interface ZoneRatesPivot {
  state: string
  zone: string
  unskilled: number
  semi_skilled: number
  skilled: number
  highly_skilled: number
  latest_effective_from: string
  single_effective_date: boolean
  notification_reference: string | null
}

export async function getZoneRates(): Promise<ZoneRatesPivot[]> {
  const { data } = await supabase.from('minimum_wage_pivot').select('*').order('state').order('zone')
  return (data ?? []) as ZoneRatesPivot[]
}

/** One call — state + zone + all 4 category rates + one w.e.f date, matching a real notification. */
export async function reviseZoneRates(args: {
  state: string; zone: string
  unskilled: number; semiSkilled: number; skilled: number; highlySkilled: number
  vdaUnskilled?: number; vdaSemiSkilled?: number; vdaSkilled?: number; vdaHighlySkilled?: number
  effectiveFrom: string
  notificationReference?: string
  createdBy?: string
}) {
  const { data, error } = await supabase.rpc('revise_zone_rates', {
    p_state: args.state, p_zone: args.zone,
    p_unskilled_basic: args.unskilled, p_unskilled_vda: args.vdaUnskilled ?? 0,
    p_semi_basic: args.semiSkilled, p_semi_vda: args.vdaSemiSkilled ?? 0,
    p_skilled_basic: args.skilled, p_skilled_vda: args.vdaSkilled ?? 0,
    p_highly_basic: args.highlySkilled, p_highly_vda: args.vdaHighlySkilled ?? 0,
    p_effective_from: args.effectiveFrom,
    p_notification_ref: args.notificationReference ?? null,
    p_created_by: args.createdBy ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}
