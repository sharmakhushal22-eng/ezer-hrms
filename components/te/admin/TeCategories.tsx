'use client'
// components/te/admin/TeCategories.tsx — what a bill can be, and what proof
// it needs. Screen d2.
//
// Two settings per category and both have consequences the names do not
// carry. "Needs a trip" decides whether the category can be claimed on a
// loose monthly bill at all — hotel and food should not be. "Proof" decides
// whether a bill is demanded always, only above the company's threshold, or
// never; setting it to never on something expensive is how unreceipted
// spending starts.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeCategory, TeConfig } from '@/lib/te/types'
import { changedRows, isDirty, whatChangingAffects } from '@/lib/te/admin-edit'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const PROOF: { id: TeCategory['proof']; label: string }[] = [
  { id: 'always', label: 'Always' },
  { id: 'above', label: 'Above the threshold' },
  { id: 'none', label: 'Never' },
]

/* The parent remounts this on a fresh config (key={configKey}), so the local
 * draft starts from the new truth without an effect syncing it. */
export default function TeCategories({ cfg, onSaved, onToast }: {
  cfg: TeConfig
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const [cats, setCats] = useState<TeCategory[]>(cfg.cats ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = useMemo(() => isDirty(cfg.cats, cats), [cfg.cats, cats])
  const set = (id: string, patch: Partial<TeCategory>) =>
    setCats(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)))

  async function save() {
    setBusy(true); setError('')
    try {
      const rows = changedRows(cfg.cats ?? [], cats)
      const r = await te.admin.mastersSave('te_categories', rows as unknown as Record<string, unknown>[])
      onToast(`${r.updated + r.inserted} categor${r.updated + r.inserted === 1 ? 'y' : 'ies'} saved.`)
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
          <h1>Categories and proof</h1>
          <p>What a bill can be, whether it belongs to a trip, and when a receipt is required.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Categories</span><span>{cats.filter(c => c.on).length} of {cats.length} offered</span></div>
        {cats.map(c => (
          <div key={c.id} className="li">
            <span className="ico"><TeIcon name="other" /></span>
            <div className="grow">
              <div className="b">{c.name} <span className="small muted mono">{c.id}</span></div>
              <div className="row tight">
                <label className="check small">
                  <input type="checkbox" checked={c.needsTrip} onChange={e => set(c.id, { needsTrip: e.target.checked })} />
                  <span>Only on a trip</span>
                </label>
                {PROOF.map(p => (
                  <button key={p.id} type="button" className="chip plain" aria-pressed={c.proof === p.id} onClick={() => set(c.id, { proof: p.id })}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="small muted">
                {c.proof === 'always' ? 'A bill is always needed.'
                  : c.proof === 'above' ? `A bill is needed above ${rs(cfg.receiptAbove)}.`
                    : 'No bill is ever asked for.'}
                {c.needsTrip ? ' Cannot be claimed without a trip.' : ''}
              </div>
            </div>
            <label className="check small">
              <input type="checkbox" checked={c.on} onChange={e => set(c.id, { on: e.target.checked })} />
              <span>{c.on ? 'On' : 'Off'}</span>
            </label>
          </div>
        ))}
      </div>

      {dirty ? (
        <div className="card">
          <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('categories')}</span></div>
          <div className="row tight">
            <button type="button" className="btn" onClick={() => setCats(cfg.cats ?? [])}>Undo the changes</button>
            <button type="button" className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save the categories'}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
