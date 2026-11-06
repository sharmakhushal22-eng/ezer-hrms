// src/features/expenses/desk/InfoRooms.tsx — the Travel desk's "For information"
// and "Vehicles" rooms (components/te/desk/TeTravelDesk.tsx).
//
// Vehicles: confirming the TYPE is a money decision — the type sets the rate a
// km (ratePerKm, lib/te/vehicle.ts) and the row says what the rate becomes. The
// vehicle types come from the admin config, which a desk user may not be able to
// read; then confirming keeps the declared type, and the row says so.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { ChainStep } from '@web/te/approval-chain'
import { ratePerKm } from '@web/te/vehicle'
import type { TeVehicleType } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { day, errorText, rs } from '../api'
import { ContactLine } from '../contact/ContactFields'
import { FileLink } from '../ui/FilePick'
import { Ico, Mono, Note, TeCard, TeEmpty } from '../ui/kit'
import { SelectField } from '../plan/parts'
import { DeskChain } from './DeskChain'
import { deskApi, type DeskVehicle, type DeskWatch } from './types'

export function WatchRoom({ rows, total, chains, onOpenTrip }: {
  rows: DeskWatch[]; total: number; chains: Record<string, ChainStep[]>; onOpenTrip: (tripId: string) => void
}) {
  const { C } = useTheme()
  if (!total) {
    return <TeCard><TeEmpty title="Nothing else travelling">Trips the desk is not booking for appear here, so you can see what is moving without them crowding the work list.</TeEmpty></TeCard>
  }
  return (
    <TeCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm }}>
        <Txt size={F.tiny} w={700} tone="muted" upper>For information</Txt>
        <Txt size={F.tiny} w={700} tone="muted">{String(total)}</Txt>
      </View>
      <Note style={{ marginBottom: S.sm }}>Nothing here is yours to book — every journey is the traveller’s own and no hotel was asked for. It is listed so you know what is travelling.</Note>
      {rows.map(w => (
        <Pressable key={w.trip_id} onPress={() => onOpenTrip(w.trip_id)} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: pressed ? C.sunken : 'transparent' })}>
          <Ico name={w.scope === 'local' ? 'local' : w.scope === 'international' ? 'international' : 'domestic'} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt size={F.small} w={700}><Mono size={F.small} tone="ink">{w.trip_no}</Mono>{` · ${w.trip_name}`}</Txt>
            <Txt size={F.tiny} tone="muted">
              {`${w.full_name ?? ''} ${w.emp_code ?? ''} · ${day(w.start_date)}${w.end_date !== w.start_date ? ` to ${day(w.end_date)}` : ''} · ${w.leg_count} journey${w.leg_count === 1 ? '' : 's'}, all their own`}
            </Txt>
            <ContactLine contact={w.contact} />
            <DeskChain steps={chains[w.trip_id] ?? []} compact />
          </View>
        </Pressable>
      ))}
    </TeCard>
  )
}

function VehicleRow({ v, vehicleTypes, fuelPrice, onDone, setError }: {
  v: DeskVehicle; vehicleTypes: TeVehicleType[]; fuelPrice: Record<string, number>
  onDone: (message: string) => void; setError: (e: string) => void
}) {
  const { C } = useTheme()
  const [chosen, setChosen] = React.useState(v.declared_type_code ?? v.vehicle_type_code)
  const [busy, setBusy] = React.useState(false)
  const type = vehicleTypes.find(t => t.id === chosen)
  const declared = vehicleTypes.find(t => t.id === v.declared_type_code)
  const rate = ratePerKm(type, fuelPrice)
  const differs = !!v.declared_type_code && chosen !== v.declared_type_code

  async function verify() {
    setBusy(true); setError('')
    try {
      const r = await deskApi.vehicleVerify(v.id, chosen)
      const name = vehicleTypes.find(t => t.id === r.vehicle_type_code)?.name ?? r.vehicle_type_code
      onDone(`${v.reg_no} checked. It is paid as ${name}.`)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Ico name={chosen === 'bike' ? 'bike' : 'car'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}><Mono size={F.small} tone="ink">{v.reg_no}</Mono>{` · ${v.full_name ?? ''}`}</Txt>
          <Txt size={F.tiny} tone="muted">
            {`${v.emp_code ?? ''}${declared ? ` · they said ${declared.name}` : ''}${v.ownership && v.ownership !== 'self' ? ` · ${v.ownership === 'family' ? 'a family member’s' : 'someone else’s'}` : ''}`}
          </Txt>
        </View>
      </View>
      <View style={{ marginTop: S.sm }}>
        {vehicleTypes.length ? (
          <>
            <SelectField label="What it actually is, from the RC" value={chosen}
              options={vehicleTypes.filter(t => t.on).map(t => ({ value: t.id, label: t.name }))}
              onPick={setChosen} title="What it actually is, from the RC"
              help={`Paid at ${rs(rate)} a km${differs ? ', not what they declared' : ''}.`} />
          </>
        ) : (
          <Note>
            {`The vehicle types are not visible to you, so confirming keeps${declared ? ` ${declared.name}` : ' what the employee declared'}. An administrator can change the type afterwards.`}
          </Note>
        )}
        <View style={{ marginTop: S.sm }}>
          {v.rc_file_url ? <FileLink path={v.rc_file_url} name="Open the RC photo" kind="RC" small /> : <Txt size={F.tiny} tone="muted">No RC photo was attached.</Txt>}
        </View>
        <View style={{ marginTop: S.sm }}>
          <Button title={busy ? 'Saving…' : 'Confirm'} disabled={busy} onPress={() => void verify()} />
        </View>
      </View>
    </View>
  )
}

export function VehiclesRoom({ rows, vehicleTypes, fuelPrice, onDone, setError }: {
  rows: DeskVehicle[]; vehicleTypes: TeVehicleType[]; fuelPrice: Record<string, number>
  onDone: (message: string) => void; setError: (e: string) => void
}) {
  return (
    <TeCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm }}>
        <Txt size={F.tiny} w={700} tone="muted" upper>Vehicles to check</Txt>
        <Txt size={F.tiny} w={700} tone="muted">{String(rows.length)}</Txt>
      </View>
      {!rows.length ? <TeEmpty title="Nothing waiting">A vehicle appears here when Vahan could not confirm it and the employee attached the RC.</TeEmpty> : null}
      {rows.map(v => <VehicleRow key={v.id} v={v} vehicleTypes={vehicleTypes} fuelPrice={fuelPrice} onDone={onDone} setError={setError} />)}
    </TeCard>
  )
}
