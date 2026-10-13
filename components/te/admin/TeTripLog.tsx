'use client'
// components/te/admin/TeTripLog.tsx — every trip, and the GPS behind any leg.
// Screens c0, c1.
//
// The log an auditor opens when somebody asks "did this journey happen".
// A list of trips across everybody, and one tap to the recorded evidence for
// any leg of any of them.
//
// The route this reads (GET /api/te/admin/trips) did not exist before this
// step; the handover listed it as needed and said what to read. The per-leg
// evidence it opens reuses the approver's screen, because an auditor and an
// approver are asking the same question of the same data.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { te, type AdminTripRow } from '@/lib/te/client'
import type { TeLeg, TePlaceBrief, Uuid } from '@/lib/te/types'
import { day, errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeLegEvidence from '../approve/TeLegEvidence'

const PAGE = 50
const SCOPES = ['local', 'domestic', 'international']

export default function TeTripLog() {
  const [rows, setRows] = useState<AdminTripRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [scope, setScope] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  // The trip whose legs are open, and the leg whose evidence is open.
  const [openTrip, setOpenTrip] = useState<{ legs: TeLeg[]; places: Record<string, TePlaceBrief>; name: string } | null>(null)
  const [openLeg, setOpenLeg] = useState<Uuid | null>(null)
  const [loadingTrip, setLoadingTrip] = useState('')

  const filters = useMemo(() => ({
    limit: PAGE, offset,
    ...(scope ? { scope } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
  }), [offset, scope, from, to])

  const load = useCallback(() => {
    let current = true
    te.admin.trips(filters)
      .then(p => { if (current) { setRows(p.rows ?? []); setTotal(p.total ?? 0); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [filters])

  useEffect(load, [load])

  async function openLegs(t: AdminTripRow) {
    setLoadingTrip(t.id); setError('')
    try {
      const d = await te.trip(t.id)
      setOpenTrip({ legs: [...d.legs].sort((a, b) => a.n - b.n), places: d.places, name: d.trip.name })
    } catch (e) { setError(errorText(e)) } finally { setLoadingTrip('') }
  }

  if (openTrip && openLeg) {
    const leg = openTrip.legs.find(l => l.id === openLeg)
    if (leg) return <TeLegEvidence leg={leg} places={openTrip.places} onBack={() => setOpenLeg(null)} />
  }

  if (openTrip) {
    return (
      <div className="page">
        <div className="row">
          <button type="button" className="btn sm" onClick={() => setOpenTrip(null)}><TeIcon name="back" size="sm" />Trip log</button>
        </div>
        <div className="ph"><div><h1>{openTrip.name}</h1><p>Every leg, and what the phone recorded for it.</p></div></div>
        <div className="card pad0">
          <div className="day"><span>Legs</span><span>{openTrip.legs.length}</span></div>
          {openTrip.legs.map(l => (
            <button key={l.id} type="button" className="li click" onClick={() => setOpenLeg(l.id)}>
              <span className="ln">{l.n}</span>
              <div className="grow">
                <div className="b">{openTrip.places[l.from]?.s ?? '—'} → {openTrip.places[l.to]?.s ?? '—'}</div>
                <div className="small muted">
                  {l.mode} · {l.status.toLowerCase()}
                  {l.manual ? ' · added without GPS' : l.stats ? ` · ${Math.round((l.stats.gpsKm ?? 0) * 10) / 10} km recorded` : ' · nothing recorded'}
                  {l.stats?.gaps ? ` · ${l.stats.gaps} gap${l.stats.gaps === 1 ? '' : 's'}` : ''}
                  {l.stats?.jumps ? ` · ${l.stats.jumps} jump${l.stats.jumps === 1 ? '' : 's'}` : ''}
                </div>
              </div>
              <span className="nr-go">Evidence<TeIcon name="go" size="sm" /></span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const list = rows ?? []

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Trip log</h1>
          <p>Every trip in the company, and the GPS behind any leg of it.</p>
        </div>
      </div>

      <div className="card">
        <div className="form">
          <label className="fld sm"><span>Kind</span>
            <select value={scope} onChange={e => { setScope(e.target.value); setOffset(0) }}>
              <option value="">Any</option>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="fld sm"><span>Started from</span><input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0) }} /></label>
          <label className="fld sm"><span>To</span><input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0) }} /></label>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Trips</span><span>{total}</span></div>
        {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
        {rows !== null && !list.length ? <div className="empty"><b>No trips match</b>Try a wider range.</div> : null}
        {list.map(t => (
          <button key={t.id} type="button" className="li click" disabled={loadingTrip === t.id} onClick={() => openLegs(t)}>
            <span className={`ico sc-${t.scope}`}><TeIcon name={t.scope} /></span>
            <div className="grow">
              <div className="b"><span className="mono">{t.trip_no}</span> · {t.name}</div>
              <div className="small muted">
                {t.employee_name} <span className="mono">{t.emp_code}</span>
                {t.start_date ? ` · ${day(t.start_date)}` : ''}
                {` · ${t.leg_count} leg${t.leg_count === 1 ? '' : 's'}`}
                {t.open_leg_count ? ` · ${t.open_leg_count} still open` : ''}
                {t.origin === 'POST_FACTO' ? ' · recorded after travel' : ''}
              </div>
            </div>
            <div className="amt">
              <b>{rs(t.estimate_total ?? 0)}</b>
              <div><span className="chip plain">{t.display_status.replace(/_/g, ' ').toLowerCase()}</span></div>
            </div>
          </button>
        ))}
      </div>

      {total > PAGE ? (
        <div className="row tight">
          <button type="button" className="btn sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>Newer</button>
          <span className="small muted grow">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <button type="button" className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(o => o + PAGE)}>Older</button>
        </div>
      ) : null}
    </div>
  )
}
