// lib/onboarding/approval-trail.ts — pure. Where an onboarding's sign-off is, and who has it.
//
// The chain (lib/onboarding/approvals.ts):
//   1. HR Manager review   — starts when the candidate submits; accept or return.
//   2. IT · Admin · Payroll — in parallel, once the HR Manager has accepted; each confirms a
//                            checklist and approves, or returns the form with a remark.
//   3. Employee code       — the HR Manager, once all three heads have approved.
//
// The onboarding table shows a compact summary ("2/4 approved · with Payroll") and the
// popover behind it lists every step: the team, who acts for it (the ESS role holders, from
// /api/onboarding/approvers), and what happened — approved by whom and when, waiting on whom
// since when, returned with what remark, or not started yet.

export type TrailTeam = 'HR_MANAGER' | 'IT' | 'ADMIN' | 'PAYROLL'
export const TRAIL_TEAMS: TrailTeam[] = ['HR_MANAGER', 'IT', 'ADMIN', 'PAYROLL']
export const HEADS: TrailTeam[] = ['IT', 'ADMIN', 'PAYROLL']
export const TRAIL_LABEL: Record<TrailTeam | 'CODE', string> = {
  HR_MANAGER: 'HR Manager review', IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', CODE: 'Employee code',
}
/** Short names for the "now with" line. */
const SHORT: Record<TrailTeam | 'CODE', string> = { HR_MANAGER: 'HR Manager', IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', CODE: 'HR Manager' }

export interface ApprovalRow {
  team: string
  status: string            // PENDING | APPROVED | RETURNED
  acted_by_name?: string | null
  acted_at?: string | null
  remark?: string | null
}
export interface Holder { name: string; code?: string | null }

export interface TrailInput {
  status: string            // onboarding_candidates.status
  submitted_at?: string | null
  /** The onboarding_approvals rows that exist — missing teams are simply absent. */
  approvals: ApprovalRow[]
  /** Who acts for each team in this company (ESS role holders). */
  holders?: Partial<Record<TrailTeam, Holder[]>> | null
  /** onboarding_candidates.hr_review — the HR Manager's last review. */
  hr_review?: { outcome?: string | null; by_name?: string | null; at?: string | null; note?: string | null } | null
  /** onboarding_candidates.role_assignment — who generated the code, and when. */
  role_assignment?: { by_name?: string | null; at?: string | null } | null
  employee_code?: string | null
}

export type StepState = 'done' | 'waiting' | 'returned' | 'not_started' | 'skipped'
export interface TrailStep {
  key: TrailTeam | 'CODE'
  label: string
  state: StepState
  /** The people who act for this step (names). Empty when nobody holds the role. */
  people: string[]
  /** Who decided (done / returned). */
  by: string | null
  /** When it was decided (done / returned). */
  at: string | null
  /** Since when it has been waiting. */
  since: string | null
  remark: string | null
}
export type TrailTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'critical' | 'info'
export interface Trail {
  steps: TrailStep[]
  /** Approvals given, out of the four teams (HR Manager + IT + Admin + Payroll). */
  approved: number
  total: number
  /** "Payroll (Pooja Verma)", "the candidate", "nobody — complete" … */
  nowWith: string
  /** What the table cell says, short. */
  summary: string
  tone: TrailTone
  /** True before the candidate has submitted: there is nothing to approve yet. */
  beforeSubmit: boolean
}

const BEFORE_SUBMIT = new Set(['NOT_INVITED', 'INVITED', 'IN_PROGRESS'])
const latest = (xs: (string | null | undefined)[]): string | null =>
  xs.filter((x): x is string => !!x).sort().slice(-1)[0] || null
const names = (hs?: Holder[] | null) => (hs || []).map(h => h.name).filter(Boolean)

/** "Pooja Verma" · "Pooja Verma, Ravi Rao" · "Pooja Verma +2" */
export function peopleLine(people: string[], max = 2): string {
  if (!people.length) return ''
  if (people.length <= max) return people.join(', ')
  return `${people.slice(0, max).join(', ')} +${people.length - max}`
}

export function approvalTrail(i: TrailInput): Trail {
  const row = (t: TrailTeam) => i.approvals.find(a => String(a.team).toUpperCase() === t) || null
  const created = i.status === 'EMPLOYEE_CREATED'
  const beforeSubmit = BEFORE_SUBMIT.has(i.status)
  const hr = row('HR_MANAGER')
  const hrAccepted = hr?.status === 'APPROVED'
  const returnedRow = TRAIL_TEAMS.map(row).find(r => r?.status === 'RETURNED') || null
  // A return puts the candidate back on the form; the HR Manager's own return is also on hr_review.
  const hrReturned = beforeSubmit && (hr?.status === 'RETURNED' || i.hr_review?.outcome === 'RETURNED')

  const step = (t: TrailTeam): TrailStep => {
    const r = row(t)
    const people = names(i.holders?.[t])
    const base: TrailStep = { key: t, label: TRAIL_LABEL[t], state: 'not_started', people, by: null, at: null, since: null, remark: null }
    if (r?.status === 'APPROVED') return { ...base, state: 'done', by: r.acted_by_name || null, at: r.acted_at || null }
    if (r?.status === 'RETURNED') return { ...base, state: beforeSubmit ? 'returned' : 'not_started', by: r.acted_by_name || null, at: r.acted_at || null, remark: r.remark || null }
    if (t === 'HR_MANAGER') {
      if (hrReturned) return { ...base, state: 'returned', by: i.hr_review?.by_name || null, at: i.hr_review?.at || null, remark: i.hr_review?.note || null }
      if (i.status === 'SUBMITTED') return { ...base, state: 'waiting', since: i.submitted_at || null }
    } else if (hrAccepted && (i.status === 'HR_REVIEW' || i.status === 'SUBMITTED' || i.status === 'APPROVED')) {
      return { ...base, state: 'waiting', since: hr?.acted_at || null }
    }
    // The code was generated without this approval on record (legacy rows, or forced).
    if (created) return { ...base, state: 'skipped' }
    return base
  }

  const steps = TRAIL_TEAMS.map(step)
  const headsDone = HEADS.every(t => steps.find(s => s.key === t)!.state === 'done')
  const codePeople = names(i.holders?.HR_MANAGER)
  const code: TrailStep = created
    ? { key: 'CODE', label: TRAIL_LABEL.CODE, state: 'done', people: codePeople, by: i.role_assignment?.by_name || null, at: i.role_assignment?.at || null, since: null, remark: i.employee_code || null }
    : i.status === 'APPROVED' || (hrAccepted && headsDone)
      ? { key: 'CODE', label: TRAIL_LABEL.CODE, state: 'waiting', people: codePeople, by: null, at: null, since: latest(HEADS.map(t => steps.find(s => s.key === t)!.at)), remark: null }
      : { key: 'CODE', label: TRAIL_LABEL.CODE, state: 'not_started', people: codePeople, by: null, at: null, since: null, remark: null }
  steps.push(code)

  const approved = steps.filter(s => s.key !== 'CODE' && s.state === 'done').length
  const total = TRAIL_TEAMS.length
  const waiting = steps.filter(s => s.state === 'waiting')
  const withWhom = waiting.map(s => s.people.length ? `${SHORT[s.key]} (${peopleLine(s.people)})` : SHORT[s.key]).join(' · ')

  let nowWith: string, summary: string, tone: TrailTone
  if (created) {
    nowWith = 'Nobody — the employee code is generated'
    summary = 'Complete'
    tone = 'positive'
  } else if (beforeSubmit) {
    const back = hrReturned || returnedRow
    nowWith = back ? 'The candidate — returned for corrections' : i.status === 'NOT_INVITED' ? 'HR — the onboarding link is not sent yet' : 'The candidate — filling in the form'
    summary = back ? 'Returned' : 'Not started'
    tone = back ? 'critical' : 'neutral'
  } else {
    nowWith = withWhom || 'Nobody'
    const short = waiting.map(s => SHORT[s.key])
    summary = code.state === 'waiting' ? `${approved}/${total} · code next` : `${approved}/${total} · ${short.length > 2 ? `${short.length} teams` : short.join(', ') || '—'}`
    tone = code.state === 'waiting' ? 'positive' : approved > 0 ? 'info' : 'warning'
  }
  return { steps, approved, total, nowWith, summary, tone, beforeSubmit }
}

// ── Dates, one way everywhere on the onboarding screens: "12 Oct 2026" ──────────────────────

/** "12 Oct 2026" — or "—" for nothing / an unreadable value. */
export function dayLabel(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Whole calendar days from today to `v` (negative = in the past), or null. */
export function daysFromToday(v?: string | null, now: Date = new Date()): number | null {
  if (!v) return null
  const a = new Date(v); if (Number.isNaN(a.getTime())) return null
  a.setHours(0, 0, 0, 0)
  const b = new Date(now); b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/** "today" · "tomorrow" · "in 5 days" · "yesterday" · "13 days ago". */
export function relDays(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}
