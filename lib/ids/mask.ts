// lib/ids/mask.ts — pure. Input masks for the identity numbers typed from MRF to onboarding:
// applied in onChange, so a field can never HOLD more than the number allows — not merely be
// flagged later. PAN is 10 characters (AAAAA9999A), Aadhaar 12 digits, an Indian mobile 10
// digits, UAN 12 digits. The full format checks stay in lib/onboarding/required.ts.

/** PAN: upper-case, and each position only takes what it may — 5 letters, 4 digits, 1 letter.
 *  A character that does not fit its position is dropped, so the field stops at 10. */
export function maskPan(v: unknown): string {
  let out = ''
  for (const ch of String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    const i = out.length
    if (i >= 10) break
    if (i < 5 || i === 9 ? /[A-Z]/.test(ch) : /\d/.test(ch)) out += ch
  }
  return out
}

/** Aadhaar: digits only, at most 12. `spaced` shows it as 1234 5678 9012. */
export function maskAadhaar(v: unknown, spaced = false): string {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 12)
  return spaced ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : d
}

/** Indian mobile: digits only, 10 of them. A pasted +91 / 0 prefix is dropped first. */
export function maskMobile(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

/** A phone number abroad: an optional leading +, then at most 15 digits. */
export function maskIntlPhone(v: unknown): string {
  const s = String(v ?? '').trim()
  return (s.startsWith('+') ? '+' : '') + s.replace(/\D/g, '').slice(0, 15)
}

/** UAN: digits only, 12. */
export function maskUan(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').slice(0, 12)
}

export const isPan = (v: unknown) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v ?? ''))
export const isAadhaar = (v: unknown) => /^\d{12}$/.test(String(v ?? '').replace(/\s/g, ''))
export const isMobile = (v: unknown) => /^[6-9]\d{9}$/.test(String(v ?? ''))
