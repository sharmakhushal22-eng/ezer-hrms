// lib/onboarding/checklists.ts — pure. What each head confirms when approving an onboarding
// from ESS → Tasks & Approvals, after the HR Manager has accepted the form:
//   IT       the official email, the laptop, the system access
//   ADMIN    the ID card, the access card, the seating
//   PAYROLL  the salary structure (CTC, basic %, PF / PT / LWF, tax regime)
// The heads only CONFIRM: the yes / no items are theirs to tick, and only those can be required.
// The text / number / select items are facts shown on their form read-only (the email, the
// seating, the CTC …), kept by HR — the heads' form never edits a detail.
// The answers are kept on the team's onboarding_approvals row (checklist, migration 166) and
// the ones that are also onboarding_candidates columns are written there too, so the employee
// record created at code generation carries them (lib/onboarding/to-employee.ts).

import { trackOf, type HiringTrack } from './hiring-track'

export type HeadTeam = 'IT' | 'ADMIN' | 'PAYROLL'
export interface ChecklistField {
  key: string
  label: string
  kind: 'bool' | 'text' | 'number' | 'select'
  /** Must be ticked / filled before the team can approve. */
  required?: boolean
  options?: { value: string; label: string }[]
  hint?: string
  /** True when the key is also an onboarding_candidates column. */
  column?: boolean
  /** Only on these hiring tracks (lib/onboarding/hiring-track.ts); every track when absent. */
  tracks?: HiringTrack[]
}
const FOREIGN: HiringTrack[] = ['FOREIGN_IN_INDIA'], OVERSEAS: HiringTrack[] = ['OVERSEAS'], INDIA: HiringTrack[] = ['DOMESTIC', 'FOREIGN_IN_INDIA']

export const CHECKLISTS: Record<HeadTeam, { title: string; intro: string; fields: ChecklistField[] }> = {
  IT: {
    title: 'IT readiness',
    intro: 'Confirm what IT has set up for the joiner. Everything ticked here is what they walk in to on day one.',
    fields: [
      { key: 'it_email', label: 'Official email ID', kind: 'text', column: true, hint: 'e.g. first.last@company.com' },
      { key: 'it_email_created', label: 'Email ID is created', kind: 'bool', required: true, column: true },
      { key: 'it_laptop_issued', label: 'Laptop is ready', kind: 'bool', required: true, column: true },
      { key: 'it_laptop_tag', label: 'Laptop asset tag', kind: 'text', column: true },
      { key: 'it_access_done', label: 'System access set up (HRMS, tools, VPN)', kind: 'bool', required: true, column: true },
    ],
  },
  ADMIN: {
    title: 'Admin readiness',
    intro: 'Confirm what Admin has arranged for the joiner.',
    fields: [
      { key: 'admin_id_card', label: 'ID card is ready', kind: 'bool', required: true, column: true },
      { key: 'admin_access_card', label: 'Access card number', kind: 'text', column: true },
      { key: 'admin_seating', label: 'Seating / desk allotted', kind: 'text', column: true, hint: 'e.g. 3rd floor, bay B, desk 14' },
      { key: 'admin_welcome_kit', label: 'Welcome kit / stationery ready', kind: 'bool' },
      // Foreign national in India — immigration (Admin / HR ops)
      { key: 'visa_checked', label: 'Employment visa checked: valid, employer-specific, dates noted', kind: 'bool', required: true, column: true, tracks: FOREIGN },
      { key: 'frro_done', label: 'FRRO registration done (or booked within 14 days of arrival)', kind: 'bool', required: true, column: true, tracks: FOREIGN },
      { key: 'contract_signed', label: 'Employment contract for the work country signed (foreign entity / EOR)', kind: 'bool', required: true, column: true, tracks: OVERSEAS },
    ],
  },
  PAYROLL: {
    title: 'Payroll setup',
    intro: 'Confirm the salary structure the joiner will be paid on. The CTC and the breakdown come from the negotiation / offer; correct the CTC here if it changed and the structure follows.',
    fields: [
      { key: 'annual_ctc', label: 'Annual CTC (₹)', kind: 'number', column: true },
      { key: 'basic_pct', label: 'Basic as % of CTC', kind: 'number', column: true, hint: 'from the breakdown' },
      { key: 'pf_applicable', label: 'PF applicable', kind: 'bool', column: true, tracks: INDIA },
      { key: 'pf_wage_type', label: 'PF wage base', kind: 'select', column: true, options: [{ value: 'BASIC_DA', label: 'Basic + DA' }, { value: 'GROSS', label: 'Gross' }], tracks: INDIA },
      { key: 'tds_regime', label: 'Tax regime', kind: 'select', column: true, options: [{ value: 'NEW', label: 'New regime' }, { value: 'OLD', label: 'Old regime' }], tracks: INDIA },
      { key: 'pt_state', label: 'Professional tax state', kind: 'text', column: true, tracks: INDIA },
      { key: 'lwf_applicable', label: 'LWF applicable', kind: 'bool', column: true, tracks: INDIA },
      // Foreign national in India — PF as an International Worker (no wage ceiling) unless an SSA certificate exempts them; TDS at 20% until the PAN arrives
      { key: 'pf_international_worker', label: 'PF set up as International Worker (no wage ceiling)', kind: 'bool', required: true, column: true, tracks: FOREIGN },
      { key: 'ssa_exempt', label: 'SSA coverage certificate on file: exempt from Indian PF', kind: 'bool', column: true, tracks: FOREIGN },
      { key: 'pan_pending', label: 'PAN applied for: TDS at 20% until it arrives', kind: 'bool', column: true, tracks: FOREIGN },
      // Overseas — paid outside the Indian payroll
      { key: 'paid_outside_india', label: 'Paid outside India (foreign entity / EOR payroll), not in the Indian run', kind: 'bool', required: true, column: true, tracks: OVERSEAS },
      { key: 'payroll_setup_done', label: 'Salary structure entered in payroll', kind: 'bool', required: true },
    ],
  },
}
export const HEAD_TEAMS: HeadTeam[] = ['IT', 'ADMIN', 'PAYROLL']

/** The checklist fields that apply on a hiring track. */
export function fieldsFor(team: HeadTeam, track?: HiringTrack | string | null): ChecklistField[] {
  const t = trackOf(track)
  return CHECKLISTS[team].fields.filter(f => !f.tracks || f.tracks.includes(t))
}

/** Only the yes / no items — what a head may actually change on the approval form. */
export function confirmationsOnly(team: HeadTeam, values: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {}
  for (const f of CHECKLISTS[team].fields) if (f.kind === 'bool' && values && values[f.key] !== undefined) out[f.key] = values[f.key]
  return out
}
export const isHeadTeam = (t: any): t is HeadTeam => t === 'IT' || t === 'ADMIN' || t === 'PAYROLL'

const filled = (f: ChecklistField, v: any) =>
  f.kind === 'bool' ? v === true : f.kind === 'number' ? v !== '' && v != null && !Number.isNaN(Number(v)) && Number(v) > 0 : String(v ?? '').trim() !== ''

/** The labels of the required items that are not done yet. Empty means the team may approve.
 *  Pass the hiring track so a domestic joiner is not asked about FRRO. */
export function missingItems(team: HeadTeam, values: Record<string, any> | null | undefined, track?: HiringTrack | string | null): string[] {
  return fieldsFor(team, track).filter(f => f.required && !filled(f, values?.[f.key])).map(f => f.label)
}

/** Only the known keys, typed: booleans as booleans, numbers as numbers, text trimmed. */
export function normaliseChecklist(team: HeadTeam, values: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {}
  for (const f of CHECKLISTS[team].fields) {
    const v = values?.[f.key]
    if (v === undefined) continue
    if (f.kind === 'bool') out[f.key] = v === true || v === 'true'
    else if (f.kind === 'number') out[f.key] = v === '' || v == null ? null : Number(v)
    else out[f.key] = v == null ? null : String(v).trim()
  }
  return out
}

/** The part of a checklist that lives on onboarding_candidates. */
export function checklistColumns(team: HeadTeam, values: Record<string, any> | null | undefined): Record<string, any> {
  const n = normaliseChecklist(team, values)
  const out: Record<string, any> = {}
  for (const f of CHECKLISTS[team].fields) if (f.column && f.key in n) out[f.key] = n[f.key]
  return out
}

/** A one-line summary for the card / the audit row. */
export function summariseChecklist(team: HeadTeam, values: Record<string, any> | null | undefined): string {
  const n = normaliseChecklist(team, values)
  return CHECKLISTS[team].fields
    .filter(f => n[f.key] != null && n[f.key] !== '' && n[f.key] !== false)
    .map(f => f.kind === 'bool' ? f.label : `${f.label}: ${f.kind === 'select' ? (f.options?.find(o => o.value === n[f.key])?.label || n[f.key]) : n[f.key]}`)
    .join(' · ')
}
