// lib/recruitment/blacklist.ts — SERVER ONLY.
//
// Aadhaar / PAN blacklist for candidates who back out after an offer (Offers → Backout →
// "Yes, blacklist"). Checked when a candidate is added (Add Candidate).
//
// Aadhaar is never stored in full: an HMAC keyed off the server secret ID_CARD_PEPPER (so the
// hash can't be reversed by trying all 10^12 numbers without the secret), plus the last four
// digits for display. PAN is stored upper-case. The table is server-only (RLS on, no policy).

import { createHmac } from 'crypto'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const normAadhaar = (v: any) => String(v ?? '').replace(/\D/g, '')
export const normPan = (v: any) => String(v ?? '').replace(/\s/g, '').toUpperCase()
export const validAadhaar = (a: string) => /^[2-9]\d{11}$/.test(a)
export const validPan = (p: string) => /^[A-Z]{5}\d{4}[A-Z]$/.test(p)

function aadhaarHash(a: string): string {
  const pepper = process.env.ID_CARD_PEPPER
  if (!pepper || pepper.length < 32) throw new Error('Server secret ID_CARD_PEPPER is not configured.')
  return createHmac('sha256', `candidate-blacklist:${pepper}`).update(a).digest('hex')
}

export type BlacklistHit = { by: 'AADHAAR' | 'PAN'; candidate_name: string | null; reason: string | null; created_at: string }

/** Is either number blacklisted? Blank or invalid numbers are simply not checked. */
export async function findBlacklisted(aadhaarIn: any, panIn: any): Promise<BlacklistHit | null> {
  const a = normAadhaar(aadhaarIn), p = normPan(panIn)
  if (validAadhaar(a)) {
    const { data } = await sb.from('candidate_blacklist').select('candidate_name, reason, created_at').eq('aadhaar_hash', aadhaarHash(a)).eq('is_active', true).limit(1).maybeSingle()
    if (data) return { by: 'AADHAAR', ...data }
  }
  if (validPan(p)) {
    const { data } = await sb.from('candidate_blacklist').select('candidate_name, reason, created_at').eq('pan', p).eq('is_active', true).limit(1).maybeSingle()
    if (data) return { by: 'PAN', ...data }
  }
  return null
}

/** Add a candidate's Aadhaar and/or PAN to the blacklist. At least one valid number is required. */
export async function addToBlacklist(input: { aadhaar?: any; pan?: any; candidateId: string; companyId: string | null; candidateName: string | null; reason: string | null; by: string }) {
  const a = normAadhaar(input.aadhaar), p = normPan(input.pan)
  if (a && !validAadhaar(a)) throw new Error('Aadhaar must be 12 digits.')
  if (p && !validPan(p)) throw new Error('PAN must look like ABCDE1234F.')
  if (!a && !p) throw new Error('Enter the Aadhaar or PAN number to blacklist.')
  const { error } = await sb.from('candidate_blacklist').insert({
    aadhaar_hash: a ? aadhaarHash(a) : null, aadhaar_last4: a ? a.slice(-4) : null, pan: p || null,
    candidate_id: input.candidateId, company_id: input.companyId, candidate_name: input.candidateName,
    reason: input.reason, blacklisted_by: input.by,
  })
  if (error) throw new Error(error.message)
  return { aadhaar_last4: a ? a.slice(-4) : null, pan: p || null }
}
