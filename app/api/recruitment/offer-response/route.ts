// app/api/recruitment/offer-response/route.ts — the candidate's answer to a sent offer, recorded
// by the HR Manager on Recruitment → Offers.
//
//   POST multipart  action=accept, candidate_id, signed_offer (PDF), mail_proof (image / PDF)
//        -> stores both files, records the acceptance, the candidate moves to Pre-onboarding
//   POST json { action:'backout', candidate_id, blacklist:boolean, aadhaar?, pan?, reason? }
//        -> out of the pipeline (stage Rejected); with blacklist, Aadhaar/PAN go on the blacklist
//   POST json { action:'revision', candidate_id, note }
//        -> the offer goes back to the HR Head to edit and re-approve; HR Heads are notified
//   GET  ?candidate_id=…  -> the recorded acceptance with short-lived links to its two files

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify } from '@/lib/ess/session'
import { roleHolders } from '@/lib/recruitment/offer-approval-notify'
import { addToBlacklist } from '@/lib/recruitment/blacklist'
import { actorName } from '@/lib/recruitment/actor'

export const runtime = 'nodejs'

const BUCKET = 'onboarding-docs'
const MAX_BYTES = 10 * 1024 * 1024
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const audit = (candidate: any, action_type: string, details: any) =>
  sb.from('recruitment_audit_logs').insert({ candidate_id: candidate.id, company_id: candidate.company_id || null, action_type, details, created_at: new Date().toISOString() })

/** The offer this response is about: the candidate's latest request. */
async function latestRequest(candidateId: string) {
  const { data } = await sb.from('offer_approval_requests').select('*').eq('candidate_id', candidateId).order('submitted_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

async function reopenMrf(mrfId: string | null) {
  if (!mrfId) return
  const { data: m } = await sb.from('manpower_requisitions').select('status').eq('id', mrfId).maybeSingle()
  if (m?.status === 'CLOSED') await sb.from('manpower_requisitions').update({ status: 'APPROVED' }).eq('id', mrfId)
}

async function closeMrfIfFilled(mrfId: string | null) {
  if (!mrfId) return
  const { data: m } = await sb.from('manpower_requisitions').select('no_of_openings, openings, status').eq('id', mrfId).maybeSingle()
  if (!m || m.status === 'CLOSED') return
  const { count } = await sb.from('candidates').select('id', { count: 'exact', head: true }).eq('mrf_id', mrfId).in('stage', ['Offer Sent', 'Joined'])
  if ((count || 0) >= Number(m.no_of_openings || m.openings || 1)) await sb.from('manpower_requisitions').update({ status: 'CLOSED' }).eq('id', mrfId)
}

async function upload(candidateId: string, kind: string, file: File) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 10 MB`)
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `recruitment/${candidateId}/${kind}_${Date.now()}.${ext}`
  const { error } = await sb.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return path
}

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const candidateId = req.nextUrl.searchParams.get('candidate_id')
  if (!candidateId) return bad('candidate_id is required')
  const { data: a } = await sb.from('offer_acceptances').select('*').eq('candidate_id', candidateId).order('accepted_at', { ascending: false }).limit(1).maybeSingle()
  if (!a) return NextResponse.json({ acceptance: null })
  const sign = async (p: string | null, name: string | null) => {
    if (!p) return { view: null, download: null }
    const b = sb.storage.from(BUCKET)
    const [{ data: v }, { data: d }] = await Promise.all([b.createSignedUrl(p, 600), b.createSignedUrl(p, 600, { download: name || true })])
    return { view: v?.signedUrl || null, download: d?.signedUrl || null }
  }
  return NextResponse.json({ acceptance: {
    accepted_at: a.accepted_at, uploaded_by: a.uploaded_by,
    signed_offer: { name: a.signed_file_name, ...(await sign(a.signed_file_url, a.signed_file_name)) },
    mail_proof: { name: a.mail_proof_name, ...(await sign(a.mail_proof_url, a.mail_proof_name)) },
  } })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error
  const by = await actorName(gate.user)
  const multipart = (req.headers.get('content-type') || '').includes('multipart/form-data')
  const fd = multipart ? await req.formData() : null
  const body: any = multipart ? Object.fromEntries([...fd!.entries()].filter(([, v]) => typeof v === 'string')) : await req.json().catch(() => null)
  if (!body?.candidate_id || !body?.action) return bad('candidate_id and action are required')

  const { data: cand } = await sb.from('candidates').select('*').eq('id', String(body.candidate_id)).maybeSingle()
  if (!cand) return bad('Candidate not found', 404)
  // All three answer a SENT offer that is still waiting for one.
  if (cand.stage !== 'Offer Sent' || cand.offer_accepted) return bad('This candidate has no offer waiting for a response.', 409)
  if (cand.offer_response === 'REVISION') return bad('This offer is with the HR Head for revision.', 409)
  const request = await latestRequest(cand.id)

  try {
    // ── Accepted: signed letter + mail screenshot ──
    if (body.action === 'accept') {
      const signed = fd?.get('signed_offer'), proof = fd?.get('mail_proof')
      if (!(signed instanceof File) || !signed.size) return bad('Upload the signed offer letter (PDF).')
      if (!(proof instanceof File) || !proof.size) return bad('Upload the screenshot of the acceptance mail.')
      if (!/pdf$/i.test(signed.type) && !/\.pdf$/i.test(signed.name)) return bad('The signed offer letter must be a PDF.')
      if (!/^image\//.test(proof.type) && !/pdf$/i.test(proof.type)) return bad('The mail screenshot must be an image (PNG / JPG) or a PDF.')
      const [signedPath, proofPath] = await Promise.all([upload(cand.id, 'SIGNED_OFFER', signed), upload(cand.id, 'OFFER_ACCEPT_MAIL', proof)])
      const { error } = await sb.from('offer_acceptances').insert({
        candidate_id: cand.id, approval_request_id: request?.id || null, company_id: cand.company_id || request?.company_id || null,
        acceptance_type: 'UPLOAD', signed_file_url: signedPath, signed_file_name: signed.name,
        mail_proof_url: proofPath, mail_proof_name: proof.name, uploaded_by: by, status: 'ACCEPTED',
      })
      if (error) return bad(error.message.includes('mail_proof') ? 'Run migration 134 in Supabase first (offer acceptance columns are missing).' : error.message, 500)
      await sb.from('candidates').update({ offer_accepted: true, offer_response: 'ACCEPTED' }).eq('id', cand.id)
      await closeMrfIfFilled(cand.mrf_id)
      await audit(cand, 'OFFER_ACCEPTED', { name: cand.full_name, by, signed_offer: signed.name, mail_proof: proof.name })
      return NextResponse.json({ ok: true })
    }

    // ── Backout: out of the pipeline, optionally blacklisted ──
    if (body.action === 'backout') {
      const blacklist = body.blacklist === true || body.blacklist === 'true'
      const reason = String(body.reason || '').trim() || 'Backed out after offer'
      let listed: any = null
      if (blacklist) listed = await addToBlacklist({ aadhaar: body.aadhaar, pan: body.pan, candidateId: cand.id, companyId: cand.company_id || null, candidateName: cand.full_name, reason, by })
      await sb.from('candidates').update({ offer_response: 'BACKOUT', offer_accepted: false, stage: 'Rejected', blacklisted: blacklist, blacklist_reason: reason }).eq('id', cand.id)
      await reopenMrf(cand.mrf_id)
      await audit(cand, 'OFFER_BACKOUT', { name: cand.full_name, by, reason, blacklisted: blacklist, ...(listed ? { aadhaar_last4: listed.aadhaar_last4, pan: listed.pan } : {}) })
      return NextResponse.json({ ok: true, blacklisted: blacklist })
    }

    // ── Revision: back to the HR Head ──
    if (body.action === 'revision') {
      const note = String(body.note || '').trim()
      if (!note) return bad('Say what should be revised — the HR Head reads this.')
      if (!request) return bad('No offer request was found for this candidate.', 404)
      const { error } = await sb.from('offer_approval_requests').update({
        status: 'SUBMITTED', hr_head_action: null, hr_head_comments: null, hr_head_actioned_at: null, submitted_at: new Date().toISOString(),
        revision_note: note, revision_requested_at: new Date().toISOString(), revision_requested_by: by, revision_count: Number(request.revision_count || 0) + 1,
      }).eq('id', request.id)
      if (error) return bad(error.message.includes('revision_') ? 'Run migration 134 in Supabase first (revision columns are missing).' : error.message, 500)
      // The sent letter no longer stands: the offer file must be verified and the letter generated again.
      const ad = typeof cand.application_details === 'object' && cand.application_details ? { ...cand.application_details } : {}
      delete ad.offer_verification
      await sb.from('candidates').update({ offer_response: 'REVISION', offer_revised: true, offer_revision_note: note, offer_accepted: false, application_details: ad }).eq('id', cand.id)
      await reopenMrf(cand.mrf_id)
      await audit(cand, 'OFFER_REVISE_REQUESTED', { name: cand.full_name, by, reason: note })

      // Tell the HR Head(s) — bell + mail.
      const companyId = request.company_id || cand.company_id || null
      const heads = await roleHolders(sb as any, companyId, ['HR_HEAD'])
      await Promise.all(heads.map(h => notify(h.id, `Offer revision — ${cand.full_name}`,
        `${by} has sent ${cand.full_name}'s offer back for revision: "${note}". Edit the offer and approve it from Recruitment → HR Head.`,
        `/ess-portal?module=recruitment&tab=hrhead&offer=${request.id}`, 'APPROVAL').catch(() => null)))
      const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
      const to = heads.map(h => h.email).filter(Boolean) as string[]
      let emailed = 0
      if (user && pass && to.length) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'
        await nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }).sendMail({
          from: `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`, to: to.join(','),
          subject: `Offer revision requested — ${cand.full_name}`,
          text: `Dear HR Head,\n\n${by} has sent the offer for ${cand.full_name}${cand.designation ? ` (${cand.designation})` : ''} back for revision.\n\nReason: ${note}\n\nPlease edit the offer and approve it: ${appUrl}/ess-portal?module=recruitment&tab=hrhead&offer=${request.id}\n\n— EZER HRMS`,
        }).then(() => { emailed = to.length }).catch(() => null)
      }
      return NextResponse.json({ ok: true, notified: heads.length, emailed })
    }
  } catch (e: any) {
    return bad(e?.message || 'Failed', 500)
  }
  return bad('Unknown action')
}
