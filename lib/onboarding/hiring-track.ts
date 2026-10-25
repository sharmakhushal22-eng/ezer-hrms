// lib/onboarding/hiring-track.ts — pure. The hiring track an onboarding runs on, chosen by HR
// when the link is sent, and what each track changes downstream:
//
//   DOMESTIC          an Indian citizen joining the Indian entity — today's flow, unchanged
//   FOREIGN_IN_INDIA  a foreign national joining the Indian entity: passport + visa instead of
//                     Aadhaar, FRRO within 14 days of arrival, PF as an International Worker
//                     (no wage ceiling) unless a Social Security Agreement certificate exempts
//                     them, PAN (may be applied for), an Indian (NRO / NRE / regular) account
//   OVERSEAS          an employee working outside India (the company's foreign entity or an
//                     EOR partner): no PF / ESIC / PT / LWF, no Indian forms, local tax id and
//                     an IBAN / SWIFT account, paid outside the Indian payroll run
//
// The portal (which steps and documents), lib/onboarding/required.ts (which blanks block),
// the heads' checklists, the employee record, payroll and the immigration tracker all read
// these flags rather than re-deciding per track.

export type HiringTrack = 'DOMESTIC' | 'FOREIGN_IN_INDIA' | 'OVERSEAS'
export const TRACKS: { value: HiringTrack; label: string; hint: string }[] = [
  { value: 'DOMESTIC', label: 'Domestic (India)', hint: 'Indian citizen, Indian entity, Indian payroll' },
  { value: 'FOREIGN_IN_INDIA', label: 'Foreign national, working in India', hint: 'Employment visa, FRRO, PF as International Worker, PAN' },
  { value: 'OVERSEAS', label: 'Overseas employee', hint: 'Works outside India: foreign entity or EOR, paid outside the Indian payroll' },
]
export const TRACK_LABEL: Record<HiringTrack, string> = { DOMESTIC: 'Domestic', FOREIGN_IN_INDIA: 'Foreign national in India', OVERSEAS: 'Overseas' }

export const trackOf = (v: any): HiringTrack => (v === 'FOREIGN_IN_INDIA' || v === 'OVERSEAS') ? v : 'DOMESTIC'

/** Countries India has a Social Security Agreement with — a Detachment / Coverage certificate
 *  from one of these keeps the joiner out of Indian PF. (EPFO list; check before relying on it.) */
export const SSA_COUNTRIES = ['Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Czech Republic', 'Denmark', 'Finland', 'France', 'Germany', 'Hungary', 'Japan', 'Luxembourg', 'Netherlands', 'Norway', 'Portugal', 'Quebec (Canada)', 'South Korea', 'Sweden', 'Switzerland', 'United Kingdom']
export const isSsaCountry = (c: any) => SSA_COUNTRIES.some(x => x.toLowerCase() === String(c || '').trim().toLowerCase())

export interface TrackFlags {
  /** PF / ESIC / PT / LWF and the Indian statutory forms (Form 11, Form 2, Form F, ESIC Form 1). */
  indianStatutory: boolean
  /** Aadhaar card + number are asked for and required. */
  needsAadhaar: boolean
  /** PAN is required (a foreign national may have applied for it: 20% TDS until it arrives). */
  needsPan: boolean
  /** An Indian bank account (account + IFSC); otherwise IBAN / SWIFT. */
  indianBank: boolean
  /** Passport, visa, work permit, FRRO, tax residency, SSA. */
  immigration: boolean
  /** Passport + home-country address, local tax id. */
  overseas: boolean
  /** Paid through the Indian payroll run. */
  indianPayroll: boolean
}
export function trackFlags(track: HiringTrack): TrackFlags {
  switch (track) {
    case 'FOREIGN_IN_INDIA': return { indianStatutory: true, needsAadhaar: false, needsPan: true, indianBank: true, immigration: true, overseas: false, indianPayroll: true }
    case 'OVERSEAS': return { indianStatutory: false, needsAadhaar: false, needsPan: false, indianBank: false, immigration: false, overseas: true, indianPayroll: false }
    default: return { indianStatutory: true, needsAadhaar: true, needsPan: true, indianBank: true, immigration: false, overseas: false, indianPayroll: true }
  }
}

/** The documents the portal must have before the form can be submitted, per track. */
export function requiredDocCodes(track: HiringTrack, o: { esic?: boolean; fresher?: boolean } = {}): string[] {
  const f = trackFlags(track)
  const out: string[] = []
  if (f.needsAadhaar) out.push('AADHAAR_FRONT', 'AADHAAR_BACK')
  if (f.needsPan) out.push('PAN')
  out.push('PHOTO', 'DEGREE', 'BANK_PROOF')
  if (f.indianStatutory && o.esic) out.push('FAMILY_PHOTO')
  if (f.immigration || f.overseas) out.push('PASSPORT')
  if (f.immigration) out.push('VISA')
  return out
}

/** FRRO registration is due 14 days after arrival for a stay of more than 180 days. */
export function frroDueDate(indiaEntry: string | null | undefined): string | null {
  if (!indiaEntry) return null
  const d = new Date(String(indiaEntry).slice(0, 10) + 'T00:00:00Z')   // UTC throughout, so the calendar date never slips a day
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 14)
  return d.toISOString().slice(0, 10)
}

export interface Expiry { kind: 'passport' | 'visa' | 'work_permit' | 'frro' | 'ssa_coc'; label: string; date: string; days_left: number }
const DAY = 24 * 3600_000
/** Every dated immigration item on an employee record, soonest first, with days left (negative = lapsed). */
export function immigrationExpiries(e: { passport_expiry?: string | null; visa_expiry?: string | null; work_permit_expiry?: string | null; frro_due_date?: string | null; frro_date?: string | null; ssa_coc_expiry?: string | null }, now = new Date()): Expiry[] {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
  const items: [Expiry['kind'], string, string | null | undefined][] = [
    ['passport', 'Passport expires', e.passport_expiry],
    ['visa', 'Visa expires', e.visa_expiry],
    ['work_permit', 'Work permit expires', e.work_permit_expiry],
    ['frro', 'FRRO registration due', e.frro_date ? null : e.frro_due_date],
    ['ssa_coc', 'SSA coverage certificate expires', e.ssa_coc_expiry],
  ]
  return items.filter(([, , d]) => !!d).map(([kind, label, d]) => {
    const t = new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime()
    return { kind, label, date: String(d).slice(0, 10), days_left: Math.round((t - today) / DAY) }
  }).filter(x => !Number.isNaN(x.days_left)).sort((a, b) => a.days_left - b.days_left)
}

/** The reminder thresholds: a mail / bell at 60, 30 and 7 days before, and on the day. */
export const REMIND_AT = [60, 30, 7, 0]
export const dueForReminder = (daysLeft: number) => REMIND_AT.includes(daysLeft)
