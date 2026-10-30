// src/features/expenses/plan/SegRow.tsx — how you travel ONE journey, opened on the
// commute step (SegRow in components/te/plan/TePlanCommute.tsx, planner v2).
//
// Mode tiles (what it is + how it is paid), the own-vehicle picker with an inline
// "add a vehicle" form, who books, the airport / station (the company's own hub
// for the city is shown when none was picked — hubForCity), the door-to-door
// chain (commuteChain) with a picker for the first and last mile incl. "Nothing
// to claim", the Travel-Desk preferences (time follows the route's leave time
// until typed — syncDraft's prefTimeTouched), and the pay / GPS note.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue } from '@web/te/types'
import { HUB_MODES, type PlannerDraft } from '@web/te/trip-draft'
import { chainCount, commuteChain, hubForCity, hubKind, NO_XFER, sameHub, xferModes } from '@web/te/commute'
import { badUrl } from '@web/te/trip-stay'
import { vehicleSubtitle } from '@web/te/vehicle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { day } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Seg } from '../ui/kit'
import { modeIcon } from '../tones'
import { VehicleAdd } from '../vehicle/VehicleAdd'
import { Ferr, LocBtn, SelectField, VChip } from './parts'
import type { PickTarget } from './PlacePicker'
import type { Edit } from './PlanTrip'
import { TimeField } from './TimeField'

export const PAY_WORDS: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}
/** Modes nobody books for you: nothing to ask the desk about. */
const NO_BOOKING: Record<string, true> = { own: true, company: true }

/** The modes this draft may use: on, allowed for the scope, no flight / train when they said none. */
export function offeredModes(snap: Snapshot, draft: PlannerDraft) {
  return snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope) && (draft.flightOrTrain !== false || !HUB_MODES.includes(m.id)))
}

function ModeTile({ icon, name, sub, on, onPress }: { icon: string; name: string; sub: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${name}. ${sub}`}
      style={({ pressed }) => ({
        width: '48%', flexGrow: 1, minHeight: 64, padding: 10, borderRadius: R.md, gap: 2,
        borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : pressed ? C.sunken : C.surface,
      })}>
      <TeIcon name={icon} color={on ? C.brand : C.muted} />
      <Txt size={F.small} w={700} color={on ? C.brandDeep : C.ink} numberOfLines={1}>{name}</Txt>
      <Txt size={F.micro} tone="muted" numberOfLines={1}>{sub}</Txt>
    </Pressable>
  )
}

export function SegRow({ snap, draft, issues, i, tried, onDone, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  i: number
  tried: boolean
  onDone: () => void
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
  const modes = offeredModes(snap, draft)
  const chain = commuteChain({
    mode: s.mode, scope: draft.scope,
    from: draft.points[i]?.place ?? '', to: draft.points[i + 1]?.place ?? '',
    hubA: s.xfer.hubA, hubB: s.xfer.hubB, first: s.xfer.first, last: s.xfer.last,
  })
  const hubName = hubKind(s.mode, draft.scope) ?? 'hub'
  const vehicle = s.mode === 'own' ? snap.vehicles.find(v => v.id === s.vehicleId) : null
  // The Travel Desk books tickets, but not for a local trip and not for one that already happened.
  const desk = !!md && md.basis === 'ticket' && draft.origin !== 'POST_FACTO' && draft.scope !== 'local'
  const deskBooks = desk && s.bookedBy !== 'self'
  const legDate = draft.points[i]?.leave || draft.points[i + 1]?.arrive || ''
  const checkIn = md?.gps === 'checkin'
  const setSeg = (patch: Partial<typeof s>) => edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))
  const bits = [vehicle?.reg ?? '', desk ? (s.bookedBy === 'self' ? 'You book' : 'Travel Desk books') : ''].filter(Boolean)
  const xferOptions = [
    ...xferModes(snap.cfg.modes).map(m => ({ value: m.id, label: m.name })),
    { value: NO_XFER, label: 'Nothing to claim — dropped, walked or already there' },
  ]

  return (
    <View style={{ borderRadius: R.md, borderWidth: 1.5, borderColor: err && tried ? C.critical : C.brand, backgroundColor: C.surface, padding: S.md, gap: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}>
          <TeIcon name={md ? modeIcon(md.id) : 'route'} size="sm" color={C.inkSoft} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700} numberOfLines={2}>{`${a?.s ?? '—'} → ${b?.s ?? '—'}`}</Txt>
          {bits.length ? <Txt size={F.micro} tone="muted" numberOfLines={1}>{bits.join(' · ')}</Txt> : null}
        </View>
        {md ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.brandTint }}>
            <TeIcon name={checkIn ? 'target' : 'route'} px={12} color={C.brand} />
            <Txt size={F.micro} w={600} tone="brand">{checkIn ? 'Check-ins' : 'GPS'}</Txt>
          </View>
        ) : null}
      </View>

      <View accessibilityLabel={a && b ? `How you travel from ${a.s} to ${b.s}` : 'How you travel'} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {modes.map(m => (
          <ModeTile key={m.id} icon={modeIcon(m.id)} name={m.name} sub={PAY_WORDS[m.basis] ?? ''} on={s.mode === m.id}
            onPress={() => setSeg({ mode: m.id, vehicleId: m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : '' })} />
        ))}
      </View>

      {s.mode === 'own' ? (
        <View style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {mine.map(v => (
              <VChip key={v.id} icon={v.type === 'bike' ? 'bike' : 'car'} title={v.reg} mono on={s.vehicleId === v.id}
                sub={`${vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)}${v.verified ? '' : ' · HR to check'}`}
                onPress={() => setSeg({ vehicleId: v.id })} />
            ))}
            {mine.length ? (
              <VChip icon="plus" title="Another vehicle" sub="Any vehicle, by its number" add on={addingVehicle} onPress={() => setAddingVehicle(v => !v)} />
            ) : null}
          </View>
          {addingVehicle || !mine.length ? (
            <VehicleAdd snap={snap} first={!mine.length}
              onClose={mine.length ? () => setAddingVehicle(false) : undefined}
              onAdded={(vehicleId, message) => {
                setAddingVehicle(false)
                edit(d => ({ ...d, segs: d.segs.map((q, k) => (k === i || (q.mode === 'own' && !q.vehicleId) ? { ...q, mode: 'own', vehicleId } : q)) }))
                onVehicleAdded(message)
              }} />
          ) : null}
        </View>
      ) : null}

      {desk ? (
        <Seg label="Who books" value={s.bookedBy === 'self' ? 'self' : 'desk'}
          items={[{ key: 'desk', label: 'Travel Desk books' }, { key: 'self', label: 'I book and claim' }]}
          onChange={k => setSeg({ bookedBy: k })} />
      ) : null}

      {md && (md.id === 'flight' || md.id === 'train') && draft.scope !== 'local' ? (
        <View style={{ gap: S.sm }}>
          {(['A', 'B'] as const).map(side => {
            const city = side === 'A' ? a : b
            const chosen = place(side === 'A' ? s.xfer.hubA ?? '' : s.xfer.hubB ?? '')
            const auto = chosen ? null : place(hubForCity(city, md.id === 'flight' ? 'air' : 'rail', snap.masters) ?? '')
            const hub = chosen ?? auto
            const word = md.id === 'flight' ? 'airport' : 'station'
            const cityName = city?.city || city?.s || ''
            return (
              <LocBtn key={side} need={!hub}
                left={<View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}><TeIcon name={md.id === 'flight' ? 'plane' : 'train'} size="sm" color={C.inkSoft} /></View>}
                small={`The ${word} you ${side === 'A' ? 'leave from' : 'arrive at'}${city ? `, ${cityName}` : ''}`}
                title={hub ? hub.s : null}
                placeholder={`Choose the ${word}`}
                ad={hub
                  ? (chosen ? 'Chosen by you. Tap to change' : `Your company’s ${word} for ${cityName || 'this city'}. Tap to change`)
                  : `No ${word} is set up for ${cityName || 'this city'}`}
                onPress={() => onPick({ kind: 'hub', index: i, side, title: `${word === 'airport' ? 'Airport' : 'Railway station'} in ${cityName || 'this city'}`, hub: word })} />
            )
          })}
        </View>
      ) : null}

      {sameHub(s.xfer.hubA, s.xfer.hubB) ? (
        <Ferr icon="alert" warn>{`Both ends use the same ${hubName}. Check the places on the route — this is usually the wrong city.`}</Ferr>
      ) : null}

      {chain.length > 1 ? (
        <View style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
            <TeIcon name="route" size="sm" color={C.muted} />
            <Txt size={F.tiny} tone="soft" style={{ flex: 1 }}>
              {`${chainCount(chain)} ${chainCount(chain) === 1 ? 'journey' : 'journeys'} door to door. Each is estimated, tracked and claimed on its own.`}
            </Txt>
          </View>
          <View style={{ gap: 4 }}>
            {chain.map((step, n) => (
              <View key={`${step.kind}-${n}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: step.skipped ? 0.55 : 1 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}>
                  <Txt size={F.micro} w={700} tone="soft">{n + 1}</Txt>
                </View>
                <Txt size={F.tiny} style={{ flex: 1 }} numberOfLines={2}>{`${place(step.from)?.s ?? '—'} → ${place(step.to)?.s ?? '—'}`}</Txt>
                <Chip plain label={step.skipped ? 'Nothing to claim' : (snap.cfg.modes.find(m => m.id === step.mode)?.name ?? step.mode)} />
              </View>
            ))}
          </View>
          {(['first', 'last'] as const).map(side => {
            if (!chain.some(st => st.kind === side)) return null
            const value = (side === 'first' ? s.xfer.first : s.xfer.last) || 'cab'
            return (
              <SelectField key={side} label={side === 'first' ? `Getting to the ${hubName}` : `Getting from the ${hubName} to where you are going`}
                value={value} options={xferOptions}
                help={value === 'own' ? 'Your own vehicle. The same one as the main journey unless you change it there.' : undefined}
                onPick={v => setSeg({ xfer: { ...s.xfer, [side]: v } })} />
            )
          })}
        </View>
      ) : null}

      {md && !NO_BOOKING[md.id] ? (
        <View style={{ borderRadius: R.md, backgroundColor: C.sunken, padding: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <TeIcon name={deskBooks ? 'plane' : 'info'} size="sm" color={C.ink} />
            <Txt size={F.small} w={700} style={{ flex: 1 }}>{deskBooks ? 'What should the Travel Desk book?' : 'Anything to note about this journey?'}</Txt>
            <Chip plain label="Optional" />
          </View>
          <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>
            {deskBooks
              ? `The desk books this one. The date comes from the route${legDate ? ` — ${day(legDate)}` : ''}; tell it when you would rather leave and point it at anything you have already found.`
              : `You are booking this yourself. Anything here is for your approver to see${legDate ? `, on ${day(legDate)}` : ''}.`}
          </Txt>
          <TimeField label="Preferred time" value={s.prefTime ?? ''}
            onChange={v => setSeg({ prefTime: v, prefTimeTouched: true })}
            help={s.prefTimeTouched
              ? 'When you would like to leave.'
              : s.prefTime
                ? 'Taken from when you leave on the route. Change it to ask for something else.'
                : 'When you would like to leave. Fill in the leave time on the route and it comes here by itself.'} />
          <Input label="Link to what you found" value={s.prefUrl ?? ''} placeholder="https://…" autoCapitalize="none" keyboardType="url" autoCorrect={false}
            onChangeText={v => setSeg({ prefUrl: v })}
            error={badUrl(s.prefUrl ?? '') ? 'That does not look like a web address. Paste the whole link, starting with https://' : undefined}
            help="A flight, train or fare. The desk can open it." />
          <Input label="Anything else" value={s.prefNote ?? ''} placeholder="Either the 6am or after 8pm; same airline as the outbound"
            onChangeText={v => setSeg({ prefNote: v })} style={{ marginBottom: 0 }} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <View style={{ paddingTop: 1 }}><TeIcon name={checkIn ? 'target' : 'route'} size="sm" color={C.muted} /></View>
        <Txt size={F.tiny} tone="muted" style={{ flex: 1 }}>
          {md ? `${PAY_WORDS[md.basis] ?? ''}. ${checkIn ? 'Check-in by GPS at both ends. No stops on the way.' : `GPS records the route.${md.stops ? ' Stops can be added on the way.' : ' Stops are the operator’s.'}`}` : ''}
        </Txt>
      </View>
      {tried && err ? <Ferr>{err.t}</Ferr> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button title="Done" size="sm" onPress={onDone} icon={<TeIcon name="check" size="sm" color={C.onAccent} />} />
      </View>
    </View>
  )
}
