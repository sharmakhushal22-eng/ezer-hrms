// lib/exit/hr-exit.ts — pure. Who may exit another employee from ESS → HR Services → Exit, and
// what such an exit must carry. Used by app/api/ess/exit-employee and the Exit screen.

/** The hiring and HR roles (Hiring Manager / Recruiter, HR Executive, Branch HR, HR Manager,
 *  HR Head, CHRO). The super admin too. */
export const EXIT_ROLES = ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO']

export function canExitOthers(roleCodes: string[], superAdmin: boolean): boolean {
  return superAdmin || roleCodes.some(c => EXIT_ROLES.includes(String(c).toUpperCase()))
}

/** A resignation still running for the employee blocks a second exit. */
export const OPEN_EXIT = ['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING']

export interface ExitInput { employeeId?: string | null; reasonCode?: string | null; dateOfExit?: string | null; remarks?: string | null }

/** Why this exit cannot be processed (empty = it can). `self` = the caller's own employee id. */
export function exitProblems(x: ExitInput, o: { self: string; reasons: string[] }): string[] {
  const out: string[] = []
  if (!x.employeeId) out.push('Pick the employee (by employee code).')
  else if (x.employeeId === o.self) out.push('You cannot exit yourself here. Use Resign on your own Exit screen.')
  if (!x.reasonCode) out.push('Pick the reason for the exit.')
  else if (!o.reasons.includes(x.reasonCode)) out.push('That reason is not in the exit reasons list.')
  if (!x.dateOfExit || !/^\d{4}-\d{2}-\d{2}$/.test(x.dateOfExit) || Number.isNaN(new Date(x.dateOfExit).getTime())) out.push('Enter the date of exit.')
  if (String(x.remarks || '').length > 2000) out.push('Additional information is limited to 2000 characters.')
  return out
}
