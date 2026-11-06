'use client'
// components/pms/AdminEditor.tsx — the writing half of the Performance module.
//
// Until now every component under components/pms/ was read-only. The Config
// tab even offered a frequency dropdown whose onChange only set React state:
// it redrew the period preview and saved nothing, which is why the screen
// looked editable and wasn't.
//
// Everything here writes through /api/pms/admin. Nothing writes to Supabase
// directly — the actor has to come from the session, and the route allowlists
// which columns may be set.
//
// Five sections, in the order an administrator actually uses them:
//   1. Policies      the rules: frequency, KRA counts, weightage, chain
//   2. KRA library   the reusable KRA master list
//   3. Rating scale  the bands that turn a score into a rating
//   4. Cycle control generate a year of periods; open one
//   5. Finalise      set an employee's rating for a period

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { loadPmsAdmin, pmsAdmin, type PmsAdminSnapshot } from '@/lib/pms/adminClient'
import { IconPolicies, IconTemplates, IconOrgChart, IconSliders, IconLetters,
         IconCompliance, IconCalendar, IconLock, type IconProps } from '@/lib/ui'
import { CHAINS, CHAIN_LABEL, FINALISERS, FINALISER_LABEL } from '@/lib/pms/hierarchy'
import { RUNG_CHOICES, chainFault, chainWarnings, chainSummary, usedBy,
         MAX_CHAIN_NAME } from '@/lib/pms/chainBuilder'

type Row = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined) ? '' : String(v)
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const

/**
 * EVERY ONE OF THESE IS A CHECK CONSTRAINT, SO A TEXT BOX OVER IT IS A TRAP.
 *
 * kra_created_by, approval_chain and who_can_finalise were free-text inputs.
 * The column accepts exactly three or four values and rejects everything else,
 * so saving a policy failed with
 *
 *   new row for relation "pms_policies" violates check constraint
 *   "pms_policies_kra_created_by_check"
 *
 * — reported by an admin who had done nothing wrong except type into a box
 * the screen offered them. A correct value was reachable only by knowing the
 * enum and spelling it in capitals. frequency was already a select; these
 * three were not.
 *
 * The chain and finaliser lists come from lib/pms/hierarchy, which is the
 * same source the review screens reason with, so the dropdown cannot offer a
 * value the rest of the module does not understand.
 */
/**
 * §13.2(1): "Rating Scale: Configurable per policy; recommended standard is a
 * 5-point developmental maturity scale."
 *
 * The column has allowed these three since 066 and the admin route already
 * accepted writes to it — there was simply no control, so the one thing the
 * spec calls out as configurable could only be changed by calling the API by
 * hand. Same for new_joiner_cutoff_days.
 */
const RATING_SCALES = ['FIVE_POINT', 'FOUR_POINT_NR', 'TEN_POINT'] as const
const RATING_SCALE_LABEL: Record<typeof RATING_SCALES[number], string> = {
  FIVE_POINT:    '5 point (1–5) — the recommended standard',
  FOUR_POINT_NR: '4 point plus Not Rated',
  TEN_POINT:     '10 point (1–10)',
}

const KRA_AUTHORS = ['EMPLOYEE', 'MANAGER', 'BOTH'] as const
const KRA_AUTHOR_LABEL: Record<typeof KRA_AUTHORS[number], string> = {
  EMPLOYEE: 'The employee writes their own',
  MANAGER:  'Their manager writes them',
  BOTH:     'Either may write them',
}
const CATEGORIES = ['BUSINESS', 'PROCESS', 'PEOPLE', 'CUSTOMER', 'COMPLIANCE', 'LEARNING'] as const

// ── small shared pieces, matching the classes pms.css already defines ──────
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <div className="card"><h3>{title}</h3>{sub && <div className="sub">{sub}</div>}{children}</div>
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="fld"><label>{label}</label>{children}{hint && <div className="k">{hint}</div>}</div>
}
function Note({ tone, children }: { tone: 'good' | 'bad' | 'warn'; children: React.ReactNode }) {
  return <div className={`note ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div>
}

/** One save button and the one line of feedback that belongs with it. Kept in
 *  a single component so no panel can drift into reporting success silently. */
function SaveRow({ busy, error, saved, onSave, label = 'Save changes', disabled }: {
  busy: boolean; error: string | null; saved: string | null
  onSave: () => void; label?: string; disabled?: boolean
}) {
  return (
    <>
      <div className="btnrow">
        <button className="btn" onClick={onSave} disabled={busy || disabled}>
          {busy ? 'Saving…' : label}
        </button>
      </div>
      {error && <Note tone="bad">{error}</Note>}
      {!error && saved && <Note tone="good">{saved}</Note>}
    </>
  )
}

/**
 * The same feedback, for an action that has no save button next to it.
 *
 * SaveRow pairs a message with the button that caused it, which is right for
 * a form. It is WRONG for a row action in a table: Retire lives outside the
 * editor, so a SaveRow inside `{editing && …}` had nowhere to render its
 * refusal. Clicking Retire on a chain a policy still uses did exactly what it
 * should — the route refused, naming the policy — and the screen showed
 * nothing at all. The button appeared to do nothing.
 *
 * Rendered only when no editor is open, so the message never appears twice.
 */
function RowFeedback({ error, saved }: { error: string | null; saved: string | null }) {
  if (error) return <Note tone="bad">{error}</Note>
  if (saved) return <Note tone="good">{saved}</Note>
  return null
}

/** Every panel needs the same three pieces of state and the same reset on a
 *  fresh attempt. Written once so a panel cannot show a stale "Saved" next to
 *  a new failure. */
function useSaver(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const run = useCallback(async (
    fn: () => Promise<{ error: { message: string } | null; data?: unknown }>,
    okMsg: string,
  ) => {
    setBusy(true); setError(null); setSaved(null)
    const r = await fn()
    setBusy(false)
    if (r.error) { setError(r.error.message); return false }
    setSaved(okMsg)
    await reload()
    return true
  }, [reload])

  /**
   * Forget the last outcome.
   *
   * The state outlives the action that produced it, which is right while you
   * are looking at the thing you just did and wrong the moment you start
   * something else: a refusal from Retire sat under the editor's Save button
   * afterwards, reading as a failed save. Call this when opening or closing
   * an editor.
   */
  const reset = useCallback(() => { setError(null); setSaved(null) }, [])

  return { busy, error, saved, run, setError, reset }
}

// ══ 1. POLICIES ═══════════════════════════════════════════════════════════
function PolicyPanel({ policies, companies, people, chains, reload }: {
  policies: Row[]; companies: Row[]; people: Row[]
  /** 218. The built chains a policy may point at instead of a preset. */
  chains: Row[]
  reload: () => Promise<void>
}) {
  const [id, setId] = useState<string>('')
  const [draft, setDraft] = useState<Row>({})
  const { busy, error, saved, run } = useSaver(reload)

  const current = useMemo(() => policies.find(p => s(p.id) === id), [policies, id])

  /**
   * NAME THE COMPANY, because the name alone does not identify the policy.
   *
   * Every company is seeded with a policy called "Standard Quarterly", so the
   * dropdown read "Standard Quarterly / Standard Quarterly / Standard
   * Quarterly" and an admin had no way to tell which company they were
   * editing. I proved how easily that goes wrong by doing it myself: three
   * attempts to change one policy's minimum KRA count landed on three
   * different companies' policies, leaving them at 1, 5 and 2.
   *
   * CyclePanel already labels its period dropdowns this way. PolicyPanel
   * never got the same treatment, and this is the screen where it matters
   * more — a period is obviously per company, a policy name looks global.
   */
  const companyName = useMemo(
    () => new Map(companies.map(c => [s(c.id), s(c.company_name)])), [companies])
  const policyLabel = useCallback((p: Row) => {
    const co = companyName.get(s(p.company_id))
    const inactive = p.is_active === false ? ' · inactive' : ''
    return `${co ? co + ' · ' : ''}${s(p.policy_name)}${inactive}`
  }, [companyName])

  useEffect(() => {
    if (!id && policies.length) setId(s(policies[0].id))
  }, [policies, id])
  useEffect(() => { setDraft(current ? { ...current } : {}) }, [current])

  if (!policies.length) {
    return <Card title="Policies" sub="Nothing to edit yet.">
      <Note tone="warn">No policy exists. A policy is what decides frequency, KRA counts and the approval chain. Every period is generated from one.</Note>
    </Card>
  }

  const set = (k: string, v: unknown) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <Card title="Policy rules"
          sub="The frequency here is the real one. Changing it decides how many periods a year has, and what the Cycle tab will generate.">
      <div className="grid g3">
        <Field label="Policy">
          <select value={id} onChange={e => setId(e.target.value)}>
            {policies.map(p => <option key={s(p.id)} value={s(p.id)}>{policyLabel(p)}</option>)}
          </select>
        </Field>
        <Field label="Name"><input value={s(draft.policy_name)} onChange={e => set('policy_name', e.target.value)} /></Field>
        <Field label="Code"><input value={s(draft.policy_code)} onChange={e => set('policy_code', e.target.value)} /></Field>
      </div>

      <div className="divider" />
      <div className="grid g4">
        <Field label="Frequency" hint="Periods per year follows from this">
          <select value={s(draft.frequency)} onChange={e => set('frequency', e.target.value)}>
            {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Minimum KRAs"><input type="number" min={1} value={n(draft.min_kra_count)} onChange={e => set('min_kra_count', Number(e.target.value))} /></Field>
        <Field label="Maximum KRAs" hint="20 at most"><input type="number" min={1} max={20} value={n(draft.max_kra_count)} onChange={e => set('max_kra_count', Number(e.target.value))} /></Field>
        <Field label="Total weightage" hint="Usually 100"><input type="number" value={n(draft.total_weightage)} onChange={e => set('total_weightage', Number(e.target.value))} /></Field>
      </div>

      <div className="grid g4">
        <Field label="Minimum weightage per KRA"><input type="number" value={n(draft.min_weightage_per_kra)} onChange={e => set('min_weightage_per_kra', Number(e.target.value))} /></Field>
        <Field label="New joiner cut-off (days)"
               hint="§8: joined within this many days of the period end is Not Rated">
          <input type="number" min={0} max={365} value={n(draft.new_joiner_cutoff_days)}
                 onChange={e => set('new_joiner_cutoff_days', Number(e.target.value))} />
        </Field>
        <Field label="KRAs created by" hint="§0 made this the employee by default">
          <select value={s(draft.kra_created_by) || 'EMPLOYEE'}
                  onChange={e => set('kra_created_by', e.target.value)}>
            {KRA_AUTHORS.map(k => <option key={k} value={k}>{KRA_AUTHOR_LABEL[k]}</option>)}
          </select>
        </Field>
        {/* 218. THE CUSTOM CHAIN WINS WHEN ONE IS SET, so the preset below is
            disabled rather than hidden while it is — hiding it would leave an
            administrator unable to see what the policy falls back to, and
            leaving it live would offer two controls where only one decides. */}
        <Field label="Approval chain"
               hint={s(draft.chain_id)
                 ? 'A built chain is selected below, and that is what runs.'
                 : 'Who rates, in order'}>
          <select value={s(draft.approval_chain) || 'SELF_RM1_RM2_HOD'}
                  disabled={!!s(draft.chain_id)}
                  onChange={e => set('approval_chain', e.target.value)}>
            {CHAINS.map(c => <option key={c} value={c}>{CHAIN_LABEL[c]}</option>)}
            {/* The schema also permits SELF_RM1_RM2_HOD_MD and §6.2's example
                table uses it, but lib/pms/hierarchy has no MD step — no
                CHAIN_STEPS entry, no finaliser, nothing in the queues. Offering
                it would let an admin configure a chain the module cannot run,
                which is worse than not offering it. Kept visible if it is
                already set, so an existing value is never silently rewritten. */}
            {s(draft.approval_chain) === 'SELF_RM1_RM2_HOD_MD' && (
              <option value="SELF_RM1_RM2_HOD_MD">
                Self → RM L1 → RM L2 → HOD → MD (set in the database; not supported yet)
              </option>
            )}
          </select>
        </Field>
        <Field label="Or a chain you built"
               hint="Overrides the preset. Built in Approval chains.">
          <select value={s(draft.chain_id)}
                  onChange={e => set('chain_id', e.target.value || null)}>
            <option value="">Use the preset above</option>
            {chains.filter(c => c.is_active || s(c.id) === s(draft.chain_id))
                   .map(c => (
              <option key={s(c.id)} value={s(c.id)}>
                {s(c.name)} — {chainSummary(c.rungs as string[] | null)}
                {!c.is_active ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rating scale" hint="§13.2 recommends the 5-point scale">
          <select value={s(draft.rating_scale_type) || 'FIVE_POINT'}
                  onChange={e => set('rating_scale_type', e.target.value)}>
            {RATING_SCALES.map(r => <option key={r} value={r}>{RATING_SCALE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="Who may finalise" hint="Checked again by pms_finalise">
          <select value={s(draft.who_can_finalise) || 'RM1_RM2_HOD'}
                  onChange={e => set('who_can_finalise', e.target.value)}>
            {FINALISERS.map(f => <option key={f} value={f}>{FINALISER_LABEL[f]}</option>)}
          </select>
        </Field>
      </div>

      {/* 202: WHO RUNS THE APPRAISAL AFTER THE RATING IS SETTLED.
          A select and not a boolean, because neither value is the negation of
          the other — both name a person. 'HR' is the default and diverges from
          docx Stage 6, which gives the finaliser the appreciation remark, the
          improvement feedback and the recognition awards along with the
          rating; 'FINALISER' is that behaviour. Offered here so a company can
          choose, which is the whole reason the column exists rather than the
          split being hardcoded. */}
      <div className="grid g2">
        {/* 203: whether this company's employees may be published from a
            cross-company list. Default COMPANY — the restriction, not the
            permission, because a default that widens reach is the wrong way
            round for an irreversible action and the employee codes repeat
            across companies. */}
        <Field label="Publishing across companies"
               hint="Company only: these employees are published from their own company's list. Allow combined: they also appear when HR works on several companies at once.">
          <select value={String(draft.publish_scope ?? 'COMPANY')}
                  onChange={e => set('publish_scope', e.target.value)}>
            <option value="COMPANY">Company only</option>
            <option value="ALL">Allow a combined list</option>
          </select>
        </Field>
        <Field label="After the rating is settled"
               hint="HR: HR writes the feedback, awards recognition and publishes. Finaliser: whoever finalised does all of it, as docx Stage 6 describes.">
          <select value={String(draft.post_final_owner ?? 'HR')}
                  onChange={e => set('post_final_owner', e.target.value)}>
            <option value="HR">HR writes the feedback and publishes</option>
            <option value="FINALISER">The finaliser does all of it</option>
          </select>
        </Field>
        {/* 205: WHO the HR Head is, as a person.
            The HOD's Published Results banner said "a rating that genuinely
            needs correcting goes through HR" — a department, on the one
            screen where the HOD has no other control, about a result the
            employee has already read. Nothing in the database recorded a
            person: user_roles is empty, and the near-misses were all wrong
            (a free-text designation match found one "Hr Executive" in one of
            three companies; pms_feedback.given_by is the RM or the HOD).
            Scoped to the policy's own company, because employee codes repeat
            across the three organisations here. */}
        <Field label="HR Head"
               hint="Named on the HOD's published results, so a correction has somebody to go to. Leave unset and that screen says &ldquo;HR&rdquo; as before.">
          <select value={String(draft.hr_head_id ?? '')}
                  onChange={e => set('hr_head_id', e.target.value || null)}>
            <option value="">Nobody named yet</option>
            {people
              .filter(pp => !current?.company_id
                         || s(pp.company_id) === s(current.company_id))
              .map(pp => (
                <option key={s(pp.id)} value={s(pp.id)}>
                  {s(pp.emp_code)} · {s(pp.full_name)}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <div className="grid g4">
        {([
          ['self_rating_mandatory',   'Self rating is mandatory'],
          ['one_to_one_mandatory',    'One-to-one is mandatory'],
          ['mid_period_checkin',      'Mid-period check-in'],
          ['final_review_one_to_one', 'Final review is a one-to-one'],
          ['include_notice_period',   'Include people on notice'],
          ['include_exited',          'Include people who have left'],
          ['carry_forward_kras',      'Carry KRAs forward each cycle'],
          ['applies_to_all',          'Applies to everybody'],
          ['is_active',               'Policy is active'],
        ] as const).map(([k, label]) => (
          <Field key={k} label={label}>
            <select value={draft[k] ? 'yes' : 'no'} onChange={e => set(k, e.target.value === 'yes')}>
              <option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
        ))}
      </div>

      {/* Not offered, and deliberately so: 066 locks payout_linkage_enabled to
          false with a CHECK constraint, so a control for it could only ever
          fail. Saying why beats an admin hunting for a switch that cannot exist. */}
      <Note tone="warn">
        Performance is not linked to pay. That is fixed in the database, not a setting: the column is constrained to stay off.
      </Note>

      <SaveRow busy={busy} error={error} saved={saved}
               onSave={() => run(() => pmsAdmin('policy_update', { id, ...draft }), 'Policy saved.')} />
    </Card>
  )
}

// ══ 2. KRA LIBRARY ════════════════════════════════════════════════════════
const BLANK_KRA: Row = { kra_title: '', kpi_metric: '', suggested_target: '', category: 'BUSINESS', is_active: true }

function KraPanel({ kras, companyId, reload }: {
  kras: Row[]; companyId: string | null; reload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Row | null>(null)
  const { busy, error, saved, run } = useSaver(reload)

  const set = (k: string, v: unknown) => setEditing(d => d ? { ...d, [k]: v } : d)

  return (
    <Card title="KRA library"
          sub="The reusable list managers pick from. Editing one here does not change a KRA already assigned for a live period.">
      <div className="btnrow">
        <button className="btn" onClick={() => setEditing({ ...BLANK_KRA })}>Add a KRA</button>
      </div>

      {editing && (
        <>
          <div className="divider" />
          <div className="grid g3">
            <Field label="Title"><input value={s(editing.kra_title)} onChange={e => set('kra_title', e.target.value)} /></Field>
            <Field label="Measured by" hint="The KPI"><input value={s(editing.kpi_metric)} onChange={e => set('kpi_metric', e.target.value)} /></Field>
            <Field label="Suggested target"><input value={s(editing.suggested_target)} onChange={e => set('suggested_target', e.target.value)} /></Field>
          </div>
          <div className="grid g4">
            <Field label="Category">
              <select value={s(editing.category)} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select>
            </Field>
            <Field label="Suggested weightage"><input type="number" value={n(editing.suggested_weightage)} onChange={e => set('suggested_weightage', Number(e.target.value))} /></Field>
            <Field label="Designation" hint="Blank means any"><input value={s(editing.designation)} onChange={e => set('designation', e.target.value)} /></Field>
            <Field label="Grade" hint="Blank means any"><input value={s(editing.grade)} onChange={e => set('grade', e.target.value)} /></Field>
          </div>
          <SaveRow busy={busy} error={error} saved={saved}
                   label={editing.id ? 'Save KRA' : 'Add KRA'}
                   disabled={!s(editing.kra_title).trim() || (!editing.id && !companyId)}
                   onSave={async () => {
                     const okDone = await run(
                       () => pmsAdmin('kra_upsert', { ...editing, company_id: companyId }),
                       editing.id ? 'KRA saved.' : 'KRA added.')
                     if (okDone) setEditing(null)
                   }} />
          {!editing.id && !companyId && (
            <Note tone="warn">No company could be determined from the periods on this screen, so a new KRA cannot be filed against one yet.</Note>
          )}
        </>
      )}

      <div className="divider" />
      <div className="tblwrap">
        <table>
          <thead><tr><th>KRA</th><th>Measured by</th><th>Category</th><th>Weight</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!kras.length && <tr><td colSpan={6} className="k">Nothing in the library yet.</td></tr>}
            {kras.map(k => (
              <tr key={s(k.id)}>
                <td>{s(k.kra_title)}</td>
                <td className="k">{s(k.kpi_metric) || '-'}</td>
                <td>{s(k.category).toLowerCase()}</td>
                <td className="num">{k.suggested_weightage === null ? '-' : s(k.suggested_weightage)}</td>
                <td><span className={`pill ${k.is_active ? 'p-green' : 'p-grey'}`}>{k.is_active ? 'active' : 'off'}</span></td>
                <td>
                  <div className="btnrow">
                    <button className="btn ghost" onClick={() => setEditing({ ...k })}>Edit</button>
                    {/* Deactivate, never delete: the row may already be referenced
                        by an employee's goals for a live period. */}
                    <button className="btn ghost"
                            onClick={() => run(() => pmsAdmin('kra_set_active', { id: k.id, is_active: !k.is_active }),
                                               k.is_active ? 'KRA switched off.' : 'KRA switched on.')}>
                      {k.is_active ? 'Switch off' : 'Switch on'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ══ 3c. HR HEAD AUTHORITY ═════════════════════════════════════════════════

/**
 * WHAT THE HR HEAD MAY DO, in one place.
 *
 * Requested: whether the HR Head can finalise a rating, override the HOD's,
 * and the rest, should all be flexible and changeable from here.
 *
 * Most of it already was — hr_head_final_rating, post_final_owner,
 * publish_scope and hr_head_id are policy columns and have been. They were
 * spread across two tabs, which is most of why it did not feel
 * configurable. Only the override, the direct appraisal and the upload
 * needed new columns (217).
 *
 * ── PER POLICY, WHICH MEANS PER COMPANY ────────────────────────────────
 *
 * Three companies, three policies, three different answers if they want
 * them. The selector is the first thing on the screen for the reason the
 * publish workspace narrows by company: every policy here is called
 * "Standard Quarterly", and changing the wrong company's rules is not a
 * mistake you notice.
 *
 * ── THE HR HEAD CANNOT REACH THIS SCREEN ───────────────────────────────
 *
 * Setup & Controls requires full Performance management, which the HR Head
 * role does not have. That is the only version of this that means
 * anything: a person who can grant themselves a power is not limited by it.
 */
function AuthorityPanel({ policies, companies, reload }: {
  policies: Row[]; companies: Row[]; reload: () => Promise<void>
}) {
  const [id, setId] = useState<string>('')
  const [draft, setDraft] = useState<Row>({})
  const { busy, error, saved, run } = useSaver(reload)
  const current = useMemo(() => policies.find(p => s(p.id) === id), [policies, id])
  const coName = (cid: unknown) =>
    s(companies.find(c => s(c.id) === s(cid))?.company_name) || 'Unknown company'

  useEffect(() => {
    if (!id && policies.length) setId(s(policies[0].id))
  }, [policies, id])
  useEffect(() => { setDraft(current ? { ...current } : {}) }, [current])

  const set = (k: string, v: unknown) => setDraft(d => ({ ...d, [k]: v }))
  // UNSET READS AS ON, exactly as the engine reads it: a policy written
  // before 217 has no value in these columns and the module behaves as it
  // always did. A screen that showed them as off would be describing a
  // state the code disagrees with.
  const yes = (k: string) => draft[k] !== false

  const Toggle = ({ col, title, when, unless }: {
    col: string; title: string; when: string; unless: string
  }) => (
    <div className="askrow" style={{ marginBottom: 8 }}>
      <label className="chk" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={yes(col)}
               onChange={e => set(col, e.target.checked)} />
        <span>
          <b>{title}</b>
          <div className="k" style={{ marginTop: 3, lineHeight: 1.6 }}>
            {yes(col) ? when : unless}
          </div>
        </span>
      </label>
    </div>
  )

  if (!policies.length) {
    return <Card title="HR Head authority" sub="What the HR Head may do in this cycle.">
      <Note tone="warn">No policy exists yet, so there is nothing to configure.</Note>
    </Card>
  }

  return (
    <Card title="HR Head authority"
          sub="What the HR Head may do, per policy. Switching something off stops new use of it — ratings already settled stay settled.">
      <Field label="Policy"
             hint="Every company has its own, and they can differ.">
        <select value={id} onChange={e => setId(e.target.value)}>
          {policies.map(p => (
            <option key={s(p.id)} value={s(p.id)}>
              {coName(p.company_id)} — {s(p.policy_name) || 'Policy'}
            </option>
          ))}
        </select>
      </Field>

      <div className="divider" />
      <div className="lbl" style={{ marginBottom: 6 }}>Settling the final rating</div>
      <Toggle col="hr_head_final_rating"
              title="The HR Head settles the final rating before anything is published"
              when="Nothing publishes until they confirm the rating and record that it was discussed with management."
              unless="The chain’s rating stands and results publish without a separate confirmation." />
      {yes('hr_head_final_rating') && (
        <Toggle col="hr_head_can_override"
                title="…and may replace the rating the chain settled"
                when="They can keep the chain’s number or set a different one, with a written reason."
                unless="They confirm the chain’s rating as it is. The number itself is the chain’s." />
      )}

      <div className="divider" />
      <div className="lbl" style={{ marginBottom: 6 }}>Outside the chain</div>
      <Toggle col="hr_head_can_direct"
              title="The HR Head can build an appraisal for somebody the chain never started"
              when="KRAs, a rating for each and a final rating, for a transfer or a role the routing missed. Recorded as an exception with their name and reason."
              unless="Everybody goes through the chain. Someone the cycle missed ends the period with no appraisal." />

      <div className="divider" />
      <div className="lbl" style={{ marginBottom: 6 }}>Rating uploads</div>
      <Field label="Who may commit a bulk or single rating upload"
             hint="A rating upload replaces what the chain decided, so this is the widest power on the screen.">
        <select value={s(draft.rating_upload_by) || 'HR_ANY'}
                onChange={e => set('rating_upload_by', e.target.value)}>
          <option value="HR_ANY">HR Manager, HR Head or Admin</option>
          <option value="HR_HEAD">The HR Head only</option>
          <option value="NOBODY">Nobody — the chain is the only route</option>
        </select>
      </Field>

      <div className="divider" />
      <div className="lbl" style={{ marginBottom: 6 }}>After the rating is settled</div>
      <Field label="Who writes the feedback and publishes"
             hint="Already on the Policy tab; here too because it is part of the same question.">
        <select value={s(draft.post_final_owner) || 'HR'}
                onChange={e => set('post_final_owner', e.target.value)}>
          <option value="HR">HR</option>
          <option value="FINALISER">Whoever finalised the rating</option>
        </select>
      </Field>
      <Field label="Publishing scope"
             hint="Whether this company’s results can be released alongside other companies’.">
        <select value={s(draft.publish_scope) || 'COMPANY'}
                onChange={e => set('publish_scope', e.target.value)}>
          <option value="COMPANY">One company at a time</option>
          <option value="ALL">May be published together with other opted-in companies</option>
        </select>
      </Field>

      <SaveRow busy={busy} error={error} saved={saved} label="Save authority"
               disabled={!id}
               onSave={() => run(() => pmsAdmin('policy_update', { ...draft, id }),
                                 'Authority saved.')} />

      <Note tone="warn">
        These settings are not visible to the HR Head: Setup &amp; Controls needs
        full access to Performance, which that role does not have. A power
        somebody can grant themselves is not a limit on them.
      </Note>
    </Card>
  )
}

// ══ 3b. TRAINING CATALOGUE ════════════════════════════════════════════════

const BLANK_COURSE: Row = {
  course_name: '', provider: '', skill: '', category: 'TECHNICAL',
  level: 'INTERMEDIATE', url: '', duration_hours: null, notes: '', is_active: true,
}

const COURSE_CATEGORIES = ['TECHNICAL', 'BEHAVIOURAL', 'LEADERSHIP',
                           'DOMAIN', 'COMPLIANCE', 'OTHER'] as const
const COURSE_LEVELS = ['FOUNDATION', 'INTERMEDIATE', 'ADVANCED'] as const

/**
 * THE COURSES THE AI SUGGESTION RETRIEVES FROM (215).
 *
 * Empty until somebody fills it, and the screen says so rather than
 * showing a blank table: while it is empty every suggestion a rater sees
 * is a skill area, because the model is not allowed to name a course it
 * cannot vouch for.
 *
 * ── WHY "WHAT IT TEACHES" IS THE FIELD THAT MATTERS ────────────────────
 *
 * Retrieval scores the skill three times higher than the course title. A
 * row with a polished name and no skill is a course the engine can never
 * surface — present in the catalogue and invisible in practice, which is
 * worse than absent. The form says so, and refuses to save without it.
 */
function CataloguePanel({ catalogue, companyId, reload }: {
  catalogue: Row[]; companyId: string | null; reload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Row | null>(null)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(false)
  const { busy, error, saved, run } = useSaver(reload)
  const set = (k: string, v: unknown) => setEditing(d => d ? { ...d, [k]: v } : d)

  const shown = catalogue.filter(c => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return [c.course_name, c.skill, c.provider].some(v => s(v).toLowerCase().includes(t))
  })
  const active = catalogue.filter(c => c.is_active).length

  return (
    <Card title="Training catalogue"
          sub="The courses this organisation can actually send somebody on. The AI suggestion matches against these before it proposes anything of its own.">
      {!catalogue.length && (
        <Note tone="warn">
          The catalogue is empty. Until it has courses, every suggestion a
          manager sees is a <b>skill area</b> rather than something they can
          book — the model is deliberately not allowed to name a course,
          because an invented one is indistinguishable from a real one once
          it reaches HR.
        </Note>
      )}

      <div className="btnrow">
        <button className="btn" onClick={() => setEditing({ ...BLANK_COURSE })}>Add a course</button>
        {catalogue.length > 0 && (
          <span className="k" style={{ alignSelf: 'center' }}>
            {active} active of {catalogue.length}
          </span>
        )}
      </div>

      {/* Retire and Bring back sit in the table, away from any SaveRow. */}
      {!editing && <RowFeedback error={error} saved={saved} />}

      {editing && (
        <>
          <div className="divider" />
          <div className="grid g2">
            <Field label="Course name" hint="What it is called on the invoice">
              <input value={s(editing.course_name)}
                     onChange={e => set('course_name', e.target.value)} />
            </Field>
            <Field label="Provider" hint="Internal L&amp;D, or whoever runs it">
              <input value={s(editing.provider)}
                     onChange={e => set('provider', e.target.value)} />
            </Field>
          </div>

          <Field label="What it teaches"
                 hint="The words a manager would use in a review — “stock accuracy cycle counting variance”. This is what the suggestion matches on, and it counts for three times the course name.">
            <input value={s(editing.skill)} onChange={e => set('skill', e.target.value)} />
          </Field>

          <div className="grid g4">
            <Field label="Kind">
              <select value={s(editing.category)} onChange={e => set('category', e.target.value)}>
                {COURSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.toLowerCase()}</option>
                ))}
              </select>
            </Field>
            <Field label="Level">
              <select value={s(editing.level)} onChange={e => set('level', e.target.value)}>
                {COURSE_LEVELS.map(c => (
                  <option key={c} value={c}>{c.toLowerCase()}</option>
                ))}
              </select>
            </Field>
            <Field label="Hours" hint="Blank if it varies">
              <input type="number" value={editing.duration_hours === null ? '' : n(editing.duration_hours)}
                     onChange={e => set('duration_hours',
                       e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
            <Field label="Link" hint="Where to book it">
              <input value={s(editing.url)} onChange={e => set('url', e.target.value)} />
            </Field>
          </div>

          {!editing.id && (
            <label className="chk" style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                            margin: '8px 0', lineHeight: 1.6 }}>
              <input type="checkbox" checked={group}
                     onChange={e => setGroup(e.target.checked)} />
              <span>
                Available to <b>every company</b> in the group, not just this one.
                <span className="k"> Leave this off for a course only one company runs.</span>
              </span>
            </label>
          )}

          <SaveRow busy={busy} error={error} saved={saved}
                   label={editing.id ? 'Save course' : 'Add course'}
                   disabled={!s(editing.course_name).trim() || !s(editing.skill).trim()
                             || (!editing.id && !group && !companyId)}
                   onSave={async () => {
                     const okDone = await run(
                       () => pmsAdmin('catalogue_upsert',
                         { ...editing, company_id: group ? null : companyId }),
                       editing.id ? 'Course saved.' : 'Course added.')
                     if (okDone) { setEditing(null); setGroup(false) }
                   }} />
          {!s(editing.skill).trim() && s(editing.course_name).trim() && (
            <Note tone="warn">
              Without “what it teaches”, nothing will ever match this course.
            </Note>
          )}
        </>
      )}

      {catalogue.length > 0 && (
        <>
          <div className="divider" />
          <Field label="Find a course">
            <input value={q} placeholder="name, provider, or what it teaches"
                   onChange={e => setQ(e.target.value)} />
          </Field>
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Course</th><th>What it teaches</th><th>Provider</th>
                    <th>Kind</th><th>Scope</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {!shown.length && (
                  <tr><td colSpan={7} className="k">Nothing matches that.</td></tr>
                )}
                {shown.map(c => (
                  <tr key={s(c.id)}>
                    <td>{s(c.course_name)}</td>
                    <td className="k">{s(c.skill)}</td>
                    <td className="k">{s(c.provider) || '-'}</td>
                    <td>{s(c.category).toLowerCase()}</td>
                    <td className="k">{c.company_id ? 'this company' : 'whole group'}</td>
                    <td>
                      <span className={`pill ${c.is_active ? 'p-green' : 'p-grey'}`}>
                        {c.is_active ? 'active' : 'retired'}
                      </span>
                    </td>
                    <td>
                      <div className="btnrow">
                        <button className="btn ghost" onClick={() => setEditing({ ...c })}>Edit</button>
                        {/* Retired, never deleted: a suggestion already in a
                            manager's bin points at this row. */}
                        <button className="btn ghost"
                                onClick={() => run(
                                  () => pmsAdmin('catalogue_set_active',
                                    { id: c.id, is_active: !c.is_active }),
                                  c.is_active ? 'Course retired.' : 'Course back in use.')}>
                          {c.is_active ? 'Retire' : 'Bring back'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

// ══ 2b. THE CHAIN BUILDER (218) ═══════════════════════════════════════════
//
// Requested: the chain should be fully customisable and editable — change the
// KRA and approval chains, build a completely new one, all from the admin side.
//
// ── WHAT THIS SCREEN HAS TO MAKE OBVIOUS ─────────────────────────────────
//
// Three things, and getting any of them wrong leaves somebody confidently
// mistaken about how their company is being appraised:
//
//   THE TWO ENDS ARE FIXED. The self rating starts every chain and HR ends
//   it. They are drawn, dimmed, in the track — not offered as removable
//   rungs — because a chain that looks like it has no publisher is one
//   somebody will try to build.
//
//   AN EMPTY RUNG IS SKIPPED, NOT BLOCKED ON. Nobody has a regional head
//   assigned. A chain naming one still works and simply does less than it
//   appears to, so the coverage count sits against the choice rather than in
//   a footnote — the number is the warning.
//
//   AN EDIT DOES NOT REACH APPRAISALS ALREADY RUNNING. chain_shape freezes
//   per appraisal at submission. Said on the screen because the opposite is
//   the natural assumption and the consequence of assuming wrongly is an
//   administrator "fixing" a live cycle.

/** Reordering by drag, with the keyboard as the equal path and not a fallback. */
function RungRow({ rung, idx, count, cover, onMove, onRemove }: {
  rung: string; idx: number; count: number
  cover?: { have: number; of: number }
  onMove: (from: number, to: number) => void
  onRemove: () => void
}) {
  const [over, setOver] = useState(false)
  const choice = RUNG_CHOICES.find(c => c.stage === rung)
  const empty = cover && cover.of > 0 && cover.have === 0
  const partial = cover && cover.of > 0 && cover.have > 0 && cover.have < cover.of

  return (
    <div className={`rung${over ? ' rung-over' : ''}`}
         draggable
         onDragStart={e => {
           e.dataTransfer.setData('application/x-pms-rung', String(idx))
           e.dataTransfer.effectAllowed = 'move'
         }}
         onDragOver={e => { e.preventDefault(); setOver(true) }}
         onDragLeave={() => setOver(false)}
         onDrop={e => {
           e.preventDefault(); setOver(false)
           const from = Number(e.dataTransfer.getData('application/x-pms-rung'))
           if (Number.isInteger(from) && from !== idx) onMove(from, idx)
         }}>
      <span className="rung-no">{idx + 1}</span>
      <span className="rung-grip" aria-hidden>⠿</span>
      <span className="rung-name">
        {choice?.label ?? rung}
        {empty && <span className="pill p-amber">skipped for everybody</span>}
        {partial && (
          <span className="pill p-grey">
            skipped for {cover!.of - cover!.have} of {cover!.of}
          </span>
        )}
      </span>
      {/* The keyboard path. A drag handle alone makes ordering — the only
          thing this screen is for — reachable by exactly one input method. */}
      <div className="btnrow">
        <button className="btn ghost" disabled={idx === 0}
                aria-label={`Move ${choice?.label ?? rung} earlier`}
                onClick={() => onMove(idx, idx - 1)}>↑</button>
        <button className="btn ghost" disabled={idx === count - 1}
                aria-label={`Move ${choice?.label ?? rung} later`}
                onClick={() => onMove(idx, idx + 1)}>↓</button>
        <button className="btn ghost"
                aria-label={`Remove ${choice?.label ?? rung}`}
                onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}

const BLANK_CHAIN: Row = { name: '', rungs: [], notes: '', is_active: true }

function ChainPanel({ chains, policies, coverage, companyId, reload }: {
  chains: Row[]; policies: Row[]
  coverage: Record<string, { have: number; of: number }> | null
  companyId: string | null; reload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Row | null>(null)
  const [group, setGroup] = useState(false)
  const { busy, error, saved, run, reset } = useSaver(reload)

  const draft = (editing?.rungs as string[] | undefined) ?? []
  const setRungs = (next: string[]) => setEditing(d => d ? { ...d, rungs: next } : d)
  const set = (k: string, v: unknown) => setEditing(d => d ? { ...d, [k]: v } : d)

  const move = (from: number, to: number) => {
    const next = [...draft]
    const [r] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(next.length, to)), 0, r)
    setRungs(next)
  }

  // The same refusal the route will give, computed as they type so the Save
  // button can explain itself before it is pressed rather than after.
  const fault = editing
    ? chainFault({ name: s(editing.name), rungs: draft })
    : null
  const warnings = editing ? chainWarnings(draft, coverage) : []
  const unused = RUNG_CHOICES.filter(c => !draft.includes(c.stage))

  return (
    <Card title="Approval chains"
          sub="Who an appraisal travels through, in what order. Build as many as you need and point each policy at one.">
      {!chains.length && (
        <Note tone="warn">
          No chains yet, so every policy is using one of the three built-in
          presets. Nothing changes until you build a chain <i>and</i> select it
          on a policy — see <b>Policy rules</b>.
        </Note>
      )}

      <div className="btnrow">
        <button className="btn"
                onClick={() => { reset(); setEditing({ ...BLANK_CHAIN, rungs: [] }) }}>
          Build a chain
        </button>
        {chains.length > 0 && (
          <span className="k" style={{ alignSelf: 'center' }}>
            {chains.filter(c => c.is_active).length} active of {chains.length}
          </span>
        )}
      </div>

      {/* Retire lives in the table below, with no save button beside it. */}
      {!editing && <RowFeedback error={error} saved={saved} />}

      {editing && (
        <>
          <div className="divider" />
          <Field label="Name this chain"
                 hint="What you will pick on a policy — “Plant staff, via site HR”">
            <input value={s(editing.name)} maxLength={MAX_CHAIN_NAME}
                   onChange={e => set('name', e.target.value)} />
          </Field>

          {/* ── the track ────────────────────────────────────────────────── */}
          <div className="k" style={{ margin: '10px 0 6px' }}>
            The order an appraisal travels. Drag to reorder, or use the arrows.
          </div>
          <div className="chaintrack">
            <div className="rung rung-end">
              <span className="rung-no">·</span>
              <span className="rung-name">
                The employee rates themselves
                <span className="pill p-grey">always first</span>
              </span>
            </div>

            {!draft.length && (
              <div className="rung rung-none">
                <span className="rung-name k">
                  No approvers yet. Add one below — without any, a submission
                  would go straight to publishing.
                </span>
              </div>
            )}

            {draft.map((r, i) => (
              <RungRow key={r} rung={r} idx={i} count={draft.length}
                       cover={coverage?.[r]} onMove={move}
                       onRemove={() => setRungs(draft.filter(x => x !== r))} />
            ))}

            <div className="rung rung-end">
              <span className="rung-no">·</span>
              <span className="rung-name">
                HR settles the final rating and publishes
                <span className="pill p-grey">always last</span>
              </span>
            </div>
          </div>

          {/* ── what is left to add ──────────────────────────────────────── */}
          {unused.length > 0 && (
            <>
              <div className="k" style={{ margin: '12px 0 6px' }}>Add a rung</div>
              <div className="btnrow wrap">
                {unused.map(c => {
                  const cov = coverage?.[c.stage]
                  return (
                    <button key={c.stage} className="btn ghost"
                            title={c.hint}
                            onClick={() => setRungs([...draft, c.stage])}>
                      + {c.label}
                      {cov && cov.of > 0 && (
                        <span className="k"> · {cov.have} of {cov.of} have one</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <Field label="Notes" hint="Why this chain exists, for whoever reads it next">
            <input value={s(editing.notes)} onChange={e => set('notes', e.target.value)} />
          </Field>

          {!editing.id && (
            <label className="chk" style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                            margin: '8px 0', lineHeight: 1.6 }}>
              <input type="checkbox" checked={group}
                     onChange={e => setGroup(e.target.checked)} />
              <span>
                Available to <b>every company</b> in the group, not just this one.
                <span className="k"> Leave this off for a chain only one company runs.</span>
              </span>
            </label>
          )}

          {warnings.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}

          {/* The consequence of an edit, said where the edit happens. */}
          {editing.id && usedBy(s(editing.id), policies as never).length > 0 && (
            <Note tone="warn">
              <b>{usedBy(s(editing.id), policies as never).join(', ')}</b>{' '}
              {usedBy(s(editing.id), policies as never).length === 1 ? 'uses' : 'use'}{' '}
              this chain. Appraisals already under way keep the chain they
              started on — the shape is frozen when an employee submits — so
              this applies to appraisals that start after you save.
            </Note>
          )}

          <SaveRow busy={busy} error={error} saved={saved}
                   label={editing.id ? 'Save chain' : 'Create chain'}
                   disabled={!!fault || (!editing.id && !group && !companyId)}
                   onSave={async () => {
                     const okDone = await run(
                       () => pmsAdmin('chain_upsert',
                         { ...editing, company_id: group ? null : companyId }),
                       editing.id ? 'Chain saved.' : 'Chain created.')
                     if (okDone) { setEditing(null); setGroup(false) }
                   }} />
          {/* Why the button is off, rather than a disabled button and silence. */}
          {fault && <Note tone="warn">{fault}</Note>}
          <div className="k" style={{ marginTop: 6 }}>
            Will run as: <b>{chainSummary(draft)}</b>
          </div>
        </>
      )}

      {chains.length > 0 && (
        <>
          <div className="divider" />
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Chain</th><th>Runs as</th><th>Used by</th>
                    <th>Scope</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {chains.map(c => {
                  const users = usedBy(s(c.id), policies as never)
                  return (
                    <tr key={s(c.id)}>
                      <td>
                        {s(c.name)}
                        {!!s(c.notes) && <div className="k">{s(c.notes)}</div>}
                      </td>
                      <td className="k">{chainSummary(c.rungs as string[] | null)}</td>
                      <td className="k">
                        {users.length ? users.join(', ') : 'no policy yet'}
                      </td>
                      <td className="k">{c.company_id ? 'this company' : 'whole group'}</td>
                      <td>
                        <span className={`pill ${c.is_active ? 'p-green' : 'p-grey'}`}>
                          {c.is_active ? 'active' : 'retired'}
                        </span>
                      </td>
                      <td>
                        <div className="btnrow">
                          <button className="btn ghost"
                                  onClick={() => { reset(); setEditing({
                                    ...c,
                                    // The two fixed ends are drawn separately, so
                                    // the editable list is the approvers only.
                                    rungs: ((c.rungs as string[] | null) ?? [])
                                      .filter(r => r !== 'EMPLOYEE' && r !== 'HR'),
                                  }) }}>Edit</button>
                          {/* Retired, never deleted: a policy may point at this
                              row and every appraisal that ran it recorded the
                              shape. The route refuses while it is in use. */}
                          <button className="btn ghost"
                                  title={users.length && c.is_active
                                    ? `${users.join(', ')} still use this chain`
                                    : undefined}
                                  onClick={() => run(
                                    () => pmsAdmin('chain_set_active',
                                      { id: c.id, is_active: !c.is_active }),
                                    c.is_active ? 'Chain retired.' : 'Chain back in use.')}>
                            {c.is_active ? 'Retire' : 'Bring back'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

// ══ 3. RATING SCALE ═══════════════════════════════════════════════════════
function ScalePanel({ scale, companyId, reload }: {
  scale: Row[]; companyId: string | null; reload: () => Promise<void>
}) {
  const [draft, setDraft] = useState<Row | null>(null)
  const { busy, error, saved, run } = useSaver(reload)
  const set = (k: string, v: unknown) => setDraft(d => d ? { ...d, [k]: v } : d)

  // A band whose range overlaps its neighbour makes pms_rating_from_score
  // ambiguous, so it is worth saying before the save rather than after.
  const overlap = useMemo(() => {
    const rows = [...scale].sort((a, b) => n(a.score_from) - n(b.score_from))
    for (let i = 1; i < rows.length; i++) {
      if (n(rows[i].score_from) <= n(rows[i - 1].score_to)) {
        return `${s(rows[i - 1].rating_code)} and ${s(rows[i].rating_code)} overlap.`
      }
    }
    return null
  }, [scale])

  return (
    <Card title="Rating scale" sub="The bands that turn a score into a rating. They should meet without overlapping.">
      {overlap && <Note tone="warn">{overlap} A score in the overlap could resolve to either band.</Note>}

      <div className="tblwrap">
        <table>
          <thead><tr><th>Code</th><th>Label</th><th>Value</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!scale.length && <tr><td colSpan={7} className="k">No bands defined.</td></tr>}
            {scale.map(b => (
              <tr key={s(b.id)}>
                <td><b>{s(b.rating_code)}</b></td>
                <td>{s(b.rating_label)}</td>
                <td className="num">{s(b.rating_value)}</td>
                <td className="num">{s(b.score_from)}</td>
                <td className="num">{s(b.score_to)}</td>
                <td><span className={`pill ${b.is_active ? 'p-green' : 'p-grey'}`}>{b.is_active ? 'active' : 'off'}</span></td>
                <td><button className="btn ghost" onClick={() => setDraft({ ...b })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="btnrow">
        <button className="btn ghost" onClick={() => setDraft({
          rating_code: '', rating_label: '', rating_value: 0,
          score_from: 0, score_to: 0, is_active: true, sort_order: scale.length,
        })}>Add a band</button>
      </div>

      {draft && (
        <>
          <div className="divider" />
          <div className="grid g4">
            <Field label="Code" hint="O / EE / ME / NI / U"><input value={s(draft.rating_code)} onChange={e => set('rating_code', e.target.value)} /></Field>
            <Field label="Label"><input value={s(draft.rating_label)} onChange={e => set('rating_label', e.target.value)} /></Field>
            <Field label="Rating value"><input type="number" step="0.01" value={n(draft.rating_value)} onChange={e => set('rating_value', Number(e.target.value))} /></Field>
            <Field label="Active">
              <select value={draft.is_active ? 'yes' : 'no'} onChange={e => set('is_active', e.target.value === 'yes')}>
                <option value="yes">Yes</option><option value="no">No</option>
              </select>
            </Field>
          </div>
          <div className="grid g4">
            <Field label="Score from"><input type="number" step="0.01" value={n(draft.score_from)} onChange={e => set('score_from', Number(e.target.value))} /></Field>
            <Field label="Score to"><input type="number" step="0.01" value={n(draft.score_to)} onChange={e => set('score_to', Number(e.target.value))} /></Field>
            <Field label="Minimum comment length"><input type="number" value={n(draft.min_comment_chars)} onChange={e => set('min_comment_chars', Number(e.target.value))} /></Field>
            <Field label="Sort order"><input type="number" value={n(draft.sort_order)} onChange={e => set('sort_order', Number(e.target.value))} /></Field>
          </div>
          {/* THE THREE BAND BEHAVIOURS, none of which had a control.
              All three are columns that have existed for a while and were
              edited nowhere — and two of them are now ENFORCED, which makes
              their absence a trap rather than a gap: the rating form demands
              a comment of min_comment_chars and refuses to send without
              improvement wording at a mandatory band, and the PIP checkbox
              appears or does not according to a flag an admin could not see.
              A rule you cannot find is a rule that reads as a bug. */}
          <div className="grid g3" style={{ marginTop: 4 }}>
            <Field label="Improvement feedback mandatory"
                   hint="At this band the rater's remark must say what would change, and the result cannot publish without improvement feedback.">
              <select value={draft.improvement_feedback_mandatory ? 'yes' : 'no'}
                      onChange={e => set('improvement_feedback_mandatory', e.target.value === 'yes')}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </Field>
            <Field label="May raise a PIP"
                   hint="Scoring in this band offers the rater an optional checkbox to request a performance improvement plan. HR still decides.">
              <select value={draft.allows_pip_request ? 'yes' : 'no'}
                      onChange={e => set('allows_pip_request', e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
            <Field label="May propose recognition"
                   hint="Scoring in this band offers the rater a box to recommend a bonus, promotion or other recognition. HR still decides.">
              <select value={draft.allows_recognition ? 'yes' : 'no'}
                      onChange={e => set('allows_recognition', e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
          </div>
          <SaveRow busy={busy} error={error} saved={saved}
                   label={draft.id ? 'Save band' : 'Add band'}
                   disabled={!s(draft.rating_code).trim() || n(draft.score_to) < n(draft.score_from) || (!draft.id && !companyId)}
                   onSave={async () => {
                     const done = await run(() => pmsAdmin('scale_upsert', { ...draft, company_id: companyId }),
                                            draft.id ? 'Band saved.' : 'Band added.')
                     if (done) setDraft(null)
                   }} />
          {n(draft.score_to) < n(draft.score_from) && <Note tone="bad">The upper bound is below the lower bound.</Note>}
        </>
      )}
    </Card>
  )
}

// ══ 4. CYCLE CONTROL ══════════════════════════════════════════════════════
/** The five windows a period carries, in the order the work happens. */
const WINDOWS: { from: string; to: string; label: string; hint: string }[] = [
  { from: 'kra_window_from',  to: 'kra_window_to',  label: 'KRA setting',
    hint: 'When people may write and change their KRAs' },
  { from: 'checkin_from',     to: 'checkin_to',     label: 'Mid-period check-in',
    hint: 'Optional, and skipped entirely on a monthly cycle' },
  { from: 'self_rating_from', to: 'self_rating_to', label: 'Self rating',
    hint: 'Reopening this is how somebody who missed it gets their own view on record' },
  { from: 'rm_review_from',   to: 'rm_review_to',   label: 'Manager review',
    hint: 'When RM L1 and RM L2 may rate' },
  { from: 'finalise_from',    to: 'finalise_to',    label: 'Finalise',
    hint: 'When the final rating may be set' },
]

function CyclePanel({ policies, periods, companies, reload }: {
  policies: Row[]; periods: Row[]; companies: Row[]; reload: () => Promise<void>
}) {
  /** "Q2 2026-27" exists once per company, so the bare period name named three
   *  different things. On the window editor that is confusing; on "Open a
   *  period" it is dangerous, because opening enrols everybody and cannot be
   *  undone from this screen. Every period option now says whose it is. */
  const companyName = useMemo(
    () => new Map(companies.map(c => [s(c.id), s(c.company_name)])), [companies])
  const periodLabel = useCallback((p: Row) => {
    const co = companyName.get(s(p.company_id))
    return `${s(p.period_name)}${co ? ' · ' + co : ''} · ${s(p.status).toLowerCase()}`
  }, [companyName])
  const gen = useSaver(reload)
  const open = useSaver(reload)
  const win = useSaver(reload)

  const [policyId, setPolicyId] = useState('')
  const [fy, setFy] = useState('')
  const [fyStart, setFyStart] = useState('')

  const [periodId, setPeriodId] = useState('')
  const [typed, setTyped] = useState('')

  /** The windows of the period being edited below. Loaded from the row rather
   *  than typed blind, so an admin nudging one date does not blank the others. */
  const [winId, setWinId] = useState('')
  const [winVals, setWinVals] = useState<Record<string, string>>({})
  const winRow = useMemo(() => periods.find(p => s(p.id) === winId), [periods, winId])
  useEffect(() => {
    if (!winRow) { setWinVals({}); return }
    setWinVals(Object.fromEntries(WINDOWS.flatMap(w =>
      [[w.from, s(winRow[w.from])], [w.to, s(winRow[w.to])]])))
  }, [winRow])

  useEffect(() => { if (!policyId && policies.length) setPolicyId(s(policies[0].id)) }, [policies, policyId])

  const openable = useMemo(
    () => periods.filter(p => s(p.status) !== 'OPEN' && s(p.status) !== 'CLOSED'), [periods])
  const chosen = useMemo(() => periods.find(p => s(p.id) === periodId), [periods, periodId])

  // The typed-name confirmation. pms_open_period enrols every eligible
  // employee and writes a row each, and there is no close_period to undo it —
  // reversing means deleting those rows by hand. A single click is too cheap
  // for that, so the name has to be typed exactly.
  const nameMatches = !!chosen && typed.trim() === s(chosen.period_name).trim()

  return (
    <>
      <Card title="Generate a year of periods"
            sub="Creates the scheduled periods for a financial year from the policy's frequency. It does not open them.">
        <div className="grid g4">
          <Field label="Policy">
            <select value={policyId} onChange={e => setPolicyId(e.target.value)}>
              {policies.map(p => <option key={s(p.id)} value={s(p.id)}>{s(p.policy_name)}</option>)}
            </select>
          </Field>
          <Field label="Financial year" hint="e.g. 2027-28"><input value={fy} onChange={e => setFy(e.target.value)} placeholder="2027-28" /></Field>
          <Field label="First day of that year"><input type="date" value={fyStart} onChange={e => setFyStart(e.target.value)} /></Field>
        </div>
        <SaveRow busy={gen.busy} error={gen.error} saved={gen.saved} label="Generate periods"
                 disabled={!policyId || !fy.trim() || !fyStart}
                 onSave={() => gen.run(
                   () => pmsAdmin<{ created: number }>('periods_generate', { policy_id: policyId, fy: fy.trim(), fy_start: fyStart }),
                   'Periods generated.')} />
      </Card>

      <Card title="Open a period"
            sub="Opening enrols every eligible employee and starts the KRA window.">
        <Note tone="warn">
          This cannot be undone from this screen. There is no close-and-reopen: reversing an
          accidental open means deleting the enrolment rows by hand, in the database.
        </Note>
        <div className="grid g3">
          <Field label="Period">
            <select value={periodId} onChange={e => { setPeriodId(e.target.value); setTyped('') }}>
              <option value="">Choose a period…</option>
              {openable.map(p => (
                <option key={s(p.id)} value={s(p.id)}>{periodLabel(p)}</option>
              ))}
            </select>
          </Field>
          {chosen && (
            <Field label={`Type "${s(chosen.period_name)}" to confirm`}
                   hint="Deliberately awkward, because the action is not reversible">
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={s(chosen.period_name)} />
            </Field>
          )}
        </div>
        <SaveRow busy={open.busy} error={open.error} saved={open.saved} label="Open this period"
                 disabled={!periodId || !nameMatches}
                 onSave={() => open.run(
                   () => pmsAdmin<{ message: string }>('period_open', { period_id: periodId, confirm: true }),
                   'Period opened.')} />
      </Card>

      {/* THE WINDOWS WERE SET ONCE AND NEVER CORRECTABLE. pms_generate_periods
          lays them out from the frequency, and there was no way to change one
          afterwards — so a window set wrongly, or one that has simply passed,
          was permanent. The employee's own screen offers "Ask your manager to
          reopen it" for a missed self-rating window; this is the thing that
          actually does it, and by §2's role matrix it belongs to HR Head and
          Admin rather than to a manager. */}
      <Card title="Change a period's windows"
            sub="Who may act, and when. Moving a window does not change anything already recorded against the period — and reopening a closed one is how a missed self rating gets back on record.">
        <div className="grid g3">
          <Field label="Period">
            <select value={winId} onChange={e => setWinId(e.target.value)}>
              <option value="">Choose a period…</option>
              {periods.map(p => (
                <option key={s(p.id)} value={s(p.id)}>{periodLabel(p)}</option>
              ))}
            </select>
          </Field>
        </div>

        {!winRow ? (
          <Note tone="warn">Choose a period to see its windows.</Note>
        ) : (
          <>
            {WINDOWS.map(w => (
              <div className="grid g3" key={w.from}>
                <Field label={w.label} hint={w.hint}>
                  <input type="date" value={winVals[w.from] ?? ''}
                         onChange={e => setWinVals(v => ({ ...v, [w.from]: e.target.value }))} />
                </Field>
                <Field label="until">
                  <input type="date" value={winVals[w.to] ?? ''}
                         onChange={e => setWinVals(v => ({ ...v, [w.to]: e.target.value }))} />
                </Field>
              </div>
            ))}
            <Note tone="warn">
              Left blank, a window counts as not configured rather than closed, and the
              screens say so. A window that ends before it starts is refused.
            </Note>
            <SaveRow busy={win.busy} error={win.error} saved={win.saved} label="Save these windows"
                     disabled={!winId}
                     onSave={() => win.run(
                       () => pmsAdmin('period_update', {
                         period_id: winId,
                         // Blank means "clear it", which the route takes as NULL;
                         // sending '' would be a date Postgres cannot parse.
                         ...Object.fromEntries(Object.entries(winVals)
                           .map(([k, v]) => [k, v === '' ? null : v])),
                       }),
                       'Windows saved.')} />
          </>
        )}
      </Card>
    </>
  )
}

// ══ 5. FINALISE ═══════════════════════════════════════════════════════════
function FinalisePanel({ periods, canAttribute, reload }: {
  periods: Row[]; canAttribute: boolean; reload: () => Promise<void>
}) {
  const { busy, error, saved, run } = useSaver(reload)
  const [employeeId, setEmployeeId] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [role, setRole] = useState('HR')
  const [rating, setRating] = useState('')
  const [reason, setReason] = useState('')

  return (
    <Card title="Finalise a rating"
          sub="Sets the final rating for one employee in one period. This is what the employee is told.">
      {!canAttribute && (
        <Note tone="warn">
          This session is the shared dashboard login, which is not attached to an employee
          record. Finalising is recorded against a named person, so sign in with your own
          ESS account to do it.
        </Note>
      )}
      <div className="grid g4">
        <Field label="Employee id"><input value={employeeId} onChange={e => setEmployeeId(e.target.value)} placeholder="uuid" /></Field>
        <Field label="Period">
          <select value={periodId} onChange={e => setPeriodId(e.target.value)}>
            <option value="">Choose…</option>
            {periods.map(p => <option key={s(p.id)} value={s(p.id)}>{s(p.period_name)}</option>)}
          </select>
        </Field>
        <Field label="Finalising as">
          <select value={role} onChange={e => setRole(e.target.value)}>
            {['HR', 'HOD', 'RM_L1', 'RM_L2', 'MD'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Rating"><input type="number" step="0.01" value={rating} onChange={e => setRating(e.target.value)} /></Field>
      </div>
      <Field label="Reason" hint="Recorded with the rating"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <SaveRow busy={busy} error={error} saved={saved} label="Finalise"
               disabled={!canAttribute || !employeeId.trim() || !periodId || rating.trim() === ''}
               onSave={() => run(() => pmsAdmin<{ message: string }>('finalise', {
                 employee_id: employeeId.trim(), period_id: periodId,
                 actor_role: role, rating: Number(rating), reason: reason.trim() || null,
               }), 'Rating finalised.')} />
    </Card>
  )
}

// ══ the tab itself ════════════════════════════════════════════════════════
// How each section is presented in the settings rail — icon, group and one
// line on what it controls. Presentation only: which section is open is still
// the `section` state below, set by the same setSection call.
type SectionKey = 'policy' | 'kra' | 'chains' | 'scale' | 'courses' | 'authority' | 'cycle' | 'finalise'
const SECTION_META: Record<SectionKey, { icon: (p: IconProps) => React.ReactNode; group: string; blurb: string }> = {
  policy:    { icon: IconPolicies, group: 'Rules',      blurb: 'Frequency, KRA limits, one-to-ones and who finalises' },
  chains:    { icon: IconOrgChart, group: 'Rules',      blurb: 'Who reviews a set, in which order' },
  scale:     { icon: IconSliders,  group: 'Rules',      blurb: 'Rating bands, labels and what each one asks for' },
  authority: { icon: IconCompliance, group: 'Rules',      blurb: 'What the HR Head may settle, override or do directly' },
  kra:       { icon: IconTemplates, group: 'Libraries', blurb: 'Ready-made KRAs employees and managers can pick' },
  courses:   { icon: IconLetters,  group: 'Libraries',  blurb: 'Courses a rater can recommend' },
  cycle:     { icon: IconCalendar, group: 'Operations', blurb: 'Open, extend or close a period' },
  finalise:  { icon: IconLock,     group: 'Operations', blurb: 'Record a final rating by hand, with a reason' },
}
const SECTION_GROUPS = ['Rules', 'Libraries', 'Operations']

export default function AdminEditor() {
  const [snap, setSnap] = useState<PmsAdminSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [section, setSection] = useState<'policy' | 'kra' | 'chains' | 'scale' | 'courses' | 'authority' | 'cycle' | 'finalise'>('policy')

  const reload = useCallback(async () => {
    const r = await loadPmsAdmin()
    if (r.error) { setErr(r.error.message); return }
    setErr(null); setSnap(r.data)
  }, [])

  useEffect(() => { reload() }, [reload])

  // New rows need a company. Taken from the data already on screen rather than
  // asked for — every period and policy carries one.
  const companyId = useMemo(() => {
    const from = (rows: Row[] | undefined) => rows?.map(r => s(r.company_id)).find(Boolean) ?? null
    return from(snap?.policies) ?? from(snap?.periods) ?? from(snap?.kras) ?? null
  }, [snap])

  if (err) return <div className="card"><Note tone="bad">{err}</Note></div>
  if (!snap) return <div className="pms-skel" aria-busy="true" aria-label="Loading"><i /><i /><i /></div>

  const TABS = [
    ['policy',   'Policy rules'],
    ['kra',      'KRA library'],
    ['chains',   'Approval chains'],
    ['scale',    'Rating scale'],
    ['courses',  'Training catalogue'],
    ['authority','HR Head authority'],
    ['cycle',    'Cycle control'],
    ['finalise', 'Finalise'],
  ] as const

  // The number beside each section in the rail — how many rows it holds, from
  // the snapshot already loaded. Nothing is fetched for it.
  const countOf: Partial<Record<SectionKey, number>> = {
    policy: snap.policies.length, kra: snap.kras.length, chains: (snap.chains ?? []).length,
    scale: snap.scale.length, courses: (snap.catalogue ?? []).length, cycle: snap.periods.length,
  }

  return (
    <div className="pms-settings">
      {/* A settings layout: the eight sections down the left, grouped by what
          they control; the open one on the right under its own header. Each
          item is still one button calling setSection, as the strip was. */}
      <nav className="pms-settings-rail" aria-label="Setup sections">
        {SECTION_GROUPS.map(g => (
          <div key={g} className="pms-settings-group">
            <div className="pms-settings-glabel">{g}</div>
            {TABS.filter(([k]) => SECTION_META[k].group === g).map(([k, label]) => {
              const Ico = SECTION_META[k].icon
              const n = countOf[k]
              return (
                <button key={k} type="button" className={section === k ? 'on' : ''}
                        aria-current={section === k ? 'page' : undefined}
                        onClick={() => setSection(k)}>
                  <span className="pms-settings-ico" aria-hidden="true"><Ico size={16} /></span>
                  <span className="pms-settings-txt">
                    <span className="pms-settings-name">{label}</span>
                    <span className="pms-settings-blurb">{SECTION_META[k].blurb}</span>
                  </span>
                  {n != null && <span className="pms-settings-n">{n}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="pms-settings-body">
      {section === 'policy'   && <PolicyPanel policies={snap.policies} companies={snap.companies}
                                              people={snap.people ?? []}
                                              chains={snap.chains ?? []} reload={reload} />}
      {section === 'kra'      && <KraPanel kras={snap.kras} companyId={companyId} reload={reload} />}
      {section === 'chains'   && <ChainPanel chains={snap.chains ?? []} policies={snap.policies}
                                             coverage={snap.coverage ?? null}
                                             companyId={companyId} reload={reload} />}
      {section === 'scale'    && <ScalePanel scale={snap.scale} companyId={companyId} reload={reload} />}
      {section === 'courses'  && <CataloguePanel catalogue={snap.catalogue ?? []}
                                                 companyId={companyId} reload={reload} />}
      {section === 'authority' && <AuthorityPanel policies={snap.policies}
                                                  companies={snap.companies} reload={reload} />}
      {section === 'cycle'    && <CyclePanel policies={snap.policies} periods={snap.periods} companies={snap.companies} reload={reload} />}
      {section === 'finalise' && <FinalisePanel periods={snap.periods} canAttribute={!!snap.actor.employeeId} reload={reload} />}
      </div>
    </div>
  )
}
