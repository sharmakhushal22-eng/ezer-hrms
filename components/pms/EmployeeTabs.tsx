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
         type Log, type DiscussionType, type Mode, type WeightageChange } from '@/lib/pms/oneToOne'
import { score, gap, byCategory, bandForScore, bandFor, DEFAULT_BANDS, type Band,
         type Line } from '@/lib/pms/scoring'
import { STAGES, humanDate, type StageKey } from '@/lib/pms/cycle'
import { DEFAULT_RULES, type Rules } from '@/lib/pms/cycle'

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
function Chips({ value, onPick, name, disabled, bands = DEFAULT_BANDS }: {
  value: number | null; onPick: (n: number) => void; name: string; disabled?: boolean
  bands?: Band[]
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={name}>
      {RATING_VALUES.map(n => {
        const on = value === n
        const band = bandFor(n, bands)
        return (
          <button key={n} type="button" role="radio" aria-checked={on} disabled={disabled}
                  title={band ? `${n}: ${band.label}` : String(n)}
                  className={on ? 'chip sel' : 'chip'}
                  onClick={() => onPick(n)}>{n}</button>
        )
      })}
    </div>
  )
}

// ── where it is in the chain, and why it came back ───────────────────────

/**
 * The one thing a rejection is for.
 *
 * 197 refuses a rejection without a remark, on the argument that sending
 * somebody back to guess what to change gets the same set returned wrong a
 * second time. That argument only holds if the employee SEES the remark —
 * and nothing did. sent_back_reason has existed since 066 and was written by
 * the manager's send-back for just as long, with no screen anywhere reading
 * it. The employee got a set back with no idea why.
 *
 * So the remark is a banner, not a field in a tab they might not open, and it
 * is critical-coloured because it is the only thing on the screen that is
 * asking them to do something.
 *
 * Stage without a remark is the ordinary case — it says who is holding the
 * appraisal, which otherwise an employee can only infer from which buttons
 * have gone quiet.
 */
export function ChainBanner({ stage, sentBackReason, sentBackAt }: {
  stage?: string | null
  sentBackReason?: string | null
  sentBackAt?: string | null
}) {
  // Not submitted yet, or finished. Neither needs narrating: the KRA tab's own
  // state says the first, and the Result tab says the second.
  if (!stage || stage === 'DONE') return null

  const backWithYou = stage === 'EMPLOYEE'

  if (backWithYou && sentBackReason) {
    return (
      <div className="banner b-red">
        <span aria-hidden="true">↩️</span>
        <div>
          <strong>Sent back to you{sentBackAt ? ` on ${sentBackAt.slice(0, 10)}` : ''}.</strong>{' '}
          Change what is asked for below and send it again.
          <div style={{ marginTop: 6, fontStyle: 'italic' }}>“{sentBackReason}”</div>
        </div>
      </div>
    )
  }

  // Back with the employee but no reason recorded: a pre-197 send-back, or a
  // row whose remark did not save. Say so plainly rather than inventing one.
  if (backWithYou) {
    return (
      <div className="banner b-amber">
        <span aria-hidden="true">↩️</span>
        <div>This is back with you. No reason was recorded — ask your manager
          what they want changed.</div>
      </div>
    )
  }

  const WITH: Record<string, string> = {
    RM_L1: 'your reporting manager',
    RM_L2: 'your second-level manager',
    HOD:   'your head of department',
    HR:    'HR, to publish',
  }
  return (
    <div className="banner b-blue">
      <span aria-hidden="true">⏳</span>
      <div>Your KRAs and ratings are with {WITH[stage] ?? stage} for approval.</div>
    </div>
  )
}

// ── §3.1 My Dashboard ────────────────────────────────────────────────────

export interface Who {
  name: string; code: string; designation?: string | null; department?: string | null
  rmL1?: string | null; rmL2?: string | null; hod?: string | null
}

export function DashboardTab({ who, stages, current, kraCount, weightage, frequency,
                               periodLabel, lastRating, lastScore, actionLabel, actionNote,
                               bands = DEFAULT_BANDS, rules = DEFAULT_RULES}: {
  /** The policy's KRA rules. DEFAULT_RULES is a FALLBACK, not the rule:
   *  reading the constant directly meant an admin could change min_kra_count
   *  and this screen would go on holding the employee to 4. */
  rules?: Rules
  who: Who
  stages: { key: StageKey; state: 'done' | 'active' | 'upcoming' | 'blocked'; detail?: string }[]
  current: StageKey
  kraCount: number; weightage: number
  frequency: string; periodLabel: string
  lastRating: number | null; lastScore: number | null
  actionLabel: string; actionNote: string
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
}) {
  const setOk = kraCount >= rules.minKra && weightage === rules.totalWeightage
  const band = bandFor(lastRating, bands)
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
                ? `Totalling ${weightage}. The set is valid`
                : `Totalling ${weightage}. Needs ${rules.minKra}–${rules.maxKra} KRAs at exactly ${rules.totalWeightage}`}
              tone={setOk ? undefined : 'warn'} />
        <Stat label="How often" value={frequency} note={periodLabel} />
        <Stat label="Last time"
              value={lastRating === null ? '-' : `${lastRating}${band ? ` · ${band.label}` : ''}`}
              note={lastScore === null ? 'No previous period on record' : `Weighted score ${lastScore}`} />
      </div>

      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          This is a <b>developmental</b> review. The rating is not linked to any
          increment, variable pay, bonus or CTC. It exists to give you feedback and
          to decide what support you get next. Recognition here is a certificate, a
          nomination or an award, never a cash component.
        </div>
      </div>
    </>
  )
}

// ── §3.2 My KRAs ─────────────────────────────────────────────────────────

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving, rules = DEFAULT_RULES, carriedFrom, self, onSelfChange, bands = DEFAULT_BANDS, rateRequired = false, selfSubmitted = false}: {
  /** §3's merge: the employee rates each KRA as they write it, and the KRAs
   *  and the ratings go to the manager together. Optional, so a caller that
   *  has not wired rating still renders. */
  self?: Record<number, KraSelf>
  onSelfChange?: (seq: number, patch: Partial<KraSelf>) => void
  bands?: Band[]
  /** Once the one-to-one is acknowledged this submission IS the final one, so
   *  every KRA must carry a rating. Before that the employee is drafting and a
   *  half-rated set is a reasonable thing to save. */
  rateRequired?: boolean
  /**
   * Has the self rating already been submitted?
   *
   * NOT the same thing as `locked`, and conflating them was a real bug. The
   * weightage lock freezes the KRAs — §1 Stage 3 — and the self-appraisal
   * happens AFTER it, at Stage 4. Gating the rating fields on `locked` killed
   * them at exactly the moment the employee is supposed to use them, and
   * removed the submit button with them.
   */
  selfSubmitted?: boolean
  /** The period code these KRAs were carried from, when they were. Shown so a
   *  carried set is visibly not a blank form the employee forgot to fill in. */
  carriedFrom?: string | null
  /** The policy's KRA rules. DEFAULT_RULES is a FALLBACK, not the rule:
   *  reading the constant directly meant an admin could change min_kra_count
   *  and this screen would go on holding the employee to 4. */
  rules?: Rules
  kras: Kra[]
  onChange: (next: Kra[]) => void
  locked: boolean
  lockGate: { open: boolean; because: string }
  onSubmit: () => void
  saving?: boolean
}) {
  const check = checkKras(kras)
  // How many KRAs still have no rating. Only a blocker once rateRequired —
  // see the prop's note.
  const unrated = rateRequired
    ? kras.filter(k => (self?.[k.seq_no]?.rating ?? null) === null).length
    : 0
  const canGo = check.canSubmit && unrated === 0
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
            You write your own KRAs and weightages, but a <b>one-to-one with your
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
               aria-valuemax={rules.totalWeightage} aria-label="Total weightage">
            <span style={{ width: `${m.pct}%` }} />
          </div>
          <div className="k">
            {m.says} · {check.count} {check.count === 1 ? 'KRA' : 'KRAs'}{' '}
            (minimum {rules.minKra}, maximum {rules.maxKra})
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
            sub={`At least ${rules.minKra}, at most ${rules.maxKra}, and the weightages must total exactly ${rules.totalWeightage}.`}>
            {carriedFrom && (
              <div className="banner b-blue">
                <span aria-hidden="true">↻</span>
                <div>
                  These are your KRAs from <b>{carriedFrom}</b>, carried forward as
                  the starting point. Change whatever the new quarter needs — and
                  anything the two of you agree in the one-to-one gets recorded
                  there, including the weightage moves. Nothing is saved until you
                  send it to your manager.
                </div>
              </div>
            )}
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>KRA / objective</th><th>KPI metric</th><th>Target</th>
                <th>Category</th><th style={{ width: 104 }} className="num">Weightage</th>
                {onSelfChange && <><th>What you delivered</th><th>Your rating</th></>}
                {!locked && <th style={{ width: 40 }}><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {/* colSpan is counted, not guessed: 6 base columns, +1 for the
                  remove button when unlocked, +2 when rating is shown. A wrong
                  one leaves the empty state squeezed into a single cell. */}
              {kras.length === 0 ? (
                <tr><td colSpan={6 + (locked ? 0 : 1) + (onSelfChange ? 2 : 0)}
                        style={{ textAlign: 'center', padding: '22px 14px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing written yet</div>
                  <div className="k">
                    Add {rules.minKra} to {rules.maxKra} KRAs. They are what
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
                    {/* §3's merge: rated beside the KRA it belongs to, rather
                        than on a separate screen found afterwards. */}
                    {onSelfChange && (
                      <>
                        <td>
                          <input value={self?.[k.seq_no]?.achievement ?? ''} readOnly={selfSubmitted}
                                 aria-label={`Achievement for KRA ${i + 1}`}
                                 placeholder="The number you actually hit"
                                 onChange={e => onSelfChange(k.seq_no, { achievement: e.target.value })} />
                          <input value={self?.[k.seq_no]?.comment ?? ''} readOnly={selfSubmitted}
                                 aria-label={`Comment for KRA ${i + 1}`}
                                 placeholder="Evidence a manager could check"
                                 style={{ marginTop: 4 }}
                                 onChange={e => onSelfChange(k.seq_no, { comment: e.target.value })} />
                        </td>
                        <td>
                          <div className="btnrow" role="group"
                               aria-label={`Your rating for KRA ${i + 1}`}>
                            {bands.map(b => (
                              <button key={b.value} type="button" disabled={selfSubmitted}
                                      className={self?.[k.seq_no]?.rating === b.value ? 'btn sm' : 'btn ghost sm'}
                                      title={`${b.value}: ${b.label}`}
                                      onClick={() => onSelfChange(k.seq_no, { rating: b.value })}>
                                {b.value}
                              </button>
                            ))}
                          </div>
                        </td>
                      </>
                    )}
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

        {/* Shown while there is still something to send. A locked KRA set with
            the self rating outstanding is the normal state at §1 Stage 4, and
            hiding the button there left the employee with no way to submit the
            rating the stage exists for. */}
        {(!locked || !selfSubmitted) && (
          <div className="btnrow">
            <button className="btn" type="button"
                    disabled={(locked ? unrated > 0 : !canGo) || selfSubmitted || saving}
                    onClick={onSubmit}>
              {saving ? 'Saving…'
                : selfSubmitted ? 'Already sent'
                // Locked: the KRAs are settled, so only the rating is in play
                // and the KRA validation no longer has anything to say.
                : locked
                  ? (unrated > 0
                      ? `Rate the last ${unrated} ${unrated === 1 ? 'KRA' : 'KRAs'} first`
                      : 'Send my ratings to my manager')
                : !check.canSubmit ? `Cannot send yet: ${check.faults.length} to fix`
                : unrated > 0
                  ? `Rate the last ${unrated} ${unrated === 1 ? 'KRA' : 'KRAs'} first`
                  : rateRequired ? 'Send KRAs and my ratings to my manager'
                  : 'Send to my manager'}
            </button>
            {check.total !== rules.totalWeightage && kras.length > 0 && (
              <button className="btn ghost" type="button"
                      onClick={() => onChange(kras.map((k, i) =>
                        ({ ...k, weightage: suggestSplit(kras.length)[i] })))}>
                Split {rules.totalWeightage} evenly
              </button>
            )}
          </div>
        )}
      </Card>
    </>
  )
}

// ── §3.3 One-to-One Log ──────────────────────────────────────────────────

export function OneToOneTab({ logs, managerName, onLog, onAcknowledge, saving, kras = [] }: {
  logs: Log[]; managerName: string
  onLog?: (l: Log) => void; saving?: boolean
  /** Acknowledge a discussion somebody else logged. Without this the
   *  employee's half of a manager-logged final review could never be given,
   *  and pms_finalise requires both halves. */
  onAcknowledge?: (logId: string) => void
  /** The current KRA set, so an agreed weightage change can name the KRA it
   *  applies to rather than asking the employee to remember a seq_no. */
  kras?: { seq_no: number; kra_title: string; weightage: number }[]
}) {
  const [type, setType] = useState<DiscussionType>('KRA_SETTING')
  const [date, setDate] = useState('')
  const [mode, setMode] = useState<Mode>('IN_PERSON')
  const [points, setPoints] = useState('')
  const [mins, setMins] = useState('')
  /**
   * The weightage changes agreed in the meeting.
   *
   * pms_one_to_one.weightage_changes has carried the shape
   * [{seq_no, old_wt, new_wt, reason}] since 066 and nothing has ever written
   * it. The spec update is explicit that the log captures "any changes to
   * weightages", and this is the only place that knows what the weightages
   * WERE before the employee edits them — once the goals row is updated the
   * old number is gone, so recording it afterwards is impossible.
   */
  const [wtChanges, setWtChanges] = useState<WeightageChange[]>([])
  const addChange = () => setWtChanges(c => [...c,
    { seq_no: kras[0]?.seq_no ?? 1, old_wt: kras[0]?.weightage ?? 0, new_wt: 0, reason: '' }])
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
            sub="Every discussion stays on record: KRA setting, mid-period, and the final review.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>With</th><th className="num">Mins</th>
                <th>What was discussed</th><th>Weightage changes</th>
                <th>You</th><th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const st = ackState(l)
                return (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.discussion_date ? humanDate(l.discussion_date) : '-'}
                    </td>
                    <td>
                      <span className={`pill ${l.discussion_type === 'KRA_SETTING' ? 'p-brand'
                        : l.discussion_type === 'MID_PERIOD' ? 'p-blue'
                        : l.discussion_type === 'FINAL_REVIEW' ? 'p-amber' : 'p-grey'}`}>
                        {TYPE_LABEL[l.discussion_type]}
                      </span>
                    </td>
                    <td>{managerName || '-'}</td>
                    <td className="num">{l.duration_minutes ?? '-'}</td>
                    <td className={l.placeholder ? 'k' : undefined}>
                      {l.placeholder
                        ? TYPE_PURPOSE[l.discussion_type]
                        : (l.discussion_points || '-')}
                    </td>
                    {/* Shown, not merely stored. A weightage change recorded
                        where nobody can see it is no better than not recording
                        it — this column is the evidence of what was agreed. */}
                    <td className="k">
                      {!l.weightage_changes?.length ? '-' : (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {l.weightage_changes.map((c, i) => (
                            <li key={i}>
                              KRA {c.seq_no}: {c.old_wt} → {c.new_wt}
                              {c.reason ? ` · ${c.reason}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    {/* A BUTTON, NOT A LABEL, when it is the employee's turn.
                        This column showed a dead "not yet" pill, and nothing
                        anywhere let an employee acknowledge a discussion that
                        somebody ELSE had logged — the employee's own form sets
                        employee_ack as it inserts, so the only acknowledged
                        rows were ones they created. A manager-logged final
                        review could therefore never collect the employee's
                        half, and pms_finalise needs both. */}
                    <td>{l.employee_ack
                      ? <span className="pill p-green">✓ acknowledged</span>
                      : onAcknowledge && l.id
                        ? <button className="btn sm" type="button" disabled={saving}
                                  onClick={() => onAcknowledge(l.id!)}>
                            Acknowledge
                          </button>
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
          <div className="grid g3">
            <div className="fld">
              <label htmlFor="o2o-mins">How long (minutes)</label>
              <input id="o2o-mins" type="number" min={1} max={480} value={mins}
                     onChange={e => setMins(e.target.value)} placeholder="e.g. 30" />
              <div className="k">Optional, but a four-minute discussion and an
                hour-long one are different events.</div>
            </div>
          </div>
          <div className="fld">
            <label htmlFor="o2o-points">What was discussed</label>
            <textarea id="o2o-points" value={points} onChange={e => setPoints(e.target.value)}
                      placeholder="Weightage changes and why, targets agreed, support asked for" />
          </div>
          {/* §3's update: the log captures any changes to weightages. This is
              the only moment that knows the OLD number — once the employee
              applies the change, the previous weightage is gone. */}
          {type === 'KRA_SETTING' && (
            <>
              <div className="divider" />
              <h4 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px' }}>Weightage changes agreed</h4>
              {wtChanges.length === 0 && (
                <div className="k" style={{ marginBottom: 8 }}>
                  None. Add one for each weightage the two of you agreed to move —
                  the old figure is recorded here because after you edit your KRAs
                  it cannot be recovered.
                </div>
              )}
              {wtChanges.map((c, i) => (
                <div className="grid g4" key={i}>
                  <div className="fld">
                    <label htmlFor={`wc-k-${i}`}>Which KRA</label>
                    <select id={`wc-k-${i}`} value={c.seq_no}
                            onChange={e => {
                              const seq = Number(e.target.value)
                              const k = kras.find(x => x.seq_no === seq)
                              setWtChanges(a => a.map((x, j) => j === i
                                ? { ...x, seq_no: seq, old_wt: k?.weightage ?? x.old_wt } : x))
                            }}>
                      {kras.length === 0
                        ? <option value={c.seq_no}>KRA {c.seq_no}</option>
                        : kras.map(k => (
                            <option key={k.seq_no} value={k.seq_no}>
                              {k.seq_no}. {k.kra_title.slice(0, 40)}
                            </option>))}
                    </select>
                  </div>
                  <div className="fld">
                    <label htmlFor={`wc-o-${i}`}>Was</label>
                    <input id={`wc-o-${i}`} type="number" value={c.old_wt}
                           onChange={e => setWtChanges(a => a.map((x, j) =>
                             j === i ? { ...x, old_wt: Number(e.target.value) } : x))} />
                  </div>
                  <div className="fld">
                    <label htmlFor={`wc-n-${i}`}>Now</label>
                    <input id={`wc-n-${i}`} type="number" value={c.new_wt}
                           onChange={e => setWtChanges(a => a.map((x, j) =>
                             j === i ? { ...x, new_wt: Number(e.target.value) } : x))} />
                  </div>
                  <div className="fld">
                    <label htmlFor={`wc-r-${i}`}>Why</label>
                    <input id={`wc-r-${i}`} value={c.reason ?? ''}
                           onChange={e => setWtChanges(a => a.map((x, j) =>
                             j === i ? { ...x, reason: e.target.value } : x))} />
                  </div>
                </div>
              ))}
              <div className="btnrow">
                <button className="btn ghost sm" type="button" onClick={addChange}>
                  + Add a weightage change
                </button>
                {wtChanges.length > 0 && (
                  <button className="btn ghost sm" type="button"
                          onClick={() => setWtChanges(c => c.slice(0, -1))}>
                    Remove the last
                  </button>
                )}
              </div>
            </>
          )}
          <div className="k">{TYPE_PURPOSE[type]}</div>
          <div className="btnrow">
            <button className="btn" type="button" disabled={!date || !points.trim() || saving}
                    onClick={() => {
                      // Only send weightage changes that actually say something.
                      // A row left at 0 -> 0 is somebody who clicked Add and
                      // changed their mind, and storing it would make the log
                      // claim a change that never happened.
                      const changes = wtChanges.filter(c => c.old_wt !== c.new_wt)
                      onLog({ discussion_type: type, discussion_date: date,
                              mode, discussion_points: points,
                              duration_minutes: mins.trim() ? Number(mins) : null,
                              weightage_changes: changes.length ? changes : null,
                              employee_ack: true })
                      setPoints(''); setDate(''); setMins(''); setWtChanges([]) }}>
              {saving ? 'Saving…' : 'Log it and acknowledge'}
            </button>
          </div>
        </Card>
      )}
    </>
  )
}

// ── §3.4 Self Rating ─────────────────────────────────────────────────────

/**
 * The employee's own rating of one KRA, while they are still writing it.
 *
 * Keyed by seq_no rather than goal_id, because during authoring the goal row
 * may not exist yet — pms_reviews.goal_id can only be filled once the upsert
 * returns. Performance.tsx resolves seq_no to goal_id at submit time.
 */
export interface KraSelf { achievement: string; rating: number | null; comment: string }

export interface SelfRow {
  goalId: string; title: string; weightage: number; category: Category
  achievement: string; rating: number | null; comment: string
}

export function SelfRatingTab({ rows, onChange, submitted, onSubmit, saving, windowNote,
                                bands = DEFAULT_BANDS }: {
  rows: SelfRow[]
  onChange: (next: SelfRow[]) => void
  submitted: boolean
  onSubmit: () => void
  saving?: boolean
  windowNote?: string
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
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
          is now open. It locks at submission on purpose: a self assessment edited after
          seeing a manager&rsquo;s number is not a self assessment.
        </Locked>
      ) : (
        <div className="banner b-blue">
          <span aria-hidden="true">ℹ️</span>
          <div>
            Rate your own delivery on each KRA. Once you submit, this <b>locks</b> and your
            manager can rate. They cannot rate before you.
            {windowNote && <> {windowNote}</>}
          </div>
        </div>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="KRAs rated" value={`${rows.length - unrated} of ${rows.length}`}
              note={unrated ? `${unrated} still to do` : 'All done'}
              tone={unrated ? 'warn' : 'good'} />
        <Stat label="Your weighted score" value={mine === null ? '-' : mine.toFixed(2)}
              note="Weighted by the weightage on each KRA" />
        <Stat label="That lands at"
              value={bandForScore(mine, bands)?.label ?? '-'}
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
                    <Chips bands={bands} value={r.rating} disabled={submitted} name={`Rating for ${r.title}`}
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
                : 'Submit (this locks it)'}
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
                            onAcknowledge, acknowledged, publishGate,
                            bands = DEFAULT_BANDS }: {
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
  /** The configured rating scale; falls back to the built-in list. */
  bands?: Band[]
}) {
  // §3.5: NOTHING is visible before publish. Not the rating, not the comments.
  if (!published) {
    return (
      <Card title="Your result is not published yet">
        <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ez-muted)', maxWidth: 640 }}>
          Nothing is shown here until the result is published: no rating, no scores, no
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
  const band = bandFor(finalRating, bands)

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
              value={finalRating === null ? '-' : `${finalRating}${band ? ` · ${band.label}` : ''}`}
              note={finalScore === null ? '' : `Weighted score ${finalScore.toFixed(2)}`} />
        <Stat label="Your own score" value={selfScore === null ? '-' : selfScore.toFixed(2)}
              note={g.delta === null ? '' :
                `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(2)} against the final`} />
        <Stat label="Department average"
              value={deptAverage === null ? '-' : deptAverage.toFixed(2)}
              note={deptAverage === null || finalScore === null ? 'Not available'
                : finalScore >= deptAverage ? 'You are at or above it' : 'You are below it'} />
        <Stat label="Finalised by" value={finalisedBy ?? '-'}
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
                  <td className="num">{l.self ?? '-'}</td>
                  <td className="num">{l.rmL1 ?? '-'}</td>
                  <td className="num">{l.rmL2 ?? '-'}</td>
                  <td className="num"><b>{l.final ?? '-'}</b></td>
                  <td className="num">
                    {l.final === null || l.final === undefined
                      ? '-' : ((l.final * l.weightage) / 100).toFixed(2)}
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
                {benefits.map((b, i) => <li key={i}><b>{b.type}</b>: {b.note}</li>)}
              </ul>}
          <div className="k" style={{ marginTop: 8 }}>
            Recognition only: a certificate, a nomination or an award. Never a cash component.
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
                {l.self ?? '-'} → {l.final ?? '-'}
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
            <div className="vv">{c.score === null ? '-' : c.score.toFixed(2)}</div>
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
                      <td className="num">{t.score === null ? '-' : t.score.toFixed(2)}</td>
                      <td className="num">
                        {d === null ? '-'
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
