// ─── Validation ──────────────────────────────────────────────────────
//
// Format only, and only when something has been typed. Empty is never an error
// here: HR opens a file before every document has arrived, and [REQ] on the
// checklist means "required to finish onboarding", not "required to create the
// record". A wrong PAN is worth blocking; a blank one is not.
//
// The patterns are the ones the checklist itself gives.
export const RULES: Record<string, { rx: RegExp; msg: string }> = {
  pan_number:          { rx: /^[A-Z]{5}[0-9]{4}[A-Z]$/,     msg: 'Ten characters, like ABCDE1234F' },
  aadhaar_input:       { rx: /^[0-9]{12}$/,                 msg: 'Twelve digits' },
  ifsc_code:           { rx: /^[A-Z]{4}0[A-Z0-9]{6}$/,      msg: 'Eleven characters, like HDFC0001234' },
  uan_number:          { rx: /^[0-9]{12}$/,                 msg: 'Twelve digits' },
  previous_uan:        { rx: /^[0-9]{12}$/,                 msg: 'Twelve digits' },
  bank_account_input:  { rx: /^[0-9]{9,18}$/,               msg: 'Nine to eighteen digits' },
  res_pin:             { rx: /^[1-9][0-9]{5}$/,             msg: 'Six digits' },
  perm_pin:            { rx: /^[1-9][0-9]{5}$/,             msg: 'Six digits' },
  mobile:              { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  alternate_mobile:    { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  emergency_mobile:    { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  emergency2_mobile:   { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  reference1_mobile:   { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  reference2_mobile:   { rx: /^[6-9][0-9]{9}$/,             msg: 'Ten digits, starting 6-9' },
  personal_email:      { rx: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Looks like name@example.com' },
  emergency_email:     { rx: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Looks like name@example.com' },
  emergency2_email:    { rx: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Looks like name@example.com' },
}

/** PAN and IFSC are upper-case by definition; typing them in lower case is not
 *  a mistake worth an error message. */
export const UPPERCASE = new Set(['pan_number', 'ifsc_code'])

/** The one message for a field, or null. Dates get a sanity check rather than a
 *  pattern: a date of birth in the future is a typo, not a format problem. */
export function fieldError(k: string, raw: any): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const v = UPPERCASE.has(k) ? String(raw).toUpperCase().trim() : String(raw).trim()
  const r = RULES[k]
  if (r && !r.rx.test(v)) return r.msg
  if (k === 'date_of_birth') {
    const d = new Date(v)
    if (d > new Date()) return 'Cannot be in the future'
    const years = (Date.now() - d.getTime()) / 31557600000
    if (years < 14) return 'Under 14 — check the year'
    if (years > 100) return 'Over 100 — check the year'
  }
  if (k === 'spouse_dob' || k === 'marriage_date') {
    if (new Date(v) > new Date()) return 'Cannot be in the future'
  }
  return null
}

