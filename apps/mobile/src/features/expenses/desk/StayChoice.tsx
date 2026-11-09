// src/features/expenses/desk/StayChoice.tsx — the Travel Desk answers the hotels a
// traveller suggested (components/te/desk/TeStayChoice.tsx). Pick one, or turn
// them all down with a reason (rejectReady, lib/te/trip-stay.ts). Nothing is
// booked here; "To book" is where a cost exists.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { platformOf, rejectReady } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { day, errorText, rs } from '../api'
import { FileLink } from '../ui/FilePick'
import { FieldErr, Ico, TeCard, TeEmpty } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { deskApi, type DeskStay } from './types'

function OneStay({ s, onDone, onOpenTrip, setError }: {
  s: DeskStay
  onDone: (message: string) => void
  onOpenTrip: (tripId: string) => void
  setError: (e: string) => void
}) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [chosen, setChosen] = React.useState(0)
  const [note, setNote] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const options = s.stay_options ?? []

  async function decide(action: 'choose' | 'reject') {
    setBusy(true); setError('')
    try {
      const r = await deskApi.stayDecide({
        tripId: s.id, action,
        ...(action === 'choose' ? { choice: chosen } : {}),
        ...(note.trim() ? { remark: note.trim() } : {}),
      })
      onDone(action === 'choose'
        ? `${r.name || 'The hotel'} chosen for ${s.trip_no}. ${s.full_name ?? 'The traveller'} has been told.`
        : `Hotels turned down for ${s.trip_no}. ${s.full_name ?? 'The traveller'} has been told why.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Ico name={s.scope === 'international' ? 'international' : s.scope === 'domestic' ? 'domestic' : 'local'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{s.name}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Txt size={F.tiny} tone="muted">{`${s.full_name ?? '—'}${s.emp_code ? ` · ${s.emp_code}` : ''} · `}</Txt>
            <Pressable onPress={() => onOpenTrip(s.id)} hitSlop={6} accessibilityRole="link">
              <Txt size={F.tiny} w={700} color={C.brand} style={{ fontFamily: 'monospace' }}>{s.trip_no}</Txt>
            </Pressable>
          </View>
          <Txt size={F.tiny} tone="muted">
            {`${s.start_date ? day(s.start_date) : 'No dates'}${s.end_date && s.end_date !== s.start_date ? ` to ${day(s.end_date)}` : ''}`}
            {` · ${options.length === 1 ? '1 hotel suggested' : `${options.length} hotels suggested`}`}
            {s.stay_by === 'desk' ? ' · the desk books it' : ' · they book it themselves'}
          </Txt>
        </View>
      </View>
      <View style={{ marginTop: S.sm, alignSelf: 'flex-start' }}>
        <Button size="sm" variant="outline" title={open ? 'Close' : 'Look at them'} onPress={() => setOpen(o => !o)}
          icon={<TeIcon name={open ? 'up' : 'down'} size="sm" color={C.brandDeep} />} />
      </View>
      {open ? (
        <View style={{ marginTop: S.sm, gap: S.sm }}>
          {!options.length ? <Txt size={F.tiny} tone="muted">No hotels were named on this trip, so there is nothing to choose between.</Txt> : null}
          {options.map((o, i) => {
            const site = o.url ? platformOf(o.url) : null
            return (
              <Pressable key={i} onPress={() => setChosen(i)} accessibilityRole="radio" accessibilityState={{ checked: chosen === i }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, padding: S.sm, borderRadius: 10, borderWidth: 1.5, borderColor: chosen === i ? C.brand : C.line, backgroundColor: chosen === i ? C.brandTint : C.surface }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: chosen === i ? C.brand : C.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {chosen === i ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.brand }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={F.small} w={700}>{o.name}</Txt>
                  <Txt size={F.tiny} tone="muted">
                    {[o.location, o.price ? `about ${rs(o.price)} a night` : '', site].filter(Boolean).join(' · ') || 'No other details given'}
                  </Txt>
                  {o.url ? <View style={{ marginTop: 4 }}><FileLink path={o.url} name="Open the page" small /></View> : null}
                </View>
              </Pressable>
            )
          })}
          <Input label={rejecting ? 'Why none of these work' : 'A note for the traveller, if you want one'} value={note} onChangeText={setNote}
            placeholder={rejecting ? 'Too far from the client office — try something near Andheri' : 'Optional'} />
          <Button title={busy ? 'Saving…' : `Choose ${options[chosen]?.name || 'this one'}`} disabled={!options.length || busy} onPress={() => void decide('choose')} />
          {rejecting ? (
            <Button variant="danger" title={rejectReady(note) ? 'Turn all of them down' : 'Add a reason first'} disabled={!rejectReady(note) || busy}
              onPress={() => void decide('reject')} />
          ) : (
            <Button variant="outline" title="None of these" onPress={() => setRejecting(true)} />
          )}
          <Txt size={F.tiny} tone="muted">
            {`Choosing records which hotel was picked and tells ${s.full_name ?? 'the traveller'}. Nothing is booked and nothing is charged to the trip until you record the booking above.`}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

export function StayChoice({ stays, onDone, onOpenTrip }: {
  stays: DeskStay[]
  onDone: (message: string) => void
  onOpenTrip: (tripId: string) => void
}) {
  const [error, setError] = React.useState('')
  return (
    <TeCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt size={F.tiny} w={700} tone="muted" upper>Hotels to choose</Txt>
        <Txt size={F.tiny} w={700} tone="muted">{String(stays.length)}</Txt>
      </View>
      {!stays.length ? (
        <TeEmpty title="Nothing waiting">When somebody asks for a stay while planning a trip, the hotels they suggested appear here.</TeEmpty>
      ) : null}
      {error ? <FieldErr>{error}</FieldErr> : null}
      {stays.map(s => <OneStay key={s.id} s={s} onDone={onDone} onOpenTrip={onOpenTrip} setError={setError} />)}
    </TeCard>
  )
}
