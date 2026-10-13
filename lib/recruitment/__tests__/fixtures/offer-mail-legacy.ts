// lib/recruitment/__tests__/fixtures/offer-mail-legacy.ts — TEST REFERENCE ONLY.
//
// The offer email exactly as the Send Offers screen (app/dashboard/recruitment/
// offer-flow-components.tsx, upstream commit 1d02d9a) built it in code before it became six
// Configuration templates. lib/config/__tests__/offer-mail.test.ts asserts the built-in
// templates render to THIS for every engagement. Never imported by application code.

import { letterKindOf, specOf, isFeesKind } from '../../engagement.ts'

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const kindOf = (r: any) => letterKindOf(r?.candidates?.application_details?.requisition?.employment_type || r?.manpower_requisitions?.employment_type)
const monthsOfRow = (r: any) => { const v = Number(r?.candidates?.application_details?.requisition?.duration_months ?? r?.manpower_requisitions?.duration_months); return v > 0 ? Math.round(v) : null }
void isFeesKind

export function mailText(r: any, f: { name?: string | null; designation?: string | null; doj?: string | null } = {}) {
  const company = r.companies?.company_name || 'our organization'
  const role = f.designation || r.candidates?.designation || r.manpower_requisitions?.designation || 'the role'
  const name = f.name || r.candidates?.full_name || 'Candidate'
  const doj = f.doj !== undefined ? f.doj : r.proposed_doj
  const kind = kindOf(r), spec = specOf(kind), months = monthsOfRow(r)
  const n = r.ctc_negotiations
  const monthly = n?.is_stipend && Number(n.stipend_monthly) > 0 ? Number(n.stipend_monthly) : (kind !== 'EMPLOYMENT' && r.offered_ctc ? Math.round(Number(r.offered_ctc) / 12) : 0)
  const when = doj ? new Date(doj).toLocaleDateString('en-IN') : '—'
  const periodLine = months ? `\n• Period: ${months} month${months === 1 ? '' : 's'}` : ''
  const open: Record<string, string> = {
    EMPLOYMENT: `Congratulations! We are delighted to offer you the position of ${role} at ${company}.`,
    INTERNSHIP: `Congratulations! We are delighted to offer you an internship as ${role} at ${company}.`,
    NATS: `Congratulations! We are pleased to offer you a place as an apprentice in ${role} at ${company} under the National Apprenticeship Training Scheme (NATS), governed by the Apprentices Act, 1961.`,
    NAPS: `Congratulations! We are pleased to offer you an apprenticeship as ${role} at ${company} under the National Apprenticeship Promotion Scheme (NAPS), governed by the Apprentices Act, 1961.`,
    CONTRACT: `We are pleased to engage you as an independent contractor to provide services as ${role} to ${company} for a fixed term.`,
    CONSULTANT: `We are pleased to engage you as a consultant to provide services as ${role} to ${company}.`,
  }
  const pay = kind === 'EMPLOYMENT' ? `• Annual CTC: ₹${r.offered_ctc ? fmt(r.offered_ctc) : '—'}`
    : `• Monthly ${spec.payNoun}: ₹${monthly ? fmt(monthly) : '—'}${n?.tds_applicable && Number(n?.tds_pct) > 0 ? ` (TDS ${Number(n.tds_pct)}%)` : ''}`
  const startLabel = kind === 'EMPLOYMENT' ? 'Proposed Date of Joining' : kind === 'INTERNSHIP' ? 'Internship starts on' : kind === 'NATS' || kind === 'NAPS' ? 'Training commences on' : 'Engagement commences on'
  const annexA = spec.annexA.toLowerCase()
  const extra = kind === 'NATS' || kind === 'NAPS'
    ? `\n\nThe Government of India's share of the stipend under the scheme is paid directly to your Aadhaar-seeded bank account by DBT; please complete your registration and e-KYC on the ${kind === 'NATS' ? 'NATS portal (nats.education.gov.in)' : 'apprenticeship portal (apprenticeshipindia.gov.in)'} before you join. This is apprenticeship training under the Apprentices Act, 1961 and not an offer of employment.`
    : kind === 'INTERNSHIP' ? `\n\nThis is an internship for learning and training; it is not an offer of employment.`
    : kind === 'CONTRACT' || kind === 'CONSULTANT' ? `\n\nThis is a contract for services, not employment. Fees are paid against your monthly invoice, with TDS under section 194J.` : ''
  const docName = spec.kind === 'EMPLOYMENT' ? 'offer letter' : spec.title.toLowerCase()
  const close = kind === 'EMPLOYMENT' ? 'We look forward to welcoming you to the team.' : kind === 'CONTRACT' || kind === 'CONSULTANT' ? 'We look forward to working with you.' : 'We look forward to having you with us.'
  return {
    subject: `${spec.mailSubject} — ${role} | ${company}`,
    body: `Dear ${name},

${open[kind]}

Your ${docName} is attached to this email as a PDF. Please read it, including the ${annexA} in Annexure A and the terms in Annexure B.

Key details:
${pay}
• ${startLabel}: ${when}${periodLine}

This offer is valid for 7 days and is subject to verification and document submission. To accept, please sign the acceptance in Annexure B and send us a copy, or simply reply to this email confirming your acceptance.${extra}

${close}

Warm regards,
${company} — Human Resources`,
  }
}
