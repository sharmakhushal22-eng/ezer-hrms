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
import { Fragment, useState } from 'react'
import type { Snapshot, TripIssue } from '@/lib/te/types'
import { applyModeToAll, blockingOn, HUB_MODES, journeysUnlike, type PlannerDraft } from '@/lib/te/trip-draft'
import { chainCount, commuteChain, hubForCity, hubKind, NO_XFER, sameHub, xferModes } from '@/lib/te/commute'
import { day, plural } from '@/lib/te/format'
import { vehicleSubtitle } from '@/lib/te/vehicle'
import { badUrl } from '@/lib/te/trip-stay'
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
/** Modes nobody books for you, so there is nothing to ask the desk about:
 *  your own vehicle and the company's. Everything else — a flight, a train, a
 *  bus, a cab, a rental — can be booked, and a link to the one you found is
 *  worth having. */
const NO_BOOKING: Record<string, true> = { own: true, company: true }

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
  const offered = snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope) && (draft.flightOrTrain !== false || !HUB_MODES.includes(m.id)))
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
        {draft.flightOrTrain === false
          ? ' You said this trip has no flight or train, so those are not offered either.'
          : ''}
      </p>

      {!legs ? (
        <div className="empty">
          <b>No journeys yet</b>
          Go back to the route and choose where you are going. How you travel is asked for each journey between two places.
        </div>
      ) : null}

      {/* THE SAME SHAPE AS THE ROUTE STEP, on purpose. Step 2 draws the trip
          left to right; arriving here and finding a vertical list of the same
          journeys made them look like different things. The cards are the
          journeys this time rather than the places, and selecting one opens
          it in the panel below. */}
      {legs ? (
        <div className="jflow-wrap">
          <div className="jflow" role="group" aria-label={`The journeys of this trip. ${done} of ${legs} chosen`}>
            {draft.segs.map((s, i) => {
              const a = place(draft.points[i]?.place ?? '')
              const b = place(draft.points[i + 1]?.place ?? '')
              const md = snap.cfg.modes.find(m => m.id === s.mode) ?? null
              const bad = !!draft.tried && !s.mode
              return (
                <Fragment key={i}>
                  {i > 0 ? <span className="jlink" aria-hidden="true"><span className="jlink-m todo"><TeIcon name="go" size="sm" />then</span></span> : null}
                  <button
                    type="button"
                    className={`jnode ${open(i) ? 'on ' : ''}${bad ? 'bad ' : ''}${s.mode ? '' : 'empty'}`}
                    aria-pressed={open(i)}
                    aria-label={`Journey ${i + 1}: ${a?.s ?? 'start'} to ${b?.s ?? 'destination'}. ${md ? md.name : 'no mode chosen yet'}`}
                    onClick={() => toggle(i)}
                  >
                    <span className="jn-top">
                      <span className="mk b">{s.mode ? <TeIcon name="check" size="sm" /> : i + 1}</span>
                      <span className="jn-k">Journey {i + 1}</span>
                    </span>
                    <span className="jn-name">{a?.s ?? '—'} → {b?.s ?? '—'}</span>
                    <span className={`jn-meta ${md ? '' : 'ph0'}`}>
                      {md ? md.name : 'Choose how you travel'}
                      {md && s.bookedBy === 'desk' ? ' · Travel Desk books' : ''}
                    </span>
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>
      ) : null}

      {legs && openAt < 0 ? (
        <p className="small muted">Tap a journey above to choose how you travel it.</p>
      ) : null}

      {openAt >= 0 ? (
        <SegRow
          snap={snap} draft={draft} issues={issues} i={openAt}
          open onToggle={() => toggle(openAt)} tried={!!draft.tried}
          edit={edit} onPick={onPick} onVehicleAdded={onVehicleAdded}
        />
      ) : null}

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

  const modes = snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope) && (draft.flightOrTrain !== false || !HUB_MODES.includes(m.id)))
  /** The door-to-door shape of this journey. Mirrors the engine's buildLegs so
   *  the person sees it before the preview answers; the engine stays the
   *  authority on what is actually estimated. */
  const chain = commuteChain({
    mode: s.mode,
    scope: draft.scope,
    from: draft.points[i]?.place ?? '',
    to: draft.points[i + 1]?.place ?? '',
    hubA: s.xfer.hubA,
    hubB: s.xfer.hubB,
    first: s.xfer.first,
    last: s.xfer.last,
  })
  const hubName = hubKind(s.mode, draft.scope) ?? 'hub'
  const vehicle = s.mode === 'own' ? snap.vehicles.find(v => v.id === s.vehicleId) : null
  // The Travel Desk books tickets, but not for a local trip and not for one that
  // already happened — there is nothing left to book.
  const desk = !!md && md.basis === 'ticket' && draft.origin !== 'POST_FACTO' && draft.scope !== 'local'
  /** Whether the desk is actually booking this one, which changes who the
   *  preference is addressed to. */
  const deskBooks = desk && s.bookedBy !== 'self'
  /** The date this journey leaves, owned by the route. Shown, never re-asked:
   *  two places to set one date is how they end up disagreeing. */
  const legDate = draft.points[i]?.leave || draft.points[i + 1]?.arrive || ''
  const checkIn = md?.gps === 'checkin'

  const setSeg = (patch: Partial<typeof s>) => edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))

  const bits = [
    vehicle?.reg ?? '',
    desk ? (s.bookedBy === 'self' ? 'You book' : 'Travel Desk books') : '',
  ].filter(Boolean)

  return (
    <div className={`jpanel ${err && tried ? 'bad' : ''}`}>
      <div className="jpanel-h">
        <span className="ico-b sm"><TeIcon name={md ? MODE_ICON[md.id] ?? 'route' : 'route'} size="sm" /></span>
        <h5>{a?.s ?? '—'} → {b?.s ?? '—'}</h5>
        {bits.length ? <span className="chip plain">{bits.join(' · ')}</span> : null}
        <span className="grow" />
        {md ? <span className="rtag"><TeIcon name={checkIn ? 'target' : 'route'} size="sm" />{checkIn ? 'Check-ins' : 'GPS'}</span> : null}
        <button type="button" className="btn sm pri" onClick={onToggle}><TeIcon name="check" size="sm" />Done</button>
      </div>

      {open ? (
        <>
          {/* TILES, NOT CHIPS. A mode is the one decision of this step, and it
              was a row of small pills that read as filters. Each tile now says
              what it is and how it is paid, which is the question people
              actually have when choosing between their own car and a cab. */}
          <div className="mtiles" role="group" aria-label={a && b ? `How you travel from ${a.s} to ${b.s}` : 'How you travel'}>
            {modes.map(m => (
              <button
                key={m.id}
                type="button"
                className="mtile"
                aria-pressed={s.mode === m.id}
                onClick={() => setSeg({ mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })}
              >
                <TeIcon name={MODE_ICON[m.id] ?? 'route'} />
                <b>{m.name}</b>
                <small>{PAY_WORDS[m.basis] ?? ''}</small>
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
                const chosen = place(side === 'A' ? s.xfer.hubA ?? '' : s.xfer.hubB ?? '')
                // WHAT THE PLAN WILL ACTUALLY USE. Only the employee's own
                // choice was read here, so a city with a perfectly good
                // company airport was reported as having none — a sentence
                // about an empty field, written as a statement about the
                // configuration. hubForCity mirrors the engine, which is
                // what decides.
                const auto = chosen ? null : place(hubForCity(city, md.id === 'flight' ? 'air' : 'rail', snap.masters) ?? '')
                const hub = chosen ?? auto
                const word = md.id === 'flight' ? 'airport' : 'station'
                return (
                  <button key={side} type="button" className={`locb hubb ${hub ? '' : 'need'}`} onClick={() => onPick({ kind: 'hub', index: i, side, title: `${word === 'airport' ? 'Airport' : 'Railway station'} in ${city?.city || city?.s || 'this city'}`, hub: word })}>
                    <span className="ico-b sm"><TeIcon name={md.id === 'flight' ? 'plane' : 'train'} size="sm" /></span>
                    <span className="grow">
                      <small>The {word} you {side === 'A' ? 'leave from' : 'arrive at'}{city ? `, ${city.city || city.s}` : ''}</small>
                      {hub
                        ? <><b>{hub.s}</b><span className="ad">{chosen ? 'Chosen by you. Tap to change' : `Your company’s ${word} for ${city?.city || city?.s || 'this city'}. Tap to change`}</span></>
                        : <><b className="ph0">Choose the {word}</b><span className="ad">No {word} is set up for {city?.city || city?.s || 'this city'}</span></>}
                    </span>
                    <TeIcon name="rightc" size="sm" />
                  </button>
                )
              })}
            </div>
          ) : null}

          {/* The same airport at both ends is not a journey, and it almost
              always means the wrong city was picked on the route. The engine
              collapses both hubs and quietly plans one direct leg, so without
              this the plan silently becomes something else. */}
          {sameHub(s.xfer.hubA, s.xfer.hubB) ? (
            <div className="ferr warn">
              <TeIcon name="alert" size="sm" />
              Both ends use the same {hubName}. Check the places on the route — this is usually the wrong city.
            </div>
          ) : null}

          {/* ── DOOR TO DOOR ──
              "Delhi to Mumbai by flight" is three journeys, and the engine has
              always built it that way — a first leg to the airport, the flight,
              a last leg from the other airport — each estimated, tracked and
              claimed on its own. What no screen ever did was ASK: xfer.first
              and xfer.last defaulted to a cab in newSeg and were invisible, so
              somebody who took the metro, or whose colleague dropped them, had
              a cab planned for them and an estimate built on it.

              The chain is drawn first because it is the thing a person
              recognises — their own trip, in order — and the pickers under it
              change what the chain says. */}
          {chain.length > 1 ? (
            <div className="stack sm">
              <div className="rs-note">
                <TeIcon name="route" size="sm" />
                <span>
                  {chainCount(chain)} {chainCount(chain) === 1 ? 'journey' : 'journeys'} door to door.
                  {' '}Each is estimated, tracked and claimed on its own.
                </span>
              </div>

              <ol className="itin">
                {chain.map((step, n) => {
                  const pf = place(step.from), pt = place(step.to)
                  return (
                    <li key={`${step.kind}-${n}`} className={step.skipped ? 'faint' : undefined}>
                      <span className="mk">{n + 1}</span>
                      <span className="grow">
                        <span>{pf?.s ?? '—'} → {pt?.s ?? '—'}</span>
                        <span className="chip plain">
                          {step.skipped ? 'Nothing to claim' : (snap.cfg.modes.find(m => m.id === step.mode)?.name ?? step.mode)}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ol>

              {/* One picker per end that exists. A journey that starts at the
                  airport has no first mile to ask about, and the chain above
                  already shows that. */}
              {(['first', 'last'] as const).map(side => {
                if (!chain.some(st => st.kind === side)) return null
                const atHub = side === 'first'
                const label = atHub
                  ? `Getting to the ${hubName}`
                  : `Getting from the ${hubName} to where you are going`
                const value = (side === 'first' ? s.xfer.first : s.xfer.last) || 'cab'
                return (
                  <label key={side} className="fld sm">
                    <span>{label}</span>
                    <select
                      value={value}
                      onChange={e => setSeg({ xfer: { ...s.xfer, [side]: e.target.value } })}
                    >
                      {xferModes(snap.cfg.modes).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      {/* The honest option, and the one that was impossible
                          before: somebody drops you, or you walk. */}
                      <option value={NO_XFER}>Nothing to claim — dropped, walked or already there</option>
                    </select>
                    {value === 'own' ? (
                      <small>Your own vehicle. The same one as the main journey unless you change it there.</small>
                    ) : null}
                  </label>
                )
              })}
            </div>
          ) : null}

          {/* ── WHAT TO ASK THE DESK FOR ──
              "Mumbai to Jaipur by flight on the 2nd" is not enough to buy a
              ticket: there are a dozen flights that day, and the desk was
              left guessing or writing to ask. These are the answers to the
              questions it would have asked.

              Not for your own vehicle — nothing is booked when you drive
              yourself. Everything here is optional; a journey with none of it
              is exactly the journey that was planned before. */}
          {md && !NO_BOOKING[md.id] ? (
            <div className="prefbox">
              <div className="pref-h">
                <TeIcon name={deskBooks ? 'plane' : 'info'} size="sm" />
                <b>{deskBooks ? 'What should the Travel Desk book?' : 'Anything to note about this journey?'}</b>
                <span className="chip plain">Optional</span>
              </div>
              <p className="small muted">
                {deskBooks
                  ? `The desk books this one. The date comes from the route${legDate ? ` — ${day(legDate)}` : ''}; tell it when you would rather leave and point it at anything you have already found.`
                  : `You are booking this yourself. Anything here is for your approver to see${legDate ? `, on ${day(legDate)}` : ''}.`}
              </p>
              <div className="jp-grid">
                <label className="fld sm">
                  <span>Preferred time</span>
                  <input type="time" value={s.prefTime ?? ''} onChange={e => setSeg({ prefTime: e.target.value })} />
                  <small>When you would like to leave.</small>
                </label>
                <label className="fld sm">
                  <span>Link to what you found</span>
                  <input
                    value={s.prefUrl ?? ''}
                    placeholder="https://…"
                    onChange={e => setSeg({ prefUrl: e.target.value })}
                  />
                  {badUrl(s.prefUrl ?? '')
                    ? <small className="bad">That does not look like a web address. Paste the whole link, starting with https://</small>
                    : <small>A flight, train or fare. The desk can open it.</small>}
                </label>
              </div>
              <label className="fld sm">
                <span>Anything else</span>
                <input
                  value={s.prefNote ?? ''}
                  placeholder="Either the 6am or after 8pm; same airline as the outbound"
                  onChange={e => setSeg({ prefNote: e.target.value })}
                />
              </label>
            </div>
          ) : null}

          <div className="rs-note">
            <TeIcon name={checkIn ? 'target' : 'route'} size="sm" />
            {md ? ` ${PAY_WORDS[md.basis] ?? ''}. ${checkIn ? 'Check-in by GPS at both ends. No stops on the way.' : `GPS records the route.${md.stops ? ' Stops can be added on the way.' : ' Stops are the operator’s.'}`}` : ''}
          </div>
          {tried && err ? <div className="ferr"><TeIcon name="warn" size="sm" />{err.t}</div> : null}
        </>
      ) : null}
    </div>
  )
}
