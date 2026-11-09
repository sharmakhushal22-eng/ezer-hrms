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
import { checkKpis, blankKpi, renumber, selfKey, shareOf, submitGate,
         kraRating, ratedCount, canAddKpi, canRemoveKpi, type Kpi } from '@/lib/pms/kpi'
import { logRows, ackState, waitingOn, canLockWeightage, canPublishResult,
         TYPE_LABEL, TYPE_PURPOSE, DISCUSSION_TYPES, MODES, MODE_LABEL,
         type Log, type DiscussionType, type Mode, type WeightageChange } from '@/lib/pms/oneToOne'
import { score, gap, byCategory, bandForScore, bandFor, DEFAULT_BANDS, type Band,
         type Line } from '@/lib/pms/scoring'
import { STAGES, humanDate, type StageKey } from '@/lib/pms/cycle'
import { DEFAULT_RULES, type Rules } from '@/lib/pms/cycle'
import { CONFIRM_LABEL, CONFIRM_WHY } from '@/lib/pms/oneToOne'

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

/**
 * A KPI's share, for display.
 *
 * 10 stays "10"; 8.3333… becomes "8.33". A trailing ".00" on every whole
 * number is noise on a line that repeats once per measure, and the exact
 * value is never typed or stored — only the KRA's own weightage is, and
 * shareOf() divides it afresh every render.
 */
const round2 = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2)

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
      {/* Who this is and who reviews them. The cycle track already sits in
          the header above every tab, so it is not drawn a second time here;
          this card says where the person stands in it in one line instead. */}
      {(() => {
        const done = stages.filter(x => x.state === 'done').length
        const now = STAGES.find(x => x.key === current)
        const line = [
          who.rmL1 && { k: 'RM L1', v: who.rmL1 },
          who.rmL2 && { k: 'RM L2', v: who.rmL2 },
          who.hod  && { k: 'HOD',   v: who.hod },
        ].filter(Boolean) as { k: string; v: string }[]
        return (
          <div className="card pms-profile">
            <div className="pms-profile-main">
              <div className="ava pms-profile-ava" aria-hidden="true">
                {who.name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="pms-profile-name">{who.name} <span>{who.code}</span></div>
                <div className="k">{[who.designation, who.department].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="pms-profile-now">
                <div className="pms-profile-now-t">{now ? `Now: ${now.label}` : 'Cycle'}</div>
                <div className="k">{done} of {STAGES.length} stages done</div>
                <div className="bar green" aria-hidden="true">
                  <span style={{ width: `${Math.round((done / STAGES.length) * 100)}%` }} />
                </div>
              </div>
            </div>
            {line.length > 0 && (
              <div className="pms-profile-line">
                <span className="pms-profile-line-k">Reviewed by</span>
                <span className="pms-profile-chip pms-you">You</span>
                {line.map(x => (
                  <span key={x.k} className="pms-profile-step">
                    <span className="pms-profile-sep" aria-hidden="true">›</span>
                    <span className="pms-profile-chip"><b>{x.k}</b> {x.v}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })()}

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

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving, rules = DEFAULT_RULES, carriedFrom, self, onSelfChange, bands = DEFAULT_BANDS, rateRequired = false, selfSubmitted = false, confirmOneToOne, onConfirmOneToOne, oneToOneRequired = false, oneToOneAlready = false}: {
  /** §3's merge: the employee rates each KRA as they write it, and the KRAs
   *  and the ratings go to the manager together. Optional, so a caller that
   *  has not wired rating still renders. */
  /** 220: a rating belongs to a KPI. Keyed by selfKey(kraSeq, kpiSeq),
   *  because a KPI being typed has no id yet. */
  self?: Record<string, KraSelf>
  onSelfChange?: (key: string, patch: Partial<KraSelf>) => void
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
  /**
   * THE TICK THAT RECORDS THE ONE-TO-ONE. Requested: the log should be
   * automatic — a mandatory checkbox at each stage rather than a separate
   * form. The employee's half is here, on the submit, because that is the
   * moment they are asserting the conversation happened.
   */
  confirmOneToOne?: boolean
  onConfirmOneToOne?: (v: boolean) => void
  /** pms_policies.one_to_one_mandatory. When false the tick is not required
   *  and is not shown — a policy that does not ask for the conversation must
   *  not block a submission on confirming it. */
  oneToOneRequired?: boolean
  /** Already on record from a previous submission or the detailed form, in
   *  which case there is nothing to confirm again. */
  oneToOneAlready?: boolean
  saving?: boolean
}) {
  /**
   * ALL FOUR TAKE `rules`, AND ALL FOUR WERE CALLED WITHOUT IT.
   *
   * checkKras, meter, canAdd and canDelete each default their second argument
   * to DEFAULT_RULES. Omitting it compiles, runs, and silently holds the
   * employee to the shipped 4/10/100/5 — so this screen's COPY honoured the
   * policy (it reads `rules.minKra`) while its ENFORCEMENT did not. An admin
   * setting a minimum of 6 saw the sentence change and the submit button go
   * on accepting 4.
   *
   * That is the same bug lib/pms/__tests__/rules-from-policy.test.ts was
   * written for, hiding in the one form the test cannot see: the default is
   * inside kra.ts, so there is no `DEFAULT_RULES.minKra` here to find.
   */
  const check = checkKras(kras, rules)

  /**
   * ONE GATE, BECAUSE IT IS ONE QUESTION — 222.
   *
   * Requested: nothing can be submitted without the weightage at exactly 100,
   * the minimum KRAs and KPIs written, and every KRA rated. Three rules that
   * were enforced in three places and checked here by one of them:
   * `check.canSubmit` comes from checkKras, which knows about weightage and
   * nothing whatever about KPIs. A KRA with no measure under it sailed past.
   *
   * AND THE RATING COUNT WAS BROKEN. It read `self[k.seq_no]` — key `1` —
   * while the draft ratings have been keyed `selfKey(kraSeq, kpiSeq)`, i.e.
   * `"1.1"`, since the self rating moved onto the KPI. Every lookup missed,
   * so with rateRequired on, every KRA counted as unrated and the button
   * could never enable. selfKey is used on both sides here for that reason.
   */
  const tree = kras.map(k => ({ ...k, kpis: k.kpis ?? [] }))
  const gate = submitGate(tree, rules, rateRequired
    ? (kpi, kra) => self?.[selfKey(kra.seq_no, kpi.seq_no)]?.rating ?? null
    : undefined)
  const unrated = gate.of - gate.rated
  const canGo = gate.ok
  const m = meter(check, rules)
  const add = canAdd(kras, rules)
  const del = canDelete(kras, rules)

  const set = (i: number, patch: Partial<Kra>) =>
    onChange(kras.map((k, j) => j === i ? { ...k, ...patch } : k))

  // ── editing the KPIs of one KRA ────────────────────────────────────────
  // renumber() after every add or remove: 220 makes (goal_id, seq_no) unique,
  // so a hole in the sequence is a write that fails.
  const kpisOf = (k: Kra): Kpi[] => k.kpis ?? []
  const setKpi = (i: number, j: number, patch: Partial<Kpi>) =>
    set(i, { kpis: kpisOf(kras[i]).map((x, n) => n === j ? { ...x, ...patch } : x) })
  // THE LIMIT IS CHECKED HERE AS WELL AS ON THE BUTTON. A disabled button is
  // a hint, not a rule: this helper is also reachable by keyboard on a stale
  // render, and the write it would make is one trg_pms_kpi_count refuses with
  // a database error instead of a sentence.
  const addKpi = (i: number) => {
    if (!canAddKpi(kpisOf(kras[i]), rules).allowed) return
    set(i, { kpis: renumber([...kpisOf(kras[i]), blankKpi(kpisOf(kras[i]).length + 1)]) })
  }
  const removeKpi = (i: number, j: number) => {
    if (!canRemoveKpi(kpisOf(kras[i]), rules).allowed) return
    set(i, { kpis: renumber(kpisOf(kras[i]).filter((_, n) => n !== j)) })
  }
  // Presentation: one shade of the brand per KRA, shared by its segment in
  // the weightage bar and its number badge, so the two read as one object.
  const shade = (i: number) => `color-mix(in oklab, var(--ez-brand) ${Math.max(30, 100 - i * 11)}%, var(--ez-brand-tint))`
  // Counted over KPIs, because that is what carries a rating now. A KRA is
  // "done" only when every measure under it has been rated.
  const allKpis = kras.flatMap(k => (k.kpis ?? []).map(x => ({ k, x })))
  const ratedByYou = onSelfChange
    ? allKpis.filter(({ k, x }) => (self?.[selfKey(k.seq_no, x.seq_no)]?.rating ?? null) !== null).length
    : 0

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

      {/* THE WEIGHTAGE, AS THE SET'S SHAPE. One segment per KRA, sized by its
          weightage, so "where the 100 went" is seen before it is read. Same
          numbers, same progressbar semantics and the same Add button as the
          meter it replaces. */}
      <div className={`pms-kmeter ${m.tone === 'good' ? 'is-good' : m.tone === 'bad' ? 'is-bad' : 'is-warn'}`}>
        <div className="pms-kmeter-total">
          <div className="pms-kmeter-n">{check.total}<span>/{rules.totalWeightage}</span></div>
          <div className="pms-kmeter-l">Weightage</div>
        </div>
        <div className="pms-kmeter-mid">
          <div className="pms-kmeter-bar"
               role="progressbar" aria-valuenow={check.total} aria-valuemin={0}
               aria-valuemax={rules.totalWeightage} aria-label="Total weightage">
            {kras.map((k, i) => (k.weightage || 0) > 0 && (
              <span key={i} title={`KRA ${i + 1}: ${k.weightage}`}
                    style={{ flexGrow: k.weightage || 0,
                             flexBasis: 0,
                             maxWidth: `${Math.min(100, ((k.weightage || 0) / Math.max(rules.totalWeightage, check.total || 1)) * 100)}%`,
                             background: shade(i) }}>
                <i>{k.weightage}%</i>
              </span>
            ))}
            {check.total < rules.totalWeightage && (
              <span className="pms-kmeter-gap" style={{ flexGrow: rules.totalWeightage - check.total, flexBasis: 0 }} />
            )}
          </div>
          <div className="pms-kmeter-says">
            <b>{m.says}</b>
            <span>{check.count} {check.count === 1 ? 'KRA' : 'KRAs'} · minimum {rules.minKra}, maximum {rules.maxKra}</span>
            {onSelfChange && kras.length > 0 && (
              <span className={`pms-kmeter-rated${ratedByYou === allKpis.length ? ' is-done' : ''}`}>
                {ratedByYou} of {allKpis.length} rated by you
              </span>
            )}
          </div>
        </div>
        {!locked && (
          <button className="btn" type="button" disabled={!add.allowed}
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

        {/* One card per KRA instead of a nine-column table row. The title gets
            the width it needs, the measure sits under it, and the self rating
            — when this stage asks for it — is part of the same card. Every
            input keeps its aria-label, value, readOnly and onChange. */}
        {kras.length === 0 ? (
          <div className="pms-kempty">
            <div className="pms-kempty-t">Nothing written yet</div>
            <div className="k">
              Add {rules.minKra} to {rules.maxKra} KRAs. They are what
              your rating will be measured against, so they are worth the time.
            </div>
          </div>
        ) : (
          <div className="pms-klist">
            {kras.map((k, i) => {
              const thin = check.thin.includes(k.seq_no)
              const mine = self?.[k.seq_no]?.rating ?? null
              const mineBand = bands.find(b => b.value === mine)
              return (
                <div key={i} className={`pms-kra${thin ? ' is-thin' : ''}${locked ? ' is-locked' : ''}${mine !== null ? ' is-rated' : ''}`}
                     style={{ ['--kra-c' as string]: shade(i) }}>
                  <div className="pms-kra-top">
                    <span className="pms-kra-no" aria-hidden="true">{i + 1}</span>
                    <div className="pms-kra-title">
                      <label htmlFor={`kra-${i}-title`}>KRA / objective</label>
                      <input id={`kra-${i}-title`} value={k.kra_title} readOnly={locked} aria-label={`KRA ${i + 1} title`}
                             placeholder="What you are accountable for"
                             onChange={e => set(i, { kra_title: e.target.value })} />
                    </div>
                    <div className="pms-kra-w">
                      <label htmlFor={`kra-${i}-w`}>Weightage</label>
                      <div className="pms-kra-wbox">
                        <input id={`kra-${i}-w`} type="number" min={0} max={100} value={k.weightage} readOnly={locked}
                               aria-label={`KRA ${i + 1} weightage`}
                               aria-invalid={thin || undefined}
                               style={thin ? { borderColor: 'var(--ez-critical)' } : undefined}
                               onChange={e => set(i, { weightage: Number(e.target.value) || 0 })} />
                        <span aria-hidden="true">%</span>
                      </div>
                    </div>
                    {!locked && (
                      <button className="pms-kra-x" type="button" disabled={!del.allowed}
                              title={del.reason ?? 'Remove this KRA'}
                              aria-label={`Remove KRA ${i + 1}`}
                              onClick={() => onChange(kras.filter((_, j) => j !== i)
                                .map((x, j) => ({ ...x, seq_no: j + 1 })))}>×</button>
                    )}
                  </div>

                  <div className="pms-kra-cat">
                    <label htmlFor={`kra-${i}-cat`}>Category</label>
                    <select id={`kra-${i}-cat`} value={k.category} disabled={locked} aria-label={`KRA ${i + 1} category`}
                            onChange={e => set(i, { category: e.target.value as Category })}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                  </div>

                  {/* ── THE KPIs (220) ───────────────────────────────────
                      The KRA is the objective; these are how it is measured,
                      and each is rated on its own by every rung. Their
                      weightages total THIS KRA's weightage, not 100 — the
                      balance line says which, because "15 of 30" is the only
                      number that tells somebody what to type next. */}
                  {(() => {
                    const mine = { seq_no: k.seq_no, kra_title: k.kra_title,
                                   weightage: k.weightage, kpis: kpisOf(k) }
                    // `rules`, not the default: omitting it would hold every
                    // KRA to 1-to-5 whatever the policy says.
                    const faults = checkKpis(mine, rules)
                    const setFault = faults.find(f => f.kpiSeq === null)
                    const more = canAddKpi(kpisOf(k), rules)
                    // 222: THE SHARE IS SHOWN, NOT TYPED. A KPI has no
                    // weightage of its own — it takes an equal cut of its
                    // KRA's. Saying so is worth a line, because "each 8.33%"
                    // is the only thing that explains what adding a fourth
                    // measure does to the three already there.
                    const share = shareOf(k.weightage, kpisOf(k).length)
                    return (
                      <div className="pms-kpis">
                        <div className="pms-kpis-h">
                          <span className="pms-kpis-t">How it is measured</span>
                          {kpisOf(k).length > 0 && (k.weightage || 0) > 0 && (
                            <span className="pms-kpis-bal is-ok">
                              {kpisOf(k).length === 1
                                ? `carries all ${k.weightage}%`
                                : `${k.weightage}% split ${kpisOf(k).length} ways · ${round2(share)}% each`}
                            </span>
                          )}
                          {!locked && (
                            <div className="btnrow">
                              {/* DISABLED AT THE CEILING, NOT HIDDEN. A button
                                  that disappears reads as a mis-click; one
                                  that greys out with the reason in its title
                                  says the limit exists and where to change it.
                                  The count travels with it so "4 of 5" is
                                  legible before the limit is reached, which is
                                  when somebody is deciding how to split a KRA. */}
                              <button type="button" className="btn ghost"
                                      disabled={!more.allowed}
                                      title={more.reason ?? 'Add another measure for this KRA'}
                                      onClick={() => addKpi(i)}>
                                + Add KPI
                              </button>
                              <span className="pms-kpis-n">
                                {kpisOf(k).length} of {rules.maxKpi}
                              </span>
                            </div>
                          )}
                        </div>

                        {kpisOf(k).map((x, j) => {
                          const rowFault = faults.find(f => f.kpiSeq === x.seq_no)
                          return (
                            <div key={j} className={`pms-kpi${rowFault ? ' is-bad' : ''}`}>
                              <span className="pms-kpi-no" aria-hidden="true">{j + 1}</span>
                              <div className="pms-kpi-m">
                                <label htmlFor={`kra-${i}-kpi-${j}-m`}>KPI</label>
                                <input id={`kra-${i}-kpi-${j}-m`} value={x.kpi_metric} readOnly={locked}
                                       aria-label={`KRA ${i + 1} KPI ${j + 1} measure`}
                                       placeholder="How it is measured"
                                       onChange={e => setKpi(i, j, { kpi_metric: e.target.value })} />
                              </div>
                              <div className="pms-kpi-t">
                                <label htmlFor={`kra-${i}-kpi-${j}-t`}>Target</label>
                                <input id={`kra-${i}-kpi-${j}-t`} value={x.target_value} readOnly={locked}
                                       aria-label={`KRA ${i + 1} KPI ${j + 1} target`}
                                       placeholder="The number to hit"
                                       onChange={e => setKpi(i, j, { target_value: e.target.value })} />
                              </div>
                              {/* 222: no weightage input. A KPI has none —
                                  it carries an equal share of its KRA's, and
                                  the share is stated in the header above
                                  rather than typed into every row. The column
                                  is kept as a read-only share so the grid
                                  still lines up and the number is where the
                                  reader last saw it. */}
                              <div className="pms-kpi-w">
                                <span className="pms-kpi-share-l">Share</span>
                                <span className="pms-kpi-share">{round2(share)}%</span>
                              </div>
                              {/* The KPI that would take the KRA under the
                                  policy's floor cannot go. Usually that is the
                                  last one — a KRA with no measure cannot be
                                  rated — but a policy asking for three makes
                                  it the third, and the hardcoded `<= 1` here
                                  said "A KRA needs at least one KPI" while the
                                  submit refused the set for having two.
                                  canRemoveKpi owns both the test and the
                                  sentence so they cannot drift apart. */}
                              {!locked && (() => {
                                const fewer = canRemoveKpi(kpisOf(k), rules)
                                return (
                                <button className="pms-kpi-x" type="button"
                                        disabled={!fewer.allowed}
                                        title={!fewer.allowed
                                          ? fewer.reason
                                          : 'Remove this KPI'}
                                        aria-label={`Remove KRA ${i + 1} KPI ${j + 1}`}
                                        onClick={() => removeKpi(i, j)}>×</button>
                                )
                              })()}

                              {/* §3's merge, now per measure: you rate the
                                  thing that is measured, beside its target,
                                  rather than one rating covering three
                                  different measures of one objective. */}
                              {onSelfChange && (() => {
                                const key = selfKey(k.seq_no, x.seq_no)
                                const got = self?.[key]?.rating ?? null
                                const band = bands.find(b => b.value === got)
                                return (
                                  <div className={`pms-kpi-self${got !== null ? ' is-rated' : ''}`}>
                                    <div>
                                      <label htmlFor={`kra-${i}-kpi-${j}-ach`}>What you delivered</label>
                                      <input id={`kra-${i}-kpi-${j}-ach`}
                                             value={self?.[key]?.achievement ?? ''} readOnly={selfSubmitted}
                                             aria-label={`Achievement for KRA ${i + 1} KPI ${j + 1}`}
                                             placeholder="The number you actually hit"
                                             onChange={e => onSelfChange(key, { achievement: e.target.value })} />
                                    </div>
                                    <div>
                                      <label htmlFor={`kra-${i}-kpi-${j}-ev`}>Evidence</label>
                                      <textarea id={`kra-${i}-kpi-${j}-ev`} rows={1}
                                                value={self?.[key]?.comment ?? ''} readOnly={selfSubmitted}
                                                aria-label={`Comment for KRA ${i + 1} KPI ${j + 1}`}
                                                placeholder="Evidence a manager could check"
                                                onChange={e => onSelfChange(key, { comment: e.target.value })} />
                                    </div>
                                    <div>
                                      <span className="pms-kra-flabel">Your rating</span>
                                      <div className="pms-kra-rate" role="group"
                                           aria-label={`Your rating for KRA ${i + 1} KPI ${j + 1}`}>
                                        {bands.map(b => (
                                          <button key={b.value} type="button" disabled={selfSubmitted}
                                                  className={got === b.value ? 'btn sm' : 'btn ghost sm'}
                                                  title={`${b.value}: ${b.label}`}
                                                  onClick={() => onSelfChange(key, { rating: b.value })}>
                                            {b.value}
                                          </button>
                                        ))}
                                      </div>
                                      {band && <span className="pms-kpi-band">{band.value} · {band.label}</span>}
                                    </div>
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}

                        {setFault && !locked && (
                          <p className="pms-kpis-f">{setFault.says}</p>
                        )}
                      </div>
                    )
                  })()}

                </div>
              )
            })}
          </div>
        )}

        {/* EVERY REASON THE BUTTON IS OFF, not just the KRA-level ones.
            This listed check.faults while the button increasingly refused for
            reasons checkKras cannot see — a KRA with no KPI, a measure with
            no name, a rating not given. A disabled button whose explanation
            omits the actual blocker is worse than no explanation: the reader
            fixes what is listed and it stays disabled. gate.faults is the
            same list the button counts. */}
        {gate.faults.length > 0 && (
          <div className="banner b-red" style={{ marginTop: 14, marginBottom: 0 }}>
            <span aria-hidden="true">!</span>
            <div>
              <b>Before this can be sent:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {gate.faults.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Shown while there is still something to send. A locked KRA set with
            the self rating outstanding is the normal state at §1 Stage 4, and
            hiding the button there left the employee with no way to submit the
            rating the stage exists for. */}
        {/* THE ONE-TO-ONE, CONFIRMED HERE RATHER THAN ON A SEPARATE FORM.
            It used to live in its own tab, which is why FINAL_REVIEW rows
            existed for 7 of 395 enrolments: a form nobody is standing in
            front of does not get filled. Ticking this records the
            KRA_SETTING log with the employee's acknowledgement, and the
            manager's own tick completes the same row — one conversation, two
            acknowledgements, which is what pms_lock_kras checks.

            Hidden when the policy does not ask for the conversation, and once
            it is already on record. */}
        {(!locked || !selfSubmitted) && oneToOneRequired && !oneToOneAlready && onConfirmOneToOne && (
          <div className="card" style={{ marginBottom: 10 }}>
            <label className="checkline">
              <input type="checkbox" checked={!!confirmOneToOne}
                     style={{ marginTop: 2 }}
                     onChange={e => onConfirmOneToOne(e.target.checked)} />
              {/* A div, not a span: it contains a block, and a block inside
                  an inline element is invalid markup that browsers paper over
                  differently. minWidth: 0 is what lets it wrap at all — a flex
                  child will not shrink below its content's intrinsic width
                  without it, so a long sentence pushed the card instead of
                  breaking. */}
              <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <b>{CONFIRM_LABEL.EMPLOYEE}</b>
                <div className="k" style={{ marginTop: 4 }}>{CONFIRM_WHY.EMPLOYEE}</div>
              </div>
            </label>
          </div>
        )}

        {(!locked || !selfSubmitted) && (
          <div className="btnrow">
            <button className="btn" type="button"
                    disabled={(locked ? unrated > 0 : !canGo) || selfSubmitted || saving
                              || (oneToOneRequired && !oneToOneAlready && !confirmOneToOne)}
                    onClick={onSubmit}>
              {saving ? 'Saving…'
                : selfSubmitted ? 'Already sent'
                : (oneToOneRequired && !oneToOneAlready && !confirmOneToOne)
                  ? 'Confirm the one-to-one above first'
                // Locked: the KRAs are settled, so only the rating is in play
                // and the KRA validation no longer has anything to say.
                : locked
                  ? (unrated > 0
                      ? `Rate the last ${unrated} ${unrated === 1 ? 'measure' : 'measures'} first`
                      : 'Send my ratings to my manager')
                // 222: the count comes from the gate, so the label cannot
                // disagree with what the button does. It counted check.faults
                // alone before, which left out every KPI fault — the button
                // said "2 to fix" while refusing for a third reason it never
                // named.
                : !gate.ok ? `Cannot send yet: ${gate.faults.length} to fix`
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
  /** The KRA this measure belongs to. Still written to pms_reviews.goal_id. */
  goalId: string
  /** 220: what the rating actually belongs to. */
  kpiId: string
  /** "KRA · KPI", so a flat list still says which objective a row is under —
   *  the same shape lines() builds for scoring. */
  title: string
  /** THE KPI's weightage, not the KRA's. One row per measure now, and the
   *  weighted mean is over those. */
  weightage: number
  category: Category
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
                // Keyed by the KPI, not the KRA: since 220 a KRA produces one
                // row per measure, so goalId repeats. React warned about
                // duplicate keys, which means it can reuse the wrong row's
                // DOM and carry a half-typed value across.
                <tr key={r.kpiId || r.goalId}>
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
