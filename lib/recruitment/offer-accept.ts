// lib/recruitment/offer-accept.ts — SERVER ONLY. Recording that a candidate accepted the offer.
//
// Two ways in, one record: HR uploads the signed letter + the acceptance mail (Offers →
// Accepted, app/api/recruitment/offer-response), or the candidate e-signs the letter with EZER
// Sign (lib/recruitment/offer-esign.ts, acceptance_type DIGITAL). Either way: an
// offer_acceptances row, candidates.offer_accepted, the MRF closed when it is filled, and an
// audit entry — which is what moves the candidate to Pre-onboarding.
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const OFFER_DOCS_BUCKET = 'onboarding-docs'

export const audit = (candidate: any, action_type: string, details: any) =>
  sb.from('recruitment_audit_logs').insert({ candidate_id: candidate.id, company_id: candidate.company_id || null, action_type, details, created_at: new Date().toISOString() })

/** The offer this response is about: the candidate's latest request. */
export async function latestRequest(candidateId: string) {
  const { data } = await sb.from('offer_approval_requests').select('*').eq('candidate_id', candidateId).order('submitted_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function closeMrfIfFilled(mrfId: string | null) {
  if (!mrfId) return
  const { data: m } = await sb.from('manpower_requisitions').select('no_of_openings, openings, status').eq('id', mrfId).maybeSingle()
  if (!m || m.status === 'CLOSED') return
  const { count } = await sb.from('candidates').select('id', { count: 'exact', head: true }).eq('mrf_id', mrfId).in('stage', ['Offer Sent', 'Joined'])
  if ((count || 0) >= Number(m.no_of_openings || m.openings || 1)) await sb.from('manpower_requisitions').update({ status: 'CLOSED' }).eq('id', mrfId)
}

/** Why this candidate cannot be marked accepted now, or null. */
export function acceptBlocked(cand: any): string | null {
  if (cand.stage !== 'Offer Sent' || cand.offer_accepted) return 'This candidate has no offer waiting for a response.'
  if (cand.offer_response === 'REVISION') return 'This offer is with the HR Head for revision.'
  return null
}

export async function recordAcceptance(cand: any, a: {
  type: 'UPLOAD' | 'DIGITAL'; by: string
  signedPath: string; signedName: string
  proofPath?: string | null; proofName?: string | null
  ip?: string | null; userAgent?: string | null; details?: Record<string, any>
}): Promise<string | null> {
  const request = await latestRequest(cand.id)
  const { error } = await sb.from('offer_acceptances').insert({
    candidate_id: cand.id, approval_request_id: request?.id || null, company_id: cand.company_id || request?.company_id || null,
    acceptance_type: a.type, signed_file_url: a.signedPath, signed_file_name: a.signedName,
    mail_proof_url: a.proofPath || null, mail_proof_name: a.proofName || null, uploaded_by: a.by, status: 'ACCEPTED',
    ...(a.ip ? { ip_address: a.ip } : {}), ...(a.userAgent ? { user_agent: a.userAgent } : {}),
  })
  if (error) return error.message.includes('mail_proof') ? 'Run migration 134 in Supabase first (offer acceptance columns are missing).' : error.message
  await sb.from('candidates').update({ offer_accepted: true, offer_response: 'ACCEPTED' }).eq('id', cand.id)
  await closeMrfIfFilled(cand.mrf_id)
  await audit(cand, 'OFFER_ACCEPTED', { name: cand.full_name, by: a.by, signed_offer: a.signedName, ...(a.proofName ? { mail_proof: a.proofName } : {}), ...(a.details || {}) })
  return null
}
