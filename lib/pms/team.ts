// lib/pms/team.ts — the two manager queues. Spec §4.1 and §5.1.
//
// WHY ORDER IS LOGIC AND NOT A SORT DROPDOWN
//
// §8 says notice-period rows get priority in the RM and HOD queues. That is
// not a preference — somebody serving notice has a last working day, and
// after it their record locks permanently and their rating can never be
// given. Everybody else's deadline can slip by a week; theirs cannot. So the
// order is computed, not chosen, and the reason is on the row.
//
// The queue is also where rule 7 bites: a HOD cannot finalise while RM L2 is
// still pending. The finalise control is disabled and replaced by the action
// that actually unblocks it, because a disabled button with no alternative
// leaves somebody stuck looking at it.

import { flagFor, queuePriority, daysToLwd, FLAG_LABEL,
         type Flag, type Employment, type FlagRules } from './employment.ts'
import { canFinalise, blockedByRmL2, type Role, type Chain, type Finaliser } from './hierarchy.ts'

export interface TeamMember extends Employment {
  /**
   * The flag as the DATABASE computed it, when a row carries one.
   *
   * §8 says the flags come from vw_pms_employment_flag, and that view sees
   * columns this client may not have selected — a resignation date it did not
   * ask for, a policy's own cut-off. Where the view has spoken, deriving the
   * flag again from two dates can only disagree with it, and a row that reads
   * ACTIVE on one screen and NOTICE on another is worse than either.
   * Falls back to deriving when the row predates the view.
   */
  flagOverride?: Flag | null
  employeeId: string
  code: string
  name: string
  kraCount: number
  totalWeightage: number
  oneToOneDone: boolean
  selfSubmitted: boolean
  selfScore: number | null
  rmL1Score: number | null
  rmL2Score: number | null
  finalRating: number | null
  finalised: boolean
}

export type RowTone = 'exit' | 'notice' | 'normal'

export interface QueueRow<T extends TeamMember = TeamMember> {
  member: T
  flag: Flag
  tone: RowTone
  /** Days to last working day, when there is one. Negative once past. */
  daysLeft: number | null
  /** Does this row need somebody to do something? */
  actionable: boolean
  /** The single next thing, phrased for the manager reading it. */
  next: string
  /** Why it sits where it sits, when that is not obvious. */
  priorityNote: string | null
}

function toneFor(f: Flag): RowTone {
  return f === 'EXITED' ? 'exit' : f === 'NOTICE_PERIOD' ? 'notice' : 'normal'
}

/**
 * §4.1 — an RM's team, in the order it should be worked.
 *
 * Sort is: employment priority first (notice above active above exited),
 * then whether anything is actually owed, then by name so the list does not
 * reshuffle between renders for no reason.
 */
export function teamQueue<T extends TeamMember>(
  members: T[], today: string, rules?: FlagRules,
): QueueRow<T>[] {
  return members
    .map(m => {
      const flag = m.flagOverride ?? flagFor(m, today, rules)
      const dl = daysToLwd(m, today)
      const next = nextForRm(m, flag)
      return {
        member: m, flag, tone: toneFor(flag), daysLeft: dl,
        actionable: next !== null,
        next: next ?? 'Nothing owed on this one right now.',
        priorityNote: flag === 'NOTICE_PERIOD' && dl !== null
          ? (dl >= 0
              ? `Last working day in ${dl} ${dl === 1 ? 'day' : 'days'} — after it this record locks and the rating can never be given.`
              : 'Last working day has passed. This should already have been rated.')
          : flag === 'EXITED'
            ? 'Already left. Read-only once finalised; the result is emailed before their login closes.'
            : null,
      }
    })
    .sort((a, b) =>
      queuePriority(a.flag) - queuePriority(b.flag) ||
      Number(b.actionable) - Number(a.actionable) ||
      a.member.name.localeCompare(b.member.name))
}

/** The one thing an RM owes on this person, or null when nothing is. */
function nextForRm(m: TeamMember, flag: Flag): string | null {
  if (m.finalised) return null
  if (flag === 'NEW_JOINER') return null
  if (m.kraCount === 0) return 'No KRAs written yet — they cannot be rated at all until there are.'
  if (m.totalWeightage !== 100) return `Their weightages total ${m.totalWeightage}, not 100. Send it back before the one-to-one.`
  if (!m.oneToOneDone) return 'Hold the KRA one-to-one and acknowledge it, so the weightage can lock.'
  if (!m.selfSubmitted) return 'Waiting on their self rating. You cannot rate first.'
  if (m.rmL1Score === null) return 'Your rating is owed.'
  if (m.rmL2Score === null) return 'With RM L2 now.'
  return 'Ready to be finalised.'
}

// ── §5.1 the HOD finalisation queue ──────────────────────────────────────

export interface FinaliseRow<T extends TeamMember = TeamMember> extends QueueRow<T> {
  /** Can the finalise control be used at all? */
  canFinalise: boolean
  /** What to do instead when it cannot. Null when it can. */
  insteadDo: string | null
}

/**
 * §5.1 — the finalisation queue.
 *
 * Two different reasons the control can be shut, and they need different
 * answers on screen:
 *
 *   RM L2 has not submitted   → nudge RM L2. Waiting is the fix.
 *   this role may not finalise → nothing this person can do; say who can.
 *
 * Collapsing both into one greyed-out button is how a queue stalls with
 * nobody knowing whose move it is.
 */
export function finaliseQueue<T extends TeamMember>(
  members: T[], today: string,
  { role, chain, whoCanFinalise, rules }: {
    role: Role; chain: Chain; whoCanFinalise: Finaliser; rules?: FlagRules
  },
): FinaliseRow<T>[] {
  const allowed = canFinalise(role, whoCanFinalise)
  return teamQueue(members, today, rules).map(r => {
    const waiting = blockedByRmL2(chain, r.member.rmL2Score !== null)
    let insteadDo: string | null = null
    // ORDER MATTERS, and getting it wrong is not cosmetic. "Nudge RM L2" on a
    // row whose employee has never submitted a self rating sends a HOD to
    // chase the wrong person entirely — RM L2 cannot rate either, because
    // rule 6 blocks them behind the self rating. The most fundamental block
    // has to be the one reported.
    if (r.member.finalised) insteadDo = null
    else if (!allowed) insteadDo = `Your role cannot finalise under this policy — ${whoCanFinalise === 'HOD_ONLY' ? 'the HOD' : 'RM L2 or the HOD'} does.`
    else if (!r.member.selfSubmitted) insteadDo = 'No self rating on record — the chain has not started, so there is nobody downstream to chase yet.'
    else if (waiting) insteadDo = 'RM L2 has not submitted. Nudge them — finalising now would skip a step of the chain.'
    return {
      ...r,
      canFinalise: allowed && !waiting && !r.member.finalised && r.member.selfSubmitted,
      insteadDo,
    }
  })
}

export interface TeamStats {
  size: number
  pendingWithMe: number
  selfSubmitted: number
  noticePeriod: number
  exited: number
  finalised: number
}

/** §4.1's stat cards. Notice-period count is separated out because it is the
 *  one that changes what a manager does with their afternoon. */
export function teamStats(rows: QueueRow[]): TeamStats {
  return {
    size: rows.length,
    pendingWithMe: rows.filter(r => r.actionable && r.next === 'Your rating is owed.').length,
    selfSubmitted: rows.filter(r => r.member.selfSubmitted).length,
    noticePeriod: rows.filter(r => r.flag === 'NOTICE_PERIOD').length,
    exited: rows.filter(r => r.flag === 'EXITED').length,
    finalised: rows.filter(r => r.member.finalised).length,
  }
}

/** §4.5 and §5.3 — the distribution, stated as information rather than a
 *  target. v2 removed the bell curve: with no payout attached there is
 *  nothing for a forced distribution to ration. */
export function distribution(rows: QueueRow[]): { rating: number; n: number }[] {
  const counts = new Map<number, number>()
  for (const r of rows) {
    const v = r.member.finalRating
    if (v === null) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [5, 4, 3, 2, 1].map(rating => ({ rating, n: counts.get(rating) ?? 0 }))
}

export { FLAG_LABEL }
