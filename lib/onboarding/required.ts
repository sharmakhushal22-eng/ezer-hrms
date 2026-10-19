// lib/onboarding/required.ts — pure. What the candidate's onboarding form MUST carry before it
// can be submitted: one list, used by the portal (each step's Save & Continue and the final
// Submit) and by /api/onboarding/submit, so nothing reaches HR review, the employee record or
// ESS with a blank it cannot live with. A joiner once reached the portal with no joining date
// and crashed the Today tab; this is the fence against the next such blank.
//
// form_data shape (app/onboarding/[token]/client.tsx): step_3 personal, step_4 contact,
// step_5 emergency + experience + education, step_7 statutory + bank + nominees.

export type Step = 3 | 4 | 5 | 7
export interface Missing { step: Step; key: string; label: string; message: string }
export const STEP_TITLE: Record<Step, string> = { 3: 'Personal details', 4: 'Contact & address', 5: 'Emergency contact, experience & education', 7: 'PAN, bank & nominees' }

type Rule = { step: Step; key: string; label: string; when?: (s: any, fd: any) => boolean; check?: (v: any, s: any) => string | null }
const blank = (v: any) => v == null || (typeof v === 'string' && v.trim() === '') || v === false
const digits = (v: any) => String(v ?? '').replace(/\D/g, '')
const PATTERN = {
  mobile: (v: any) => /^[6-9]\d{9}$/.test(digits(v)) ? null : 'must be a 10-digit Indian mobile number',
  email: (v: any) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()) ? null : 'must be a valid email address',
  pin: (v: any) => /^\d{6}$/.test(digits(v)) ? null : 'must be a 6-digit PIN code',
  pan: (v: any) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v || '').trim().toUpperCase()) ? null : 'must look like ABCDE1234F',
  ifsc: (v: any) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v || '').trim().toUpperCase()) ? null : 'must be an 11-character IFSC (e.g. HDFC0001234)',
  account: (v: any) => /^\d{9,18}$/.test(digits(v)) ? null : 'must be 9 to 18 digits',
  uan: (v: any) => /^\d{12}$/.test(digits(v)) ? null : 'must be 12 digits',
  dob: (v: any) => {
    const d = new Date(String(v)); if (Number.isNaN(d.getTime())) return 'must be a date'
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600_000)
    return age < 16 ? 'the joiner must be at least 16' : age > 80 ? 'does not look right' : null
  },
}
const hasRow = (rows: any, ...keys: string[]) => Array.isArray(rows) && rows.some(r => r && keys.every(k => !blank(r[k])))

export const RULES: Rule[] = [
  { step: 3, key: 'full_name', label: 'Full name' },
  { step: 3, key: 'dob', label: 'Date of birth', check: PATTERN.dob },
  { step: 3, key: 'gender', label: 'Gender' },
  { step: 3, key: 'father_name', label: "Father's name" },
  { step: 3, key: 'blood_group', label: 'Blood group' },
  { step: 3, key: 'marital_status', label: 'Marital status' },
  { step: 3, key: 'nationality', label: 'Nationality' },

  { step: 4, key: 'mobile', label: 'Mobile', check: PATTERN.mobile },
  { step: 4, key: 'personal_email', label: 'Email', check: PATTERN.email },
  { step: 4, key: 'perm_line1', label: 'Permanent address line' },
  { step: 4, key: 'perm_city', label: 'Permanent address city' },
  { step: 4, key: 'perm_state', label: 'Permanent address state' },
  { step: 4, key: 'perm_pin', label: 'Permanent address PIN code', check: PATTERN.pin },
  { step: 4, key: 'curr_line1', label: 'Current address line', when: s => !s.same_address },
  { step: 4, key: 'curr_city', label: 'Current address city', when: s => !s.same_address },
  { step: 4, key: 'curr_state', label: 'Current address state', when: s => !s.same_address },
  { step: 4, key: 'curr_pin', label: 'Current address PIN code', when: s => !s.same_address, check: PATTERN.pin },

  { step: 5, key: 'emrg1_name', label: 'Emergency contact name' },
  { step: 5, key: 'emrg1_relation', label: 'Emergency contact relation' },
  { step: 5, key: 'emrg1_mobile', label: 'Emergency contact mobile', check: PATTERN.mobile },
  { step: 5, key: 'prev_employers', label: 'Previous employer (company name)', when: s => s.is_fresher !== true, check: (v, s) => hasRow(v, 'company') || !blank(s.prev_company) ? null : 'add at least one previous employer, or tick Fresher' },
  { step: 5, key: 'education', label: 'Education (highest qualification)', check: v => hasRow(v, 'qualification') ? null : 'add at least one qualification' },

  { step: 7, key: 'pan_number', label: 'PAN', check: PATTERN.pan },
  { step: 7, key: 'acc_holder', label: 'Bank account holder name' },
  { step: 7, key: 'bank_name', label: 'Bank name' },
  { step: 7, key: 'bank_account', label: 'Bank account number', check: PATTERN.account },
  { step: 7, key: 'bank_ifsc', label: 'IFSC', check: PATTERN.ifsc },
  { step: 7, key: 'uan_number', label: 'UAN', when: s => s.has_uan === true, check: PATTERN.uan },
  { step: 7, key: 'pf_nominees', label: 'PF nominee (Form 2)', check: (v, s) => hasRow(v, 'name', 'relation') || (!blank(s.nominee_name) && !blank(s.nominee_relation)) ? null : 'name and relation of at least one nominee' },
]

/** The blanks and bad values of one step, from that step's object. */
export function missingFor(step: Step, data: Record<string, any> | null | undefined): Missing[] {
  const s = data || {}
  const out: Missing[] = []
  for (const r of RULES) {
    if (r.step !== step) continue
    if (r.when && !r.when(s, s)) continue
    const v = s[r.key]
    if (r.check) {
      // A check sees blanks too (a missing list is "add one"), unless the value is a plain blank string.
      const isList = Array.isArray(v) || r.key === 'prev_employers' || r.key === 'education' || r.key === 'pf_nominees'
      if (!isList && blank(v)) { out.push({ step, key: r.key, label: r.label, message: `${r.label} is required` }); continue }
      const why = r.check(v, s)
      if (why) out.push({ step, key: r.key, label: r.label, message: `${r.label}: ${why}` })
    } else if (blank(v)) out.push({ step, key: r.key, label: r.label, message: `${r.label} is required` })
  }
  return out
}

/** Every blank across the whole form (form_data with step_3 … step_7). */
export function missingFields(formData: Record<string, any> | null | undefined): Missing[] {
  const fd = formData || {}
  return ([3, 4, 5, 7] as Step[]).flatMap(st => missingFor(st, fd[`step_${st}`]))
}

/** "Personal details: Date of birth, Gender · Contact & address: PIN code" */
export function describeMissing(list: Missing[]): string {
  const by = new Map<Step, string[]>()
  for (const m of list) { const l = by.get(m.step) || []; l.push(m.label); by.set(m.step, l) }
  return [...by.entries()].map(([st, labels]) => `${STEP_TITLE[st]}: ${labels.join(', ')}`).join(' · ')
}
