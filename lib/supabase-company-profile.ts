// lib/supabase-company-profile.ts — Company Profile (Group → Company → Branch → Statutory)
// Reads the existing master tables (see lib/supabase-admin.ts) and writes an audit row
// on every edit. Billing/account-status from migration 027.
import { supabase } from '@/lib/supabase'

const num = (v: any) => (v === null || v === undefined || v === '') ? 0 : Number(v)

// ── Types (mirror the live master schema) ───────────────────────────
export interface Group { id: string; group_code: string; group_name: string; country: string; status: string }
export interface License {
  id: string; company_id: string; plan_name: string; max_employees: number; max_locations: number
  price_monthly: number; valid_from: string | null; valid_till: string | null; is_active: boolean
  billing_cycle: string | null; paid_till: string | null; grace_days: number | null
  account_status: string | null; next_due_date: string | null
}
export interface Registration {
  id: string; company_id: string; location_id: string | null; reg_type: string
  reg_number: string; state: string | null; district: string | null; dept_address: string | null
  valid_from: string | null; valid_till: string | null; status: string
}
export interface BankAccount {
  id: string; company_id: string; account_type: string; bank_name: string
  account_number: string; ifsc_code: string; branch_name: string | null; is_primary: boolean; status: string
}
export interface Branch {
  id: string; company_id: string; location_code: string; location_name: string; location_type: string
  address_line1: string | null; city: string | null; district: string | null; state: string | null
  pin_code: string | null; latitude: number | null; longitude: number | null
  max_employees: number | null; status: string
}
export interface Company {
  id: string; group_id: string; company_code: string; company_name: string; short_name: string | null
  company_type: string | null; industry: string | null; pan: string | null; tan: string | null; cin: string | null
  date_of_inc: string | null; reg_office: string | null; corp_office: string | null
  letterhead_header: string | null; letterhead_footer: string | null; status: string
  // assembled + computed
  branches: Branch[]; registrations: Registration[]; bank: BankAccount[]; license: License | null
  account_status: 'ACTIVE' | 'GRACE' | 'SUSPENDED'; days_to_due: number | null
}
export interface GroupTree extends Group { companies: Company[] }
export interface AuditRow {
  id: string; entity_type: string; entity_id: string; company_id: string | null; action: string
  field: string | null; old_value: string | null; new_value: string | null
  changed_by: string | null; note: string | null; changed_at: string
}
export interface BillingRow {
  id: string; company_id: string; period: string | null; amount: number | null
  valid_from: string | null; valid_till: string | null; paid_on: string | null
  confirmed_by: string | null; status: string; created_at: string
}

// entity → table map (audit + updates)
export const TABLE: Record<string, string> = {
  GROUP: 'groups', COMPANY: 'companies', LOCATION: 'locations',
  REGISTRATION: 'registrations', BANK: 'company_bank_accounts', LICENSE: 'license_plans',
}

// ── Account status (client-side, mirrors resolve_account_status) ────
function computeStatus(lic: License | null): { status: Company['account_status']; days: number | null } {
  if (!lic || !lic.paid_till) return { status: 'ACTIVE', days: null }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const paid = new Date(lic.paid_till + 'T00:00:00')
  const grace = new Date(paid); grace.setDate(grace.getDate() + (lic.grace_days ?? 30))
  const days = Math.round((paid.getTime() - today.getTime()) / 86400000)
  if (today <= paid) return { status: 'ACTIVE', days }
  if (today <= grace) return { status: 'GRACE', days }
  return { status: 'SUSPENDED', days }
}

// ── Load the full Group → Company → Branch → Statutory tree ─────────
export async function loadHierarchy(): Promise<GroupTree[]> {
  const [g, c, l, r, b, lic] = await Promise.all([
    supabase.from('groups').select('*').eq('status', 'Active').order('group_code'),
    supabase.from('companies').select('*').eq('status', 'Active').order('company_code'),
    supabase.from('locations').select('*').eq('status', 'Active').order('location_code'),
    supabase.from('registrations').select('*').eq('status', 'Active'),
    supabase.from('company_bank_accounts').select('*').eq('status', 'Active'),
    supabase.from('license_plans').select('*').eq('is_active', true),
  ])
  const groups = (g.data || []) as Group[]
  const locByCo = new Map<string, Branch[]>()
  for (const x of (l.data || [])) { const a = locByCo.get(x.company_id) || []; a.push({ ...x, latitude: x.latitude, longitude: x.longitude, max_employees: x.max_employees }); locByCo.set(x.company_id, a) }
  const regByCo = new Map<string, Registration[]>()
  for (const x of (r.data || [])) { const a = regByCo.get(x.company_id) || []; a.push(x); regByCo.set(x.company_id, a) }
  const bankByCo = new Map<string, BankAccount[]>()
  for (const x of (b.data || [])) { const a = bankByCo.get(x.company_id) || []; a.push(x); bankByCo.set(x.company_id, a) }
  const licByCo = new Map<string, License>()
  for (const x of (lic.data || [])) licByCo.set(x.company_id, { ...x, max_employees: num(x.max_employees), max_locations: num(x.max_locations), grace_days: x.grace_days })
  const cosByGroup = new Map<string, Company[]>()
  for (const co of (c.data || [])) {
    const license = licByCo.get(co.id) || null
    const { status, days } = computeStatus(license)
    const company: Company = {
      ...co,
      branches: locByCo.get(co.id) || [],
      registrations: regByCo.get(co.id) || [],
      bank: bankByCo.get(co.id) || [],
      license, account_status: status, days_to_due: days,
    }
    const arr = cosByGroup.get(co.group_id) || []; arr.push(company); cosByGroup.set(co.group_id, arr)
  }
  return groups.map(gr => ({ ...gr, companies: cosByGroup.get(gr.id) || [] }))
}

// ── Update an entity field-by-field, writing an audit row per change ─
export async function updateEntity(
  entityType: keyof typeof TABLE, id: string, patch: Record<string, any>,
  opts: { company_id?: string | null; changedBy?: string } = {},
) {
  const table = TABLE[entityType]
  const { data: before } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) return { error }
  const rows: any[] = []
  for (const k of Object.keys(patch)) {
    const oldV = before ? before[k] : null
    if (String(oldV ?? '') !== String(patch[k] ?? '')) {
      rows.push({
        entity_type: entityType, entity_id: id, company_id: opts.company_id ?? before?.company_id ?? null,
        action: 'UPDATE', field: k, old_value: oldV === null || oldV === undefined ? null : String(oldV),
        new_value: patch[k] === null || patch[k] === undefined ? null : String(patch[k]), changed_by: opts.changedBy || 'Admin',
      })
    }
  }
  if (rows.length) await supabase.from('company_master_audit').insert(rows)
  return { ok: true, changes: rows.length }
}

// ── Audit feed ───────────────────────────────────────────────────────
export async function loadAudit(company_id?: string, limit = 50): Promise<AuditRow[]> {
  let q = supabase.from('company_master_audit').select('*').order('changed_at', { ascending: false }).limit(limit)
  if (company_id) q = q.eq('company_id', company_id)
  const { data } = await q
  return (data || []) as AuditRow[]
}

// ── Billing ──────────────────────────────────────────────────────────
export async function loadBilling(company_id: string): Promise<BillingRow[]> {
  const { data } = await supabase.from('company_billing').select('*').eq('company_id', company_id).order('valid_till', { ascending: false })
  return (data || []).map((x: any) => ({ ...x, amount: x.amount === null ? null : num(x.amount) })) as BillingRow[]
}

// Confirm a quarter's payment: log it PAID + roll the licence paid_till forward.
export async function confirmPayment(input: {
  company_id: string; license_id: string; period: string; amount: number
  valid_from: string; valid_till: string; confirmedBy?: string
}) {
  const { error: be } = await supabase.from('company_billing').insert({
    company_id: input.company_id, period: input.period, amount: input.amount,
    valid_from: input.valid_from, valid_till: input.valid_till, paid_on: new Date().toISOString().slice(0, 10),
    confirmed_by: input.confirmedBy || 'Super Admin', status: 'PAID',
  })
  if (be) return { error: be }
  const next = new Date(input.valid_till + 'T00:00:00'); next.setDate(next.getDate() + 1)
  await updateEntity('LICENSE', input.license_id, {
    paid_till: input.valid_till, account_status: 'ACTIVE', next_due_date: next.toISOString().slice(0, 10),
  }, { company_id: input.company_id, changedBy: input.confirmedBy || 'Super Admin' })
  return { ok: true }
}

// ── Gender headcount ────────────────────────────────────────────────────────
// Counted from employees, per company and per location, in ONE query rather
// than one per branch: there are 10 locations today and there is no reason for
// this screen to make 11 round trips to answer a question about 398 rows.
//
// Leavers are excluded (date_of_leaving IS NULL), so this is a live headcount
// and not a historical one — the same rule the rest of the app counts by.

export interface GenderCount { male: number; female: number; other: number; unknown: number; total: number }
export interface HeadcountRow extends GenderCount { location_id: string | null }
export interface CompanyHeadcount {
  company: GenderCount
  byLocation: Record<string, GenderCount>
  /** Employees with no location_id — real people who would otherwise vanish
   *  from a branch-wise total that only adds up the branches. */
  unassigned: GenderCount
}

const zero = (): GenderCount => ({ male: 0, female: 0, other: 0, unknown: 0, total: 0 })

/** Gender is free text in this schema ('Male', 'Female', blanks). Normalise on
 *  read rather than trusting the column, and keep anything unrecognised in its
 *  own bucket instead of silently folding it into one of the two. */
function bump(g: GenderCount, raw: string | null) {
  const v = (raw || '').trim().toLowerCase()
  if (v === 'male' || v === 'm') g.male++
  else if (v === 'female' || v === 'f') g.female++
  else if (v) g.other++
  else g.unknown++
  g.total++
}

export async function loadHeadcount(): Promise<Record<string, CompanyHeadcount>> {
  const { data, error } = await supabase
    .from('employees')
    .select('company_id, location_id, gender')
    .is('date_of_leaving', null)
  if (error) throw error

  const out: Record<string, CompanyHeadcount> = {}
  for (const e of data ?? []) {
    const cid = (e as any).company_id as string | null
    if (!cid) continue
    const co = (out[cid] ||= { company: zero(), byLocation: {}, unassigned: zero() })
    bump(co.company, (e as any).gender)
    const lid = (e as any).location_id as string | null
    if (lid) bump((co.byLocation[lid] ||= zero()), (e as any).gender)
    else bump(co.unassigned, (e as any).gender)
  }
  return out
}
