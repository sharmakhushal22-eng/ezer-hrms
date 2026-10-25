// src/features/payroll-tax/claims/data.ts — Flexi Claims data layer.
//
// SOURCE: lib/flexi/claims.ts (imports @/lib/supabase, so it is re-implemented here
// with the same queries, in the same order) and the fetches in
// components/ess/FlexiClaims.tsx (load, submitAll, sendLimitRequest).
//
// /api/flexi/claims: the website sends no auth header and the server trusts
// employee_id. The app sends the same bodies / query through core/api, which also
// adds the ESS bearer token (ignored by that route today).
import { Platform } from 'react-native'
import { api, ApiError, type PickedFile } from '@/core/api'
import { supabase } from '@/core/supabase'

export const NO_INVOICE = ['MEAL', 'DEVICE']   // auto-claimed, no bill needed
export const ACCEPTED_TYPES = '.zip,.png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx'
export const ACCEPTED_MIME = [
  'application/zip', 'application/x-zip-compressed', 'image/png', 'image/jpeg', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
export const FY = '2026-27'

export const COMP_NAMES: Record<string, string> = {
  PDA: 'Prof. Dev. Allowance', TEL: 'Telephone / WiFi', DEVICE: 'Device Leasing',
  LTA: 'Leave Travel Allowance', CAR: 'Car Lease', DRIVER: 'Driver Allowance', FUEL: 'Fuel Reimbursement',
  MEAL: 'Meal (Zaggle)', ATTIRE: 'Corporate Attire', CHEDU: "Children's Education", HOSTEL: 'Hostel Allowance',
}
const FORM_KEY_TO_CODE: Record<string, string> = {
  pda: 'PDA', tel: 'TEL', device: 'DEVICE', lta: 'LTA', car: 'CAR', driver: 'DRIVER',
  fuel: 'FUEL', meal: 'MEAL', attire: 'ATTIRE', childEdu: 'CHEDU', hostel: 'HOSTEL',
}

export interface ComponentLimit {
  code: string; name: string; annual_limit: number
  claimed: number; approved: number; pending: number; rejected: number
  overridden: boolean
}
export interface HistItem {
  id: string; component_code: string; claim_amount: number; bill_date: string | null; bill_no: string | null
  agency_name: string | null; vendor_desc: string | null; remark: string | null; status: string; rejection_reason: string | null; submitted_at: string
}

const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)

async function annualFixed(employeeId: string): Promise<number> {
  const { data: ss } = await supabase.from('salary_structures')
    .select('gross_monthly, employer_pf, employer_esic, gratuity_monthly').eq('employee_id', employeeId)
    .order('effective_date', { ascending: false }).limit(1)
  if (ss?.[0]) {
    const s: any = ss[0]
    return (n(s.gross_monthly) + n(s.employer_pf) + n(s.employer_esic) + n(s.gratuity_monthly)) * 12
  }
  const { data: cm } = await supabase.from('ctc_master').select('annual_ctc, annual_variable')
    .eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1)
  if (cm?.[0]) return n((cm[0] as any).annual_ctc) - n((cm[0] as any).annual_variable)
  return 0
}

/** GET /api/flexi/claims?employee_id= — `{ claims }`, or null when the route fails. */
export async function fetchClaims(employeeId: string): Promise<any[] | null> {
  try {
    const j = await api<any>(`/api/flexi/claims?employee_id=${encodeURIComponent(employeeId)}`)
    return Array.isArray(j?.claims) ? j.claims : null
  } catch { return null }
}

async function loadClaimsForEmployee(employeeId: string): Promise<any[]> {
  const viaApi = await fetchClaims(employeeId)
  if (viaApi) return viaApi
  const { data } = await supabase.from('flexi_claims')
    .select('component_code, claim_amount, status').eq('employee_id', employeeId)
  return data || []
}

/** lib/flexi/claims.ts loadEntitlements(), step for step. */
export async function loadEntitlements(employeeId: string): Promise<{
  companyId: string | null; regime: 'old' | 'new'; fixed: number; slabLabel: string | null; limits: ComponentLimit[]
}> {
  const { data: emp } = await supabase.from('employees').select('company_id, tds_regime').eq('id', employeeId).maybeSingle()
  const companyId = (emp as any)?.company_id || null
  const regime: 'old' | 'new' = String((emp as any)?.tds_regime || '').toLowerCase().includes('new') ? 'new' : 'old'
  const fixed = await annualFixed(employeeId)
  if (!companyId) return { companyId, regime, fixed, slabLabel: null, limits: [] }

  const { data: slabs } = await supabase.from('flexi_policy_slabs').select('*')
    .eq('company_id', companyId).eq('is_active', true).order('sort_order')
  const slab: any = (slabs || []).find((sl: any) => fixed >= n(sl.fixed_from) && fixed <= n(sl.fixed_to)) || (slabs || [])[slabs?.length ? slabs.length - 1 : 0]

  const perComp: Record<string, number> = {}
  if (slab) {
    const [{ data: sl }, { data: comps }] = await Promise.all([
      supabase.from('flexi_slab_limits').select('*').eq('slab_id', slab.id).eq('is_active', true),
      supabase.from('flexi_components').select('id, code'),
    ])
    const codeById: Record<string, string> = {}
    ;(comps || []).forEach((c: any) => { codeById[c.id] = c.code })
    ;(sl || []).forEach((l: any) => {
      const code = codeById[l.component_id]
      if (!code) return
      const max = regime === 'old' ? l.old_regime_max : l.new_regime_max
      if (max != null && Number(max) > 0) perComp[code] = Number(max)
    })
  }

  const { data: decls } = await supabase.from('flexi_declarations')
    .select('component_code, old_regime_amt, new_regime_amt').eq('employee_id', employeeId).eq('fy', FY)
  ;(decls || []).forEach((d: any) => {
    const amt = Math.max(n(d.old_regime_amt), n(d.new_regime_amt))
    if (amt > 0) perComp[d.component_code] = amt
  })

  const { data: formRow } = await supabase.from('flexi_tds_forms')
    .select('form_data, regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
  let fd: any = (formRow as any)?.form_data
  if (typeof fd === 'string') { try { fd = JSON.parse(fd) } catch { fd = null } }
  if (fd) {
    const chosen = String((formRow as any)?.regime || regime).toLowerCase().includes('new') ? 'new' : 'old'
    const src = chosen === 'new' ? (fd.nFlexi || {}) : (fd.oFlexi || {})
    for (const key of Object.keys(perComp)) delete perComp[key]
    Object.keys(FORM_KEY_TO_CODE).forEach(k => {
      const amt = n(src[k])
      if (amt > 0) perComp[FORM_KEY_TO_CODE[k]] = amt
    })
  }

  const { data: ovrs } = await supabase.from('flexi_limit_overrides')
    .select('component_code, override_limit').eq('employee_id', employeeId).eq('fy', FY).eq('is_active', true)
  const ovrSet = new Set<string>()
  ;(ovrs || []).forEach((o: any) => { perComp[o.component_code] = n(o.override_limit); ovrSet.add(o.component_code) })

  const claims = await loadClaimsForEmployee(employeeId)
  const tot: Record<string, { claimed: number; approved: number; pending: number; rejected: number }> = {}
  ;(claims || []).forEach((c: any) => {
    const t = tot[c.component_code] || (tot[c.component_code] = { claimed: 0, approved: 0, pending: 0, rejected: 0 })
    const amt = n(c.claim_amount)
    if (c.status === 'APPROVED' || c.status === 'PAYROLL_PROCESSED') { t.approved += amt; t.claimed += amt }
    else if (c.status === 'PENDING') { t.pending += amt; t.claimed += amt }
    else if (c.status === 'REJECTED') t.rejected += amt
  })

  const limits: ComponentLimit[] = Object.keys(perComp).sort().map(code => {
    const t = tot[code] || { claimed: 0, approved: 0, pending: 0, rejected: 0 }
    return { code, name: COMP_NAMES[code] || code, annual_limit: perComp[code], ...t, overridden: ovrSet.has(code) }
  })
  return { companyId, regime, fixed, slabLabel: slab?.slab_label || null, limits }
}

export async function loadWindow(companyId: string, year: number, month: number) {
  const { data } = await supabase.from('flexi_windows').select('*')
    .eq('company_id', companyId).eq('year', year).eq('month', month).maybeSingle()
  return data as any
}

/** FlexiClaims.tsx load(). The month is the device's local month, as on the website. */
export async function loadFlexiClaims(employeeId: string) {
  const ent = await loadEntitlements(employeeId)
  let win: any = null
  if (ent.companyId) {
    const now = new Date()
    win = await loadWindow(ent.companyId, now.getFullYear(), now.getMonth() + 1)
  }
  const hist = ((await fetchClaims(employeeId)) || []) as HistItem[]
  // "days left" is worked out against the moment of loading (render must stay pure).
  return { ...ent, win, hist, now: Date.now() }
}

/** POST { action:'SUBMIT', … } → { success, claim_id } | { error }. Never throws. */
export async function submitClaim(body: Record<string, any>): Promise<{ claim_id?: string; error?: string }> {
  try { return await api<any>('/api/flexi/claims', { method: 'POST', body: { action: 'SUBMIT', ...body } }) }
  catch (e: any) { return { error: e instanceof ApiError ? e.message : e?.message } }
}

/** POST { action:'REQUEST_LIMIT', … } → { success, request_id } | { error }. Never throws. */
export async function requestLimit(body: Record<string, any>): Promise<{ request_id?: string; error?: string }> {
  try { return await api<any>('/api/flexi/claims', { method: 'POST', body: { action: 'REQUEST_LIMIT', ...body } }) }
  catch (e: any) { return { error: e instanceof ApiError ? e.message : (e?.message || 'failed') } }
}

/** The bytes of a picked file, for a Supabase Storage upload. */
async function fileBody(file: PickedFile): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(file.uri)).blob()
  const { File } = await import('expo-file-system')
  return new File(file.uri).arrayBuffer()
}

/** One bill file → storage `flexi-bills` + a flexi_claim_files row. Failures are silent (as on the website). */
export async function uploadBillFile(employeeId: string, claimId: string, file: PickedFile) {
  try {
    const path = `flexi-claims/${employeeId}/${claimId}/${Date.now()}_${file.name}`
    const body = await fileBody(file)
    const { data: up } = await supabase.storage.from('flexi-bills').upload(path, body, { contentType: file.type || undefined })
    if (up) await supabase.from('flexi_claim_files').insert({ claim_id: claimId, employee_id: employeeId, file_type: 'BILL', file_name: file.name, file_url: path, file_size: file.size ?? null, mime_type: file.type })
  } catch { /* silent, as on the website */ }
}
