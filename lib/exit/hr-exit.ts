// lib/exit/hr-exit.ts — pure. An exit the company starts (Exit Module spec v2 §2, §4): who may
// start one, its reasons and sub-reasons, the last-working-day rule per reason, and the approval
// chain it walks before it takes effect. The chain is THE SAME as an employee's own resignation
// (071's fn_resignation_advance / fn_resignation_act): Reporting Manager (L1) → L2 Manager → HOD
// → HR Manager, each stage's approver from the employee's record, the same skips, the managers'
// Acknowledge & forward / Accept with my date / Request retention, and the HR Manager's Set final
// LWD that completes it. Used by app/api/ess/exit-employee, the red Exit button on
// People → Employees → employee → HR Actions (components/employees/HrExitSection) and Tasks & Approvals.

/** The hiring and HR roles (Hiring Manager / Recruiter, HR Executive, Branch HR, HR Manager,
 *  HR Head, CHRO). The super admin too. */
export const EXIT_ROLES = ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO']

export function canExitOthers(roleCodes: string[], superAdmin: boolean): boolean {
  return superAdmin || roleCodes.some(c => EXIT_ROLES.includes(String(c).toUpperCase()))
}

/** A resignation still running for the employee blocks a company exit. */
export const OPEN_EXIT = ['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING']

// ── Stages: the self-resignation chain, in its order ─────────────────────────────
export type StageKey = 'RM_L1' | 'RM_L2' | 'HOD' | 'HR_MANAGER'
export const STAGE_ORDER: StageKey[] = ['RM_L1', 'RM_L2', 'HOD', 'HR_MANAGER']
export const STAGES: Record<StageKey, { label: string }> = {
  RM_L1: { label: 'Reporting Manager (L1)' },
  RM_L2: { label: 'L2 Manager' },
  HOD: { label: 'HOD' },
  HR_MANAGER: { label: 'HR Manager' },
}
/** The action labels the resignation cards use (lib/ess/pending.ts), and their codes. */
export const ACTIONS = {
  ACKNOWLEDGED: 'Acknowledge & forward', ACCEPTED_WITH_DATE: 'Accept with my date', REQUESTED_RETENTION: 'Request retention',
  RESUMED: 'Resume chain', FINAL_LWD_SET: 'Set final LWD',
} as const
export type ActionCode = keyof typeof ACTIONS

// ── Reasons (spec §2; Self Resignation is the employee's own, from ESS → Exit) ──────────
export type LwdRule = 'LAST_ATTENDANCE' | 'TODAY' | 'PLUS_30' | 'NOTICE' | 'MONTH_END'
export interface HrExitReason { code: string; label: string; subReasons: string[]; lwd: LwdRule; lwdHint: string; rehire: 'GREEN' | 'BLOCKED' | 'REVIEW' | null }
export const HR_EXIT_REASONS: HrExitReason[] = [
  { code: 'ABSCOND', label: 'Abscond', subReasons: ['No Show', 'Unreachable', 'Left without notice'],
    lwd: 'LAST_ATTENDANCE', lwdHint: 'Last attendance date', rehire: 'BLOCKED' },
  { code: 'FRAUD', label: 'Fraud / Misconduct', subReasons: ['Financial Fraud', 'Data Theft', 'Policy Violation', 'Misrepresentation', 'Harassment'],
    lwd: 'TODAY', lwdHint: 'Immediate: the day it is started', rehire: 'BLOCKED' },
  { code: 'LAYOFF', label: 'Layoff', subReasons: ['Restructuring', 'Cost Reduction', 'Project Closure', 'Role Redundancy'],
    lwd: 'PLUS_30', lwdHint: '30 days from today (statutory minimum)', rehire: 'GREEN' },
  { code: 'TERMINATION', label: 'Termination', subReasons: ['Performance', 'Conduct', 'PIP Failure', 'Probation Failure', 'Disciplinary Action'],
    lwd: 'TODAY', lwdHint: 'Immediate, or a later date as per notice', rehire: 'REVIEW' },
  { code: 'DISCONTINUE', label: 'Notice of Discontinue', subReasons: ['Business Closure', 'Department Shutdown', 'Contract End', 'No Requirement'],
    lwd: 'NOTICE', lwdHint: "Today + the employee's notice period", rehire: 'GREEN' },
  { code: 'TRANSFER', label: 'Transfer (Inter-Company)', subReasons: ['Same Branch Transfer', 'Different Branch', 'Different Company Same Group', 'Relocation with Transfer'],
    lwd: 'MONTH_END', lwdHint: 'Transfer date − 1 day: the last day in this company (new DOJ is the day after)', rehire: null },
  // Not in the spec's seven; added on request. The family is the one paid: gratuity with no
  // minimum service, no notice recovery, the PF / EDLI nominee claim, and nothing is sent to
  // the employee's own bell or mail.
  { code: 'DEATH', label: 'Death in Service', subReasons: ['Illness', 'Accident', 'Other'],
    lwd: 'TODAY', lwdHint: 'Date of death', rehire: null },
]
/** Exits where nothing is sent to the employee themself (their bell / mail). */
export const SILENT_REASONS = ['DEATH']
export const isSilent = (code: string | null | undefined) => SILENT_REASONS.includes(String(code || '').toUpperCase())
export const reasonOf = (code: string | null | undefined) => HR_EXIT_REASONS.find(r => r.code === code) || null

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** The suggested last working day for a reason (spec §4 Step 2). HR may change it. */
export function suggestedLwd(code: string, o: { today: string; noticeDays: number; lastAttendance?: string | null }): string {
  const r = reasonOf(code)
  if (!r) return o.today
  if (r.lwd === 'LAST_ATTENDANCE') return o.lastAttendance && o.lastAttendance <= o.today ? o.lastAttendance : o.today
  if (r.lwd === 'PLUS_30') return addDays(o.today, 30)
  if (r.lwd === 'NOTICE') return addDays(o.today, Math.max(0, o.noticeDays || 0))
  if (r.lwd === 'MONTH_END') { const d = new Date(`${o.today}T00:00:00Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) }
  return o.today
}

export interface StartInput { employeeId?: string | null; reasonCode?: string | null; subReason?: string | null; lwd?: string | null; remarks?: string | null; destinationCompanyId?: string | null; sourceCompanyId?: string | null }

/** Why this exit cannot be started (empty = it can). `self` = the caller's own employee id. */
export function startProblems(x: StartInput, o: { self: string }): string[] {
  const out: string[] = []
  if (!x.employeeId) out.push('Pick the employee.')
  else if (x.employeeId === o.self) out.push('You cannot exit yourself here. Use Resign on your own Exit screen.')
  const r = reasonOf(x.reasonCode)
  if (!x.reasonCode) out.push('Pick the reason for the exit.')
  else if (!r) out.push('That reason is not one HR can start.')
  else if (!x.subReason || !r.subReasons.includes(x.subReason)) out.push('Pick the sub-reason.')
  if (!x.lwd || !/^\d{4}-\d{2}-\d{2}$/.test(x.lwd) || Number.isNaN(new Date(x.lwd).getTime())) out.push('Enter the last working day.')
  if (r?.code === 'TRANSFER') {
    if (!x.destinationCompanyId) out.push('Pick the company the employee is transferring to.')
    else if (x.destinationCompanyId === x.sourceCompanyId) out.push('A transfer goes to another company in the group. A move inside the company is a transfer in People → Transfers.')
  }
  const rem = String(x.remarks || '').trim()
  if (!rem) out.push('Additional information is required: why the exit is happening.')
  else if (rem.length > 2000) out.push('Additional information is limited to 2000 characters.')
  return out
}

// ── The chain ────────────────────────────────────────────────────────────────
export interface Person { id: string; emp_code: string | null; full_name: string }
/** WAITING not reached yet · PENDING with its approver · HOLD retention requested (the chain
 *  waits until the approver resumes it) · APPROVED acted on · SKIPPED nobody to act ·
 *  REJECTED only on requests from before the chain matched the resignation's. */
export type StepStatus = 'WAITING' | 'PENDING' | 'HOLD' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
export interface ChainStep {
  stage: StageKey | string; label: string; status: StepStatus
  approvers: Person[]
  acted_by?: Person | null; acted_at?: string | null; note?: string | null
  /** What the approver did: STARTED (the initiator's own stage), ACKNOWLEDGED, ACCEPTED_WITH_DATE,
   *  FINAL_LWD_SET; REQUESTED_RETENTION while on hold. */
  action?: ActionCode | 'STARTED' | null
  /** The date given with Accept with my date / Set final LWD. */
  lwd?: string | null
}
export type ExitStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RESET'
/** The Abscond reminder run (§4 Step 3): three weekly reminders before the chain starts. */
export const ABSCOND_REMINDERS = 3
/** The request the Exit section shows: running, approved but not yet undone, or (older requests)
 *  rejected. CANCELLED and RESET are closed — a new one can be started. */
export const SHOWN_STATUSES: ExitStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

/**
 * The chain, stage by stage, as fn_resignation_advance builds it for a resignation: each stage
 * goes to the one person the employee's record names (fn_resignation_stage_approver, with any
 * delegation applied). A stage with nobody, or that resolves to the employee being exited, is
 * skipped and says why. The initiator has acted by starting the exit, so their own manager stage
 * is done — but never the HR Manager's: that stage sets the final last working day after the
 * managers have had their say, as it does for every resignation.
 */
export function buildChain(o: { approvers: Partial<Record<StageKey, Person | null>>; initiator: Person; employeeId: string; now: string }): ChainStep[] {
  return STAGE_ORDER.map(stage => {
    const label = STAGES[stage].label
    const p = o.approvers[stage] || null
    if (!p) return { stage, label, status: 'SKIPPED' as StepStatus, approvers: [], acted_by: null, acted_at: o.now, note: 'No approver resolved' }
    if (p.id === o.employeeId) return { stage, label, status: 'SKIPPED' as StepStatus, approvers: [p], acted_by: null, acted_at: o.now, note: 'Resolves to the employee being exited' }
    if (p.id === o.initiator.id && stage !== 'HR_MANAGER') return { stage, label, status: 'APPROVED' as StepStatus, approvers: [p], acted_by: o.initiator, acted_at: o.now, note: 'Started the exit', action: 'STARTED' as const }
    return { stage, label, status: 'WAITING' as StepStatus, approvers: [p] }
  })
}

/** Stamp the next stage, as fn_resignation_advance does: a manager stage whose approver already
 *  acted at an earlier one is skipped ("Already acted at an earlier stage"). The HR Manager stage
 *  is always stamped (when it has an approver), since it is the one that sets the final LWD.
 *  Returns the chain, the stage now waiting, and whether the chain is complete. */
export function advance(chain: ChainStep[], now = new Date().toISOString()): { chain: ChainStep[]; current: number | null; done: boolean } {
  const next = chain.map(s => ({ ...s }))
  if (next.some(s => s.status === 'REJECTED')) return { chain: next, current: null, done: false }
  const open = next.findIndex(s => s.status === 'PENDING' || s.status === 'HOLD')
  if (open >= 0) return { chain: next, current: open, done: false }
  for (;;) {
    const i = next.findIndex(s => s.status === 'WAITING')
    if (i < 0) return { chain: next, current: null, done: true }
    const acted = new Set(next.slice(0, i).filter(s => s.status === 'APPROVED' && s.acted_by).map(s => s.acted_by!.id))
    if (next[i].stage === 'HR_MANAGER' || !next[i].approvers.some(a => acted.has(a.id))) { next[i].status = 'PENDING'; return { chain: next, current: i, done: false } }
    next[i] = { ...next[i], status: 'SKIPPED', acted_at: now, note: 'Already acted at an earlier stage' }
  }
}

/** The actions open to the stage's approver, in the resignation card's order (lib/ess/pending.ts). */
export function actionsFor(step: ChainStep | null | undefined): ActionCode[] {
  if (!step) return []
  if (step.status === 'HOLD') return ['RESUMED']
  if (step.status !== 'PENDING') return []
  return step.stage === 'HR_MANAGER' ? ['FINAL_LWD_SET'] : ['ACKNOWLEDGED', 'ACCEPTED_WITH_DATE', 'REQUESTED_RETENTION']
}

/** The newest date a manager proposed with Accept with my date (HR starts from it). */
export const proposedLwd = (chain: ChainStep[]): string | null =>
  [...chain].reverse().find(s => s.action === 'ACCEPTED_WITH_DATE' && s.lwd)?.lwd || null

/**
 * An approver acts on the stage waiting on them, as fn_resignation_act does. Throws with the
 * reason it cannot be taken. `finalLwd` is set when the HR Manager has set the final LWD.
 */
export function act(chain: ChainStep[], o: { actor: Person; action: string; note?: string | null; lwd?: string | null; now: string }): { chain: ChainStep[]; finalLwd: string | null; hold: boolean } {
  const i = chain.findIndex(s => s.status === 'PENDING' || s.status === 'HOLD')
  if (i < 0) throw new Error('This exit is not waiting on anyone.')
  const step = chain[i]
  if (!step.approvers.some(p => p.id === o.actor.id)) throw new Error(`This exit is waiting on the ${step.label}, not you.`)
  const code = (Object.keys(ACTIONS) as ActionCode[]).find(k => k === o.action || ACTIONS[k] === o.action)
  if (!code || !actionsFor(step).includes(code)) {
    if (step.status === 'HOLD') throw new Error('This exit is on retention hold. Resume the chain first.')
    if (step.stage === 'HR_MANAGER') throw new Error('The HR Manager stage sets the final last working day.')
    throw new Error(code === 'FINAL_LWD_SET' ? 'Only the HR Manager stage sets the final last working day.' : `Unknown action for the ${step.label}.`)
  }
  const note = String(o.note || '').trim() || null
  const lwd = o.lwd && /^\d{4}-\d{2}-\d{2}$/.test(o.lwd) ? o.lwd : null
  if ((code === 'ACCEPTED_WITH_DATE' || code === 'FINAL_LWD_SET') && !lwd) throw new Error(code === 'FINAL_LWD_SET' ? 'Enter the final last working day.' : 'Enter the last working day you accept.')
  const next = chain.map(s => ({ ...s }))
  if (code === 'REQUESTED_RETENTION') { next[i] = { ...step, status: 'HOLD', action: 'REQUESTED_RETENTION', note, acted_at: o.now }; return { chain: next, finalLwd: null, hold: true } }
  if (code === 'RESUMED') { next[i] = { ...step, status: 'PENDING', action: null, note: note ? `Resumed: ${note}` : step.note, acted_at: null }; return { chain: next, finalLwd: null, hold: false } }
  next[i] = { ...step, status: 'APPROVED', action: code, acted_by: o.actor, acted_at: o.now, note, lwd: code === 'ACKNOWLEDGED' ? null : lwd }
  return { chain: next, finalLwd: code === 'FINAL_LWD_SET' ? lwd : null, hold: false }
}

/** The steps waiting on this person. */
export const waitingOn = (chain: ChainStep[], employeeId: string) => chain.some(s => (s.status === 'PENDING' || s.status === 'HOLD') && s.approvers.some(p => p.id === employeeId))

/** What a step's approver did, in words, for the flow on screen. */
export function stepWords(s: ChainStep): string {
  if (s.status === 'HOLD') return 'Retention requested'
  if (s.status === 'SKIPPED') return 'Skipped'
  if (s.status === 'REJECTED') return 'Rejected'
  if (s.status === 'PENDING') return 'Waiting'
  if (s.status === 'WAITING') return 'Not reached yet'
  return s.action === 'STARTED' ? 'Started the exit' : s.action === 'ACCEPTED_WITH_DATE' ? 'Accepted with date'
    : s.action === 'FINAL_LWD_SET' ? 'Final LWD set' : 'Acknowledged'
}
