// lib/exit/lwd.ts — pure. The last working day after approval, and the notice-period waiver.
//
//   • The employee proposes a tentative LWD when they resign; every approver sees it and the
//     dates the earlier approvers set (resignation_stage_log.proposed_lwd), and sets their own.
//   • After approval — a resignation the employee filed or an exit HR started — the HR Manager
//     may change the final LWD at any time until that day has passed.
//   • The HR Manager may waive the notice period, wholly or in part (in days). The waived days
//     are not a shortfall: neither notice_shortfall_days nor the F&F recovery counts them.
// Used by app/api/exit/lwd, app/api/ess/resignation, lib/exit/fnf and the screens.

/** Who may change an approved LWD or waive notice: the HR Manager (and the super admin). */
export const LWD_ROLES = ['HR_MANAGER', 'ALL_ACCESS', 'ADMIN_SUPER']
export function canManageLwd(roleCodes: string[], superAdmin: boolean): boolean {
  return superAdmin || roleCodes.some(c => LWD_ROLES.includes(String(c).toUpperCase()))
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const d0 = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
export const daysBetween = (fromIso: string, toIso: string) => Math.round((d0(toIso) - d0(fromIso)) / 86400000)
export const addDays = (iso: string, n: number) => new Date(d0(iso) + n * 86400000).toISOString().slice(0, 10)

/** The tentative LWD an employee may propose: a date, not before the resignation date. */
export function tentativeProblem(tentative: string | null | undefined, resignedOn: string): string | null {
  if (!tentative || !ISO.test(tentative)) return 'Enter your tentative last working day.'
  if (tentative < resignedOn) return 'The tentative last working day cannot be before the date of resignation.'
  return null
}

/** Notice days not served, less what the HR Manager waived. */
export function shortfallDays(o: { policyLwd: string | null; finalLwd: string | null; waivedDays?: number | null }): number {
  if (!o.policyLwd || !o.finalLwd || !ISO.test(o.policyLwd) || !ISO.test(o.finalLwd)) return 0
  return Math.max(0, daysBetween(o.finalLwd, o.policyLwd) - Math.max(0, Math.round(Number(o.waivedDays) || 0)))
}

/** Why the HR Manager cannot move the LWD to `next` (null when they can). Allowed until the
 *  current LWD has passed — on the day itself it can still be changed. */
export function lwdChangeProblem(o: { current: string | null; next: string | null | undefined; today: string; resignedOn?: string | null }): string | null {
  if (!o.current) return 'This exit has no approved last working day yet: it is set at the HR Manager stage of the approval.'
  if (o.current < o.today) return `The last working day (${o.current}) has passed; it can no longer be changed.`
  if (!o.next || !ISO.test(o.next)) return 'Enter the new last working day.'
  if (o.next === o.current) return 'That is already the last working day.'
  if (o.next < o.today) return 'The new last working day cannot be in the past.'
  if (o.resignedOn && o.next < o.resignedOn) return 'The last working day cannot be before the date of resignation.'
  return null
}

/** Why the waiver cannot be recorded (null when it can). */
export function waiverProblem(o: { days: number; noticeDays: number; reason: string | null | undefined }): string | null {
  if (!Number.isInteger(o.days) || o.days < 0) return 'Enter the notice days to waive.'
  if (o.days > Math.max(0, o.noticeDays)) return `At most the whole notice period (${o.noticeDays} days) can be waived.`
  if (o.days > 0 && !String(o.reason || '').trim()) return 'Give the reason for the waiver.'
  return null
}

export interface LwdChange { from: string | null; to: string; reason: string | null; by: string | null; by_name: string | null; at: string }

/** An approver's LWD on the way up the chain, for the cards and the employee's view. */
export interface LwdTrailItem { stage: string; label: string; by: string | null; lwd: string; at: string | null }
export const STAGE_LABEL: Record<string, string> = { EMPLOYEE: 'Employee (tentative)', RM_L1: 'Reporting Manager (L1)', RM_L2: 'L2 Manager', HOD: 'HOD', HR_MANAGER: 'HR Manager', START: 'Proposed when the exit started' }
