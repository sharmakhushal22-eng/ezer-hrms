// lib/recruitment/offer-esign.ts — SERVER ONLY. The offer letter, accepted by e-signature.
//
// Until now the candidate replied to the offer mail outside the system and HR uploaded the
// signed letter and a screenshot of that mail (Offers → Accepted). When HR leaves "Ask the
// candidate to accept by e-signature" on (Send Offers), the offer mail also carries a
// "Review & sign" link to an EZER Sign envelope:
//
//   sendOfferForSignature()  the same generated letter, with boxes on the ACCEPTANCE block
//                            (signature, date), as an envelope for the candidate (source OFFER,
//                            source_ref = candidate id). An earlier open envelope for the same
//                            candidate is voided, so only the latest letter can be signed.
//   onOfferSigned()          called when the envelope completes (lib/esign/flow.ts): the signed
//                            PDF is filed with the candidate and the acceptance is recorded
//                            exactly as HR's upload would (lib/recruitment/offer-accept.ts,
//                            type DIGITAL) — the candidate moves to Pre-onboarding by itself.
//
// A decline on the signing page mails HR (the sender) with the reason; HR then records
// a backout or a revision as today. The PDF attachment in the mail stays, for reading offline.
import type { NextRequest } from 'next/server'
import { sb, upload, logEvent, issueLink, signUrl, BUCKET, appBase } from '@/lib/esign/server'
import { createEnvelopes } from '@/lib/esign/flow'
import { maskEmail } from '@/lib/esign/core'
import { rmsServiceClient } from '@/lib/rms/server'
import { acceptBlocked, recordAcceptance, OFFER_DOCS_BUCKET } from './offer-accept'
import type { OfferSignSpot } from './offer-letter-pdf'

export const SOURCE = 'OFFER'

export async function sendOfferForSignature(o: {
  dossier: any; pdf: { name: string; content: Buffer; spots: OfferSignSpot[] }; to: string
  sender: { id: string | null; name: string; email: string | null }; req: NextRequest
}): Promise<{ link: string; envelopeNo: string }> {
  const cand = o.dossier.candidate, request = o.dossier.request
  if (!o.pdf.spots.some(s => s.kind === 'SIGNATURE')) throw new Error('The offer letter has no acceptance signature line to sign.')

  // Only the latest letter can be signed: a re-sent offer voids the one before it.
  const { data: open } = await sb.from('esign_envelopes').select('id').eq('source', SOURCE).eq('source_ref', cand.id).in('status', ['DRAFT', 'SENT', 'IN_PROGRESS'])
  for (const e of open || []) {
    await sb.from('esign_envelopes').update({ status: 'VOIDED', void_reason: 'Replaced by a newer offer letter', updated_at: new Date().toISOString() }).eq('id', e.id)
    await logEvent(e.id, 'VOIDED', { actor: o.sender.name, req: o.req, details: { reason: 'Replaced by a newer offer letter' } })
  }

  const uploadPath = `uploads/offer-${request.id}-${Date.now()}.pdf`
  await upload(uploadPath, new Uint8Array(o.pdf.content))
  try {
    const r = await createEnvelopes({
      uploadPath, originalName: o.pdf.name, title: `Offer letter — ${cand.full_name}`, category: 'OFFER_LETTER',
      companyId: request.company_id || cand.company_id || null, source: SOURCE, sourceRef: cand.id, embedded: true, expiresDays: 14,
      signers: [{ name: cand.full_name, email: o.to, role_label: 'Candidate', auth_method: 'EMAIL_OTP' }],
      fields: o.pdf.spots.map(s => ({ signer: 0, page: s.page, x: s.x, y: s.y, w: s.w, h: s.h, kind: s.kind })),
      sender: o.sender,
    }, appBase(o.req), o.req)
    const envId = r.envelopes[0].id
    // The invite IS the offer mail: open the envelope and issue the link that mail carries.
    const { data: signer } = await sb.from('esign_signers').select('id').eq('envelope_id', envId).single()
    const token = await issueLink(signer!.id)
    const now = new Date().toISOString()
    await sb.from('esign_envelopes').update({ status: 'SENT', updated_at: now }).eq('id', envId)
    await sb.from('esign_signers').update({ status: 'PENDING', invited_at: now }).eq('id', signer!.id)
    await logEvent(envId, 'SENT', { actor: o.sender.name, req: o.req, details: { offer_request: request.id } })
    await logEvent(envId, 'INVITED', { signerId: signer!.id, actor: o.sender.name, req: o.req, details: { to: maskEmail(o.to), mail: 'with the offer letter e-mail' } })
    return { link: signUrl(appBase(o.req), token), envelopeNo: r.envelopes[0].envelope_no }
  } finally {
    await sb.storage.from(BUCKET).remove([uploadPath]).then(() => {}, () => {})
  }
}

/** Mail-safe block appended to the offer mail. */
export function signBlock(link: string): { text: string; html: string } {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  return {
    text: `\n\nTo accept this offer, review and e-sign the letter here: ${link}\nWe will send a one-time code to this e-mail address to confirm it is you.`,
    html: `<div style="margin:22px 0 6px;padding:16px 18px;border:1px solid #dbe4f5;border-radius:10px;background:#f6f9ff;font-family:Arial,Helvetica,sans-serif">
  <div style="font-weight:700;font-size:15px;color:#0b1d4d">Accept your offer online</div>
  <div style="font-size:13px;color:#374151;line-height:1.6;margin:6px 0 14px">Review the letter and sign it electronically. We send a one-time code to this e-mail address to confirm it is you; the signed copy comes back to you by e-mail.</div>
  <a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px">Review &amp; sign the offer</a>
</div>`,
  }
}

/** The envelope completed: file the signed letter with the candidate and record the acceptance. */
export async function onOfferSigned(env: any, signedBytes: Uint8Array) {
  const db = rmsServiceClient
  const { data: cand } = await db.from('candidates').select('*').eq('id', env.source_ref).maybeSingle()
  if (!cand) return
  const blocked = acceptBlocked(cand)
  if (blocked) { await logEvent(env.id, 'NOTE', { actor: 'EZER Sign', details: { offer: `Not recorded as accepted: ${blocked}` } }); return }

  const { data: signer } = await sb.from('esign_signers').select('name, signed_ip, signed_user_agent').eq('envelope_id', env.id).order('order_no').limit(1).maybeSingle()
  const name = `Offer_letter_signed_${env.envelope_no}.pdf`
  const path = `recruitment/${cand.id}/SIGNED_OFFER_${Date.now()}.pdf`
  const { error } = await db.storage.from(OFFER_DOCS_BUCKET).upload(path, Buffer.from(signedBytes), { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Could not file the signed offer: ${error.message}`)
  const err = await recordAcceptance(cand, {
    type: 'DIGITAL', by: `${signer?.name || cand.full_name} (e-signed, ${env.envelope_no})`, signedPath: path, signedName: name,
    ip: signer?.signed_ip || null, userAgent: signer?.signed_user_agent || null, details: { envelope_no: env.envelope_no },
  })
  await logEvent(env.id, 'NOTE', { actor: 'EZER Sign', details: { offer: err ? `Acceptance not recorded: ${err}` : 'Offer recorded as accepted' } })
}
