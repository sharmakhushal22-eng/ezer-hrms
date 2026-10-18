'use client'
// components/te/admin/TeModesVehicles.tsx — how people travel, and what it
// pays. Screen c2.
//
// Two tables that between them decide a large share of what the company
// spends: which ways of travelling are offered at all, and the rate a
// kilometre for each kind of own vehicle.
//
// A rate here is not a label — it is multiplied by every kilometre anybody
// drives from now on. So the screen says what a change affects before it is
// saved, and the save sends only the rows that actually moved.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeConfig, TeMode, TeVehicleType, TripScope } from '@/lib/te/types'
import { changedRows, isDirty, whatChangingAffects } from '@/lib/te/admin-edit'
import { ratePerKm } from '@/lib/te/vehicle'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const SCOPES: TripScope[] = ['local', 'domestic', 'international']
const BASIS: { id: TeMode['basis']; label: string }[] = [
  { id: 'km', label: 'Per km' },
  { id: 'bill', label: 'On the bill' },
  { id: 'nobill', label: 'Fare, no bill' },
  { id: 'ticket', label: 'On the ticket' },
  { id: 'none', label: 'Not paid' },
]

/* The parent remounts this on a fresh config (key={configKey}), so the local
 * draft starts from the new truth without an effect syncing it. */
export default function TeModesVehicles({ cfg, onSaved, onToast }: {
  cfg: TeConfig
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const [modes, setModes] = useState<TeMode[]>(cfg.modes)
  const [vehicles, setVehicles] = useState<TeVehicleType[]>(cfg.vehicles)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const modesDirty = useMemo(() => isDirty(cfg.modes, modes), [cfg.modes, modes])
  const vehDirty = useMemo(() => isDirty(cfg.vehicles, vehicles), [cfg.vehicles, vehicles])

  const setMode = (id: string, patch: Partial<TeMode>) =>
    setModes(ms => ms.map(m => (m.id === id ? { ...m, ...patch } : m)))
  const setVeh = (id: string, patch: Partial<TeVehicleType>) =>
    setVehicles(vs => vs.map(v => (v.id === id ? { ...v, ...patch } : v)))

  async function save(table: 'te_modes' | 'te_vehicle_types', rows: Record<string, unknown>[]) {
    setBusy(table); setError('')
    try {
      const r = await te.admin.mastersSave(table, rows)
      onToast(`${r.updated + r.inserted} row${r.updated + r.inserted === 1 ? '' : 's'} saved.`)
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Modes and rates</h1>
          <p>Which ways of travelling people may choose, and what an own vehicle is paid a kilometre.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card">
        <div className="ch"><h3>Ways of travelling</h3><span className="muted small">{modes.filter(m => m.on).length} of {modes.length} offered</span></div>
        <div className="tw">
          <table className="tbl sm">
            <thead>
              <tr><th>Mode</th><th>Paid</th><th>Offered on</th><th className="r">Offered</th></tr>
            </thead>
            <tbody>
              {modes.map(m => (
                <tr key={m.id}>
                  <td className="b">{m.name}</td>
                  <td>
                    <select value={m.basis} onChange={e => setMode(m.id, { basis: e.target.value as TeMode['basis'] })}>
                      {BASIS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="row tight">
                      {SCOPES.map(s => (
                        <button
                          key={s}
                          type="button"
                          className="chip plain"
                          aria-pressed={m.scopes.includes(s)}
                          onClick={() => setMode(m.id, { scopes: m.scopes.includes(s) ? m.scopes.filter(x => x !== s) : [...m.scopes, s] })}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="r">
                    <label className="check small">
                      <input type="checkbox" checked={m.on} onChange={e => setMode(m.id, { on: e.target.checked })} />
                      <span>{m.on ? 'Yes' : 'No'}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {modesDirty ? (
          <>
            <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('rates')}</span></div>
            <button type="button" className="btn pri" disabled={busy === 'te_modes'} onClick={() => save('te_modes', changedRows(cfg.modes, modes) as unknown as Record<string, unknown>[])}>
              {busy === 'te_modes' ? 'Saving…' : `Save ${changedRows(cfg.modes, modes).length} change${changedRows(cfg.modes, modes).length === 1 ? '' : 's'}`}
            </button>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="ch"><h3>Own vehicle rates</h3><span className="muted small">paid on the recorded distance</span></div>
        <div className="tw">
          <table className="tbl sm">
            <thead>
              <tr><th>Kind</th><th>How</th><th className="r">Rate or fuel</th><th className="r">Wear</th><th className="r">Pays</th><th className="r">Offered</th></tr>
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.id}>
                  <td className="b">{v.name}{v.eg ? <div className="small muted">{v.eg}</div> : null}</td>
                  <td>
                    <select value={v.method} onChange={e => setVeh(v.id, { method: e.target.value as 'fixed' | 'fuel' })}>
                      <option value="fixed">A flat rate</option>
                      <option value="fuel">From the fuel price</option>
                    </select>
                  </td>
                  <td className="r">
                    {v.method === 'fixed' ? (
                      <input type="number" min={0} step={0.5} value={v.rate} onChange={e => setVeh(v.id, { rate: Number(e.target.value) })} />
                    ) : (
                      <span className="small muted">{v.fuel} · {v.kmpl} km/l</span>
                    )}
                  </td>
                  <td className="r">
                    <input type="number" min={0} step={0.5} value={v.wear} onChange={e => setVeh(v.id, { wear: Number(e.target.value) })} />
                  </td>
                  {/* What the row actually pays, worked out the same way the
                      claim will work it out. */}
                  <td className="r"><b>{rs(ratePerKm(v, cfg.fuelPrice))}</b><div className="small muted">a km</div></td>
                  <td className="r">
                    <label className="check small">
                      <input type="checkbox" checked={v.on} onChange={e => setVeh(v.id, { on: e.target.checked })} />
                      <span>{v.on ? 'Yes' : 'No'}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {vehDirty ? (
          <>
            <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('rates')}</span></div>
            <button type="button" className="btn pri" disabled={busy === 'te_vehicle_types'} onClick={() => save('te_vehicle_types', changedRows(cfg.vehicles, vehicles) as unknown as Record<string, unknown>[])}>
              {busy === 'te_vehicle_types' ? 'Saving…' : `Save ${changedRows(cfg.vehicles, vehicles).length} change${changedRows(cfg.vehicles, vehicles).length === 1 ? '' : 's'}`}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
