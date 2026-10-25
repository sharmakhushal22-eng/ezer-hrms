// Travel Claims data — components/ess/TravelClaims.tsx load() and uploadBill(),
// plus the RouteData shape from components/travel/RouteMap.tsx.
//
// The five reads the website runs straight against Supabase are copied verbatim
// (same tables, columns, filters, order). Everything that writes goes through
// /api/travel/*, which checks the bearer token and applies the server-side
// guards (employee active, month open, bill age) the website relies on.
import { supabase } from '@/core/supabase'
import { appendFile, type PickedFile } from '@/core/api'
import type { LatLng } from '@web/travel/polyline'
import { call, isNetwork } from '../shared'

export interface ExpenseType {
  id: string; type_code: string; type_name: string
  calc_method: 'PER_KM' | 'ACTUAL' | 'ZERO'
  bill_threshold: number; allowed_local: boolean
  requires_vehicle: boolean; requires_gps: boolean; bill_required: boolean
  category: string | null
}
export interface Vehicle {
  id: string; vehicle_type: 'CAR' | 'TWO_WHEELER'
  fuel_type: string; cubic_capacity: number | null
  registration_no: string | null; is_verified: boolean
}
export interface TravelLog {
  id: string; log_date: string; purpose: string; type_code: string
  city: string | null; distance_claimed: number | null
  computed_fare: number; amount_entered: number
  toll_amount: number; parking_amount: number; total_amount: number
  distance_source: string | null; rate_applied: number | null
  status: string; claim_id: string | null
}
export interface Claim {
  id: string; claim_no: string; period_from: string | null; period_to: string | null
  total_claimed: number; total_approved: number; net_payable: number
  status: string; submitted_at: string | null; paid_at: string | null
  line_count: number; flag_count: number
}
export interface Flag { flag_type: string; severity: 'WARN' | 'BLOCK'; message: string }
export interface Bill {
  id: string; file_name: string | null; mime_type: string | null
  file_size: number | null; url: string | null; attachment_type: string
}
export interface RouteData {
  actual: { distance_km: number; source: string; polyline: string; points: LatLng[] }
  optimal: { distance_km: number; duration_min: number | null; polyline: string; points: LatLng[] } | null
  comparison: { excess_km: number | null; excess_pct: number | null }
  raw_trail_km: number
  trail: {
    recorded_points: number; used_points: number
    dropped_accuracy: number; dropped_drift: number; dropped_jump: number
    mean_accuracy_m: number | null; duration_min: number; avg_speed_kmph: number | null
  }
  maps_configured: boolean
  concerns: { code: string; severity: 'WARN' | 'BLOCK'; message: string }[]
}

export const CATEGORY_LABEL: Record<string, string> = {
  CONVEYANCE: 'Local conveyance', OUTSTATION: 'Outstation travel', STAY: 'Stay', ALLOWANCE: 'Allowances',
  COMMUNICATION: 'Communication', DOCUMENTATION: 'Travel documents', CLIENT: 'Client facing', OTHER: 'Other',
}
export const CATEGORY_ORDER = ['CONVEYANCE', 'OUTSTATION', 'STAY', 'ALLOWANCE', 'COMMUNICATION', 'DOCUMENTATION', 'CLIENT', 'OTHER']

export const num = (v: unknown) => Number(v) || 0
/** TravelClaims.tsx today() — the UTC date, exactly as the website computes it. */
export const today = () => new Date().toISOString().slice(0, 10)

export interface TravelData {
  blocked: string | null
  types: ExpenseType[]
  vehicles: Vehicle[]
  rates: { type_code: string | null; rate_per_km: number }[]
  logs: TravelLog[]
  claims: Claim[]
}
const EMPTY: Omit<TravelData, 'blocked'> = { types: [], vehicles: [], rates: [], logs: [], claims: [] }

/** TravelClaims.tsx load(). Never throws: every failure becomes the website's `blocked` text. */
export async function loadTravel(employeeId: string): Promise<TravelData> {
  try {
    const { data: emp } = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
    const companyId = (emp as any)?.company_id
    if (!companyId) return { ...EMPTY, blocked: 'Your employee record has no company mapped.' }

    const [{ data: ts }, { data: vs }] = await Promise.all([
      supabase.from('travel_expense_types').select('*').eq('company_id', companyId).eq('is_active', true).order('sort_order'),
      supabase.from('travel_employee_vehicles').select('*').eq('employee_id', employeeId).eq('is_active', true),
    ])
    const types = (ts ?? []) as ExpenseType[]
    const vehicles = (vs ?? []) as Vehicle[]

    let rates: TravelData['rates'] = []
    const { data: pol } = await supabase.from('travel_policies')
      .select('id').eq('company_id', companyId).eq('is_active', true)
      .order('effective_from', { ascending: false }).limit(1)
    if (pol?.[0]) {
      const { data: rs } = await supabase.from('travel_mileage_rates')
        .select('type_code, rate_per_km, effective_from')
        .eq('policy_id', (pol[0] as any).id).lte('effective_from', today())
        .order('effective_from', { ascending: false })
      // First row per type_code wins — the list is newest-first.
      const seen = new Set<string>()
      rates = ((rs ?? []) as any[]).filter(r => {
        const k = r.type_code ?? ''
        if (!k || seen.has(k)) return false
        seen.add(k); return true
      })
    }

    const monthStart = today().slice(0, 8) + '01'
    const [logRes, claimRes] = await Promise.all([
      call('/api/travel/logs', { query: { employee_id: employeeId, from: monthStart, to: today() } }),
      call('/api/travel/claims', { query: { employee_id: employeeId } }),
    ])
    if (logRes.status === 403) return { ...EMPTY, blocked: logRes.body.error || 'Your access to the travel module has ended.' }

    return {
      blocked: null, types, vehicles, rates,
      logs: (logRes.body.logs ?? []) as TravelLog[],
      claims: (claimRes.body.claims ?? []) as Claim[],
    }
  } catch {
    return { ...EMPTY, blocked: 'Could not load your travel claims. Please try again.' }
  }
}

/** TravelClaims.tsx uploadBill — one slip against a journey, multipart, Content-Type left to fetch. */
export async function uploadBill(logId: string, file: PickedFile): Promise<{ ok: boolean; message: string }> {
  const fd = new FormData()
  fd.append('travel_log_id', logId)
  await appendFile(fd, 'file', file)
  fd.append('attachment_type', 'BILL')
  try {
    const r = await call('/api/travel/upload-bill', { method: 'POST', form: fd })
    const j = r.body
    return { ok: r.ok, message: j.error || j.message || (r.ok ? 'Bill attached.' : 'Upload failed.') }
  } catch (e) {
    return { ok: false, message: isNetwork(e) ? 'Could not reach the server. Please try again.' : 'Upload failed.' }
  }
}

export async function loadBills(logId: string): Promise<Bill[]> {
  const r = await call('/api/travel/upload-bill', { query: { travel_log_id: logId } })
  return r.ok ? ((r.body.attachments ?? []) as Bill[]) : []
}
