// src/features/expenses/legadd/AddLegSheet.tsx — a journey that was not planned
// (components/te/leg/TeLegAdd.tsx), the sheet route /expenses/add-leg?trip=<tripId>.
//
// A detour, a cab back because the train was cancelled: added here it stays
// inside the trip and is tracked and paid like any other journey. The reason
// is required and goes to the approver.
//
// TeHome's contract: onAdded(legId, msg) → close the sheet, toast, reload.
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
import { close, param } from '../nav'
import { H4 } from '../ui/kit'
import { TeSheet } from '../ui/TeSheet'
import { SnapState } from '../ui/TeScreen'
import { Ferr, LocBtn, Mk, ModeChip, Sec, VChip } from '../plan/parts'
import { PlacePicker } from '../plan/PlacePicker'

const modeIco = (id: string) => (id === 'train' ? 'train' : id === 'public' || id === 'bus' ? 'bus' : id === 'flight' ? 'plane' : 'car')

function LegAdd({ snap, detail, onAdded }: { snap: Snapshot; detail: TeTripDetail; onAdded: (legId: Uuid, message: string) => void }) {
  const trip = detail.trip
  const [from, setFrom] = React.useState('')
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

  async function add() {
    setBusy(true); setError('')
    try {
      const r = await te.legAdd(trip.id, { from, to, mode, vehicleId: vehicleId || null, why: why.trim() })
      onAdded(r.leg_id, `Journey ${r.leg_no} added. Start it when you set off.`)
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  const cancelPick = React.useCallback(() => setPicking(null), [])
  if (picking) {
    const side = picking
    return (
      <PlacePicker snap={snap} onCancel={cancelPick}
        target={{ kind: 'point', index: 0, title: side === 'from' ? 'Where the journey starts' : 'Where the journey goes' }}
        onChosen={id => { setPicking(null); setSide(side, id) }} />
    )
  }

  return (
    <TeSheet title="Add a journey" lead="A journey on this trip that was not in the plan." onClose={close}
      footer={
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={close} />
          <Button title={busy ? 'Adding…' : 'Add the journey'} style={{ flex: 1.6 }} disabled={!ready || busy} onPress={() => void add()} />
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
        <H4 style={{ marginTop: 0 }}>Why it was not planned</H4>
        <Input label="Reason" value={why} placeholder="The train was cancelled, a second site was added"
          onChangeText={v => { setWhy(v); setError('') }} help="Your approver sees this: the trip they approved has changed." />
      </Sec>

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
  const onAdded = React.useCallback((_legId: Uuid, msg: string) => {
    close()
    notify(msg)
    void reloadTe()
  }, [notify])

  if (!q.data || !d.data) {
    return (
      <TeSheet title="Add a journey" lead="A journey on this trip that was not in the plan.">
        <SnapState error={q.error ?? d.error ?? (tripId ? null : new Error('Trip not found.'))}
          onRetry={() => { void q.refetch(); void d.refetch() }} />
      </TeSheet>
    )
  }
  return <LegAdd snap={q.data} detail={d.data} onAdded={onAdded} />
}

