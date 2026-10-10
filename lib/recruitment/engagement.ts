// lib/recruitment/engagement.ts — client-safe.
//
// WHICH LETTER a candidate gets, and the facts that letter must get right.
//
// The MRF's employment type decides the engagement: a regular employee is offered
// employment; an intern an internship; a NATS or NAPS candidate an apprenticeship under the
// Apprentices Act, 1961; a contractor or consultant a contract for services. These are not
// one letter with the noun swapped — the legal relationship, what is paid, what is deducted,
// what statutory cover applies and what the person signs all differ:
//
//   EMPLOYMENT   employer–employee · annual CTC · PF/ESIC/gratuity/bonus as per law ·
//                probation + notice · open-ended
//   INTERNSHIP   trainee, NOT an employee · monthly stipend · no PF/ESIC/gratuity · fixed
//                period · mentor · certificate on completion · no promise of a job
//   NATS         graduate/diploma apprentice under the Apprentices Act, 1961 (Board of
//                Apprenticeship Training, Ministry of Education) · Contract of Apprenticeship
//                registered on nats.education.gov.in · stipend not below the prescribed minimum
//                · Government of India pays 50% of the prescribed minimum (cap Rs 4,500/month)
//                straight to the apprentice by DBT · Sec 18: not a worker, so no PF/ESIC ·
//                Sec 22: no obligation to employ afterwards · usually 12 months
//   NAPS         trade / optional-trade apprentice under the Apprentices Act, 1961 (MSDE) ·
//                contract registered on apprenticeshipindia.gov.in within 30 days · minimum
//                stipend per Rule 11 of the Apprenticeship Rules, 1992 · Government pays 25% of
//                the prescribed stipend (cap Rs 1,500/month) by DBT · Sec 18 · Sec 22 ·
//                basic + on-the-job training · 6 months to 3 years
//   CONTRACT     contract for services for a fixed period · monthly fees against invoice ·
//                TDS under s.194J · GST where registered · no employee benefits · 30 days'
//                notice · IP and confidentiality · not an employee
//   CONSULTANT   the same contract for services, open-ended
//
// Minimum apprentice stipends: Apprenticeship (Amendment) Rules, 2025 — G.S.R. 610(E) dated
// 3 Sep 2025, in force from 11 Sep 2025 (a 36% revision decided at the 38th Central
// Apprenticeship Council, May 2025). Annual increase of 10% in the 2nd and 15% in the 3rd year.
// These are a CHECK on the offer file, never a figure printed as the offer — the offered
// stipend is what the negotiation agreed.

import type { Compensation } from './compensation'
import { compOf } from './compensation'

export type LetterKind = 'EMPLOYMENT' | 'INTERNSHIP' | 'NATS' | 'NAPS' | 'CONTRACT' | 'CONSULTANT'

export function letterKindOf(employmentType?: string | null): LetterKind {
  const t = String(employmentType || 'Employee').trim().toLowerCase()
  if (t === 'nats') return 'NATS'
  if (t === 'naps') return 'NAPS'
  if (t === 'intern' || t === 'live project' || t === 'internship' || t === 'trainee') return 'INTERNSHIP'
  if (t === 'contract' || t === 'contractual' || t === 'fixed term' || t === 'fixed-term') return 'CONTRACT'
  if (t === 'consultant' || t === 'freelancer' || t === 'retainer') return 'CONSULTANT'
  return 'EMPLOYMENT'
}

export const isApprenticeship = (k: LetterKind) => k === 'NATS' || k === 'NAPS'
export const isStipendKind = (k: LetterKind) => k === 'INTERNSHIP' || isApprenticeship(k)
export const isFeesKind = (k: LetterKind) => k === 'CONTRACT' || k === 'CONSULTANT'
/** Has a defined period the letter must state (and the file must carry). */
export const isFixedTerm = (k: LetterKind) => k !== 'EMPLOYMENT' && k !== 'CONSULTANT'

export type LetterSpec = {
  kind: LetterKind
  /** document title, e.g. on the letter and the PDF */
  title: string
  /** short label on screen ("Internship", "NATS apprenticeship") */
  label: string
  /** the person, in prose */
  person: string
  /** the money, in prose: "CTC", "stipend", "fees" */
  payNoun: string
  /** label for the compensation part on screen and in Annexure A */
  annexA: string
  /** segment in the letter's reference number */
  refSeg: string
  /** file-name stem */
  fileStem: string
  /** the e-mail's subject stem */
  mailSubject: string
  /** the second column of the break-up table: "Annual" or "For the period" */
  periodWord: 'Annual' | 'Total'
}

export const LETTER_SPECS: Record<LetterKind, LetterSpec> = {
  EMPLOYMENT: { kind: 'EMPLOYMENT', title: 'Offer of Employment', label: 'Employment', person: 'employee', payNoun: 'CTC', annexA: 'Compensation details', refSeg: 'OFFER', fileStem: 'Offer-Letter', mailSubject: 'Offer of Employment', periodWord: 'Annual' },
  INTERNSHIP: { kind: 'INTERNSHIP', title: 'Internship Offer Letter', label: 'Internship', person: 'intern', payNoun: 'stipend', annexA: 'Stipend details', refSeg: 'INT', fileStem: 'Internship-Offer', mailSubject: 'Internship Offer', periodWord: 'Total' },
  NATS: { kind: 'NATS', title: 'Offer of Apprenticeship Training (NATS)', label: 'NATS apprenticeship', person: 'apprentice', payNoun: 'stipend', annexA: 'Stipend details', refSeg: 'NATS', fileStem: 'NATS-Apprenticeship-Offer', mailSubject: 'Offer of Apprenticeship Training under NATS', periodWord: 'Total' },
  NAPS: { kind: 'NAPS', title: 'Offer of Apprenticeship (NAPS)', label: 'NAPS apprenticeship', person: 'apprentice', payNoun: 'stipend', annexA: 'Stipend details', refSeg: 'NAPS', fileStem: 'NAPS-Apprenticeship-Offer', mailSubject: 'Offer of Apprenticeship under NAPS', periodWord: 'Total' },
  CONTRACT: { kind: 'CONTRACT', title: 'Fixed-Term Contract Engagement Letter', label: 'Contract', person: 'contractor', payNoun: 'fees', annexA: 'Fee details', refSeg: 'CON', fileStem: 'Contract-Engagement-Letter', mailSubject: 'Fixed-Term Contract Engagement', periodWord: 'Total' },
  CONSULTANT: { kind: 'CONSULTANT', title: 'Consulting Engagement Letter', label: 'Consultant', person: 'consultant', payNoun: 'fees', annexA: 'Fee details', refSeg: 'CONS', fileStem: 'Consulting-Engagement-Letter', mailSubject: 'Consulting Engagement', periodWord: 'Annual' },
}

export const specOf = (k: LetterKind) => LETTER_SPECS[k]

/** The scheme facts the apprenticeship letters cite. */
export const SCHEMES = {
  NATS: {
    name: 'National Apprenticeship Training Scheme (NATS)',
    short: 'NATS',
    authority: 'Board of Apprenticeship Training / Board of Practical Training, Ministry of Education, Government of India',
    portal: 'nats.education.gov.in',
    act: 'Apprentices Act, 1961',
    rules: 'Apprenticeship Rules, 1992',
    govShare: 'the Government of India bears 50% of the prescribed minimum stipend, up to Rs. 4,500 per month',
    govSharePct: 0.5, govShareCap: 4500,
    defaultMonths: 12,
    certificate: 'Certificate of Proficiency issued by the Board of Apprenticeship Training on successful completion',
  },
  NAPS: {
    name: 'National Apprenticeship Promotion Scheme (NAPS)',
    short: 'NAPS',
    authority: 'Ministry of Skill Development and Entrepreneurship / Directorate General of Training, Government of India',
    portal: 'apprenticeshipindia.gov.in',
    act: 'Apprentices Act, 1961',
    rules: 'Apprenticeship Rules, 1992',
    govShare: 'the Government of India bears 25% of the prescribed stipend, up to Rs. 1,500 per month',
    govSharePct: 0.25, govShareCap: 1500,
    defaultMonths: 12,
    certificate: 'National Apprenticeship Certificate on passing the prescribed assessment / All India Trade Test',
  },
} as const

/**
 * Minimum monthly stipend for an apprentice, Rule 11 of the Apprenticeship Rules, 1992 as
 * amended by G.S.R. 610(E) (3 Sep 2025, effective 11 Sep 2025). Rs per month, first year.
 */
export const APPRENTICE_MIN_STIPEND = {
  effectiveFrom: '2025-09-11',
  notification: 'G.S.R. 610(E) dated 3 September 2025',
  bands: [
    { key: 'school_5_9', label: 'School pass-out (class 5th to 9th)', amount: 6800 },
    { key: 'school_10', label: 'School pass-out (class 10th)', amount: 8200 },
    { key: 'school_12', label: 'School pass-out (class 12th)', amount: 9600 },
    { key: 'iti', label: 'National / State Certificate holder (ITI)', amount: 9600 },
    { key: 'vocational', label: 'Technician (vocational) apprentice / Vocational Certificate holder', amount: 9600 },
    { key: 'diploma', label: 'Technician apprentice / diploma holder', amount: 10900 },
    { key: 'graduate', label: 'Graduate / degree apprentice', amount: 12300 },
  ],
  yearlyIncrease: '10% in the 2nd year and 15% in the 3rd year of training',
} as const

export type StipendBand = (typeof APPRENTICE_MIN_STIPEND.bands)[number]

/**
 * Best guess of the band from a qualification string ("B.Tech", "Diploma in Mech", "ITI
 * Fitter", "12th"). A NATS apprentice is a graduate or a diploma holder by definition, so an
 * unreadable qualification falls to graduate there, and to the lowest band for NAPS.
 */
export function stipendBandFor(kind: LetterKind, qualification?: string | null): StipendBand {
  const q = String(qualification || '').toLowerCase()
  const b = (k: StipendBand['key']) => APPRENTICE_MIN_STIPEND.bands.find(x => x.key === k)!
  if (/\b(b\.?tech|b\.?e\b|bsc|b\.?sc|bca|bba|bcom|b\.?com|\bba\b|graduat|degree|bachelor|m\.?tech|mba|mca|msc|m\.?sc|mcom|\bma\b|master|pg\b|post ?grad|ph\.?d)/.test(q)) return b('graduate')
  if (/diploma|polytechnic|d\.?pharm/.test(q)) return b('diploma')
  if (/\biti\b|ncvt|scvt|national trade|state certificate|nac\b|ntc\b/.test(q)) return b('iti')
  if (/vocational|\bvtc\b/.test(q)) return b('vocational')
  if (/12th|xii|intermediate|higher secondary|hsc|\+2|12 ?th|senior secondary/.test(q)) return b('school_12')
  if (/10th|\bx\b|matric|secondary|ssc|10 ?th|high school/.test(q)) return b('school_10')
  if (/(5|6|7|8|9)th|middle|primary/.test(q)) return b('school_5_9')
  return kind === 'NATS' ? b('graduate') : b('school_5_9')
}

/** The Government's share of a stipend under the scheme, as the letter describes it. */
export function governmentShare(kind: LetterKind, prescribedMinimum: number): number {
  if (!isApprenticeship(kind)) return 0
  const s = SCHEMES[kind as 'NATS' | 'NAPS']
  return Math.min(Math.round(prescribedMinimum * s.govSharePct), s.govShareCap)
}

/** The negotiation's payment basis, for a kind that has none recorded. */
export const compensationFor = (employmentType?: string | null): Compensation => compOf(employmentType || undefined)

/** End date of a fixed-term engagement: `months` from the start, less a day. */
export function engagementEnd(start?: string | null, months?: number | null): string | null {
  if (!start || !months || months <= 0) return null
  const d = new Date(start)
  if (isNaN(+d)) return null
  d.setMonth(d.getMonth() + Math.round(months))
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
