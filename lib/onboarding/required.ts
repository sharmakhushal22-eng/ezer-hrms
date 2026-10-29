// lib/onboarding/required.ts — pure. What the candidate's onboarding form MUST carry before it
// can be submitted: one list, used by the portal (each step's Save & Continue and the final
// Submit) and by /api/onboarding/submit, so nothing reaches HR review, the employee record or
// ESS with a blank it cannot live with. A joiner once reached the portal with no joining date
// and crashed the Today tab; this is the fence against the next such blank.
//
// form_data shape (app/onboarding/[token]/client.tsx): step_3 personal, step_4 contact,
// step_5 emergency + experience + education, step_7 statutory + bank + nominees.
// What is required depends on the hiring track (lib/onboarding/hiring-track.ts): an overseas
// employee has no PAN, PF nominee or IFSC, but an IBAN; a foreign national in India has a
// passport and a visa instead of Aadhaar.

import { trackFlags, trackOf, type HiringTrack } from './hiring-track'

export type Step = 3 | 4 | 5 | 7
export interface Missing { step: Step; key: string; label: string; message: string }
export const STEP_TITLE: Record<Step, string> = { 3: 'Personal details', 4: 'Contact & address', 5: 'Emergency contact, experience & education', 7: 'PAN, bank & nominees' }
export interface Ctx { track?: HiringTrack | string | null }

type Rule = { step: Step; key: string; label: string; when?: (s: any, f: ReturnType<typeof trackFlags>) => boolean; check?: (v: any, s: any, f: ReturnType<typeof trackFlags>) => string | null }
const blank = (v: any) => v == null || (typeof v === 'string' && v.trim() === '') || v === false
const digits = (v: any) => String(v ?? '').replace(/\D/g, '')
const PATTERN = {
  mobile: (v: any) => /^[6-9]\d{9}$/.test(digits(v)) ? null : 'must be a 10-digit Indian mobile number',
  anyPhone: (v: any) => /^\d{7,15}$/.test(digits(v)) ? null : 'must be a phone number with the country code (7 to 15 digits)',
  email: (v: any) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()) ? null : 'must be a valid email address',
  pin: (v: any) => /^\d{6}$/.test(digits(v)) ? null : 'must be a 6-digit PIN code',
  postcode: (v: any) => String(v || '').trim().length >= 3 ? null : 'must be a postal code',
  pan: (v: any) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v || '').trim().toUpperCase()) ? null : 'must look like ABCDE1234F',
  ifsc: (v: any) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v || '').trim().toUpperCase()) ? null : 'must be an 11-character IFSC (e.g. HDFC0001234)',
  account: (v: any) => /^\d{9,18}$/.test(digits(v)) ? null : 'must be 9 to 18 digits',
  iban: (v: any) => /^[A-Z0-9]{8,34}$/.test(String(v || '').replace(/\s/g, '').toUpperCase()) ? null : 'must be an IBAN or account number (8 to 34 characters)',
  swift: (v: any) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(v || '').trim().toUpperCase()) ? null : 'must be an 8 or 11-character SWIFT / BIC',
  uan: (v: any) => /^\d{12}$/.test(digits(v)) ? null : 'must be 12 digits',
  date: (v: any) => Number.isNaN(new Date(String(v)).getTime()) ? 'must be a date' : null,
  future: (v: any) => Number.isNaN(new Date(String(v)).getTime()) ? 'must be a date' : new Date(String(v)).getTime() < Date.now() ? 'has already passed' : null,
  dob: (v: any) => {
    const d = new Date(String(v)); if (Number.isNaN(d.getTime())) return 'must be a date'
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600_000)
    return age < 16 ? 'the joiner must be at least 16' : age > 80 ? 'does not look right' : null
  },
}
const hasRow = (rows: any, ...keys: string[]) => Array.isArray(rows) && rows.some(r => r && keys.every(k => !blank(r[k])))
const LISTS = new Set(['prev_employers', 'education', 'pf_nominees'])

export const RULES: Rule[] = [
  { step: 3, key: 'full_name', label: 'Full name' },
  { step: 3, key: 'dob', label: 'Date of birth', check: PATTERN.dob },
  { step: 3, key: 'gender', label: 'Gender' },
  { step: 3, key: 'father_name', label: "Father's name" },
  { step: 3, key: 'blood_group', label: 'Blood group' },
  { step: 3, key: 'marital_status', label: 'Marital status' },
  { step: 3, key: 'nationality', label: 'Nationality' },

  { step: 4, key: 'mobile', label: 'Mobile', check: (v, _s, f) => f.overseas ? PATTERN.anyPhone(v) : PATTERN.mobile(v) },
  { step: 4, key: 'personal_email', label: 'Email', check: PATTERN.email },
  { step: 4, key: 'perm_line1', label: 'Permanent address line' },
  { step: 4, key: 'perm_city', label: 'Permanent address city' },
  { step: 4, key: 'perm_state', label: 'Permanent address state / province' },
  { step: 4, key: 'perm_pin', label: 'Permanent address PIN / postal code', check: (v, _s, f) => f.overseas ? PATTERN.postcode(v) : PATTERN.pin(v) },
  { step: 4, key: 'curr_line1', label: 'Current address line', when: s => !s.same_address },
  { step: 4, key: 'curr_city', label: 'Current address city', when: s => !s.same_address },
  { step: 4, key: 'curr_state', label: 'Current address state / province', when: s => !s.same_address },
  { step: 4, key: 'curr_pin', label: 'Current address PIN / postal code', when: s => !s.same_address, check: (v, _s, f) => f.overseas ? PATTERN.postcode(v) : PATTERN.pin(v) },

  { step: 5, key: 'emrg1_name', label: 'Emergency contact name' },
  { step: 5, key: 'emrg1_relation', label: 'Emergency contact relation' },
  { step: 5, key: 'emrg1_mobile', label: 'Emergency contact mobile', check: (v, _s, f) => f.overseas ? PATTERN.anyPhone(v) : PATTERN.mobile(v) },
  { step: 5, key: 'prev_employers', label: 'Previous employer (company name)', when: s => s.is_fresher !== true, check: (v, s) => hasRow(v, 'company') || !blank(s.prev_company) ? null : 'add at least one previous employer, or tick Fresher' },
  { step: 5, key: 'education', label: 'Education (highest qualification)', check: v => hasRow(v, 'qualification') ? null : 'add at least one qualification' },

  // PAN — a foreign national may have applied for it (20% TDS until it arrives); overseas has none.
  { step: 7, key: 'pan_number', label: 'PAN', when: (s, f) => f.needsPan && s.pan_applied !== true, check: PATTERN.pan },
  { step: 7, key: 'acc_holder', label: 'Bank account holder name' },
  { step: 7, key: 'bank_name', label: 'Bank name' },
  { step: 7, key: 'bank_account', label: 'Bank account number', when: (_s, f) => f.indianBank, check: PATTERN.account },
  { step: 7, key: 'bank_ifsc', label: 'IFSC', when: (_s, f) => f.indianBank, check: PATTERN.ifsc },
  { step: 7, key: 'bank_iban', label: 'IBAN / account number', when: (_s, f) => !f.indianBank, check: PATTERN.iban },
  { step: 7, key: 'bank_swift', label: 'SWIFT / BIC', when: (_s, f) => !f.indianBank, check: PATTERN.swift },
  { step: 7, key: 'bank_country', label: 'Bank country', when: (_s, f) => !f.indianBank },
  { step: 7, key: 'uan_number', label: 'UAN', when: (s, f) => f.indianStatutory && s.has_uan === true, check: PATTERN.uan },
  { step: 7, key: 'pf_nominees', label: 'PF nominee (Form 2)', when: (_s, f) => f.indianStatutory, check: (v, s) => hasRow(v, 'name', 'relation') || (!blank(s.nominee_name) && !blank(s.nominee_relation)) ? null : 'name and relation of at least one nominee' },
  // Passport — foreign nationals in India and overseas employees
  { step: 7, key: 'fe_passport_number', label: 'Passport number', when: (_s, f) => f.immigration || f.overseas },
  { step: 7, key: 'fe_passport_country', label: 'Passport issuing country', when: (_s, f) => f.immigration || f.overseas },
  { step: 7, key: 'fe_passport_expiry', label: 'Passport expiry', when: (_s, f) => f.immigration || f.overseas, check: PATTERN.future },
  // Visa, arrival, tax residency — foreign nationals in India
  { step: 7, key: 'fe_visa_type', label: 'Visa type', when: (_s, f) => f.immigration },
  { step: 7, key: 'fe_visa_number', label: 'Visa number', when: (_s, f) => f.immigration },
  { step: 7, key: 'fe_visa_expiry', label: 'Visa expiry', when: (_s, f) => f.immigration, check: PATTERN.future },
  { step: 7, key: 'fe_india_entry_date', label: 'Date of arrival in India', when: (_s, f) => f.immigration, check: PATTERN.date },
  { step: 7, key: 'fe_tax_residency', label: 'India tax residency status', when: (_s, f) => f.immigration },
  { step: 7, key: 'fe_ssa_country', label: 'SSA country of the coverage certificate', when: (s, f) => f.immigration && s.fe_ssa_exempt === true },
  // Home address — overseas employees
  { step: 7, key: 'fe_overseas_line', label: 'Home-country address line', when: (_s, f) => f.overseas },
  { step: 7, key: 'fe_overseas_city', label: 'Home-country city', when: (_s, f) => f.overseas },
  { step: 7, key: 'fe_overseas_country', label: 'Home country', when: (_s, f) => f.overseas },
]

/** The blanks and bad values of one step, from that step's object. */
export function missingFor(step: Step, data: Record<string, any> | null | undefined, ctx: Ctx = {}): Missing[] {
  const s = data || {}
  const f = trackFlags(trackOf(ctx.track))
  const out: Missing[] = []
  for (const r of RULES) {
    if (r.step !== step) continue
    if (r.when && !r.when(s, f)) continue
    const v = s[r.key]
    if (r.check) {
      // A check sees a blank list too ("add one"); a plain blank value is simply required.
      if (!LISTS.has(r.key) && blank(v)) { out.push({ step, key: r.key, label: r.label, message: `${r.label} is required` }); continue }
      const why = r.check(v, s, f)
      if (why) out.push({ step, key: r.key, label: r.label, message: `${r.label}: ${why}` })
    } else if (blank(v)) out.push({ step, key: r.key, label: r.label, message: `${r.label} is required` })
  }
  return out
}

/** Every blank across the whole form (form_data with step_3 … step_7). The track comes from
 *  `ctx` or, failing that, from form_data.hiring_track. */
export function missingFields(formData: Record<string, any> | null | undefined, ctx: Ctx = {}): Missing[] {
  const fd = formData || {}
  const c = { track: ctx.track ?? fd.hiring_track ?? null }
  return ([3, 4, 5, 7] as Step[]).flatMap(st => missingFor(st, fd[`step_${st}`], c))
}

/** "Personal details: Date of birth, Gender · Contact & address: PIN code" */
export function describeMissing(list: Missing[]): string {
  const by = new Map<Step, string[]>()
  for (const m of list) { const l = by.get(m.step) || []; l.push(m.label); by.set(m.step, l) }
  return [...by.entries()].map(([st, labels]) => `${STEP_TITLE[st]}: ${labels.join(', ')}`).join(' · ')
}
