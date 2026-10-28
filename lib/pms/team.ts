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
  /** WHO THE FROZEN CHAIN SAYS THE TWO MANAGERS ARE.
   *
   *  Carried because a screen has to know WHICH of the two the viewer is. The
   *  rating upsert keys on (period, employee, goal, rater_role), so writing an
   *  RM L2's rating under 'RM_L1' does not merely mislabel it — it overwrites
   *  the L1's rating. Comparing against these is how the role is decided. */
  rmL1Id?: string | null
  rmL2Id?: string | null
  hodId?: string | null
  /**
   * 197's chain_stage: whose move it is, as opposed to how far the ratings
   * have got. A queue needs both — a set sitting at RM_L2 with an L1 rating
   * already in has the same workflow_status whether it arrived there forward
   * or came back from the HOD, and only one of those needs chasing.
   *
   * Optional because a row written before 197 has no stage at all, and the
   * queue has to keep working for those rather than treating them as
   * unsubmitted.
   */
  chainStage?: string | null
  sentBackTo?: string | null
  sentBackReason?: string | null
  /**
   * Whether the MANAGER's half of the final-review one-to-one is on record.
   *
   * finalReviewDone means BOTH sides acknowledged — which is what pms_finalise
   * requires — and finalReviewLogged means a row exists at all. Neither
   * distinguishes "I have acknowledged and am waiting on them" from "it is my
   * turn", and a queue that cannot tell those apart offers the wrong button.
   */
  finalReviewMgrAcked?: boolean
  /**
   * Has RM L2 confirmed their one-to-one about these KRAs?
   *
   * Its own row, unlike RM L1's: the KRA-setting conversation is one meeting
   * with two acknowledgements, while an L2's review is a separate
   * conversation. The schema has carried manager_role ('RM_L1' | 'RM_L2' |
   * 'HOD') since 066 and nothing had ever written it — every row in the
   * database says RM_L1 because that is the column default — so this is the
   * first thing that can tell the stages apart.
   */
  rmL2ConfirmedOneToOne?: boolean
  /**
   * Are the weightages actually locked — from pms_employee_goals.status, not
   * inferred from the one-to-one.
   *
   * The acknowledgement and the lock are two facts and they come apart: a
   * one-to-one can be doubly acknowledged while pms_lock_kras refused for some
   * other reason (an invalid KRA count, a weightage total that is not 100), in
   * which case the goals are still editable. 199 checks the lock itself, so
   * the screen has to as well or it will promise a finalise the database
   * refuses. Optional: a caller that does not load goal statuses leaves it
   * undefined, and undefined is not treated as "not locked".
   */
  kraLocked?: boolean
  /**
   * Has the result been RELEASED to the employee?
   *
   * Distinct from `finalised`, which only means a rating exists. Between the
   * two sits the whole point of §8: a settled rating nobody has seen yet is
   * still the HOD's to write feedback against, and a published one is not —
   * the employee has read it, so editing the feedback underneath them would
   * change a document they have already been shown.
   */
  published?: boolean
  publishedAt?: string | null
  /** Whether the employee has confirmed they read it. */
  resultAcknowledged?: boolean
  /**
   * Has the FINAL_REVIEW one-to-one been held AND acknowledged by both sides?
   *
   * Only meaningful where the policy sets final_review_one_to_one, which is
   * the default. pms_finalise refuses without it, so a screen that does not
   * ask leaves the HOD pressing a button that cannot work and reading the
   * refusal afterwards. Undefined means the caller did not load it.
   */
  finalReviewDone?: boolean
  /** Has a FINAL_REVIEW one-to-one been logged at all? Distinct from
   *  finalReviewDone, because "nobody has logged it" and "it is logged and
   *  waiting on the manager's tick" need different people to act. */
  finalReviewLogged?: boolean
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
  members: T[], today: string, rules?: FlagRules, chain?: Chain,
): QueueRow<T>[] {
  return members
    .map(m => {
      const flag = m.flagOverride ?? flagFor(m, today, rules)
      const dl = daysToLwd(m, today)
      const next = nextForRm(m, flag, chain)
      return {
        member: m, flag, tone: toneFor(flag), daysLeft: dl,
        actionable: next !== null,
        next: next ?? 'Nothing owed on this one right now.',
        priorityNote: flag === 'NOTICE_PERIOD' && dl !== null
          ? (dl >= 0
              ? `Last working day in ${dl} ${dl === 1 ? 'day' : 'days'}. After it this record locks and the rating can never be given.`
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

/**
 * DOES THIS PERSON'S CHAIN HAVE A SECOND MANAGER RUNG?
 *
 * Asked per employee, because that is where the answer is decided.
 * pms_resolve_chain (067) drops L2 when it resolves to the same person as L1:
 *
 *   -- Same person at L1 and L2: drop L2, keep them as L1 reviewer
 *   IF v_l2 IS NOT NULL AND v_l2 = v_l1 THEN v_l2 := NULL; END IF;
 *
 * So a company whose POLICY chain is SELF_RM1_RM2_HOD still has employees with
 * no L2 at all — which is the ordinary case wherever one manager holds both
 * rungs. Judging by the policy alone leaves those rows waiting on a rating
 * nobody can give: the queue says "with RM L2", the finalise control stays
 * shut, and the cycle cannot complete.
 *
 * The frozen snapshot wins when it is loaded. `undefined` means this caller
 * never selected the column, and then the policy chain is the best answer
 * available — with no chain either, there is nothing to claim is pending.
 * The only production loader (useRoster) always selects it.
 */
export function hasRmL2(m: TeamMember, chain?: Chain): boolean {
  if (m.rmL2Id !== undefined) return m.rmL2Id !== null
  return chain ? blockedByRmL2(chain, false) : false
}

/** The one thing an RM owes on this person, or null when nothing is. */
function nextForRm(m: TeamMember, flag: Flag, chain?: Chain): string | null {
  if (m.finalised) return null
  if (flag === 'NEW_JOINER') return null
  if (m.kraCount === 0) return 'No KRAs written yet. They cannot be rated at all until there are.'
  if (m.totalWeightage !== 100) return `Their weightages total ${m.totalWeightage}, not 100. Send it back before the one-to-one.`
  if (!m.oneToOneDone) return 'Hold the KRA one-to-one and acknowledge it, so the weightage can lock.'
  if (!m.selfSubmitted) return 'Waiting on their self rating. You cannot rate first.'
  if (m.rmL1Score === null) return 'Your rating is owed.'
  // ONLY WHEN THERE IS AN RM L2 TO WAIT FOR — see hasRmL2. This used to say
  // "With RM L2 now" on the strength of rmL2Score being null, which is also
  // true when the chain has no second rung at all, so the row parked there for
  // ever pointing at nobody.
  if (hasRmL2(m, chain) && m.rmL2Score === null) return 'With RM L2 now.'
  return 'Ready to be finalised.'
}

// ── §5.1 the HOD finalisation queue ──────────────────────────────────────

export interface FinaliseRow<T extends TeamMember = TeamMember> extends QueueRow<T> {
  /** Can the finalise control be used at all? */
  canFinalise: boolean
  /**
   * Has everyone BEFORE this actor in the chain finished — self rating, KRA
   * one-to-one, weightage lock, and every occupied rung's score?
   *
   * Separate from canFinalise because it gates a DIFFERENT control: 199
   * refuses an early final-review log with a database exception, so the "Log
   * final review" button has to be withheld on this, while canFinalise also
   * accounts for the final review itself being done.
   */
  precedingDone: boolean
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
  { role, chain, whoCanFinalise, rules, finalReviewRequired = false }: {
    role: Role; chain: Chain; whoCanFinalise: Finaliser; rules?: FlagRules
    /** pms_policies.final_review_one_to_one. Defaults false so existing
     *  callers keep their behaviour; the live screen passes the real value. */
    finalReviewRequired?: boolean
  },
): FinaliseRow<T>[] {
  const allowed = canFinalise(role, whoCanFinalise)
  return teamQueue(members, today, rules, chain).map(r => {
    // THE SAME QUESTION THE QUEUE ASKS, AND IT HAS TO GET THE SAME ANSWER.
    //
    // This asked blockedByRmL2(chain, …) — the POLICY chain — so every
    // employee whose own chain had collapsed to one rung was permanently
    // "waiting on RM L2": finalise disabled, and a HOD told to go nudge
    // somebody the resolver had deliberately removed. Observed live: Arjun
    // Malhotra could not sign off Shreya Singh, whose L1 and L2 are the same
    // person, and the screen's only advice was to chase the rung that is not
    // there. That is the last gate in the cycle, so nothing could complete.
    const waiting = hasRmL2(r.member, chain) && r.member.rmL2Score === null
    /**
     * 200: FINALISING NEEDS THE LOG, NOT THE SIGNATURES.
     *
     * This read finalReviewDone — both sides acknowledged — which is the
     * PUBLICATION gate, not the finalisation one. The spec separates them:
     * §389 has pms_finalise abort "if final review 1-on-1 dialogue logs are
     * missing", while Stage 6 and §230 halt PUBLICATION until the log is
     * "mutually signed off".
     *
     * Conflating them left a HOD waiting on an employee to acknowledge a
     * conversation about a rating that did not exist yet. The employee's
     * acknowledgement still gates the result reaching them — canPublishResult
     * in lib/pms/oneToOne.ts, and trg_pms_publish_needs_signoff in the
     * database — which is the step it actually protects.
     */
    const needsFinalReview = finalReviewRequired && !r.member.finalReviewLogged

    /**
     * 199's PRECEDING-RUNG RULE, mirrored so the screen and the database
     * agree about whose move it is.
     *
     * pms_finalise used to check who was acting and nothing about whether the
     * work before them existed — a HOD could settle a rating with no self
     * rating, unlocked weightages and neither RM having scored, and all 390
     * unfinalised appraisals in the database were exposed to it. 199 closes
     * that in SQL. These lines exist so the control is never OFFERED for
     * something the function will refuse: a button that fails is worse than a
     * button that explains itself.
     *
     * Only rungs somebody OCCUPIES. hasRmL2 already reads the frozen snapshot
     * rather than the policy chain, for the collapsed-line reason above; RM L1
     * gets the same treatment, because a row with no rmL1Id has nobody to wait
     * for and blocking on it would deadlock the record.
     */
    const l1Pending = !!r.member.rmL1Id && r.member.rmL1Score === null
    const kraNotLocked = r.member.kraLocked === false
    let insteadDo: string | null = null
    // ORDER MATTERS, and getting it wrong is not cosmetic. "Nudge RM L2" on a
    // row whose employee has never submitted a self rating sends a HOD to
    // chase the wrong person entirely — RM L2 cannot rate either, because
    // rule 6 blocks them behind the self rating. The most fundamental block
    // has to be the one reported.
    if (r.member.finalised) insteadDo = null
    else if (!allowed) insteadDo = `Your role cannot finalise under this policy. ${whoCanFinalise === 'HOD_ONLY' ? 'The HOD' : 'RM L2 or the HOD'} does.`
    else if (!r.member.selfSubmitted) insteadDo = 'No self rating on record. The chain has not started, so there is nobody downstream to chase yet.'
    // 199's order, exactly: self rating, KRA one-to-one, weightage lock, then
    // each occupied rung in turn. Any other order names a different cause than
    // the database will, and sends somebody to the wrong screen.
    else if (!r.member.oneToOneDone) insteadDo = 'The KRA one-to-one is not acknowledged by both of them yet. Nothing can be settled against weightages that can still move.'
    else if (kraNotLocked) insteadDo = 'Their weightages are not locked yet. Acknowledge the KRA one-to-one to lock them.'
    else if (l1Pending) insteadDo = 'RM L1 has not submitted their rating. Nudge them — finalising now would skip the first rung of the chain.'
    else if (waiting) insteadDo = 'RM L2 has not submitted. Nudge them. Finalising now would skip a step of the chain.'
    // LAST, because pms_finalise checks it last — the screen and the function
    // have to block in the same order or they will name different causes for
    // the same stuck row. Reported up front rather than after a failed press.
    //
    // THIS ONE IS NOW ACTIONABLE, and it was not. 188 refused with "final
    // review one-to-one not logged", and for a long time the only code in the
    // product that could create that row was the employee's own one-to-one
    // form — so a HOD read a true sentence about a gate they had no way to
    // open. Observed on Anil Verma (STC9030): every other condition satisfied,
    // permanently stuck. The Finalise tab now offers "Log final review" on
    // exactly these rows (§2's matrix always permitted it).
    //
    // IT NO LONGER MENTIONS THEIR ACKNOWLEDGEMENT, because 200 established
    // that the signatures gate PUBLICATION and not this step. A sentence here
    // about waiting on the employee would send a HOD to chase somebody whose
    // acknowledgement cannot change what this screen is for.
    else if (needsFinalReview) insteadDo =
      'No final review one-to-one on record. Log it here, or ask them to log '
      + 'it — the conversation has to be on record before the rating is settled.'
    /**
     * Is everyone BEFORE this actor finished? 199's question, and the one that
     * decides whether the final review may even be logged — the trigger it
     * added refuses an early FINAL_REVIEW with an exception, so offering the
     * button before this is true produces a raw database error on screen
     * instead of a sentence.
     */
    const precedingDone = r.member.selfSubmitted && r.member.oneToOneDone
                       && !kraNotLocked && !l1Pending && !waiting

    return {
      ...r,
      // 199's gates added. Without them this said yes to a row with no RM
      // rating at all, and the function would have accepted it.
      canFinalise: allowed && precedingDone && !needsFinalReview
                   && !r.member.finalised,
      precedingDone,
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
