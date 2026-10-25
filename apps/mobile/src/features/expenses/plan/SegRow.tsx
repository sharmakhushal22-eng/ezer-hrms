// src/features/expenses/plan/SegRow.tsx — how you travel between two places
// (SegRow in components/te/plan/TePlanRoute.tsx, defined outside the parent).
//
// Mode chips, the own-vehicle picker with an inline "add a vehicle" form (the
// draft stays in the planner while the vehicle is registered), who books the
// ticket, the airport / station choice, and the pay / GPS note.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue } from '@web/te/types'
import type { PlannerDraft } from '@web/te/trip-draft'
import { vehicleSubtitle } from '@web/te/vehicle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'
import { Seg } from '../ui/kit'
import { modeIcon } from '../tones'
import { VehicleAdd } from '../vehicle/VehicleAdd'
import { Ferr, LocBtn, ModeChip, VChip } from './parts'
import type { PickTarget } from './PlacePicker'
import type { Edit } from './PlanTrip'

export const PAY_WORDS: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}

export function SegRow({ snap, draft, issues, i, open, tried, onToggle, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  i: number
  open: boolean
  tried: boolean
  onToggle: () => void
  edit: Edit
  onPick: (t: PickTarget) => void
  onVehicleAdded: (message: string) => void
}) {
  const { C } = useTheme()
  const [addingVehicle, setAddingVehicle] = React.useState(false)
  const s = draft.segs[i]
  const mine = snap.vehicles.filter(v => v.emp === snap.me)
  if (!s) return null
  const md = snap.cfg.modes.find(m => m.id === s.mode) ?? null
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const a = place(draft.points[i]?.place ?? '')
  const b = place(draft.points[i + 1]?.place ?? '')
  const err = issues.find(q => q.block && q.k === `m${i}`)

  const modes = snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope))
  const vehicle = s.mode === 'own' ? snap.vehicles.find(v => v.id === s.vehicleId) : null
  // The Travel Desk books tickets, but not for a local trip and not for one that already happened.
  const desk = !!md && md.basis === 'ticket' && draft.origin !== 'POST_FACTO' && draft.scope !== 'local'
  const checkIn = md?.gps === 'checkin'
  const setSeg = (patch: Partial<typeof s>) => edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))
  const bits = [vehicle?.reg ?? '', desk ? (s.bookedBy === 'self' ? 'You book' : 'Travel Desk books') : ''].filter(Boolean)

  return (
    <View style={{ marginLeft: 12, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: err && tried ? C.critical : C.line, borderStyle: 'dashed', paddingVertical: 4 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10, borderRadius: R.md, backgroundColor: open ? C.sunken : pressed ? C.sunken : 'transparent' })}>
        <TeIcon name={md ? modeIcon(md.id) : 'route'} size="sm" color={C.inkSoft} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700} color={md ? C.ink : C.faint}>{md ? md.name : 'Choose how you travel'}</Txt>
          {bits.length > 0 && <Txt size={F.micro} tone="muted" numberOfLines={1}>{bits.join(' · ')}</Txt>}
        </View>
        {md && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.brandTint }}>
            <TeIcon name={checkIn ? 'target' : 'route'} px={12} color={C.brand} />
            <Txt size={F.micro} w={600} tone="brand">{checkIn ? 'Check-ins' : 'GPS'}</Txt>
          </View>
        )}
        <TeIcon name={open ? 'up' : 'down'} size="sm" color={C.muted} />
      </Pressable>

      {!open && err && tried ? <Ferr icon="alert">{err.t}</Ferr> : null}

      {open && (
        <View style={{ paddingVertical: S.sm, gap: S.md }}>
          <View accessibilityLabel={a && b ? `How you travel from ${a.s} to ${b.s}` : 'How you travel'} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {modes.map(m => (
              <ModeChip key={m.id} icon={modeIcon(m.id)} label={m.name} on={s.mode === m.id} hint={`${m.name}: ${PAY_WORDS[m.basis] ?? ''}`}
                onPress={() => setSeg({ mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })} />
            ))}
          </View>

          {s.mode === 'own' && (
            <View style={{ gap: S.sm }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {mine.map(v => (
                  <VChip key={v.id} icon={v.type === 'bike' ? 'bike' : 'car'} title={v.reg} mono on={s.vehicleId === v.id}
                    sub={`${vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)}${v.verified ? '' : ' · HR to check'}`}
                    onPress={() => setSeg({ vehicleId: v.id })} />
                ))}
                {mine.length > 0 && (
                  <VChip icon="plus" title="Another vehicle" sub="Any vehicle, by its number" add on={addingVehicle} onPress={() => setAddingVehicle(v => !v)} />
                )}
              </View>
              {(addingVehicle || !mine.length) && (
                <VehicleAdd snap={snap} first={!mine.length}
                  onClose={mine.length ? () => setAddingVehicle(false) : undefined}
                  onAdded={(vehicleId, message) => {
                    setAddingVehicle(false)
                    // Use it on this journey straight away, and on any other own-vehicle one still waiting for one.
                    edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i || (q.mode === 'own' && !q.vehicleId) ? { ...q, mode: 'own', vehicleId } : q)) }))
                    onVehicleAdded(message)
                  }} />
              )}
            </View>
          )}

          {desk && (
            <Seg label="Who books" value={s.bookedBy === 'self' ? 'self' : 'desk'}
              items={[{ key: 'desk', label: 'Travel Desk books' }, { key: 'self', label: 'I book and claim' }]}
              onChange={k => setSeg({ bookedBy: k })} />
          )}

          {md && (md.id === 'flight' || md.id === 'train') && draft.scope !== 'local' && (
            <View style={{ gap: S.sm }}>
              {(['A', 'B'] as const).map(side => {
                const city = side === 'A' ? a : b
                const hub = place(side === 'A' ? s.xfer.hubA ?? '' : s.xfer.hubB ?? '')
                const word = md.id === 'flight' ? 'airport' : 'station'
                const cityName = city?.city || city?.s || ''
                return (
                  <LocBtn key={side} need={!hub}
                    left={<View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}><TeIcon name={md.id === 'flight' ? 'plane' : 'train'} size="sm" color={C.inkSoft} /></View>}
                    small={`The ${word} you ${side === 'A' ? 'leave from' : 'arrive at'}${city ? `, ${cityName}` : ''}`}
                    title={hub ? hub.s : null}
                    placeholder={`Choose the ${word}`}
                    ad={hub ? 'Chosen by you. Tap to change' : `No ${word} is set up for ${cityName || 'this city'}`}
                    onPress={() => onPick({ kind: 'hub', index: i, side, title: `${word === 'airport' ? 'Airport' : 'Railway station'} in ${cityName || 'this city'}`, hub: word })} />
                )
              })}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 1 }}><TeIcon name={checkIn ? 'target' : 'route'} size="sm" color={C.muted} /></View>
            <Txt size={F.tiny} tone="muted" style={{ flex: 1 }}>
              {md ? `${PAY_WORDS[md.basis] ?? ''}. ${checkIn ? 'Check-in by GPS at both ends. No stops on the way.' : `GPS records the route.${md.stops ? ' Stops can be added on the way.' : ' Stops are the operator’s.'}`}` : ''}
            </Txt>
          </View>
          {tried && err ? <Ferr>{err.t}</Ferr> : null}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button title="Done" size="sm" onPress={onToggle} icon={<TeIcon name="check" size="sm" color={C.onAccent} />} />
          </View>
        </View>
      )}
    </View>
  )
}
