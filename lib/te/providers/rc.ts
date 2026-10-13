// lib/te/providers/rc.ts — the vehicle registration certificate (RC) lookup.
//
// WHAT IT IS FOR
//   An employee adds the vehicle they drive by its number. The RC tells the
//   company what the vehicle is (so the right per-km rate applies), whose it is
//   (company policy may pay only for the employee's own), and whether its
//   registration and insurance are valid. The source is Vahan (MoRTH), read
//   through a commercial data provider.
//
// STATUS: NO PROVIDER IS CONTRACTED YET.
//   TE_RC_PROVIDER unset or "none"  -> no provider. te-service answers
//       { notFound: true } for every number and the employee attaches a photo
//       of the RC, which HR checks (POST /api/te/vehicles/[id]/verify).
//   TE_RC_PROVIDER=mock             -> a fixed table of five demo numbers,
//       for local testing only. Refused on a production deployment.
//   anything else                   -> a loud configuration error.
//   To add a real provider: write `async (regNo) => normaliseRc(await callProvider(regNo))`
//   and return it from rcProvider() under its own TE_RC_PROVIDER name. The
//   normaliser below already accepts the field names the common Vahan
//   aggregators use; add the ones your provider uses to the lists.
//
// WHAT THE RULES ENGINE EXPECTS, EXACTLY (engine/te-engine.js, rcType and nameMatch)
//   rcType(rc) decides the vehicle type, in this order:
//     1. rc.cls contains the letters "2W"   -> 'bike'   (Vahan classes for two-wheelers end in (2WN), (2WT), (2WIC))
//     2. rc.fuel is exactly "Electric"      -> 'ev'
//     3. rc.body is exactly "Hatchback"     -> 'hatch'
//     4. rc.body is exactly "Sedan"         -> 'sedan'
//     5. anything else                      -> 'suv'
//   So the comparisons are case-sensitive and exact, and A BODY TYPE THE ENGINE
//   DOES NOT KNOW BECOMES 'suv'. normaliseRc() therefore writes the canonical
//   words only, and returns body '' when the provider gave none: the lookup
//   then shows 'SUV' and the employee's own choice of type is checked against
//   it in te_vehicle_add. If your provider has no body type at all, do not
//   switch the RC check on until that is solved.
//   nameMatch(rc.owner, employee name): lower-cased, everything except letters
//   and spaces dropped, split into words. 'match' = first word and last word
//   are equal; 'partial' = only the last word is equal; else 'no'.
//   Dates are 'YYYY-MM-DD' strings and are compared as text with today's date.
//   pucValid '' means "no pollution certificate needed" (electric).
import { TeConfigError } from '../errors.ts'
import type { RcRecord } from '../types.ts'

export type RcProvider = (regNo: string) => Promise<RcRecord | null>

type Raw = Record<string, unknown>
const first = (raw: Raw, keys: string[]): string => {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const pad = (s: string) => s.padStart(2, '0')

/** '18-08-2036', '18/08/2036', '18-Aug-2036', '2036-08-18', '2036-08-18T00:00:00' -> '2036-08-18'. '' when unreadable. */
export function isoDate(v: string): string {
  const s = String(v || '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return valid(m[1], pad(m[2]), pad(m[3]))
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return valid(m[3], pad(m[2]), pad(m[1]))
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/.exec(s)
  if (m && MONTHS[m[2].toLowerCase()]) return valid(m[3], MONTHS[m[2].toLowerCase()], pad(m[1]))
  return ''
}
function valid(y: string, mo: string, d: string): string {
  const t = Date.parse(`${y}-${mo}-${d}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === `${y}-${mo}-${d}` ? `${y}-${mo}-${d}` : ''
}

/** Vehicle class as the engine needs it: unchanged when it already carries a 2W code,
 *  and with ' (2WN)' added when the words say two-wheeler but the code is missing. */
export function normaliseClass(v: string): string {
  const s = String(v || '').trim()
  if (/2W/.test(s)) return s
  if (/2w/i.test(s)) return s.replace(/2w/gi, '2W')
  if (/m[- ]?cycle|motor\s*cycle|scooter|moped|two[- ]?wheel/i.test(s)) return `${s} (2WN)`
  return s
}

/** 'PETROL' -> 'Petrol', 'ELECTRIC(BOV)' -> 'Electric', 'PETROL/CNG' -> 'CNG'. */
export function normaliseFuel(v: string): string {
  const s = String(v || '').toLowerCase()
  if (!s.trim()) return ''
  if (/electric|\bev\b|battery|bov/.test(s)) return 'Electric'
  if (/cng/.test(s)) return 'CNG'
  if (/lpg/.test(s)) return 'LPG'
  if (/diesel/.test(s)) return 'Diesel'
  if (/petrol|gasoline/.test(s)) return 'Petrol'
  return v.trim()
}

/** The body type in the engine's words. '' = unknown (see the header: the engine reads that as SUV). */
export function normaliseBody(v: string): string {
  const s = String(v || '').toLowerCase()
  if (/hatch/.test(s)) return 'Hatchback'
  if (/sedan|saloon|notchback/.test(s)) return 'Sedan'
  if (/\bmuv\b|\bmpv\b|multi[- ]?(utility|purpose)/.test(s)) return 'MUV'
  if (/suv|sport[s]?[- ]?utility|jeep/.test(s)) return 'SUV'
  if (/scooter|moped/.test(s)) return 'Scooter'
  if (/motor\s*cycle|m[- ]?cycle|bike/.test(s)) return 'Motorcycle'
  return ''
}

/**
 * A provider's raw record -> the ten fields te-adapter's vehicleFromRc() takes.
 * null when the record cannot be used: no owner name or no vehicle class means
 * the two decisions the RC exists for (whose is it, what is it) cannot be made,
 * and it is safer to fall back to the photo than to guess.
 */
export function normaliseRc(raw: unknown): RcRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Raw
  const cls = normaliseClass(first(r, ['cls', 'vehicle_class_desc', 'vehicle_class', 'vehicleClass', 'class', 'vh_class_desc', 'vehicle_category_description']))
  const owner = first(r, ['owner', 'owner_name', 'ownerName', 'current_owner_name', 'registered_owner'])
  if (!cls || !owner) return null
  const fuel = normaliseFuel(first(r, ['fuel', 'fuel_type', 'fuelType', 'fuel_descr', 'fuel_description']))
  const rawBody = first(r, ['body', 'body_type', 'bodyType', 'body_type_desc', 'body_type_description'])
  // Some providers put the body type only inside the class text, e.g. "Motor Car (LMV) - Hatchback".
  const body = normaliseBody(rawBody) || (/2W/.test(cls) ? normaliseBody(cls) : '')
  return {
    maker: first(r, ['maker', 'maker_description', 'manufacturer', 'maker_desc', 'vehicle_manufacturer_name', 'make']),
    model: first(r, ['model', 'maker_model', 'model_name', 'vehicle_model', 'makerModel']),
    cls,
    body,
    fuel,
    owner,
    regd: isoDate(first(r, ['regd', 'registration_date', 'reg_date', 'regn_dt', 'registrationDate'])),
    rcValid: isoDate(first(r, ['rcValid', 'rc_expiry_date', 'fit_up_to', 'fitness_upto', 'fitness_up_to', 'rc_valid_upto', 'vehicle_tax_upto'])),
    insValid: isoDate(first(r, ['insValid', 'insurance_upto', 'insurance_expiry', 'vehicle_insurance_upto', 'insurance_validity', 'insurance_valid_upto'])),
    pucValid: fuel === 'Electric' ? '' : isoDate(first(r, ['pucValid', 'pucc_upto', 'puc_expiry', 'pucc_validity', 'puc_valid_upto'])),
  }
}

// ── MOCK — test data, not a provider ─────────────────────────────────────────
// The demo cast's vehicles, in the raw field names a typical aggregator returns,
// so the mock exercises normaliseRc() the same way a real provider will.
// Every other number is "not found". Names are fictional.
export const MOCK_RC: Record<string, Raw> = {
  HR26DK4821: { maker_description: 'Honda', maker_model: 'City ZX', vehicle_class_desc: 'Motor Car (LMV)', body_type: 'SEDAN', fuel_type: 'PETROL', owner_name: 'Rahul Nair', registration_date: '19-08-2021', fit_up_to: '18-08-2036', insurance_upto: '18-08-2027', pucc_upto: '10-02-2027' },
  HR26EF3021: { maker_description: 'Mahindra', maker_model: 'Scorpio-N Z8', vehicle_class_desc: 'Motor Car (LMV)', body_type: 'SUV', fuel_type: 'DIESEL', owner_name: 'Suresh Nair', registration_date: '14-03-2022', fit_up_to: '13-03-2037', insurance_upto: '13-03-2027', pucc_upto: '10-12-2026' },
  DL8SCK7710: { maker_description: 'Honda', maker_model: 'Activa 6G', vehicle_class_desc: 'M-Cycle/Scooter(2WN)', body_type: 'SCOOTER', fuel_type: 'PETROL', owner_name: 'Rahul Nair', registration_date: '09-07-2018', fit_up_to: '08-07-2033', insurance_upto: '30-09-2026', pucc_upto: '25-11-2026' },
  HR26AB1190: { maker_description: 'Hero', maker_model: 'Splendor Plus', vehicle_class_desc: 'M-Cycle/Scooter(2WN)', body_type: 'MOTOR CYCLE', fuel_type: 'PETROL', owner_name: 'Rahul Nair', registration_date: '02-05-2019', fit_up_to: '01-05-2034', insurance_upto: '01-05-2027', pucc_upto: '20-12-2026' },
  HR51BZ2208: { maker_description: 'Tata', maker_model: 'Nexon EV', vehicle_class_desc: 'Motor Car (LMV)', body_type: 'SUV', fuel_type: 'ELECTRIC(BOV)', owner_name: 'Rahul Nair', registration_date: '25-01-2024', fit_up_to: '24-01-2039', insurance_upto: '24-01-2027', pucc_upto: '' },
}
export const mockRc: RcProvider = async regNo => normaliseRc(MOCK_RC[String(regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? null)

/**
 * The provider te-service takes as ctx.rc, or undefined when none is configured.
 * Throws when the setting names something that does not exist: a typo must not
 * silently turn the RC check into "every vehicle needs a photo".
 */
export function rcProvider(env: Record<string, string | undefined> = process.env): RcProvider | undefined {
  const name = String(env.TE_RC_PROVIDER || '').trim().toLowerCase()
  if (!name || name === 'none') return undefined
  if (name === 'mock') {
    if (env.VERCEL_ENV === 'production') {
      throw new TeConfigError('TE_RC_PROVIDER=mock is test data and is refused on a production deployment. Unset it, or configure a real RC provider.')
    }
    return mockRc
  }
  throw new TeConfigError(`TE_RC_PROVIDER is set to "${name}", but no RC provider of that name is implemented. Leave it unset (employees attach a photo of the RC), or add the provider in lib/te/providers/rc.ts.`)
}
