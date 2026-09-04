// lib/pms/hierarchy.ts — who may do what, and in what order. Spec §1 and §2.
//
// WHY THIS IS DATA AND NOT `if` STATEMENTS SCATTERED THROUGH COMPONENTS
//
// The spec's role matrix has 18 actions across 7 roles — 126 cells, three of
// which are neither yes nor no but "whatever the policy says". Encoded as
// conditionals inside screens, that matrix is unreadable and unverifiable: you
// cannot diff it against the spec, and the first time somebody adds a screen
// they re-derive a corner of it from memory.
//
// Encoded as a table, the whole thing is one object that a test reads
// alongside the spec, and every screen asks the same function.
//
// THE PART THAT IS EASY TO GET WRONG
//
// "Finalise rating" is ⚙️ for RM L1, RM L2 and HOD — it depends on
// pms_policies.who_can_finalise. A screen that treats ⚙️ as ✅ lets an RM L1
// finalise under a HOD_ONLY policy; a screen that treats it as — hides the
// button from the person the policy actually appointed. Both are wrong, so
// `may()` returns three values, not a boolean, and the caller is made to
// handle the third by the type.

export const ROLES = [
  'EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR_MGR', 'HR_HEAD', 'ADMIN',
] as const
export type Role = typeof ROLES[number]

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee', RM_L1: 'RM L1', RM_L2: 'RM L2', HOD: 'HOD',
  HR_MGR: 'HR Manager', HR_HEAD: 'HR Head', ADMIN: 'Admin',
}

/** The reporting line, top to bottom, as §0 states it. */
export const REPORTING_LINE = ['MD', 'HOD', 'RM L2', 'RM L1', 'Employee'] as const

export type Permission = 'yes' | 'no' | 'policy'

export const ACTIONS = [
  'create_own_kras', 'approve_reportee_kras', 'log_one_to_one',
  'ack_one_to_one', 'lock_weightage', 'self_rating', 'rate_reportees',
  'finalise_rating', 'give_feedback', 'upload_benefit', 'raise_pip_request',
  'initiate_pip', 'configure_policy', 'bulk_upload_ratings',
  'view_own_analytics', 'view_team_analytics', 'export_reports',
] as const
export type Action = typeof ACTIONS[number]

export const ACTION_LABEL: Record<Action, string> = {
  create_own_kras:       'Create own KRAs',
  approve_reportee_kras: 'Approve / send back reportee KRAs',
  log_one_to_one:        'Log one-to-one',
  ack_one_to_one:        'Acknowledge one-to-one',
  lock_weightage:        'Lock weightage',
  self_rating:           'Self rating',
  rate_reportees:        'Rate reportees',
  finalise_rating:       'Finalise rating',
  give_feedback:         'Appreciation / improvement feedback',
  upload_benefit:        'Upload additional benefit',
  raise_pip_request:     'Raise PIP request',
  initiate_pip:          'Initiate PIP',
  configure_policy:      'Configure policy / periods',
  bulk_upload_ratings:   'Bulk upload final ratings',
  view_own_analytics:    'View own analytics',
  view_team_analytics:   'View team analytics',
  export_reports:        'Export reports',
}

const Y: Permission = 'yes', N: Permission = 'no', P: Permission = 'policy'

/** Spec §2, transcribed cell for cell. Order matches ROLES. */
const MATRIX: Record<Action, Permission[]> = {
  //                     EMP RM1 RM2 HOD HRM HRH ADM
  create_own_kras:       [ Y,  Y,  Y,  Y,  Y,  Y,  Y ],
  approve_reportee_kras: [ N,  Y,  Y,  Y,  N,  N,  N ],
  log_one_to_one:        [ Y,  Y,  Y,  Y,  N,  N,  N ],
  ack_one_to_one:        [ Y,  Y,  Y,  Y,  N,  N,  N ],
  lock_weightage:        [ N,  Y,  Y,  Y,  N,  N,  N ],
  self_rating:           [ Y,  Y,  Y,  Y,  Y,  Y,  Y ],
  rate_reportees:        [ N,  Y,  Y,  Y,  N,  N,  N ],
  finalise_rating:       [ N,  P,  P,  P,  Y,  Y,  Y ],
  give_feedback:         [ N,  Y,  Y,  Y,  Y,  Y,  Y ],
  upload_benefit:        [ N,  N,  Y,  Y,  Y,  Y,  Y ],
  raise_pip_request:     [ N,  Y,  Y,  Y,  N,  N,  N ],
  initiate_pip:          [ N,  N,  N,  N,  Y,  Y,  Y ],
  configure_policy:      [ N,  N,  N,  N,  N,  Y,  Y ],
  bulk_upload_ratings:   [ N,  N,  N,  N,  Y,  Y,  Y ],
  view_own_analytics:    [ Y,  Y,  Y,  Y,  Y,  Y,  Y ],
  view_team_analytics:   [ N,  Y,  Y,  Y,  Y,  Y,  Y ],
  export_reports:        [ N,  Y,  Y,  Y,  Y,  Y,  Y ],
}

/**
 * What this role may do. Three-valued on purpose — see the header. The scope
 * of a `yes` still narrows by role (an RM's "view team analytics" is their own
 * team, a HOD's is their department); SCOPE_NOTE carries that.
 */
export function may(role: Role, action: Action): Permission {
  return MATRIX[action][ROLES.indexOf(role)]
}

/** §2's footnotes: a yes is not always the same size of yes. */
export const SCOPE_NOTE: Partial<Record<Action, Partial<Record<Role, string>>>> = {
  view_team_analytics: {
    RM_L1: 'own team', RM_L2: 'own team', HOD: 'own department',
    HR_MGR: 'all', HR_HEAD: 'all', ADMIN: 'all',
  },
  export_reports: {
    RM_L1: 'own team', RM_L2: 'own team', HOD: 'own department',
    HR_MGR: 'all', HR_HEAD: 'all', ADMIN: 'all',
  },
}

// ── who finalises ────────────────────────────────────────────────────────

export const FINALISERS = ['RM1_RM2_HOD', 'RM2_HOD', 'HOD_ONLY'] as const
export type Finaliser = typeof FINALISERS[number]

export const FINALISER_LABEL: Record<Finaliser, string> = {
  RM1_RM2_HOD: 'RM L1, RM L2 or HOD',
  RM2_HOD:     'RM L2 or HOD',
  HOD_ONLY:    'HOD only',
}

const FINALISER_ROLES: Record<Finaliser, Role[]> = {
  RM1_RM2_HOD: ['RM_L1', 'RM_L2', 'HOD'],
  RM2_HOD:     ['RM_L2', 'HOD'],
  HOD_ONLY:    ['HOD'],
}

/**
 * Resolves the ⚙️ cell. HR roles finalise regardless of the setting — the
 * matrix gives them a plain ✅, because who_can_finalise picks which *line
 * manager* signs off, not whether HR can correct a stuck record.
 */
export function canFinalise(role: Role, setting: Finaliser): boolean {
  const cell = may(role, 'finalise_rating')
  if (cell === 'yes') return true
  if (cell === 'no') return false
  return FINALISER_ROLES[setting].includes(role)
}

// ── the approval chain ───────────────────────────────────────────────────

export const CHAINS = ['SELF_RM1_RM2_HOD', 'SELF_RM1_HOD', 'SELF_RM1'] as const
export type Chain = typeof CHAINS[number]

export const CHAIN_LABEL: Record<Chain, string> = {
  SELF_RM1_RM2_HOD: 'Self → RM L1 → RM L2 → HOD',
  SELF_RM1_HOD:     'Self → RM L1 → HOD',
  SELF_RM1:         'Self → RM L1 only',
}

export const CHAIN_STEPS: Record<Chain, Role[]> = {
  SELF_RM1_RM2_HOD: ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD'],
  SELF_RM1_HOD:     ['EMPLOYEE', 'RM_L1', 'HOD'],
  SELF_RM1:         ['EMPLOYEE', 'RM_L1'],
}

/**
 * Rule 7: HOD cannot finalise while RM L2 is still pending. Only meaningful on
 * a chain that HAS an RM L2 — on Self → RM L1 → HOD there is nobody to wait
 * for, and blocking there would deadlock the record forever.
 */
export function blockedByRmL2(chain: Chain, rmL2Done: boolean): boolean {
  return CHAIN_STEPS[chain].includes('RM_L2') && !rmL2Done
}

// ── the flow, §1 ─────────────────────────────────────────────────────────

export interface FlowStep {
  n: number
  actor: string
  what: string
  /** The gate that stops the flow here. Null where nothing blocks. */
  gate: string | null
}

/** §1's twelve boxes. Steps 9-12 only run when the rating is low. */
export const FLOW: FlowStep[] = [
  { n: 1,  actor: 'HR Admin', what: 'Build the policy — frequency, KRA rules, chain, eligibility', gate: null },
  { n: 2,  actor: 'System',   what: 'Periods generate automatically with all four windows', gate: null },
  { n: 3,  actor: 'Employee', what: 'Write 4 to 10 KRAs totalling exactly 100 weightage', gate: 'Submit stays disabled until the total is 100' },
  { n: 4,  actor: 'Employee + RM', what: 'One-to-one: discuss, settle weightage, both acknowledge', gate: 'Without both acknowledgements the weightage cannot lock' },
  { n: 5,  actor: 'Employee', what: 'Self rating on each KRA — achievement, rating, comment', gate: 'Submitting locks self and unlocks the RM' },
  { n: 6,  actor: 'RM L1 → RM L2', what: 'Rate and comment; RM L2 confirms', gate: 'Blocked until the self rating is in' },
  { n: 7,  actor: 'Whoever the policy appoints', what: 'Final review one-to-one, then finalise with feedback and any recognition', gate: 'Blocked until the final review one-to-one is logged' },
  { n: 8,  actor: 'Employee', what: 'Sees the result and feedback, and acknowledges', gate: 'Nothing is visible before publish' },
  { n: 9,  actor: 'RM',       what: 'Raises a PIP request — dates, areas, targets, measures, support', gate: 'Only when the rating is low' },
  { n: 10, actor: 'HR Manager', what: 'Reviews: adjust, drop an area, reject, or send back', gate: null },
  { n: 11, actor: 'HR',       what: 'Initiates; the employee is notified and acknowledges', gate: 'An RM cannot do this step' },
  { n: 12, actor: 'RM + HR',  what: 'Fortnightly or monthly reviews, then the outcome', gate: null },
]

/** §1's closing line, which is the whole point of v2. */
export const FLOW_ENDS = 'Nothing flows to payroll. The loop ends at feedback and development.'
