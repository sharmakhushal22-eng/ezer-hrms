// lib/te/admin.ts — what an admin may change, and what a valid value is.
//
// PURE (unit-tested): no database here. The two admin routes
//   PATCH /api/te/admin/settings
//   PUT   /api/te/admin/masters/[table]
// call checkSettingsPatch() / checkMasterRows() and write only what comes back.
//
// WHY A WHITELIST
//   These routes write tables directly (there is no SQL function for "edit a
//   setting"), so the list of columns a request can touch is fixed here, column
//   by column, with the same limits as the CHECK constraints in
//   supabase/migrations/144_te_tables.sql. A column that is not listed cannot
//   be written through the API, whatever the request says: company_id, version,
//   updated_by, created_at and updated_at are set by the server or the database.
//
// TWO RULES OF THE MASTERS
//   · A code is never renamed. The key of a row (code, grade, city …) identifies
//     it; sending another key creates another row. Old claims keep resolving.
//   · Nothing is deleted. A row is switched off (is_active / is_enabled = false).
import { TeHttpError } from './errors.ts'

type Check = (v: unknown, name: string) => unknown
const bad = (name: string, why: string): never => { throw new TeHttpError(400, 'TE_INVALID', `${label(name)}: ${why}`, { field: name }) }
const label = (name: string) => name.replace(/_/g, ' ')

const num = (min: number, max = Number.MAX_SAFE_INTEGER): Check => (v, n) => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof x !== 'number' || !Number.isFinite(x)) return bad(n, 'enter a number.')
  if (x < min || x > max) return bad(n, max === Number.MAX_SAFE_INTEGER ? `must be ${min} or more.` : `must be between ${min} and ${max}.`)
  return x
}
const int = (min: number, max = 2147483647): Check => (v, n) => {
  const x = num(min, max)(v, n) as number
  return Number.isInteger(x) ? x : bad(n, 'enter a whole number.')
}
const bool: Check = (v, n) => (typeof v === 'boolean' ? v : bad(n, 'must be true or false.'))
const oneOf = (...allowed: string[]): Check => (v, n) => (typeof v === 'string' && allowed.includes(v) ? v : bad(n, `must be one of: ${allowed.join(', ')}.`))
const text = (max = 200): Check => (v, n) => {
  if (typeof v !== 'string' || !v.trim()) return bad(n, 'cannot be empty.')
  return v.trim().length > max ? bad(n, `at most ${max} characters.`) : v.trim()
}
const orNull = (c: Check): Check => (v, n) => (v === null || v === '' ? null : c(v, n))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid: Check = (v, n) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad(n, 'is not a valid id.'))
const object: Check = (v, n) => (v && typeof v === 'object' && !Array.isArray(v) ? v : bad(n, 'must be an object of settings.'))
const strings: Check = (v, n) => (Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim()) ? (v as string[]).map(s => s.trim()) : bad(n, 'must be a list of names.'))
const matches = (re: RegExp, why: string, max = 60): Check => (v, n) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : bad(n, why))

// ── settings ────────────────────────────────────────────────────────────────

/** te_settings columns an admin may change -> their check. Limits mirror the CHECK constraints in 144. */
export const SETTINGS: Record<string, Check> = {
  bill_age_days: int(1, 730),
  claim_deadline_days: int(1, 365),
  notice_days: int(0),
  receipt_above: num(0),
  no_bill_per_day: num(0),
  client_per_head: num(0),
  misc_per_claim: num(0),
  comm_per_claim: num(0),
  advance_max_pct: int(0, 100),
  grace_days: int(0),
  mileage_tolerance_pct: num(0, 100),
  estimate_tolerance_pct: num(0, 100),
  post_facto: oneOf('allowed', 'limited', 'blocked'),
  post_facto_per_quarter: int(0),
  fast_track_amount: num(0),
  sample_pct: num(0, 100),
  fallback_approver_id: orNull(uuid),
  reminder_days: int(0),
  escalate_days: int(0),
  auto_approve_on_timeout: bool,
  dom_air_estimate: num(0),
  intl_air_estimate: num(0),
  default_grade: text(40),
  gps_rules: object,
  vehicle_rules: object,
  fuel_prices: object,
  limit_basis: object,
  breach_actions: object,
  risk_weights: object,
  risk_bands: object,
  extra: object,
  zone_a_countries: strings,
}
/** The JSON groups. A patch of one of these is MERGED into the stored object key by key,
 *  so a screen can send the one switch it changed without wiping the others. */
export const SETTINGS_JSON = ['gps_rules', 'vehicle_rules', 'fuel_prices', 'limit_basis', 'breach_actions', 'risk_weights', 'risk_bands', 'extra']

/**
 * Check a settings patch. Returns the columns to write. Throws 400 with the
 * field name on the first value that is not allowed, and on any column that is
 * not in the whitelist (so a typo is an error, not a silent no-op).
 * `current` is the stored row: JSON groups are merged into it.
 */
export function checkSettingsPatch(patch: Record<string, unknown>, current: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = Object.keys(patch)
  if (!keys.length) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'Send at least one setting to change.')
  for (const k of keys) {
    const check = Object.prototype.hasOwnProperty.call(SETTINGS, k) ? SETTINGS[k] : null
    if (!check) throw new TeHttpError(400, 'TE_INVALID', `"${k}" is not a setting that can be changed here.`, { field: k })
    const v = check(patch[k], k)
    out[k] = SETTINGS_JSON.includes(k) ? { ...((current[k] as Record<string, unknown> | null) ?? {}), ...(v as Record<string, unknown>) } : v
  }
  return out
}

// ── masters ─────────────────────────────────────────────────────────────────

export interface MasterSpec {
  /** The columns that identify a row inside a company. Never changed by an update. */
  key: string[]
  keyCheck: Record<string, Check>
  /** Editable columns -> their check. */
  cols: Record<string, Check>
  /** Columns a NEW row must carry. Empty = new rows cannot be added through the API. */
  required: string[] | null
  /** The table has an updated_by column the server fills in. */
  stampsUpdatedBy: boolean
  /** A further rule across the columns of one finished row; returns a sentence, or '' when fine. */
  rowRule?: (row: Record<string, unknown>) => string
}

const code = matches(/^[a-z][a-z0-9_]{0,30}$/, 'use lower-case letters, digits and underscores, starting with a letter.')
const sort = int(0, 100000)

export const MASTERS: Record<string, MasterSpec> = {
  te_categories: {
    key: ['code'], keyCheck: { code }, required: ['name'], stampsUpdatedBy: true,
    cols: { name: text(80), icon: orNull(text(40)), grp: orNull(text(40)), needs_trip: bool, proof: oneOf('always', 'above', 'none'), gl_code: orNull(text(40)), sort_order: sort, is_active: bool },
  },
  te_modes: {
    key: ['code'], keyCheck: { code }, required: ['name', 'basis'], stampsUpdatedBy: true,
    cols: {
      name: text(80), icon: orNull(text(40)), basis: oneOf('km', 'bill', 'nobill', 'ticket', 'none'),
      scope_local: bool, scope_domestic: bool, scope_international: bool, gps: oneOf('track', 'checkin'), stops_allowed: bool,
      fare_ceiling_per_km: num(0), min_fare: orNull(num(0)), est_per_km: orNull(num(0)), est_min: orNull(num(0)),
      category_code: orNull(code), sort_order: sort, is_active: bool,
    },
    // the two product rules that are CHECK constraints in 144 (te_modes_flight_never_local, te_modes_flight_checkin)
    rowRule: r => (r.code === 'flight' && r.scope_local === true ? 'A flight is never a local trip.' : r.code === 'flight' && r.gps === 'track' ? 'A flight is checked in, not tracked.' : ''),
  },
  te_vehicle_types: {
    key: ['code'], keyCheck: { code }, required: ['name', 'rate_per_km'], stampsUpdatedBy: true,
    cols: { name: text(80), example: orNull(text(120)), method: oneOf('fixed', 'fuel'), rate_per_km: num(0, 999), fuel: orNull(oneOf('petrol', 'diesel', 'cng', 'ev')), km_per_unit: orNull(num(0.1, 999)), wear_per_km: num(0, 999), sort_order: sort, is_active: bool },
    rowRule: r => (r.method === 'fuel' && (r.fuel === null || r.km_per_unit === null) ? 'A fuel-based rate needs the fuel and the km per unit.' : ''),
  },
  te_place_types: {
    key: ['code'], keyCheck: { code }, required: ['name'], stampsUpdatedBy: true,
    cols: { name: text(80), sort_order: sort, is_active: bool },
  },
  te_stop_reasons: {
    key: ['code'], keyCheck: { code }, required: ['name'], stampsUpdatedBy: true,
    cols: { name: text(80), is_business: bool, typical_minutes: orNull(int(0, 1440)), sort_order: sort, is_active: bool },
  },
  // The 55 checks are fixed by the rules engine: they can be switched off or told to act
  // differently, never added, and whether a check is live is not an admin's choice.
  te_checks: {
    key: ['code'], keyCheck: { code: matches(/^[A-G][0-9]{1,2}$/, 'is a check code like A1 or G13.') }, required: null, stampsUpdatedBy: true,
    cols: { action: oneOf('block', 'warn', 'justify', 'cap', 'reroute', 'report', 'sample'), severity: oneOf('', 'low', 'medium', 'high'), is_enabled: bool, params: object },
  },
  te_grade_policies: {
    key: ['grade'], keyCheck: { grade: text(40) }, required: [], stampsUpdatedBy: true,
    cols: { air_class: oneOf('Economy', 'Premium Economy', 'Business'), train_class: text(20), sort_order: sort },
  },
  te_grade_limits: {
    key: ['grade', 'tier'], keyCheck: { grade: text(40), tier: oneOf('metro', 'tier1', 'rest', 'intlA', 'intlB') },
    required: ['hotel_per_night', 'meals_per_day', 'conveyance_per_day'], stampsUpdatedBy: true,
    cols: { hotel_per_night: num(0), meals_per_day: num(0), conveyance_per_day: num(0) },
  },
  te_city_tiers: {
    key: ['city'], keyCheck: { city: text(80) }, required: ['tier'], stampsUpdatedBy: false,
    cols: { state_code: orNull(matches(/^[0-9]{2}$/, 'is the 2-digit GST state code, like 06.')), tier: oneOf('metro', 'tier1', 'rest'), hub_region: orNull(text(40)), is_active: bool },
  },
  // Company places only (owner_employee_id is null). An employee's own places are theirs.
  te_places: {
    key: ['id'], keyCheck: { id: uuid }, required: ['short_name', 'address', 'lat', 'lng'], stampsUpdatedBy: false,
    cols: {
      source: oneOf('company', 'hub'), place_type: orNull(code), short_name: text(60), name: orNull(text(120)), address: text(300),
      city: orNull(text(80)), state: orNull(text(60)), pin_code: orNull(matches(/^[A-Za-z0-9 -]{3,10}$/, 'is not a postal code.')),
      country: text(60), lat: num(-90, 90), lng: num(-180, 180), code: orNull(matches(/^[A-Z0-9]{2,8}$/, 'is an airport or station code in capitals.')), is_active: bool,
    },
    rowRule: r => ((r.country ?? 'India') === 'India' && typeof r.pin_code === 'string' && !/^[1-9][0-9]{5}$/.test(r.pin_code) ? 'An address in India has a 6-digit PIN.' : ''),
  },
  te_hubs: {
    key: ['area', 'kind'], keyCheck: { area: text(80), kind: oneOf('air', 'rail') }, required: ['place_id'], stampsUpdatedBy: false,
    cols: { place_id: uuid },
  },
}

export interface CheckedRow {
  /** The key values, e.g. { code: 'cab' }. For a new te_places row, id is absent. */
  key: Record<string, unknown>
  /** The editable columns the request sent, checked. */
  patch: Record<string, unknown>
}

/**
 * Check the rows of a masters request. Throws 400 naming the row and the field
 * on the first problem. Does not know what exists: the route decides update or
 * insert, and calls missingForInsert() for the new ones.
 */
export function checkMasterRows(table: string, rows: unknown): CheckedRow[] {
  const spec = Object.prototype.hasOwnProperty.call(MASTERS, table) ? MASTERS[table] : null
  if (!spec) throw new TeHttpError(404, 'TE_BAD_REQUEST', 'That is not a list that can be edited here.')
  if (!Array.isArray(rows) || !rows.length) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'Send the rows to save as { "rows": [ … ] }.')
  if (rows.length > 500) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'Send at most 500 rows at a time.')
  const seen = new Set<string>()
  return rows.map((raw, i) => {
    const at = `Row ${i + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TeHttpError(400, 'TE_BAD_REQUEST', `${at} is not an object.`)
    const r = raw as Record<string, unknown>
    const key: Record<string, unknown> = {}
    const patch: Record<string, unknown> = {}
    try {
      for (const k of spec.key) {
        // a new company place has no id yet; every other key must be given
        if (table === 'te_places' && (r[k] === undefined || r[k] === null)) continue
        key[k] = spec.keyCheck[k](r[k], k)
      }
      for (const k of Object.keys(r)) {
        if (spec.key.includes(k)) continue
        const check = Object.prototype.hasOwnProperty.call(spec.cols, k) ? spec.cols[k] : null
        if (!check) throw new TeHttpError(400, 'TE_INVALID', `"${k}" cannot be changed here.`, { field: k })
        patch[k] = check(r[k], k)
      }
    } catch (e) {
      if (e instanceof TeHttpError) throw new TeHttpError(e.status, e.code, `${at}: ${e.message}`, { ...(e.extra ?? {}), row: i })
      throw e
    }
    const id = JSON.stringify(spec.key.map(k => key[k] ?? null))
    if (Object.keys(key).length && seen.has(id)) throw new TeHttpError(400, 'TE_INVALID', `${at} repeats an earlier row.`)
    seen.add(id)
    return { key, patch }
  })
}

/** The required columns a NEW row does not carry. null = this table takes no new rows. */
export function missingForInsert(table: string, row: CheckedRow): string[] | null {
  const spec = MASTERS[table]
  if (!spec.required) return null
  return spec.required.filter(c => row.patch[c] === undefined || row.patch[c] === null)
}

/** The cross-column rule of a table, applied to the row as it will be stored. '' = fine. */
export function rowProblem(table: string, finished: Record<string, unknown>): string {
  return MASTERS[table].rowRule?.(finished) ?? ''
}
