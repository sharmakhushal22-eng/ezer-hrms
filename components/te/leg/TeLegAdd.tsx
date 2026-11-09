'use client'
// components/te/leg/TeLegAdd.tsx — a journey that was not planned. Screen 63.
//
// THIS IS THE GPS SUB-TRIP. Land in Mumbai, hop to the client office, then to a
// second one, then to the airport: each is a journey added during the trip,
// tracked and paid like any other rather than becoming a loose bill with no
// journey behind it. It covers the other unplanned cases too — a cab back
// because the train was cancelled, a detour to a site nobody costed.
//
// WHAT WAS AWKWARD ABOUT IT, fixed here:
//
//   the start was blank    You are almost always setting off from where the
//                          last journey ended. That is now filled in, and still
//                          one tap to change.
//   the reason read as an  "Why it was not planned" invites an excuse. The
//   apology               approver wants to know where you are going and what
//                          for, which is a different sentence.
//   adding was not doing   It added the journey and told you to go and find it
//                          to press start. If you are about to get in the auto,
//                          "Add and start now" does both.
//
// The reason is still required and still goes to the approver: a journey that
// was not in the plan is a change to something they approved.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeTripDetail, Uuid } from '@/lib/te/types'
import { errorText } from '@/lib/te/format'
import { deviceGeo, oneShotFix } from '@/lib/te/geo'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePlacePicker, { type PickTarget } from '../plan/TePlacePicker'

export default function TeLegAdd({ snap, detail, onClose, onAdded, onPlaceAdded }: {
  snap: Snapshot
  detail: TeTripDetail
  onClose: () => void
  /** `started` = recording has begun, so the host should open the journey
   *  rather than returning to the trip. */
  onAdded: (legId: Uuid, message: string, opts?: { started?: boolean }) => void
  /** A place was created inside the picker, so the snapshot this screen is
   *  holding does not know it yet and would name the point "—". The host
   *  refetches WITHOUT closing: the half-filled form lives in here. */
  onPlaceAdded?: () => void
}) {
  const trip = detail.trip
  // WHERE THE LAST JOURNEY LEFT YOU. A sub-trip almost always starts where the
  // previous one ended — you are standing there. Falls back to the last place
  // on the route, then to nothing, and is one tap to change either way.
  const startedAt = (() => {
    const done = (detail.legs ?? []).filter(l => l.status === 'SUBMITTED' || l.status === 'ENDED')
    const last = done[done.length - 1]
    if (last?.to) return last.to
    const pts = trip.points ?? []
    return pts[pts.length - 1]?.place ?? ''
  })()
  const [from, setFrom] = useState<string>(startedAt)
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
  // ALREADY RECORDING SOMETHING. The database allows one running journey per
  // person (uq_te_leg_running), so te_leg_start would refuse this with "End the
  // journey that is running first." Saying so before the tap is the difference
  // between a form that explains itself and one that 409s.
  const running = snap.journeys.find(j => j.emp === snap.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null

  /**
   * Add it, and when `start` is set, begin recording in the same action.
   *
   * THE JOURNEY IS ADDED FIRST AND KEPT. If the GPS then fails — location off,
   * a basement, a refused prompt — the journey still exists and the traveller
   * is told to start it from the trip. Rolling it back would throw away the
   * part that worked and make them type it all again.
   */
  async function add(start: boolean) {
    setBusy(true); setError('')
    let legId = ''
    let legNo = 0
    try {
      const r = await te.legAdd(trip.id, { from, to, mode, vehicleId: vehicleId || null, why: why.trim() })
      legId = r.leg_id; legNo = r.leg_no
    } catch (e) {
      setError(errorText(e)); setBusy(false); return
    }
    if (!start) { onAdded(legId, `Journey ${legNo} added. Start it when you set off.`); return }
    try {
      await te.legStart(legId, await oneShotFix(deviceGeo()))
      onAdded(legId, `Journey ${legNo} is recording.`, { started: true })
    } catch (e) {
      // Added, not started: say exactly that rather than reporting a failure
      // that would suggest nothing happened.
      onAdded(legId, `Journey ${legNo} was added, but recording could not start: ${errorText(e)}`)
    }
  }

  if (picking) {
    const side = picking
    return (
      <TePlacePicker
        snap={snap}
        target={{ kind: 'point', index: 0, title: side === 'from' ? 'Where the journey starts' : 'Where the journey goes' } as PickTarget}
        onCancel={() => setPicking(null)}
        onPlaceAdded={onPlaceAdded}
        onChosen={id => { setPicking(null); if (side === 'from') setFrom(id); else setTo(id); setError('') }}
      />
    )
  }

  return (
    <TeSheet
      wide
      title="Add a journey"
      lead="A local hop at the destination, a detour, a ride back — anything on this trip that was not in the plan. It is recorded and paid like any other journey."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {/* ADDING FOR LATER IS THE SECOND BUTTON, not the first: somebody
              filling this in is usually about to get into the auto. It becomes
              the only button when another journey is already recording, because
              then starting this one cannot succeed. */}
          <button type="button" className={running ? 'btn pri' : 'btn'} disabled={!ready || busy} onClick={() => add(false)}>
            {busy && running ? 'Adding…' : 'Add for later'}
          </button>
          {!running ? (
            <button type="button" className="btn pri" disabled={!ready || busy} onClick={() => add(true)}>
              {busy ? 'Starting…' : 'Add and start now'}
            </button>
          ) : null}
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
          <div className="ferr"><TeIcon name="alert" size="sm" />A journey has to go from one place to a different one.</div>
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
        <h4>Why you are going</h4>
        <label className="fld full">
          <span>Reason for this journey</span>
          <input
            value={why}
            placeholder="Second client meeting at their Bandra office"
            onChange={e => { setWhy(e.target.value); setError('') }}
          />
          <small>
            Your approver and the travel desk read this. It was not in the plan they approved, so say what it is for.
          </small>
        </label>
      </div>

      {running ? (
        <div className="note">
          <TeIcon name="info" size="sm" />
          <span>
            Journey {running.n} is still recording, and only one can run at a time. Add this one now and start it once
            you have ended that one.
          </span>
        </div>
      ) : null}

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
    </TeSheet>
  )
}
