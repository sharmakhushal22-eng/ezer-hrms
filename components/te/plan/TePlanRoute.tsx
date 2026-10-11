'use client'
// components/te/plan/TePlanRoute.tsx — step 2: the route, as a short list.
// Screens 12, 15, 16, 16b, 19, 22, 25, 26, 35, 37.
//
// One line per place, a thin line for the travel between them, tap a line to
// change it. Only one line is open at a time, which is what keeps a six-leg
// international trip readable on a phone.
//
// `arrive` is never stored on the draft — the server works out when you get
// somewhere from when you left the place before. It is read off the preview's
// legs for display only.
import { Fragment } from 'react'
import type { Snapshot, TripIssue, TripPreview } from '@/lib/te/types'
import { errorFor, pointLabel, addStop, movePoint, removePoint, setPattern, type DraftContext, type PlannerDraft } from '@/lib/te/trip-draft'
import { day, plural } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import type { PickTarget } from './TePlacePicker'

const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}
const PAY_WORDS: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}
const PATTERN_WORD: Record<string, string> = { oneway: 'Single', round: 'Round trip', multi: 'Multi-city' }

export default function TePlanRoute({ snap, draft, issues, preview, edit, onPick }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  preview: TripPreview | null
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  onPick: (t: PickTarget) => void
}) {
  const local = draft.scope === 'local'
  const planning = draft.origin !== 'POST_FACTO'
  const tried = draft.tried
  const err = (k: string) => errorFor(issues, k, tried)
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const ptName = (id: string) => snap.cfg.ptypes.find(p => p.id === id)?.name ?? ''
  const hasReturn = draft.points.some(p => p.ret)
  const label0 = local ? (planning ? 'Date of the trip' : 'Date you travelled') : (planning ? 'Leave on' : 'Left on')
  const stops = pointLabel(draft, 0).destinations.length - 1

  // When you arrive somewhere: the server put it on the leg that goes there.
  const arrivalAt = (i: number) => {
    const legs = preview?.legs ?? []
    const target = draft.points[i]?.place
    return target ? legs.find(l => l.to === target)?.date ?? '' : ''
  }

  const toggle = (key: string) => edit(d => ({ ...d, open: d.open === key ? null : key }))

  return (
    <div className="sec">
      <div className="row sp rtop">
        <h4>Route</h4>
        <div className="seg sm" role="group" aria-label="Way back">
          <button type="button" aria-pressed={!hasReturn} onClick={() => edit(d => setPattern(d, 'oneway', ctxOf(snap)))}>
            <TeIcon name="go" size="sm" />One way
          </button>
          <button type="button" aria-pressed={hasReturn} onClick={() => edit(d => setPattern(d, 'round', ctxOf(snap)))}>
            <TeIcon name="swap" size="sm" />Round trip
          </button>
        </div>
      </div>

      <div className="rdate">
        <label className="fld sm">
          <span>{label0}</span>
          <input
            type="date"
            value={draft.points[0]?.leave || ''}
            min={planning ? snap.today : undefined}
            max={planning ? undefined : snap.today}
            onChange={e => edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, leave: e.target.value } : p)) }))}
          />
        </label>
        <p className="small muted">
          {PATTERN_WORD[draft.pattern]}{stops > 0 ? `, ${plural(stops, 'stop')}` : ''}. Tap a line to change it.
        </p>
      </div>
      {err('d0') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('d0')}</div> : null}

      <div className="rlist">
        {draft.points.map((p, i) => {
          const L = pointLabel(draft, i)
          const key = `p${i}`
          const open = draft.open === key
          const lockRet = !!p.ret && draft.retSame
          const pc = place(lockRet ? draft.points[0].place : p.place)
          const arrive = arrivalAt(i)
          const issue = issues.find(x => x.block && (x.k === key || (i > 0 && x.k === `d${i}`)))
          const bad = !!issue && !!tried

          const when = local ? ''
            : p.ret ? (arrive ? `Back on ${day(arrive)}` : '')
              : i > 0 ? [arrive ? day(arrive) : '', p.leave && p.leave !== arrive ? day(p.leave) : ''].filter(Boolean).join(' to ')
                : ''
          const sub = (lockRet ? ['Same as the start', when] : [pc && p.pt ? ptName(p.pt) : '', i > 0 && !p.ret ? p.what : '', when])
            .filter(Boolean).join(' · ')
          const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'

          return (
            <Fragment key={key}>
              {i === L.last && L.last > 0 ? (
                <div className="radd">
                  <button type="button" className="raddstop" onClick={() => edit(d => addStop(d, L.last - 1, ctxOf(snap)))}>
                    <TeIcon name="plus" size="sm" />Add a stop
                  </button>
                  <span className="small muted">on the way to {place(draft.points[L.last]?.place)?.s || 'the destination'}</span>
                </div>
              ) : null}

              <div className={`rrow ${L.isStop ? 'stop ' : ''}${p.ret ? 'ret ' : ''}${bad ? 'bad ' : ''}${open ? 'open' : ''}`}>
                <div className="rline">
                  {i === 0 || lockRet ? <span className="mk a">A</span>
                    : L.isStop ? <span className="mk s">{L.no}</span>
                      : <span className="mk b" title="Destination"><TeIcon name="flag" size="sm" /></span>}
                  <button type="button" className="rhead" aria-expanded={open} onClick={() => toggle(key)}>
                    <span className="rtx">
                      <small>{L.label}</small>
                      <b>{pc ? pc.s : <span className="ph0">{placeholder}</span>}</b>
                      {sub ? <span className="rsub">{sub}</span> : null}
                      {issue && !open && (pc || bad) ? <span className={`rsub ${bad ? 'bad' : 'todo'}`}><TeIcon name="alert" size="sm" />{issue.t}</span> : null}
                    </span>
                    <TeIcon name={open ? 'up' : 'down'} size="sm" />
                  </button>
                  {L.isStop ? (
                    <button type="button" className="rx" aria-label={`Remove ${L.label}`} title={`Remove ${L.label}`} onClick={() => edit(d => removePoint(d, i, ctxOf(snap)))}>
                      <TeIcon name="close" size="sm" />
                    </button>
                  ) : null}
                </div>

                {open ? (
                  <div className="redit">
                    {p.ret ? (
                      <label className="check small">
                        <input type="checkbox" checked={draft.retSame} onChange={e => edit({ retSame: e.target.checked })} />
                        <span>Same as the start</span>
                      </label>
                    ) : null}

                    {lockRet ? null : (
                      <div className="loc">
                        <button type="button" className="locb" onClick={() => onPick({ kind: 'point', index: i, title: pickTitle(i, p.ret, draft.pattern), intl: draft.scope === 'international' && i > 0 && !p.ret })}>
                          <span className="mk b">{i === 0 ? 'A' : 'B'}</span>
                          <span className="grow">
                            <small>{locLabel(i, !!p.ret, L.isStop, draft.scope === 'international')}</small>
                            {pc ? <><b>{pc.s}</b><span className="ad">{pc.addr || pc.name}</span></> : <b className="ph0">{placeholder}</b>}
                          </span>
                          <TeIcon name="rightc" size="sm" />
                        </button>
                        <div className="locx">
                          <button type="button" className="link small" onClick={() => onPick({ kind: 'point', index: i, title: pickTitle(i, p.ret, draft.pattern), useGps: true })}>
                            <TeIcon name="target" size="sm" />Use my current location
                          </button>
                          <button type="button" className="link small" onClick={() => onPick({ kind: 'point', index: i, title: pickTitle(i, p.ret, draft.pattern), address: true, intl: draft.scope === 'international' && i > 0 && !p.ret })}>
                            <TeIcon name="pin" size="sm" />Enter the address
                          </button>
                        </div>
                      </div>
                    )}
                    {err(key) ? <div className="ferr"><TeIcon name="warn" size="sm" />{err(key)}</div> : null}

                    {pc && !lockRet ? (
                      <div className="rp-det">
                        <label className="fld sm">
                          <span>Type of place</span>
                          <select value={p.pt} onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, pt: e.target.value } : q)) }))}>
                            {p.pt ? null : <option value="">Choose</option>}
                            {snap.cfg.ptypes.filter(t => t.on).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </label>
                        {i > 0 && !p.ret ? (
                          <label className="fld sm">
                            <span>{L.isStop ? 'Why you stop here' : 'What you will do there'}</span>
                            <input
                              value={p.what}
                              placeholder={L.isStop ? 'Pick up samples, meet the dealer' : 'Meeting, audit, delivery'}
                              onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, what: e.target.value } : q)) }))}
                            />
                          </label>
                        ) : null}
                        {i > 0 && !p.ret && !local ? (
                          <label className="fld sm">
                            <span>{i === L.last && draft.pattern === 'oneway' ? 'Stay until, if you stay' : 'Leave on'}</span>
                            <input
                              type="date"
                              value={p.leave || ''}
                              min={arrive || undefined}
                              onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, leave: e.target.value } : q)) }))}
                            />
                            <small>{arrive ? `Arrive ${day(arrive)}` : ' '}</small>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                    {i > 0 && err(`d${i}`) ? <div className="ferr"><TeIcon name="warn" size="sm" />{err(`d${i}`)}</div> : null}

                    <div className="rfoot">
                      {i > 0 && !p.ret && L.destinations.length > 1 ? (
                        <>
                          <button type="button" className="btn sm" disabled={i <= 1} aria-label={`Move ${L.label} earlier`} onClick={() => edit(d => movePoint(d, i, -1, ctxOf(snap)))}><TeIcon name="up" size="sm" />Earlier</button>
                          <button type="button" className="btn sm" disabled={i >= L.last} aria-label={`Move ${L.label} later`} onClick={() => edit(d => movePoint(d, i, 1, ctxOf(snap)))}><TeIcon name="down" size="sm" />Later</button>
                        </>
                      ) : null}
                      <span className="grow" />
                      <button type="button" className="btn sm pri" onClick={() => toggle(key)}><TeIcon name="check" size="sm" />Done</button>
                    </div>
                  </div>
                ) : null}
              </div>

              {i < draft.points.length - 1 ? (
                <SegRow
                  snap={snap} draft={draft} issues={issues} i={i}
                  open={draft.open === `s${i}`} tried={!!tried}
                  onToggle={() => toggle(`s${i}`)} edit={edit} onPick={onPick}
                />
              ) : null}
            </Fragment>
          )
        })}
      </div>
      {err('pr') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('pr')}</div> : null}
    </div>
  )
}

/** How you travel between two places. Defined outside the parent, or it would
 *  remount on every keystroke and drop focus. */
function SegRow({ snap, draft, issues, i, open, tried, onToggle, edit, onPick }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  i: number
  open: boolean
  tried: boolean
  onToggle: () => void
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  onPick: (t: PickTarget) => void
}) {
  const s = draft.segs[i]
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

          {s.mode === 'own' ? (
            <div className="vpick">
              <div className="vchips">
                {snap.vehicles.map(v => (
                  <button key={v.id} type="button" className="vchip" aria-pressed={s.vehicleId === v.id} onClick={() => setSeg({ vehicleId: v.id })}>
                    <TeIcon name="car" size="sm" />{v.reg}
                  </button>
                ))}
              </div>
              {snap.vehicles.length ? null : <p className="small muted">No vehicle on file. Adding one is build step 4.</p>}
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

function pickTitle(i: number, ret: boolean | undefined, pattern: string): string {
  if (i === 0) return 'Where the trip starts'
  if (ret) return 'Where you come back to'
  return pattern === 'multi' ? `Destination ${i}` : 'Destination'
}

function locLabel(i: number, ret: boolean, isStop: boolean, intl: boolean): string {
  if (i === 0) return 'Where you start'
  if (ret) return 'Where you come back to'
  return (isStop ? 'Where you stop' : 'Where you go') + (intl ? ', in any country' : '')
}

/** The route edits need the same context the planner built. Rebuilding it here
 *  keeps the prop list short; it is three lookups over data already in memory. */
function ctxOf(snap: Snapshot): DraftContext {
  return {
    today: snap.today,
    officePlace: snap.masters.places.find(p => p.pt === 'corp')?.id ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }
}
