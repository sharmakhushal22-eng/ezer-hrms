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

type Row = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined) ? '' : String(v)
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const
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

  return { busy, error, saved, run, setError }
}

// ══ 1. POLICIES ═══════════════════════════════════════════════════════════
function PolicyPanel({ policies, reload }: { policies: Row[]; reload: () => Promise<void> }) {
  const [id, setId] = useState<string>('')
  const [draft, setDraft] = useState<Row>({})
  const { busy, error, saved, run } = useSaver(reload)

  const current = useMemo(() => policies.find(p => s(p.id) === id), [policies, id])

  useEffect(() => {
    if (!id && policies.length) setId(s(policies[0].id))
  }, [policies, id])
  useEffect(() => { setDraft(current ? { ...current } : {}) }, [current])

  if (!policies.length) {
    return <Card title="Policies" sub="Nothing to edit yet.">
      <Note tone="warn">No policy exists. A policy is what decides frequency, KRA counts and the approval chain — every period is generated from one.</Note>
    </Card>
  }

  const set = (k: string, v: unknown) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <Card title="Policy rules"
          sub="The frequency here is the real one. Changing it decides how many periods a year has, and what the Cycle tab will generate.">
      <div className="grid g3">
        <Field label="Policy">
          <select value={id} onChange={e => setId(e.target.value)}>
            {policies.map(p => <option key={s(p.id)} value={s(p.id)}>{s(p.policy_name)}</option>)}
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
        <Field label="KRAs created by"><input value={s(draft.kra_created_by)} onChange={e => set('kra_created_by', e.target.value)} /></Field>
        <Field label="Approval chain"><input value={s(draft.approval_chain)} onChange={e => set('approval_chain', e.target.value)} /></Field>
        <Field label="Who may finalise"><input value={s(draft.who_can_finalise)} onChange={e => set('who_can_finalise', e.target.value)} /></Field>
      </div>

      <div className="grid g4">
        {([
          ['self_rating_mandatory',   'Self rating is mandatory'],
          ['one_to_one_mandatory',    'One-to-one is mandatory'],
          ['mid_period_checkin',      'Mid-period check-in'],
          ['final_review_one_to_one', 'Final review is a one-to-one'],
          ['include_notice_period',   'Include people on notice'],
          ['include_exited',          'Include people who have left'],
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
        Performance is not linked to pay. That is fixed in the database, not a setting — the column is constrained to stay off.
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
                <td className="k">{s(k.kpi_metric) || '—'}</td>
                <td>{s(k.category).toLowerCase()}</td>
                <td className="num">{k.suggested_weightage === null ? '—' : s(k.suggested_weightage)}</td>
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
function CyclePanel({ policies, periods, reload }: {
  policies: Row[]; periods: Row[]; reload: () => Promise<void>
}) {
  const gen = useSaver(reload)
  const open = useSaver(reload)

  const [policyId, setPolicyId] = useState('')
  const [fy, setFy] = useState('')
  const [fyStart, setFyStart] = useState('')

  const [periodId, setPeriodId] = useState('')
  const [typed, setTyped] = useState('')

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
                <option key={s(p.id)} value={s(p.id)}>{s(p.period_name)} — {s(p.status).toLowerCase()}</option>
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
export default function AdminEditor() {
  const [snap, setSnap] = useState<PmsAdminSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [section, setSection] = useState<'policy' | 'kra' | 'scale' | 'cycle' | 'finalise'>('policy')

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
  if (!snap) return <div className="card"><div className="k">Loading…</div></div>

  const TABS = [
    ['policy',   'Policy rules'],
    ['kra',      'KRA library'],
    ['scale',    'Rating scale'],
    ['cycle',    'Cycle control'],
    ['finalise', 'Finalise'],
  ] as const

  return (
    <>
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>{label}</button>
        ))}
      </div>

      {section === 'policy'   && <PolicyPanel policies={snap.policies} reload={reload} />}
      {section === 'kra'      && <KraPanel kras={snap.kras} companyId={companyId} reload={reload} />}
      {section === 'scale'    && <ScalePanel scale={snap.scale} companyId={companyId} reload={reload} />}
      {section === 'cycle'    && <CyclePanel policies={snap.policies} periods={snap.periods} reload={reload} />}
      {section === 'finalise' && <FinalisePanel periods={snap.periods} canAttribute={!!snap.actor.employeeId} reload={reload} />}
    </>
  )
}
