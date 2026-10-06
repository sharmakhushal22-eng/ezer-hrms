// lib/recruitment/interviews-scheduled.ts
//
// Who may see which scheduled interview, and how its progress is described.
//
// Pure — no React, no Supabase — so the scoping rule can be tested directly.
// That matters more than usual here: the "Interviews Scheduled" tab reads
// across the WHOLE interview_invites table, so this function is the only thing
// standing between one recruiter and every other recruiter's hiring.
//
// WHY IT IS NOT IN THE COMPONENT
//
// The test runner is `node --experimental-strip-types`, which strips TypeScript
// but cannot load .tsx at all (ERR_UNKNOWN_FILE_EXTENSION). Logic exported from
// a component is therefore untestable in this repo by construction — the same
// reason interview-decision.ts and pipeline-gates.ts live here rather than
// beside the screens that use them.

export interface ScheduledInterview {
  id: string
  candidate_id: string | null
  candidate_name: string | null
  round: string
  interviewer_id: string | null
  interviewer_name: string | null
  interviewer_email: string | null
  role?: 'MAIN' | 'PANELIST' | null
  scheduled_at: string | null
  meet_link: string | null
  meet_passcode?: string | null
  scheduled_by: string | null
  scheduled_by_name: string | null
  status: string
  decision?: string | null
  submitted_at: string | null
  company_id: string | null
}

export const isMainInterviewer = (i: ScheduledInterview) => (i.role || 'MAIN') === 'MAIN'

export type StatusTone = 'ok' | 'warn' | 'mute' | 'info'

/**
 * The same three words ESS -> Tasks & Approvals uses for these rows
 * (components/ess/RoleTabs.tsx), so one interview never reads one way to the
 * person who scheduled it and another to the person conducting it.
 */
export function statusOf(i: ScheduledInterview): { label: string; tone: StatusTone } {
  if (i.status === 'submitted') {
    const d = i.decision
    const word = d === 'HOLD' ? 'On hold' : d === 'REJECT' ? 'Rejected' : d === 'SHORTLIST' ? 'Shortlisted' : null
    return { label: word ? `Feedback in · ${word}` : 'Feedback in', tone: 'ok' }
  }
  if (i.status === 'acknowledged') {
    // A panelist never gives feedback, so "awaiting feedback" would be a false
    // outstanding item on the recruiter's screen.
    return isMainInterviewer(i)
      ? { label: 'Acknowledged · awaiting feedback', tone: 'info' }
      : { label: 'Acknowledged', tone: 'mute' }
  }
  return { label: 'Invited · not acknowledged', tone: 'warn' }
}

export interface ViewerScope {
  /** The viewer's employee id. Null for the legacy dashboard login. */
  employeeId: string | null
  /** Holds one of OVERSIGHT_CODES — sees every row, not only their own. */
  isOversight: boolean
  /** companyFilter()'s answer: a company to pin to, or null for "every company". */
  companyId: string | null
}

/**
 * The rows this viewer may see.
 *
 * Scoped to what they SCHEDULED unless they hold an oversight role, mirroring
 * how loadAll() already scopes MRFs and candidates. Company is pinned by the
 * caller's companyFilter() result — the module's single choke-point — where a
 * null means "may see every company" rather than "no company".
 *
 * Fails CLOSED: a viewer with no employee id and no oversight sees nothing.
 */
export function visibleInvites(
  all: readonly ScheduledInterview[],
  opts: ViewerScope,
): ScheduledInterview[] {
  return all.filter(i => {
    // company_id is nullable on interview_invites; a row without one is not
    // hidden by a pin, or interviews would be lost rather than scoped.
    if (opts.companyId && i.company_id && i.company_id !== opts.companyId) return false
    if (opts.isOversight) return true
    return !!opts.employeeId && i.scheduled_by === opts.employeeId
  })
}

/** Newest scheduled first; rows with no date sort LAST rather than first. */
export function byWhen(a: ScheduledInterview, b: ScheduledInterview): number {
  const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : null
  const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : null
  if (ta === null && tb === null) return 0
  if (ta === null) return 1
  if (tb === null) return -1
  return tb - ta
}
