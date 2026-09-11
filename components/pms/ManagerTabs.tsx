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
import { FLAG_LABEL } from '@/lib/pms/employment'
import { canManagerRate, checkFeedback, score, gap, byCategory, bandFor,
         DEFAULT_BANDS, type Line } from '@/lib/pms/scoring'
import { canPublishResult, type Log } from '@/lib/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Role, type Chain, type Finaliser }
  from '@/lib/pms/hierarchy'
import { humanDate } from '@/lib/pms/cycle'
import { DEFAULT_RULES } from '@/lib/pms/cycle'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'deptAnalytics'

export const MGR_TABS: { k: MgrTab; label: string; blurb: string }[] = [
  { k: 'team',      label: 'Team Dashboard',           blurb: 'who is where, worst deadline first' },
  { k: 'approve',   label: 'KRA Approval & One-to-One',blurb: 'check their sets, then log the discussion' },
  { k: 'rate',      label: 'Rate My Team',             blurb: 'rate each KRA against what they delivered' },
  { k: 'pip',       label: 'PIP Request',              blurb: 'raise one — HR decides whether it starts' },
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
          <><b>{notice} {notice === 1 ? 'person is' : 'people are'} serving notice</b> —
          rate them before their last working day, after which the record locks and
          the rating can never be given.{exited > 0 ? ' ' : ''}</>
        )}
        {exited > 0 && (
          <><b>{exited} {exited === 1 ? 'has' : 'have'} already left</b> — still
          finalisable, but read-only once done, and the result is emailed before
          their login closes.</>
        )}
      </div>
    </div>
  )
}

function QueueTable({ rows, extraHead, extraCell, empty }: {
  rows: QueueRow[]
  extraHead?: React.ReactNode
  extraCell?: (r: QueueRow) => React.ReactNode
  empty: string
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
                <span className={r.member.totalWeightage === DEFAULT_RULES.totalWeightage ? 'ok' : 'bad'}>
                  {r.member.totalWeightage}
                </span>
              </td>
              <td>{r.member.oneToOneDone
                ? <span className="pill p-green">✓</span>
                : <span className="pill p-grey">not yet</span>}</td>
              <td>{r.member.selfSubmitted
                ? <span className="pill p-green">submitted</span>
                : <span className="pill p-amber">waiting</span>}</td>
              <td className="num">{r.member.selfScore === null ? '—' : r.member.selfScore.toFixed(2)}</td>
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

export function TeamTab({ members, today, managerName }: {
  members: TeamMember[]; today: string; managerName: string
}) {
  const rows = teamQueue(members, today)
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
      <Card title={`My team — ${managerName}`}
            sub="Ordered by whose deadline cannot move, then by what is actually owed.">
        <QueueTable rows={rows} empty={EMPTY_TEAM} />
      </Card>
    </>
  )
}

// ── §4.2 KRA Approval & One-to-One ───────────────────────────────────────

export function ApproveTab({ members, today, onSendBack, onAcknowledge }: {
  members: TeamMember[]; today: string
  onSendBack?: (id: string, reason: string) => void
  onAcknowledge?: (id: string) => void
}) {
  const [reason, setReason] = useState<Record<string, string>>({})
  const rows = teamQueue(members, today)
    .filter(r => !r.member.selfSubmitted || !r.member.oneToOneDone)

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          A set is valid at <b>{DEFAULT_RULES.minKra} to {DEFAULT_RULES.maxKra} KRAs
          totalling exactly {DEFAULT_RULES.totalWeightage}</b>. Weightage locks only once
          you and they have both acknowledged the KRA one-to-one — one tick is a manager
          asserting a conversation happened, two is a record.
        </div>
      </div>
      <Card title="Waiting on the discussion"
            sub="Sets to check, and the one-to-ones that lock them.">
        <QueueTable
          rows={rows}
          empty="Every set is settled and locked."
          extraHead={<th>Action</th>}
          extraCell={r => {
            const valid = r.member.kraCount >= DEFAULT_RULES.minKra
                       && r.member.kraCount <= DEFAULT_RULES.maxKra
                       && r.member.totalWeightage === DEFAULT_RULES.totalWeightage
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
                          onOverallComment }: {
  member: TeamMember | null
  rows: RateRow[]
  onChange: (next: RateRow[]) => void
  onSubmit: () => void
  saving?: boolean
  overallComment: string
  onOverallComment: (s: string) => void
}) {
  if (!member) {
    return <Card title="Pick somebody to rate">
      <div className="k">Choose a team member from the dashboard. Their KRAs and their own
      ratings appear here beside yours.</div>
    </Card>
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
  const band = bandFor(mine === null ? null : Math.round(mine))
  const fb = checkFeedback(mine === null ? null : Math.round(mine),
                           { appreciation: overallComment })

  const set = (i: number, patch: Partial<RateRow>) =>
    onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))

  if (!canRate.open) {
    return (
      <Card title={`${member.name} — not yet`}>
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
        <Stat label="They rated themselves" value={theirs === null ? '—' : theirs.toFixed(2)} />
        <Stat label="Your score so far" value={mine === null ? '—' : mine.toFixed(2)}
              note={band ? band.label : `${unrated} still unrated`} />
        <Stat tone={g.flag === 'MAJOR_GAP' ? 'warn' : undefined}
              label="Difference" value={g.delta === null ? '—' : g.delta.toFixed(2)}
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
                      {r.selfRating ?? '—'}
                      {rg.flag === 'MAJOR_GAP' && <span className="pill p-amber" style={{ marginLeft: 4 }}>gap</span>}
                    </td>
                    <td>
                      <div className="chips" role="radiogroup" aria-label={`Your rating for ${r.title}`}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} type="button" role="radio" aria-checked={r.myRating === n}
                                  className={r.myRating === n ? 'chip sel' : 'chip'}
                                  title={bandFor(n)?.label}
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

export function PipRequestTab({ members, today, onRaise, saving }: {
  members: TeamMember[]; today: string
  onRaise?: (employeeId: string, areas: PipArea[], support: string) => void
  saving?: boolean
}) {
  const rows = teamQueue(members, today)
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
          formality — the plan is the documentation trail that answers a claim under the
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
                  {r.member.finalRating !== null ? ` — last rated ${r.member.finalRating}` : ''}
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

export function TeamAnalyticsTab({ members, today, lines, deptAverage, companyAverage, scopeLabel }: {
  members: TeamMember[]; today: string
  lines: Line[]
  deptAverage: number | null; companyAverage: number | null
  scopeLabel: string
}) {
  const rows = teamQueue(members, today)
  const dist = distribution(rows)
  const rated = dist.reduce((s, d) => s + d.n, 0)
  const cats = byCategory(lines, 'final')

  return (
    <>
      <Card title={`How ${scopeLabel} was rated`}
            sub="For information. There is no curve to fit — with no pay attached, a forced distribution would be rationing nothing.">
        {rated === 0 ? (
          <div className="k">Nothing has been finalised yet, so there is no distribution to show.</div>
        ) : dist.map(d => {
          const band = bandFor(d.rating)
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
        <Stat label={`${scopeLabel} average`} value={deptAverage === null ? '—' : deptAverage.toFixed(2)} />
        <Stat label="Company average" value={companyAverage === null ? '—' : companyAverage.toFixed(2)} />
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
              <div className="vv">{c.score === null ? '—' : c.score.toFixed(2)}</div>
            </div>
          ))}
      </Card>
    </>
  )
}

// ── §5.1 Review & Finalise ───────────────────────────────────────────────

export function FinaliseTab({ members, today, role, chain, whoCanFinalise, deptName,
                              onFinalise, onNudge, saving }: {
  members: TeamMember[]; today: string
  role: Role; chain: Chain; whoCanFinalise: Finaliser
  deptName: string
  onFinalise?: (id: string, rating: number) => void
  onNudge?: (id: string) => void
  saving?: boolean
}) {
  const rows = finaliseQueue(members, today, { role, chain, whoCanFinalise })
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
          be finalised while a step ahead of it is still open — that is not a nicety, it is
          the difference between a rating that went through the chain and one that skipped it.
        </div>
      </div>
      <ExitBanner rows={rows} />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Awaiting finalisation" value={awaiting} note={`of ${rows.length}`} />
        <Stat label="Finalised" value={done} />
        <Stat tone={urgent ? 'warn' : undefined} label="Exit or notice" value={urgent}
              note={urgent ? 'Clear these first — their deadline cannot move' : 'None outstanding'} />
        <Stat label={`${deptName} average`} value={avg === null ? '—' : avg.toFixed(2)} />
      </div>

      <Card title={`Finalisation queue — ${deptName}`}
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
                  <td className="num">{r.member.selfScore?.toFixed(2) ?? '—'}</td>
                  <td className="num">{r.member.rmL1Score?.toFixed(2) ?? '—'}</td>
                  <td className="num">{r.member.rmL2Score?.toFixed(2) ?? '—'}</td>
                  <td>
                    {r.member.finalised
                      ? <span className="pill p-green">{r.member.finalRating} · finalised</span>
                      : <select aria-label={`Final rating for ${r.member.name}`}
                                disabled={!r.canFinalise}
                                value={picked[r.member.employeeId] ?? ''}
                                onChange={e => setPicked(p => ({ ...p,
                                  [r.member.employeeId]: Number(e.target.value) }))}>
                          <option value="">Choose</option>
                          {DEFAULT_BANDS.map(b => (
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

export function FeedbackTab({ member, rating, appreciation, improvement, benefits, logs,
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
}) {
  if (!member) {
    return <Card title="Pick somebody">
      <div className="k">Choose a person from the finalisation queue to write their feedback.</div>
    </Card>
  }
  const check = checkFeedback(rating, { appreciation, improvement })
  const publish = canPublishResult(logs)
  const band = bandFor(rating)
  const canPublish = check.ok && publish.open

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Writing feedback for" value={member.name} note={member.code} />
        <Stat label="Final rating"
              value={rating === null ? '—' : `${rating}${band ? ` · ${band.label}` : ''}`} />
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
            sub="Non-monetary only — a certificate, a nomination, an award. Anything with a cash component would touch payroll, and this module does not.">
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
