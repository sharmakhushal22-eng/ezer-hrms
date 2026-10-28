'use client'
// components/te/plan/TePlanRoute.tsx — step 2: where you go, and when.
// Screens 12, 15, 16, 16b, 19, 22, 25, 26, 35, 37.
//
// ONE DECISION PER STEP. This used to ask for the route AND how you travel it.
// How you travel is step 3 now, and this step is only the shape of the trip —
// one way or round trip, where from, where to, and the dates.
//
// THE SHAPE IS DRAWN, NOT LISTED. This was a vertical accordion: one row per
// place, tap a row and it expanded in place. Two things were wrong with it. It
// read as a column of form rows rather than as a journey, so the order — the
// one thing a route actually is — had to be inferred from the order of the
// rows. And on a trip with stops, expanding a row pushed it under the rows
// above, so you lost sight of the trip exactly while editing it.
//
// Now the trip is drawn left to right the way a person sketches one: a card
// per place, the journey between two cards as the link that joins them, and
// ONE editor panel underneath. The strip does not move while you work, so the
// shape stays on screen and the thing you are changing is always in the same
// place. Selecting a card is the same `draft.open` the accordion used, so
// nothing about the draft or its validation changed — only what you see.
//
// WHEN YOU ARE WHERE IS ASKED FOR, NOT GUESSED. `arrive` used to be derived
// by the engine from the previous departure and never stored on the draft.
// That is wrong for anything travelling overnight — a train out on the 2nd
// lands on the 3rd — and it left the Travel Desk with no idea when somebody
// actually wants to be somewhere. Every place now carries its own arrival
// date and time, departure time, a remark and a link. All optional: a blank
// arrival still falls back to the old guess, and the panel says so.
import { Fragment } from 'react'
import type { Snapshot, TripIssue, TripPreview } from '@/lib/te/types'
import { errorFor, pointLabel, addStop, movePoint, removePoint, setPattern, type DraftContext, type PlannerDraft } from '@/lib/te/trip-draft'
import { day, plural } from '@/lib/te/format'
import { badUrl } from '@/lib/te/trip-stay'
import TeIcon from '../TeIcon'
import TeTripMap from './TeTripMap'
import type { PickTarget } from './TePlacePicker'

const PATTERN_WORD: Record<string, string> = { oneway: 'Single', round: 'Round trip', multi: 'Multi-city' }
const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}

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

  /** Which card the panel below is editing. Selecting is a toggle: tapping the
   *  open card closes the panel, which is how somebody gets the whole strip
   *  back without having to finish anything. */
  const select = (key: string) => edit(d => ({ ...d, open: d.open === key ? null : key }))
  const openIndex = draft.points.findIndex((_, i) => draft.open === `p${i}`)

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

            It sits HERE and not on the return card's own panel because that
            card collapses to "Same as the start" whenever the return mirrors
            the start — which is the default — and its fields are not rendered
            at all in that state.

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
          {PATTERN_WORD[draft.pattern]}{stops > 0 ? `, ${plural(stops, 'stop')}` : ''}. Tap a place to change it.
        </p>
      </div>
      {err('d0') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('d0')}</div> : null}

      {/* ── THE TRIP, LEFT TO RIGHT ──
          A card per place and a link per journey. The links are read-only
          here — how you travel is step 3 — but they are drawn, because a
          route with nothing between its places does not look like a journey.
          `aria-label` carries the order for a screen reader, which cannot see
          that left-to-right means "then". */}
      <div className="jflow-wrap">
        {/* A group of toggles, not a list: each card selects itself for the
            editor below, and `listitem` does not carry aria-pressed. */}
        <div className="jflow" role="group" aria-label="The route, in order">
          {draft.points.map((p, i) => {
            const L = pointLabel(draft, i)
            const key = `p${i}`
            const on = draft.open === key
            const lockRet = !!p.ret && draft.retSame
            const pc = place(lockRet ? draft.points[0].place : p.place)
            const arrive = arrivalAt(i)
            const issue = issues.find(x => x.block && (x.k === key || (i > 0 && x.k === `d${i}`)))
            const bad = !!issue && !!tried

            const when = p.ret ? (p.arrive ? `Back ${day(p.arrive)}` : arrive ? `Back ${day(arrive)}` : '')
              : local ? ''
                : i > 0 ? [arrive ? day(arrive) : '', p.leave && p.leave !== arrive ? day(p.leave) : ''].filter(Boolean).join(' – ')
                  : (p.leave ? day(p.leave) : '')
            const meta = (lockRet ? ['Same as the start', when] : [pc && p.pt ? ptName(p.pt) : '', i > 0 && !p.ret ? p.what : '', when])
              .filter(Boolean).join(' · ')
            const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'
            const seg = draft.segs[i]
            const segMode = seg ? snap.cfg.modes.find(m => m.id === seg.mode) : null

            return (
              <Fragment key={key}>
                <button
                  type="button"
                  className={`jnode ${on ? 'on ' : ''}${bad ? 'bad ' : ''}${pc ? '' : 'empty'}`}
                  aria-pressed={on}
                  aria-label={`${L.label}: ${pc ? pc.s : 'not chosen yet'}${meta ? `. ${meta}` : ''}`}
                  onClick={() => select(key)}
                >
                  <span className="jn-top">
                    {i === 0 || lockRet ? <span className="mk a">A</span>
                      : L.isStop ? <span className="mk s">{L.no}</span>
                        : <span className="mk b"><TeIcon name="flag" size="sm" /></span>}
                    <span className="jn-k">{L.label}</span>
                    {L.isStop ? (
                      <span
                        className="jn-x"
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${L.label}`}
                        onClick={e => { e.stopPropagation(); edit(d => removePoint(d, i, ctxOf(snap))) }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); edit(d => removePoint(d, i, ctxOf(snap))) } }}
                      >
                        <TeIcon name="close" size="sm" />
                      </span>
                    ) : null}
                  </span>
                  <span className={`jn-name ${pc ? '' : 'ph0'}`}>{pc ? pc.s : placeholder}</span>
                  {meta ? <span className="jn-meta">{meta}</span> : null}
                  {bad && issue ? <span className="jn-meta">{issue.t}</span> : null}
                </button>

                {/* The wrapper is NOT aria-hidden: it holds the add-a-stop
                    button. Only the mode pill is, being a picture of what
                    step 3 already says in words. */}
                {i < draft.points.length - 1 ? (
                  <span className="jlink">
                    <span className={`jlink-m ${segMode ? '' : 'todo'}`} aria-hidden="true">
                      <TeIcon name={segMode ? MODE_ICON[segMode.id] ?? 'route' : 'route'} size="sm" />
                      {segMode ? segMode.name : 'Next step'}
                    </span>
                    {/* A STOP GOES IN ANY GAP, both legs of a round trip.
                        It used to be offered only in the gap before the
                        destination, so a journey broken on the way HOME —
                        Mumbai, then a night in Pune before coming back —
                        could not be said at all. The new point is marked as
                        a stop, so wherever it lands the destination stays
                        the destination. */}
                    <button
                      type="button"
                      className="jlink-add"
                      aria-label={`Add a stop between ${place(p.place)?.s || L.label} and ${place(draft.points[i + 1]?.place)?.s || pointLabel(draft, i + 1).label}`}
                      onClick={() => edit(d => addStop(d, i, ctxOf(snap)))}
                    >
                      <TeIcon name="plus" size="sm" />Stop
                    </button>
                  </span>
                ) : null}
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* ── THE EDITOR, under the strip and never inside it ── */}
      {openIndex >= 0 ? (
        <PointPanel
          snap={snap} draft={draft} issues={issues} i={openIndex} tried={!!tried}
          preview={preview} local={local} edit={edit} onPick={onPick} onClose={() => edit({ open: null })}
        />
      ) : (
        <p className="small muted">Tap a place above to set it, its type and its dates.</p>
      )}

      {err('pr') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('pr')}</div> : null}

      {/* THE MAP, WHILE THE ROUTE IS BEING BUILT, not only on Review. Seeing
          the shape of the trip appear as places are chosen is how somebody
          notices they picked the Pune in the wrong state — which is a money
          error, because every kilometre on the claim is measured between these
          points. It sits under the editor rather than above the strip: the
          strip is now the thing you read first, and a 190px map between the
          dates and the route pushed the route itself off a laptop screen. */}
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
    </div>
  )
}

/** One place, opened for editing. Defined outside the parent, or it would
 *  remount on every keystroke and drop focus out of the "what you will do
 *  there" field. */
function PointPanel({ snap, draft, issues, i, tried, preview, local, edit, onPick, onClose }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  i: number
  tried: boolean
  preview: TripPreview | null
  local: boolean
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  onPick: (t: PickTarget) => void
  onClose: () => void
}) {
  const p = draft.points[i]
  if (!p) return null
  const L = pointLabel(draft, i)
  const key = `p${i}`
  const place = (id: string) => snap.masters.places.find(q => q.id === id) ?? null
  const lockRet = !!p.ret && draft.retSame
  const pc = place(lockRet ? draft.points[0].place : p.place)
  const err = (k: string) => errorFor(issues, k, tried)
  const arrive = (() => {
    const legs = preview?.legs ?? []
    return p.place ? legs.find(l => l.to === p.place)?.date ?? '' : ''
  })()
  const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'
  const title = pickTitle(i, p.ret, draft.pattern)
  const placeShort = pc?.s ?? ''
  /** What the plan would assume if the arrival is left blank: the day you
   *  leave the place before. Shown so a blank field is not a mystery. */
  const derived = i > 0 ? (draft.points[i - 1]?.leave || draft.points[i - 1]?.arrive || '') : ''

  return (
    <div className="jpanel">
      <div className="jpanel-h">
        {i === 0 ? <span className="mk a">A</span>
          : L.isStop ? <span className="mk s">{L.no}</span>
            : <span className="mk b"><TeIcon name="flag" size="sm" /></span>}
        <h5>{L.label}</h5>
        <span className="grow" />
        {i > 0 && !p.ret && L.destinations.length > 1 ? (
          <>
            <button type="button" className="btn sm" disabled={i <= 1} aria-label={`Move ${L.label} earlier`} onClick={() => edit(d => movePoint(d, i, -1, ctxOf(snap)))}><TeIcon name="back" size="sm" />Earlier</button>
            <button type="button" className="btn sm" disabled={i >= L.last} aria-label={`Move ${L.label} later`} onClick={() => edit(d => movePoint(d, i, 1, ctxOf(snap)))}><TeIcon name="go" size="sm" />Later</button>
          </>
        ) : null}
        <button type="button" className="btn sm pri" onClick={onClose}><TeIcon name="check" size="sm" />Done</button>
      </div>

      {p.ret ? (
        <label className="check small">
          <input type="checkbox" checked={draft.retSame} onChange={e => edit({ retSame: e.target.checked })} />
          <span>Same as the start</span>
        </label>
      ) : null}

      {lockRet ? null : (
        <div className="loc">
          <button type="button" className="locb" onClick={() => onPick({ kind: 'point', index: i, title, intl: draft.scope === 'international' && i > 0 && !p.ret })}>
            <span className="ico-b sm"><TeIcon name="pin" size="sm" /></span>
            <span className="grow">
              <small>{locLabel(i, !!p.ret, L.isStop, draft.scope === 'international')}</small>
              {pc ? <><b>{pc.s}</b><span className="ad">{pc.addr || pc.name}</span></> : <b className="ph0">{placeholder}</b>}
            </span>
            <TeIcon name="rightc" size="sm" />
          </button>
          <div className="locx">
            <button type="button" className="link small" onClick={() => onPick({ kind: 'point', index: i, title, useGps: true })}>
              <TeIcon name="target" size="sm" />Use my current location
            </button>
            <button type="button" className="link small" onClick={() => onPick({ kind: 'point', index: i, title, address: true, intl: draft.scope === 'international' && i > 0 && !p.ret })}>
              <TeIcon name="pin" size="sm" />Enter the address
            </button>
          </div>
        </div>
      )}
      {err(key) ? <div className="ferr"><TeIcon name="warn" size="sm" />{err(key)}</div> : null}

      {pc && !lockRet ? (
        <div className="jp-grid">
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
                min={p.arrive || arrive || undefined}
                onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, leave: e.target.value } : q)) }))}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {/* ── WHEN YOU ARE HERE ──
          The arrival used to be derived from the previous departure and never
          asked. That is wrong for anything that travels overnight — a train
          out on the 2nd lands on the 3rd — and it left the Travel Desk with
          no idea when somebody actually wants to be somewhere.

          Typed answers win; blank ones still fall back to the old guess, so
          a trip that answers none of this behaves exactly as it did. The
          first point has no arrival (you start there) and the return point's
          departure is the end of the trip, so neither is asked. */}
      {pc && !lockRet ? (
        <div className="prefbox">
          <div className="pref-h">
            <TeIcon name="clock" size="sm" />
            <b>When you are {placeShort || 'here'}</b>
            <span className="chip plain">Optional</span>
          </div>
          <p className="small muted">
            {i === 0
              ? 'The time you set off. The date is above.'
              : p.ret
                ? 'When you are back. The date is on the Route panel above.'
                : derived
                  ? `Left blank, the plan assumes you arrive ${day(derived)} — the day you leave the place before.`
                  : 'Say when you reach here and when you move on.'}
          </p>
          <div className="jp-grid">
            {i > 0 ? (
              <label className="fld sm">
                <span>Reach on</span>
                <input
                  type="date"
                  value={p.arrive || ''}
                  onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, arrive: e.target.value } : q)) }))}
                />
                <small>{derived && !p.arrive ? `Assumed ${day(derived)}` : ' '}</small>
              </label>
            ) : null}
            {i > 0 ? (
              <label className="fld sm">
                <span>Reach at</span>
                <input
                  type="time"
                  value={p.arriveAt || ''}
                  onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, arriveAt: e.target.value } : q)) }))}
                />
              </label>
            ) : null}
            {!p.ret ? (
              <label className="fld sm">
                <span>{i === 0 ? 'Set off at' : 'Move on at'}</span>
                <input
                  type="time"
                  value={p.leaveAt || ''}
                  onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, leaveAt: e.target.value } : q)) }))}
                />
              </label>
            ) : null}
          </div>
          <div className="jp-grid">
            <label className="fld sm">
              <span>Note for the Travel Desk</span>
              <input
                value={p.prefNote ?? ''}
                placeholder="Late check-in; the client office shuts at 6"
                onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, prefNote: e.target.value } : q)) }))}
              />
            </label>
            <label className="fld sm">
              <span>Link</span>
              <input
                value={p.prefUrl ?? ''}
                placeholder="https://…"
                onChange={e => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, prefUrl: e.target.value } : q)) }))}
              />
              {badUrl(p.prefUrl ?? '')
                ? <small className="bad">That does not look like a web address. Paste the whole link, starting with https://</small>
                : <small>The hotel, the venue, anything about this place.</small>}
            </label>
          </div>
        </div>
      ) : null}
      {i > 0 && err(`d${i}`) ? <div className="ferr"><TeIcon name="warn" size="sm" />{err(`d${i}`)}</div> : null}
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
