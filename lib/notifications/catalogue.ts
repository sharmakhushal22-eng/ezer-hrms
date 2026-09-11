// lib/notifications/catalogue.ts — every notification the system can send.
//
// This is the EZER-ESS-NOTIFICATION-CATALOGUE, as data rather than prose, so
// the app and the document cannot drift apart. One entry per code; the code is
// stable and is what preferences and filtering will key on later.
//
// ── WHERE THE CODE IS STORED ────────────────────────────────────────────────
// The catalogue assumes ess_notifications has a `notification_code` column. It
// does not — the live table (migration 021) is:
//
//     id, employee_id, category, title, body, link, is_read, created_at
//
// So the code goes in `category`, which is a free TEXT column already used this
// way (the four existing rows hold 'BIRTHDAY' and 'ANNIVERSARY'). That keeps
// the feature working against the schema as it is TODAY, with no migration on
// the critical path. 075 adds a real `notification_code` column plus priority
// and read_at; when it is applied, `category` keeps working and nothing here
// has to change.
//
// ── AUDIENCE ────────────────────────────────────────────────────────────────
// Who receives a notification is derived from org structure, not from a role
// table — you are an RM because people report to you, an HOD because a
// department points at you. Same rule the PMS uses, and the reason a reorg
// cannot silently misroute anything.

export type Audience =
  | 'SELF'        // the employee the event is about
  | 'RM_L1'       // their reporting manager
  | 'RM_L2'       // escalation only
  | 'HOD'         // head of their department
  | 'HR_MANAGER'
  | 'HR_HEAD'
  | 'FINANCE'
  | 'PAYROLL'
  | 'IT_ADMIN'
  | 'MD'
  | 'PEER'        // a specific colleague, named by the sender

/** In-app + Email in the catalogue means time-sensitive, financial, or a
 *  rejection. Those get a visible marker in the inbox, not just a second
 *  channel — build note 1. */
export type Priority = 'NORMAL' | 'HIGH'

export interface NotificationDef {
  code: string
  label: string          // what the inbox row says
  audience: Audience
  priority: Priority
  email: boolean
  /** Where clicking the notification should land. */
  link: string
  /** False when the trigger table or job does not exist yet — see PENDING below. */
  live: boolean
}

const D = (
  code: string, label: string, audience: Audience,
  priority: Priority, email: boolean, link: string, live = true,
): NotificationDef => ({ code, label, audience, priority, email, link, live })

// ── 1. Employee (baseline — everyone) ───────────────────────────────────────
export const EMPLOYEE: NotificationDef[] = [
  D('LEAVE_APPROVED',              'Leave request approved',                 'SELF', 'NORMAL', false, '/ess?tab=leave'),
  D('LEAVE_REJECTED',              'Leave request rejected',                 'SELF', 'HIGH',   true,  '/ess?tab=leave'),
  D('TRAVEL_APPROVED',             'Travel claim approved',                  'SELF', 'NORMAL', false, '/ess?tab=travel'),
  D('TRAVEL_REJECTED',             'Travel claim sent back',                 'SELF', 'HIGH',   true,  '/ess?tab=travel'),
  D('TRAVEL_PAID',                 'Travel claim paid',                      'SELF', 'NORMAL', false, '/ess?tab=travel'),
  D('PAYSLIP_READY',               'Monthly payslip ready',                  'SELF', 'HIGH',   true,  '/ess?tab=payroll'),
  D('DECLARATION_WINDOW_OPEN',     'Investment declaration window is open',  'SELF', 'HIGH',   true,  '/ess?tab=flexi',   false),
  D('PROOF_DEADLINE_APPROACHING',  'Proof deadline approaching',             'SELF', 'HIGH',   true,  '/ess?tab=proofs',  false),
  D('PROOF_VERIFIED',              'Investment proof verified',              'SELF', 'NORMAL', false, '/ess?tab=proofs'),
  D('PROOF_REJECTED',              'Investment proof rejected',              'SELF', 'HIGH',   true,  '/ess?tab=proofs'),
  D('RESIGNATION_ACKNOWLEDGED',    'Your resignation was acknowledged',      'SELF', 'NORMAL', false, '/ess?tab=exit'),
  D('RESIGNATION_DATE_PROPOSED',   'A different last working day was proposed','SELF','HIGH',  true,  '/ess?tab=exit'),
  D('RESIGNATION_RETENTION_REQUESTED','Retention conversation requested',    'SELF', 'HIGH',   true,  '/ess?tab=exit'),
  D('RESIGNATION_LWD_FINAL',       'Final last working day confirmed',       'SELF', 'HIGH',   true,  '/ess?tab=exit'),
  D('EXIT_CLEARANCE_ASSIGNED',     'Exit clearance item assigned to you',    'SELF', 'HIGH',   true,  '/ess?tab=exit',    false),
  D('FNF_PROCESSED',               'Full and final settlement processed',    'SELF', 'HIGH',   true,  '/ess?tab=exit'),
  D('ROLE_CHANGED',                'A role was granted or revoked for you',  'SELF', 'NORMAL', false, '/ess'),
  D('ANNIVERSARY',                 'Work anniversary',                       'SELF', 'NORMAL', false, '/ess'),
  D('BIRTHDAY',                    'Birthday',                               'SELF', 'NORMAL', false, '/ess'),
  D('COMPANY_ANNOUNCEMENT',        'Company announcement',                   'SELF', 'NORMAL', false, '/ess'),
]

// ── Peer-to-peer — NOT in the catalogue document ────────────────────────────
// The catalogue has ANNIVERSARY and BIRTHDAY, but both are system date-matches
// that tell YOU it is your own birthday. There is no code for "a colleague
// wished you happy birthday", which is the thing people actually want to see
// in a bell. Added here, and flagged as an addition rather than folded in
// silently.
//
// The wish itself is stored in ess_kudos (from_employee_id, to_employee_id,
// message, badge) — that table already exists and is exactly this shape, so
// no new table is needed for it.
export const PEER: NotificationDef[] = [
  D('WISH_RECEIVED',      'A colleague sent you a wish',      'PEER', 'NORMAL', false, '/ess'),
  D('BIRTHDAY_TODAY',     'It is a colleague’s birthday',     'SELF', 'NORMAL', false, '/ess'),
  D('ANNIVERSARY_TODAY',  'A colleague’s work anniversary',   'SELF', 'NORMAL', false, '/ess'),
  D('KUDOS_RECEIVED',     'You received kudos',               'PEER', 'NORMAL', false, '/ess'),
]

// ── 2. Reporting Manager (L1) ───────────────────────────────────────────────
export const RM_L1: NotificationDef[] = [
  D('MGR_NEW_LEAVE',            'New leave request from your team',      'RM_L1', 'NORMAL', false, '/ess?tab=approvals'),
  D('MGR_NEW_TRAVEL',           'New travel claim from your team',       'RM_L1', 'NORMAL', false, '/ess?tab=approvals'),
  D('MGR_RESIGNATION_SUBMITTED','A team member has resigned',            'RM_L1', 'HIGH',   true,  '/ess?tab=approvals'),
  D('MGR_RETENTION_FOLLOWUP',   'Retention conversation not yet logged',  'RM_L1', 'HIGH',   true,  '/ess?tab=approvals', false),
  D('MGR_SLA_WARNING',          'An approval is about to escalate',       'RM_L1', 'NORMAL', false, '/ess?tab=approvals', false),
  D('MGR_NOTICE_ENDING',        'A team member’s notice is ending soon',  'RM_L1', 'NORMAL', false, '/ess?tab=team'),
  D('MGR_DELEGATION_STARTED',   'A delegation to you has started',        'RM_L1', 'HIGH',   true,  '/ess',               false),
  D('MGR_DELEGATION_ENDED',     'A delegation to you has ended',          'RM_L1', 'NORMAL', false, '/ess',               false),
  D('MGR_PMS_KRA_SUBMITTED',    'A team member submitted their KRAs',     'RM_L1', 'NORMAL', false, '/ess?tab=performance'),
]

// ── 3. RM L2 — escalation only ──────────────────────────────────────────────
export const RM_L2: NotificationDef[] = [
  D('L2_SLA_ESCALATED',     'An item breached SLA and escalated to you', 'RM_L2', 'HIGH', true, '/ess?tab=approvals', false),
  D('L2_RESIGNATION_STAGE', 'A resignation reached your stage',          'RM_L2', 'HIGH', true, '/ess?tab=approvals'),
]

// ── 4. HOD ──────────────────────────────────────────────────────────────────
export const HOD: NotificationDef[] = [
  D('HOD_RESIGNATION_STAGE', 'A resignation reached your stage',        'HOD', 'HIGH',   true,  '/ess?tab=approvals'),
  D('HOD_SLA_SUMMARY',       'Department SLA breach summary',           'HOD', 'NORMAL', false, '/ess?tab=approvals', false),
  D('HOD_ATTRITION_FLAG',    'Attrition pattern in your department',    'HOD', 'HIGH',   true,  '/ess?tab=team',      false),
  D('HOD_PMS_FINALISE',      'Appraisals are waiting for you to finalise','HOD','HIGH',  true,  '/ess?tab=performance'),
]

// ── 5. HR Manager ───────────────────────────────────────────────────────────
export const HR_MANAGER: NotificationDef[] = [
  D('HR_RESIGNATION_FINAL_STAGE', 'Resignation reached HR — set final LWD', 'HR_MANAGER', 'HIGH',   true,  '/dashboard/employees'),
  D('HR_PROOF_SUBMITTED',         'Investment proof needs verification',    'HR_MANAGER', 'NORMAL', false, '/dashboard/investment-proofs'),
  D('HR_EXIT_CLEARANCE_PENDING',  'HR line pending on an exit clearance',   'HR_MANAGER', 'HIGH',   true,  '/dashboard/employees', false),
  D('HR_SHORTFALL_REVIEW',        'Notice shortfall recovery needs review', 'HR_MANAGER', 'NORMAL', false, '/dashboard/employees'),
  D('HR_ONBOARDING_TASK',         'New joiner — onboarding checklist',      'HR_MANAGER', 'NORMAL', false, '/dashboard/onboarding'),
  D('HR_BULK_PROOF_REMINDER',     'Proof window closing — pending count',   'HR_MANAGER', 'HIGH',   true,  '/dashboard/investment-proofs', false),
]

// ── 6. HR Head / CHRO — everything HR Manager gets, plus these ──────────────
export const HR_HEAD: NotificationDef[] = [
  D('HRHEAD_ATTRITION_REPORT', 'Company-wide attrition report ready', 'HR_HEAD', 'HIGH',   true,  '/dashboard/reports', false),
  D('HRHEAD_PUSH_SPIKE',       'Push-reason spike across departments','HR_HEAD', 'HIGH',   true,  '/dashboard/reports', false),
  D('HRHEAD_ROLE_GOVERNANCE',  'A functional role was granted or revoked','HR_HEAD','NORMAL',false,'/dashboard/roles'),
]

// ── 7. Finance / CFO ────────────────────────────────────────────────────────
export const FINANCE: NotificationDef[] = [
  D('FIN_TRAVEL_STAGE',       'Travel claim reached Finance',        'FINANCE', 'NORMAL', false, '/dashboard/finance'),
  D('FIN_POLICY_BREACH',      'Claim flagged over the policy limit',  'FINANCE', 'HIGH',   true,  '/dashboard/finance'),
  D('CFO_BUDGET_ESCALATION',  'Budget-level spend escalated',         'FINANCE', 'HIGH',   true,  '/dashboard/finance', false),
  D('CFO_MONTH_END_SUMMARY',  'Month-end finance summary ready',      'FINANCE', 'HIGH',   true,  '/dashboard/finance', false),
]

// ── 8. Payroll ──────────────────────────────────────────────────────────────
export const PAYROLL: NotificationDef[] = [
  D('PAYROLL_RUN_READY',     'Payroll run ready to execute',        'PAYROLL', 'HIGH',   true,  '/dashboard/payroll'),
  D('PAYROLL_RUN_COMPLETE',  'Run complete — TDS register ready',   'PAYROLL', 'NORMAL', false, '/dashboard/payroll'),
  D('PAYROLL_FILING_DUE',    'Statutory filing deadline approaching','PAYROLL','HIGH',   true,  '/dashboard/compliance', false),
  D('PAYROLL_NEGATIVE_NET',  'Negative net pay blocked the run',    'PAYROLL', 'HIGH',   true,  '/dashboard/payroll'),
]

// ── 9. IT / Admin ───────────────────────────────────────────────────────────
export const IT_ADMIN: NotificationDef[] = [
  D('IT_EXIT_CLEARANCE',    'IT line pending on an exit clearance',    'IT_ADMIN', 'HIGH',   true,  '/dashboard/employees', false),
  D('ADMIN_EXIT_CLEARANCE', 'Admin line pending on an exit clearance', 'IT_ADMIN', 'HIGH',   true,  '/dashboard/employees', false),
  D('ADMIN_ASSET_ISSUE',    'New joiner — asset issuance task',        'IT_ADMIN', 'NORMAL', false, '/dashboard/onboarding'),
]

// ── 10. MD ──────────────────────────────────────────────────────────────────
export const MD: NotificationDef[] = [
  D('MD_FINAL_SIGNOFF', 'Final sign-off needed — senior exit', 'MD', 'HIGH', true, '/dashboard/employees', false),
  D('MD_MONTHLY_KPI',   'Monthly company KPI summary',         'MD', 'HIGH', true, '/dashboard',           false),
]

export const ALL: NotificationDef[] = [
  ...EMPLOYEE, ...PEER, ...RM_L1, ...RM_L2, ...HOD,
  ...HR_MANAGER, ...HR_HEAD, ...FINANCE, ...PAYROLL, ...IT_ADMIN, ...MD,
]

const BY_CODE = new Map(ALL.map(d => [d.code, d]))
export const def = (code: string): NotificationDef | undefined => BY_CODE.get(code)

/** Codes whose trigger table or scheduled job does not exist yet. Kept in the
 *  catalogue so the list stays complete and honest, but nothing dispatches
 *  them — see build note 4: the scheduled ones need a cron entry point. */
export const PENDING = ALL.filter(d => !d.live).map(d => d.code)

/** HIGH priority is the catalogue's "In-app + Email" tier. */
export const isHigh = (code: string): boolean => def(code)?.priority === 'HIGH'
