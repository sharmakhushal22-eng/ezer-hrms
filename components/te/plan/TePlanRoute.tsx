'use client'
// components/te/plan/TePlanRoute.tsx — step 2: where you go, and when.
// Screens 12, 15, 16, 16b, 19, 22, 25, 26, 35, 37.
//
// ONE DECISION PER STEP. This used to ask for the route AND how you travel it:
// a place, then a thin line asking for a mode, a vehicle, which airport and
// who books the ticket, then the next place. How you travel is step 3 now, and
// this step is only the shape of the trip — one way or round trip, where from,
// where to, and the dates. The thin line between two places still shows what
// was chosen, but it is read-only here.
//
// One line per place, tap a line to change it, only one open at a time, which
// is what keeps a six-leg international trip readable on a phone.
//
// `arrive` is never stored on the draft — the server works out when you get
// somewhere from when you left the place before. It is read off the preview's
// legs for display only.
import { Fragment } from 'react'
import type { Snapshot, TripIssue, TripPreview } from '@/lib/te/types'
import { errorFor, pointLabel, addStop, movePoint, removePoint, setPattern, type DraftContext, type PlannerDraft } from '@/lib/te/trip-draft'
import { day, plural } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeTripMap from './TeTripMap'
import type { PickTarget } from './TePlacePicker'

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

  /** The placed points, in order, for the map above the list. */
  const mapPoints = draft.points.map(p => p.place).filter(Boolean)
  /** How many DIFFERENT places are on the route. A round trip starts with its
   *  return point mirroring the start, so one chosen place already counts as
   *  two points — and the map drew a single marker in a 190px grey box that
   *  told nobody anything. It appears once there is a journey to show. */
  const distinctPlaces = new Set(mapPoints).size
  const places = new Map(snap.masters.places.map(p => [p.id, { id: p.id, s: p.s, lat: p.lat, lng: p.lng }]))
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

  // The latest day you leave anywhere on the route. The day you get back
  // cannot be before it, so it is the floor on that input — the same native
  // `min` guard the other date fields use, not a rule of its own.
  const retPoint = draft.points.find(p => p.ret)
  const lastLeave = draft.points
    .filter(p => !p.ret && p.leave)
    .map(p => p.leave)
    .sort()
    .pop() ?? ''

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
        <label className="fld sm dt">
          <span>{label0}</span>
          <input
            type="date"
            value={draft.points[0]?.leave || ''}
            min={planning ? snap.today : undefined}
            max={planning ? undefined : snap.today}
            onChange={e => edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, leave: e.target.value } : p)) }))}
          />
        </label>
        {/* THE TIME, beside the date it belongs to. Optional on purpose: plenty
            of people know they travel on the 16th and not yet at what hour, and
            an empty time is kept as "not recorded" rather than as midnight
            (migration 165). It is here because "the 16th" does not tell an
            approver, or the Travel Desk booking the ticket, whether that is a
            6am flight needing a cab at 4 or an evening train. */}
        <label className="fld sm tm">
          <span>Leaving at</span>
          <input
            type="time"
            value={draft.points[0]?.leaveAt || ''}
            onChange={e => edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, leaveAt: e.target.value } : p)) }))}
          />
          <small>Optional</small>
        </label>
        {/* The other half of a round trip, next to the date it pairs with.
            Asked for rather than derived because the journey home can cross
            midnight: leaving at 10pm on the 16th and reaching home at 6am on
            the 17th is a trip that ends on the 17th, and only the traveller
            knows that. Left empty, the server works the end date out from the
            last place you left, exactly as it did before.

            It sits HERE and not on the return point's own row because that row
            collapses to "Same as the start" whenever the return mirrors the
            start — which is the default — and its fields are not rendered at
            all in that state.

            Shown for local trips too: a local trip can run over more than
            one day. What makes it local is staying inside the one state, not
            finishing the day it started. */}
        {hasReturn ? (
          <>
            <label className="fld sm dt">
              <span>Back at the start on</span>
              <input
                type="date"
                value={retPoint?.arrive || ''}
                min={lastLeave || draft.points[0]?.leave || undefined}
                max={planning ? undefined : snap.today}
                onChange={e => edit(d => ({ ...d, points: d.points.map(p => (p.ret ? { ...p, arrive: e.target.value } : p)) }))}
              />
            </label>
            <label className="fld sm tm">
              <span>Back at</span>
              <input
                type="time"
                value={retPoint?.arriveAt || ''}
                onChange={e => edit(d => ({ ...d, points: d.points.map(p => (p.ret ? { ...p, arriveAt: e.target.value } : p)) }))}
              />
              <small>Optional</small>
            </label>
          </>
        ) : null}
        <p className="small muted">
          {PATTERN_WORD[draft.pattern]}{stops > 0 ? `, ${plural(stops, 'stop')}` : ''}. Tap a line to change it.
        </p>
      </div>
      {err('d0') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('d0')}</div> : null}

      {/* THE MAP, WHILE THE ROUTE IS BEING BUILT, not only on Review. Seeing
          the shape of the trip appear as places are chosen is how somebody
          notices they picked the Pune in the wrong state — which is a money
          error, because every kilometre on the claim is measured between these
          points. Real Google tiles when a browser key is configured; the same
          to-scale schematic as before when there is none. */}
      {distinctPlaces > 1 ? (
        <TeTripMap
          points={mapPoints}
          // The route's own shape, from the draft rather than the preview: this
          // map has to redraw while a place is still being chosen, and the
          // preview is 350ms behind on purpose.
          legs={draft.segs.map((sg, i) => ({
            from: draft.points[i]?.place ?? '',
            to: draft.points[i + 1]?.place ?? '',
            mode: sg.mode,
          })).filter(l => l.from && l.to)}
          places={places}
          height={190}
          label={`Map of ${draft.name || 'the route so far'}`}
        />
      ) : null}

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

          const when = p.ret ? (p.arrive ? `Back on ${day(p.arrive)}` : arrive ? `Back on ${day(arrive)}` : '')
            : local ? ''
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

              {/* How you travel between these two places used to sit here, as a
                  thin line between every pair of points. It is step 3 now: one
                  step for where you are going, the next for how. */}
              {i < draft.points.length - 1 ? (
                <div className="rline thin">
                  <span className="ico-b sm"><TeIcon name="route" size="sm" /></span>
                  <span className="small muted">
                    {snap.cfg.modes.find(m => m.id === draft.segs[i]?.mode)?.name ?? 'How you travel — chosen next'}
                  </span>
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>
      {err('pr') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('pr')}</div> : null}
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
