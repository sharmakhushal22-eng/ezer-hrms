// src/features/expenses/leg/LegLive.tsx — the journey recorder (components/te/leg/TeLegLive.tsx,
// screens 55-58): Start / check in, the live tiles, Add a stop, End this journey,
// Continue after a stop.
//
// FOREGROUND ONLY, as on the website: fixes are collected while this screen is open
// (leg/gps.ts watchFixes) into the same queue lib/te/leg-tracking.ts manages, flushed
// in batches of 200, every 15 s, and when the app goes to the background (the web's
// `pagehide`). The leg is passed in fresh from the snapshot on every render
// (LegScreen), so after Start / Stop the screen changes state at once — the web's
// stale-leg defect (spec Part 4) is not copied.
import * as React from 'react'
import { AppState, Pressable, View } from 'react-native'
import type { GpsPing, Snapshot, TeLeg } from '@web/te/types'
import {
  acceptFix, isGap, mergePings, readQueue, shouldFlush, silentMinutes, trailKm, withoutSent, writeQueue, type TrackRules,
} from '@web/te/leg-tracking'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, te } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, Note, TeCard } from '../ui/kit'
import { SelectField } from '../plan/parts'
import { CardHead, Tile, Tiles } from '../trip/parts'
import { hydrateQueue, here, locationRefused, pingOf, pingStore, watchFixes } from './gps'
import { LegHead } from './LegHead'

export function LegLive({ snap, leg, placeName, onEnded, onChanged, onNotRecorded }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onEnded: () => void
  onChanged: (message: string) => void
  /** Spec Part 4 fix: a planned journey that was not recorded can say so from here. */
  onNotRecorded?: () => void
}) {
  const { C } = useTheme()
  const rules = snap.cfg.track as TrackRules & { gapMin?: number }
  const running = leg.status === 'ACTIVE'
  const paused = leg.status === 'PAUSED'

  const [trail, setTrail] = React.useState<GpsPing[]>([])
  const [sentCount, setSentCount] = React.useState(0)
  const [lastFixAt, setLastFixAt] = React.useState<string | null>(null)
  const [denied, setDenied] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [stopping, setStopping] = React.useState(false)
  const [stopReason, setStopReason] = React.useState('')
  const [stopNote, setStopNote] = React.useState('')
  const [now, setNow] = React.useState(() => Date.now())

  const buffer = React.useRef<GpsPing[]>([])
  const lastSent = React.useRef(0)
  const sending = React.useRef(false)

  /** Send what is queued; never overlaps itself; removes only what the server confirmed. */
  const flush = React.useCallback(async () => {
    if (sending.current) return
    const queued = readQueue(leg.id, pingStore)
    if (!queued.length) return
    sending.current = true
    try {
      const batch = queued.slice(0, 200)
      await te.legPings(leg.id, batch)
      const left = withoutSent(queued, batch)
      writeQueue(leg.id, left, pingStore)
      setTrail(left)
      setSentCount(n => n + batch.length)
      lastSent.current = Date.now()
      setError('')
    } catch {
      // Kept in the queue; the next flush tries again.
    } finally {
      sending.current = false
    }
  }, [leg.id])

  // What a previous session left in the queue, and whether location is already refused.
  React.useEffect(() => {
    let live = true
    void hydrateQueue(leg.id).then(() => { if (live) setTrail(readQueue(leg.id, pingStore)) })
    void locationRefused().then(r => { if (live && r) setDenied(true) })
    return () => { live = false }
  }, [leg.id])

  // The watcher, only while the journey is running.
  React.useEffect(() => {
    if (!running) return
    let stop: (() => void) | null = null
    let live = true
    void watchFixes(l => {
      const fix = pingOf(l)
      if (!acceptFix(fix, rules)) return
      buffer.current = [...buffer.current, fix]
      const merged = mergePings(readQueue(leg.id, pingStore), [fix])
      writeQueue(leg.id, merged, pingStore)
      setTrail(merged)
      setLastFixAt(fix.recorded_at)
      if (shouldFlush(buffer.current.length, lastSent.current, Date.now(), rules)) {
        buffer.current = []
        void flush()
      }
    }).then(s => {
      if (!live) { s?.(); return }
      if (!s) setDenied(true)
      stop = s
    }).catch(() => { if (live) setDenied(true) })
    return () => { live = false; stop?.() }
  }, [running, rules, leg.id, flush])

  // The clock for "n minutes ago", and a flush every 15 s.
  React.useEffect(() => {
    if (!running) return
    const t = setInterval(() => { setNow(Date.now()); void flush() }, 15000)
    return () => clearInterval(t)
  }, [running, flush])

  // The web's pagehide / online: send what is queued when the app leaves the foreground.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', () => { void flush() })
    return () => sub.remove()
  }, [flush])

  async function run(what: string, go: () => Promise<string>) {
    setBusy(what); setError('')
    try { onChanged(await go()) } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  const quiet = silentMinutes(lastFixAt, now)
  const gap = isGap(lastFixAt, now, rules)
  const km = trailKm(trail)
  const stopReasons = snap.cfg.stopReasons.filter(r => r.on)
  const modeName = snap.cfg.modes.find(m => m.id === leg.mode)?.name ?? leg.mode

  return (
    <View>
      <LegHead live={running} eyebrow={`Journey ${leg.n}`} title={`${placeName(leg.from)} → ${placeName(leg.to)}`} sub={modeName}
        chips={<>
          <Chip plain tone="t-brand" icon="route" label={leg.gps === 'checkin' ? 'Check-ins' : 'GPS tracked'} />
          <Chip tone={running ? 't-pos' : paused ? 't-warn' : 'plain'} label={running ? 'Travelling now' : paused ? 'Stopped' : 'Not started'} />
        </>} />

      {running ? (
        <Note style={{ marginBottom: S.md }}>
          Keep this screen open. The phone stops reading location when the screen locks or you switch apps, and those minutes are missing from the trail.
        </Note>
      ) : null}

      {denied ? (
        <Flag tone="crit" title="Location is switched off for this app" style={{ marginBottom: S.md }}>
          Nothing is being recorded. Turn location on for this app and open the journey again, or end the journey and add it without GPS — your approver sees the reason either way.
        </Flag>
      ) : null}

      {running && gap ? (
        <Flag tone="warn" title={`No new position for ${quiet} minutes`} style={{ marginBottom: S.md }}>
          If the phone was locked or another app was in front, those minutes are a gap in the trail and your approver will see it.
        </Flag>
      ) : null}

      {error && leg.status !== 'PLANNED' ? <Flag tone="crit" style={{ marginBottom: S.md }}>{error}</Flag> : null}

      <Tiles>
        <Tile label="Distance so far" value={`${km} km`} note="an estimate from this phone" />
        <Tile label="Points recorded" value={String(trail.length + sentCount)} note={`${trail.length} waiting to send`} />
        <Tile label="Last position" value={lastFixAt ? `${quiet} min ago` : '—'} note={running ? 'while this screen is open' : 'not recording'} />
      </Tiles>

      {running ? (
        stopping ? (
          <TeCard>
            <CardHead title="Why are you stopping?" />
            <SelectField label="Reason" value={stopReason} placeholder="Choose a reason" onPick={setStopReason}
              options={stopReasons.map(r => ({ value: r.id, label: r.name }))} />
            <Input label="Note" value={stopNote} onChangeText={setStopNote} placeholder="Optional" />
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <Button style={{ flex: 1 }} variant="outline" title="Never mind" onPress={() => setStopping(false)} />
              <Button style={{ flex: 1 }} title={busy === 'stop' ? 'Recording…' : 'Record the stop'} disabled={!stopReason || busy === 'stop'}
                onPress={() => void run('stop', async () => {
                  const at = await here()
                  await te.legStop(leg.id, { reason_code: stopReason, note: stopNote || undefined, ...at })
                  setStopping(false); setStopReason(''); setStopNote('')
                  return 'Stop recorded. The clock is paused.'
                })} />
            </View>
          </TeCard>
        ) : (
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button style={{ flex: 1 }} variant="outline" title="Add a stop" icon={<TeIcon name="pin" size="sm" color={C.brandDeep} />} onPress={() => setStopping(true)} />
            <Button style={{ flex: 1 }} title={busy === 'end' ? 'Ending…' : 'End this journey'} disabled={busy === 'end'}
              onPress={() => void run('end', async () => {
                await flush()
                const fix = await here()
                const r = await te.legEnd(leg.id, fix)
                writeQueue(leg.id, [], pingStore)
                onEnded()
                return `Journey ${leg.n} ended. ${r.gps_km} km recorded.`
              })} />
          </View>
        )
      ) : null}

      {paused ? (
        <Button full title={busy === 'continue' ? 'Starting…' : 'Continue the journey'} disabled={busy === 'continue'}
          icon={<TeIcon name="play" size="sm" color={C.onAccent} />}
          onPress={() => void run('continue', async () => { await te.legContinue(leg.id); return 'On the way again.' })} />
      ) : null}

      {leg.status === 'PLANNED' ? (
        <TeCard>
          <CardHead title={leg.gps === 'checkin' ? 'Check in to start' : 'Ready to start'} />
          <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>
            {leg.gps === 'checkin'
              ? 'Your position is recorded at both ends of this journey rather than along the way.'
              : 'Your position is recorded along the way until you end the journey. Keep this screen open while you travel.'}
          </Txt>
          {error ? <View style={{ marginBottom: S.md }}><Flag tone="crit">{error}</Flag></View> : null}
          <Button full size="lg" disabled={busy === 'start'} icon={<TeIcon name="play" size="sm" color={C.onAccent} />}
            title={busy === 'start' ? 'Reading your location…' : leg.gps === 'checkin' ? 'Check in and go' : 'Start this journey'}
            onPress={() => void run('start', async () => {
              const fix = await here()
              await te.legStart(leg.id, fix)
              return leg.gps === 'checkin' ? 'Checked in.' : `Journey ${leg.n} started. Keep this screen open.`
            })} />
          {onNotRecorded ? (
            <Pressable onPress={onNotRecorded} accessibilityRole="button" hitSlop={8} style={{ marginTop: S.md, minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Txt size={F.small} w={600} tone="brand">Not recorded? Add it without GPS, or skip it</Txt>
            </Pressable>
          ) : null}
        </TeCard>
      ) : null}
    </View>
  )
}
