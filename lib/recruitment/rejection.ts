// lib/recruitment/rejection.ts
//
// Why a candidate was rejected, and the rule that both halves of the app check.
//
// Pure — no React, no Supabase — so the one definition of "a valid rejection"
// is shared by the dialog that collects it and the route that writes it. The
// dialog is a courtesy; the route is the rule. (See mrf-assignment-rule.test.ts
// for the lesson that keeps repeating here: a rule enforced at one write is not
// enforced.)
//
// A FIXED LIST, DELIBERATELY
//
// exit_reason_master (migration 071) is the admin-editable pattern for
// resignation reasons, and it would also fit here. It is not used, by decision:
// hiring rejection reasons are reported on, and a list HR can edit mid-quarter
// makes those reports incomparable across periods. Adding a reason is a one-line
// change here plus nothing else — there is no seed table to keep in step, and no
// CHECK constraint on the column (candidates.stage is free text for the same
// reason), so the code below is the only authority.

export interface RejectionReason {
  /** Stored in candidates.rejection_reason. Stable — reports group on it. */
  code: string
  /** What the hiring manager picks from. */
  label: string
}

export const REJECTION_REASONS: readonly RejectionReason[] = [
  { code: 'SKILLS',          label: 'Skills / experience mismatch' },
  { code: 'ROUND',           label: 'Did not clear the interview round' },
  { code: 'COMPENSATION',    label: 'Compensation expectations too high' },
  { code: 'NOTICE',          label: 'Notice period too long' },
  { code: 'LOCATION',        label: 'Location / relocation' },
  { code: 'COMMUNICATION',   label: 'Communication skills' },
  { code: 'WITHDREW',        label: 'Candidate withdrew' },
  { code: 'UNRESPONSIVE',    label: 'Candidate unresponsive' },
  { code: 'POSITION_CLOSED', label: 'Position closed or on hold' },
  { code: 'OTHER',           label: 'Other' },
]

export const REJECTION_REASON_CODES: readonly string[] = REJECTION_REASONS.map(r => r.code)

export function isRejectionReason(code: unknown): code is string {
  return typeof code === 'string' && REJECTION_REASON_CODES.includes(code)
}

/** The label for a stored code, falling back to the code so an old row still reads. */
export function rejectionLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return REJECTION_REASONS.find(r => r.code === code)?.label ?? code
}

export interface RejectionInput {
  reason?: unknown
  remark?: unknown
}

export interface RejectionCheck {
  ok: boolean
  /** Why not — shown to the user verbatim. */
  reason?: string
}

/**
 * Both a reason and a remark are mandatory.
 *
 * The remark only has to be non-blank, matching the rule the interview feedback
 * path already enforces ("A remark is required for Hold / Reject"). A longer
 * minimum was considered and rejected: it teaches people to type "aaaa" rather
 * than to explain, and the audit row records who wrote it either way.
 */
export function validateRejection(input: RejectionInput): RejectionCheck {
  if (!isRejectionReason(input.reason)) {
    return { ok: false, reason: 'Choose a rejection reason' }
  }
  if (typeof input.remark !== 'string' || !input.remark.trim()) {
    return { ok: false, reason: 'A remark is required — say what the reason means for this candidate' }
  }
  return { ok: true }
}

/** The remark as it should be stored: trimmed, never an empty string. */
export function normaliseRemark(remark: unknown): string | null {
  if (typeof remark !== 'string') return null
  const t = remark.trim()
  return t ? t : null
}
