'use client'
// components/pms/EmployeeTabs.tsx — the employee's own PMS. Spec §3.
//
// Six tabs, as the spec names them:
//   My Dashboard · My KRAs · One-to-One Log · Self Rating · My Result · My Analytics
//
// Layout is EZER-PMS-Mockup-v2.html's, drawn in EZER's colours through
// pms.css. Presentational only — every rule it enforces comes from lib/pms,
// so the same rule cannot be one thing here and another in the database.
//
// THE TWO THINGS THIS SCREEN MUST NEVER DO
//
// 1. Show a rating before the result is published. §3.5 is explicit: nothing
//    is visible until then — not the rating, not the manager's comments. A
//    half-published result reaching somebody before their final review
//    conversation is how an appraisal becomes a grievance.
// 2. Let Submit look available when the set cannot be submitted. checkKras()
//    decides that, not the button.

import { useState } from 'react'
import './pms.css'
import { checkKras, canAdd, canDelete, meter, suggestSplit,
         CATEGORIES, CATEGORY_LABEL, type Kra, type Category } from '@/lib/pms/kra'
import { logRows, ackState, waitingOn, canLockWeightage, canPublishResult,
         TYPE_LABEL, TYPE_PURPOSE, DISCUSSION_TYPES, MODES, MODE_LABEL,
         type Log, type DiscussionType, type Mode } from '@/lib/pms/oneToOne'
import { score, gap, byCategory, bandForScore, bandFor, DEFAULT_BANDS,
         type Line } from '@/lib/pms/scoring'
import { STAGES, humanDate, type StageKey } from '@/lib/pms/cycle'
import { DEFAULT_RULES } from '@/lib/pms/cycle'

export type EmpTab = 'dashboard' | 'kras' | 'oneToOne' | 'self' | 'result' | 'analytics'

export const EMP_TABS: { k: EmpTab; label: string; blurb: string }[] = [
  { k: 'dashboard', label: 'My Dashboard',  blurb: 'where you are in the cycle, and what is owed next' },
  { k: 'kras',      label: 'My KRAs',       blurb: 'four to ten, totalling exactly 100' },
  { k: 'oneToOne',  label: 'One-to-One Log',blurb: 'every discussion, and who has acknowledged it' },
  { k: 'self',      label: 'Self Rating',   blurb: 'rate your own delivery on each KRA' },
  { k: 'result',    label: 'My Result',     blurb: 'the final rating and the feedback behind it' },
  { k: 'analytics', label: 'My Analytics',  blurb: 'how you and your manager saw the same work' },
]

// ── shared, at module scope so inputs keep focus ─────────────────────────

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
  label: string; value: React.ReactNode; note?: string
  tone?: 'accent' | 'warn' | 'good' | 'bad'
}) {
  const box = tone === 'accent' ? 'stat accent' : tone === 'warn' ? 'stat warn' : 'stat'
  const val = tone === 'good' ? 'val good' : tone === 'bad' ? 'val bad' : 'val'
  return (
    <div className={box}>
      <div className="lbl">{label}</div>
      <div className={val}>{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner b-amber">
      <span aria-hidden="true">🔒</span>
      <div>{children}</div>
    </div>
  )
}

const RATING_VALUES = [1, 2, 3, 4, 5]

/** The 1-5 chip row from the mockup. A radiogroup, not five buttons — arrow
 *  keys are how somebody rates seven KRAs without reaching for the mouse. */
function Chips({ value, onPick, name, disabled }: {
  value: number | null; onPick: (n: number) => void; name: string; disabled?: boolean
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={name}>
      {RATING_VALUES.map(n => {
        const on = value === n
        const band = bandFor(n)
        return (
          <button key={n} type="button" role="radio" aria-checked={on} disabled={disabled}
                  title={band ? `${n} — ${band.label}` : String(n)}
                  className={on ? 'chip sel' : 'chip'}
                  onClick={() => onPick(n)}>{n}</button>
        )
      })}
    </div>
  )
}

// ── §3.1 My Dashboard ────────────────────────────────────────────────────

export interface Who {
  name: string; code: string; designation?: string | null; department?: string | null
  rmL1?: string | null; rmL2?: string | null; hod?: string | null
}

export function DashboardTab({ who, stages, current, kraCount, weightage, frequency,
                               periodLabel, lastRating, lastScore, actionLabel, actionNote }: {
  who: Who
  stages: { key: StageKey; state: 'done' | 'active' | 'upcoming' | 'blocked'; detail?: string }[]
  current: StageKey
  kraCount: number; weightage: number
  frequency: string; periodLabel: string
  lastRating: number | null; lastScore: number | null
  actionLabel: string; actionNote: string
}) {
  const setOk = kraCount >= DEFAULT_RULES.minKra && weightage === DEFAULT_RULES.totalWeightage
  const band = bandFor(lastRating)
  return (
    <>
      <Card title={`${who.name} · ${who.code}`}
            sub={[who.designation, who.department,
                  who.rmL1 && `RM L1: ${who.rmL1}`, who.rmL2 && `RM L2: ${who.rmL2}`,
                  who.hod && `HOD: ${who.hod}`].filter(Boolean).join(' · ')}>
        <div className="stepper">
          {STAGES.map((s, i) => {
            const st = stages.find(x => x.key === s.key)
            const cls = st?.state === 'done' ? 'step done'
                      : s.key === current ? 'step now' : 'step'
            return (
              <div className={cls} key={s.key}>
                <div className="dot">{i + 1}</div>
                <div className="t">{s.label}</div>
                <div className="d">{st?.detail ?? ''}</div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Owed from you" value={actionLabel} note={actionNote} />
        <Stat label="My KRAs" value={kraCount}
              note={setOk
                ? `Totalling ${weightage} — the set is valid`
                : `Totalling ${weightage}. Needs ${DEFAULT_RULES.minKra}–${DEFAULT_RULES.maxKra} KRAs at exactly ${DEFAULT_RULES.totalWeightage}`}
              tone={setOk ? undefined : 'warn'} />
        <Stat label="How often" value={frequency} note={periodLabel} />
        <Stat label="Last time"
              value={lastRating === null ? '—' : `${lastRating}${band ? ` · ${band.label}` : ''}`}
              note={lastScore === null ? 'No previous period on record' : `Weighted score ${lastScore}`} />
      </div>

      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          This is a <b>developmental</b> review. The rating is not linked to any
          increment, variable pay, bonus or CTC — it exists to give you feedback and
          to decide what support you get next. Recognition here is a certificate, a
          nomination or an award, never a cash component.
        </div>
      </div>
    </>
  )
}

// ── §3.2 My KRAs ─────────────────────────────────────────────────────────

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving }: {
  kras: Kra[]
  onChange: (next: Kra[]) => void
  locked: boolean
  lockGate: { open: boolean; because: string }
  onSubmit: () => void
  saving?: boolean
}) {
  const check = checkKras(kras)
  const m = meter(check)
  const add = canAdd(kras)
  const del = canDelete(kras)

  const set = (i: number, patch: Partial<Kra>) =>
    onChange(kras.map((k, j) => j === i ? { ...k, ...patch } : k))

  return (
    <>
      {locked ? (
        <Locked>
          Your weightages are <b>locked</b>. They were settled in the KRA one-to-one and
          acknowledged by both of you, which is what makes them the thing your rating is
          measured against. A change now needs your manager to reopen them.
        </Locked>
      ) : (
        <div className="banner b-amber">
          <span aria-hidden="true">⚠️</span>
          <div>
            You write your own KRAs and weightages — but a <b>one-to-one with your
            manager is required before they lock</b>. {lockGate.because}
          </div>
        </div>
      )}

      <div className="wmeter">
        <div className={`big ${m.tone === 'good' ? 'ok' : m.tone === 'bad' ? 'bad' : ''}`}>
          {check.total}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className={`bar ${m.tone === 'good' ? 'green' : m.tone === 'bad' ? 'red' : 'amber'}`}
               style={{ marginBottom: 6 }}
               role="progressbar" aria-valuenow={check.total} aria-valuemin={0}
               aria-valuemax={DEFAULT_RULES.totalWeightage} aria-label="Total weightage">
            <span style={{ width: `${m.pct}%` }} />
          </div>
          <div className="k">
            {m.says} · {check.count} {check.count === 1 ? 'KRA' : 'KRAs'}{' '}
            (minimum {DEFAULT_RULES.minKra}, maximum {DEFAULT_RULES.maxKra})
          </div>
        </div>
        {!locked && (
          <button className="btn ghost sm" type="button" disabled={!add.allowed}
                  title={add.reason}
                  onClick={() => onChange([...kras, {
                    seq_no: kras.length + 1, kra_title: '', kpi_metric: '',
                    target_value: '', category: 'BUSINESS', weightage: 0,
                  }])}>
            + Add KRA
          </button>
        )}
      </div>

      <Card title="My KRAs"
            sub={`At least ${DEFAULT_RULES.minKra}, at most ${DEFAULT_RULES.maxKra}, and the weightages must total exactly ${DEFAULT_RULES.totalWeightage}.`}>
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>KRA / objective</th><th>KPI metric</th><th>Target</th>
                <th>Category</th><th style={{ width: 104 }} className="num">Weightage</th>
                {!locked && <th style={{ width: 40 }}><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {kras.length === 0 ? (
                <tr><td colSpan={locked ? 6 : 7} style={{ textAlign: 'center', padding: '22px 14px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing written yet</div>
                  <div className="k">
                    Add {DEFAULT_RULES.minKra} to {DEFAULT_RULES.maxKra} KRAs. They are what
                    your rating will be measured against, so they are worth the time.
                  </div>
                </td></tr>
              ) : kras.map((k, i) => {
                const thin = check.thin.includes(k.seq_no)
                return (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td><input value={k.kra_title} readOnly={locked} aria-label={`KRA ${i + 1} title`}
                               placeholder="What you are accountable for"
                               onChange={e => set(i, { kra_title: e.target.value })} /></td>
                    <td><input value={k.kpi_metric} readOnly={locked} aria-label={`KRA ${i + 1} metric`}
                               placeholder="How it is measured"
                               onChange={e => set(i, { kpi_metric: e.target.value })} /></td>
                    <td><input value={k.target_value} readOnly={locked} aria-label={`KRA ${i + 1} target`}
                               placeholder="The number to hit"
                               onChange={e => set(i, { target_value: e.target.value })} /></td>
                    <td>
                      <select value={k.category} disabled={locked} aria-label={`KRA ${i + 1} category`}
                              onChange={e => set(i, { category: e.target.value as Category })}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <input type="number" min={0} max={100} value={k.weightage} readOnly={locked}
                             aria-label={`KRA ${i + 1} weightage`}
                             aria-invalid={thin || undefined}
                             style={thin ? { borderColor: 'var(--ez-critical)' } : undefined}
                             onChange={e => set(i, { weightage: Number(e.target.value) || 0 })} />
                    </td>
                    {!locked && (
                      <td>
                        <button className="btn ghost sm" type="button" disabled={!del.allowed}
                                title={del.reason ?? 'Remove this KRA'}
                                aria-label={`Remove KRA ${i + 1}`}
                                onClick={() => onChange(kras.filter((_, j) => j !== i)
                                  .map((x, j) => ({ ...x, seq_no: j + 1 })))}>×</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {check.faults.length > 0 && (
          <div className="banner b-red" style={{ marginTop: 14, marginBottom: 0 }}>
            <span aria-hidden="true">!</span>
            <div>
              <b>Before this can be sent:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {check.faults.map((f, i) => (
                  <li key={i}>{f.seq !== null && <b>KRA {f.seq}: </b>}{f.says}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!locked && (
          <div className="btnrow">
            <button className="btn" type="button" disabled={!check.canSubmit || saving}
                    onClick={onSubmit}>
              {saving ? 'Saving…'
                : check.canSubmit ? 'Send to my manager'
                : `Cannot send yet — ${check.faults.length} to fix`}
            </button>
            {check.total !== DEFAULT_RULES.totalWeightage && kras.length > 0 && (
              <button className="btn ghost" type="button"
                      onClick={() => onChange(kras.map((k, i) =>
                        ({ ...k, weightage: suggestSplit(kras.length)[i] })))}>
                Split {DEFAULT_RULES.totalWeightage} evenly
              </button>
            )}
          </div>
        )}
      </Card>
    </>
  )
}

// ── §3.3 One-to-One Log ──────────────────────────────────────────────────

export function OneToOneTab({ logs, managerName, onLog, saving }: {
  logs: Log[]; managerName: string
  onLog?: (l: Log) => void; saving?: boolean
}) {
  const [type, setType] = useState<DiscussionType>('KRA_SETTING')
  const [date, setDate] = useState('')
  const [mode, setMode] = useState<Mode>('IN_PERSON')
  const [points, setPoints] = useState('')
  const lock = canLockWeightage(logs)
  const publish = canPublishResult(logs)
  const rows = logRows(logs)

  return (
    <>
      <div className={lock.open ? 'banner b-green' : 'banner b-amber'}>
        <span aria-hidden="true">{lock.open ? '✓' : '⚠️'}</span>
        <div>{lock.open
          ? <>The KRA one-to-one is acknowledged by both of you, so your <b>weightages are locked</b>.</>
          : <>Your weightages are <b>not locked yet</b>. {lock.because}</>}</div>
      </div>

      <Card title="One-to-one discussion log"
            sub="Every discussion stays on record — KRA setting, mid-period, and the final review.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>With</th><th>What was discussed</th>
                <th>You</th><th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const st = ackState(l)
                return (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.discussion_date ? humanDate(l.discussion_date) : '—'}
                    </td>
                    <td>
                      <span className={`pill ${l.discussion_type === 'KRA_SETTING' ? 'p-brand'
                        : l.discussion_type === 'MID_PERIOD' ? 'p-blue'
                        : l.discussion_type === 'FINAL_REVIEW' ? 'p-amber' : 'p-grey'}`}>
                        {TYPE_LABEL[l.discussion_type]}
                      </span>
                    </td>
                    <td>{managerName || '—'}</td>
                    <td className={l.placeholder ? 'k' : undefined}>
                      {l.placeholder
                        ? TYPE_PURPOSE[l.discussion_type]
                        : (l.discussion_points || '—')}
                    </td>
                    <td>{l.employee_ack
                      ? <span className="pill p-green">✓ acknowledged</span>
                      : <span className="pill p-grey">not yet</span>}</td>
                    <td>{l.manager_ack
                      ? <span className="pill p-green">✓ acknowledged</span>
                      : <span className="pill p-grey">not yet</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Both sides have to acknowledge. One tick on its own is a manager asserting a
          conversation happened; two is a record worth relying on later.
          {!publish.open && <> {publish.because}</>}
        </div>
      </Card>

      {onLog && (
        <Card title="Log a discussion" sub="Recorded against this period, and shown to your manager to acknowledge.">
          <div className="grid g3">
            <div className="fld">
              <label htmlFor="o2o-date">Date</label>
              <input id="o2o-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="o2o-type">Type</label>
              <select id="o2o-type" value={type}
                      onChange={e => setType(e.target.value as DiscussionType)}>
                {DISCUSSION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="o2o-mode">How</label>
              <select id="o2o-mode" value={mode} onChange={e => setMode(e.target.value as Mode)}>
                {MODES.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          <div className="fld">
            <label htmlFor="o2o-points">What was discussed</label>
            <textarea id="o2o-points" value={points} onChange={e => setPoints(e.target.value)}
                      placeholder="Weightage changes and why, targets agreed, support asked for" />
          </div>
          <div className="k">{TYPE_PURPOSE[type]}</div>
          <div className="btnrow">
            <button className="btn" type="button" disabled={!date || !points.trim() || saving}
                    onClick={() => { onLog({ discussion_type: type, discussion_date: date,
                                             mode, discussion_points: points, employee_ack: true })
                                     setPoints(''); setDate('') }}>
              {saving ? 'Saving…' : 'Log it and acknowledge'}
            </button>
          </div>
        </Card>
      )}
    </>
  )
}

// ── §3.4 Self Rating ─────────────────────────────────────────────────────

export interface SelfRow {
  goalId: string; title: string; weightage: number; category: Category
  achievement: string; rating: number | null; comment: string
}

export function SelfRatingTab({ rows, onChange, submitted, onSubmit, saving, windowNote }: {
  rows: SelfRow[]
  onChange: (next: SelfRow[]) => void
  submitted: boolean
  onSubmit: () => void
  saving?: boolean
  windowNote?: string
}) {
  const set = (i: number, patch: Partial<SelfRow>) =>
    onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const unrated = rows.filter(r => r.rating === null).length
  const lines: Line[] = rows.map(r => ({
    goalId: r.goalId, title: r.title, category: r.category,
    weightage: r.weightage, self: r.rating,
  }))
  const mine = score(lines, 'self')

  return (
    <>
      {submitted ? (
        <Locked>
          Your self rating is <b>submitted and locked</b>, and your manager&rsquo;s rating
          is now open. It locks at submission on purpose — a self assessment edited after
          seeing a manager&rsquo;s number is not a self assessment.
        </Locked>
      ) : (
        <div className="banner b-blue">
          <span aria-hidden="true">ℹ️</span>
          <div>
            Rate your own delivery on each KRA. Once you submit, this <b>locks</b> and your
            manager can rate — they cannot rate before you.
            {windowNote && <> {windowNote}</>}
          </div>
        </div>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="KRAs rated" value={`${rows.length - unrated} of ${rows.length}`}
              note={unrated ? `${unrated} still to do` : 'All done'}
              tone={unrated ? 'warn' : 'good'} />
        <Stat label="Your weighted score" value={mine === null ? '—' : mine.toFixed(2)}
              note="Weighted by the weightage on each KRA" />
        <Stat label="That lands at"
              value={bandForScore(mine)?.label ?? '—'}
              note={mine === null ? 'Rate every KRA to see this' : 'What your own ratings average to'} />
      </div>

      <Card title="Self rating"
            sub="Your achievement, your rating, and a comment on each KRA. It locks when you submit.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>KRA</th><th className="num">Wt</th><th>What you delivered</th>
                <th>Your rating</th><th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '22px 14px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>No KRAs to rate</div>
                  <div className="k">Your KRA set has to be locked before self rating opens.</div>
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.goalId}>
                  <td style={{ fontWeight: 600 }}>{r.title}</td>
                  <td className="num">{r.weightage}</td>
                  <td><input value={r.achievement} readOnly={submitted}
                             aria-label={`Achievement for ${r.title}`}
                             placeholder="The number you actually hit"
                             onChange={e => set(i, { achievement: e.target.value })} /></td>
                  <td>
                    <Chips value={r.rating} disabled={submitted} name={`Rating for ${r.title}`}
                           onPick={n => set(i, { rating: n })} />
                  </td>
                  <td><input value={r.comment} readOnly={submitted}
                             aria-label={`Comment for ${r.title}`}
                             placeholder="Evidence a manager could check"
                             onChange={e => set(i, { comment: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!submitted && rows.length > 0 && (
          <div className="btnrow">
            <button className="btn" type="button" disabled={unrated > 0 || saving} onClick={onSubmit}>
              {saving ? 'Submitting…'
                : unrated > 0 ? `${unrated} KRA${unrated === 1 ? '' : 's'} still unrated`
                : 'Submit — this locks it'}
            </button>
          </div>
        )}
      </Card>
    </>
  )
}

// ── §3.5 My Result ───────────────────────────────────────────────────────

export function ResultTab({ published, lines, finalRating, finalisedBy, finalisedOn,
                            deptAverage, appreciation, improvement, benefits,
                            onAcknowledge, acknowledged, publishGate }: {
  published: boolean
  lines: Line[]
  finalRating: number | null
  finalisedBy?: string | null
  finalisedOn?: string | null
  deptAverage: number | null
  appreciation?: string | null
  improvement?: string | null
  benefits: { type: string; note: string }[]
  onAcknowledge?: () => void
  acknowledged?: boolean
  publishGate: { open: boolean; because: string }
}) {
  // §3.5: NOTHING is visible before publish. Not the rating, not the comments.
  if (!published) {
    return (
      <Card title="Your result is not published yet">
        <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ez-muted)', maxWidth: 640 }}>
          Nothing is shown here until the result is published — no rating, no scores, no
          manager comments. That is deliberate: a rating that reaches you before the
          conversation does turns a review into a notification.
          {!publishGate.open && (
            <><br /><br /><b>What is outstanding:</b> {publishGate.because}</>
          )}
        </div>
      </Card>
    )
  }

  const selfScore = score(lines, 'self')
  const finalScore = score(lines, 'final')
  const g = gap(selfScore, finalScore)
  const band = bandFor(finalRating)

  return (
    <>
      <div className="banner b-green">
        <span aria-hidden="true">✓</span>
        <div>
          Published{finalisedOn ? ` on ${humanDate(finalisedOn)}` : ''}
          {finalisedBy ? <> · finalised by <b>{finalisedBy}</b></> : null}.
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Final rating"
              value={finalRating === null ? '—' : `${finalRating}${band ? ` · ${band.label}` : ''}`}
              note={finalScore === null ? '' : `Weighted score ${finalScore.toFixed(2)}`} />
        <Stat label="Your own score" value={selfScore === null ? '—' : selfScore.toFixed(2)}
              note={g.delta === null ? '' :
                `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(2)} against the final`} />
        <Stat label="Department average"
              value={deptAverage === null ? '—' : deptAverage.toFixed(2)}
              note={deptAverage === null || finalScore === null ? 'Not available'
                : finalScore >= deptAverage ? 'You are at or above it' : 'You are below it'} />
        <Stat label="Finalised by" value={finalisedBy ?? '—'}
              note={finalisedOn ? humanDate(finalisedOn) : ''} />
      </div>

      <Card title="KRA by KRA" sub="Every rating in the chain, and what each one contributed.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>KRA</th><th className="num">Wt</th><th className="num">You</th>
                <th className="num">RM L1</th><th className="num">RM L2</th>
                <th className="num">Final</th><th className="num">Contributed</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.goalId}>
                  <td style={{ fontWeight: 600 }}>{l.title}</td>
                  <td className="num">{l.weightage}</td>
                  <td className="num">{l.self ?? '—'}</td>
                  <td className="num">{l.rmL1 ?? '—'}</td>
                  <td className="num">{l.rmL2 ?? '—'}</td>
                  <td className="num"><b>{l.final ?? '—'}</b></td>
                  <td className="num">
                    {l.final === null || l.final === undefined
                      ? '—' : ((l.final * l.weightage) / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g3">
        <div className="card">
          <h3>🏆 Appreciation</h3>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ez-ink-soft)' }}>
            {appreciation || <span className="k">Nothing written for this period.</span>}
          </div>
        </div>
        <div className="card">
          <h3>📈 Where to improve</h3>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ez-ink-soft)' }}>
            {improvement || <span className="k">Nothing written for this period.</span>}
          </div>
        </div>
        <div className="card">
          <h3>🎁 Recognition</h3>
          {benefits.length === 0
            ? <div className="k">Nothing recorded for this period.</div>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                {benefits.map((b, i) => <li key={i}><b>{b.type}</b> — {b.note}</li>)}
              </ul>}
          <div className="k" style={{ marginTop: 8 }}>
            Recognition only — a certificate, a nomination or an award. Never a cash component.
          </div>
        </div>
      </div>

      {onAcknowledge && (
        <div className="btnrow">
          <button className="btn" type="button" disabled={acknowledged} onClick={onAcknowledge}>
            {acknowledged ? '✓ You have acknowledged this' : 'Acknowledge that I have read this'}
          </button>
        </div>
      )}
    </>
  )
}

// ── §3.6 My Analytics ────────────────────────────────────────────────────

export function AnalyticsTab({ lines, trend, published }: {
  lines: Line[]
  trend: { period: string; score: number | null }[]
  published: boolean
}) {
  if (!published) {
    return (
      <Card title="Nothing to compare yet">
        <div className="k" style={{ lineHeight: 1.7, maxWidth: 620 }}>
          These charts compare your ratings with your manager&rsquo;s, so they only appear
          once a result has been published. Before that there is nothing to put beside
          your own numbers.
        </div>
      </Card>
    )
  }
  const cats = byCategory(lines, 'final')
  const overall = gap(score(lines, 'self'), score(lines, 'final'))
  const major = lines.filter(l => gap(l.self, l.final).flag === 'MAJOR_GAP')

  return (
    <>
      <Card title="How you and your manager saw the same work"
            sub="The pale bar is your rating, the solid one is the final. A wide difference is a conversation, not a verdict.">
        {lines.map(l => {
          const g = gap(l.self, l.final)
          return (
            <div className="abar" key={l.goalId}>
              <div className="nm">{l.title}</div>
              <div className="tr" role="img"
                   aria-label={`${l.title}: you rated ${l.self ?? 'nothing'}, final ${l.final ?? 'nothing'}`}>
                <div className="s" style={{ width: `${((l.self ?? 0) / 5) * 100}%` }} />
                <div className="m" style={{ width: `${((l.final ?? 0) / 5) * 100}%` }} />
              </div>
              <div className="vv">
                {l.self ?? '—'} → {l.final ?? '—'}
                {g.flag === 'MAJOR_GAP' ? ' ‼' : g.delta === 0 ? ' =' : ''}
              </div>
            </div>
          )
        })}
        <div className={major.length ? 'banner b-amber' : 'banner b-green'}
             style={{ marginTop: 14, marginBottom: 0 }}>
          <span aria-hidden="true">{major.length ? '!' : '✓'}</span>
          <div>
            {major.length
              ? <>Two points or more apart on <b>{major.map(l => l.title).join(', ')}</b>. {gap(0, 2).says}</>
              : <>Overall {overall.says.toLowerCase()}</>}
          </div>
        </div>
      </Card>

      <Card title="Where your strengths are"
            sub="By category, weighted. A low category is where development goes, not a mark against you.">
        {cats.map(c => (
          <div className="abar" key={c.category}>
            <div className="nm">{c.label}</div>
            <div className="tr" role="img" aria-label={`${c.label}: ${c.score ?? 'not rated'} out of 5`}>
              <div className="m" style={{ width: `${((c.score ?? 0) / 5) * 100}%`, height: '100%',
                                          borderRadius: 5 }} />
            </div>
            <div className="vv">{c.score === null ? '—' : c.score.toFixed(2)}</div>
          </div>
        ))}
      </Card>

      <Card title="How this has moved" sub="Your weighted score over the last few periods.">
        {trend.length === 0 ? (
          <div className="k">This is your first completed period, so there is nothing to compare it against yet.</div>
        ) : (
          <div className="tblwrap">
            <table>
              <thead><tr><th>Period</th><th className="num">Score</th><th className="num">Change</th></tr></thead>
              <tbody>
                {trend.map((t, i) => {
                  const prev = i > 0 ? trend[i - 1].score : null
                  const d = t.score !== null && prev !== null ? t.score - prev : null
                  return (
                    <tr key={t.period}>
                      <td>{t.period}</td>
                      <td className="num">{t.score === null ? '—' : t.score.toFixed(2)}</td>
                      <td className="num">
                        {d === null ? '—'
                          : <span className={d > 0 ? 'ok' : d < 0 ? 'bad' : undefined}>
                              {d > 0 ? '+' : ''}{d.toFixed(2)}
                            </span>}
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
