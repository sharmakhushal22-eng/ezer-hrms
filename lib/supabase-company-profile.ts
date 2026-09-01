// lib/supabase-company-profile.ts — Company Profile (Group → Company → Branch → Statutory)
// Reads the existing master tables (see lib/supabase-admin.ts) and writes an audit row
// on every edit. Billing/account-status from migration 027.
import { supabase } from '@/lib/supabase'

const num = (v: any) => (v === null || v === undefined || v === '') ? 0 : Number(v)

// ── Types (mirror the live master schema) ───────────────────────────
export interface Group {
  id: string; group_code: string; group_name: string; country: string; status: string
  logo_url?: string | null
  // ── Added by 079. Optional, so the app compiles and runs before that
  // migration is applied: select('*') simply does not return them and every
  // reader treats them as absent.
  tagline?: string | null; description?: string | null; website_url?: string | null
  icon_emoji?: string | null
  holding_pan?: string | null; holding_cin?: string | null; incorporated_on?: string | null
  head_office?: string | null; contact_email?: string | null; contact_phone?: string | null
  brand_primary?: string | null; brand_secondary?: string | null
}
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
  gstin?: string | null; epf_code?: string | null; esic_code?: string | null; logo_url?: string | null
  // ── Added by 077. Optional on purpose: until that migration runs these
  // columns do not exist, select('*') does not return them, and every reader
  // here must treat them as absent rather than as empty. The screen degrades
  // to "Not recorded" instead of breaking.
  duns_number?: string | null; website_url?: string | null; timezone?: string | null
  currency?: string | null; fy_start_month?: number | null
  structure_type?: string | null; approved_strength?: number | null
  payroll_frequency?: string | null; payroll_cycle_start_day?: number | null
  salary_disbursement_day?: number | null; wc_policy_number?: string | null
  pf_status?: string | null; esic_status?: string | null
  maternity_compliant?: boolean | null; dpdp_compliant?: boolean | null
  default_employment_type?: string | null; probation_days?: number | null
  notice_period_days?: number | null; max_leave_carryforward?: number | null
  leave_year_start_month?: number | null
  vision_statement?: string | null; mission_statement?: string | null
  core_values?: string[] | null; tagline?: string | null
  brand_primary?: string | null; brand_secondary?: string | null; brand_font?: string | null
  linkedin_url?: string | null; twitter_url?: string | null; facebook_url?: string | null
  // 078
  attendance_modes?: string[] | null
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

// ── Statutory registrations ─────────────────────────────────────────────────
// The registrations table has the right shape for all of these — reg_type,
// reg_number, state, valid_from, valid_till, and an optional location_id so a
// certificate can belong to one branch rather than the whole company. It was
// simply empty, which is why none of it appeared anywhere.
//
// companies also carries gstin / epf_code / esic_code as single columns. Those
// predate this table and cannot express validity or a per-branch certificate,
// so registrations is the source of truth and the company columns are read as
// a fallback for a number somebody entered before this screen existed.

/** The registrations a company is expected to hold. Order is the order they
 *  are displayed in — statutory first, then establishment licences. */
export const REG_TYPES = [
  { code: 'GST',     label: 'GST No',                  scope: 'COMPANY' as const, legacy: 'gstin'      },
  { code: 'EPF',     label: 'EPF Code',                scope: 'COMPANY' as const, legacy: 'epf_code'   },
  { code: 'ESIC',    label: 'ESIC Code',               scope: 'COMPANY' as const, legacy: 'esic_code'  },
  { code: 'PT',      label: 'PT Registration',         scope: 'STATE'   as const, legacy: null         },
  { code: 'LWF',     label: 'LWF Registration',        scope: 'STATE'   as const, legacy: null         },
  { code: 'SE',      label: 'Shops & Establishment',   scope: 'BRANCH'  as const, legacy: null         },
  { code: 'FACTORY', label: 'Factory Licence',         scope: 'BRANCH'  as const, legacy: null         },
  { code: 'LABOUR',  label: 'Labour Licence',          scope: 'STATE'   as const, legacy: null         },
  { code: 'BUSINESS_LICENCE', label: 'Business Licence', scope: 'STATE' as const, legacy: null         },
  { code: 'WC',      label: "Workmen's Compensation",  scope: 'COMPANY' as const, legacy: null         },
  { code: 'FSSAI',   label: 'FSSAI Registration',      scope: 'COMPANY' as const, legacy: null         },
  { code: 'UDYAM',   label: 'Udyam (MSME)',            scope: 'COMPANY' as const, legacy: null         },
  { code: 'DPIIT',   label: 'DPIIT Startup Recognition', scope: 'COMPANY' as const, legacy: null       },
  { code: 'ISO',     label: 'ISO Certification',       scope: 'COMPANY' as const, legacy: null         },
] as const

export type RegScope = (typeof REG_TYPES)[number]['scope']

/** Valid / expiring / expired / absent, from valid_till. Thirty days is the
 *  warning window — enough notice to start a renewal that needs a government
 *  office, which is the point of showing it at all. */
export type RegHealth = 'MISSING' | 'NO_EXPIRY' | 'VALID' | 'EXPIRING' | 'EXPIRED'
export function regHealth(r: Registration | undefined): { state: RegHealth; days: number | null } {
  if (!r || !r.reg_number) return { state: 'MISSING', days: null }
  if (!r.valid_till) return { state: 'NO_EXPIRY', days: null }
  const till = new Date(r.valid_till + 'T00:00:00').getTime()
  const days = Math.ceil((till - Date.now()) / 86_400_000)
  if (days < 0) return { state: 'EXPIRED', days }
  if (days <= 30) return { state: 'EXPIRING', days }
  return { state: 'VALID', days }
}

/**
 * Create or update one registration.
 *
 * Keyed on (company, type, location) rather than on an id, because the caller
 * is a form for "the company's GST number", not for a row it already has —
 * and the row very often does not exist yet. Insert and update both log to the
 * same audit trail as every other edit on this screen.
 */
export async function upsertRegistration(input: {
  company_id: string
  reg_type: string
  location_id?: string | null
  patch: Partial<Pick<Registration, 'reg_number' | 'state' | 'district' | 'dept_address' | 'valid_from' | 'valid_till'>>
  changedBy?: string
}) {
  const { company_id, reg_type, location_id = null, patch } = input
  let sel = supabase.from('registrations').select('*')
    .eq('company_id', company_id).eq('reg_type', reg_type)
  sel = location_id ? sel.eq('location_id', location_id) : sel.is('location_id', null)
  const { data: existing } = await sel.maybeSingle()

  if (existing) {
    return updateEntity('REGISTRATION', existing.id, patch,
      { company_id, changedBy: input.changedBy })
  }

  const row = { company_id, reg_type, location_id, status: 'Active', ...patch }
  const { data, error } = await supabase.from('registrations').insert(row).select('id').maybeSingle()
  if (error) return { error }
  await supabase.from('company_master_audit').insert(
    Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ({
      entity_type: 'REGISTRATION', entity_id: data?.id ?? null, company_id,
      action: 'CREATE', field: k, old_value: null, new_value: String(v),
      changed_by: input.changedBy || 'Admin',
    })),
  )
  return { ok: true, created: true }
}

// ── Extra facts the profile sections need ───────────────────────────────────
// Departments, headcount per department, employment-type mix and 12-month
// leavers. Two queries for the whole set rather than one per company: three
// companies today, and a per-company loop is how a screen becomes slow the
// moment a fourth is added.

export interface CompanyFacts {
  departments: { id: string; dept_name: string; cost_center: string | null }[]
  deptHeadcount: Record<string, number>
  employmentMix: Record<string, number>
  leavers12m: number
}

export async function loadCompanyFacts(): Promise<Record<string, CompanyFacts>> {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
  const iso = cutoff.toISOString().slice(0, 10)

  const [deptRes, empRes, leftRes] = await Promise.all([
    supabase.from('departments').select('id, company_id, dept_name, cost_center').eq('status', 'Active'),
    supabase.from('employees').select('company_id, department_id, employment_type').is('date_of_leaving', null),
    // Leavers in the last twelve months, for attrition. Counted from
    // date_of_leaving rather than employment_status, because the status column
    // is free text and a date is unambiguous.
    supabase.from('employees').select('company_id, date_of_leaving').not('date_of_leaving', 'is', null).gte('date_of_leaving', iso),
  ])
  if (deptRes.error) throw deptRes.error
  if (empRes.error) throw empRes.error

  const out: Record<string, CompanyFacts> = {}
  const get = (cid: string) => (out[cid] ||= { departments: [], deptHeadcount: {}, employmentMix: {}, leavers12m: 0 })

  for (const d of deptRes.data ?? []) {
    const cid = (d as any).company_id as string | null
    if (cid) get(cid).departments.push({ id: d.id, dept_name: (d as any).dept_name, cost_center: (d as any).cost_center })
  }
  for (const e of empRes.data ?? []) {
    const cid = (e as any).company_id as string | null
    if (!cid) continue
    const f = get(cid)
    const did = (e as any).department_id as string | null
    if (did) f.deptHeadcount[did] = (f.deptHeadcount[did] ?? 0) + 1
    const t = ((e as any).employment_type as string | null)?.trim() || 'Not recorded'
    f.employmentMix[t] = (f.employmentMix[t] ?? 0) + 1
  }
  for (const l of leftRes.data ?? []) {
    const cid = (l as any).company_id as string | null
    if (cid) get(cid).leavers12m++
  }
  return out
}

// ── Sections 11 & 12 ────────────────────────────────────────────────────────
// Policy definitions are mostly READ from tables that already exist —
// shift_master, weekly_off_config and leave_types — rather than being a new
// copy of the same facts. Documents and directors are genuinely new (078).

export interface CompanyDoc {
  id: string; company_id: string; doc_type: string; title: string; description: string | null
  bucket: string; file_path: string | null; file_name: string | null
  version: string | null; is_current: boolean
  valid_from: string | null; valid_till: string | null; status: string
}
export interface Director {
  id: string; company_id: string; employee_id: string | null; person_name: string
  designation: string | null; din: string | null
  is_board_member: boolean; is_signatory: boolean
  email: string | null; phone: string | null
  appointed_on: string | null; resigned_on: string | null
}
export interface Shift {
  id: string; shift_code: string; shift_type: string | null; company_id: string | null
  in_time: string | null; out_time: string | null; lunch_duration_mins: number | null
  overtime_applicable: boolean | null; is_active: boolean | null
}
export interface WeeklyOff {
  id: string; company_id: string | null; weekday: number; mode: string | null
  nth_occurrences: number[] | null
}
export interface LeaveType {
  id: string; name: string; short_name: string | null; application_mode: string | null
  encashment_after: number | null; laps: boolean | null
}

/** The document types the profile always shows a slot for, present or not.
 *  Same rule as the statutory register: a repository that lists only what has
 *  been uploaded cannot tell you the handbook is missing. */
export const DOC_TYPES = [
  { code: 'HANDBOOK',        label: 'Company Handbook' },
  { code: 'CODE_OF_CONDUCT', label: 'Code of Conduct' },
  { code: 'REG_CERTIFICATE', label: 'Registration Certificate' },
  { code: 'MOA',             label: 'Memorandum of Association' },
  { code: 'AOA',             label: 'Articles of Association' },
] as const

export interface PolicyBundle {
  docs: CompanyDoc[]
  directors: Director[]
  shifts: Shift[]
  weeklyOff: WeeklyOff[]
  leaveTypes: LeaveType[]
}

/** Working hours, derived from a shift rather than stored a second time.
 *  Returns null when either end is missing — a half-known shift should read as
 *  unknown, not as a plausible wrong number. */
export function shiftHours(s: Shift): number | null {
  if (!s.in_time || !s.out_time) return null
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
  let span = mins(s.out_time) - mins(s.in_time)
  if (span <= 0) span += 24 * 60          // a night shift crosses midnight
  return Math.round(((span - (s.lunch_duration_mins ?? 0)) / 60) * 10) / 10
}

/**
 * NO CALLERS as of 02-Sep-2026. The Documents and Policies tabs it fed were
 * removed from the company profile on request; this and the types around it
 * are kept rather than deleted so putting those tabs back is a UI change
 * only, the way the InvestmentDeclaration nav entry is kept.
 *
 * It reads company_documents and company_directors, which migration 078
 * creates — so nothing in the app needs 078 any more either.
 */
export async function loadPolicyBundle(): Promise<Record<string, PolicyBundle>> {
  // Tables added by 078 may not exist yet. Each is fetched independently and a
  // failure degrades that one list to empty rather than emptying the section.
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> => {
    try { const { data, error } = await p; return error ? [] : (data ?? []) } catch { return [] }
  }

  const [docs, dirs, shifts, wo, lt, cos] = await Promise.all([
    safe<CompanyDoc>(supabase.from('company_documents').select('*').eq('status', 'Active') as any),
    safe<Director>(supabase.from('company_directors').select('*').is('resigned_on', null) as any),
    safe<Shift>(supabase.from('shift_master').select('*').eq('is_active', true) as any),
    safe<WeeklyOff>(supabase.from('weekly_off_config').select('*') as any),
    safe<LeaveType>(supabase.from('leave_types').select('id,name,short_name,application_mode,encashment_after,laps') as any),
    safe<{ id: string }>(supabase.from('companies').select('id').eq('status', 'Active') as any),
  ])

  const out: Record<string, PolicyBundle> = {}
  for (const c of cos) out[c.id] = { docs: [], directors: [], shifts: [], weeklyOff: [], leaveTypes: lt }

  const push = <T extends { company_id?: string | null }>(rows: T[], key: keyof PolicyBundle) => {
    for (const r of rows) {
      // A row with no company_id applies to every company — weekly_off_config
      // and shift_master both use null to mean "group-wide default", and
      // dropping those would show a company with no working days at all.
      const ids = r.company_id ? [r.company_id] : Object.keys(out)
      for (const id of ids) if (out[id]) (out[id][key] as unknown[]).push(r)
    }
  }
  push(docs, 'docs'); push(dirs, 'directors'); push(shifts, 'shifts'); push(wo, 'weeklyOff')
  return out
}
