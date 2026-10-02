// lib/recruitment/offer-letter-pdf.ts
// ===========================================================================
// Build a candidate's offer letter as a PDF printed onto the company's own
// letterhead, using the design configured in Admin Setup › Offer Letter.
//
// WHY THIS IS A MODULE AND NOT A ROUTE
//
// The only caller is send-offer-email, which already runs server-side. A route
// would add an internal HTTP hop with its own auth surface and buy nothing.
//
// WHAT IT REFUSES, AND WHAT IT LETS PASS
//
//   no template configured   → null, caller falls back to the drawn letter
//   no letterhead uploaded   → null, caller falls back to the drawn letter
//   unregistered {{token}}   → THROWS
//
// The last one is deliberate. renderTemplate leaves an unknown token in place
// rather than dropping it, so falling back silently would email a real
// candidate a letter with "{{offer_ctc_annual}}" printed on it. A broken
// template must stop the send and be fixed, which is the same call
// /api/letters/generate makes when it skips an employee on SKIPPED_UNKNOWN_TOKENS.
// A missing letterhead is different in kind: nothing is wrong, it just has not
// been set up yet, so the old path still works.
// ===========================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeLetterOntoLetterhead } from '@/lib/letterhead/merge'
import type { ResolvedLetterhead, ResolvedSignatory, ScopeType } from '@/lib/letterhead/types'
import { resolveMergeFieldsForOffer } from '@/lib/letters/mergeFields'
import { renderTemplate } from '@/lib/letters/renderTemplate'

const LETTER_TYPE = 'OFFER_LETTER'

/** Thrown when the configured template uses a token nothing can fill. */
export class OfferTemplateTokenError extends Error {
  tokens: string[]
  constructor(tokens: string[]) {
    super(
      'The offer letter template uses field(s) that cannot be filled: ' +
      tokens.map(t => `{{${t}}}`).join(', ') +
      '. Fix the template in Admin Setup › Offer Letter before sending.',
    )
    this.name = 'OfferTemplateTokenError'
    this.tokens = tokens
  }
}

export interface OfferLetterPdf {
  pdf: Buffer
  /** Which scope the stationery came from, for the audit line. */
  letterheadFrom: ScopeType | null
  letterheadFile: string | null
}

/** A letterhead_files row shaped into what merge expects. */
function asResolved(row: any, from: ScopeType, label: string): ResolvedLetterhead {
  return {
    location_id: '', company_id: row.company_id ?? '', group_id: row.group_id ?? '',
    location_name: label,
    file_url: row.file_url,
    file_name: row.file_name ?? null,
    page_width_mm: row.page_width_mm, page_height_mm: row.page_height_mm,
    content_top_mm: row.content_top_mm, content_bottom_mm: row.content_bottom_mm,
    content_left_mm: row.content_left_mm, content_right_mm: row.content_right_mm,
    scale_percent: row.scale_percent,
    letterhead_resolved_from: from,
    letterhead_configured: true,
  }
}

/**
 * Letterhead for an offer, in the same Branch > Company > Group order HR
 * Letters uses.
 *
 * The branch leg goes through the letterhead_resolved view when the offer's MRF
 * names a location, because that view already applies the whole cascade. When
 * it does not — an MRF with no location, which the schema permits — the view
 * cannot be queried at all (it is keyed by location_id), so the company and
 * group legs are read from letterhead_files directly rather than skipped.
 */
async function resolveLetterhead(supa: SupabaseClient, companyId: string | null, locationId: string | null, groupId: string | null) {
  if (locationId) {
    const { data } = await supa.from('letterhead_resolved').select('*').eq('location_id', locationId).maybeSingle()
    if (data?.letterhead_configured && data.file_url) return data as ResolvedLetterhead
  }
  if (companyId) {
    const { data } = await supa.from('letterhead_files')
      .select('*').eq('scope_type', 'COMPANY').eq('scope_key', companyId).eq('is_active', true).maybeSingle()
    if (data?.file_url) return asResolved(data, 'COMPANY', 'Company')
  }
  if (groupId) {
    const { data } = await supa.from('letterhead_files')
      .select('*').eq('scope_type', 'GROUP').eq('scope_key', groupId).eq('is_active', true).maybeSingle()
    if (data?.file_url) return asResolved(data, 'GROUP', 'Group')
  }
  return null
}

/** Signatory for an offer, same cascade. Optional — merge prints a ruled line without one. */
async function resolveSignatory(supa: SupabaseClient, companyId: string | null, locationId: string | null, groupId: string | null) {
  if (locationId) {
    const { data } = await supa.from('signatory_resolved').select('*').eq('location_id', locationId).maybeSingle()
    if (data?.signatory_configured && data.signature_url) return data as ResolvedSignatory & { signature_mime_type?: string }
  }
  for (const [scope, key] of [['COMPANY', companyId], ['GROUP', groupId]] as [ScopeType, string | null][]) {
    if (!key) continue
    const { data } = await supa.from('letterhead_signatories')
      .select('*').eq('scope_type', scope).eq('scope_key', key).eq('is_active', true).maybeSingle()
    if (data?.signature_url) {
      return {
        location_id: '', company_id: data.company_id ?? '', group_id: data.group_id ?? '',
        location_name: scope === 'COMPANY' ? 'Company' : 'Group',
        signatory_name: data.signatory_name, signatory_designation: data.signatory_designation,
        signature_url: data.signature_url,
        sig_x_pct: data.sig_x_pct, sig_y_pct: data.sig_y_pct, sig_width_pct: data.sig_width_pct,
        signatory_resolved_from: scope, signatory_configured: true,
        signature_mime_type: data.signature_mime_type,
      } as ResolvedSignatory & { signature_mime_type?: string }
    }
  }
  return null
}

/** Terms and annexures, company's own if it has any, otherwise the group-wide set. */
async function loadClauses(supa: SupabaseClient, companyId: string | null) {
  const read = async (cid: string | null) => {
    let q = supa.from('offer_letter_clauses').select('kind, heading, body, sort_order').eq('is_active', true)
    q = cid ? q.eq('company_id', cid) : q.is('company_id', null)
    const { data } = await q.order('kind').order('sort_order').order('created_at')
    return data ?? []
  }
  // Company clauses REPLACE the group set rather than adding to it: a company
  // that writes its own terms has said what its terms are, and silently
  // appending group boilerplate would put clauses in the letter nobody chose.
  const own = companyId ? await read(companyId) : []
  return own.length ? own : await read(null)
}

export async function buildOfferLetterPdf(
  supa: SupabaseClient,
  offerRequestId: string,
): Promise<OfferLetterPdf | null> {
  const { data: req } = await supa.from('offer_approval_requests')
    .select('id, company_id, mrf_id')
    .eq('id', offerRequestId).maybeSingle()
  if (!req) return null

  const companyId: string | null = (req as any).company_id ?? null

  // Template: the company's own, else the group-wide default. Looked up by
  // letter_type, never by name — see migration 140.
  const pick = async (cid: string | null) => {
    let q = supa.from('letter_templates').select('id, name, content').eq('letter_type', LETTER_TYPE).eq('is_active', true)
    q = cid ? q.eq('company_id', cid) : q.is('company_id', null)
    const { data } = await q.maybeSingle()
    return data
  }
  const tpl = (companyId ? await pick(companyId) : null) ?? (await pick(null))
  if (!tpl?.content?.trim()) return null   // nothing designed yet

  const resolved = await resolveMergeFieldsForOffer(offerRequestId)
  if (!resolved) return null

  const { text, unknownTokens } = renderTemplate(tpl.content, resolved.fields)
  if (unknownTokens.length) throw new OfferTemplateTokenError(unknownTokens)

  // Terms numbered, annexures titled after them — the same arrangement the
  // admin previews, so what they approved is what the candidate receives.
  const clauses = await loadClauses(supa, companyId)
  const terms = clauses.filter((c: any) => c.kind === 'TERM')
  const annexures = clauses.filter((c: any) => c.kind === 'ANNEXURE')
  const parts = [text]
  if (terms.length) {
    parts.push('TERMS AND CONDITIONS')
    terms.forEach((c: any, i: number) => parts.push(`${i + 1}. ${c.heading ? c.heading + ' — ' : ''}${c.body}`))
  }
  annexures.forEach((c: any) => parts.push(`ANNEXURE: ${c.heading || ''}\n\n${c.body}`))
  const bodyText = parts.join('\n\n')

  // Branch comes from the MRF when it has one; group from the company.
  let locationId: string | null = null
  if ((req as any).mrf_id) {
    const { data: mrf } = await supa.from('manpower_requisitions').select('location_id').eq('id', (req as any).mrf_id).maybeSingle()
    locationId = (mrf as any)?.location_id ?? null
  }
  let groupId: string | null = null
  if (companyId) {
    const { data: co } = await supa.from('companies').select('group_id').eq('id', companyId).maybeSingle()
    groupId = (co as any)?.group_id ?? null
  }

  const letterhead = await resolveLetterhead(supa, companyId, locationId, groupId)
  if (!letterhead?.file_url) return null   // not configured — caller falls back

  const signatory = await resolveSignatory(supa, companyId, locationId, groupId)

  const [lhFile, sigFile] = await Promise.all([
    supa.storage.from('letterhead-files').download(letterhead.file_url),
    signatory?.signature_url
      ? supa.storage.from('letterhead-signatures').download(signatory.signature_url)
      : Promise.resolve({ data: null } as any),
  ])
  if (!lhFile.data) return null            // uploaded row but missing object

  const signatureImageBytes = sigFile?.data ? await sigFile.data.arrayBuffer() : undefined
  // Read the stored mime rather than assuming PNG: embedPng on a JPEG throws,
  // which would take down a send over a signature image.
  const storedMime = (signatory as any)?.signature_mime_type
  const signatureMimeType = signatureImageBytes
    ? (storedMime === 'image/jpeg' ? 'image/jpeg' : 'image/png')
    : undefined

  const merged = await mergeLetterOntoLetterhead({
    letterhead,
    letterheadPdfBytes: await lhFile.data.arrayBuffer(),
    signatory,
    signatureImageBytes,
    signatureMimeType,
    letterTypeLabel: 'Offer Letter',
    bodyText,
  })

  return {
    pdf: Buffer.from(merged),
    letterheadFrom: letterhead.letterhead_resolved_from ?? null,
    letterheadFile: letterhead.file_name ?? null,
  }
}
