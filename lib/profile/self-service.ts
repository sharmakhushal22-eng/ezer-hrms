// lib/profile/self-service.ts — the rules behind "Fix" and "Edit", kept pure.
//
// Shared by the browser (what an editor offers and checks as you type) and the
// API routes (which check again, because the browser is only a suggestion).
// Nothing here touches Supabase, so it is testable with node --test.
//
// THE RULE THE WHOLE PROFILE NOW FOLLOWS (Keka / greytHR practice)
//
//   adding something that is MISSING   -> you save it yourself, straight away.
//                                         A card you upload alongside it is
//                                         checked by HR afterwards, but nobody
//                                         has to approve you filling a blank.
//   CHANGING something already on file -> goes for approval when it moves
//                                         money, tax or statute (address, bank,
//                                         spouse, disability, passport), or is
//                                         HR-maintained outright (PAN, UAN,
//                                         Aadhaar once set, date of birth).
//   the salary account                 -> always goes to Payroll, even the
//                                         first time. A bank account is where
//                                         your salary lands; a second pair of
//                                         eyes on it is the fraud control, not
//                                         paperwork.
//   nominees, emergency contacts,      -> always yours. These are declarations
//   blood group, phone, personal email    about you, not facts HR certifies.

// ── completeness sentence -> the editor that fixes it ────────────────────

export type FixAction =
  | 'photo' | 'aadhaar' | 'pan' | 'uan' | 'bank'
  | 'present_address' | 'permanent_address' | 'emergency' | 'blood_group'
  | 'nominee_pf' | 'nominee_gratuity' | 'documents'

/** profile_completeness() (091) returns sentences, not keys. This is the one
 *  place they are mapped, tested against the exact strings the function emits.
 *  Matching is by a distinctive phrase rather than the whole sentence so that a
 *  later rewording ("Add your Aadhaar number") does not silently break Fix. */
const FIX_PATTERNS: [RegExp, FixAction][] = [
  [/photo/i,                    'photo'],
  [/aadhaar|aadhar/i,           'aadhaar'],
  [/\bPAN\b/,                   'pan'],
  [/\bUAN\b/,                   'uan'],
  [/salary account|bank/i,      'bank'],
  [/present address/i,          'present_address'],
  [/permanent address/i,        'permanent_address'],
  [/emergency/i,                'emergency'],
  [/blood/i,                    'blood_group'],
  [/provident fund|\bPF\b/i,    'nominee_pf'],
  [/gratuity/i,                 'nominee_gratuity'],
  [/document/i,                 'documents'],
]

export function fixActionFor(sentence: string): FixAction | null {
  for (const [re, a] of FIX_PATTERNS) if (re.test(sentence)) return a
  return null
}

/** Where to land when no editor fits — the tab that holds the thing. */
export const FIX_TAB: Record<FixAction, string> = {
  photo: 'personal', aadhaar: 'statutory', pan: 'statutory', uan: 'statutory',
  bank: 'payroll', present_address: 'personal', permanent_address: 'personal',
  emergency: 'personal', blood_group: 'personal', nominee_pf: 'family',
  nominee_gratuity: 'family', documents: 'documents',
}

/** Shown on the Fix button's row, so the person knows before clicking whether
 *  this is instant or goes to somebody. */
export const FIX_MODE: Record<FixAction, 'direct' | 'payroll'> = {
  photo: 'direct', aadhaar: 'direct', pan: 'direct', uan: 'direct',
  bank: 'payroll', present_address: 'direct', permanent_address: 'direct',
  emergency: 'direct', blood_group: 'direct', nominee_pf: 'direct',
  nominee_gratuity: 'direct', documents: 'direct',
}

// ── validators ───────────────────────────────────────────────────────────
// Each returns an error sentence, or null when the value is fine.

const digits = (s: string) => s.replace(/[\s-]/g, '')

/** Verhoeff — the checksum UIDAI puts in the last digit of every Aadhaar.
 *  Catches a single mistyped digit and almost every swap of two neighbours,
 *  which is what people actually get wrong when copying a card. */
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
export function verhoeffOk(num: string): boolean {
  let c = 0
  const a = num.split('').reverse().map(Number)
  for (let i = 0; i < a.length; i++) c = VD[c][VP[i % 8][a[i]]]
  return c === 0
}

export function checkAadhaar(raw: string): string | null {
  const s = digits(raw)
  if (!/^\d{12}$/.test(s)) return 'An Aadhaar number is 12 digits.'
  if (/^[01]/.test(s)) return 'An Aadhaar number never starts with 0 or 1.'
  if (!verhoeffOk(s)) return 'That is not a valid Aadhaar number — please check the digits.'
  return null
}

export function checkPan(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s)) return 'A PAN looks like ABCDE1234F — five letters, four digits, one letter.'
  return null
}

export function checkUan(raw: string): string | null {
  return /^\d{12}$/.test(digits(raw)) ? null : 'A UAN is 12 digits.'
}

export function checkIfsc(raw: string): string | null {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw.trim().toUpperCase())
    ? null : 'An IFSC is 11 characters — four letters, a zero, then six letters or digits (e.g. HDFC0001234).'
}

export function checkAccount(raw: string): string | null {
  return /^\d{9,18}$/.test(digits(raw)) ? null : 'An account number is 9 to 18 digits.'
}

export function checkPin(raw: string): string | null {
  return /^[1-9]\d{5}$/.test(raw.trim()) ? null : 'A PIN code is 6 digits and does not start with 0.'
}

/** Indian mobile, tolerating +91 / 0 / spaces the way people type it. Returns
 *  the normalised ten digits as `value` when valid. */
export function normaliseMobile(raw: string): { value: string | null; error: string | null } {
  let s = digits(raw).replace(/^\+/, '')
  if (/^91\d{10}$/.test(s)) s = s.slice(2)
  if (/^0\d{10}$/.test(s)) s = s.slice(1)
  if (!/^[6-9]\d{9}$/.test(s)) return { value: null, error: 'Enter a 10-digit Indian mobile number.' }
  return { value: s, error: null }
}

export function checkEmail(raw: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim()) ? null : 'That does not look like an email address.'
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
export const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated']
export const EMERGENCY_RELATIONS = ['Spouse', 'Father', 'Mother', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend', 'Other']
export const NOMINEE_RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other']

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

// ── the generic field editor: which control each field gets ──────────────

export type InputKind = 'text' | 'date' | 'select' | 'tel' | 'email' | 'number' | 'bool' | 'textarea'

export interface EditorSpec {
  kind: InputKind
  options?: string[]
  placeholder?: string
  maxLength?: number
}

const EDITORS: Record<string, EditorSpec> = {
  display_name:   { kind: 'text', maxLength: 60, placeholder: 'What colleagues call you' },
  blood_group:    { kind: 'select', options: BLOOD_GROUPS },
  marital_status: { kind: 'select', options: MARITAL },
  marriage_date:  { kind: 'date' },
  languages:      { kind: 'text', maxLength: 120, placeholder: 'e.g. Hindi, English, Tamil' },
  personal_email: { kind: 'email', placeholder: 'name@example.com' },
  mobile:         { kind: 'tel', placeholder: '10-digit mobile' },
  alt_mobile:     { kind: 'tel', placeholder: '10-digit mobile' },
  whatsapp_optin: { kind: 'bool' },
  is_disabled:    { kind: 'bool' },
  spouse_name:    { kind: 'text', maxLength: 80 },
  workstation:    { kind: 'text', maxLength: 40, placeholder: 'e.g. 3F-21' },
  vpf_amount:     { kind: 'number', placeholder: 'Monthly amount in ₹' },
  driving_licence:{ kind: 'text', maxLength: 20, placeholder: 'e.g. KA0120210012345' },
  voter_id:       { kind: 'text', maxLength: 12, placeholder: 'e.g. ABC1234567' },
  passport_no:    { kind: 'text', maxLength: 12, placeholder: 'e.g. Z1234567' },
}

export const editorFor = (key: string): EditorSpec => EDITORS[key] ?? { kind: 'text', maxLength: 120 }

/** Validates AND normalises a value for a generic field. The API runs this
 *  before writing, so the rules cannot be skipped by calling the route. */
export function checkFieldValue(key: string, raw: string): { value: string; error: string | null } {
  const v = raw.trim()
  const spec = editorFor(key)
  if (spec.maxLength && v.length > spec.maxLength) return { value: v, error: `Keep it under ${spec.maxLength} characters.` }
  switch (key) {
    case 'mobile': case 'alt_mobile': {
      const m = normaliseMobile(v)
      return { value: m.value ?? v, error: m.error }
    }
    case 'personal_email': return { value: v.toLowerCase(), error: checkEmail(v) }
    case 'blood_group':    return { value: v, error: BLOOD_GROUPS.includes(v) ? null : 'Pick a blood group from the list.' }
    case 'marital_status': return { value: v, error: MARITAL.includes(v) ? null : 'Pick a status from the list.' }
    case 'whatsapp_optin': case 'is_disabled':
      return { value: v, error: v === 'true' || v === 'false' ? null : 'Choose Yes or No.' }
    case 'marriage_date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v).getTime())) return { value: v, error: 'Pick a date.' }
      return { value: v, error: new Date(v) > new Date() ? 'That date is in the future.' : null }
    }
    case 'vpf_amount': {
      const n = Number(v)
      return { value: v, error: Number.isFinite(n) && n >= 0 ? null : 'Enter an amount of zero or more.' }
    }
    case 'driving_licence': case 'voter_id': case 'passport_no':
      return { value: v.toUpperCase(), error: /^[A-Z0-9 -]{4,20}$/i.test(v) ? null : 'Letters and digits only.' }
  }
  return { value: v, error: null }
}

// ── structured values carried as one readable string ─────────────────────
//
// A change request has a single new_value column (091) and the approver reads
// it as text. Addresses and bank accounts are several columns, so they travel
// as readable lines and are parsed back on final approval. The format is
// produced here and only here, so parsing it is safe.

export interface Address { line1: string; line2: string; city: string; state: string; pin: string }

export const emptyAddress = (): Address => ({ line1: '', line2: '', city: '', state: '', pin: '' })

export function checkAddress(a: Address): string | null {
  if (!a.line1.trim()) return 'Address line 1 is required.'
  if (!a.city.trim()) return 'City is required.'
  if (!INDIAN_STATES.includes(a.state)) return 'Pick a state from the list.'
  return checkPin(a.pin)
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

export function formatAddress(a: Address): string {
  return [clean(a.line1), clean(a.line2), `${clean(a.city)}, ${clean(a.state)} ${clean(a.pin)}`].join('\n')
}

export function parseAddress(s: string): Address | null {
  const lines = s.split('\n')
  if (lines.length !== 3) return null
  const m = /^(.*), (.*) (\d{6})$/.exec(lines[2].trim())
  if (!m) return null
  return { line1: lines[0].trim(), line2: lines[1].trim(), city: m[1].trim(), state: m[2].trim(), pin: m[3] }
}

/** One line, for display — the address on a field card. */
export const addressOneLine = (a: Partial<Address> | null | undefined): string => {
  if (!a || !a.line1) return ''
  const tail = [a.city, [a.state, a.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [a.line1, a.line2, tail].filter(Boolean).join(', ')
}

export interface BankAccount { bank_name: string; account: string; ifsc: string; holder: string }

export function checkBank(b: BankAccount): string | null {
  if (!b.bank_name.trim()) return 'Bank name is required.'
  if (!b.holder.trim()) return 'Account holder name is required.'
  return checkAccount(b.account) ?? checkIfsc(b.ifsc)
}

export function formatBank(b: BankAccount): string {
  return [`Bank: ${clean(b.bank_name)}`, `Account: ${digits(b.account)}`,
          `IFSC: ${b.ifsc.trim().toUpperCase()}`, `Holder: ${clean(b.holder)}`].join('\n')
}

export function parseBank(s: string): BankAccount | null {
  const get = (k: string) => {
    const line = s.split('\n').find(l => l.startsWith(`${k}: `))
    return line ? line.slice(k.length + 2).trim() : null
  }
  const b = { bank_name: get('Bank'), account: get('Account'), ifsc: get('IFSC'), holder: get('Holder') }
  if (!b.bank_name || !b.account || !b.ifsc || !b.holder) return null
  const out = b as BankAccount
  return checkBank(out) ? null : out
}

// ── emergency contacts ───────────────────────────────────────────────────
// emergency_contact_1 is one text column. "Name · Relation · Mobile" is the
// format IdCard already splits on (it prints the last segment as the number),
// so the same format is kept rather than inventing a second.

export interface Emergency { name: string; relation: string; mobile: string }

export const formatEmergency = (e: Emergency) => `${clean(e.name)} · ${e.relation} · ${e.mobile}`

export function parseEmergency(s: unknown): Emergency {
  const parts = String(s ?? '').split('·').map(p => p.trim())
  if (parts.length >= 3) return { name: parts[0], relation: parts[1], mobile: parts[parts.length - 1] }
  return { name: parts[0] ?? '', relation: '', mobile: '' }
}

export function checkEmergency(e: Emergency): string | null {
  if (!e.name.trim()) return 'Whom should we call? A name is required.'
  if (!EMERGENCY_RELATIONS.includes(e.relation)) return 'Pick how they are related to you.'
  return normaliseMobile(e.mobile).error
}

// ── nominations ──────────────────────────────────────────────────────────

export type Scheme = 'pf' | 'gratuity'
export const SCHEME_LABEL: Record<string, string> = { pf: 'Provident fund (Form 2)', gratuity: 'Gratuity (Form F)' }

export interface NomineeRow { name: string; relation: string; dob: string; share: string }

export const nomineeTotal = (rows: NomineeRow[]) =>
  Math.round(rows.reduce((a, r) => a + (Number(r.share) || 0), 0) * 100) / 100

export function checkNominees(rows: NomineeRow[]): string | null {
  if (!rows.length) return 'Add at least one nominee.'
  for (const [i, r] of rows.entries()) {
    const n = `Nominee ${i + 1}`
    if (!r.name.trim()) return `${n}: a name is required.`
    if (!NOMINEE_RELATIONS.includes(r.relation)) return `${n}: pick a relation.`
    if (r.dob && (isNaN(new Date(r.dob).getTime()) || new Date(r.dob) > new Date())) return `${n}: the date of birth is not valid.`
    const s = Number(r.share)
    if (!Number.isFinite(s) || s <= 0 || s > 100) return `${n}: the share must be between 1 and 100%.`
  }
  const names = rows.map(r => r.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) return 'The same person is listed twice.'
  const t = nomineeTotal(rows)
  if (t !== 100) return `The shares add up to ${t}%. They must total exactly 100%.`
  return null
}

/** A minor nominee needs a guardian on Form 2 — said, not enforced, because
 *  the guardian is captured on the form HR files, not on this record. */
export const isMinor = (dob: string) => {
  if (!dob) return false
  const d = new Date(dob); if (isNaN(d.getTime())) return false
  const t = new Date(); t.setFullYear(t.getFullYear() - 18)
  return d > t
}

// ── documents ────────────────────────────────────────────────────────────

/** What an employee is asked to keep on file. Codes are the onboarding
 *  portal's (lib/onboarding/corrections DOC_LABEL), so a document uploaded at
 *  joining and one uploaded here are recognisably the same thing. */
export const PROFILE_DOCS: { code: string; label: string; mandatory: boolean; hint?: string }[] = [
  { code: 'AADHAAR_FRONT', label: 'Aadhaar card',                    mandatory: true },
  { code: 'PAN',           label: 'PAN card',                        mandatory: true },
  { code: 'DEGREE',        label: 'Highest degree certificate',      mandatory: true },
  { code: 'MARKSHEET_10',  label: '10th mark sheet',                 mandatory: true },
  { code: 'MARKSHEET_12',  label: '12th mark sheet',                 mandatory: false },
  { code: 'EXP_LETTER',    label: 'Experience / relieving letter',   mandatory: false, hint: 'From your last employer, if any' },
  { code: 'BANK_PROOF',    label: 'Cancelled cheque or passbook',    mandatory: false },
  { code: 'UAN_CARD',      label: 'UAN card',                        mandatory: false },
  { code: 'PASSPORT',      label: 'Passport (front page)',           mandatory: false },
]

export const DOC_TYPES_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
export const DOC_MAX_BYTES = 5 * 1024 * 1024

/** Identity numbers and the document that proves each. */
export const ID_DOC: Record<'aadhaar' | 'pan' | 'uan', string> = {
  aadhaar: 'AADHAAR_FRONT', pan: 'PAN', uan: 'UAN_CARD',
}

// ── who a request goes to ────────────────────────────────────────────────

export interface Person { name: string; code: string | null }
export interface Approvers { l1: Person | null; hr: Person | null; payroll: Person | null }

/** 101 seeds bank fields to payroll and everything else to HR; 105 sends an
 *  HR-routed request past the line manager first when there is one. This says
 *  the same thing in words, BEFORE the person presses Send. */
export function routeFor(key: string): 'hr' | 'payroll' {
  return /^bank|ifsc|salary_account/.test(key) ? 'payroll' : 'hr'
}

export function goesTo(key: string, a: Approvers | null | undefined): { stages: string[]; summary: string } {
  const who = (p: Person | null | undefined, team: string) => p ? `${team} — ${p.name}` : `${team} team`
  if (routeFor(key) === 'payroll') {
    const s = [who(a?.payroll, 'Payroll')]
    return { stages: s, summary: s[0] }
  }
  const stages = a?.l1 ? [`Line manager — ${a.l1.name}`, who(a?.hr, 'HR')] : [who(a?.hr, 'HR')]
  return { stages, summary: stages.join(', then ') }
}
