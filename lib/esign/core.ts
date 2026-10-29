// lib/esign/core.ts — the pure pieces of EZER Sign: link tokens, OTP sealing, document
// hashing, envelope numbers, and the Aadhaar number check. No database, no React, so all of
// it is unit-tested (lib/esign/__tests__/core.test.ts) and shared by server and browser.
//
// Why these choices:
//   * A signing link is a bearer secret (whoever holds it can ask for an OTP), so the
//     database keeps only its SHA-256. A leaked table cannot be turned into working links.
//   * An OTP is sealed with an HMAC keyed by a server secret and bound to the signer and the
//     purpose ("email" / "aadhaar"), so a code issued for one signer or one step cannot be
//     replayed against another, and the table never holds a usable code.
//   * The document's identity is its SHA-256. It is printed on the certificate page and
//     looked up by /sign/verify, which is how anyone can later prove a PDF was not altered.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const OTP_TTL_MIN = 10
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS = 6
export const SESSION_TTL_MIN = 60
/** Aadhaar OTP is a demo until a licensed eSign provider (ESP/ASP) is contracted. */
export const AADHAAR_DEMO = true

function secret(): string {
  const s = process.env.ESIGN_SECRET || process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('ESIGN_SECRET (or SUPABASE_SERVICE_ROLE_KEY) is not set')
  return s
}

export const sha256Hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')

/** A fresh signing-link token (43 url-safe chars, 256 bits) and the hash we store. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: sha256Hex(token) }
}
export const tokenHash = (token: string) => sha256Hex(String(token || ''))

export function newOtp(): string {
  // 6 digits, uniform: rejection-free because 2^32 mod 10^6 bias is < 0.03%.
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
export const sealOtp = (signerId: string, purpose: 'email' | 'aadhaar', otp: string) =>
  createHmac('sha256', secret()).update(`${purpose}:${signerId}:${otp}`).digest('hex')

export function otpMatches(sealed: string | null | undefined, signerId: string, purpose: 'email' | 'aadhaar', otp: string): boolean {
  if (!sealed || !/^\d{6}$/.test(String(otp || ''))) return false
  const a = Buffer.from(sealOtp(signerId, purpose, otp), 'hex'), b = Buffer.from(sealed, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** EZS-2026-7KQ2MX — short enough to read out on a phone, unique enough with the DB check. */
export function newEnvelopeNo(now = new Date()): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
  const b = randomBytes(6)
  let s = ''
  for (let i = 0; i < 6; i++) s += A[b[i] % A.length]
  return `EZS-${now.getUTCFullYear()}-${s}`
}

// ── Aadhaar ─────────────────────────────────────────────────────────────────
// UIDAI numbers carry a Verhoeff check digit, so a typo is caught before any OTP is asked
// for. We keep only the last four digits — never the full number (Aadhaar Act s.29).
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
export function isValidAadhaar(raw: string): boolean {
  const n = String(raw || '').replace(/\s+/g, '')
  if (!/^[2-9]\d{11}$/.test(n)) return false
  let c = 0
  n.split('').reverse().forEach((d, i) => { c = VD[c][VP[i % 8][Number(d)]] })
  return c === 0
}

/** "XXXX XXXX 1234" */
export const maskAadhaar = (last4: string | null | undefined) => last4 ? `XXXX XXXX ${last4}` : ''

export function maskEmail(email: string): string {
  const [u, d] = String(email || '').split('@')
  if (!d) return email
  return `${u.slice(0, Math.min(2, u.length))}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`
}

/** IP as the request reports it. x-forwarded-for's first hop on Vercel is the client. */
export function clientIp(h: { get(n: string): string | null }): string {
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
}

/** "27 Oct 2026, 14:05:09 IST" — every time on the stamp and certificate is IST. */
export function istStamp(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d
  const s = t.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${s} IST`
}

/** A compact browser description for the audit line: "Chrome 141 · macOS". */
export function describeAgent(ua: string | null | undefined): string {
  const u = String(ua || '')
  if (!u) return 'unknown device'
  const b = /Edg\/(\d+)/.exec(u) ? `Edge ${/Edg\/(\d+)/.exec(u)![1]}`
    : /Chrome\/(\d+)/.exec(u) ? `Chrome ${/Chrome\/(\d+)/.exec(u)![1]}`
    : /Firefox\/(\d+)/.exec(u) ? `Firefox ${/Firefox\/(\d+)/.exec(u)![1]}`
    : /Version\/(\d+).*Safari/.exec(u) ? `Safari ${/Version\/(\d+).*Safari/.exec(u)![1]}` : 'Browser'
  const os = /Windows/.test(u) ? 'Windows' : /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Mac OS X/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'unknown OS'
  return `${b} · ${os}`
}

export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED'
export type SignerStatus = 'WAITING' | 'PENDING' | 'VIEWED' | 'SIGNED' | 'DECLINED'
export type FieldKind = 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'OFFER_LETTER', label: 'Offer letter' },
  { id: 'APPOINTMENT', label: 'Appointment letter' },
  { id: 'POLICY', label: 'Policy acknowledgement' },
  { id: 'NDA', label: 'NDA / confidentiality' },
  { id: 'HR_LETTER', label: 'HR letter' },
  { id: 'ONBOARDING', label: 'Onboarding form' },
  { id: 'EXIT', label: 'Exit / F&F' },
  { id: 'CONTRACT', label: 'Contract / agreement' },
  { id: 'GENERAL', label: 'Other' },
]
export const categoryLabel = (id: string | null | undefined) => CATEGORIES.find(c => c.id === id)?.label || 'Other'

/** Which signers may act now. Sequential: the lowest order_no still open; parallel: all open. */
export function activeOrder(signers: { order_no: number; status: string }[], order: 'SEQUENTIAL' | 'PARALLEL'): number | null {
  const open = signers.filter(s => s.status !== 'SIGNED')
  if (!open.length) return null
  if (order === 'PARALLEL') return -1
  return Math.min(...open.map(s => s.order_no))
}
