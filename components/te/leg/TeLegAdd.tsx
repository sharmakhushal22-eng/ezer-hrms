'use client'
// components/te/leg/TeLegAdd.tsx — a leg that was not planned. Screen 63.
//
// Trips do not go to plan. A detour to a second site, a cab back because the
// train was cancelled, a run to the airport that nobody costed. Adding the leg
// here keeps it inside the trip, where it is tracked and paid like any other,
// rather than becoming a loose bill with no journey attached.
//
// The reason is required and goes to the approver: an unplanned leg is a
// change to something they already approved.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeTripDetail, Uuid } from '@/lib/te/types'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePlacePicker, { type PickTarget } from '../plan/TePlacePicker'

export default function TeLegAdd({ snap, detail, onClose, onAdded }: {
  snap: Snapshot
  detail: TeTripDetail
  onClose: () => void
  onAdded: (legId: Uuid, message: string) => void
}) {
  const trip = detail.trip
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [mode, setMode] = useState<string>('')
  const [vehicleId, setVehicleId] = useState<string>('')
  const [why, setWhy] = useState('')
  const [picking, setPicking] = useState<'from' | 'to' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const modes = snap.cfg.modes.filter(m => m.on && m.scopes.includes(trip.scope))
  // Places already on this trip come first: a detour usually starts somewhere
  // the trip already knows about.
  const known = Object.entries(detail.places).map(([id, p]) => ({ id, s: p.s }))
  const name = (id: string) => detail.places[id]?.s ?? snap.masters.places.find(p => p.id === id)?.s ?? ''
  const ready = !!from && !!to && from !== to && !!mode && !!why.trim() && (mode !== 'own' || !!vehicleId)

  async function add() {
    setBusy(true); setError('')
    try {
      const r = await te.legAdd(trip.id, { from, to, mode, vehicleId: vehicleId || null, why: why.trim() })
      onAdded(r.leg_id, `Leg ${r.leg_no} added. Start it when you set off.`)
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  if (picking) {
    const side = picking
    return (
      <TePlacePicker
        snap={snap}
        target={{ kind: 'point', index: 0, title: side === 'from' ? 'Where the leg starts' : 'Where the leg goes' } as PickTarget}
        onCancel={() => setPicking(null)}
        onChosen={id => { setPicking(null); if (side === 'from') setFrom(id); else setTo(id); setError('') }}
      />
    )
  }

  return (
    <TeSheet
      wide
      title="Add a leg"
      lead="A journey on this trip that was not in the plan."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pri" disabled={!ready || busy} onClick={add}>
            {busy ? 'Adding…' : 'Add the leg'}
          </button>
        </>
      }
    >
      <div className="sec">
        <h4>Where</h4>
        <div className="stack sm">
          {(['from', 'to'] as const).map(side => {
            const chosen = side === 'from' ? from : to
            return (
              <div key={side} className="loc">
                <button type="button" className="locb" onClick={() => setPicking(side)}>
                  <span className={side === 'from' ? 'mk a' : 'mk b'}>{side === 'from' ? 'A' : 'B'}</span>
                  <span className="grow">
                    <small>{side === 'from' ? 'From' : 'To'}</small>
                    {chosen ? <b>{name(chosen)}</b> : <b className="ph0">Choose a place</b>}
                  </span>
                  <TeIcon name="rightc" size="sm" />
                </button>
                {/* The trip's own places, one tap away. */}
                {known.length ? (
                  <div className="vchips">
                    {known.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="vchip"
                        aria-pressed={chosen === p.id}
                        onClick={() => { if (side === 'from') setFrom(p.id); else setTo(p.id); setError('') }}
                      >
                        <TeIcon name="pin" size="sm" /><span><b>{p.s}</b></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        {from && to && from === to ? (
          <div className="ferr"><TeIcon name="alert" size="sm" />A leg has to go from one place to a different one.</div>
        ) : null}
      </div>

      <div className="sec">
        <h4>How</h4>
        <div className="rs-modes" role="group" aria-label="How you travel">
          {modes.map(m => (
            <button
              key={m.id}
              type="button"
              className="mchip"
              aria-pressed={mode === m.id}
              onClick={() => { setMode(m.id); setVehicleId(m.id === 'own' ? (vehicleId || snap.vehicles[0]?.id || '') : ''); setError('') }}
            >
              <TeIcon name={m.id === 'train' ? 'train' : m.id === 'public' || m.id === 'bus' ? 'bus' : m.id === 'flight' ? 'plane' : 'car'} size="sm" />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
        {mode === 'own' ? (
          <div className="vchips">
            {snap.vehicles.map(v => (
              <button key={v.id} type="button" className="vchip" aria-pressed={vehicleId === v.id} onClick={() => setVehicleId(v.id)}>
                <TeIcon name={v.type === 'bike' ? 'bike' : 'car'} size="sm" /><span><b className="mono">{v.reg}</b></span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="sec">
        <h4>Why it was not planned</h4>
        <label className="fld full">
          <span>Reason</span>
          <input
            value={why}
            placeholder="The train was cancelled, a second site was added"
            onChange={e => { setWhy(e.target.value); setError('') }}
          />
          <small>Your approver sees this: the trip they approved has changed.</small>
        </label>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
    </TeSheet>
  )
}
