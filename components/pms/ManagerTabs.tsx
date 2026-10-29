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

import { Fragment, useEffect, useState } from 'react'
import './pms.css'
import { teamQueue, finaliseQueue, teamStats, distribution, initials,
         type TeamMember, type QueueRow, type FinaliseRow } from '@/lib/pms/team'
import { FLAG_LABEL, type FlagRules } from '@/lib/pms/employment'
import { checkFeedback, score, gap, byCategory, bandFor,
         compareRatings, ratingTone, toneVars, DEFAULT_BANDS,
         type Band, type Line, type CompareSummary,
         type RaterRole } from '@/lib/pms/scoring'
import { canPublishResult, CONFIRM_LABEL, CONFIRM_WHY,
         type Log, type ConfirmStage } from '@/lib/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Role, type Chain, type Finaliser }
  from '@/lib/pms/hierarchy'
import { approvalFinalises, mayReject, rejectDestination, remarkOk, MIN_REMARK,
         rungFor, heldBy, rungs, nextRung, STAGE_SHORT,
         type Stage } from '@/lib/pms/chain'
import { humanDate } from '@/lib/pms/cycle'
import { DEFAULT_RULES, type Rules } from '@/lib/pms/cycle'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'published' | 'deptAnalytics'

export const MGR_TABS: { k: MgrTab; label: string; blurb: string }[] = [
  { k: 'team',      label: 'Team Dashboard',           blurb: 'who is where, worst deadline first' },
  { k: 'approve',   label: 'KRA Approval & One-to-One',blurb: 'check their sets, then log the discussion' },
  { k: 'rate',      label: 'Team Ratings',              blurb: 'what each rung of the chain scored, read-only' },
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

function QueueTable({ rows, extraHead, extraCell, empty, rules = DEFAULT_RULES,
                     grouped }: {
  rows: QueueRow[]
  extraHead?: React.ReactNode
  extraCell?: (r: QueueRow) => React.ReactNode
  empty: string
  /**
   * Inside a GroupedQueue, where every row in the table is stuck on the same
   * thing and the group's own heading has already said what that is.
   *
   * Drops the "What is owed" column, which would otherwise repeat one
   * sentence down the whole table — the deadline note that shared that cell
   * moves under the name, where a last working day belongs anyway.
   */
  grouped?: boolean
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
            {!grouped && <th>What is owed</th>}
            {extraHead}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={(extraHead ? 10 : 9) - (grouped ? 1 : 0)}
                    style={{ textAlign: 'center', padding: '22px 14px' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Nobody here yet</div>
              <div className="k">{empty}</div>
            </td></tr>
          ) : rows.map(r => (
            <tr key={r.member.employeeId}
                className={r.tone === 'exit' ? 'exitrow' : r.tone === 'notice' ? 'noticerow' : undefined}>
              <td>{r.member.code}</td>
              <td style={{ fontWeight: 600 }}>
                {r.member.name}
                {/* The deadline rides with the person in grouped mode. It
                    shared a cell with "what is owed", and that cell is gone
                    — losing it would hide the one thing on this screen that
                    genuinely cannot wait. */}
                {grouped && r.priorityNote && (
                  <div className="k" style={{ color: 'var(--ez-warning)', fontWeight: 600 }}>
                    {r.priorityNote}
                  </div>
                )}
              </td>
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
              {!grouped && (
                <td className="k">
                  {r.next}
                  {r.priorityNote && <><br /><b>{r.priorityNote}</b></>}
                </td>
              )}
              {extraCell?.(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * WHERE THIS SET IS IN THE CHAIN, drawn.
 *
 * The module's entire subject is a chain and no manager screen ever drew one.
 * An approver has two questions the queue could not answer — who looked at
 * this before me, and who gets it when I let go — and both were answerable
 * only by knowing the policy by heart.
 *
 * Built from the rungs somebody actually OCCUPIES, not the policy's list: on
 * a collapsed reporting line RM L2 is empty for 190 of 395 enrolments, and
 * drawing a rung that will be skipped tells the approver their set goes
 * somewhere it will not.
 */
function ChainTrack({ chain, held, now }: {
  chain: Chain
  held: (s: Stage) => boolean
  /** The rung holding it — rendered as "you", because on this card it is. */
  now: Stage
}) {
  const steps: Stage[] = ['EMPLOYEE', ...rungs(chain).filter(held)]
  const at = steps.indexOf(now)
  return (
    <div className="track" aria-label="Where this sits in the approval chain">
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span className="sep" aria-hidden="true">›</span>}
          <span className={i < at ? 'n done' : i === at ? 'n now' : 'n'}>
            {i === at ? `${STAGE_SHORT[s]} · you` : STAGE_SHORT[s]}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/**
 * The four things that decide whether a set can move, as four marks.
 *
 * They were four columns of a ten-column table — KRAS, WT, 1-ON-1, SELF —
 * which is the right shape for comparing people and the wrong one for
 * checking a person. Each mark says what it IS rather than merely being
 * green: a row of bare ticks makes somebody hover every one to find the
 * single one that is wrong.
 */
function ReadyChecks({ r, rules }: { r: QueueRow; rules: Rules }) {
  const m = r.member
  const countOk = m.kraCount >= rules.minKra && m.kraCount <= rules.maxKra
  const wtOk = m.totalWeightage === rules.totalWeightage
  const marks: { cls: string; mark: string; text: string }[] = [
    { cls: countOk ? 'on' : 'bad', mark: countOk ? '✓' : '!',
      text: `${m.kraCount} KRA${m.kraCount === 1 ? '' : 's'}` },
    { cls: wtOk ? 'on' : 'bad', mark: wtOk ? '✓' : '!',
      text: `Weightage ${m.totalWeightage}` },
    { cls: m.selfSubmitted ? 'on' : 'off', mark: m.selfSubmitted ? '✓' : '○',
      text: m.selfSubmitted ? 'Self rating in' : 'Self rating waiting' },
    { cls: m.oneToOneDone ? 'on' : 'off', mark: m.oneToOneDone ? '✓' : '○',
      text: m.oneToOneDone ? 'One-to-one logged' : 'One-to-one not yet' },
  ]
  return (
    <div className="checks">
      {marks.map(x => (
        <span key={x.text} className={`chk ${x.cls}`}>
          <span className="m" aria-hidden="true">{x.mark}</span>{x.text}
        </span>
      ))}
    </div>
  )
}

/**
 * ROWS THAT ARE ALL STUCK ON THE SAME THING, said once.
 *
 * Observed on the live screen: eight people in "Waiting on the discussion",
 * every one of them carrying the identical sentence "No KRAs written yet.
 * They cannot be rated at all until there are." That is the sentence printed
 * eight times and read none — and it crowded out the rows that said
 * something different, which were the only ones worth finding.
 *
 * Grouping is on r.next, which teamQueue already computes as the single
 * thing owed on that row. The first sentence of it becomes the heading and
 * the rest becomes the explanation, so the wording stays owned by team.ts
 * rather than being restated here and drifting.
 *
 * ORDER IS PRESERVED. teamQueue sorts by whose deadline cannot move; taking
 * groups in order of first appearance keeps the most urgent group first
 * instead of re-sorting by something arbitrary like group size.
 */
function GroupedQueue({ rows, rules, empty, extraHead, extraCell }: {
  rows: QueueRow[]
  rules: Rules
  empty: string
  extraHead?: React.ReactNode
  extraCell?: (r: QueueRow) => React.ReactNode
}) {
  if (!rows.length) {
    return <QueueTable rows={rows} rules={rules} empty={empty}
                       extraHead={extraHead} extraCell={extraCell} />
  }
  const groups: { key: string; rows: QueueRow[] }[] = []
  for (const r of rows) {
    const g = groups.find(x => x.key === r.next)
    if (g) g.rows.push(r)
    else groups.push({ key: r.next, rows: [r] })
  }
  return (
    <>
      {groups.map(g => {
        // Split on the first sentence end. A sentence that has no full stop
        // becomes the heading whole, which is the right fallback: better a
        // long heading than an empty one.
        const cut = g.key.indexOf('. ')
        const head = cut < 0 ? g.key : g.key.slice(0, cut + 1)
        const why = cut < 0 ? '' : g.key.slice(cut + 2)
        return (
          <div className="qgroup" key={g.key}>
            <div className="ghead">
              <span className="gt">{head}</span>
              <span className="gn">{g.rows.length}</span>
              {why && <span className="gw">{why}</span>}
            </div>
            <QueueTable grouped rows={g.rows} rules={rules} empty={empty}
                        extraHead={extraHead} extraCell={extraCell} />
          </div>
        )
      })}
    </>
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
    <Card title={`Waiting on your approval · ${rows.length}`}
          sub="Sets that have reached your rung. Approving passes them up the chain; the last rung settles the rating.">
      {rows.map(r => {
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
        const rk = remark[id] ?? ''

        return (
          <div key={id}
               className={`qcard${r.tone === 'exit' ? ' exit' : r.tone === 'notice' ? ' notice' : ''}`}>
            <div className="ava" aria-hidden="true">{initials(r.member.name)}</div>

            <div style={{ minWidth: 0 }}>
              <div className="nm" style={BREAK}>{r.member.name}</div>
              <div className="meta">
                <span>{r.member.code}</span>
                <FlagPill r={r} />
                {/* The number this rung is reacting to. It was a column
                    headed SELF SCORE five cells from the name; here it sits
                    with the person it belongs to. */}
                {r.member.selfScore !== null && (
                  <span>Self score <b style={{ color: 'var(--ez-ink)' }}>
                    {r.member.selfScore.toFixed(2)}</b></span>
                )}
              </div>

              <ReadyChecks r={r} rules={rules} />
              <ChainTrack chain={chain} held={held} now={myStage} />

              <div className="k" style={{ marginTop: 9, lineHeight: 1.6, ...BREAK }}>
                {r.next}
                {r.priorityNote && <> <b>{r.priorityNote}</b></>}
                {/* WHAT APPROVING DOES, on the card rather than in a
                    paragraph under the table. "Approve" means two different
                    things one rung apart — passing it up, or settling the
                    rating for good — and only one of them is reversible. */}
                {' '}
                {finalises
                  ? <b>Yours is the last review: approving settles the rating.</b>
                  : <>Approving sends it to <b>{STAGE_SHORT[nextRung(chain, myStage, held) ?? 'HR']}</b>.</>}
              </div>

              {rejecting[id] && (
                <div style={{ display: 'grid', gap: 6, marginTop: 10,
                              padding: 10, borderRadius: 10,
                              background: 'var(--ez-critical-tint)',
                              border: '1px solid var(--ez-critical-edge)' }}>
                  <div className="k">
                    This goes <b>{rejectDestination(chain, myStage, held)}</b>.
                  </div>
                  <input placeholder="What has to change, in a sentence"
                         aria-label={`Reason for rejecting ${r.member.name}'s appraisal`}
                         value={rk}
                         onChange={e => setRemark(p => ({ ...p, [id]: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn red sm" type="button"
                            disabled={!onReject || !remarkOk(rk)}
                            onClick={() => { onReject?.(id, rk)
                                             setRejecting(p => ({ ...p, [id]: false })) }}>
                      Confirm rejection
                    </button>
                    <button className="btn ghost sm" type="button"
                            onClick={() => setRejecting(p => ({ ...p, [id]: false }))}>
                      Cancel
                    </button>
                    {/* COUNTS DOWN rather than only refusing. "At least 10
                        characters" under a box with 4 in it leaves the
                        person counting; the number says how far there is to
                        go and disappears when there is none. */}
                    {!remarkOk(rk) && (
                      <span className="k" style={{ alignSelf: 'center' }}>
                        {MIN_REMARK - rk.trim().length} more character
                        {MIN_REMARK - rk.trim().length === 1 ? '' : 's'} — they read this.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="qact">
              {/* APPROVING MOVED INTO THE PANEL. It needs this rater's score
                  on every KRA — 199 will not let the next rung settle
                  anything without it — and a per-KRA rating cannot live in a
                  table cell. Rejecting stays here: it needs a remark, not
                  ratings, and a manager returning an obviously wrong set
                  should not have to score it first. */}
              <button className="btn" type="button"
                      disabled={!onOpenKras}
                      onClick={() => onOpenKras?.(id)}>
                {alreadyConfirmed ? 'Review & send on' : 'Review, rate & approve'}
              </button>
              {canReject && !rejecting[id] && (
                <button className="btn ghost sm" type="button"
                        disabled={!onReject}
                        onClick={() => setRejecting(p => ({ ...p, [id]: true }))}>
                  Send back
                </button>
              )}
            </div>
          </div>
        )
      })}
      <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Sending back goes one rung, never straight to the employee from halfway
        up — and it needs a reason, which they see. You can change their KRAs or
        ratings before approving; every change is logged against your name.
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
  /** Which rows have opened the send-back box. See the cell below. */
  const [backing, setBacking] = useState<Record<string, boolean>>({})
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
      <Card title={`Waiting on the discussion · ${rows.length}`}
            sub="Sets to check, and the one-to-ones that lock them. Grouped by what each one is waiting for.">
        <GroupedQueue
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
                  // ON DEMAND, not always open. Every invalid row carried an
                  // empty text box and a dead button: six of them stacked is
                  // a form the manager has not asked for, and a disabled
                  // control with no explanation reads as broken rather than
                  // as waiting. Same reveal as the approval card's send-back,
                  // so the two behave alike.
                  <div style={{ display: 'grid', gap: 5, width: 200, maxWidth: '100%' }}>
                    {!backing[r.member.employeeId] ? (
                      <button className="btn ghost sm" type="button"
                              disabled={!onSendBack}
                              onClick={() => setBacking(p => ({ ...p, [r.member.employeeId]: true }))}>
                        Send back…
                      </button>
                    ) : (
                      <>
                        <input placeholder="What they need to change"
                               autoFocus
                               aria-label={`Reason for sending ${r.member.name}'s KRAs back`}
                               value={reason[r.member.employeeId] ?? ''}
                               onChange={e => setReason(p => ({ ...p, [r.member.employeeId]: e.target.value }))} />
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          <button className="btn sm" type="button"
                                  disabled={!onSendBack || !(reason[r.member.employeeId] ?? '').trim()}
                                  onClick={() => onSendBack?.(r.member.employeeId, reason[r.member.employeeId])}>
                            Send back
                          </button>
                          <button className="btn ghost sm" type="button"
                                  onClick={() => setBacking(p => ({ ...p, [r.member.employeeId]: false }))}>
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
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
        <Card title={`Final review one-to-ones waiting on you · ${finalRows.length}`}
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

/** The id of the reason field for one KRA, so the summary below can send the
 *  rater to the exact box that is empty rather than make them hunt for it. */
const whyId = (goalId: string) => `kra-why-${goalId}`

/**
 * THE COMPARISON, while the rating is still being made.
 *
 * Requested: "there should be an interactive panel that shows a
 * representation of what they self rate them, what you rate them, what's the
 * difference between both ratings, and ask the reason for rating. it is like
 * a window summary."
 *
 * WHY IT SITS HERE AND NOT ON A REPORT. The gap between a self rating and a
 * manager's rating already exists everywhere in this module — §3.6 computes
 * it, the employee's own screen shows it, the calibration view aggregates it.
 * Every one of those is AFTER the fact. By then the manager has moved on and
 * the employee is reading a number nobody explained.
 *
 * Shown at the moment of rating, the same arithmetic does something else: it
 * is the last chance to notice that you have just marked somebody two bands
 * below their own reading of the same quarter, and to write the sentence
 * while the reason is still in your head. That sentence is the whole point.
 * An unexplained downgrade is what an appraisal gets disputed over.
 *
 * NOT A SECOND OPINION ON THE NUMBERS. Everything here comes from
 * compareRatings(), which is score() and gap() — the same weighted mean and
 * the same thresholds the employee will be shown. A panel that computed its
 * own "major gap" would eventually disagree with the employee's screen about
 * one number, and then both are worthless.
 */
function RatingSummary({ s, onJump }: {
  s: CompareSummary
  /** Focus the reason box for a KRA. The "interactive" part: a row that says
   *  a reason is missing is also the control that takes you to it. */
  onJump?: (goalId: string) => void
}) {
  if (!s.total) return null
  const nf = (v: number | null) => v === null ? '—' : v.toFixed(2)
  // Sign is stated, not left to a minus sign the reader has to interpret
  // against a convention they do not know. Up/down is also the direction
  // people actually say out loud.
  const arrow = (d: number | null) =>
    d === null ? '' : d > 0 ? `+${d} up` : d < 0 ? `${d} down` : 'same'

  return (
    <Card title="Line by line against theirs"
          sub={s.rated === 0
            ? 'Fills in as you rate. They will see this same comparison.'
            : `${s.rated} of ${s.total} rated · ${s.agreed} the same, ${s.higher} higher, ${s.lower} lower than they said.`
              + (s.delta === null ? ''
                 : s.delta === 0 ? ' Overall you agree.'
                 : ` Overall ${s.delta > 0 ? '+' : ''}${s.delta} against their own score.`)}>
      {/* THE THREE TOTALS ARE NOT REPEATED HERE. They moved to the panel
          header, where they are visible before the first KRA rather than
          after the last one — and showing them twice on one screen made the
          panel longer while telling the reader nothing they had not just
          read. What this card is for is the LINE BY LINE, which the header
          cannot show. */}
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th>KRA</th><th className="num">Wt</th>
              <th className="num">Their rating</th><th className="num">Your rating</th>
              <th>Difference</th><th>Your reason</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map(l => (
              <tr key={l.goalId}>
                <td style={{ fontWeight: 600, ...BREAK }}>{l.title}</td>
                <td className="num">{l.weightage}</td>
                <td className="num">{l.self ?? '—'}</td>
                <td className="num">{l.mine ?? <span className="k">not yet</span>}</td>
                <td>
                  {l.delta === null ? <span className="k">—</span>
                    : l.flag === 'MAJOR_GAP'
                      ? <span className="pill p-amber">{arrow(l.delta)}</span>
                    : l.flag === 'MINOR_GAP'
                      ? <span className="pill p-blue">{arrow(l.delta)}</span>
                      : <span className="pill p-green">agreed</span>}
                </td>
                <td>
                  {!l.needsReason ? <span className="k">not needed</span>
                    : l.hasReason ? <span className="pill p-green">given</span>
                    : (
                      <button type="button" className="btn ghost sm"
                              onClick={() => onJump?.(l.goalId)}>
                        Say why →
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.missingReasons.length > 0 && (
        <div className="banner b-amber" style={{ marginTop: 12, marginBottom: 0 }}>
          <span aria-hidden="true">!</span>
          <div>
            <b>{s.missingReasons.length === 1
              ? 'One rating differs from theirs and has no reason yet.'
              : `${s.missingReasons.length} ratings differ from theirs with no reason yet.`}</b>
            <div className="k" style={{ marginTop: 3 }}>
              {/* Says why the box is being asked for. A required field with
                  no stated purpose gets filled with "as discussed". */}
              They will see your number next to their own. A difference you
              have not explained is the single most common thing an appraisal
              is disputed over — and you will not remember the reason in
              March.
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * The rating control, as a radiogroup the keyboard can actually use.
 *
 * It was five buttons, each its own tab stop: five presses to cross one
 * KRA and twenty to cross a set of four, before you reach the reason box.
 * That is not what role="radiogroup" promises, and a screen reader
 * announces the promise either way.
 *
 * ROVING TABINDEX: the group holds ONE tab stop — the chosen chip, or the
 * first when nothing is chosen — and the arrows move between them, which is
 * the pattern every radio group on the platform uses. Home and End jump to
 * the ends because a five-point scale is short enough that "worst" and
 * "best" are the two people reach for.
 *
 * Arrow keys SELECT as they move, which is what native radios do: moving
 * through a radio group changes the value. There is no separate confirm
 * step to forget.
 */
function RatingChips({ bands, value, onPick, label }: {
  bands: Band[]
  value: number | null
  onPick: (v: number) => void
  /** Names the group for a screen reader — "Your rating for <KRA>". */
  label: string
}) {
  const idx = bands.findIndex(b => b.value === value)
  // Nothing chosen yet: the first chip is the way in.
  const stop = idx < 0 ? 0 : idx

  const move = (to: number, e: React.KeyboardEvent) => {
    const i = Math.max(0, Math.min(bands.length - 1, to))
    e.preventDefault()
    onPick(bands[i].value)
    // The DOM is the source of focus here rather than a ref array: the
    // chips are siblings, so the group element already knows where they
    // are, and a ref per band would have to be rebuilt whenever a policy
    // changes its scale.
    const group = e.currentTarget.parentElement
    ;(group?.children[i] as HTMLElement | undefined)?.focus()
  }

  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {bands.map((bd, i) => {
        const on = value === bd.value
        return (
          <button key={bd.value} type="button" role="radio"
                  aria-checked={on}
                  tabIndex={i === stop ? 0 : -1}
                  // COLOURED ONLY ONCE CHOSEN. Painting all five turns the
                  // control into a traffic light and pulls the eye to the
                  // green one, which is a thumb on the scale.
                  className={on ? 'chip sel ramp' : 'chip'}
                  // The ramp position for THIS band, so the chosen chip is
                  // the same colour as the card it scores.
                  style={on ? toneVars(ratingTone(bd.value, bands)) : undefined}
                  title={bd.label}
                  onKeyDown={e => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i + 1, e)
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i - 1, e)
                    else if (e.key === 'Home') move(0, e)
                    else if (e.key === 'End') move(bands.length - 1, e)
                  }}
                  onClick={() => onPick(bd.value)}>
            {bd.value}
          </button>
        )
      })}
    </div>
  )
}

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
                            overallComment, onOverallComment,
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
  /**
   * The one piece of prose the whole appraisal gets from this rung, as
   * opposed to the per-KRA reasons above it.
   *
   * IT CAME FROM THE RATING TAB, which is a read-only record now. Rather
   * than delete the only overall comment an RM writes for their reportee, it
   * moved to where the rating moved: pms_feedback takes one row per person
   * per period and this is that rung's half of it.
   */
  overallComment?: string
  onOverallComment?: (s: string) => void
  saving?: boolean
}) {
  const total = (lines ?? []).reduce((s, l) => s + (Number(l.weightage) || 0), 0)
  const rated = (lines ?? []).filter(l => l.selfRating != null).length

  // THE COMPARISON, recomputed on every keystroke so the panel moves with the
  // chips. Only the lines that can actually be rated are in it: a KRA with no
  // goalId cannot be written to pms_reviews at all (the table is UNIQUE on
  // the goal), so including it would demand a reason for a rating that has
  // nowhere to go.
  const cmp = compareRatings((lines ?? []).filter(l => l.goalId).map(l => ({
    goalId: l.goalId!,
    // NUMBERED, matching the heading on the card above ("3. Tech").
    // Titles repeat in real sets — four KRAs called "Tech" is normal —
    // so a blocker naming them by title alone says nothing about WHICH.
    title: `${l.seqNo}. ${l.title || 'untitled'}`,
    weightage: Number(l.weightage) || 0,
    self: l.selfRating ?? null,
    mine: rate?.[l.goalId!]?.rating ?? null,
    comment: rate?.[l.goalId!]?.comment ?? null,
  })))

  /**
   * WHICH KRAs ARE FOLDED AWAY, by goal id.
   *
   * Explicit, never automatic. Folding a card the moment it is complete
   * sounds helpful and is not: the completing keystroke is usually the last
   * character of the reason, so the card would collapse under the cursor
   * mid-sentence. Everything here is folded by the reader or by the one
   * button that says what it will fold.
   */
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const fold = (id: string, v: boolean) => setFolded(p => ({ ...p, [id]: v }))

  /** Done means rated AND explained — the two conditions the approval gate
   *  checks — so "hide the done ones" never hides something still blocking. */
  const doneIds = cmp.lines
    .filter(l => l.mine != null && !(l.needsReason && !l.hasReason))
    .map(l => l.goalId)
  const foldableLeft = doneIds.filter(id => !folded[id]).length

  const jump = (goalId: string) => {
    fold(goalId, false)
    // The id is on the reason box, which is the bottom of the card; block
    // 'center' brings the whole KRA into view rather than parking its last
    // line at the top edge.
    requestAnimationFrame(() => {
      document.getElementById(whyId(goalId))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const rating = myRung && onApprove

  /**
   * HOW MUCH WORK CLOSING WOULD THROW AWAY.
   *
   * The draft lives in the parent's state and does not survive the panel —
   * onClose clears it. Until now the only way out was a ghost button at the
   * bottom of 1900px, which is hard to hit by accident; a round red × in
   * the corner is not, so the guard arrives with it.
   */
  const unsaved = cmp.lines.filter(l => l.mine != null || l.hasReason).length
  const [asking, setAsking] = useState(false)
  const close = () => { setAsking(false); onClose?.() }
  /** The × asks only when there is something to lose. A confirmation on an
   *  untouched panel is a dialog that teaches people to dismiss dialogs. */
  const tryClose = () => (unsaved > 0 && rating ? setAsking(true) : close())

  // ESCAPE CLOSES IT, through the same guard — so the key that people
  // expect to dismiss a panel cannot be the one that loses their ratings.
  // Bound to the document because focus may be anywhere inside, including
  // in a textarea that would otherwise swallow it.
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A second Escape while the question is up means "no, keep editing" —
      // never "yes, discard". Escape must not be able to destroy work.
      if (asking) setAsking(false)
      else tryClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <Card>
      {/* THE WAY OUT, where people look for it. The action bar's Close is
          still there and still pinned; this is the corner one, and it is
          red because it is the only control on this panel that throws work
          away. */}
      {onClose && (
        <button type="button" className="xclose" onClick={tryClose}
                aria-label={unsaved > 0 && rating
                  ? `Close without saving ${unsaved} rated KRA${unsaved === 1 ? '' : 's'}`
                  : 'Close this review'}
                title="Close">
          <span aria-hidden="true">×</span>
        </button>
      )}
      {asking && (
        <div className="closeask" role="alertdialog" aria-label="Discard this review?">
          <div className="t">Discard this review?</div>
          <div className="k">
            {unsaved === 1
              ? 'One KRA has your rating or your reason on it.'
              : `${unsaved} KRAs have your rating or your reason on them.`}
            {' '}Nothing here is saved until you send it on.
          </div>
          <div className="row">
            <button className="btn red sm" type="button" onClick={close}>
              Discard
            </button>
            <button className="btn ghost sm" type="button" autoFocus
                    onClick={() => setAsking(false)}>
              Keep editing
            </button>
          </div>
        </div>
      )}
      {/* WHO, WHICH RUNG, AND HOW THE TWO SCORES STAND, before any KRA. The
          panel used to open straight onto KRA 1 with the person's name in a
          card title and their score nowhere — orientation the reader had to
          assemble from four separate places. */}
      <div className="phead">
        <div className="ava" aria-hidden="true">{initials(member.name)}</div>
        <div className="who">
          <div className="nm" style={BREAK}>{member.name}</div>
          <div className="meta">
            <span>{member.code}</span>
            <span>·</span>
            <span>{lines?.length ?? 0} KRAs, weightage {total}</span>
            {myRung && <><span>·</span><span>You are <b>{STAGE_SHORT[myRung]}</b> on this</span></>}
          </div>
          <div className="k" style={{ marginTop: 6, lineHeight: 1.6 }}>
            {!rating
              ? 'The KRA form as they filled it, read-only.'
              : finalises
                ? 'Yours is the last review. What you settle here is the rating they are told.'
                : 'Read it, score it, and send it up the chain.'}
          </div>
        </div>
        {cmp.total > 0 && (
          <div className="scores">
            <div className="sc">
              <div className="l">They said</div>
              <div className="v">{cmp.selfScore === null ? '—' : cmp.selfScore.toFixed(2)}</div>
            </div>
            {rating && (
              <div className="sc mine">
                <div className="l">You say</div>
                <div className="v">{cmp.myScore === null ? '—' : cmp.myScore.toFixed(2)}</div>
              </div>
            )}
            {rating && cmp.delta !== null && cmp.delta !== 0 && (
              <div className="sc gap">
                <div className="l">Difference</div>
                <div className="v">{cmp.delta > 0 ? `+${cmp.delta}` : cmp.delta}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* HOW FAR THROUGH THIS IS, pinned so it is still there at the fourth
          KRA. The only progress signal used to be the blocker banner at the
          very bottom — which means the answer to "how much is left" was
          below the thing you were asking it about. Rendered only while there
          is rating to do: a read-only viewer has no progress to make. */}
      {rating && cmp.total > 0 && (
        <div className="ratebar">
          <div className="lead">
            {cmp.rated === cmp.total
              ? <>All {cmp.total} rated <span className="sm">· check the comparison below</span></>
              : <>{cmp.rated} of {cmp.total} rated <span className="sm">· {cmp.total - cmp.rated} to go</span></>}
          </div>
          <div className={`bar${cmp.rated === cmp.total ? ' green' : ''}`}>
            <span style={{ width: `${(cmp.rated / cmp.total) * 100}%` }} />
          </div>
          {/* ONE CHIP PER KRA, coloured by state and clickable. "Which one
              still needs me" was a question you answered by scrolling past
              the ones that did not. */}
          <div className="ksteps" role="group" aria-label="Jump to a KRA">
            {cmp.lines.map((l, i) => {
              const needs = l.needsReason && !l.hasReason
              const done = l.mine != null && !needs
              return (
                <button key={l.goalId} type="button"
                        className={`kstep${done ? ' done' : needs ? ' needs' : ''}`}
                        title={`${l.title}${done ? ' — done' : needs ? ' — needs a reason' : ' — not rated'}`}
                        aria-label={`Go to ${l.title}`}
                        onClick={() => jump(l.goalId)}>
                  {i + 1}
                </button>
              )
            })}
          </div>
          {cmp.missingReasons.length > 0 && (
            <span className="pill p-amber">
              {cmp.missingReasons.length} need{cmp.missingReasons.length === 1 ? 's' : ''} a reason
            </span>
          )}
          {/* FOLDING IS OFFERED, NOT DONE. One button, saying exactly how
              many cards it will put away. */}
          {foldableLeft > 0 && (
            <button className="btn ghost sm" type="button"
                    onClick={() => setFolded(p => {
                      const n = { ...p }
                      for (const id of doneIds) n[id] = true
                      return n
                    })}>
              Hide the {foldableLeft} done
            </button>
          )}
        </div>
      )}
      {loading || lines === null ? <div className="k">Loading their form…</div>
        : !lines.length ? (
          <div style={{ padding: '18px 14px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing written yet</div>
            <div className="k">They have not saved any KRAs for this period.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {lines.map(l => {
              // The line's own place in the comparison, so the card can show
              // its state without each piece re-deriving it.
              const c = l.goalId ? cmp.lines.find(x => x.goalId === l.goalId) : undefined
              const mine = l.goalId ? rate?.[l.goalId]?.rating ?? null : null
              // "needs" outranks "rated": a rating whose difference is
              // unexplained is the state that stops the whole set, so it is
              // the one the stripe should be showing.
              // THE SCORE IS THE COLOUR. `scored` paints the stripe and a
              // wash from the ramp; `needs` adds the blocking ring on top,
              // because an unexplained difference has to stay visible on a
              // card that is already carrying a colour.
              const tone = ratingTone(mine, bands)
              const stripe = (tone ? ' scored' : mine != null ? ' rated' : '')
                           + (c?.needsReason && !c.hasReason ? ' needs' : '')
              const foldable = !!(rating && l.goalId)
              const isFolded = !!(l.goalId && folded[l.goalId])
              const bl = l.selfRating == null ? null : bandFor(l.selfRating, bands)
              return (
              <div key={l.seqNo} className={`card kcard${stripe}${isFolded ? ' folded' : ''}`}
                   style={{ margin: 0, ...toneVars(tone) }}>
                {/* THE HEAD IS THE FOLD CONTROL. The whole row is the hit
                    target rather than a chevron somebody has to aim at —
                    and when there is nothing to fold (a read-only viewer,
                    or a KRA with no goal id to key the state on) it is a
                    plain div, not a button that does nothing. */}
                {/* THE HEAD IS THE FOLD CONTROL when there is something
                    to fold. The whole row is the hit target rather than a
                    chevron somebody has to aim at — and for a read-only
                    viewer, or a KRA with no goal id to key the fold state
                    on, it stays a plain row rather than a button that does
                    nothing when pressed. */}
                {(() => {
                  const head = (
                    <>
                      <b style={BREAK}>{l.seqNo}. {l.title || <span className="k">untitled</span>}</b>
                      <span className="pill p-brand">{l.weightage}%</span>
                      {l.category && <span className="pill p-grey">{l.category.toLowerCase()}</span>}
                      {l.status && <span className={`pill ${l.status === 'LOCKED' ? 'p-green' : 'p-amber'}`}>
                        {l.status.replace(/_/g, ' ').toLowerCase()}
                      </span>}
                      {/* CARRIED_FORWARD is worth surfacing: a set that is
                          last quarter's, unchanged, is a different thing to
                          approve than one written fresh. */}
                      {l.source === 'CARRIED_FORWARD' &&
                        <span className="pill p-blue">carried forward</span>}
                      {foldable && (
                        <span className="fold">
                          {/* The state in a word, so a folded row still says
                              whether it is finished or still owed. */}
                          {c?.needsReason && !c.hasReason ? 'needs a reason'
                            : mine != null ? 'done' : 'not rated'}
                          <span className="caret" aria-hidden="true">▾</span>
                        </span>
                      )}
                    </>
                  )
                  return foldable ? (
                    <button type="button" className="khead" aria-expanded={!isFolded}
                            onClick={() => fold(l.goalId!, !isFolded)}>
                      {head}
                    </button>
                  ) : (
                    <div className="khead" style={{ cursor: 'default' }}>{head}</div>
                  )
                })()}

                {isFolded ? (
                  // Everything the open card would have said about the
                  // decision, on one line — so folding loses the evidence,
                  // never the judgement.
                  <div className="kfold">
                    <span>They said <b>{l.selfRating ?? '—'}</b></span>
                    <span aria-hidden="true">·</span>
                    <span>You said <b>{mine ?? '—'}</b></span>
                    {c?.delta != null && c.delta !== 0 && (
                      <span className={`pill ${c.flag === 'MAJOR_GAP' ? 'p-amber' : 'p-blue'}`}>
                        {c.delta > 0 ? `+${c.delta}` : c.delta}
                      </span>
                    )}
                    {c?.hasReason && <span className="pill p-green">reason given</span>}
                  </div>
                ) : (
                <>
                {/* THE EVIDENCE, as label-and-value rows rather than five
                    stacked blocks. Twenty label rows for four KRAs was most
                    of the panel's height and none of its information. */}
                <div className="ev">
                  <div className="row">
                    <div className="l">How it is measured</div>
                    <div className="v" style={BREAK}>{l.kpi || '—'}</div>
                  </div>
                  <div className="row">
                    <div className="l">Target</div>
                    <div className="v" style={BREAK}>{l.target || '—'}</div>
                  </div>
                  <div className="row">
                    <div className="l">They delivered</div>
                    <div className="v" style={BREAK}>
                      {l.achievement || <i className="k">Nothing recorded.</i>}
                    </div>
                  </div>
                </div>

                {/* THE TWO RATINGS, SIDE BY SIDE. Theirs sat above the
                    achievement text and yours below it — about 100px apart
                    with prose in between, when comparing the two IS the
                    task. */}
                <div className="vs2">
                  <div className="side">
                    <div className="l">They rated themselves</div>
                    <div className="theirs">
                      {l.selfRating == null
                        ? <span className="k">Not rated</span>
                        : <>
                            <span className="n">{l.selfRating}</span>
                            {bl && <span className="bl">{bl.label}</span>}
                          </>}
                    </div>
                    {l.selfComment && (
                      <div className="k" style={{ marginTop: 5, ...BREAK }}>
                        &ldquo;{l.selfComment}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* YOUR RATING, ON THE SAME SCREEN AS THE APPROVAL.
                      Rating and approving used to be two tabs, and the chain
                      then stalled on its own rule: 199 will not let the HOD
                      settle a rating until every rung ahead has rated, so a
                      manager who approved without visiting Rate My Team
                      passed the set up and blocked it there. Reading the
                      KRA, scoring it and approving are one judgement, so
                      they are one screen. */}
                  {rating && onRate && l.goalId ? (
                    <div className="side" style={{ minWidth: 0 }}>
                      <div className="l">Your rating</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap',
                                    alignItems: 'center' }}>
                        <RatingChips bands={bands}
                                     value={rate?.[l.goalId!]?.rating ?? null}
                                     label={`Your rating for ${l.title}`}
                                     onPick={v => onRate(l.goalId!, { rating: v })} />
                        {/* WHAT THE NUMBER MEANS, in words, next to it. The
                            band labels existed only in a title attribute:
                            invisible on touch, and on a desktop visible only
                            to somebody who already suspected there was
                            something to hover. A manager choosing between 3
                            and 4 is choosing between two words, not two
                            digits. */}
                        {mine != null && (
                          <span className="bandname">
                            {bandFor(mine, bands)?.label ?? ''}
                            {c?.delta != null && c.delta !== 0 && (
                              <span className="vs">
                                {c.delta > 0 ? `${c.delta} above` : `${-c.delta} below`} their own
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <textarea className="why" rows={1} id={whyId(l.goalId)}
                             style={{ marginTop: 8 }}
                             aria-label={`Why you rated ${l.title} this way`}
                             placeholder={
                               // The ask changes when the numbers disagree,
                               // because that is when the sentence matters.
                               rate?.[l.goalId]?.rating != null
                               && l.selfRating != null
                               && rate[l.goalId].rating !== l.selfRating
                                 ? `Why ${rate[l.goalId].rating} and not their ${l.selfRating}? They will read this.`
                                 : 'A line on why — they will read this.'}
                             value={rate?.[l.goalId!]?.comment ?? ''}
                             onChange={e => onRate(l.goalId!, { comment: e.target.value })} />
                    </div>
                  ) : null}
                </div>
                </>
                )}
              </div>
              )
            })}
          </div>
        )}
      {/* THE TICK AND THE APPROVAL, under the thing they are about. A manager
          who has just read and scored every KRA is in the right place to say
          the conversation happened and send it on; making them go back to a
          queue to do it is how the two came apart in the first place. */}
      {myRung && onApprove && (
        <>
          {/* The summary of the judgement just made, before the act that
              records it. Placed between the KRAs and the approval because
              that is the order the decision happens in. */}
          <div style={{ marginTop: 14 }}>
            <RatingSummary s={cmp} onJump={g => {
              const el = document.getElementById(whyId(g))
              // scrollIntoView then focus, not focus alone: focus scrolls the
              // box into view at the very edge of the viewport, which hides
              // the KRA it belongs to and leaves the rater typing a reason
              // for something they cannot see.
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              el?.focus({ preventScroll: true })
            }} />
          </div>

          {onOverallComment && (
            <div className="fld" style={{ marginTop: 14, marginBottom: 0 }}>
              <label htmlFor="rm-overall">Overall comment (optional)</label>
              <textarea id="rm-overall" value={overallComment ?? ''}
                        onChange={e => onOverallComment(e.target.value)}
                        placeholder="The appraisal as a whole, in your words. Evidence, not adjectives — they read this." />
              <div className="k" style={{ marginTop: 4 }}>
                Held back until the result is published. The per-KRA reasons
                above are separate; this is the one line about the year.
              </div>
            </div>
          )}

          {onConfirm && (
            // A STEP, NOT A STRAY CHECKBOX. It is one of the four things
            // the approval gate checks, and it used to float unframed
            // between two cards looking like a footnote. The box turns
            // green when it is ticked so the state reads without finding
            // the tick itself.
            <div className={`step1on1${alreadyConfirmed || confirmed ? ' on' : ''}`}>
              <label className="checkline" title={CONFIRM_LABEL[myRung]}>
                <input type="checkbox"
                       checked={alreadyConfirmed || !!confirmed}
                       disabled={alreadyConfirmed}
                       onChange={e => onConfirm(e.target.checked)} />
                <div>
                  <b>{CONFIRM_LABEL[myRung]}</b>
                  <div className="k" style={{ marginTop: 3 }}>{CONFIRM_WHY[myRung]}</div>
                  {alreadyConfirmed && (
                    <div className="k" style={{ marginTop: 4, color: 'var(--ez-positive)',
                                                fontWeight: 600 }}>
                      Already on record — you confirmed this earlier.
                    </div>
                  )}
                </div>
              </label>
            </div>
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
            // EVERY DIFFERENCE IS EXPLAINED before it goes on. Enforced here
            // and not only suggested in the panel: a reason that can be
            // skipped is a reason that is skipped, and the record then has a
            // number with nothing behind it. Agreeing with the employee needs
            // no justification, so this blocks nobody who scored them as they
            // scored themselves.
            const reasoned = cmp.missingReasons.length === 0
            const ready = allRated && ticked && frOk && reasoned
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
                        {!reasoned && (
                          <li>Say why where your rating differs from theirs —
                            {' '}{cmp.missingReasons.length} still unexplained
                            {' '}({cmp.missingReasons.map(m => m.title).join(', ')}).</li>
                        )}
                        {!ticked && <li>Confirm the one-to-one above.</li>}
                        {!frOk && <li>Give the final rating ({lo}&ndash;{hi}).
                          Yours is the last approval, so this is the number
                          they are told.</li>}
                      </ul>
                    </div>
                  </div>
                )}
                {/* THE ACTION, PINNED. It used to sit 1900px below the
                    first thing the reviewer had to read — and so did every
                    word explaining why it was disabled, which is the half
                    that matters when it is. Sticky to the bottom of the
                    viewport for as long as the panel is taller than it. */}
                <div className="actionbar">
                  {!ready && (
                    <div className="blockers">
                      {/* The short form of the banner above, beside the
                          control it blocks. Naming them here is what stops
                          "Not ready to send on" being a button that refuses
                          without saying why. */}
                      {!allRated && <span className="b">{total - rated.length} still unrated</span>}
                      {!reasoned && <span className="b">
                        {cmp.missingReasons.length} need{cmp.missingReasons.length === 1 ? 's' : ''} a reason
                      </span>}
                      {!ticked && <span className="b">Confirm the one-to-one</span>}
                      {!frOk && <span className="b">Final rating missing</span>}
                    </div>
                  )}
                  <div className="row">
                    {finalises && (
                      <div className="fld" style={{ margin: 0, maxWidth: 250 }}>
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
                    <div className="grow" />
                    {onClose && (
                      // THE SAME GUARD as the corner ×. Two ways out that
                      // behave differently about losing work is worse than
                      // either one alone.
                      <button className="btn ghost" type="button" onClick={tryClose}>Close</button>
                    )}
                    <button className="btn" type="button" disabled={!ready || saving}
                            onClick={() => onApprove(finalises ? fr ?? undefined : undefined)}>
                      {saving ? 'Sending…'
                        : !ready ? 'Not ready to send on'
                        : finalises ? 'Rate, confirm and finalise'
                        : 'Rate, confirm and approve'}
                    </button>
                  </div>
                </div>
              </>
            )
          })()}
        </>
      )}

      {!rating && onClose && (
        <div className="btnrow">
          <button className="btn ghost sm" type="button" onClick={close}>Close</button>
        </div>
      )}
    </Card>
  )
}

// ── §4.3 Rate My Team ────────────────────────────────────────────────────

/**
 * One KRA with every rating anybody in the chain has given it.
 *
 * IT USED TO CARRY ONLY "MINE" — one rating, the viewer's, plus the
 * employee's own — because this tab was where a manager rated. It is not any
 * more: rating happens once, while approving the KRA set, and this screen
 * exists to show what each rung actually scored. A shape with one slot for
 * "my rating" cannot answer "what did RM L2 give this", which is the whole
 * question now.
 */
export interface RateRow {
  goalId: string; title: string; category: Line['category']; weightage: number
  achievement: string
  /**
   * Keyed by pms_reviews.rater_role. SELF is the employee's own; the rest are
   * the rungs. Absent means that rung has not rated this KRA — distinct from
   * a rating of null, which would mean they opened it and left it blank.
   */
  by: Partial<Record<RaterRole, { rating: number | null; comment: string }>>
}

/** The rungs this screen reports, in chain order, after the employee. */
export const CHAIN_RATERS: RaterRole[] = ['RM_L1', 'RM_L2', 'HOD']

/**
 * One rating, on the same red-yellow-green ramp the review panel uses.
 *
 * Reusing ratingTone rather than a second set of colours is the point: a 2
 * that is orange while being given must not be a different orange when it is
 * read back here, or the two screens are quietly disagreeing about the same
 * number.
 *
 * NOT RATED IS A DASH, NOT A ZERO AND NOT A COLOUR. A rung that has not got
 * to this KRA yet has not judged it badly.
 */
function RatingDot({ v, bands }: { v: number | null; bands: Band[] }) {
  if (v === null || v === undefined) return <span className="k">—</span>
  const b = bandFor(v, bands)
  return (
    <span className="rdot" style={toneVars(ratingTone(v, bands))}
          title={b ? `${v} · ${b.label}` : String(v)}>
      {v}
    </span>
  )
}

/**
 * §4.3 — WHAT THE CHAIN SCORED. Read-only, deliberately and entirely.
 *
 * Requested: "nobody can give a rating from Rate My Team — it is just for
 * reference of R1, R2, HOD, to show how much rating is given by each. Rating
 * will only be given while approving the KRA from KRA Approval &
 * One-to-One."
 *
 * WHY THAT IS THE RIGHT WAY ROUND, beyond being what was asked for. Rating
 * here and approving there were two doors into one act, and the chain kept
 * stalling between them: 199 refuses to let a rung settle anything until
 * every rung ahead has rated, so a manager who approved without visiting
 * this tab passed the set up and blocked it at the next desk. Reading a KRA,
 * scoring it and approving it are one judgement; they are now one screen,
 * and this one is the record of what came out.
 *
 * It also makes the screen honest about something it could never do. A
 * manager opening this tab for a reportee two rungs down could see a rating
 * form they had no authority to submit — pms_reviews would have taken the
 * row, and 197 would then have refused the approval it was for.
 *
 * NOTHING HERE WRITES. There is no onChange, no onSubmit and no state: the
 * only way to change a number on this screen is to go and approve the set.
 */
export function RateTab({ member, rows, bands = DEFAULT_BANDS, members, onPick,
                          today, rules = DEFAULT_RULES, flagRules }: {
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
      <Card title="Whose ratings do you want to see?"
            sub="Every rating the chain has given, side by side. Nothing on this screen can be changed — ratings are given while approving the KRA set.">
        {!onPick
          ? <div className="k">Picking is not available on this screen.</div>
          : <QueueTable
              rules={rules}
              rows={pickable}
              empty="Nobody is with you yet. Ratings appear here as the chain gives them."
              extraHead={<th />}
              extraCell={r => (
                <td>
                  <button type="button" className="btn ghost sm"
                          onClick={() => onPick(r.member.employeeId)}
                          title={`See what the chain has scored ${r.member.name}`}>
                    View
                  </button>
                </td>
              )} />}
      </Card>
    )
  }

  // Which rungs this employee actually has. A collapsed reporting line has no
  // RM L2 for 190 of 395 enrolments, and a column of dashes headed RM L2
  // invites the reader to wonder who is late rather than telling them nobody
  // holds it.
  //
  // OR HAS RATED. Holding the rung is not the only way a rating gets into
  // pms_reviews: the snapshot can be re-resolved, a manager can move, and a
  // chain cleared afterwards leaves rows behind that nobody now occupies.
  // Hiding a column because the rung is empty would hide a REAL RATING
  // somebody gave — the one thing a record screen must never do. A column
  // appears if the rung is held or if there is anything in it.
  const held = heldBy(member)
  const raters = CHAIN_RATERS.filter(
    r => held(r as Stage) || rows.some(x => x.by[r]?.rating != null))
  const lines = (who: RaterRole | 'SELF'): Line[] => rows.map(r => ({
    goalId: r.goalId, title: r.title, category: r.category,
    weightage: r.weightage,
    final: r.by[who as RaterRole]?.rating ?? null,
  }))
  const scoreOf = (who: RaterRole | 'SELF') => score(lines(who), 'final')
  const selfScore = scoreOf('SELF')

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          <b>This screen is a record, not a form.</b> Ratings are given while
          approving the KRA set, in <b>KRA Approval &amp; One-to-One</b> — one
          reading, one score, one approval. What each rung settled on appears
          here as they do it.
        </div>
      </div>

      <div className="grid g5" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Ratings for" value={member.name} note={member.code} />
        <Stat label="They rated themselves"
              value={selfScore === null ? '—' : selfScore.toFixed(2)}
              note={bandFor(selfScore === null ? null : Math.round(selfScore), bands)?.label ?? ''} />
        {raters.map(r => {
          const sc = scoreOf(r)
          const given = rows.filter(x => x.by[r]?.rating != null).length
          return (
            <Stat key={r} label={STAGE_SHORT[r as Stage]}
                  value={sc === null ? '—' : sc.toFixed(2)}
                  note={sc === null ? 'Not rated yet' : `${given} of ${rows.length} rated`} />
          )
        })}
      </div>

      <Card title="Every rating, KRA by KRA"
            sub={`${rows.length} KRAs. A blank cell means that rung has not rated it yet.`}>
        {!rows.length ? (
          <div className="k">No KRAs on record for this period.</div>
        ) : (
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>KRA</th><th className="num">Wt</th>
                <th className="num">Self</th>
                {raters.map(r => <th key={r} className="num">{STAGE_SHORT[r as Stage]}</th>)}
                <th>What was said</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.goalId}>
                  <td style={{ fontWeight: 600, ...BREAK }}>{r.title}</td>
                  <td className="num">{r.weightage}</td>
                  <td className="num"><RatingDot v={r.by.SELF?.rating ?? null} bands={bands} /></td>
                  {raters.map(x => (
                    <td key={x} className="num">
                      <RatingDot v={r.by[x]?.rating ?? null} bands={bands} />
                    </td>
                  ))}
                  <td style={BREAK}>
                    {/* THE COMMENTS ARE THE POINT, not a footnote. A column of
                        numbers says the chain disagreed; only the sentences
                        say why, and this is the one screen where all of them
                        sit together. */}
                    {(['SELF', ...raters] as RaterRole[])
                      .filter(w => r.by[w]?.comment?.trim())
                      .map(w => (
                        <div key={w} className="k" style={{ marginBottom: 3, ...BREAK }}>
                          <b>{w === 'SELF' ? 'Them' : STAGE_SHORT[w as Stage]}:</b>{' '}
                          {r.by[w]!.comment}
                        </div>
                      ))}
                    {!(['SELF', ...raters] as RaterRole[]).some(w => r.by[w]?.comment?.trim())
                      && <span className="k">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
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
