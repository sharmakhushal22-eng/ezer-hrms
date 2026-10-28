// lib/exit/hr-exit.ts — pure. An exit the company starts (Exit Module spec v2 §2, §4): who may
// start one, its reasons and sub-reasons, the last-working-day rule per reason, and the approval
// chain it walks before it takes effect. Used by app/api/ess/exit-employee, the red Exit button on
// People → Employees → employee detail (components/employees/HrExitButton) and Tasks & Approvals.

/** The hiring and HR roles (Hiring Manager / Recruiter, HR Executive, Branch HR, HR Manager,
 *  HR Head, CHRO). The super admin too. */
export const EXIT_ROLES = ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO']

export function canExitOthers(roleCodes: string[], superAdmin: boolean): boolean {
  return superAdmin || roleCodes.some(c => EXIT_ROLES.includes(String(c).toUpperCase()))
}

/** A resignation still running for the employee blocks a company exit. */
export const OPEN_EXIT = ['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING']

// ── Stages ────────────────────────────────────────────────────────────────────
export type StageKey = 'HR_MANAGER' | 'DEST_HR_MANAGER' | 'LEGAL' | 'HR_HEAD' | 'MD'
export const STAGES: Record<StageKey, { label: string; roles: string[] }> = {
  HR_MANAGER: { label: 'HR Manager', roles: ['HR_MANAGER'] },
  /** A Transfer's receiving side: the HR Managers of the destination company (the route keys
   *  them as `DEST:HR_MANAGER`). Holding HR Manager in the source company does not approve it. */
  DEST_HR_MANAGER: { label: 'HR Manager (destination company)', roles: ['DEST:HR_MANAGER'] },
  LEGAL:      { label: 'Legal / Compliance', roles: ['LEGAL', 'COMPLIANCE'] },
  HR_HEAD:    { label: 'HR Head', roles: ['HR_HEAD'] },
  MD:         { label: 'MD / Management', roles: ['MD'] },
}

// ── Reasons (spec §2; Self Resignation is the employee's own, from ESS → Exit) ──────────
export type LwdRule = 'LAST_ATTENDANCE' | 'TODAY' | 'PLUS_30' | 'NOTICE' | 'MONTH_END'
export interface HrExitReason { code: string; label: string; subReasons: string[]; chain: StageKey[]; lwd: LwdRule; lwdHint: string; rehire: 'GREEN' | 'BLOCKED' | 'REVIEW' | null }
export const HR_EXIT_REASONS: HrExitReason[] = [
  { code: 'ABSCOND', label: 'Abscond', subReasons: ['No Show', 'Unreachable', 'Left without notice'],
    chain: ['HR_MANAGER', 'HR_HEAD'], lwd: 'LAST_ATTENDANCE', lwdHint: 'Last attendance date', rehire: 'BLOCKED' },
  { code: 'FRAUD', label: 'Fraud / Misconduct', subReasons: ['Financial Fraud', 'Data Theft', 'Policy Violation', 'Misrepresentation', 'Harassment'],
    chain: ['HR_MANAGER', 'LEGAL', 'HR_HEAD', 'MD'], lwd: 'TODAY', lwdHint: 'Immediate: the day it is started', rehire: 'BLOCKED' },
  { code: 'LAYOFF', label: 'Layoff', subReasons: ['Restructuring', 'Cost Reduction', 'Project Closure', 'Role Redundancy'],
    chain: ['HR_MANAGER', 'HR_HEAD', 'MD'], lwd: 'PLUS_30', lwdHint: '30 days from today (statutory minimum)', rehire: 'GREEN' },
  { code: 'TERMINATION', label: 'Termination', subReasons: ['Performance', 'Conduct', 'PIP Failure', 'Probation Failure', 'Disciplinary Action'],
    chain: ['HR_MANAGER', 'HR_HEAD', 'MD'], lwd: 'TODAY', lwdHint: 'Immediate, or a later date as per notice', rehire: 'REVIEW' },
  { code: 'DISCONTINUE', label: 'Notice of Discontinue', subReasons: ['Business Closure', 'Department Shutdown', 'Contract End', 'No Requirement'],
    chain: ['HR_MANAGER', 'HR_HEAD', 'MD'], lwd: 'NOTICE', lwdHint: "Today + the employee's notice period", rehire: 'GREEN' },
  { code: 'TRANSFER', label: 'Transfer (Inter-Company)', subReasons: ['Same Branch Transfer', 'Different Branch', 'Different Company Same Group', 'Relocation with Transfer'],
    chain: ['HR_MANAGER', 'DEST_HR_MANAGER', 'HR_HEAD'], lwd: 'MONTH_END', lwdHint: 'Transfer date − 1 day: the last day in this company (new DOJ is the day after)', rehire: null },
  // Not in the spec's seven; added on request. The family is the one paid: gratuity with no
  // minimum service, no notice recovery, the PF / EDLI nominee claim, and nothing is sent to
  // the employee's own bell or mail.
  { code: 'DEATH', label: 'Death in Service', subReasons: ['Illness', 'Accident', 'Other'],
    chain: ['HR_MANAGER', 'HR_HEAD'], lwd: 'TODAY', lwdHint: 'Date of death', rehire: null },
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
export type StepStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
export interface ChainStep {
  stage: StageKey; label: string; status: StepStatus
  approvers: Person[]
  acted_by?: Person | null; acted_at?: string | null; note?: string | null
}
export type ExitStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RESET'
/** The request the Exit button shows: still running, approved but not yet undone, or rejected
 *  and waiting to be reset. CANCELLED and RESET are closed — the button starts a new one. */
/** The Abscond reminder run (§4 Step 3): three weekly reminders before the chain starts. */
export const ABSCOND_REMINDERS = 3
export const SHOWN_STATUSES: ExitStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

/**
 * The chain for a reason. Each stage's approvers are the holders of its roles in the employee's
 * company (anyone of them may act), never the employee being exited. A stage the initiator
 * holds is approved by starting the exit; a stage nobody holds is skipped, and says so.
 */
export function buildChain(reasonCode: string, o: { holders: Record<string, Person[]>; initiator: Person; initiatorRoles: string[]; employeeId: string; now: string }): ChainStep[] {
  const r = reasonOf(reasonCode)
  if (!r) return []
  const mine = o.initiatorRoles.map(c => String(c).toUpperCase())
  return r.chain.map(stage => {
    const def = STAGES[stage]
    const seen = new Set<string>()
    const approvers = def.roles.flatMap(code => o.holders[code] || [])
      .filter(p => p.id !== o.employeeId && !seen.has(p.id) && seen.add(p.id))
    if (def.roles.some(c => mine.includes(c))) {
      return { stage, label: def.label, status: 'APPROVED' as StepStatus, approvers, acted_by: o.initiator, acted_at: o.now, note: 'Started the exit' }
    }
    if (!approvers.length) {
      return { stage, label: def.label, status: 'SKIPPED' as StepStatus, approvers, acted_by: null, acted_at: o.now, note: `Nobody holds the ${def.label} role in this company` }
    }
    return { stage, label: def.label, status: 'WAITING' as StepStatus, approvers }
  })
}

/** Mark the first WAITING step PENDING. A step one of whose approvers already approved an earlier
 *  step is approved by them again, so nobody approves the same exit twice (one person holding
 *  both HR Manager and HR Head). Returns the new chain and whether every step is done. */
export function advance(chain: ChainStep[], now = new Date().toISOString()): { chain: ChainStep[]; current: number | null; done: boolean } {
  const next = chain.map(s => ({ ...s }))
  if (next.some(s => s.status === 'REJECTED')) return { chain: next, current: null, done: false }
  const open = next.findIndex(s => s.status === 'PENDING')
  if (open >= 0) return { chain: next, current: open, done: false }
  for (;;) {
    const i = next.findIndex(s => s.status === 'WAITING')
    if (i < 0) return { chain: next, current: null, done: true }
    const earlier = next.slice(0, i).filter(s => s.status === 'APPROVED' && s.acted_by).map(s => s.acted_by!)
    const again = earlier.find(p => next[i].approvers.some(a => a.id === p.id))
    if (!again) { next[i].status = 'PENDING'; return { chain: next, current: i, done: false } }
    next[i] = { ...next[i], status: 'APPROVED', acted_by: again, acted_at: now, note: 'Already approved at an earlier step' }
  }
}

/** An approver's decision on the PENDING step. Throws with the reason it cannot be taken. */
export function decide(chain: ChainStep[], o: { actor: Person; approve: boolean; note?: string | null; now: string; superAdmin?: boolean }): ChainStep[] {
  const i = chain.findIndex(s => s.status === 'PENDING')
  if (i < 0) throw new Error('This exit is not waiting on an approval.')
  const step = chain[i]
  if (!o.superAdmin && !step.approvers.some(p => p.id === o.actor.id)) throw new Error(`This step is waiting on the ${step.label}, not you.`)
  const note = String(o.note || '').trim()
  if (!o.approve && !note) throw new Error('Give a reason for rejecting.')
  const next = chain.map(s => ({ ...s }))
  next[i] = { ...step, status: o.approve ? 'APPROVED' : 'REJECTED', acted_by: o.actor, acted_at: o.now, note: note || null }
  return next
}

/** The steps waiting on this person. */
export const waitingOn = (chain: ChainStep[], employeeId: string) => chain.some(s => s.status === 'PENDING' && s.approvers.some(p => p.id === employeeId))
