// lib/supabase-statutory-leave.ts — Statutory Leave Reference data layer (migration 029)
// State-wise EL/CL/SL minimums (S&E Acts + Factories Act). Pure reference / advisory —
// admin maintains it like PT/LWF. getForState() is ready for the Leave Policy engine
// (auto-fill + below-minimum flag) once leave_policy is built.
import { supabase } from '@/lib/supabase'

export type ActType = 'SE' | 'FACTORY'
export interface StatutoryLeave {
  id: string
  state: string
  act_type: ActType
  fy: string
  el_days: number | null
  cl_days: number | null
  sl_days: number | null
  el_accrual_basis: string | null
  el_carry_forward_max: number | null
  cl_sl_lapse: boolean
  notes: string | null
  verified_by: string | null
  verified_on: string | null
  is_active: boolean
  created_at?: string
}
export type StatutoryInput = Omit<StatutoryLeave, 'id' | 'created_at'>

// ── Read ────────────────────────────────────────────────────────────
export async function loadStatutory(opts: { fy?: string; state?: string; actType?: ActType } = {}): Promise<StatutoryLeave[]> {
  let q = supabase.from('state_statutory_leave').select('*').order('state').order('act_type')
  if (opts.fy) q = q.eq('fy', opts.fy)
  if (opts.state) q = q.eq('state', opts.state)
  if (opts.actType) q = q.eq('act_type', opts.actType)
  const { data } = await q
  return (data || []) as StatutoryLeave[]
}

// Distinct FY values present (for the FY filter / copy dropdown).
export async function loadFYs(): Promise<string[]> {
  const { data } = await supabase.from('state_statutory_leave').select('fy')
  return [...new Set((data || []).map((r: any) => r.fy as string))].sort().reverse()
}

// ── Write ───────────────────────────────────────────────────────────
// Upsert respects UNIQUE(state, act_type, fy). Pass id to update an existing row.
export async function upsertStatutory(row: Partial<StatutoryLeave> & { state: string; act_type: ActType; fy: string }) {
  const payload: any = { ...row }
  delete payload.created_at
  if (!payload.id) delete payload.id
  return supabase.from('state_statutory_leave').upsert(payload, { onConflict: 'state,act_type,fy' }).select().maybeSingle()
}
export async function deleteStatutory(id: string) {
  return supabase.from('state_statutory_leave').delete().eq('id', id)
}

// Roll an FY forward: copy every row of fromFy into toFy (skips rows already in toFy).
export async function copyToFy(fromFy: string, toFy: string): Promise<{ inserted: number; error?: any }> {
  const src = await loadStatutory({ fy: fromFy })
  if (!src.length) return { inserted: 0 }
  const { data: existing } = await supabase.from('state_statutory_leave').select('state, act_type').eq('fy', toFy)
  const have = new Set((existing || []).map((r: any) => `${r.state}|${r.act_type}`))
  const rows = src
    .filter(r => !have.has(`${r.state}|${r.act_type}`))
    .map(r => ({
      state: r.state, act_type: r.act_type, fy: toFy,
      el_days: r.el_days, cl_days: r.cl_days, sl_days: r.sl_days,
      el_accrual_basis: r.el_accrual_basis, el_carry_forward_max: r.el_carry_forward_max,
      cl_sl_lapse: r.cl_sl_lapse, notes: r.notes, is_active: r.is_active,
      verified_by: null, verified_on: null, // a copied row must be re-verified
    }))
  if (!rows.length) return { inserted: 0 }
  const { error } = await supabase.from('state_statutory_leave').insert(rows)
  return { inserted: error ? 0 : rows.length, error }
}

// ── Leave Policy advisory hook (used at config time, when leave_policy exists) ──
// Returns the statutory floor for a branch: FACTORY row if it's a factory, else the
// state's SE row. Null if no reference row for that state/act/FY.
export async function getForState(state: string, isFactory: boolean, fy = '2026-27'): Promise<StatutoryLeave | null> {
  const { data } = await supabase.from('state_statutory_leave').select('*')
    .eq('state', isFactory ? 'ALL' : state)
    .eq('act_type', isFactory ? 'FACTORY' : 'SE')
    .eq('fy', fy).eq('is_active', true).maybeSingle()
  return (data as StatutoryLeave) || null
}
