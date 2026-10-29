// lib/onboarding/esign.ts — SERVER ONLY. The joining forms, signed with EZER Sign.
//
// The last step of the onboarding link used to "sign" with a demo Aadhaar OTP that accepted any
// six digits and put no signature on anything. It now goes through EZER Sign (lib/esign):
//
//   prepareJoiningEnvelope()  one PDF — the joining acknowledgement, then every statutory form
//                             that applies (EPF Form 11, EPF Form 2, Gratuity Form F, ESIC Form 1)
//                             — with a signature box wherever the EMPLOYEE signs, as a DRAFT
//                             envelope with the candidate as its only signer. No invite is mailed:
//                             the candidate is already on the portal and signs there.
//   (the route verifies an e-mail OTP and calls applySignature, which stamps every box and
//    finishes the envelope: footer, Certificate of Completion, SHA-256, copy to the candidate)
//   signedJoiningPdf()        the finished PDF, for the HR mail on submission, the HR review
//                             sheet and the welcome mail with the Employee ID.
//
// Witnesses (Form F) and the employer (every form) still sign by hand where the forms ask.
// The envelope shows in Compliance & Docs → E-Sign under "Onboarding form", source ONBOARDING.
import { PDFDocument } from 'pdf-lib'
import type { NextRequest } from 'next/server'
import { sb, upload, download, BUCKET, appBase } from '@/lib/esign/server'
import { createEnvelopes } from '@/lib/esign/flow'
import { ackPdf, loadAckFacts } from './ack-pdf'
import { FORMS, formsFor, loadStatutory, renderStatutoryForm, hasStatutoryForms, type SignSpot } from './statutory-forms'

export const SOURCE = 'ONBOARDING'

/** The bundle the candidate signs, and where each signature goes (pages are 1-based in the bundle). */
export async function buildJoiningBundle(supa: any, onboardingId: string) {
  const ack = await loadAckFacts(supa, { id: onboardingId })
  if (!ack) throw new Error('Onboarding record not found')
  const out = await PDFDocument.create()
  const spots: SignSpot[] = []
  const documents: string[] = []

  const add = async (bytes: Uint8Array, own: SignSpot[], label: string) => {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const offset = out.getPageCount()
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p)
    spots.push(...own.map(s => ({ ...s, page: s.page + offset })))
    documents.push(label)
  }

  const a = await ackPdf(ack.company, { ...ack.facts, forSigning: true })
  await add(new Uint8Array(a.content), a.spot ? [a.spot] : [], 'Joining acknowledgement & declaration')

  const st = await loadStatutory(supa, { id: onboardingId }, { photo: true })
  if (st && hasStatutoryForms(st.oc)) {
    for (const k of formsFor(st.data)) {
      const own: SignSpot[] = []
      await add(await renderStatutoryForm(k, st.data, { photo: st.photo, spots: own }), own, FORMS[k].label)
    }
  }
  out.setTitle(`Joining forms — ${ack.facts.employeeName}`)
  out.setProducer('EZER HRMS')
  return { bytes: await out.save(), spots, documents, name: ack.facts.employeeName as string, companyId: ack.cand.company_id as string | null }
}

/** The candidate's latest joining envelope in one of these states, with its signer. */
export async function latestJoiningEnvelope(onboardingId: string, statuses: string[]) {
  const { data: env, error } = await sb.from('esign_envelopes').select('*')
    .eq('source', SOURCE).eq('source_ref', onboardingId).in('status', statuses)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!env) return null
  const { data: signer } = await sb.from('esign_signers').select('*').eq('envelope_id', env.id).order('order_no').limit(1).maybeSingle()
  return signer ? { env, signer } : null
}

/** A fresh DRAFT envelope for the joining forms. Earlier unsigned drafts of this candidate are
 *  deleted — they were only ever previews, and the data may have changed since. */
export async function prepareJoiningEnvelope(supa: any, cand: { id: string; full_name: string; email: string; hr_spoc_id?: string | null }, req: NextRequest) {
  const { data: old } = await sb.from('esign_envelopes').select('id, original_path').eq('source', SOURCE).eq('source_ref', cand.id).eq('status', 'DRAFT')
  if (old?.length) {
    await sb.storage.from(BUCKET).remove(old.map(o => o.original_path).filter(p => p && p !== 'pending'))
    await sb.from('esign_envelopes').delete().in('id', old.map(o => o.id))
  }

  const b = await buildJoiningBundle(supa, cand.id)
  const uploadPath = `uploads/onboarding-${cand.id}-${Date.now()}.pdf`
  await upload(uploadPath, b.bytes)

  // The HR SPOC is named as the sender (the certificate says who asked); the signed copy reaches
  // HR with the "form submitted" mail, so the envelope itself mails only the candidate.
  let senderName = 'HR (onboarding)'
  if (cand.hr_spoc_id) {
    const { data } = await supa.from('employees').select('full_name').eq('id', cand.hr_spoc_id).maybeSingle()
    if (data?.full_name) senderName = data.full_name
  }
  try {
    const r = await createEnvelopes({
      uploadPath, originalName: `Joining_forms_${b.name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`,
      title: `Joining forms — ${b.name}`, category: 'ONBOARDING', companyId: b.companyId,
      source: SOURCE, sourceRef: cand.id, embedded: true, expiresDays: 14,
      signers: [{ name: b.name || cand.full_name, email: cand.email, role_label: 'Employee (new joiner)', auth_method: 'EMAIL_OTP' }],
      fields: b.spots.map(s => ({ signer: 0, page: s.page, x: s.x, y: s.y, w: s.w, h: s.h, kind: 'SIGNATURE' as const })),
      sender: { id: cand.hr_spoc_id || null, name: senderName, email: null },
    }, appBase(req), req)
    return { envelopeNo: r.envelopes[0].envelope_no, documents: b.documents, boxes: b.spots.length }
  } finally {
    await sb.storage.from(BUCKET).remove([uploadPath]).then(() => {}, () => {})
  }
}

/** The signed joining forms of this onboarding, or null when they were not e-signed. */
export async function signedJoiningPdf(onboardingId: string): Promise<{ bytes: Uint8Array; fileName: string; envelopeNo: string; completedAt: string } | null> {
  const { data: env } = await sb.from('esign_envelopes').select('envelope_no, title, signed_path, completed_at')
    .eq('source', SOURCE).eq('source_ref', onboardingId).eq('status', 'COMPLETED')
    .order('completed_at', { ascending: false }).limit(1).maybeSingle()
  if (!env?.signed_path) return null
  const stem = String(env.title || 'Joining forms').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)
  return { bytes: await download(env.signed_path), fileName: `${stem}_signed_${env.envelope_no}.pdf`, envelopeNo: env.envelope_no, completedAt: env.completed_at }
}
