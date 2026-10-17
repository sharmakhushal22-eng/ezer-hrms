'use client'
// components/te/start/TeStartNow.tsx — leaving now. Screens 30, 31, 32, 33.
//
// The planner in one form. Everything the three steps ask for is either
// already known or not needed when you are walking out of the door: the trip
// is local, it is today, and it starts where the phone is standing. So the
// form asks where you are going, why, and who with — and then creates the
// trip and starts its first leg in one go.
//
// It shares lib/te/trip-draft.ts with the planner, so the route keeps the same
// shape and the same server call checks it. What is different is the start
// point: read from GPS on open rather than defaulted to the office.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TripIssue, TripPreview, Uuid } from '@/lib/te/types'
import {
  newPlannerDraft, setPattern, syncDraft, toTripDraft, PURPOSES,
  type DraftContext, type PlannerDraft,
} from '@/lib/te/trip-draft'
import { errorText, plural, rs } from '@/lib/te/format'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePlacePicker, { type PickTarget } from '../plan/TePlacePicker'

export default function TeStartNow({ snap, onClose, onStarted, onPlaceAdded }: {
  snap: Snapshot
  onClose: () => void
  /** The trip exists and its first leg is running. */
  onStarted: (tripId: Uuid, legId: Uuid, message: string) => void
  /** A place was created inside the picker, so the snapshot this screen is
   *  holding does not know it yet and would name the point "—". The host
   *  refetches WITHOUT closing: the half-filled form lives in here. */
  onPlaceAdded?: () => void
}) {
  const ctx = useMemo<DraftContext>(() => ({
    today: snap.today,
    officePlace: snap.masters.places.find(p => p.pt === 'corp')?.id ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }), [snap])

  const [draft, setDraft] = useState<PlannerDraft>(() =>
    newPlannerDraft({ scope: 'local', origin: 'PRE_APPROVED', lastWorkday: snap.today }, ctx))
  const [preview, setPreview] = useState<TripPreview | null>(null)
  const [picking, setPicking] = useState<PickTarget | null>(null)
  const [locating, setLocating] = useState(true)
  const [whereFrom, setWhereFrom] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  const edit = useCallback((patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => {
    setDraft(d => syncDraft(typeof patch === 'function' ? patch(d) : { ...d, ...patch }, ctx))
  }, [ctx])

  // Where the phone is, right now. Deferred out of the effect body because it
  // sets state; the whole screen is about starting from here, so it is asked
  // for on open rather than behind a button.
  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        setLocating(false); setWhereFrom('This device cannot read its location. Choose where you are starting from.')
        return
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          te.placeAdd({ src: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
            .then(r => {
              edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, place: r.place_id, pt: p.pt || 'other' } : p)) }))
              setWhereFrom(`GPS ±${Math.round(pos.coords.accuracy)} m · your location now`)
            })
            .catch(e => setWhereFrom(errorText(e)))
            .finally(() => setLocating(false))
        },
        () => { setLocating(false); setWhereFrom('Could not read your location. Choose where you are starting from.') },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      )
    }, 0)
    return () => clearTimeout(t)
  }, [edit])

  const payload = useMemo(() => toTripDraft(draft), [draft])
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      te.tripPreview(payload).then(p => { if (current) setPreview(p) }).catch(() => { if (current) setPreview(null) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [payload])

  const issues: TripIssue[] = preview?.issues ?? []
  const err = (k: string) => (tried ? issues.find(i => i.block && i.k === k)?.t ?? '' : '')
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const hasReturn = draft.points.some(p => p.ret)
  const legs = preview?.legs ?? []

  async function start() {
    if (!preview) { setError('Checking the trip…'); return }
    const blocking = issues.filter(i => i.block)
    if (blocking.length) {
      setTried(true)
      setError(blocking.length === 1 ? blocking[0].t : `${blocking.length} things to fill. They are marked in red.`)
      return
    }
    setBusy('start'); setError('')
    try {
      const saved = await te.tripSave(payload)
      // tripSave answers with the trip, not its legs, so the trip is read back
      // to find leg 1 — which is also the server's own idea of which is first.
      const detail = await te.trip(saved.trip_id)
      const first = [...detail.legs].sort((a, b) => a.n - b.n)[0]
      if (!first) { onStarted(saved.trip_id, '', `${saved.trip_no} created, but it has no journeys to start.`); return }
      const fix = await currentFix()
      await te.legStart(first.id, fix)
      onStarted(saved.trip_id, first.id, `${saved.trip_no} started. Keep the journey screen open while you travel.`)
    } catch (e) {
      setError(errorText(e)); setBusy('')
    }
  }

  if (picking) {
    return (
      <TePlacePicker
        snap={snap}
        target={picking}
        onCancel={() => setPicking(null)}
        onPlaceAdded={onPlaceAdded}
        onChosen={(placeId, pt) => {
          const at = picking
          setPicking(null)
          edit(d => ({ ...d, points: d.points.map((p, i) => (i === (at.kind === 'point' ? at.index : -1) ? { ...p, place: placeId, pt: pt || p.pt } : p)) }))
        }}
      />
    )
  }

  const footer = (
    <>
      <div className="tw-bar">
        {legs.length
          ? <><b>{plural(legs.length, 'leg')}</b>{` · ${Math.round(legs.reduce((a, l) => a + l.km, 0) * 10) / 10} km`}{preview?.estimateTotal ? <> · <b>{rs(preview.estimateTotal)}</b> est.</> : null}</>
          : <span className="muted">Choose where you are going</span>}
      </div>
      <div className="row tight">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn pri" disabled={busy === 'start'} onClick={start}>
          <TeIcon name="play" size="sm" />{busy === 'start' ? 'Starting…' : 'Start and go'}
        </button>
      </div>
    </>
  )

  return (
    <TeSheet
      wide
      title="Start a local trip"
      lead="Your phone records each journey from now until you are back."
      crumb={<span className="fpath"><span className="fstep">Step 3 of 3</span>Local trip<span className="muted"> › </span>Start now</span>}
      onClose={onClose}
      footer={footer}
    >
      <div className="sec namefirst">
        <label className="fld full tn">
          <span>Trip name</span>
          <input
            value={draft.name}
            maxLength={60}
            autoComplete="off"
            placeholder="Like Udyog Vihar client meeting"
            onChange={e => edit({ name: e.target.value, nameTouched: !!e.target.value.trim() })}
          />
        </label>
        <small className="muted">{draft.nameTouched ? 'Your own name for the trip.' : 'Leave it empty and it is named from the place and the reason.'}</small>
        {err('name') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('name')}</div> : null}
      </div>

      <div className="sec">
        <div className="row sp">
          <h4>Where</h4>
          <div className="seg sm" role="group" aria-label="Way back">
            <button type="button" aria-pressed={!hasReturn} onClick={() => edit(d => setPattern(d, 'oneway', ctx))}><TeIcon name="go" size="sm" />One way</button>
            <button type="button" aria-pressed={hasReturn} onClick={() => edit(d => setPattern(d, 'round', ctx))}><TeIcon name="swap" size="sm" />Round trip</button>
          </div>
        </div>

        <div className="rlist q">
          {draft.points.map((p, i) => {
            const pc = place(p.place)
            const isStart = i === 0
            const isReturn = !!p.ret
            // The return mirrors the start and is not chosen separately here —
            // Start now is a there-and-back shape, not a route planner.
            return (
              <div key={i} className="rrow">
                <div className="rline">
                  <span className={isStart || isReturn ? 'mk a' : 'mk b'}>{isStart || isReturn ? 'A' : 'B'}</span>
                  <button
                    type="button"
                    className="rhead"
                    disabled={isReturn}
                    onClick={() => setPicking({ kind: 'point', index: i, title: isStart ? 'Where you are starting from' : 'Where you are going' })}
                  >
                    <span className="rtx">
                      <small>{isStart ? 'Start' : isReturn ? 'Back to' : 'Destination'}</small>
                      <b>{pc ? pc.s : <span className="ph0">{isStart ? (locating ? 'Reading your location…' : 'Choose where you start') : 'Choose where you go'}</span>}</b>
                      {isStart && whereFrom ? <span className="rsub"><TeIcon name="target" size="sm" />{whereFrom}</span> : null}
                      {isReturn ? <span className="rsub">Same as the start</span> : null}
                    </span>
                    {isReturn ? null : <TeIcon name="rightc" size="sm" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {err('p0') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('p0')}</div> : null}
        {err('p1') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('p1')}</div> : null}
      </div>

      <div className="sec">
        <h4>Why</h4>
        <div className="opts">
          {PURPOSES.map(p => (
            <button key={p} type="button" className="opt" aria-pressed={draft.purpose === p} onClick={() => edit({ purpose: p })}>{p}</button>
          ))}
        </div>
        {err('purpose') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('purpose')}</div> : null}
        {/* Leaving now is the most hurried way into the module, which is all
            the more reason an unexplained Other must not get through it. */}
        {needsExplanation(draft.purpose) ? (
          <div className="form">
            <label className="fld full">
              <span>{whyLabel('purpose').label}</span>
              <textarea
                autoFocus
                value={draft.purposeNote}
                placeholder="Supplier arbitration hearing in Indore"
                onChange={e => edit({ purposeNote: e.target.value })}
              />
              <small>{whyLabel('purpose').hint}</small>
            </label>
            {draft.tried && whyProblem(draft.purpose, draft.purposeNote)
              ? <div className="ferr"><TeIcon name="warn" size="sm" />{whyProblem(draft.purpose, draft.purposeNote)}</div>
              : null}
          </div>
        ) : null}
      </div>

      {/* How you travel: one choice for the whole trip, because a local there
          and back is almost always the same way out and back. */}
      <div className="sec">
        <h4>How</h4>
        <div className="rs-modes" role="group" aria-label="How you travel">
          {snap.cfg.modes.filter(m => m.on && m.scopes.includes('local')).map(m => (
            <button
              key={m.id}
              type="button"
              className="mchip"
              aria-pressed={draft.segs[0]?.mode === m.id}
              onClick={() => edit(d => ({ ...d, segs: d.segs.map(s => ({ ...s, mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })) }))}
            >
              <TeIcon name={m.id === 'train' ? 'train' : m.id === 'public' || m.id === 'bus' ? 'bus' : 'car'} size="sm" />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
        {err('m0') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('m0')}</div> : null}
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="note">
        <TeIcon name="info" size="sm" />
        <span>Keep the next screen open while you travel. A phone browser stops reading location when the screen locks or you switch apps.</span>
      </div>
    </TeSheet>
  )
}

/** A fresh position, for starting the first leg. */
function currentFix(): Promise<{ lat: number; lng: number; accuracy_m?: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { reject(new Error('This device cannot read its location.')); return }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }),
      () => reject(new Error('Could not read your location. Check that location is on, then try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
