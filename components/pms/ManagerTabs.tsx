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
import { canPublishResult, type Log } from '@/lib/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Role, type Chain, type Finaliser }
  from '@/lib/pms/hierarchy'
import { approvalFinalises, mayReject, rejectDestination, remarkOk, MIN_REMARK,
         rungFor, heldBy } from '@/lib/pms/chain'
import { humanDate } from '@/lib/pms/cycle'
import { DEFAULT_RULES, type Rules } from '@/lib/pms/cycle'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'deptAnalytics'

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
                          onApprove, onReject, bands }: {
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
  bands?: Band[]
}) {
  const [remark, setRemark] = useState<Record<string, string>>({})
  const [rating, setRating] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<Record<string, boolean>>({})

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
          const rk = remark[id] ?? ''
          const rt = rating[id] ?? ''
          const num = Number(rt)
          // The band list is the policy's scale, so its edges are the valid
          // range rather than a hardcoded 1-5 that a 1-4 scale would break.
          const lo = bands?.length ? Math.min(...bands.map(b => b.value)) : 1
          const hi = bands?.length ? Math.max(...bands.map(b => b.value)) : 5
          const ratingOk = !finalises || (rt !== '' && num >= lo && num <= hi)

          if (rejecting[id]) {
            return (
              <td>
                <div style={{ display: 'grid', gap: 4, minWidth: 220 }}>
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
              <div style={{ display: 'grid', gap: 4, minWidth: 180 }}>
                {finalises && (
                  <input type="number" step="0.01" min={lo} max={hi}
                         placeholder={`Final rating (${lo}–${hi})`}
                         aria-label={`Final rating for ${r.member.name}`}
                         value={rt}
                         onChange={e => setRating(p => ({ ...p, [id]: e.target.value }))} />
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm" type="button"
                          disabled={!onApprove || !ratingOk}
                          onClick={() => onApprove?.(id, finalises ? num : undefined)}>
                    {finalises ? 'Approve & finalise' : 'Approve'}
                  </button>
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
                             onApprove, bands}: {
  /** The viewer's id and the policy's chain — see ChainApprovals. Defaulted so
   *  a call site that has not been updated renders the tab without the
   *  approval card rather than crashing. */
  viewerId?: string
  chain?: Chain
  onApprove?: (id: string, rating?: number) => void
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
                      onApprove={onApprove} onReject={onSendBack} bands={bands} />
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
                  <div style={{ display: 'grid', gap: 4, minWidth: 180 }}>
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
                      ) : finalReviewRequired && !r.member.finalReviewDone && r.precedingDone ? (
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
                        !r.member.finalReviewLogged ? (
                          /* Reached only once r.precedingDone — see the branch
                             condition above. 199 put a trigger on
                             pms_one_to_one that refuses an early FINAL_REVIEW
                             with a database exception, so this button must not
                             exist before the chain has caught up; and gating
                             it with `disabled` instead would REPLACE the
                             insteadDo sentence naming who is outstanding with
                             a dead control, which is less useful than the
                             sentence. */
                          <button className="btn sm" type="button"
                                  disabled={!onLogFinalReview || saving}
                                  onClick={() => onLogFinalReview?.(r.member.employeeId)}>
                            Log final review
                          </button>
                        ) : !r.member.finalReviewMgrAcked ? (
                          <button className="btn sm" type="button"
                                  disabled={!onAcknowledgeFinalReview || saving}
                                  onClick={() => onAcknowledgeFinalReview?.(r.member.employeeId)}>
                            Acknowledge it
                          </button>
                        ) : (
                          <span className="k">
                            Waiting on {r.member.name.split(' ')[0]} to acknowledge the final review
                          </span>
                        )
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

export function FeedbackTab({ member, rating, appreciation, improvement, benefits, logs, bands = DEFAULT_BANDS,
                              onChange, onPublish, saving }: {
  member: TeamMember | null
  rating: number | null
  appreciation: string; improvement: string
  benefits: { type: BenefitType; note: string }[]
  logs: Log[]
  onChange: (patch: { appreciation?: string; improvement?: string
                      benefits?: { type: BenefitType; note: string }[] }) => void
  onPublish?: () => void
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
      </div>
    </>
  )
}
