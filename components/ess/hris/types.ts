// View models for the HRIS redesign.
//
// These are the shapes the existing screens already read — the field names come
// from `employees`, `ess_service_requests`, buildPending() and
// /api/ess/resignation, not from anything new. The redesign changes pixels; a
// renamed field here would change the data flow, which it must not.

/** A row of `employees`, as loadDirectory() returns it. */
export interface DirectoryRow {
  id: string
  emp_code: string
  full_name: string
  designation: string | null
  dept_name: string | null
  location_name: string | null
  mobile: string | null
  office_email: string | null
  personal_email: string | null
}

/** A row of `ess_service_requests`. */
export interface ServiceRequestRow {
  id: string
  request_type: string
  request_data: { detail?: string } | null
  is_confidential: boolean | null
  status: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | string
  submitted_at: string | null
  assigned_to: string | null
}

/** One item from GET /api/ess/approvals — buildPending()'s shape, unchanged. */
export interface PendingItem {
  kind: 'LEAVE' | 'LEAVE_CANCEL' | 'REGULARISATION' | 'TRAVEL' | 'RESIGNATION'
  id: string
  employee_id: string
  who: string
  what: string
  meta: string
  stage: string
  raised_at?: string | null
  /** Why this row is on screen: 'stamped' | 'HOD scope' | a role name. */
  surfaced_via: string
  /** Stamped to me → may act. Otherwise oversight only. */
  mine: boolean
  actions: string[]
  tone?: 'w' | 'd'
  link?: string
  /** Context lines for the approver: balance before/after, who else is off. */
  facts?: string[]
  /** Something that should stop a blind click. */
  alert?: string | null
  lwd_policy?: string | null
  lwd_proposed?: string | null
  notice_days?: number | null
  /** The employee's tentative LWD, and each earlier approver's date (lib/ess/pending.ts). */
  lwd_tentative?: string | null
  lwd_trail?: { stage: string; label: string; by: string | null; lwd: string; at: string | null }[]
}

/** A stage entry, as both /api/ess/approvals?resignation_id= and
 *  /api/ess/resignation return it. */
/** Resignation dates the LWD inputs start from (lib/ess/pending.ts). */
export interface LwdHints { lwd_policy?: string | null; lwd_proposed?: string | null; notice_days?: number | null }

export interface ChainRow {
  stage: string
  action: string
  approver?: { full_name?: string | null; emp_code?: string | null; designation?: string | null } | null
  actioned_at: string
  note?: string | null
  proposed_lwd?: string | null
}

/** GET /api/ess/resignation → `current`. */
export interface ResignationRecord {
  id: string
  status: string
  submitted_at?: string | null
  created_at?: string | null
  notice_period_days?: number | null
  lwd_as_per_policy?: string | null
  proposed_lwd?: string | null
  final_lwd?: string | null
  /** The date the employee proposed when resigning (migration 207). */
  tentative_lwd?: string | null
  /** Notice days the HR Manager waived, and why (migration 207). */
  notice_waived_days?: number | null
  notice_waiver_reason?: string | null
  reason_code?: string | null
  exit_reason_master?: { label?: string | null } | null
  submitted_by_employee?: boolean | null
}

export interface StageApprover { id: string; full_name: string; emp_code: string | null; designation: string | null }
export interface ResignationState {
  current: ResignationRecord | null
  chain: ChainRow[]
  /** Who each stage goes to (RM_L1 / RM_L2 / HOD / HR_MANAGER), resolved from the record; null = stage skipped. */
  approvers?: Record<string, StageApprover | null>
  reasons: { code: string; label: string }[]
  notice_period_days: number | null
}

/** Which HRIS screen is showing. Matches the portal's `view` keys exactly, so
 *  the portal stays the single source of truth for navigation. */
export type HrisTab = 'directory' | 'requests' | 'approvals' | 'raise-mrf' | 'exit'
