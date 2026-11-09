// app/api/onboarding/esign/route.ts — the last step of the onboarding link: sign the joining
// forms with EZER Sign, then submit (lib/onboarding/esign.ts, lib/onboarding/submit.ts).
//
// POST { token, action: 'prepare', final_form_data }   save the form, run every submission check,
//        build the joining forms PDF and a DRAFT envelope  → { envelope_no, documents, email }
// POST { token, action: 'send_otp' }                    6-digit code to the candidate's e-mail
// POST { token, action: 'sign', otp, signature, kind, consent, final_form_data }
//        verify the code, stamp every signature box, finish the envelope, submit the form
// GET  ?token=…&file=preview|signed                     the PDF to review / the signed copy
// GET  ?onboarding_id=…                                 HR (Onboarding module): the signed copy
//
// Token-gated like every /api/onboarding route; the e-mail OTP is what ties the signature to
// the candidate. Before migration 174 the e-sign tables do not exist: `prepare` answers
// { setup: true } and the portal offers to submit without the signature, as before.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { migrationHint, download, logEvent, appBase } from '@/lib/esign/server'
import { applySignature } from '@/lib/esign/flow'
import { sendEmailOtp, verifyEmailOtp } from '@/lib/esign/signer'
import { maskEmail, sha256Hex } from '@/lib/esign/core'
import { prepareJoiningEnvelope, latestJoiningEnvelope, signedJoiningPdf } from '@/lib/onboarding/esign'
import { checkSubmission, submitOnboarding, SUBMIT_SELECT } from '@/lib/onboarding/submit'

export const runtime = 'nodejs'
export const maxDuration = 60

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)
const bad = (error: string, status = 400, extra: object = {}) => NextResponse.json({ error, ...extra }, { status })
const fail = (e: any) => { const hint = migrationHint(e); return bad(hint || e?.message || String(e), hint ? 503 : 500, hint ? { setup: true } : {}) }
const pdf = (bytes: Uint8Array, name: string, inline: boolean) => new NextResponse(Buffer.from(bytes), {
  headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`, 'Cache-Control': 'private, no-store' },
})

async function candidate(token: string) {
  if (!token) return null
  const { data } = await supa.from('onboarding_candidates').select(SUBMIT_SELECT).eq('magic_link_token', token).maybeSingle()
  return data
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const inline = q.get('mode') !== 'download'
  try {
    if (!q.get('token')) {
      const gate = await requireModule(req, 'Onboarding')
      if (gate.error) return gate.error
      const s = await signedJoiningPdf(q.get('onboarding_id') || '')
      return s ? pdf(s.bytes, s.fileName, inline) : bad('These joining forms were not e-signed (submitted before EZER Sign, or with the earlier Aadhaar demo).', 404)
    }
    const cand = await candidate(q.get('token') || '')
    if (!cand) return bad('Invalid link', 404)
    if (q.get('file') === 'signed') {
      const s = await signedJoiningPdf(cand.id)
      return s ? pdf(s.bytes, s.fileName, inline) : bad('No signed copy yet.', 404)
    }
    const open = await latestJoiningEnvelope(cand.id, ['DRAFT'])
    if (!open) return bad('Prepare the documents first.', 404)
    await logEvent(open.env.id, 'VIEWED', { signerId: open.signer.id, actor: `${open.signer.name} <${open.signer.email}>`, req })
    return pdf(await download(open.env.working_path || open.env.original_path), open.env.original_name || 'Joining_forms.pdf', inline)
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  try {
    const cand = await candidate(body.token)
    if (!cand) return bad('Invalid link', 404)
    if (cand.status === 'SUBMITTED' || cand.status === 'EMPLOYEE_CREATED') return bad('Already submitted', 409)
    if (!cand.email) return bad('No e-mail address is on your onboarding record, so the signing code cannot be sent. Ask HR to add it.')

    switch (body.action) {
      case 'prepare': {
        // The forms are drawn from the saved record, so the last steps are saved first.
        const fullData = { ...(cand.form_data || {}), ...(body.final_form_data || {}) }
        await supa.from('onboarding_candidates').update({ form_data: fullData }).eq('id', cand.id)
        const blocked = await checkSubmission(supa, cand, fullData)
        if (blocked) return NextResponse.json(blocked.body, { status: blocked.status })
        const r = await prepareJoiningEnvelope(supa, cand, req)
        return NextResponse.json({ ok: true, envelope_no: r.envelopeNo, documents: r.documents, boxes: r.boxes, email: maskEmail(cand.email) })
      }
      case 'send_otp': {
        const open = await latestJoiningEnvelope(cand.id, ['DRAFT'])
        if (!open) return bad('Your documents expired. Go back one step and return to prepare them again.', 409)
        const r = await sendEmailOtp(open.env, open.signer, req)
        return r.ok ? NextResponse.json(r) : bad(r.error, r.status)
      }
      case 'sign': {
        if (body.consent !== true) return bad('Please confirm you agree to sign electronically.')
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ''))
        if (!m) return bad('Add your signature first.')
        const png = Buffer.from(m[1], 'base64')
        if (png.length < 200 || png.length > 1_500_000 || png.readUInt32BE(0) !== 0x89504e47) return bad('That signature image could not be read. Draw or upload it again.')
        const kind = ['DRAWN', 'TYPED', 'UPLOADED'].includes(body.kind) ? body.kind : 'DRAWN'

        const open = await latestJoiningEnvelope(cand.id, ['DRAFT'])
        if (!open) return bad('Your documents expired. Go back one step and return to prepare them again.', 409)
        const blocked = await checkSubmission(supa, cand, { ...(cand.form_data || {}), ...(body.final_form_data || {}) })
        if (blocked) return NextResponse.json(blocked.body, { status: blocked.status })
        const v = await verifyEmailOtp(open.env, open.signer, body.otp, req)
        if (!v.ok) return bad(v.error, v.status)

        await applySignature(open.env.id, open.signer, new Uint8Array(png), kind, req, appBase(req))
        const signed = await signedJoiningPdf(cand.id)
        const now = new Date().toISOString()
        // The onboarding record keeps its own trace (the acknowledgement and HR screens read it).
        await supa.from('onboarding_esign_records').insert({
          onboarding_id: cand.id, aadhaar_last4: null, otp_verified_at: now,
          signed_bundle: ['POLICY_ACK_BUNDLE', 'EPF_FORM11', 'EPF_FORM2', 'GRATUITY_FORM_F', ...(cand.esic_applicable ? ['ESIC_FORM1'] : [])],
          esign_hash: signed ? sha256Hex(signed.bytes) : open.env.envelope_no,
        })
        await supa.from('onboarding_candidates').update({ policies_ack_complete: true, esign_complete: true, esign_completed_at: now }).eq('id', cand.id)
        await supa.from('onboarding_audit_log').insert({
          onboarding_id: cand.id, action: 'ESIGN_COMPLETED', actor_type: 'CANDIDATE',
          details: { method: 'EZER_SIGN_EMAIL_OTP', envelope_no: open.env.envelope_no },
        })

        const r = await submitOnboarding(supa, body.token, body.final_form_data, req)
        return NextResponse.json({ ...r.body, envelope_no: open.env.envelope_no, signed: !!signed }, { status: r.status })
      }
    }
    return bad('Unknown action')
  } catch (e) { return fail(e) }
}
