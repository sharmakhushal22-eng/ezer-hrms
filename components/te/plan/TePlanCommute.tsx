'use client'
// components/te/plan/TePlanCommute.tsx — step 3: how you travel each leg.
//
// WHY THIS IS ITS OWN STEP NOW. It used to be interleaved with the route: a
// place, then a thin line asking how you get to the next place, then another
// place. One step asked for where you are going, when, by what, from which
// airport, and who books the ticket — and on a phone a six-leg international
// trip was a wall. Choosing the route and choosing how to travel it are two
// decisions, and they are easier made one after the other than together.
//
// WHAT CHANGES WITH THE KIND OF TRIP. The modes offered come from the
// company's own te_modes table, which carries a flag per scope —
// scope_local, scope_domestic, scope_international. A flight is not offered on
// a local trip because scope_local is false on that row, not because this file
// knows what a local trip is. An administrator who decides rental cars are
// fine locally changes a checkbox and this screen follows.
//
// ONE LINE OPEN AT A TIME, the same as the route step, and for the same
// reason: it is what keeps a long trip readable on a phone.
import { useState } from 'react'
import type { Snapshot, TripIssue } from '@/lib/te/types'
import { applyModeToAll, blockingOn, journeysUnlike, type PlannerDraft } from '@/lib/te/trip-draft'
import { plural } from '@/lib/te/format'
import { vehicleSubtitle } from '@/lib/te/vehicle'
import TeIcon from '../TeIcon'
import TeVehicleAdd from '../vehicle/TeVehicleAdd'
import type { PickTarget } from './TePlacePicker'

const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}
const PAY_WORDS: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}
const KIND_WORD: Record<string, string> = {
  local: 'this city', domestic: 'travel inside India', international: 'international travel',
}

export default function TePlanCommute({ snap, draft, issues, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  onPick: (t: PickTarget) => void
  onVehicleAdded: (message: string) => void
}) {
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const legs = draft.segs.length
  const offered = snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope))
  const open = (i: number) => draft.open === `s${i}`
  const toggle = (i: number) => edit({ open: open(i) ? null : `s${i}` })
  const left = blockingOn(issues, 3).length
  /** The journey whose row is open, so the offer below can name its mode. */
  const openAt = draft.segs.findIndex((_, i) => open(i))
  const openSeg = openAt >= 0 ? draft.segs[openAt] : null
  const openMode = openSeg ? snap.cfg.modes.find(m => m.id === openSeg.mode) ?? null : null
  const others = openSeg ? journeysUnlike(draft, openSeg.mode) : 0
  const done = draft.segs.filter(sg => sg.mode).length

  return (
    <div className="sec">
      <h4>How you travel</h4>
      <p className="small muted">
        {legs === 1
          ? 'One journey to choose for.'
          : `${plural(legs, 'journey')} — choose how you travel each one.`}
        {' '}Only what is allowed for {KIND_WORD[draft.scope] ?? 'this trip'} is offered.
      </p>

      {legs > 1 ? (
        <div className="fsteps" aria-label={`${done} of ${legs} journeys chosen`}>
          {draft.segs.map((sg, i) => (
            <span key={i} className={`fs ${open(i) ? 'on' : sg.mode ? 'done' : ''}`}>
              <span className="fn">{sg.mode ? <TeIcon name="check" size="sm" /> : i + 1}</span>
            </span>
          ))}
          <span className="small muted">{done} of {legs} chosen</span>
        </div>
      ) : null}

      {!legs ? (
        <div className="empty">
          <b>No journeys yet</b>
          Go back to the route and choose where you are going. How you travel is asked for each journey between two places.
        </div>
      ) : null}

      <div className="rlist">
        {draft.segs.map((s, i) => {
          const a = place(draft.points[i]?.place ?? '')
          const b = place(draft.points[i + 1]?.place ?? '')
          const md = snap.cfg.modes.find(m => m.id === s.mode) ?? null
          return (
            <div key={i} className="rline">
              <button type="button" className="rhead" aria-expanded={open(i)} onClick={() => toggle(i)}>
                <span className="ico-b sm"><TeIcon name={MODE_ICON[s.mode] ?? 'route'} size="sm" /></span>
                <span className="grow">
                  <b className="small">{a?.s ?? '—'} → {b?.s ?? '—'}</b>
                  <small className="muted">
                    {md?.name ?? 'Choose how you travel'}
                    {s.bookedBy === 'desk' ? ' · the Travel Desk books it' : ''}
                  </small>
                </span>
                <TeIcon name={open(i) ? 'up' : 'down'} size="sm" />
              </button>
              {open(i) ? (
                <SegRow
                  snap={snap} draft={draft} issues={issues} i={i}
                  open onToggle={() => toggle(i)} tried={!!draft.tried}
                  edit={edit} onPick={onPick} onVehicleAdded={onVehicleAdded}
                />
              ) : null}
            </div>
          )
        })}
      </div>

      {/* ONE TAP FOR A WHOLE ROUND TRIP. Two journeys is the common case and
          four is not rare; picking "flight" and then picking it again is the
          kind of repetition a form should do for you. Offered only when it
          would actually change something, so it disappears once every journey
          already travels this way. */}
      {openSeg && openMode && others > 0 ? (
        <button
          type="button"
          className="btn wide"
          onClick={() => edit(d => applyModeToAll(d, openSeg.mode, openSeg.vehicleId))}
        >
          <TeIcon name="swap" size="sm" />
          Use {openMode.name.toLowerCase()} for {others === legs - 1 ? 'every journey' : `the other ${plural(others, 'journey')}`}
        </button>
      ) : null}

      {draft.tried && left ? (
        <div className="ferr"><TeIcon name="warn" size="sm" />{left === 1 ? 'One journey still needs a mode.' : `${left} journeys still need a mode.`}</div>
      ) : null}

      {offered.length ? (
        <p className="small muted">
          Offered here: {offered.map(m => m.name).join(', ')}.
          {' '}A mode missing from this list is switched off for this kind of trip in Admin → Modes and rates.
        </p>
      ) : null}
    </div>
  )
}

/** How you travel between two places. Defined outside the parent, or it would
 *  remount on every keystroke and drop focus. */
function SegRow({ snap, draft, issues, i, open, tried, onToggle, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  i: number
  open: boolean
  tried: boolean
  onToggle: () => void
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  onPick: (t: PickTarget) => void
  onVehicleAdded: (message: string) => void
}) {
  const [addingVehicle, setAddingVehicle] = useState(false)
  const s = draft.segs[i]
  const mine = snap.vehicles.filter(v => v.emp === snap.me)
  if (!s) return null
  const md = snap.cfg.modes.find(m => m.id === s.mode) ?? null
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const a = place(draft.points[i]?.place ?? '')
  const b = place(draft.points[i + 1]?.place ?? '')
  const err = issues.find(q => q.block && q.k === `m${i}`)

  const modes = snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope))
  const vehicle = s.mode === 'own' ? snap.vehicles.find(v => v.id === s.vehicleId) : null
  // The Travel Desk books tickets, but not for a local trip and not for one that
  // already happened — there is nothing left to book.
  const desk = !!md && md.basis === 'ticket' && draft.origin !== 'POST_FACTO' && draft.scope !== 'local'
  const checkIn = md?.gps === 'checkin'

  const setSeg = (patch: Partial<typeof s>) => edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))

  const bits = [
    vehicle?.reg ?? '',
    desk ? (s.bookedBy === 'self' ? 'You book' : 'Travel Desk books') : '',
  ].filter(Boolean)

  return (
    <div className={`rseg ${open ? 'open ' : ''}${err && tried ? 'bad' : ''}`}>
      <button type="button" className="rshead" aria-expanded={open} onClick={onToggle}>
        <TeIcon name={md ? MODE_ICON[md.id] ?? 'route' : 'route'} size="sm" />
        <b>{md ? md.name : 'Choose how you travel'}</b>
        {bits.length ? <span className="rsub">{bits.join(' · ')}</span> : null}
        <span className="grow" />
        {md ? <span className="rtag"><TeIcon name={checkIn ? 'target' : 'route'} size="sm" />{checkIn ? 'Check-ins' : 'GPS'}</span> : null}
        <TeIcon name={open ? 'up' : 'down'} size="sm" />
      </button>

      {!open && err && tried ? <div className="ferr"><TeIcon name="alert" size="sm" />{err.t}</div> : null}

      {open ? (
        <div className="redit sg">
          <div className="rs-modes" role="group" aria-label={a && b ? `How you travel from ${a.s} to ${b.s}` : 'How you travel'}>
            {modes.map(m => (
              <button
                key={m.id}
                type="button"
                className="mchip"
                aria-pressed={s.mode === m.id}
                title={`${m.name}: ${PAY_WORDS[m.basis] ?? ''}`}
                onClick={() => setSeg({ mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })}
              >
                <TeIcon name={MODE_ICON[m.id] ?? 'route'} size="sm" />
                <span>{m.name}</span>
              </button>
            ))}
          </div>

          {/* Picking the vehicle, and adding one without leaving the plan: a
              person who gets here has already chosen to drive, and sending them
              to another screen to register the car loses the trip they were
              halfway through writing. */}
          {s.mode === 'own' ? (
            <div className="vpick">
              <div className="vchips">
                {mine.map(v => (
                  <button key={v.id} type="button" className="vchip" aria-pressed={s.vehicleId === v.id} onClick={() => setSeg({ vehicleId: v.id })}>
                    <TeIcon name={v.type === 'bike' ? 'bike' : 'car'} size="sm" />
                    <span>
                      <b className="mono">{v.reg}</b>
                      <small>{vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)}{v.verified ? '' : ' · HR to check'}</small>
                    </span>
                  </button>
                ))}
                {mine.length ? (
                  <button type="button" className="vchip add" aria-expanded={addingVehicle} onClick={() => setAddingVehicle(v => !v)}>
                    <TeIcon name="plus" size="sm" />
                    <span><b>Another vehicle</b><small>Any vehicle, by its number</small></span>
                  </button>
                ) : null}
              </div>
              {addingVehicle || !mine.length ? (
                <TeVehicleAdd
                  snap={snap}
                  first={!mine.length}
                  onClose={mine.length ? () => setAddingVehicle(false) : undefined}
                  onAdded={(vehicleId, message) => {
                    setAddingVehicle(false)
                    // Use it on this leg straight away, and on any other
                    // own-vehicle leg still waiting for one.
                    edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i || (q.mode === 'own' && !q.vehicleId) ? { ...q, mode: 'own', vehicleId } : q)) }))
                    onVehicleAdded(message)
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {desk ? (
            <div className="seg sm" role="group" aria-label="Who books">
              <button type="button" aria-pressed={s.bookedBy !== 'self'} onClick={() => setSeg({ bookedBy: 'desk' })}>Travel Desk books</button>
              <button type="button" aria-pressed={s.bookedBy === 'self'} onClick={() => setSeg({ bookedBy: 'self' })}>I book and claim</button>
            </div>
          ) : null}

          {/* A flight or a train starts at an airport or a station. When the city
              has none set up, the person picks one and it becomes a leg of its own. */}
          {md && (md.id === 'flight' || md.id === 'train') && draft.scope !== 'local' ? (
            <div className="hubs">
              {(['A', 'B'] as const).map(side => {
                const city = side === 'A' ? a : b
                const hub = place(side === 'A' ? s.xfer.hubA ?? '' : s.xfer.hubB ?? '')
                const word = md.id === 'flight' ? 'airport' : 'station'
                return (
                  <button key={side} type="button" className={`locb hubb ${hub ? '' : 'need'}`} onClick={() => onPick({ kind: 'hub', index: i, side, title: `${word === 'airport' ? 'Airport' : 'Railway station'} in ${city?.city || city?.s || 'this city'}`, hub: word })}>
                    <span className="ico-b sm"><TeIcon name={md.id === 'flight' ? 'plane' : 'train'} size="sm" /></span>
                    <span className="grow">
                      <small>The {word} you {side === 'A' ? 'leave from' : 'arrive at'}{city ? `, ${city.city || city.s}` : ''}</small>
                      {hub
                        ? <><b>{hub.s}</b><span className="ad">Chosen by you. Tap to change</span></>
                        : <><b className="ph0">Choose the {word}</b><span className="ad">No {word} is set up for {city?.city || city?.s || 'this city'}</span></>}
                    </span>
                    <TeIcon name="rightc" size="sm" />
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="rs-note">
            <TeIcon name={checkIn ? 'target' : 'route'} size="sm" />
            {md ? ` ${PAY_WORDS[md.basis] ?? ''}. ${checkIn ? 'Check-in by GPS at both ends. No stops on the way.' : `GPS records the route.${md.stops ? ' Stops can be added on the way.' : ' Stops are the operator’s.'}`}` : ''}
          </div>
          {tried && err ? <div className="ferr"><TeIcon name="warn" size="sm" />{err.t}</div> : null}

          <div className="rfoot">
            <span className="grow" />
            <button type="button" className="btn sm pri" onClick={onToggle}><TeIcon name="check" size="sm" />Done</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
