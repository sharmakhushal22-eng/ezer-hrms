// lib/esign/flow.ts — creating envelopes and completing signatures. Server only.
//
// The two operations every entry point shares (the E-Sign composer, bulk send, HR Letters,
// and anything that later sends a PDF for signature):
//   createEnvelopes()  one PDF in, one envelope per recipient out, invites mailed
//   applySignature()   stamp one signer onto the working copy, and finish the envelope —
//                      footer, certificate, final hash, completion mail — when it was the last
import { PDFDocument } from 'pdf-lib'
import type { NextRequest } from 'next/server'
import { sha256Hex, newEnvelopeNo, istStamp } from './core'
import { stampSignature, finalise, type StampField } from './stamp'
import { sb, upload, download, logEvent, inviteActive, mailCompleted, verifyUrl } from './server'

export interface SignerInput {
  name: string; email: string; phone?: string | null; employee_id?: string | null; designation?: string | null
  role_label?: string | null; auth_method?: 'EMAIL_OTP' | 'EMAIL_AADHAAR_OTP'; order_no?: number
  /** Bulk send: this slot is filled by each recipient in turn. */
  placeholder?: boolean
}
export interface FieldInput { signer: number; page: number; x: number; y: number; w: number; h: number; kind?: StampField['kind'] }
export interface CreateInput {
  uploadPath: string; originalName?: string | null; title: string; message?: string | null; category?: string | null
  companyId?: string | null; signingOrder?: 'SEQUENTIAL' | 'PARALLEL'; expiresDays?: number; ccEmails?: string[]
  signers: SignerInput[]; fields: FieldInput[]; recipients?: SignerInput[]
  source?: string; sourceRef?: string | null
  sender: { id: string | null; name: string; email: string | null }
  /** Signing inside another flow (the onboarding portal): the envelope starts as a DRAFT and
   *  no invite is mailed — the signer is already on our page and signs there. */
  embedded?: boolean
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number(n) || 0))

export function validateCreate(i: CreateInput, pageCount: number): string | null {
  if (!i.title?.trim()) return 'Give the document a title.'
  if (!i.signers?.length) return 'Add at least one signer.'
  if (i.signers.length > 20) return 'At most 20 signers on one document.'
  const bulk = i.signers.some(s => s.placeholder)
  if (bulk && !(i.recipients?.length)) return 'Bulk send: add the recipients.'
  if (bulk && i.signers.filter(s => s.placeholder).length > 1) return 'Bulk send has exactly one "each recipient" signer.'
  if ((i.recipients?.length || 0) > 500) return 'At most 500 recipients in one bulk send.'
  for (const s of [...i.signers.filter(s => !s.placeholder), ...(bulk ? i.recipients! : [])]) {
    if (!s.name?.trim()) return 'Every signer needs a name.'
    if (!emailRe.test(String(s.email || '').trim())) return `"${s.email || s.name}" is not a valid e-mail.`
  }
  for (let k = 0; k < i.signers.length; k++)
    if (!i.fields.some(f => f.signer === k && (f.kind || 'SIGNATURE') !== 'DATE' && (f.kind || 'SIGNATURE') !== 'NAME'))
      return `Place a signature box for ${i.signers[k].placeholder ? 'the recipient' : i.signers[k].name || `signer ${k + 1}`}.`
  for (const f of i.fields) if (f.page < 1 || f.page > pageCount || f.signer < 0 || f.signer >= i.signers.length) return 'A signature box is outside the document.'
  for (const c of i.ccEmails || []) if (!emailRe.test(c)) return `CC "${c}" is not a valid e-mail.`
  return null
}

/** Reads the uploaded PDF once; refuses encrypted / broken files before anything is created. */
export async function inspectUpload(path: string) {
  const bytes = await download(path)
  if (bytes.length > 25 * 1024 * 1024) throw new Error('The PDF is larger than 25 MB.')
  let doc: PDFDocument
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }) }
  catch (e: any) { throw new Error(/encrypt/i.test(String(e?.message)) ? 'This PDF is password-protected. Remove the password and upload it again.' : 'This file is not a readable PDF.') }
  return { bytes, pageCount: doc.getPageCount(), sha: sha256Hex(bytes) }
}

export async function createEnvelopes(i: CreateInput, base: string, req: NextRequest) {
  const { bytes, pageCount, sha } = await inspectUpload(i.uploadPath)
  const err = validateCreate(i, pageCount)
  if (err) throw Object.assign(new Error(err), { status: 400 })

  const bulk = i.signers.some(s => s.placeholder)
  const sets: SignerInput[][] = bulk
    ? i.recipients!.map(r => i.signers.map(s => s.placeholder ? { ...s, ...r, placeholder: false, role_label: s.role_label || r.role_label } : s))
    : [i.signers]
  const batchId = bulk ? crypto.randomUUID() : null
  const expires = new Date(Date.now() + Math.min(90, Math.max(1, i.expiresDays || 14)) * 86400_000).toISOString()
  const out: { id: string; envelope_no: string; to: string; invited: number; failed: string[]; links: { name: string; email: string; link: string }[] }[] = []

  for (const set of sets) {
    let env: any = null
    for (let a = 0; a < 4 && !env; a++) {
      const { data, error } = await sb.from('esign_envelopes').insert({
        envelope_no: newEnvelopeNo(), title: i.title.trim(), message: i.message || null,
        company_id: i.companyId || null, category: i.category || 'GENERAL', source: bulk ? 'BULK' : (i.source || 'MANUAL'),
        source_ref: i.sourceRef || null, batch_id: batchId, status: i.embedded ? 'DRAFT' : 'SENT', signing_order: i.signingOrder || 'SEQUENTIAL',
        page_count: pageCount, original_path: 'pending', original_sha256: sha, original_name: i.originalName || null,
        expires_at: expires, created_by_id: i.sender.id, created_by_name: i.sender.name, created_by_email: i.sender.email,
        cc_emails: i.ccEmails || [],
      }).select('*').single()
      if (error && !/duplicate key/i.test(error.message)) throw error
      env = data
    }
    if (!env) throw new Error('Could not allocate an envelope number. Try again.')
    const originalPath = `original/${env.id}.pdf`
    await upload(originalPath, bytes)
    await sb.from('esign_envelopes').update({ original_path: originalPath, working_path: originalPath }).eq('id', env.id)

    const rows = set.map((s, k) => ({
      envelope_id: env.id, order_no: i.signingOrder === 'PARALLEL' ? 1 : (s.order_no || k + 1),
      name: s.name.trim(), email: s.email.trim().toLowerCase(), phone: s.phone || null, employee_id: s.employee_id || null,
      designation: s.designation || null, role_label: s.role_label || null, auth_method: s.auth_method || 'EMAIL_OTP', status: 'WAITING',
    }))
    const { data: signers, error: sErr } = await sb.from('esign_signers').insert(rows).select('id, order_no')
    if (sErr) throw sErr
    const fields = i.fields.map(f => ({
      envelope_id: env.id, signer_id: signers![f.signer].id, page: Math.round(f.page),
      x: clamp01(f.x), y: clamp01(f.y), w: clamp01(f.w), h: clamp01(f.h), kind: f.kind || 'SIGNATURE',
    }))
    const { error: fErr } = await sb.from('esign_fields').insert(fields)
    if (fErr) throw fErr

    await logEvent(env.id, 'CREATED', { actor: i.sender.name, req, details: { pages: pageCount, sha256: sha, signers: rows.length, bulk } })
    if (i.embedded) { out.push({ id: env.id, envelope_no: env.envelope_no, to: rows.map(r => r.email).join(', '), invited: 0, failed: [], links: [] }); continue }
    await logEvent(env.id, 'SENT', { actor: i.sender.name, req })
    const inv = await inviteActive(env.id, base, { req, actor: i.sender.name })
    out.push({ id: env.id, envelope_no: env.envelope_no, to: rows.map(r => r.email).join(', '), ...inv })
  }
  return { batchId, envelopes: out }
}

/** Stamp this signer onto the latest working copy, with an optimistic lock so two signers
 *  of a parallel envelope signing in the same second cannot overwrite each other. */
export async function applySignature(envelopeId: string, signer: any, png: Uint8Array, kind: 'DRAWN' | 'TYPED' | 'UPLOADED', req: NextRequest, base: string, initialsPng: Uint8Array | null = null) {
  const now = new Date()
  const sigPath = `signatures/${envelopeId}/${signer.id}.png`
  await upload(sigPath, png, 'image/png')
  const { data: fields } = await sb.from('esign_fields').select('page, x, y, w, h, kind').eq('signer_id', signer.id)
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const stampSigner = { ...signer, signed_at: now.toISOString(), signed_ip: ip, signed_user_agent: req.headers.get('user-agent') }

  for (let attempt = 0; ; attempt++) {
    const { data: env } = await sb.from('esign_envelopes').select('id, envelope_no, doc_version, working_path, original_path').eq('id', envelopeId).single()
    const current = await download(env!.working_path || env!.original_path)
    const stamped = await stampSignature(current, {
      fields: (fields || []).map((f: any) => ({ ...f, x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) })),
      signer: stampSigner, signaturePng: png, initialsPng, envelopeNo: env!.envelope_no, signedAt: now,
    })
    const next = env!.doc_version + 1
    const path = `working/${envelopeId}-v${next}.pdf`
    await upload(path, stamped)
    const { data: won } = await sb.from('esign_envelopes').update({ doc_version: next, working_path: path, status: 'IN_PROGRESS', updated_at: now.toISOString() })
      .eq('id', envelopeId).eq('doc_version', env!.doc_version).select('id')
    if (won?.length) break
    if (attempt >= 5) throw new Error('Another signer is saving right now. Please press Sign again.')
  }

  await sb.from('esign_signers').update({
    status: 'SIGNED', signature_kind: kind, signature_path: sigPath, signed_at: now.toISOString(),
    signed_ip: ip, signed_user_agent: req.headers.get('user-agent'),
  }).eq('id', signer.id)
  await logEvent(envelopeId, 'SIGNED', { signerId: signer.id, actor: `${signer.name} <${signer.email}>`, req, details: { kind } })

  const { data: all } = await sb.from('esign_signers').select('status').eq('envelope_id', envelopeId)
  if ((all || []).every(s => s.status === 'SIGNED')) return { completed: await complete(envelopeId, base) }
  await inviteActive(envelopeId, base, { req })
  return { completed: false }
}

async function complete(envelopeId: string, base: string): Promise<boolean> {
  // Claim the completion: only one request may finalise, even if two signed together.
  const nowIso = new Date().toISOString()
  const { data: claim } = await sb.from('esign_envelopes').update({ completed_at: nowIso }).eq('id', envelopeId).is('completed_at', null).select('*')
  if (!claim?.length) return true
  const env = claim[0]
  const [{ data: signers }, { data: events }, company] = await Promise.all([
    sb.from('esign_signers').select('*').eq('envelope_id', envelopeId).order('order_no'),
    sb.from('esign_events').select('at, action, actor, ip, user_agent, details').eq('envelope_id', envelopeId).order('at'),
    env.company_id ? sb.from('companies').select('company_name').eq('id', env.company_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ])
  const sigs: Record<string, Uint8Array | undefined> = {}
  for (const s of signers || []) if (s.signature_path) sigs[s.id] = await download(s.signature_path).catch(() => undefined)
  const working = await download(env.working_path || env.original_path)
  const v = verifyUrl(base, env.envelope_no)
  const finalBytes = await finalise(working, {
    envelope: { ...env, completed_at: nowIso, company_name: (company as any)?.data?.company_name || null },
    signers: signers || [], events: [...(events || []), { at: nowIso, action: 'COMPLETED', actor: 'EZER Sign' }], signatures: sigs, verifyUrl: v,
  })
  const signedPath = `signed/${envelopeId}.pdf`
  await upload(signedPath, finalBytes)
  const signedSha = sha256Hex(finalBytes)
  await sb.from('esign_envelopes').update({ status: 'COMPLETED', signed_path: signedPath, signed_sha256: signedSha, updated_at: nowIso }).eq('id', envelopeId)
  await logEvent(envelopeId, 'COMPLETED', { actor: 'EZER Sign', details: { sha256: signedSha } })
  // What signing this document means elsewhere: a signed offer letter is the candidate's
  // acceptance (lib/recruitment/offer-esign.ts). Loaded lazily — that module imports this one.
  if (env.source === 'OFFER') {
    try { await (await import('@/lib/recruitment/offer-esign')).onOfferSigned(env, finalBytes) }
    catch (e) { console.error('offer acceptance from e-sign failed', e) }
  }

  const to = [...new Set([...(signers || []).map(s => s.email), env.created_by_email, ...(env.cc_emails || [])].filter(Boolean) as string[])]
  const stem = String(env.title || 'document').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'document'
  await mailCompleted({ to, title: env.title, envelopeNo: env.envelope_no, pdf: finalBytes, fileName: `${stem}_signed_${env.envelope_no}.pdf`, verify: v, signers: (signers || []).map(s => `${s.name} — ${istStamp(s.signed_at)}`) })
  return true
}
