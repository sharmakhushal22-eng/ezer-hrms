// lib/idcard/card-data.ts — one employee row, turned into a printable card.
//
// Pure. The interesting part is the emergency contact, which is a single free
// text column (employees.emergency_contact_1) that has to become three fields.
// Getting that wrong prints the wrong number on an identity card that exists
// largely so somebody can be reached in an emergency — so it is a named
// function with tests rather than a .split() buried in a route.

import type { IdCardData } from '@/lib/profile/id-card-pdf'

/** The employee columns a card needs. Named for the RAW table, not the 360
 *  view: the view drops location_id, and scope is decided on ids, never on
 *  display names. */
export interface EmployeeCardRow {
  id: string
  emp_code?: string | null
  full_name?: string | null
  designation?: string | null
  company_id?: string | null
  location_id?: string | null
  employment_status?: string | null
  blood_group?: string | null
  emergency_contact_1?: string | null
  photo_path?: string | null
  company_doj?: string | null
  /** Joined in by the query rather than stored on the row. */
  company_name?: string | null
  department_name?: string | null
  location_name?: string | null
}

export interface Emergency {
  name: string | null
  relation: string | null
  phone: string | null
}

const EMPTY: Emergency = { name: null, relation: null, phone: null }

/** Enough digits to dial. Indian mobiles are 10; +91 and spaces are common, so
 *  count digits rather than characters and accept 7 as the floor for a landline
 *  or an extension-style entry. */
function looksLikePhone(s: string): boolean {
  return (s.match(/\d/g) || []).length >= 7
}

/**
 * `Name · Relation · Phone` → three fields.
 *
 * The middle dot is the house convention — IdCard.tsx already reads the phone
 * as `split('·').pop()` — but nothing in the database enforces it, and HR types
 * what HR types. So commas and pipes are accepted as separators too, and the
 * shape is inferred rather than assumed:
 *
 *   three or more parts   first is the name, LAST is the phone, the rest is
 *                         the relation (rejoined, so "Father, retired" survives)
 *   two parts             name and phone, or name and relation if neither
 *                         part looks dialable
 *   one part              a phone if it has digits in it, otherwise a name
 *
 * The phone is taken from the END in every branch, matching what the digital
 * card already displays. A card that shows a relation where the number should
 * be is worse than one that shows nothing.
 */
export function parseEmergency(raw?: string | null): Emergency {
  const s = String(raw ?? '').trim()
  if (!s) return { ...EMPTY }

  const parts = s.split(/[·|,]/).map(p => p.trim()).filter(Boolean)
  if (!parts.length) return { ...EMPTY }

  if (parts.length === 1) {
    return looksLikePhone(parts[0])
      ? { name: null, relation: null, phone: parts[0] }
      : { name: parts[0], relation: null, phone: null }
  }

  const last = parts[parts.length - 1]
  if (parts.length === 2) {
    return looksLikePhone(last)
      ? { name: parts[0], relation: null, phone: last }
      : { name: parts[0], relation: last, phone: null }
  }

  // Three or more. The phone is the last part when it is dialable; when it is
  // not, there is no phone and everything after the name is the relation.
  return looksLikePhone(last)
    ? { name: parts[0], relation: parts.slice(1, -1).join(', ') || null, phone: last }
    : { name: parts[0], relation: parts.slice(1).join(', ') || null, phone: null }
}

/** What is missing before this card is worth printing. */
export type CardGap = 'EMERGENCY' | 'BLOOD' | 'PHOTO'

/**
 * The readiness pills.
 *
 * EMERGENCY is the one that matters: a card with no reachable number still
 * prints, it just cannot do the job it is carried for. BLOOD and PHOTO are
 * cosmetic by comparison, which is why they are separate rather than one
 * "incomplete" flag — HR chasing 391 missing emergency contacts should not have
 * to sift them out of a pile of missing photographs.
 */
export function cardGaps(row: EmployeeCardRow): CardGap[] {
  const gaps: CardGap[] = []
  const e = parseEmergency(row.emergency_contact_1)
  if (!e.phone && !e.name) gaps.push('EMERGENCY')
  if (!String(row.blood_group ?? '').trim()) gaps.push('BLOOD')
  if (!String(row.photo_path ?? '').trim()) gaps.push('PHOTO')
  return gaps
}

/** Extras the row itself cannot carry: the credential, and a photo already
 *  fetched as a data URL (a signed storage URL taints the export canvas). */
export interface CardExtras {
  cardNo?: string | null
  validTill?: string | null
  photoDataUrl?: string | null
}

/**
 * Row → IdCardData.
 *
 * Every string the card draws is defaulted here rather than in the renderer, so
 * a missing join shows as an em dash on the card instead of "undefined" — which
 * is the kind of thing that reaches a printer before anybody notices.
 */
export function toIdCardData(row: EmployeeCardRow, extras: CardExtras = {}): IdCardData {
  const e = parseEmergency(row.emergency_contact_1)
  return {
    name: String(row.full_name ?? '').trim() || '—',
    code: String(row.emp_code ?? '').trim() || '—',
    company: String(row.company_name ?? '').trim() || '—',
    designation: row.designation ?? null,
    department: row.department_name ?? null,
    location: row.location_name ?? null,
    doj: row.company_doj ?? null,
    blood: row.blood_group ?? null,
    cardNo: extras.cardNo ?? null,
    validTill: extras.validTill ?? null,
    emergencyName: e.name,
    emergencyRelation: e.relation,
    emergencyPhone: e.phone,
    photoDataUrl: extras.photoDataUrl ?? null,
  }
}
