'use client'
// components/pms/ManagerTabs.tsx — the RM (L1 and L2) and HOD surfaces.
// Spec §4 and §5.
//
//   RM   Team Dashboard · KRA Approval & One-to-One · Rate My Team
//        PIP Request · Team Analytics
//   HOD  Review & Finalise · Feedback & Recognition · Department Analytics
//
// Both roles share this file because they share the queue: a HOD's
// finalisation list is the same rows an RM rates, ordered by the same rule
// and highlighted by the same flags. Splitting them would mean maintaining
// the exit/notice highlighting twice, and it would drift.
//
// THE ORDERING IS THE FEATURE
//
// §8 puts notice-period rows at the top of both queues. Somebody serving
// notice has a last working day, and after it their record is permanently
// read-only — their rating can never be given. Everyone else's deadline can
// slip; theirs cannot. So the sort is computed in lib/pms/team.ts and the
// reason is printed on the row, rather than left as a colour somebody has to
// know how to read.

import { useState } from 'react'
import './pms.css'
import { teamQueue, finaliseQueue, teamStats, distribution,
         type TeamMember, type QueueRow, type FinaliseRow } from '@/lib/pms/team'
import { FLAG_LABEL, type FlagRules } from '@/lib/pms/employment'
import { canManagerRate, checkFeedback, score, gap, byCategory, bandFor,
         DEFAULT_BANDS, type Band, type Line } from '@/lib/pms/scoring'
import { canPublishResult, CONFIRM_LABEL, CONFIRM_WHY,
         type Log, type ConfirmStage } from '@/lib/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Role, type Chain, type Finaliser }
  from '@/lib/pms/hierarchy'
import { approvalFinalises, mayReject, rejectDestination, remarkOk, MIN_REMARK,
         rungFor, heldBy } from '@/lib/pms/chain'
import { humanDate } from '@/lib/pms/cycle'
import { DEFAULT_RULES, type Rules } from '@/lib/pms/cycle'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'published' | 'deptAnalytics'

export const MGR_TABS: { k: MgrTab; label: string; blurb: string }[] = [
  { k: 'team',      label: 'Team Dashboard',           blurb: 'who is where, worst deadline first' },
  { k: 'approve',   label: 'KRA Approval & One-to-One',blurb: 'check their sets, then log the discussion' },
  { k: 'rate',      label: 'Rate My Team',             blurb: 'rate each KRA against what they delivered' },
  { k: 'pip',       label: 'PIP Request',              blurb: 'raise one, and HR decides whether it starts' },
  { k: 'analytics', label: 'Team Analytics',           blurb: 'distribution and gaps, for information' },
]

export const HOD_TABS: { k: HodTab; label: string; blurb: string }[] = [
  { k: 'finalise',      label: 'Review & Finalise',     blurb: 'sign off, exit and notice cases first' },
  { k: 'feedback',      label: 'Feedback & Recognition',blurb: 'what they read, and what they receive' },
  { k: 'published',     label: 'Published Results',     blurb: 'released and settled — your department\'s record, read-only' },
  { k: 'deptAnalytics', label: 'Department Analytics',  blurb: 'the department against the company' },
]

// ── shared ───────────────────────────────────────────────────────────────

function Card({ title, sub, children }: {
  title?: string; sub?: string; children: React.ReactNode
}) {
  return (
    <div className="card">
      {title && <h3>{title}</h3>}
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  )
}

function Stat({ label, value, note, tone }: {
  label: string; value: React.ReactNode; note?: string; tone?: 'accent' | 'warn'
}) {
  return (
    <div className={tone === 'accent' ? 'stat accent' : tone === 'warn' ? 'stat warn' : 'stat'}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
}

/** The employment pill, with the LWD spelled out. A colour alone tells
 *  somebody a row is different, never that a date is about to pass. */
function FlagPill({ r }: { r: QueueRow }) {
  if (r.flag === 'EXITED') {
    return <span className="pill p-orange">
      {FLAG_LABEL.EXITED}{r.member.dateOfLeaving ? ` · ${humanDate(r.member.dateOfLeaving)}` : ''}
    </span>
  }
  if (r.flag === 'NOTICE_PERIOD') {
    return <span className="pill p-amber">
      Notice{r.member.dateOfLeaving ? ` · last day ${humanDate(r.member.dateOfLeaving)}` : ''}
    </span>
  }
  if (r.flag === 'NEW_JOINER') return <span className="pill p-blue">{FLAG_LABEL.NEW_JOINER}</span>
  return <span className="pill p-green">{FLAG_LABEL.ACTIVE}</span>
}

function ExitBanner({ rows }: { rows: QueueRow[] }) {
  const notice = rows.filter(r => r.flag === 'NOTICE_PERIOD').length
  const exited = rows.filter(r => r.flag === 'EXITED').length
  if (!notice && !exited) return null
  return (
    <div className="banner b-amber">
      <span aria-hidden="true">🔶</span>
      <div>
        {/* Each clause has to finish its own thought. Concatenating the two
            counts and then appending the generic notice-period sentence read
            as though that sentence described the people who had already left. */}
        {notice > 0 && (
          <><b>{notice} {notice === 1 ? 'person is' : 'people are'} serving notice</b>:
          rate them before their last working day, after which the record locks and
          the rating can never be given.{exited > 0 ? ' ' : ''}</>
        )}
        {exited > 0 && (
          <><b>{exited} {exited === 1 ? 'has' : 'have'} already left</b>: still
          finalisable, but read-only once done, and the result is emailed before
          their login closes.</>
        )}
      </div>
    </div>
  )
}

function QueueTable({ rows, extraHead, extraCell, empty, rules = DEFAULT_RULES }: {
  rows: QueueRow[]
  extraHead?: React.ReactNode
  extraCell?: (r: QueueRow) => React.ReactNode
  empty: string
  /** Only used to colour the weightage cell, but it still has to be the
   *  POLICY's total: on a policy with total_weightage 80, a correct set would
   *  otherwise render red against the hardcoded 100. */
  rules?: Rules
}) {
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Employee</th><th>Employment</th>
            <th className="num">KRAs</th><th className="num">Wt</th>
            <th>1-on-1</th><th>Self</th><th className="num">Self score</th>
            <th>What is owed</th>
            {extraHead}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={extraHead ? 10 : 9}
                    style={{ textAlign: 'center', padding: '22px 14px' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Nobody here yet</div>
              <div className="k">{empty}</div>
            </td></tr>
          ) : rows.map(r => (
            <tr key={r.member.employeeId}
                className={r.tone === 'exit' ? 'exitrow' : r.tone === 'notice' ? 'noticerow' : undefined}>
              <td>{r.member.code}</td>
              <td style={{ fontWeight: 600 }}>{r.member.name}</td>
              <td><FlagPill r={r} /></td>
              <td className="num">{r.member.kraCount}</td>
              <td className="num">
                <span className={r.member.totalWeightage === rules.totalWeightage ? 'ok' : 'bad'}>
                  {r.member.totalWeightage}
                </span>
              </td>
              <td>{r.member.oneToOneDone
                ? <span className="pill p-green">✓</span>
                : <span className="pill p-grey">not yet</span>}</td>
              <td>{r.member.selfSubmitted
                ? <span className="pill p-green">submitted</span>
                : <span className="pill p-amber">waiting</span>}</td>
              <td className="num">{r.member.selfScore === null ? '-' : r.member.selfScore.toFixed(2)}</td>
              <td className="k">
                {r.next}
                {r.priorityNote && <><br /><b>{r.priorityNote}</b></>}
              </td>
              {extraCell?.(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const EMPTY_TEAM =
  'Nobody reports to you in the org data for this period, or migration 066 has not been applied yet.'

// ── §4.1 Team Dashboard ──────────────────────────────────────────────────

export function TeamTab({ members, today, managerName, rules = DEFAULT_RULES, flagRules}: {
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  /** The policy's KRA rules, not the constant — a manager must be shown the
   *  same thresholds the employee was held to. */
  rules?: Rules
  members: TeamMember[]; today: string; managerName: string
}) {
  const rows = teamQueue(members, today, flagRules)
  const s = teamStats(rows)
  return (
    <>
      <ExitBanner rows={rows} />
      <div className="grid g5" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Your rating is owed" value={s.pendingWithMe}
              note={s.pendingWithMe ? 'Nobody else can do these' : 'Nothing waiting on you'} />
        <Stat label="Team size" value={s.size} />
        <Stat label="Self ratings in" value={`${s.selfSubmitted} of ${s.size}`}
              note="You cannot rate before they submit" />
        <Stat tone={s.noticePeriod ? 'warn' : undefined} label="Serving notice"
              value={s.noticePeriod}
              note={s.noticePeriod ? 'Rate before their last day' : 'None'} />
        <Stat label="Finalised" value={s.finalised} note={`of ${s.size}`} />
      </div>
      <Card title={`My team: ${managerName}`}
            sub="Ordered by whose deadline cannot move, then by what is actually owed.">
        <QueueTable rules={rules} rows={rows} empty={EMPTY_TEAM} />
      </Card>
    </>
  )
}

// ── §4.2 KRA Approval & One-to-One ───────────────────────────────────────

/**
 * §(none) — the approval chain, asked for directly.
 *
 * ONE CARD, NOT A TAB. The sets waiting on this manager's approval belong
 * beside the sets waiting on their one-to-one: both answer "what is sitting
 * with me", and splitting them across tabs means a manager who clears one
 * screen believes they are done.
 *
 * WHY THE RATING INPUT APPEARS ON ONLY ONE RUNG. Approving at the last rung
 * before HR does not pass the appraisal on, it FINALISES it — pms_chain_approve
 * calls pms_finalise in the same statement and refuses without a number. Every
 * other rung is passing it up, where asking for a rating would invite a manager
 * to set a final figure they have no authority to set. So the button changes
 * its name and grows a field exactly where the consequence changes.
 *
 * WHY THE REJECT BUTTON NAMES ITS DESTINATION. "Reject" reads the same to an
 * RM L2 whose rejection reaches RM L1 and to an RM L1 whose rejection reaches
 * the employee, and those are different decisions. The rejecter sees which one
 * they are making before they type the remark, not after.
 */
function ChainApprovals({ members, today, flagRules, rules, viewerId, chain,
                          onApprove, onReject, onOpenKras, bands }: {
  members: TeamMember[]; today: string
  flagRules?: FlagRules
  rules: Rules
  /** The VIEWER's employee id. Their rung is worked out per row — see
   *  rungFor. Empty means nothing renders. */
  viewerId: string
  /** The policy's chain, which decides which rung finalises. */
  chain: Chain
  onApprove?: (id: string, rating?: number) => void
  onReject?: (id: string, remark: string) => void
  /** Open the employee's filled KRA form. See KraDetail. */
  onOpenKras?: (id: string) => void
  bands?: Band[]
}) {
  const [remark, setRemark] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<Record<string, boolean>>({})
  /**
   * THE ONE-TO-ONE TICK, per row.
   *
   * Requested: a mandatory checkbox at every stage confirming the discussion
   * happened, which records the log when it is ticked. Per row and not per
   * screen — a manager clears a queue of eight people and the confirmation is
   * about one of them.
   *
   * Not needed to REJECT. Sending a set back with a remark is not a claim that
   * a conversation happened, and demanding one would stop a manager returning
   * an obviously wrong set until they had held a meeting about it.
   */
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})

  // Only what is actually with this person, on the rung they hold for THAT
  // employee. A manager holding RM_L1 must not be offered an approval on a set
  // that has moved up to RM_L2 — the RPC would refuse it, but offering it at
  // all suggests the queue is theirs to clear.
  const rows = teamQueue(members, today, flagRules)
    .filter(r => r.member.chainStage
              && r.member.chainStage === rungFor(r.member, viewerId))

  if (!viewerId || !rows.length) return null

  return (
    <Card title="Waiting on your approval"
          sub="Sets that have reached your rung. Approving passes them up the chain; the last rung settles the rating.">
      <QueueTable
        rules={rules}
        rows={rows}
        empty="Nothing is with you for approval."
        extraHead={<th>Approval</th>}
        extraCell={r => {
          const id = r.member.employeeId
          const myStage = rungFor(r.member, viewerId)!
          // The HOLDERS, not just the policy's chain. On a collapsed line
          // (190 of 395 enrolments) RM L2 is unfilled, so an RM L1's approval
          // finalises rather than passing the set up — and the button has to
          // say so and ask for the rating the database will demand.
          const held = heldBy(r.member)
          const finalises = approvalFinalises(chain, myStage, held)
          const canReject = mayReject(myStage)
          // Already on record: RM L1's tick completes the KRA one-to-one the
          // employee started, so for them "confirmed" means the row carries
          // the manager's half. The later rungs have their own rows.
          const alreadyConfirmed = myStage === 'RM_L1'
            ? r.member.oneToOneDone === true
            : myStage === 'HOD' ? r.member.finalReviewMgrAcked === true
            : r.member.rmL2ConfirmedOneToOne === true
          const mayApprove = alreadyConfirmed || !!confirmed[id]
          const rk = remark[id] ?? ''

          if (rejecting[id]) {
            return (
              <td>
                <div style={{ display: 'grid', gap: 4, width: 230, maxWidth: '100%' }}>
                  <div className="k">
                    This goes <b>{rejectDestination(chain, myStage, held)}</b>.
                  </div>
                  <input placeholder="What has to change, in a sentence"
                         aria-label={`Reason for rejecting ${r.member.name}'s appraisal`}
                         value={rk}
                         onChange={e => setRemark(p => ({ ...p, [id]: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn ghost sm" type="button"
                            disabled={!onReject || !remarkOk(rk)}
                            onClick={() => { onReject?.(id, rk)
                                             setRejecting(p => ({ ...p, [id]: false })) }}>
                      Confirm rejection
                    </button>
                    <button className="btn ghost sm" type="button"
                            onClick={() => setRejecting(p => ({ ...p, [id]: false }))}>
                      Cancel
                    </button>
                  </div>
                  {!remarkOk(rk) && (
                    <div className="k">
                      At least {MIN_REMARK} characters. The database refuses a
                      rejection without a reason.
                    </div>
                  )}
                </div>
              </td>
            )
          }

          return (
            <td>
              <div style={{ display: 'grid', gap: 5, width: 200, maxWidth: '100%' }}>
                {/* APPROVING MOVED INTO THE PANEL. It needs this rater's
                    score on every KRA — 199 will not let the next rung settle
                    anything without it — and a per-KRA rating cannot live in
                    a table cell. Rejecting stays here: it needs a remark, not
                    ratings, and a manager returning an obviously wrong set
                    should not have to score it first. */}
                <button className="btn sm" type="button"
                        disabled={!onOpenKras}
                        onClick={() => onOpenKras?.(id)}>
                  {alreadyConfirmed ? 'Review & send on' : 'Review, rate & approve'}
                </button>
                <div style={{ display: 'flex', gap: 4 }}>
                  {canReject && (
                    <button className="btn ghost sm" type="button"
                            disabled={!onReject}
                            onClick={() => setRejecting(p => ({ ...p, [id]: true }))}>
                      Reject
                    </button>
                  )}
                </div>
              </div>
            </td>
          )
        }} />
      <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
        A rejection goes back one rung, never straight to the employee from
        halfway up — and it needs a reason, which they see. You can change their
        KRAs or ratings before approving; every change is logged against your
        name.
      </div>
    </Card>
  )
}

export function ApproveTab({ members, today, onSendBack, onAcknowledge,
                             onAcknowledgeFinalReview, rules = DEFAULT_RULES, flagRules,
                             viewerId = '', chain = 'SELF_RM1_RM2_HOD',
                             onApprove, onOpenKras, kraDetail, bands}: {
  /** The viewer's id and the policy's chain — see ChainApprovals. Defaulted so
   *  a call site that has not been updated renders the tab without the
   *  approval card rather than crashing. */
  viewerId?: string
  chain?: Chain
  onApprove?: (id: string, rating?: number) => void
  /** Open and render the employee's filled KRA form. The panel is rendered by
   *  the parent so one loader serves every surface that wants it. */
  onOpenKras?: (id: string) => void
  kraDetail?: React.ReactNode
  bands?: Band[]
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  /** The policy's KRA rules, not the constant — a manager must be shown the
   *  same thresholds the employee was held to. */
  rules?: Rules
  members: TeamMember[]; today: string
  onSendBack?: (id: string, reason: string) => void
  onAcknowledge?: (id: string) => void
  /** The second tick on a FINAL_REVIEW discussion. Without it pms_finalise
   *  refuses and the cycle cannot be closed. */
  onAcknowledgeFinalReview?: (id: string) => void
}) {
  const [reason, setReason] = useState<Record<string, string>>({})
  const rows = teamQueue(members, today, flagRules)
    .filter(r => !r.member.selfSubmitted || !r.member.oneToOneDone)
  // Logged by the employee, still waiting on this manager's half. Not merged
  // into the card above: that one is about getting a KRA set locked before
  // the period runs, this one is the last thing standing between a rated
  // employee and a settled rating. Same table, opposite ends of the cycle.
  const finalRows = teamQueue(members, today, flagRules)
    .filter(r => r.member.finalReviewLogged && !r.member.finalReviewDone)

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          A set is valid at <b>{rules.minKra} to {rules.maxKra} KRAs
          totalling exactly {rules.totalWeightage}</b>. Weightage locks only once
          you and they have both acknowledged the KRA one-to-one. One tick is a manager
          asserting a conversation happened, two is a record.
        </div>
      </div>
      {/* First, because it is the only card here with a consequence that
          cannot be undone: approving at the last rung settles the rating. */}
      <ChainApprovals members={members} today={today} flagRules={flagRules}
                      rules={rules} viewerId={viewerId} chain={chain}
                      onApprove={onApprove} onReject={onSendBack}
                      onOpenKras={onOpenKras} bands={bands} />
      {kraDetail}
      <Card title="Waiting on the discussion"
            sub="Sets to check, and the one-to-ones that lock them.">
        <QueueTable
          rules={rules}
          rows={rows}
          empty="Every set is settled and locked."
          extraHead={<th>Action</th>}
          extraCell={r => {
            const valid = r.member.kraCount >= rules.minKra
                       && r.member.kraCount <= rules.maxKra
                       && r.member.totalWeightage === rules.totalWeightage
            return (
              <td>
                {!valid ? (
                  <div style={{ display: 'grid', gap: 5, width: 200, maxWidth: '100%' }}>
                    <input placeholder="What they need to change"
                           aria-label={`Reason for sending ${r.member.name}'s KRAs back`}
                           value={reason[r.member.employeeId] ?? ''}
                           onChange={e => setReason(p => ({ ...p, [r.member.employeeId]: e.target.value }))} />
                    <button className="btn ghost sm" type="button"
                            disabled={!onSendBack || !(reason[r.member.employeeId] ?? '').trim()}
                            onClick={() => onSendBack?.(r.member.employeeId, reason[r.member.employeeId])}>
                      Send back
                    </button>
                  </div>
                ) : !r.member.oneToOneDone ? (
                  <button className="btn sm" type="button" disabled={!onAcknowledge}
                          onClick={() => onAcknowledge?.(r.member.employeeId)}>
                    Acknowledge &amp; lock
                  </button>
                ) : <span className="pill p-green">locked</span>}
              </td>
            )
          }} />
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Sending a set back needs a reason. &ldquo;Rejected&rdquo; on its own means the
          employee guesses at what to change, and the set comes back wrong a second time.
        </div>
      </Card>
      {finalRows.length > 0 && (
        <Card title="Final review one-to-ones waiting on you"
              sub="They have logged the conversation. The rating cannot be settled until you confirm it happened.">
          <QueueTable
            rules={rules}
            rows={finalRows}
            empty="None waiting."
            extraHead={<th>Action</th>}
            extraCell={r => (
              <td>
                <button className="btn sm" type="button" disabled={!onAcknowledgeFinalReview}
                        onClick={() => onAcknowledgeFinalReview?.(r.member.employeeId)}>
                  Acknowledge
                </button>
              </td>
            )} />
          <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Where the policy asks for a final review, the HOD cannot finalise without
            both ticks. This is the last thing owed before the result exists.
          </div>
        </Card>
      )}
    </>
  )
}

// ── the form the employee actually filled ────────────────────────────────

/**
 * Text that must break rather than push its container.
 *
 * MEASURED, not guessed. At 1432px the detail panel is clean; below 700px it
 * gives way, and at 360px the panel escapes its container by 160px. Every
 * offender was the same thing — a long UNBROKEN token with the default
 * overflow-wrap: normal, which has nowhere legal to break:
 *
 *   a snake_case KRA title   Reconciliation_automation_programme_phase_two…
 *   a camelCase KPI          ReconciliationBreaksClosedWithinSLAPercentage…
 *   a URL in the achievement https://internal.example.com/reports/…
 *
 * None of those are contrived. The live rows top out at 48 characters WITH
 * spaces, which is why this did not show on real data at desktop width — and
 * an employee pasting a dashboard link into "what I delivered" is an ordinary
 * thing to do.
 *
 * `anywhere` rather than `break-word`: break-word will not shrink an element's
 * intrinsic minimum, so a flex or grid child still pushes its parent. minWidth
 * 0 is the other half — without it a flex child refuses to shrink below its
 * content regardless of how the text wraps.
 */
const BREAK = { overflowWrap: 'anywhere' as const, minWidth: 0 }

export interface KraLine {
  /**
   * The goal's own id. pms_reviews is UNIQUE on
   * (period, employee, goal, rater_role), so a rating cannot be written
   * without it — seq_no identifies the row to a human, not to the table.
   */
  goalId?: string
  seqNo: number
  title: string
  kpi?: string | null
  target?: string | null
  category?: string | null
  weightage: number
  status?: string | null
  source?: string | null
  /** What the employee said they delivered, and how they rated it. */
  achievement?: string | null
  selfRating?: number | null
  selfComment?: string | null
}

/**
 * §(none) — requested: "there should be a detailed view of kra form filled by
 * employee to l1, l2 and hod on clicking it".
 *
 * WHY THE QUEUES WERE NOT ENOUGH. Every manager surface showed COUNTS — four
 * KRAs, weightage 100, self score 3.55 — and the only place the actual text
 * appeared was Rate My Team, which an L2 and a HOD do not use for approving.
 * So the people deciding whether to approve a set could see that it totalled
 * 100 and not what was in it. A chain that can reject with a remark is worth
 * little if the rejecter cannot read what they are rejecting.
 *
 * READ-ONLY, deliberately. Editing a reportee's KRA is a different act with
 * different consequences — it changes what somebody is measured against after
 * they agreed it — and it belongs behind its own control, not inside a view
 * opened to have a look. The chain's edit path is the send-back with a remark.
 */
export function KraDetail({ member, lines, loading, onClose,
                            myRung, rate, onRate, bands = DEFAULT_BANDS,
                            confirmed, onConfirm, alreadyConfirmed,
                            finalises, finalRating, onFinalRating,
                            onApprove, saving }: {
  member: TeamMember
  lines: KraLine[] | null
  loading?: boolean
  onClose?: () => void
  /**
   * WHICH RUNG THE VIEWER HOLDS. Absent means they are only reading — the
   * panel stays the read-only record it started as, which is what HR and a
   * manager looking at somebody else's reportee get.
   */
  myRung?: ConfirmStage | null
  /** This rater's rating and comment per KRA, keyed on goalId. */
  rate?: Record<string, { rating: number | null; comment: string }>
  onRate?: (goalId: string, patch: { rating?: number | null; comment?: string }) => void
  bands?: Band[]
  confirmed?: boolean
  onConfirm?: (v: boolean) => void
  alreadyConfirmed?: boolean
  /** Whether approving here settles the rating rather than passing it on. */
  finalises?: boolean
  /** The overall final rating, held by the caller so it survives a reload of
   *  the lines. Only meaningful when `finalises`. */
  finalRating?: string
  onFinalRating?: (v: string) => void
  /** Rate, confirm and approve, in one act. The final rating is passed only
   *  at the rung that finalises. */
  onApprove?: (finalRating?: number) => void
  saving?: boolean
}) {
  const total = (lines ?? []).reduce((s, l) => s + (Number(l.weightage) || 0), 0)
  const rated = (lines ?? []).filter(l => l.selfRating != null).length

  return (
    <Card title={`${member.name} — ${member.code}`}
          sub={`The KRA form as they filled it. ${lines?.length ?? 0} KRAs, weightage ${total}, ${rated} self-rated.`}>
      {loading || lines === null ? <div className="k">Loading their form…</div>
        : !lines.length ? (
          <div style={{ padding: '18px 14px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing written yet</div>
            <div className="k">They have not saved any KRAs for this period.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {lines.map(l => (
              <div key={l.seqNo} className="card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline',
                              flexWrap: 'wrap', marginBottom: 6 }}>
                  <b style={BREAK}>{l.seqNo}. {l.title || <span className="k">untitled</span>}</b>
                  <span className="pill p-brand">{l.weightage}%</span>
                  {l.category && <span className="pill p-grey">{l.category.toLowerCase()}</span>}
                  {l.status && <span className={`pill ${l.status === 'LOCKED' ? 'p-green' : 'p-amber'}`}>
                    {l.status.replace(/_/g, ' ').toLowerCase()}
                  </span>}
                  {/* CARRIED_FORWARD is worth surfacing: a set that is last
                      quarter's, unchanged, is a different thing to approve
                      than one written fresh. */}
                  {l.source === 'CARRIED_FORWARD' &&
                    <span className="pill p-blue">carried forward</span>}
                </div>
                <div className="grid g2" style={{ gap: 8 }}>
                  <div>
                    <div className="lbl">How it is measured</div>
                    <div className="k" style={BREAK}>{l.kpi || '—'}</div>
                  </div>
                  <div>
                    <div className="lbl">Target</div>
                    <div className="k" style={BREAK}>{l.target || '—'}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="lbl">What they say they delivered</div>
                  <div className="k" style={BREAK}>{l.achievement || <i>Nothing recorded.</i>}</div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 10,
                              alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div className="lbl" style={{ margin: 0 }}>Their rating</div>
                  {l.selfRating == null
                    ? <span className="k">not rated</span>
                    : <b>{l.selfRating}</b>}
                  {l.selfComment && <span className="k" style={BREAK}>— {l.selfComment}</span>}
                </div>

                {/* YOUR RATING, ON THE SAME SCREEN AS THE APPROVAL.
                    Rating and approving used to be two tabs, and the chain
                    then stalled on its own rule: 199 will not let the HOD
                    settle a rating until every rung ahead has rated, so a
                    manager who approved without visiting Rate My Team passed
                    the set up and blocked it there. Reading the KRA, scoring
                    it and approving are one judgement, so they are one
                    screen. */}
                {myRung && onRate && l.goalId && (
                  <div style={{ marginTop: 10, paddingTop: 10,
                                borderTop: '1px solid var(--ez-line)' }}>
                    <div className="lbl">Your rating</div>
                    <div className="chips" role="radiogroup"
                         aria-label={`Your rating for ${l.title}`}>
                      {bands.map(bd => {
                        const on = rate?.[l.goalId!]?.rating === bd.value
                        return (
                          <button key={bd.value} type="button" role="radio"
                                  aria-checked={on} className={on ? 'chip sel' : 'chip'}
                                  title={bd.label}
                                  onClick={() => onRate(l.goalId!, { rating: bd.value })}>
                            {bd.value}
                          </button>
                        )
                      })}
                    </div>
                    <input style={{ marginTop: 6 }}
                           placeholder="A line on why — they will read this."
                           value={rate?.[l.goalId!]?.comment ?? ''}
                           onChange={e => onRate(l.goalId!, { comment: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {/* THE TICK AND THE APPROVAL, under the thing they are about. A manager
          who has just read and scored every KRA is in the right place to say
          the conversation happened and send it on; making them go back to a
          queue to do it is how the two came apart in the first place. */}
      {myRung && onApprove && (
        <>
          {onConfirm && (
            <label className="checkline" style={{ marginTop: 14 }}
                   title={CONFIRM_LABEL[myRung]}>
              <input type="checkbox"
                     checked={alreadyConfirmed || !!confirmed}
                     disabled={alreadyConfirmed}
                     onChange={e => onConfirm(e.target.checked)} />
              <div>
                <b>{CONFIRM_LABEL[myRung]}</b>
                <div className="k" style={{ marginTop: 3 }}>{CONFIRM_WHY[myRung]}</div>
              </div>
            </label>
          )}

          {(() => {
            const rated = (lines ?? []).filter(l => l.goalId && rate?.[l.goalId]?.rating != null)
            const total = (lines ?? []).length
            const allRated = total > 0 && rated.length === total
            const ticked = alreadyConfirmed || !!confirmed
            // THE FINAL RATING, only at the rung that settles it. pms_finalise
            // takes it explicitly — docx Stage 6 has the finaliser submit it —
            // so it is a judgement, not the per-KRA average. It is offered
            // here rather than in the queue because it is made after reading
            // and scoring every KRA, which is what this panel is.
            const lo = bands.length ? Math.min(...bands.map(x => x.value)) : 1
            const hi = bands.length ? Math.max(...bands.map(x => x.value)) : 5
            const fr = finalRating === '' ? null : Number(finalRating)
            const frOk = !finalises || (fr !== null && fr >= lo && fr <= hi)
            const ready = allRated && ticked && frOk
            return (
              <>
                {!ready && (
                  <div className="banner b-amber" style={{ marginTop: 12 }}>
                    <span aria-hidden="true">!</span>
                    <div>
                      <b>Before this can go on:</b>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                        {!allRated && (
                          <li>Rate every KRA — {rated.length} of {total} done. The
                            next rung cannot settle anything until yours are in.</li>
                        )}
                        {!ticked && <li>Confirm the one-to-one above.</li>}
                        {!frOk && <li>Give the final rating ({lo}&ndash;{hi}).
                          Yours is the last approval, so this is the number
                          they are told.</li>}
                      </ul>
                    </div>
                  </div>
                )}
                {finalises && (
                  <div className="fld" style={{ maxWidth: 260, marginTop: 12 }}>
                    <label htmlFor="pf-final">Final rating</label>
                    <select id="pf-final" value={finalRating ?? ''}
                            onChange={e => onFinalRating?.(e.target.value)}>
                      <option value="">Choose…</option>
                      {bands.map(bd => (
                        <option key={bd.value} value={bd.value}>
                          {bd.value} · {bd.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="btnrow">
                  <button className="btn" type="button" disabled={!ready || saving}
                          onClick={() => onApprove(finalises ? fr ?? undefined : undefined)}>
                    {saving ? 'Sending…'
                      : !ready ? 'Not ready to send on'
                      : finalises ? 'Rate, confirm and finalise'
                      : 'Rate, confirm and approve'}
                  </button>
                  {onClose && (
                    <button className="btn ghost" type="button" onClick={onClose}>Close</button>
                  )}
                </div>
              </>
            )
          })()}
        </>
      )}

      {!(myRung && onApprove) && onClose && (
        <div className="btnrow">
          <button className="btn ghost sm" type="button" onClick={onClose}>Close</button>
        </div>
      )}
    </Card>
  )
}

// ── §4.3 Rate My Team ────────────────────────────────────────────────────

export interface RateRow {
  goalId: string; title: string; category: Line['category']; weightage: number
  achievement: string; selfRating: number | null; selfComment: string
  myRating: number | null; myComment: string
}

export function RateTab({ member, rows, onChange, onSubmit, saving, overallComment,
                          onOverallComment, bands = DEFAULT_BANDS, members, onPick, today, rules = DEFAULT_RULES, flagRules}: {
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  /** Passed to QueueTable so the weightage column is coloured against the
   *  policy's total rather than a hardcoded 100. */
  rules?: Rules
  member: TeamMember | null
  rows: RateRow[]
  onChange: (next: RateRow[]) => void
  onSubmit: () => void
  saving?: boolean
  overallComment: string
  onOverallComment: (s: string) => void
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
  /** THE TAB CHOOSES ITS OWN SUBJECT. It used to say "choose a team member
   *  from the dashboard" and the dashboard had nothing to click, so this tab
   *  could never show anybody. Given the roster it asks here instead. */
  members?: TeamMember[]
  onPick?: (employeeId: string) => void
  today?: string
}) {
  if (!member) {
    // The same queue the Team Dashboard shows, with one column added, rather
    // than a second table that could drift from it — exit and notice rows stay
    // highlighted and pinned here too.
    const pickable = members && today ? teamQueue(members, today, flagRules) : []
    return (
      <Card title="Who are you rating?"
            sub="Their KRAs and their own ratings appear beside yours once you choose.">
        {!onPick
          ? <div className="k">Picking is not available on this screen.</div>
          : <QueueTable
              rules={rules}
              rows={pickable}
              empty="Nobody is with you yet. A rating opens once their weightages are locked and they have submitted their own rating."
              extraHead={<th />}
              extraCell={r => (
                <td>
                  {/* A SETTLED RATING IS NOT A RATING TASK. This offered "Rate"
                      on finalised rows beside the words "Nothing owed on this
                      one right now", and the screen behind it accepted the
                      submission — which recomputes the RM score the employee
                      may already have been shown. Observed live on a published
                      appraisal. The row says what it is instead. */}
                  {r.member.finalised ? (
                    <span className="pill p-green" title="Finalised. Ask HR to reopen the period if it has to change.">
                      settled
                    </span>
                  ) : (
                    <button type="button" className="btn sm"
                            onClick={() => onPick(r.member.employeeId)}
                            title={r.member.selfSubmitted
                              ? `Rate ${r.member.name}`
                              : `Open ${r.member.name} — they have not submitted their own rating yet`}>
                      {r.member.selfSubmitted ? 'Rate' : 'Open'}
                    </button>
                  )}
                </td>
              )} />}
      </Card>
    )
  }

  const canRate = canManagerRate(member.selfSubmitted)
  const lines: Line[] = rows.map(r => ({
    goalId: r.goalId, title: r.title, category: r.category,
    weightage: r.weightage, self: r.selfRating, final: r.myRating,
  }))
  const mine = score(lines, 'final')
  const theirs = score(lines, 'self')
  const g = gap(theirs, mine)
  const unrated = rows.filter(r => r.myRating === null).length
  const band = bandFor(mine === null ? null : Math.round(mine), bands)
  const fb = checkFeedback(mine === null ? null : Math.round(mine),
                           { appreciation: overallComment }, bands)

  const set = (i: number, patch: Partial<RateRow>) =>
    onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))

  if (!canRate.open) {
    return (
      <Card title={`${member.name}: not yet`}>
        <div className="banner b-amber" style={{ marginBottom: 0 }}>
          <span aria-hidden="true">⏳</span><div>{canRate.because}</div>
        </div>
      </Card>
    )
  }

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Rating" value={`${member.name}`} note={member.code} />
        <Stat label="They rated themselves" value={theirs === null ? '-' : theirs.toFixed(2)} />
        <Stat label="Your score so far" value={mine === null ? '-' : mine.toFixed(2)}
              note={band ? band.label : `${unrated} still unrated`} />
        <Stat tone={g.flag === 'MAJOR_GAP' ? 'warn' : undefined}
              label="Difference" value={g.delta === null ? '-' : g.delta.toFixed(2)}
              note={g.flag === 'MAJOR_GAP' ? 'Worth raising with them' : ''} />
      </div>

      <Card title="Rate each KRA"
            sub="Their achievement and their own rating are shown so you are rating the same thing they did.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>KRA</th><th className="num">Wt</th><th>What they delivered</th>
                <th className="num">Theirs</th><th>Yours</th><th>Your comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rg = gap(r.selfRating, r.myRating)
                return (
                  <tr key={r.goalId}>
                    <td style={{ fontWeight: 600 }}>{r.title}</td>
                    <td className="num">{r.weightage}</td>
                    <td>
                      {r.achievement || <span className="k">nothing written</span>}
                      {r.selfComment && <div className="k">{r.selfComment}</div>}
                    </td>
                    <td className="num">
                      {r.selfRating ?? '-'}
                      {rg.flag === 'MAJOR_GAP' && <span className="pill p-amber" style={{ marginLeft: 4 }}>gap</span>}
                    </td>
                    <td>
                      <div className="chips" role="radiogroup" aria-label={`Your rating for ${r.title}`}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} type="button" role="radio" aria-checked={r.myRating === n}
                                  className={r.myRating === n ? 'chip sel' : 'chip'}
                                  title={bandFor(n, bands)?.label}
                                  onClick={() => set(i, { myRating: n })}>{n}</button>
                        ))}
                      </div>
                    </td>
                    <td><input value={r.myComment} aria-label={`Your comment on ${r.title}`}
                               placeholder="What you saw, specifically"
                               onChange={e => set(i, { myComment: e.target.value })} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="fld" style={{ marginTop: 14 }}>
          <label htmlFor="overall">Overall comment</label>
          <textarea id="overall" value={overallComment}
                    onChange={e => onOverallComment(e.target.value)}
                    placeholder="Evidence, not adjectives. This is what they read." />
        </div>
        {!fb.ok && overallComment.trim().length > 0 && (
          <div className="banner b-amber" style={{ marginBottom: 0 }}>
            <span aria-hidden="true">!</span>
            <div>{fb.faults.join(' ')}</div>
          </div>
        )}

        <div className="btnrow">
          <button className="btn" type="button" disabled={unrated > 0 || saving} onClick={onSubmit}>
            {saving ? 'Saving…'
              : unrated > 0 ? `${unrated} KRA${unrated === 1 ? '' : 's'} still to rate`
              : 'Submit my rating'}
          </button>
        </div>
      </Card>
    </>
  )
}

// ── §4.4 PIP Request ─────────────────────────────────────────────────────

export interface PipArea { area: string; current: string; target: string; measure: string; reviewOn: string }

export function PipRequestTab({ members, today, onRaise, saving, flagRules}: {
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  members: TeamMember[]; today: string
  onRaise?: (employeeId: string, areas: PipArea[], support: string) => void
  saving?: boolean
}) {
  const rows = teamQueue(members, today, flagRules)
  const [who, setWho] = useState('')
  const [support, setSupport] = useState('')
  const [areas, setAreas] = useState<PipArea[]>([
    { area: '', current: '', target: '', measure: '', reviewOn: '' },
  ])
  const complete = areas.filter(a => a.area.trim() && a.target.trim() && a.measure.trim())
  const ready = !!who && complete.length > 0

  const set = (i: number, patch: Partial<PipArea>) =>
    setAreas(areas.map((a, j) => j === i ? { ...a, ...patch } : a))

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          You raise the request; <b>HR decides whether a PIP starts</b>. That is not a
          formality: the plan is the documentation trail that answers a claim under the
          Industrial Disputes Act, and HR gatekeeping is what keeps it consistent enough
          to rely on. HR can adjust your dates, drop an area, send it back, or decline it.
        </div>
      </div>

      <Card title="Raise a PIP request"
            sub="Every area needs a measurable target and a way to check it. An area without one cannot be reviewed, and a plan nobody can review protects nobody.">
        <div className="grid g2">
          <div className="fld">
            <label htmlFor="pip-who">Who</label>
            <select id="pip-who" value={who} onChange={e => setWho(e.target.value)}>
              <option value="">Choose a team member</option>
              {rows.map(r => (
                <option key={r.member.employeeId} value={r.member.employeeId}>
                  {r.member.name} ({r.member.code})
                  {r.member.finalRating !== null ? ` · last rated ${r.member.finalRating}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="pip-support">Support you are offering</label>
            <input id="pip-support" value={support} onChange={e => setSupport(e.target.value)}
                   placeholder="Training, mentoring, a change of workload" />
          </div>
        </div>

        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th><th>Improvement area</th><th>Where they are</th>
                <th>Target</th><th>How it is measured</th><th>Review on</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td><input value={a.area} aria-label={`Area ${i + 1}`}
                             onChange={e => set(i, { area: e.target.value })} /></td>
                  <td><input value={a.current} aria-label={`Current state ${i + 1}`}
                             placeholder="0.6% error rate"
                             onChange={e => set(i, { current: e.target.value })} /></td>
                  <td><input value={a.target} aria-label={`Target ${i + 1}`}
                             placeholder="under 0.2%"
                             onChange={e => set(i, { target: e.target.value })} /></td>
                  <td><input value={a.measure} aria-label={`Measure ${i + 1}`}
                             placeholder="monthly run audit"
                             onChange={e => set(i, { measure: e.target.value })} /></td>
                  <td><input type="date" value={a.reviewOn} aria-label={`Review date ${i + 1}`}
                             onChange={e => set(i, { reviewOn: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="btnrow">
          <button className="btn ghost sm" type="button"
                  onClick={() => setAreas([...areas, { area: '', current: '', target: '', measure: '', reviewOn: '' }])}>
            + Add an area
          </button>
          <button className="btn" type="button" disabled={!ready || !onRaise || saving}
                  onClick={() => onRaise?.(who, complete, support)}>
            {saving ? 'Sending…' : 'Send the request to HR'}
          </button>
        </div>
      </Card>
    </>
  )
}

// ── §4.5 / §5.3 analytics ────────────────────────────────────────────────

export function TeamAnalyticsTab({ members, today, lines, deptAverage, companyAverage, scopeLabel, bands = DEFAULT_BANDS, flagRules}: {
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  members: TeamMember[]; today: string
  lines: Line[]
  deptAverage: number | null; companyAverage: number | null
  scopeLabel: string
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
}) {
  const rows = teamQueue(members, today, flagRules)
  const dist = distribution(rows)
  const rated = dist.reduce((s, d) => s + d.n, 0)
  const cats = byCategory(lines, 'final')

  return (
    <>
      <Card title={`How ${scopeLabel} was rated`}
            sub="For information. There is no curve to fit. With no pay attached, a forced distribution would be rationing nothing.">
        {rated === 0 ? (
          <div className="k">Nothing has been finalised yet, so there is no distribution to show.</div>
        ) : dist.map(d => {
          const band = bandFor(d.rating, bands)
          return (
            <div className="abar" key={d.rating}>
              <div className="nm">{d.rating} · {band?.label ?? ''}</div>
              <div className="tr" role="img" aria-label={`${d.n} rated ${d.rating}`}>
                <div className="m" style={{ width: `${(d.n / rated) * 100}%`, height: '100%', borderRadius: 5 }} />
              </div>
              <div className="vv">{d.n} · {Math.round((d.n / rated) * 100)}%</div>
            </div>
          )
        })}
      </Card>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label={`${scopeLabel} average`} value={deptAverage === null ? '-' : deptAverage.toFixed(2)} />
        <Stat label="Company average" value={companyAverage === null ? '-' : companyAverage.toFixed(2)} />
        <Stat label="Rated 2 or below"
              value={dist.filter(d => d.rating <= 2).reduce((s, d) => s + d.n, 0)}
              note="Each of these owes improvement feedback" />
      </div>

      <Card title="Where the strength is, by category"
            sub="A low category across a whole team is a training need, not a run of individual failures.">
        {cats.length === 0
          ? <div className="k">No finalised ratings yet.</div>
          : cats.map(c => (
            <div className="abar" key={c.category}>
              <div className="nm">{c.label}</div>
              <div className="tr" role="img" aria-label={`${c.label}: ${c.score ?? 'not rated'} out of 5`}>
                <div className="m" style={{ width: `${((c.score ?? 0) / 5) * 100}%`, height: '100%', borderRadius: 5 }} />
              </div>
              <div className="vv">{c.score === null ? '-' : c.score.toFixed(2)}</div>
            </div>
          ))}
      </Card>
    </>
  )
}

// ── §5.1 Review & Finalise ───────────────────────────────────────────────

export function FinaliseTab({ members, today, role, chain, whoCanFinalise, deptName, bands = DEFAULT_BANDS,
                              onFinalise, onNudge, onLogFinalReview,
                              onAcknowledgeFinalReview, saving,
                              finalReviewRequired = false, flagRules}: {
  /**
   * The policy's eligibility rules, chiefly new_joiner_cutoff_days.
   *
   * §8 computes NEW_JOINER as "Date of Joining > (Period End − Cutoff Days)"
   * and §13.2 makes the cutoff policy configuration. It was configurable in
   * the database and in the admin screen and enforced NOWHERE: no call site
   * ever passed FlagRules, so DEFAULT_FLAG_RULES's 30 days always won and a
   * policy set to 45 changed nothing. Same shape as the KRA rules.
   */
  flagRules?: FlagRules
  members: TeamMember[]; today: string
  role: Role; chain: Chain; whoCanFinalise: Finaliser
  deptName: string
  /** pms_policies.final_review_one_to_one, so the queue blocks on the same
   *  condition pms_finalise does rather than discovering it on refusal. */
  finalReviewRequired?: boolean
  onFinalise?: (id: string, rating: number) => void
  onNudge?: (id: string) => void
  /** Create the final-review one-to-one and tick the manager's half. The gate
   *  pms_finalise enforces had no door on this side at all — see the action
   *  cell below. */
  onLogFinalReview?: (id: string) => void
  onAcknowledgeFinalReview?: (id: string) => void
  saving?: boolean
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
}) {
  const rows = finaliseQueue(members, today, { role, chain, whoCanFinalise, finalReviewRequired, rules: flagRules })
  const [picked, setPicked] = useState<Record<string, number>>({})
  const awaiting = rows.filter(r => !r.member.finalised).length
  const done = rows.filter(r => r.member.finalised).length
  const urgent = rows.filter(r => r.tone !== 'normal' && !r.member.finalised).length
  const avg = score(rows.filter(r => r.member.finalRating !== null).map(r => ({
    goalId: r.member.employeeId, title: r.member.name, category: 'BUSINESS' as const,
    weightage: 1, final: r.member.finalRating,
  })), 'final')

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          The chain is <b>{CHAIN_LABEL[chain]}</b>, and under this policy{' '}
          <b>{FINALISER_LABEL[whoCanFinalise]}</b> may finalise. A row cannot
          be finalised while a step ahead of it is still open. That is not a nicety, it is
          the difference between a rating that went through the chain and one that skipped it.
        </div>
      </div>
      <ExitBanner rows={rows} />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Awaiting finalisation" value={awaiting} note={`of ${rows.length}`} />
        <Stat label="Finalised" value={done} />
        <Stat tone={urgent ? 'warn' : undefined} label="Exit or notice" value={urgent}
              note={urgent ? 'Clear these first. Their deadline cannot move' : 'None outstanding'} />
        <Stat label={`${deptName} average`} value={avg === null ? '-' : avg.toFixed(2)} />
      </div>

      <Card title={`Finalisation queue: ${deptName}`}
            sub="Exit and notice rows are pinned to the top, because after a last working day the record locks for good.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Employee</th><th>Employment</th>
                <th className="num">Self</th><th className="num">RM L1</th><th className="num">RM L2</th>
                <th>Final rating</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '22px 14px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing to finalise</div>
                  <div className="k">{EMPTY_TEAM}</div>
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.member.employeeId}
                    className={r.tone === 'exit' ? 'exitrow' : r.tone === 'notice' ? 'noticerow' : undefined}>
                  <td>{r.member.code}</td>
                  <td style={{ fontWeight: 600 }}>{r.member.name}</td>
                  <td><FlagPill r={r} /></td>
                  <td className="num">{r.member.selfScore?.toFixed(2) ?? '-'}</td>
                  <td className="num">{r.member.rmL1Score?.toFixed(2) ?? '-'}</td>
                  <td className="num">{r.member.rmL2Score?.toFixed(2) ?? '-'}</td>
                  <td>
                    {r.member.finalised
                      ? <span className="pill p-green">{r.member.finalRating} · finalised</span>
                      : <select aria-label={`Final rating for ${r.member.name}`}
                                disabled={!r.canFinalise}
                                value={picked[r.member.employeeId] ?? ''}
                                onChange={e => setPicked(p => ({ ...p,
                                  [r.member.employeeId]: Number(e.target.value) }))}>
                          <option value="">Choose</option>
                          {bands.map(b => (
                            <option key={b.value} value={b.value}>{b.value} · {b.label}</option>
                          ))}
                        </select>}
                  </td>
                  <td>
                    {r.member.finalised ? <span className="k">done</span>
                      : r.canFinalise ? (
                        <button className="btn sm" type="button"
                                disabled={!picked[r.member.employeeId] || !onFinalise || saving}
                                onClick={() => onFinalise?.(r.member.employeeId, picked[r.member.employeeId])}>
                          Finalise
                        </button>
                      ) : r.insteadDo?.startsWith('RM L2') ? (
                        <button className="btn ghost sm" type="button" disabled={!onNudge}
                                onClick={() => onNudge?.(r.member.employeeId)}>
                          Nudge RM L2
                        </button>
                      ) : finalReviewRequired && !r.member.finalReviewLogged && r.precedingDone ? (
                        /* THE DEAD END THIS REPLACES. When the final-review
                           one-to-one was the only thing blocking a rating,
                           this cell printed insteadDo as plain text and
                           offered nothing — and the ONLY code in the product
                           that could create that row was the employee's own
                           one-to-one form. A HOD with every other gate
                           satisfied was stuck for good, and the message told
                           them to go and ask the employee to log a meeting the
                           HOD runs. Observed on Anil Verma (STC9030).

                           §2's matrix has always granted log_one_to_one to
                           RM L1, RM L2 and HOD. Only the button was missing.

                           Three states, because one button cannot serve them:
                           nothing logged, logged and awaiting MY tick, and
                           logged with my tick and awaiting theirs. */
                        /* ONE BUTTON NOW. Reached only once r.precedingDone and
                           only while no final review is on record.

                           200 removed the two states that used to follow this:
                           the mutual sign-off gates PUBLICATION, not this step,
                           so once the log exists the row becomes finalisable and
                           this branch is not entered at all. The employee's
                           acknowledgement is chased on the Feedback &
                           Recognition tab, where it actually blocks something.

                           199's trigger refuses an early FINAL_REVIEW with a
                           database exception, which is why the branch above
                           requires precedingDone rather than disabling this —
                           a dead control would replace the sentence naming who
                           is still outstanding. */
                        <button className="btn sm" type="button"
                                disabled={!onLogFinalReview || saving}
                                onClick={() => onLogFinalReview?.(r.member.employeeId)}>
                          Log final review
                        </button>
                      ) : <span className="k">{r.insteadDo}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ── §5.2 Feedback & Recognition ──────────────────────────────────────────

export const BENEFIT_TYPES = [
  'CERTIFICATE', 'SPOT_AWARD', 'TRAINING_NOMINATION',
  'SPECIAL_MENTION', 'STAR_PERFORMER', 'OTHER',
] as const
export type BenefitType = typeof BENEFIT_TYPES[number]

export const BENEFIT_LABEL: Record<BenefitType, string> = {
  CERTIFICATE: 'Certificate', SPOT_AWARD: 'Spot award',
  TRAINING_NOMINATION: 'Training nomination', SPECIAL_MENTION: 'Special mention',
  STAR_PERFORMER: 'Star performer', OTHER: 'Other',
}

// ── §5.3 Published Results — the department's record ─────────────────────

export interface PublishedResult {
  employeeId: string
  appreciation?: string | null
  improvement?: string | null
  benefits?: { type: string; note: string }[]
}

/**
 * Every result released in this HOD's department, and nothing editable.
 *
 * ONLY A HOD CAN REACH THIS. It renders inside the department surface, which
 * the ESS screen offers only when roles.isHOD — so the audience is settled by
 * where it lives rather than by a check here, the same way Review & Finalise
 * is.
 *
 * WHY READ-ONLY IS THE FEATURE. Publishing is the moment the employee sees
 * their rating and their feedback (§3.5, §8). Editing either afterwards would
 * change a document somebody has already read, and in the worst case one they
 * have formally acknowledged — so this screen has no inputs at all, not
 * disabled ones. A disabled field still says "this is a thing you might edit".
 *
 * It is also where a published person GOES. Feedback & Recognition offers only
 * people who are finalised and NOT yet published, so once a result is out, the
 * employee leaves that queue and appears here instead. Without the second
 * half, publishing would leave them sitting in a feedback form that could
 * still be typed into.
 */
export function PublishedResultsTab({ members, bands = DEFAULT_BANDS, results = [],
                                      deptName }: {
  members: TeamMember[]
  bands?: Band[]
  /** The feedback and recognition that went out with each result. */
  results?: PublishedResult[]
  deptName?: string
}) {
  const rows = members
    .filter(m => m.published)
    // Most recently released first: the one a HOD is asked about is almost
    // always the one that just went out.
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
  const byId = new Map(results.map(r => [r.employeeId, r]))
  const acked = rows.filter(r => r.resultAcknowledged).length

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">🔒</span>
        <div>
          These results are out. {deptName ? `${deptName}'s ` : 'Your department’s '}
          record of what each person was told, and nothing here can be changed —
          the employee has already read it. A rating that genuinely needs
          correcting goes through HR.
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Published" value={rows.length} />
        <Stat label="Acknowledged by the employee" value={acked}
              note={rows.length ? `${rows.length - acked} still to read theirs` : undefined} />
        <Stat label="Average rating"
              value={rows.length
                ? (rows.reduce((s, r) => s + (r.finalRating ?? 0), 0) / rows.length).toFixed(2)
                : '—'} />
      </div>

      <Card title="Released results" sub="Oldest at the bottom. Read-only.">
        {!rows.length ? (
          <div style={{ padding: '22px 14px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing published yet</div>
            <div className="k">
              A result appears here once it has been released to the employee.
              Until then it sits in Review &amp; Finalise, then Feedback &amp;
              Recognition.
            </div>
          </div>
        ) : (
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Employee</th><th className="num">Rating</th>
                  <th>Published</th><th>Read by them</th><th>What they were told</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(m => {
                  const band = bandFor(m.finalRating, bands)
                  const fb = byId.get(m.employeeId)
                  return (
                    <tr key={m.employeeId}>
                      <td>{m.code}</td>
                      <td style={{ fontWeight: 600 }}>{m.name}</td>
                      <td className="num">
                        <b>{m.finalRating ?? '—'}</b>{band ? ` · ${band.label}` : ''}
                      </td>
                      <td className="k">
                        {m.publishedAt ? humanDate(String(m.publishedAt).slice(0, 10)) : '—'}
                      </td>
                      <td>{m.resultAcknowledged
                        ? <span className="pill p-green">✓ acknowledged</span>
                        : <span className="pill p-amber">not yet</span>}</td>
                      <td style={{ maxWidth: 360 }}>
                        {!fb?.appreciation && !fb?.improvement
                          ? <span className="k">No written feedback went out.</span>
                          : (
                            <div style={{ display: 'grid', gap: 4 }}>
                              {fb?.appreciation && (
                                <div><b>Appreciation.</b> {fb.appreciation}</div>
                              )}
                              {fb?.improvement && (
                                <div><b>Improvement.</b> {fb.improvement}</div>
                              )}
                              {!!fb?.benefits?.length && (
                                <div className="chips">
                                  {fb.benefits.map((b, i) => (
                                    <span key={i} className="pill p-brand">
                                      {b.type.replace(/_/g, ' ').toLowerCase()}
                                      {b.note ? ` · ${b.note}` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

export function FeedbackTab({ member, rating, appreciation, improvement, benefits, logs, bands = DEFAULT_BANDS,
                              onChange, onPublish, onAcknowledgeFinalReview, saving }: {
  member: TeamMember | null
  rating: number | null
  appreciation: string; improvement: string
  benefits: { type: BenefitType; note: string }[]
  logs: Log[]
  onChange: (patch: { appreciation?: string; improvement?: string
                      benefits?: { type: BenefitType; note: string }[] }) => void
  onPublish?: () => void
  /** The manager's half of the final-review sign-off, which 200 made a
   *  PUBLICATION gate rather than a finalisation one. */
  onAcknowledgeFinalReview?: () => void
  saving?: boolean
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
}) {
  if (!member) {
    return <Card title="Pick somebody">
      <div className="k">Choose a person from the finalisation queue to write their feedback.</div>
    </Card>
  }
  const check = checkFeedback(rating, { appreciation, improvement }, bands)
  const publish = canPublishResult(logs)
  const band = bandFor(rating, bands)
  const canPublish = check.ok && publish.open

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Writing feedback for" value={member.name} note={member.code} />
        <Stat label="Final rating"
              value={rating === null ? '-' : `${rating}${band ? ` · ${band.label}` : ''}`} />
        <Stat tone={band?.improvementMandatory ? 'warn' : undefined}
              label="Improvement feedback"
              value={band?.improvementMandatory ? 'Required' : 'Optional'}
              note={band?.improvementMandatory
                ? 'Mandatory at this rating' : 'Write it anyway if there is something to say'} />
      </div>

      <div className="grid g2">
        <div className="fld">
          <label htmlFor="fb-app">🏆 Appreciation</label>
          <textarea id="fb-app" value={appreciation}
                    onChange={e => onChange({ appreciation: e.target.value })}
                    placeholder="What they did well, specifically enough that they could repeat it" />
        </div>
        <div className="fld">
          <label htmlFor="fb-imp">📈 Where to improve</label>
          <textarea id="fb-imp" value={improvement}
                    onChange={e => onChange({ improvement: e.target.value })}
                    placeholder="What would change the rating, and what support goes with it" />
        </div>
      </div>

      <Card title="🎁 Recognition"
            sub="Non-monetary only: a certificate, a nomination, an award. Anything with a cash component would touch payroll, and this module does not.">
        {benefits.map((b, i) => (
          <div className="grid g2" key={i}>
            <div className="fld">
              <label htmlFor={`ben-t-${i}`}>Type</label>
              <select id={`ben-t-${i}`} value={b.type}
                      onChange={e => onChange({ benefits: benefits.map((x, j) =>
                        j === i ? { ...x, type: e.target.value as BenefitType } : x) })}>
                {BENEFIT_TYPES.map(t => <option key={t} value={t}>{BENEFIT_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="fld">
              <label htmlFor={`ben-n-${i}`}>What for</label>
              <input id={`ben-n-${i}`} value={b.note}
                     onChange={e => onChange({ benefits: benefits.map((x, j) =>
                       j === i ? { ...x, note: e.target.value } : x) })} />
            </div>
          </div>
        ))}
        <div className="btnrow">
          <button className="btn ghost sm" type="button"
                  onClick={() => onChange({ benefits: [...benefits, { type: 'CERTIFICATE', note: '' }] })}>
            + Add recognition
          </button>
        </div>
      </Card>

      {(!check.ok || !publish.open) && (
        <div className="banner b-amber">
          <span aria-hidden="true">!</span>
          <div>
            <b>Before this can be published:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
              {check.faults.map((f, i) => <li key={i}>{f}</li>)}
              {!publish.open && <li>{publish.because}</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="btnrow">
        <button className="btn" type="button" disabled={!canPublish || !onPublish || saving}
                onClick={onPublish}>
          {saving ? 'Publishing…' : canPublish ? 'Publish the result' : 'Cannot publish yet'}
        </button>
        {/* THE SIGN-OFF IS CHASED HERE NOW, because this is the step it gates.
            200 moved the mutual acknowledgement off finalisation — where the
            spec never put it — and onto publication, so the Finalise queue no
            longer asks for it and this screen has to. The manager's own half
            is a button; the employee's half is theirs to give, and the banner
            above says so. */}
        {!publish.open && logs.some(l => l.discussion_type === 'FINAL_REVIEW' && !l.manager_ack)
          && onAcknowledgeFinalReview && (
          <button className="btn ghost" type="button" disabled={saving}
                  onClick={onAcknowledgeFinalReview}>
            Acknowledge the final review
          </button>
        )}
      </div>
    </>
  )
}
