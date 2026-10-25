// src/features/expenses/trip/StayRequest.tsx — asking the Travel Desk for a hotel
// (components/te/trip/TeStayRequest.tsx), inline in the trip's "Stays and tickets" card.
//
// Nothing is bought here: POST /api/te/bookings/request writes a REQUESTED
// booking with no reference and no expense line. A stay belongs to a place on
// the route, so the picker lists the trip's points; the dates default from the
// point and follow it unless they were typed over.
import * as React from 'react'
import { View } from 'react-native'
import type { TeTripDetail, Uuid } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, fmtDay } from '@/ui/overlays'
import { errorText, rs, te } from '../api'
import { FieldErr, Note, TeCard } from '../ui/kit'
import { platformOf } from './words'

export function StayRequest({ detail, placeName, onDone, onCancel }: {
  detail: TeTripDetail
  placeName: (id: Uuid) => string
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const { C } = useTheme()
  const points = detail.trip.points ?? []
  // Default to the first place that is not the start: where you actually stay.
  const [seq, setSeq] = React.useState(() => (points.length > 1 ? 1 : 0))
  const point = points[seq]

  const [vendor, setVendor] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [link, setLink] = React.useState('')
  const [checkIn, setCheckIn] = React.useState(() => points[1]?.arrive || '')
  const [checkOut, setCheckOut] = React.useState(() => points[1]?.leave || '')
  const [address, setAddress] = React.useState('')
  const [room, setRoom] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [picking, setPicking] = React.useState<'' | 'stop' | 'in' | 'out'>('')

  const ready = !!vendor.trim() && Number(amount) > 0
  const platform = platformOf(link)
  const stopLabel = (i: number) => `${placeName(points[i]?.place) || `Stop ${i + 1}`}${i === 0 ? ' (where you start)' : ''}`

  function pickStop(next: number) {
    setSeq(next)
    const p = points[next]
    if (p && !checkIn) setCheckIn(p.arrive || '')
    if (p && !checkOut) setCheckOut(p.leave || '')
  }

  async function send() {
    if (!ready || busy) return
    setBusy(true); setError('')
    try {
      const r = await te.stayRequest({
        trip_id: detail.trip.id,
        point_seq: seq,
        vendor: vendor.trim(),
        amount: Number(amount),
        ...(link.trim() ? { ticket_url: link.trim() } : {}),
        details: {
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(room.trim() ? { room: room.trim() } : {}),
          ...(checkIn ? { check_in: checkIn } : {}),
          ...(checkOut ? { check_out: checkOut } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(platform ? { platform } : {}),
        },
      })
      onDone(`Asked the Travel Desk to book ${vendor.trim()} · ${r.booking_no}`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TeCard style={{ marginTop: S.md, marginBottom: 0, backgroundColor: C.surface }}>
      <Txt size={F.lead} w={700} style={{ marginBottom: S.md }}>Ask the desk to book a stay</Txt>

      {points.length > 1 ? (
        <PickerField label="Where you are staying" value={stopLabel(seq)} onPress={() => setPicking('stop')} />
      ) : null}

      <Input label="Hotel" value={vendor} onChangeText={setVendor} placeholder="The name of the hotel" />

      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <PickerField style={{ flex: 1 }} label="Check in" value={checkIn ? fmtDay(checkIn) : ''} placeholder="dd/mm/yyyy" onPress={() => setPicking('in')} />
        <PickerField style={{ flex: 1 }} label="Check out" value={checkOut ? fmtDay(checkOut) : ''} placeholder="dd/mm/yyyy" onPress={() => setPicking('out')} />
      </View>

      <Input label="What you expect it to cost (₹)" value={amount} keyboardType="decimal-pad" inputMode="decimal"
        onChangeText={v => setAmount(v.replace(/[^0-9.]/g, ''))}
        help={Number(amount) > 0 ? `About ${rs(Number(amount))} for the stay.` : 'The desk books against this, so an estimate is enough.'} />

      <Input label="Link to the hotel" value={link} onChangeText={setLink} placeholder="https://www.makemytrip.com/hotels/…"
        autoCapitalize="none" autoCorrect={false} keyboardType="url"
        help={platform ? `From ${platform}. The desk and your approver can open it.` : 'Any booking site. Paste the page you found.'} />

      <Input label="Address, if you have it" value={address} onChangeText={setAddress} />
      <Input label="Room" value={room} onChangeText={setRoom} placeholder="Standard, twin, …" />
      <Input label="Anything else" value={note} onChangeText={setNote} placeholder="Near the client office" />

      <Note>
        {`This asks the Travel Desk to book it. Nothing is charged to the trip until they do, and${point ? ` it is recorded against ${placeName(point.place) || 'this stop'}.` : ' it is recorded against this trip.'}`}
      </Note>

      <FieldErr>{error}</FieldErr>

      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
        <Button style={{ flex: 1 }} variant="outline" title="Never mind" onPress={onCancel} />
        <Button style={{ flex: 1 }} title={busy ? 'Sending…' : 'Ask the desk'} disabled={!ready || busy} onPress={() => void send()} />
      </View>

      <SelectSheet visible={picking === 'stop'} onClose={() => setPicking('')} title="Where you are staying" searchable={false}
        value={seq} onPick={v => pickStop(Number(v))}
        options={points.map((_, i) => ({ value: i, label: stopLabel(i) }))} />
      <DateSheet visible={picking === 'in'} onClose={() => setPicking('')} title="Check in" value={checkIn || null}
        onPick={d => { setCheckIn(d); setPicking('') }} />
      <DateSheet visible={picking === 'out'} onClose={() => setPicking('')} title="Check out" value={checkOut || checkIn || null}
        min={checkIn || null} onPick={d => { setCheckOut(d); setPicking('') }} />
    </TeCard>
  )
}
