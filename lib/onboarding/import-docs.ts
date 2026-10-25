// lib/onboarding/import-docs.ts — SERVER ONLY.
//
// What the candidate already gave us before the offer (the pre-offer document collection:
// candidate_documents_uploaded, bucket onboarding-docs, path recruitment/<candidate>/…) is
// carried into their onboarding form, so they are not asked for the same PAN card twice.
// The portal shows these as uploaded, with view / download / replace / remove.
//
// Idempotent: a document code already present on the onboarding is left alone (the
// candidate may have replaced it). The storage object is shared, not copied — the
// onboarding row points at the recruitment path; removing it from the form never deletes
// the recruiter's copy.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Pre-offer collection type → onboarding document code. Aadhaar is one type there, two sides here. */
const MAP: Record<string, string> = {
  PAN: 'PAN', PHOTO: 'PHOTO', BANK_PROOF: 'BANK_PROOF',
  '10TH_MARKSHEET': 'MARKSHEET_10', '12TH_MARKSHEET': 'MARKSHEET_12', GRADUATION: 'DEGREE', MASTERS: 'MASTERS', ADDITIONAL_1: 'OTHER_CERT',
  APPOINTMENT_LETTER: 'APPOINTMENT_LETTER', APPRAISAL_LETTER: 'APPRAISAL_LETTER',
  SALARY_SLIP_1: 'SALARY_SLIP_1', SALARY_SLIP_2: 'SALARY_SLIP_2', SALARY_SLIP_3: 'SALARY_SLIP_3', FORM_16: 'FORM_16',
}
export const CARRIED_NOTE = 'Carried over from the pre-offer document collection'

export async function importCollectedDocs(sb: SupabaseClient, onboardingId: string, candidateId: string | null): Promise<number> {
  if (!candidateId) return 0
  const { data: src } = await sb.from('candidate_documents_uploaded').select('doc_type, file_name, file_url, file_size, file_type, uploaded_at').eq('candidate_id', candidateId).order('uploaded_at', { ascending: true })
  if (!src?.length) return 0
  const { data: have } = await sb.from('onboarding_documents').select('doc_code').eq('onboarding_id', onboardingId)
  const present = new Set((have || []).map((d: any) => d.doc_code))
  const rows: any[] = []
  let aadhaar = 0
  for (const d of src) {
    if (!d.file_url) continue
    let code: string | null = null
    if (d.doc_type === 'AADHAAR') { code = aadhaar === 0 ? 'AADHAAR_FRONT' : aadhaar === 1 ? 'AADHAAR_BACK' : null; aadhaar++ }
    else code = MAP[d.doc_type] || null
    if (!code || present.has(code)) continue
    present.add(code)
    rows.push({ onboarding_id: onboardingId, doc_code: code, storage_path: d.file_url, file_name: d.file_name, file_size: d.file_size, mime_type: d.file_type, ai_status: 'PENDING', hr_notes: CARRIED_NOTE, uploaded_at: d.uploaded_at || new Date().toISOString() })
  }
  if (!rows.length) return 0
  const { error } = await sb.from('onboarding_documents').upsert(rows, { onConflict: 'onboarding_id,doc_code', ignoreDuplicates: true })
  if (error) { console.error('importCollectedDocs', error.message); return 0 }
  return rows.length
}
