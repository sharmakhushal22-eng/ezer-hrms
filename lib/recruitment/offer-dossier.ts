// lib/recruitment/offer-dossier.ts — SERVER ONLY.
//
// The HR Manager's "offer file" on Send Offers: everything captured about a candidate from
// Add Candidate to the HR Head's approval, as labelled rows, plus the documents uploaded in the
// pre-negotiation check, the interview outcomes and the salary break-up.
//
// The HR Manager reads it as a form in four parts and confirms it with ONE checkbox at the end;
// only then can the offer letter be generated (lib/recruitment/offer-letter-pdf.ts) and sent.
//
// Editing: candidate details and the joining details are editable; the offered compensation
// the HR Head approved is locked (changing it needs a fresh approval). Any edit clears the
// verification and the "letter generated" mark, so a changed file is always re-verified and the
// letter regenerated before it can go out.
//
// The confirmation lives in candidates.application_details.offer_verification (no migration):
//   { request_id, verified: { by, at, h } | null, letter: { by, at, h } | null }
// Both carry a fingerprint (h) of the whole file — every detail, interview, the salary break-up
// and every document. They only count while the file still matches, so a change made anywhere
// (this screen, another screen, a renegotiated salary, an offer sent back for revision) undoes
// the verification by itself.
//
// Writes re-read application_details just before saving and change only what they own, so two
// saves close together cannot put back each other's stale copy.

import { createHash } from 'crypto'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { linkStatementRows, type StmtRow } from './ctc-statement'

type Ctx = { cand: any; ad: any; req: any; mrf: any; neg: any; company: any; dept: any; loc: any; manager: any }
type FieldType = 'text' | 'textarea' | 'date' | 'number' | 'email' | 'tel'
type Field = {
  key: string; section: string; label: string; type?: FieldType
  get: (c: Ctx) => any
  /** where an edit is written; absent = read-only */
  edit?: { table: 'candidates'; column: string } | { table: 'candidates'; adPath: [string, string] } | { table: 'request'; column: string }
  fmt?: 'money' | 'date' | 'pct'
}

const ad = (c: Ctx, a: string, b: string) => c.ad?.[a]?.[b]
const yn = (v: any) => v === true ? 'Yes' : v === false ? 'No' : v

// The order here is the order on screen.
export const FIELDS: Field[] = [
  // Personal
  { key: 'full_name', section: 'Personal', label: 'Full name', get: c => c.cand.full_name, edit: { table: 'candidates', column: 'full_name' } },
  { key: 'dob', section: 'Personal', label: 'Date of birth', type: 'date', fmt: 'date', get: c => ad(c, 'personal', 'dob'), edit: { table: 'candidates', adPath: ['personal', 'dob'] } },
  { key: 'gender', section: 'Personal', label: 'Gender', get: c => ad(c, 'personal', 'gender'), edit: { table: 'candidates', adPath: ['personal', 'gender'] } },
  { key: 'marital_status', section: 'Personal', label: 'Marital status', get: c => ad(c, 'personal', 'marital_status'), edit: { table: 'candidates', adPath: ['personal', 'marital_status'] } },
  { key: 'nationality', section: 'Personal', label: 'Nationality', get: c => ad(c, 'personal', 'nationality'), edit: { table: 'candidates', adPath: ['personal', 'nationality'] } },
  { key: 'languages', section: 'Personal', label: 'Languages', get: c => ad(c, 'personal', 'languages'), edit: { table: 'candidates', adPath: ['personal', 'languages'] } },
  { key: 'pan', section: 'Personal', label: 'PAN', get: c => ad(c, 'identity', 'pan') },
  { key: 'aadhaar_last4', section: 'Personal', label: 'Aadhaar (last 4 digits)', get: c => ad(c, 'identity', 'aadhaar_last4') ? `XXXX XXXX ${ad(c, 'identity', 'aadhaar_last4')}` : null },
  // Contact
  { key: 'email', section: 'Contact', label: 'Email', type: 'email', get: c => c.cand.email, edit: { table: 'candidates', column: 'email' } },
  { key: 'phone', section: 'Contact', label: 'Mobile', type: 'tel', get: c => c.cand.mobile || c.cand.phone, edit: { table: 'candidates', column: 'phone' } },
  { key: 'alt_mobile', section: 'Contact', label: 'Alternate mobile', type: 'tel', get: c => ad(c, 'contact', 'alt_mobile'), edit: { table: 'candidates', adPath: ['contact', 'alt_mobile'] } },
  { key: 'current_city', section: 'Contact', label: 'Current city', get: c => ad(c, 'contact', 'current_city'), edit: { table: 'candidates', adPath: ['contact', 'current_city'] } },
  { key: 'preferred_location', section: 'Contact', label: 'Preferred location', get: c => ad(c, 'contact', 'preferred_location'), edit: { table: 'candidates', adPath: ['contact', 'preferred_location'] } },
  { key: 'permanent_address', section: 'Contact', label: 'Permanent address', type: 'textarea', get: c => ad(c, 'contact', 'permanent_address'), edit: { table: 'candidates', adPath: ['contact', 'permanent_address'] } },
  { key: 'willing_to_relocate', section: 'Contact', label: 'Willing to relocate', get: c => yn(ad(c, 'contact', 'willing_to_relocate')) },
  // Education & experience
  { key: 'qualification', section: 'Education & experience', label: 'Qualification', get: c => ad(c, 'professional', 'qualification'), edit: { table: 'candidates', adPath: ['professional', 'qualification'] } },
  { key: 'specialization', section: 'Education & experience', label: 'Specialisation', get: c => ad(c, 'professional', 'specialization'), edit: { table: 'candidates', adPath: ['professional', 'specialization'] } },
  { key: 'institute', section: 'Education & experience', label: 'Institute', get: c => ad(c, 'professional', 'institute'), edit: { table: 'candidates', adPath: ['professional', 'institute'] } },
  { key: 'passing_year', section: 'Education & experience', label: 'Passing year', get: c => ad(c, 'professional', 'passing_year'), edit: { table: 'candidates', adPath: ['professional', 'passing_year'] } },
  { key: 'certifications', section: 'Education & experience', label: 'Certifications', get: c => ad(c, 'professional', 'certifications'), edit: { table: 'candidates', adPath: ['professional', 'certifications'] } },
  { key: 'skills', section: 'Education & experience', label: 'Skills', type: 'textarea', get: c => ad(c, 'professional', 'skills'), edit: { table: 'candidates', adPath: ['professional', 'skills'] } },
  { key: 'experience_years', section: 'Education & experience', label: 'Total experience (years)', type: 'number', get: c => c.cand.experience_years, edit: { table: 'candidates', column: 'experience_years' } },
  { key: 'relevant_exp', section: 'Education & experience', label: 'Relevant experience', get: c => ad(c, 'professional', 'relevant_exp'), edit: { table: 'candidates', adPath: ['professional', 'relevant_exp'] } },
  { key: 'function', section: 'Education & experience', label: 'Function', get: c => ad(c, 'professional', 'function'), edit: { table: 'candidates', adPath: ['professional', 'function'] } },
  { key: 'current_company', section: 'Education & experience', label: 'Current company', get: c => c.cand.current_company, edit: { table: 'candidates', column: 'current_company' } },
  { key: 'notice_period', section: 'Education & experience', label: 'Notice period at application (days)', type: 'number', get: c => c.cand.notice_period, edit: { table: 'candidates', column: 'notice_period' } },
  { key: 'last_working_day', section: 'Education & experience', label: 'Last working day', type: 'date', fmt: 'date', get: c => ad(c, 'professional', 'last_working_day'), edit: { table: 'candidates', adPath: ['professional', 'last_working_day'] } },
  // Previous employer — what the HR Head saw on the request; locked with the approval
  { key: 'prev_company_name', section: 'Previous employer (as approved)', label: 'Company', get: c => c.req.prev_company_name || c.cand.current_company },
  { key: 'prev_company_address', section: 'Previous employer (as approved)', label: 'Address', get: c => c.req.prev_company_address },
  { key: 'prev_total_ctc', section: 'Previous employer (as approved)', label: 'Total CTC', fmt: 'money', get: c => Number(c.req.prev_total_ctc) > 0 ? c.req.prev_total_ctc : null },
  { key: 'prev_fixed_ctc', section: 'Previous employer (as approved)', label: 'Fixed CTC', fmt: 'money', get: c => Number(c.req.prev_fixed_ctc) > 0 ? c.req.prev_fixed_ctc : null },
  { key: 'prev_variable', section: 'Previous employer (as approved)', label: 'Variable', fmt: 'money', get: c => Number(c.req.prev_variable) > 0 ? c.req.prev_variable : null },
  { key: 'expected_ctc', section: 'Previous employer (as approved)', label: 'Expected CTC (at application)', fmt: 'money', get: c => Number(c.cand.expected_ctc) > 0 ? c.cand.expected_ctc : null },
  // Position & joining — the letter's facts; editable
  { key: 'designation', section: 'Position & joining', label: 'Position offered', get: c => c.cand.designation || c.mrf?.designation || c.mrf?.position, edit: { table: 'candidates', column: 'designation' } },
  { key: 'company', section: 'Position & joining', label: 'Company', get: c => c.company?.company_name },
  { key: 'department', section: 'Position & joining', label: 'Department', get: c => c.dept?.dept_name },
  { key: 'job_location', section: 'Position & joining', label: 'Job location', get: c => ad(c, 'requisition', 'job_location') || c.loc?.location_name, edit: { table: 'candidates', adPath: ['requisition', 'job_location'] } },
  { key: 'employment_type', section: 'Position & joining', label: 'Employment type', get: c => ad(c, 'requisition', 'employment_type') || c.mrf?.employment_type },
  { key: 'reports_to', section: 'Position & joining', label: 'Reports to', get: c => c.manager?.full_name ? `${c.manager.full_name}${c.mrf?.reports_to_designation ? `, ${c.mrf.reports_to_designation}` : ''}` : c.mrf?.reports_to_designation },
  { key: 'work_mode', section: 'Position & joining', label: 'Work mode', get: c => c.mrf?.work_mode },
  { key: 'grade', section: 'Position & joining', label: 'Grade', get: c => c.mrf?.grade },
  { key: 'mrf_number', section: 'Position & joining', label: 'MRF', get: c => c.mrf?.mrf_number },
  { key: 'proposed_doj', section: 'Position & joining', label: 'Date of joining', type: 'date', fmt: 'date', get: c => c.req.proposed_doj, edit: { table: 'request', column: 'proposed_doj' } },
  { key: 'notice_period_days', section: 'Position & joining', label: 'Notice period to serve (days)', type: 'number', get: c => c.req.notice_period_days, edit: { table: 'request', column: 'notice_period_days' } },
  // Offered compensation — approved by the HR Head, locked
  { key: 'offered_ctc', section: 'Offered compensation (approved — locked)', label: 'Annual CTC', fmt: 'money', get: c => c.neg?.is_stipend ? null : c.req.offered_ctc },
  { key: 'stipend', section: 'Offered compensation (approved — locked)', label: 'Monthly stipend', fmt: 'money', get: c => c.neg?.is_stipend ? c.neg.stipend_monthly : null },
  { key: 'variable_pct', section: 'Offered compensation (approved — locked)', label: 'Variable', fmt: 'pct', get: c => Number(c.req.offered_variable_pct ?? c.neg?.variable_pct) > 0 ? (c.req.offered_variable_pct ?? c.neg?.variable_pct) : null },
  { key: 'monthly_inhand', section: 'Offered compensation (approved — locked)', label: 'Monthly in-hand (est.)', fmt: 'money', get: c => c.req.monthly_inhand ?? c.neg?.net_monthly },
  { key: 'hike_pct', section: 'Offered compensation (approved — locked)', label: 'Hike', fmt: 'pct', get: c => c.req.hike_pct != null ? Number(c.req.hike_pct).toFixed(1) : null },
  { key: 'joining_bonus', section: 'Offered compensation (approved — locked)', label: 'Joining bonus', fmt: 'money', get: c => Number(c.req.joining_bonus) > 0 ? c.req.joining_bonus : null },
  { key: 'retention_bonus', section: 'Offered compensation (approved — locked)', label: 'Retention bonus', fmt: 'money', get: c => Number(c.req.retention_bonus) > 0 ? c.req.retention_bonus : null },
  { key: 'esop_value', section: 'Offered compensation (approved — locked)', label: 'ESOP', fmt: 'money', get: c => Number(c.req.esop_value) > 0 ? c.req.esop_value : null },
  { key: 'notice_buyout', section: 'Offered compensation (approved — locked)', label: 'Notice buyout', get: c => c.req.notice_buyout ? (Number(c.req.notice_buyout_amount) > 0 ? `Yes · Rs. ${Math.round(Number(c.req.notice_buyout_amount)).toLocaleString('en-IN')}` : 'Yes') : null },
  // Source
  { key: 'source', section: 'Source', label: 'Source', get: c => c.cand.source },
  { key: 'referrer', section: 'Source', label: 'Referred by', get: c => ad(c, 'source', 'referrer_name') },
  { key: 'applied_date', section: 'Source', label: 'Applied on', fmt: 'date', get: c => c.cand.applied_date },
]

const blank = (v: any) => v == null || v === '' || (Array.isArray(v) && !v.length)
const show = (v: any, f?: Field['fmt']) => {
  if (blank(v)) return null
  if (Array.isArray(v)) return v.join(', ')
  if (f === 'money') return `₹${Math.round(Number(v)).toLocaleString('en-IN')}`
  if (f === 'pct') return `${v}%`
  if (f === 'date') { const d = new Date(v); return isNaN(+d) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  return String(v)
}

export type DossierRow = { key: string; section: string; label: string; value: string | null; raw: any; type: FieldType; editable: boolean }
export type DossierDoc = { key: string; id: string; name: string; label: string; size: number | null; uploaded_at: string | null; url: string | null; downloadUrl: string | null }
export type DossierInterview = { key: string; round: string; interviewer: string | null; decision: string | null; score: string | null; on: string | null; remark: string | null }
export type Dossier = {
  request: any; candidate: any; company: any; mrf: any; negotiation: any; ctx: Ctx
  rows: DossierRow[]; documents: DossierDoc[]; interviews: DossierInterview[]
  salary: { rows: StmtRow[]; extras: [string, number | string][] } | null
  verification: { verified: { by: string; at: string } | null; letter: { by: string; at: string } | null }
  /** every item the one checkbox vouches for */
  required: string[]; complete: boolean
  /** fingerprint of every item's current value, and of the whole file */
  fingerprints: Record<string, string>; fileHash: string
}

const fp = (v: any) => createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16)

/** Load the whole file for one approval request. Null when the request does not exist. */
export async function loadDossier(requestId: string): Promise<Dossier | null> {
  const { data: req } = await sb.from('offer_approval_requests').select('*').eq('id', requestId).maybeSingle()
  if (!req) return null
  const { data: cand } = await sb.from('candidates').select('*').eq('id', req.candidate_id).maybeSingle()
  if (!cand) return null
  const mrfId = req.mrf_id || cand.mrf_id
  const [{ data: mrf }, { data: neg }, { data: company }, { data: docsRaw }, { data: invites }] = await Promise.all([
    mrfId ? sb.from('manpower_requisitions').select('*').eq('id', mrfId).maybeSingle() : Promise.resolve({ data: null } as any),
    req.ctc_negotiation_id
      ? sb.from('ctc_negotiations').select('*').eq('id', req.ctc_negotiation_id).maybeSingle()
      : sb.from('ctc_negotiations').select('*').eq('candidate_id', cand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('companies').select('*').eq('id', req.company_id || cand.company_id).maybeSingle(),
    sb.from('candidate_documents_uploaded').select('*').eq('candidate_id', cand.id).order('uploaded_at', { ascending: true }),
    sb.from('interview_invites').select('*').eq('candidate_id', cand.id).order('created_at', { ascending: true }),
  ])
  const [{ data: dept }, { data: loc }, { data: manager }] = await Promise.all([
    mrf?.department_id ? sb.from('departments').select('dept_name').eq('id', mrf.department_id).maybeSingle() : Promise.resolve({ data: null } as any),
    mrf?.location_id ? sb.from('locations').select('location_name').eq('id', mrf.location_id).maybeSingle() : Promise.resolve({ data: null } as any),
    mrf?.reporting_manager_id ? sb.from('employees').select('full_name').eq('id', mrf.reporting_manager_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const appDetails = typeof cand.application_details === 'string' ? safeJson(cand.application_details) : (cand.application_details || {})
  const ctx: Ctx = { cand, ad: appDetails, req, mrf, neg, company, dept, loc, manager }

  const rows: DossierRow[] = FIELDS.map(f => {
    const raw = f.get(ctx)
    return { key: f.key, section: f.section, label: f.label, value: show(raw, f.fmt), raw: blank(raw) ? null : raw, type: f.type || 'text', editable: !!f.edit }
  }).filter(r => r.value != null || r.editable)   // a blank read-only row says nothing

  // Documents from the pre-negotiation check — short-lived signed URLs, one inline, one download.
  const bucket = sb.storage.from('onboarding-docs')
  const documents: DossierDoc[] = await Promise.all((docsRaw || []).map(async (d: any) => {
    const name = d.file_name || d.doc_label || d.doc_type
    const [{ data: v }, { data: dl }] = d.file_url ? await Promise.all([
      bucket.createSignedUrl(d.file_url, 60 * 30),
      bucket.createSignedUrl(d.file_url, 60 * 30, { download: name || true }),
    ]) : [{ data: null }, { data: null }] as any
    return { key: `doc:${d.id}`, id: d.id, name, label: d.doc_label || d.doc_type, size: d.file_size ?? null, uploaded_at: d.uploaded_at ?? null, url: v?.signedUrl || null, downloadUrl: dl?.signedUrl || v?.signedUrl || null }
  }))

  // Interview outcomes — one row per round's MAIN interviewer that has given feedback.
  const interviews: DossierInterview[] = (invites || [])
    .filter((i: any) => (i.role || 'MAIN') === 'MAIN' && (i.status === 'submitted' || i.feedback))
    .map((i: any) => ({
      key: `interview:${i.id}`, round: i.round, interviewer: i.interviewer_name,
      decision: i.decision || i.feedback?.decision || null,
      score: i.feedback?.total != null ? `${i.feedback.total}/80${i.feedback.band ? ` (${i.feedback.band})` : ''}` : null,
      on: i.submitted_at || i.scheduled_at || null, remark: i.decision_remark || i.feedback?.remark || null,
    }))

  // The HR Head's revision (Offers → Revision → HR Head edits) replaces the negotiated calculation.
  const link = neg && !neg.is_stipend ? linkStatementRows(req.revised_calculation || neg.calculation_data || {}, req.offered_ctc ?? neg.offered_ctc) : null
  const extras: [string, number | string][] = []
  if (Number(req.joining_bonus) > 0) extras.push([`Joining bonus${req.joining_bonus_freq ? ` (${req.joining_bonus_freq})` : ''}`, Number(req.joining_bonus)])
  if (Number(req.retention_bonus) > 0) extras.push(['Retention bonus', Number(req.retention_bonus)])
  if (Number(req.esop_value) > 0) extras.push([`ESOP${req.esop_vesting ? ` (${req.esop_vesting})` : ''}`, Number(req.esop_value)])
  const salary = link ? { rows: link.rows.filter(r => r.kind !== 'note'), extras } : null

  // What the verification vouches for. Documents: the stored file, not its (expiring) signed URL.
  const fingerprints: Record<string, string> = {}
  for (const r of rows) if (r.value != null) fingerprints[r.key] = fp(r.raw)
  if (salary) fingerprints.salary_breakup = fp(salary)
  for (const i of interviews) fingerprints[i.key] = fp([i.round, i.decision, i.score, i.remark])
  for (const d of docsRaw || []) fingerprints[`doc:${d.id}`] = fp([d.file_url, d.file_size, d.uploaded_at])
  const required = [
    ...rows.filter(r => r.value != null).map(r => r.key),
    ...(salary ? ['salary_breakup'] : []),
    ...interviews.map(i => i.key),
    ...documents.map(d => d.key),
  ]
  const fileHash = fp(required.map(k => [k, fingerprints[k]]))

  // Verification and the letter mark only count while the file is still what was verified.
  const ov = appDetails.offer_verification
  const stored = ov && ov.request_id === req.id ? ov : null
  const verified = required.length > 0 && stored?.verified && stored.verified.h === fileHash ? { by: stored.verified.by, at: stored.verified.at } : null
  const complete = !!verified
  const letter = complete && stored?.letter && stored.letter.h === fileHash ? { by: stored.letter.by, at: stored.letter.at } : null
  return { request: req, candidate: cand, company, mrf, negotiation: neg, ctx, rows, documents, interviews, salary, verification: { verified, letter }, required, complete, fingerprints, fileHash }
}

function safeJson(s: string) { try { return JSON.parse(s) || {} } catch { return {} } }

/**
 * Re-read application_details, let `change` edit the fresh copy (the verification blob, and for an
 * application-details edit the fields themselves), and write it back. Nothing else in the JSON is
 * taken from the dossier snapshot, so a concurrent save of another field is not undone.
 */
type Ov = { request_id: string; verified: any; letter: any }
async function updateDetails(d: Dossier, change: (ad: any, ov: Ov) => void) {
  const { data, error: rErr } = await sb.from('candidates').select('application_details').eq('id', d.candidate.id).maybeSingle()
  if (rErr) throw new Error(rErr.message)
  const fresh = typeof data?.application_details === 'string' ? safeJson(data.application_details) : { ...(data?.application_details || {}) }
  const cur = fresh.offer_verification
  const ov: Ov = cur && cur.request_id === d.request.id ? { request_id: d.request.id, verified: cur.verified || null, letter: cur.letter || null } : { request_id: d.request.id, verified: null, letter: null }
  change(fresh, ov)
  fresh.offer_verification = ov
  const { error } = await sb.from('candidates').update({ application_details: fresh }).eq('id', d.candidate.id)
  if (error) throw new Error(error.message)
}

/** The one checkbox: the HR Manager confirms the whole file as it stands (or withdraws that). */
export async function setVerified(d: Dossier, on: boolean, by: string) {
  if (!d.required.length) throw new Error('There is nothing to verify')
  await updateDetails(d, (_ad, ov) => {
    ov.verified = on ? { by, at: new Date().toISOString(), h: d.fileHash } : null
    if (!on) ov.letter = null
  })
}

/** Record that the letter was generated from THIS file. The caller passes a dossier loaded after
 *  the PDF was built and checks it still matches the one the PDF was built from. */
export async function markLetterGenerated(d: Dossier, by: string) {
  if (!d.complete) throw new Error('The offer file is not verified')
  await updateDetails(d, (_ad, ov) => { ov.letter = { by, at: new Date().toISOString(), h: d.fileHash } })
}

/** Apply several edits at once (one form part). All are validated before anything is written.
 *  Clears the verification and the generated-letter mark. Returns what changed. */
export async function applyEdits(d: Dossier, changes: Record<string, any>): Promise<{ field: string; from: any; to: any }[]> {
  const done: { field: string; from: any; to: any }[] = []
  const candPatch: any = {}, reqPatch: any = {}, adSets: [string, string, any][] = []
  for (const [key, value] of Object.entries(changes || {})) {
    const f = FIELDS.find(x => x.key === key)
    if (!f?.edit) throw new Error(`${f?.label || key} cannot be edited here`)
    let v: any = typeof value === 'string' ? value.trim() : value
    if (v === '') v = null
    if (f.type === 'number' && v != null) { v = Number(v); if (!isFinite(v)) throw new Error(`${f.label}: enter a number`) }
    if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`${f.label}: enter a valid email`)
    if (f.type === 'date' && v && isNaN(+new Date(v))) throw new Error(`${f.label}: enter a valid date`)
    if (key === 'full_name' && !v) throw new Error('Name cannot be empty')
    const from = f.get(d.ctx)
    if (String(from ?? '') === String(v ?? '')) continue   // unchanged
    const e = f.edit
    if (e.table === 'request') reqPatch[e.column] = v
    else if ('column' in e) { candPatch[e.column] = v; if (e.column === 'phone') candPatch.mobile = v }
    else adSets.push([e.adPath[0], e.adPath[1], v])
    done.push({ field: key, from: from ?? null, to: v })
  }
  if (!done.length) return done
  if (Object.keys(reqPatch).length) { const { error } = await sb.from('offer_approval_requests').update(reqPatch).eq('id', d.request.id); if (error) throw new Error(error.message) }
  if (Object.keys(candPatch).length) { const { error } = await sb.from('candidates').update(candPatch).eq('id', d.candidate.id); if (error) throw new Error(error.message) }
  await updateDetails(d, (ad, ov) => {
    for (const [a, b, v] of adSets) ad[a] = { ...(ad[a] || {}), [b]: v }
    ov.verified = null; ov.letter = null
  })
  return done
}
