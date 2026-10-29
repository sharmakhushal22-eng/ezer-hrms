// src/features/expenses/legadd/AddLegSheet.tsx — a journey that was not planned
// (components/te/leg/TeLegAdd.tsx), the sheet route /expenses/add-leg?trip=<tripId>.
//
// THE GPS SUB-TRIP: a local hop at the destination, a detour, a ride back. Added
// here it stays inside the trip and is tracked and paid like any other journey.
// Since 4a92155 (website): the start is prefilled with where the last journey
// ended; the reason asks "why you are going"; "Add and start now" adds it and
// starts recording in one tap (the journey is kept even if the GPS then fails);
// with another journey recording only "Add for later" is offered.
//
// TeHome's contract: onAdded(legId, msg, {started}) → toast, reload, and either
// back to the trip or — when recording began — straight into the journey.
// reloadTe() refetches the open trip detail too, which fixes the web's stale
// trip screen after "Add a journey" (spec Part 4 "Known defects" 2).
import * as React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { Snapshot, TeTripDetail, Uuid } from '@web/te/types'
import { S } from '@/ui/theme'
import { Button, Input } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText, te } from '../api'
import { reloadTe, useSnap, useTripDetail } from '../data'
import { close, param, swap, teHref } from '../nav'
import { here } from '../leg/gps'
import { H4, Note } from '../ui/kit'
import { TeSheet } from '../ui/TeSheet'
import { SnapState } from '../ui/TeScreen'
import { Ferr, LocBtn, Mk, ModeChip, Sec, VChip } from '../plan/parts'
import { PlacePicker } from '../plan/PlacePicker'

const modeIco = (id: string) => (id === 'train' ? 'train' : id === 'public' || id === 'bus' ? 'bus' : id === 'flight' ? 'plane' : 'car')

const LEAD = 'A local hop at the destination, a detour, a ride back — anything on this trip that was not in the plan. It is recorded and paid like any other journey.'

/** Where the last journey left you, else the last place on the route (TeLegAdd startedAt). */
function startedAt(detail: TeTripDetail): string {
  const done = (detail.legs ?? []).filter(l => l.status === 'SUBMITTED' || l.status === 'ENDED')
  const last = done[done.length - 1]
  if (last?.to) return last.to
  const pts = detail.trip.points ?? []
  return pts[pts.length - 1]?.place ?? ''
}

function LegAdd({ snap, detail, onAdded }: { snap: Snapshot; detail: TeTripDetail; onAdded: (legId: Uuid, message: string, opts?: { started?: boolean }) => void }) {
  const trip = detail.trip
  const [from, setFrom] = React.useState(() => startedAt(detail))
  const [to, setTo] = React.useState('')
  const [mode, setMode] = React.useState('')
  const [vehicleId, setVehicleId] = React.useState('')
  const [why, setWhy] = React.useState('')
  const [picking, setPicking] = React.useState<'from' | 'to' | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const modes = snap.cfg.modes.filter(m => m.on && m.scopes.includes(trip.scope))
  const known = Object.entries(detail.places).map(([id, p]) => ({ id, s: p.s }))
  const name = (id: string) => detail.places[id]?.s ?? snap.masters.places.find(p => p.id === id)?.s ?? ''
  const ready = !!from && !!to && from !== to && !!mode && !!why.trim() && (mode !== 'own' || !!vehicleId)
  const setSide = (side: 'from' | 'to', id: string) => { if (side === 'from') setFrom(id); else setTo(id); setError('') }
  // One running journey per person (uq_te_leg_running): say so before the tap.
  const running = snap.journeys.find(j => j.emp === snap.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null

  /** Add it, and with `start` begin recording too. The journey is added first and kept. */
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
      await te.legStart(legId, await here())
      onAdded(legId, `Journey ${legNo} is recording.`, { started: true })
    } catch (e) {
      onAdded(legId, `Journey ${legNo} was added, but recording could not start: ${errorText(e)}`)
    }
  }

  const cancelPick = React.useCallback(() => setPicking(null), [])
  if (picking) {
    const side = picking
    return (
      <PlacePicker snap={snap} onCancel={cancelPick}
        target={{ kind: 'point', index: 0, title: side === 'from' ? 'Where the journey starts' : 'Where the journey goes' }}
        onChosen={id => { setPicking(null); setSide(side, id); void reloadTe() /* a place made in the picker is not in this snapshot yet */ }} />
    )
  }

  return (
    <TeSheet title="Add a journey" lead={LEAD} onClose={close}
      footer={
        <View style={{ gap: S.sm }}>
          {/* Adding for later is the second button: somebody filling this in is usually about to get in the auto. */}
          {!running ? <Button full title={busy ? 'Starting…' : 'Add and start now'} disabled={!ready || busy} onPress={() => void add(true)} /> : null}
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={close} />
            <Button title={busy && running ? 'Adding…' : 'Add for later'} variant={running ? 'primary' : 'outline'} style={{ flex: 1.6 }}
              disabled={!ready || busy} onPress={() => void add(false)} />
          </View>
        </View>
      }>
      <Sec>
        <H4 style={{ marginTop: 0 }}>Where</H4>
        <View style={{ gap: S.md }}>
          {(['from', 'to'] as const).map(side => {
            const chosen = side === 'from' ? from : to
            return (
              <View key={side} style={{ gap: S.sm }}>
                <LocBtn left={<Mk kind={side === 'from' ? 'a' : 'b'} label={side === 'from' ? 'A' : 'B'} />}
                  small={side === 'from' ? 'From' : 'To'} title={chosen ? name(chosen) : null} placeholder="Choose a place"
                  onPress={() => setPicking(side)} />
                {known.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {known.map(p => <VChip key={p.id} icon="pin" title={p.s} on={chosen === p.id} onPress={() => setSide(side, p.id)} />)}
                  </View>
                )}
              </View>
            )
          })}
        </View>
        {from && to && from === to ? <Ferr icon="alert">A journey has to go from one place to a different one.</Ferr> : null}
      </Sec>

      <Sec>
        <H4 style={{ marginTop: 0 }}>How</H4>
        <View accessibilityLabel="How you travel" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {modes.map(m => (
            <ModeChip key={m.id} icon={modeIco(m.id)} label={m.name} on={mode === m.id}
              onPress={() => { setMode(m.id); setVehicleId(m.id === 'own' ? (vehicleId || snap.vehicles[0]?.id || '') : ''); setError('') }} />
          ))}
        </View>
        {mode === 'own' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: S.sm }}>
            {snap.vehicles.map(v => <VChip key={v.id} icon={v.type === 'bike' ? 'bike' : 'car'} title={v.reg} mono on={vehicleId === v.id} onPress={() => setVehicleId(v.id)} />)}
          </View>
        )}
      </Sec>

      <Sec>
        <H4 style={{ marginTop: 0 }}>Why you are going</H4>
        <Input label="Reason for this journey" value={why} placeholder="Second client meeting at their Bandra office"
          onChangeText={v => { setWhy(v); setError('') }}
          help="Your approver and the travel desk read this. It was not in the plan they approved, so say what it is for." />
      </Sec>

      {running ? (
        <Note style={{ marginBottom: S.md }}>
          {`Journey ${running.n} is still recording, and only one can run at a time. Add this one now and start it once you have ended that one.`}
        </Note>
      ) : null}

      <Ferr icon="alert">{error}</Ferr>
    </TeSheet>
  )
}

export default function AddLegSheet() {
  const params = useLocalSearchParams<{ trip?: string }>()
  const tripId = param(params.trip) || null
  const { notify } = useOverlay()
  const q = useSnap()
  const d = useTripDetail(tripId)
  const onAdded = React.useCallback((legId: Uuid, msg: string, opts?: { started?: boolean }) => {
    notify(msg)
    void reloadTe()
    // Recording began: open the journey rather than returning to the trip.
    if (opts?.started && tripId) swap(teHref.leg(legId, tripId))
    else close()
  }, [notify, tripId])

  if (!q.data || !d.data) {
    return (
      <TeSheet title="Add a journey" lead={LEAD}>
        <SnapState error={q.error ?? d.error ?? (tripId ? null : new Error('Trip not found.'))}
          onRetry={() => { void q.refetch(); void d.refetch() }} />
      </TeSheet>
    )
  }
  return <LegAdd snap={q.data} detail={d.data} onAdded={onAdded} />
}

