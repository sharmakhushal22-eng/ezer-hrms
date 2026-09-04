// lib/profile/types.ts — the shapes get_employee_profile() actually returns.
//
// Written against the LIVE payload, not the vendor's documentation. The view
// behind it (v_employee_profile_360) has 89 columns; the RPC then strips
// whatever the viewer may not read, so almost every field here is optional by
// construction — a missing key means "you are not allowed to see this", which
// is different from null meaning "nobody has filled it in". The UI has to
// keep those two apart, so nothing here collapses them.

/** Who the viewer is TO THIS EMPLOYEE — positional, not a job title.
 *  Decided by get_employee_profile, never by the client. */
export type ViewerRole = 'self' | 'manager' | 'hr' | 'peer'

/** How a field may be changed. Straight from the design file. */
export type FieldState =
  /** Source of truth is elsewhere (HR, payroll, onboarding). Read only. */
  | 'locked'
  /** The employee may change it themselves, and it saves immediately. */
  | 'direct'
  /** Goes to HR or payroll as a change request, with a reason. */
  | 'request'
  /** Opens a whole workflow rather than editing one value — marital status
   *  pulls family, nominee and insurance behind it. */
  | 'event'

export interface ProfileField {
  /** What the employee reads. */
  label: string
  /** Key into the employee payload. */
  key: string
  state: FieldState
  /** Where the value really lives — shown small under the value, because a
   *  person asking "why can't I edit this" is really asking "who owns it". */
  source: string
  /** Monospace: codes, numbers, identifiers. */
  mono?: boolean
  /** Masked behind a reveal control. */
  mask?: boolean
  /** Minimum role that may see it at all. Absent means anyone who can open
   *  the profile. */
  min?: Exclude<ViewerRole, 'peer'>
  /** A line under the value explaining a consequence. */
  hint?: string
  /** Full width — addresses and anything long. */
  wide?: boolean
}

export interface FieldGroup { title: string; fields: ProfileField[] }

export type TabId =
  | 'overview' | 'personal' | 'job' | 'statutory'
  | 'payroll' | 'time' | 'growth' | 'records'

export interface Employee {
  id: string
  full_name: string
  employee_code: string | null
  photo_path: string | null
  [key: string]: unknown
}

export interface Completeness { score: number; pending: string[] }

/** The related lists. Every one of these is an array in the payload, and the
 *  RPC returns [] rather than null when there is nothing — so the UI never has
 *  to guard for undefined on the happy path. */
export interface ProfilePayload {
  employee: Employee
  viewer_role: ViewerRole
  completeness: Completeness
  family: Row[]
  nominations: Row[]
  insurance: Row[]
  documents: Row[]
  assets: Row[]
  education: Row[]
  experience: Row[]
  certifications: Row[]
  trainings: Row[]
  app_access: Row[]
  error?: string
}

export type Row = Record<string, unknown>

/** Rank for the `min` comparison. 'peer' is the floor: somebody who can open
 *  the page but is neither the person, their manager, nor HR. */
export const ROLE_RANK: Record<ViewerRole, number> = {
  peer: 0, self: 1, manager: 2, hr: 3,
}

export function maySee(viewer: ViewerRole, min?: ProfileField['min']): boolean {
  if (!min) return true
  // 'self' is a special case rather than a rank: you can always see your own
  // Aadhaar, but your manager — who outranks you — cannot.
  if (min === 'self') return viewer === 'self' || viewer === 'hr'
  return ROLE_RANK[viewer] >= ROLE_RANK[min]
}
