// lib/config/offer-mail.ts — the values the six offer emails can use. Client-safe, pure.
//
// The Send Offers screen renders the offer email in the browser: it fetches the
// engagement's template once (resolved for the offer's company and branch), then
// re-renders it with these values every time HR edits the offer file, so the mail never
// disagrees with the letter. The values are computed exactly as the screen built its
// hard-coded text before (same fallbacks, same ₹ grouping, same en-IN dates).

import { letterKindOf, specOf, isFeesKind, type LetterKind } from '../recruitment/engagement.ts'

export const OFFER_EMAIL_KEY: Record<LetterKind, string> = {
  EMPLOYMENT: 'offer.email',
  INTERNSHIP: 'offer.email.internship',
  NATS: 'offer.email.nats',
  NAPS: 'offer.email.naps',
  CONTRACT: 'offer.email.contract',
  CONSULTANT: 'offer.email.consultant',
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')

/** The engagement a request is for: the offer file's own employment type if edited, else the MRF's. */
export const offerKindOf = (r: any): LetterKind =>
  letterKindOf(r?.candidates?.application_details?.requisition?.employment_type || r?.manpower_requisitions?.employment_type)

const monthsOfRow = (r: any) => {
  const v = Number(r?.candidates?.application_details?.requisition?.duration_months ?? r?.manpower_requisitions?.duration_months)
  return v > 0 ? Math.round(v) : null
}

/** Values for the offer email of this request. `f` carries edits made in the offer file. */
export function offerMailVars(r: any, f: { name?: string | null; designation?: string | null; doj?: string | null } = {}): Record<string, string> {
  const company = r?.companies?.company_name || 'our organization'
  const role = f.designation || r?.candidates?.designation || r?.manpower_requisitions?.designation || 'the role'
  const name = f.name || r?.candidates?.full_name || 'Candidate'
  const doj = f.doj !== undefined ? f.doj : r?.proposed_doj
  const kind = offerKindOf(r), spec = specOf(kind), months = monthsOfRow(r)
  const n = r?.ctc_negotiations
  const monthly = n?.is_stipend && Number(n.stipend_monthly) > 0 ? Number(n.stipend_monthly) : (kind !== 'EMPLOYMENT' && r?.offered_ctc ? Math.round(Number(r.offered_ctc) / 12) : 0)
  const pay = kind === 'EMPLOYMENT' ? `• Annual CTC: ₹${r?.offered_ctc ? fmt(r.offered_ctc) : '—'}`
    : `• Monthly ${spec.payNoun}: ₹${monthly ? fmt(monthly) : '—'}${n?.tds_applicable && Number(n?.tds_pct) > 0 ? ` (TDS ${Number(n.tds_pct)}%)` : ''}`
  const startLabel = kind === 'EMPLOYMENT' ? 'Proposed Date of Joining' : kind === 'INTERNSHIP' ? 'Internship starts on' : kind === 'NATS' || kind === 'NAPS' ? 'Training commences on' : 'Engagement commences on'
  return {
    candidate_name: name, role, company_name: company,
    mail_subject: spec.mailSubject,
    document_name: spec.kind === 'EMPLOYMENT' ? 'offer letter' : spec.title.toLowerCase(),
    annexure_a: spec.annexA.toLowerCase(),
    pay_line: pay,
    start_label: startLabel,
    start_date: doj ? new Date(doj).toLocaleDateString('en-IN') : '—',
    period_line: months ? `\n• Period: ${months} month${months === 1 ? '' : 's'}` : '',
  }
}

/** Fictional values for the Configuration preview. */
export function offerMailVarsSample(kind: LetterKind): Record<string, string> {
  const type = { EMPLOYMENT: 'Employee', INTERNSHIP: 'Intern', NATS: 'NATS', NAPS: 'NAPS', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }[kind]
  const stipend = kind !== 'EMPLOYMENT'
  return offerMailVars({
    offered_ctc: 1800000, proposed_doj: '2026-11-01',
    candidates: { full_name: 'Priya Sharma', designation: kind === 'EMPLOYMENT' ? 'Senior Sales Manager' : isFeesKind(kind) ? 'Data Analytics' : kind === 'INTERNSHIP' ? 'Marketing Intern' : 'Mechanical Engineering' },
    companies: { company_name: 'Sharma Retail Solutions Pvt Ltd' },
    manpower_requisitions: { employment_type: type, duration_months: kind === 'EMPLOYMENT' || kind === 'CONSULTANT' ? null : 12 },
    ctc_negotiations: stipend ? { is_stipend: true, stipend_monthly: isFeesKind(kind) ? 90000 : 20000, tds_applicable: isFeesKind(kind), tds_pct: isFeesKind(kind) ? 10 : 0 } : {},
  })
}
