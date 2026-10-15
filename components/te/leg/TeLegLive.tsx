'use client'
// components/te/leg/TeLegLive.tsx — recording a leg. Screens 55, 56, 57, 58.
//
// THE HONEST LIMITATION, STATED ON THE SCREEN
//   A phone browser stops reading location when the screen locks or another
//   app comes forward. Not less often — it stops. So this screen asks to be
//   left open, and tells the person as soon as the trail goes quiet, rather
//   than letting them find out when the server flags a gap they cannot
//   explain. A native wrapper is the real fix and is outside this module;
//   everything here is written so that swapping the source of fixes for one
//   is a change in one place.
//
// WHAT IS WHOSE
//   Every fix goes into localStorage the moment it arrives and is removed only
//   when the server has acknowledged it, so a closed tab or a flat battery
//   does not lose the trail (lib/te/leg-tracking.ts, tested).
//   The distance on screen is a running estimate from the fixes this device is
//   holding. The distance that gets PAID is recomputed by the server from what
//   it stored, and arrives in the answer to legEnd.
import { useCallback, useEffect, useRef, useState } from 'react'
import { te } from '@/lib/te/client'
import type { GpsPing, Snapshot, TeLeg, TeLegStats } from '@/lib/te/types'
import {
  acceptFix, isGap, mergePings, readQueue, shouldFlush, silentMinutes, toPing,
  trailKm, withoutSent, writeQueue, type PingStore, type TrackRules,
} from '@/lib/te/leg-tracking'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'

/** localStorage, when the browser allows it. */
function store(): PingStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null   // private mode, or site data blocked
  }
}

export default function TeLegLive({ snap, leg, placeName, onBack, onEnded, onChanged }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onBack: () => void
  /** The leg ended; its report is next. The server's own numbers come with it. */
  onEnded: (stats: TeLegStats) => void
  onChanged: (message: string) => void
}) {
  const rules = snap.cfg.track as TrackRules & { gapMin?: number }
  const running = leg.status === 'ACTIVE'
  const paused = leg.status === 'PAUSED'

  const [trail, setTrail] = useState<GpsPing[]>([])
  const [sentCount, setSentCount] = useState(0)
  const [lastFixAt, setLastFixAt] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [stopping, setStopping] = useState(false)
  const [stopReason, setStopReason] = useState('')
  const [stopNote, setStopNote] = useState('')
  // Set by the clock effect below; reading the wall clock during render is
  // impure, and 0 simply means "no fix has been timed yet".
  const [now, setNow] = useState(0)

  // Everything the watcher needs without re-subscribing when it changes.
  const buffer = useRef<GpsPing[]>([])
  // 0 means nothing has been sent yet, so the first fix goes straight out
  // rather than waiting a full interval. Also keeps render pure.
  const lastSent = useRef<number>(0)
  const sending = useRef(false)

  /** Send what is queued. Safe to call often: it will not overlap itself, and
   *  it removes only what the server confirmed. */
  const flush = useCallback(async () => {
    if (sending.current) return
    const queued = readQueue(leg.id, store())
    if (!queued.length) return
    sending.current = true
    try {
      const batch = queued.slice(0, 200)
      await te.legPings(leg.id, batch)
      const left = withoutSent(queued, batch)
      writeQueue(leg.id, left, store())
      setTrail(left.length ? left : [])
      setSentCount(n => n + batch.length)
      lastSent.current = Date.now()
      setError('')
    } catch {
      // Offline, or the server refused. The queue is untouched, so the fixes
      // go with the next attempt. This is the expected case in a tunnel and
      // is not worth shouting about.
    } finally {
      sending.current = false
    }
  }, [leg.id])

  // Whatever a previous session left behind: a closed tab, a flat battery, a
  // reload halfway up a motorway. Done on mount rather than during render,
  // because reading storage is not a pure thing to do while rendering.
  useEffect(() => {
    const t = setTimeout(() => {
      setTrail(readQueue(leg.id, store()))
      // Start the clock here too, or "quiet for N minutes" is blind until the
      // first tick fifteen seconds in.
      setNow(Date.now())
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) setDenied(true)
    }, 0)
    return () => clearTimeout(t)
  }, [leg.id])

  // The watcher. One subscription for as long as the leg is running.
  useEffect(() => {
    if (!running || typeof navigator === 'undefined' || !('geolocation' in navigator)) return

    const id = navigator.geolocation.watchPosition(
      pos => {
        const fix = toPing(pos)
        if (!acceptFix(fix, rules)) return
        buffer.current = [...buffer.current, fix]
        // Written before it is sent: the queue is what survives, not the request.
        const merged = mergePings(readQueue(leg.id, store()), [fix])
        writeQueue(leg.id, merged, store())
        setTrail(merged)
        setLastFixAt(fix.recorded_at)
        if (shouldFlush(buffer.current.length, lastSent.current, Date.now(), rules)) {
          buffer.current = []
          void flush()
        }
      },
      err => { if (err.code === err.PERMISSION_DENIED) setDenied(true) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [running, rules, leg.id, flush])

  // A clock, so "quiet for 4 minutes" counts up on its own, and a periodic
  // flush so a slow walk still reaches the server.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { setNow(Date.now()); void flush() }, 15000)
    return () => clearInterval(t)
  }, [running, flush])

  // Anything still queued when the screen closes gets one more chance.
  useEffect(() => {
    const send = () => { void flush() }
    window.addEventListener('online', send)
    window.addEventListener('pagehide', send)
    return () => { window.removeEventListener('online', send); window.removeEventListener('pagehide', send) }
  }, [flush])

  /** A fresh, accurate position — needed to end a leg or record a stop. */
  function here(): Promise<{ lat: number; lng: number; accuracy_m?: number }> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { reject(new Error('This device cannot read its location.')); return }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }),
        () => reject(new Error('Could not read your location. Check that location is on, then try again.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      )
    })
  }

  async function run(what: string, go: () => Promise<string>) {
    setBusy(what); setError('')
    try { onChanged(await go()) } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  const quiet = silentMinutes(lastFixAt, now)
  const gap = isGap(lastFixAt, now, rules)
  const km = trailKm(trail)
  const stopReasons = snap.cfg.stopReasons.filter(r => r.on)

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trip</button>
        <span className="mono muted">Journey {leg.n}</span>
      </div>

      <div className={running ? 'card live' : 'card'}>
        <div className="row sp top">
          <div>
            <div className="eyebrow">Journey {leg.n}</div>
            <h1 className="tname">{placeName(leg.from)} → {placeName(leg.to)}</h1>
            <p className="muted">{snap.cfg.modes.find(m => m.id === leg.mode)?.name ?? leg.mode}</p>
          </div>
          <div className="row tight">
            <span className="chip plain t-brand"><TeIcon name="route" size="sm" />{leg.gps === 'checkin' ? 'Check-ins' : 'GPS tracked'}</span>
            <span className={running ? 'chip t-pos' : paused ? 'chip t-warn' : 'chip plain'}>
              {running ? 'Travelling now' : paused ? 'Stopped' : 'Not started'}
            </span>
          </div>
        </div>
      </div>

      {/* The limitation, said plainly and before it bites. */}
      {running ? (
        <div className="note">
          <TeIcon name="info" size="sm" />
          <span>Keep this screen open. A phone browser stops reading location when the screen locks or you switch apps, and those minutes are missing from the trail.</span>
        </div>
      ) : null}

      {denied ? (
        <div className="flag crit">
          <TeIcon name="alert" />
          <div className="tx">
            <b>Location is switched off for this site</b>
            <p>Nothing is being recorded. Turn location on for this site and reload, or end the leg and add it without GPS — your approver sees the reason either way.</p>
          </div>
        </div>
      ) : null}

      {running && gap ? (
        <div className="flag warn">
          <TeIcon name="alert" />
          <div className="tx">
            <b>No new position for {quiet} minutes</b>
            <p>If the phone was locked or another app was in front, those minutes are a gap in the trail and your approver will see it.</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="g6 five">
        <Tile label="Distance so far" value={`${km} km`} note="an estimate from this phone" />
        <Tile label="Points recorded" value={String(trail.length + sentCount)} note={`${trail.length} waiting to send`} />
        <Tile label="Last position" value={lastFixAt ? `${quiet} min ago` : '—'} note={running ? 'while this screen is open' : 'not recording'} />
      </div>

      {/* ── a stop on the way ── (57, 58) */}
      {running ? (
        stopping ? (
          <div className="card">
            <div className="ch"><h3>Why are you stopping?</h3></div>
            <label className="fld">
              <span>Reason</span>
              <select value={stopReason} onChange={e => setStopReason(e.target.value)}>
                <option value="">Choose a reason</option>
                {stopReasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span>Note</span>
              <input value={stopNote} onChange={e => setStopNote(e.target.value)} placeholder="Optional" />
            </label>
            <div className="row tight">
              <button type="button" className="btn grow" onClick={() => setStopping(false)}>Never mind</button>
              <button
                type="button"
                className="btn pri grow"
                disabled={!stopReason || busy === 'stop'}
                onClick={() => run('stop', async () => {
                  const at = await here()
                  await te.legStop(leg.id, { reason_code: stopReason, note: stopNote || undefined, ...at })
                  setStopping(false); setStopReason(''); setStopNote('')
                  return 'Stop recorded. The clock is paused.'
                })}
              >
                {busy === 'stop' ? 'Recording…' : 'Record the stop'}
              </button>
            </div>
          </div>
        ) : (
          <div className="row tight">
            <button type="button" className="btn grow" onClick={() => setStopping(true)}><TeIcon name="pin" size="sm" />Add a stop</button>
            <button
              type="button"
              className="btn pri grow"
              disabled={busy === 'end'}
              onClick={() => run('end', async () => {
                // Send whatever is held BEFORE ending: the server stops
                // accepting pings for a leg once its report is saved, and the
                // last stretch is usually the one still in the queue.
                await flush()
                const fix = await here()
                const r = await te.legEnd(leg.id, fix)
                writeQueue(leg.id, [], store())
                onEnded(r.stats)
                return `Journey ${leg.n} ended. ${r.gps_km} km recorded.`
              })}
            >
              {busy === 'end' ? 'Ending…' : 'End this journey'}
            </button>
          </div>
        )
      ) : null}

      {paused ? (
        <button
          type="button"
          className="btn pri wide"
          disabled={busy === 'continue'}
          onClick={() => run('continue', async () => { await te.legContinue(leg.id); return 'On the way again.' })}
        >
          <TeIcon name="play" size="sm" />{busy === 'continue' ? 'Starting…' : 'Continue the journey'}
        </button>
      ) : null}

      {/* ── not started yet ── (55) */}
      {leg.status === 'PLANNED' ? (
        <div className="card">
          <div className="ch"><h3>{leg.gps === 'checkin' ? 'Check in to start' : 'Ready to start'}</h3></div>
          <p className="small muted">
            {leg.gps === 'checkin'
              ? 'Your position is recorded at both ends of this leg rather than along the way.'
              : 'Your position is recorded along the way until you end the leg. Keep this screen open while you travel.'}
          </p>
          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
          <button
            type="button"
            className="btn pri lg wide"
            disabled={busy === 'start'}
            onClick={() => run('start', async () => {
              // The server wants the position the leg began at, and checks it
              // against where the leg was supposed to begin.
              const fix = await here()
              await te.legStart(leg.id, fix)
              return leg.gps === 'checkin' ? 'Checked in.' : `Journey ${leg.n} started. Keep this screen open.`
            })}
          >
            <TeIcon name="play" size="sm" />
            {busy === 'start' ? 'Reading your location…' : leg.gps === 'checkin' ? 'Check in and go' : 'Start this leg'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** One number on the live screen. Outside the parent so it is not remade on
 *  every GPS fix, which arrive every second or two. */
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="tile">
      <div className="l">{label}</div>
      <div className="v num">{value}</div>
      <div className="s">{note}</div>
    </div>
  )
}
