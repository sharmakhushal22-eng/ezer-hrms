// src/features/expenses/start/StartNowSheet.tsx — "Leaving now"
// (components/te/start/TeStartNow.tsx), the sheet route /expenses/start.
//
// The planner in one form: a local trip, today, starting where the phone is.
// It shares lib/te/trip-draft with the planner and the same live preview, then
// creates the trip and starts its first journey in one go.
//
// Deliberate departures from the website (each noted in the report):
//  · the footer says "journey(s)" (the web says "leg"; the UI rule is "journey");
//  · after onStarted the app reloads and then OPENS THE JOURNEY (spec Part 0.3
//    "RN improvement"; the web lands on the trip because its snapshot is stale);
//  · the GPS start place gets its name at once: reloadTe() after te.placeAdd
//    (the web shows "Choose where you start" until the next reload);
//  · if the trip was saved but its first journey refused to start (e.g. "The
//    trip is waiting for approval."), a second tap on "Start and go" with the
//    same draft retries the start instead of creating a second trip, and the
//    module is reloaded so the new trip shows in the lists;
//  · the start fix carries is_mock and device (Part 4 "Known defects" 6).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { GpsFix, Snapshot, Uuid } from '@web/te/types'
import { newPlannerDraft, PURPOSES, setPattern, syncDraft, toTripDraft, type DraftContext, type PlannerDraft } from '@web/te/trip-draft'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText, plural, rs, te } from '../api'
import { reloadTe, useSignedIn, useSnap } from '../data'
import { close, swap, teHref } from '../nav'
import { TeIcon } from '../ui/TeIcon'
import { H4, Note, Opt, Seg } from '../ui/kit'
import { TeSheet } from '../ui/TeSheet'
import { SnapState } from '../ui/TeScreen'
import { Crumb, Ferr, Mk, ModeChip, Sec } from '../plan/parts'
import { deviceInfo, GpsError, readPosition } from '../plan/gps'
import { PlacePicker, type PickTarget } from '../plan/PlacePicker'
import { useTripPreview } from '../plan/usePreview'

const GPS_TIMEOUT = 20000

/** A fresh position for starting the first journey (TeStartNow.currentFix). */
async function currentFix(): Promise<GpsFix> {
  try {
    const p = await readPosition(GPS_TIMEOUT)
    return {
      lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy ?? undefined,
      is_mock: !!p.mocked, device: deviceInfo(),
    }
  } catch (e) {
    throw new Error(e instanceof GpsError && e.kind === 'nodevice'
      ? 'This device cannot read its location.'
      : 'Could not read your location. Check that location is on, then try again.')
  }
}

const modeIco = (id: string) => (id === 'train' ? 'train' : id === 'public' || id === 'bus' ? 'bus' : 'car')

function PointLine({ i, label, title, placeholder, sub, subIcon, disabled, onPress }: {
  i: number; label: string; title: string | null; placeholder: string; sub?: string; subIcon?: boolean; disabled?: boolean; onPress: () => void
}) {
  const { C } = useTheme()
  const ret = disabled
  return (
    <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.brandTint : C.surface })}>
      <Mk kind={i === 0 || ret ? 'a' : 'b'} label={i === 0 || ret ? 'A' : 'B'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.micro} tone="muted">{label}</Txt>
        {title ? <Txt size={F.small} w={700} numberOfLines={1}>{title}</Txt> : <Txt size={F.small} w={600} tone="faint">{placeholder}</Txt>}
        {!!sub && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {subIcon && <TeIcon name="target" px={12} color={C.muted} />}
            <Txt size={F.micro} tone="muted" style={{ flexShrink: 1 }}>{sub}</Txt>
          </View>
        )}
      </View>
      {!ret && <TeIcon name="rightc" size="sm" color={C.muted} />}
    </Pressable>
  )
}

function StartNow({ snap, onStarted }: { snap: Snapshot; onStarted: (tripId: Uuid, legId: Uuid, message: string) => void }) {
  const { C } = useTheme()
  const signedIn = useSignedIn()
  const ctx = React.useMemo<DraftContext>(() => ({
    today: snap.today,
    officePlace: snap.masters.places.find(p => p.pt === 'corp')?.id ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }), [snap])

  const [draft, setDraft] = React.useState<PlannerDraft>(() =>
    newPlannerDraft({ scope: 'local', origin: 'PRE_APPROVED', lastWorkday: snap.today }, ctx))
  const [picking, setPicking] = React.useState<PickTarget | null>(null)
  const [locating, setLocating] = React.useState(true)
  const [whereFrom, setWhereFrom] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const saved = React.useRef<{ key: string; tripId: Uuid; tripNo: string } | null>(null)

  const edit = React.useCallback((patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => {
    setDraft(d => syncDraft(typeof patch === 'function' ? patch(d) : { ...d, ...patch }, ctx))
  }, [ctx])

  // Where the phone is, right now — asked for on open.
  React.useEffect(() => {
    if (!signedIn) return
    let live = true
    void (async () => {
      let pos
      try {
        pos = await readPosition(GPS_TIMEOUT)
      } catch (e) {
        if (!live) return
        setLocating(false)
        setWhereFrom(e instanceof GpsError && e.kind === 'nodevice'
          ? 'This device cannot read its location. Choose where you are starting from.'
          : 'Could not read your location. Choose where you are starting from.')
        return
      }
      try {
        const r = await te.placeAdd({ src: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? undefined })
        await reloadTe()
        if (!live) return
        edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, place: r.place_id, pt: p.pt || 'other' } : p)) }))
        setWhereFrom(`GPS ±${Math.round(pos.coords.accuracy ?? 0)} m · your location now`)
      } catch (e) {
        if (live) setWhereFrom(errorText(e))
      } finally {
        if (live) setLocating(false)
      }
    })()
    return () => { live = false }
  }, [edit, signedIn])

  const payload = React.useMemo(() => toTripDraft(draft), [draft])
  const { preview } = useTripPreview(payload)
  const issues = preview?.issues ?? []
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
    setBusy(true); setError('')
    const key = JSON.stringify(payload)
    try {
      let trip = saved.current && saved.current.key === key ? saved.current : null
      if (!trip) {
        const r = await te.tripSave(payload)
        trip = { key, tripId: r.trip_id, tripNo: r.trip_no }
        saved.current = trip
      }
      const detail = await te.trip(trip.tripId)
      const first = [...detail.legs].sort((a, b) => a.n - b.n)[0]
      if (!first) { onStarted(trip.tripId, '', `${trip.tripNo} created, but it has no journeys to start.`); return }
      const fix = await currentFix()
      await te.legStart(first.id, fix)
      onStarted(trip.tripId, first.id, `${trip.tripNo} started. Keep the journey screen open while you travel.`)
    } catch (e) {
      setError(errorText(e)); setBusy(false)
      if (saved.current) void reloadTe()
    }
  }

  const cancelPick = React.useCallback(() => setPicking(null), [])
  if (picking) {
    return (
      <PlacePicker snap={snap} target={picking} onCancel={cancelPick}
        onChosen={(placeId, pt) => {
          const at = picking
          setPicking(null)
          edit(d => ({ ...d, points: d.points.map((p, i) => (i === (at.kind === 'point' ? at.index : -1) ? { ...p, place: placeId, pt: pt || p.pt } : p)) }))
        }} />
    )
  }

  const kmAll = Math.round(legs.reduce((a, l) => a + l.km, 0) * 10) / 10
  const footer = (
    <>
      {legs.length ? (
        <Txt size={F.tiny} tone="soft">
          <Txt size={F.tiny} w={700}>{plural(legs.length, 'journey')}</Txt>
          {` · ${kmAll} km`}
          {preview?.estimateTotal ? <>{' · '}<Txt size={F.tiny} w={700}>{rs(preview.estimateTotal)}</Txt>{' est.'}</> : null}
        </Txt>
      ) : <Txt size={F.tiny} tone="muted">Choose where you are going</Txt>}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={close} />
        <Button title={busy ? 'Starting…' : 'Start and go'} style={{ flex: 1.6 }} disabled={busy} onPress={() => void start()}
          icon={<TeIcon name="play" size="sm" color={C.onAccent} />} />
      </View>
    </>
  )

  return (
    <TeSheet title="Start a local trip" lead="Your phone records each journey from now until you are back."
      crumb={<Crumb kind="Local trip" way="Start now" />} onClose={close} footer={footer}>
      <Sec>
        <Input label="Trip name" value={draft.name} maxLength={60} autoComplete="off" placeholder="Like Udyog Vihar client meeting"
          onChangeText={v => edit({ name: v, nameTouched: !!v.trim() })} style={{ marginBottom: 4 }} />
        <Txt size={F.tiny} tone="muted">{draft.nameTouched ? 'Your own name for the trip.' : 'Leave it empty and it is named from the place and the reason.'}</Txt>
        <Ferr>{err('name')}</Ferr>
      </Sec>

      <Sec>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: S.sm, marginBottom: S.sm }}>
          <H4 style={{ marginTop: 0, marginBottom: 0 }}>Where</H4>
          <Seg label="Way back" value={hasReturn ? 'round' : 'oneway'}
            items={[{ key: 'oneway', label: 'One way', icon: 'go' }, { key: 'round', label: 'Round trip', icon: 'swap' }]}
            onChange={k => edit(d => setPattern(d, k, ctx))} />
        </View>
        <View style={{ gap: 6 }}>
          {draft.points.map((p, i) => {
            const pc = place(p.place)
            const isStart = i === 0
            const isReturn = !!p.ret
            return (
              <PointLine key={i} i={i} disabled={isReturn}
                label={isStart ? 'Start' : isReturn ? 'Back to' : 'Destination'}
                title={pc ? pc.s : null}
                placeholder={isStart ? (locating ? 'Reading your location…' : 'Choose where you start') : 'Choose where you go'}
                sub={isStart ? whereFrom : isReturn ? 'Same as the start' : undefined} subIcon={isStart}
                onPress={() => setPicking({ kind: 'point', index: i, title: isStart ? 'Where you are starting from' : 'Where you are going' })} />
            )
          })}
        </View>
        <Ferr>{err('p0')}</Ferr>
        <Ferr>{err('p1')}</Ferr>
      </Sec>

      <Sec>
        <H4 style={{ marginTop: 0 }}>Why</H4>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PURPOSES.map(p => <Opt key={p} label={p} on={draft.purpose === p} onPress={() => edit({ purpose: p })} />)}
        </View>
        <Ferr>{err('purpose')}</Ferr>
      </Sec>

      <Sec>
        <H4 style={{ marginTop: 0 }}>How</H4>
        <View accessibilityLabel="How you travel" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {snap.cfg.modes.filter(m => m.on && m.scopes.includes('local')).map(m => (
            <ModeChip key={m.id} icon={modeIco(m.id)} label={m.name} on={draft.segs[0]?.mode === m.id}
              onPress={() => edit(d => ({ ...d, segs: d.segs.map(s => ({ ...s, mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })) }))} />
          ))}
        </View>
        <Ferr>{err('m0')}</Ferr>
      </Sec>

      <Ferr icon="alert">{error}</Ferr>
      <Note style={{ marginTop: S.md }}>Keep the next screen open while you travel. A phone browser stops reading location when the screen locks or you switch apps.</Note>
    </TeSheet>
  )
}

export default function StartNowSheet() {
  const { notify } = useOverlay()
  const q = useSnap()
  const onStarted = React.useCallback(async (tripId: Uuid, legId: Uuid, msg: string) => {
    notify(msg)
    await reloadTe()
    // RN improvement (spec Part 0.3): after the reload the new journey is known, so open it.
    swap(legId ? teHref.leg(legId, tripId) : teHref.trip(tripId))
  }, [notify])
  if (!q.data) {
    return (
      <TeSheet title="Start a local trip">
        <SnapState error={q.error} onRetry={() => void q.refetch()} />
      </TeSheet>
    )
  }
  return <StartNow snap={q.data} onStarted={(t, l, m) => void onStarted(t, l, m)} />
}
