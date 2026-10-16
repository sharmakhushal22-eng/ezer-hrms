'use client'
// components/te/admin/TePolicy.tsx — what each grade may spend, by city group.
// Screens c4, c5.
//
// The limits table is the policy, in the most literal sense: every claim line
// is measured against the row for that employee's grade and the city they
// were in. Changing a number here changes what everyone of that grade is
// allowed from now on, so the screen is explicit about the blast radius and
// about which grade is being looked at — the commonest mistake on a screen
// like this is editing the wrong one.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeConfig, TeTierLimits } from '@/lib/te/types'
import { isDirty, whatChangingAffects } from '@/lib/te/admin-edit'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const TIERS: { id: string; name: string }[] = [
  { id: 'metro', name: 'Metro' },
  { id: 'tier1', name: 'Tier 1' },
  { id: 'rest', name: 'Rest of India' },
  { id: 'intlA', name: 'International, group A' },
  { id: 'intlB', name: 'International, group B' },
]
const FIELDS: { k: keyof TeTierLimits; label: string }[] = [
  { k: 'hotel', label: 'Hotel a night' },
  { k: 'meals', label: 'Food a day' },
  { k: 'conv', label: 'Local a day' },
]

/* The parent remounts this on a fresh config (key={configKey}), so the local
 * draft starts from the new truth without an effect syncing it. */
export default function TePolicy({ cfg, onSaved, onToast }: {
  cfg: TeConfig
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const grades = cfg.grades ?? Object.keys(cfg.limits ?? {})
  const [grade, setGrade] = useState(grades[0] ?? '')
  const [limits, setLimits] = useState<Record<string, Record<string, TeTierLimits>>>(cfg.limits ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = useMemo(() => isDirty(cfg.limits, limits), [cfg.limits, limits])
  const forGrade = limits[grade] ?? {}

  const set = (tier: string, field: keyof TeTierLimits, value: number) =>
    setLimits(l => ({
      ...l,
      [grade]: { ...(l[grade] ?? {}), [tier]: { ...(l[grade]?.[tier] ?? { hotel: 0, meals: 0, conv: 0 }), [field]: value } },
    }))

  async function save() {
    setBusy(true); setError('')
    try {
      // One row per grade and tier, which is how te_grade_limits is shaped.
      const rows = Object.entries(limits).flatMap(([g, tiers]) =>
        Object.entries(tiers).map(([tier, v]) => ({ grade_code: g, tier_code: tier, hotel_cap: v.hotel, meal_cap: v.meals, local_cap: v.conv })),
      )
      const r = await te.admin.mastersSave('te_grade_limits', rows)
      onToast(`${r.updated + r.inserted} limit${r.updated + r.inserted === 1 ? '' : 's'} saved.`)
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Policy limits</h1>
          <p>What each grade may spend, by city group. Every claim line is measured against the row for the employee&rsquo;s grade and where they were.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {/* Which grade is being edited, large and unmissable: editing the wrong
          one is the easiest mistake to make here and the hardest to notice. */}
      <div className="card">
        <div className="ch"><h3>Grade</h3>{dirty ? <span className="chip t-warn">Unsaved changes</span> : null}</div>
        <div className="seg scopes" role="group" aria-label="Grade">
          {grades.map(g => (
            <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)}>{g}</button>
          ))}
        </div>
      </div>

      <div className="card pad0">
        <div className="tw">
          <table className="tbl">
            <thead>
              <tr><th>City group</th>{FIELDS.map(f => <th key={f.k} className="r">{f.label}</th>)}</tr>
            </thead>
            <tbody>
              {TIERS.map(t => {
                const row = forGrade[t.id]
                return (
                  <tr key={t.id}>
                    <td className="b">{t.name}</td>
                    {FIELDS.map(f => (
                      <td key={f.k} className="r">
                        <input
                          type="number" min={0} step={100}
                          value={row?.[f.k] ?? 0}
                          onChange={e => set(t.id, f.k, Number(e.target.value))}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ch"><h3>Travel class</h3><span className="muted small">grade {grade}</span></div>
        <dl className="kv">
          <dt>Air</dt><dd>{cfg.airClass?.[grade] ?? '—'}</dd>
          <dt>Train</dt><dd>{cfg.trainClass?.[grade] ?? '—'}</dd>
          <dt>Advance</dt><dd>up to {cfg.advanceMaxPct}% of what they pay themselves</dd>
        </dl>
        <p className="small muted">Travel class and the advance cap are company-wide settings, changed on the Rules screen.</p>
      </div>

      {dirty ? (
        <div className="card">
          <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('limits')}</span></div>
          <div className="row tight">
            <button type="button" className="btn" onClick={() => setLimits(cfg.limits ?? {})}>Undo the changes</button>
            <button type="button" className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save the limits'}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
