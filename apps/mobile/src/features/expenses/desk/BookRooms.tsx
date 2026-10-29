// src/features/expenses/desk/BookRooms.tsx — the Travel desk's "To book" and
// "Booked" rooms (components/te/desk/TeTravelDesk.tsx). Same rules as the web:
//   · Record only when may_book and the trip is APPROVED ("Book once approved");
//   · the ticket is required (te_booking_record refuses without one, 178) and is
//     uploaded the moment it is chosen, then sent as its storage path;
//   · Email the ticket only for a booking with a ticket; "Send again" after;
//   · Cancel needs a reason, and says it does not tell the airline or the hotel.
import * as React from 'react'
import { Linking, Pressable, View } from 'react-native'
import type { ChainStep } from '@web/te/approval-chain'
import type { PickedFile } from '@/core/api'
import type { TeUploadedFile } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { day, errorText, rs, te } from '../api'
import { ContactLine } from '../contact/ContactFields'
import { FilePickButton } from '../ui/FilePick'
import { Chip, Flag, Ico, Mono, Note, TeCard, TeEmpty } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { DeskChain } from './DeskChain'
import { deskApi, type DeskBooked, type DeskToBook } from './types'

const keyOf = (b: DeskToBook) => `${b.trip_id}:${b.leg_id ?? b.point_seq ?? b.kind}`
const approved = (b: DeskToBook) => !b.trip_status || b.trip_status === 'APPROVED'

function RoomHead({ title, n }: { title: string; n: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm }}>
      <Txt size={F.tiny} w={700} tone="muted" upper>{title}</Txt>
      <Txt size={F.tiny} w={700} tone="muted">{String(n)}</Txt>
    </View>
  )
}

function BookingForm({ b, onCancel, onRecorded, setError }: {
  b: DeskToBook
  onCancel: () => void
  onRecorded: (message: string) => void
  setError: (e: string) => void
}) {
  const [form, setForm] = React.useState({ vendor: '', reference: '', amount: '' })
  const [ticket, setTicket] = React.useState<TeUploadedFile | null>(null)
  const [busy, setBusy] = React.useState('')
  const filled = !!form.vendor.trim() && !!form.reference.trim() && Number(form.amount) > 0
  const ready = filled && !!ticket

  async function attach(f: PickedFile) {
    setBusy('ticket'); setError('')
    try { setTicket(await te.upload(f, 'TICKET')) } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  async function record() {
    setBusy('book'); setError('')
    try {
      const r = await deskApi.bookingRecord({
        trip_id: b.trip_id,
        ...(b.leg_id ? { leg_id: b.leg_id } : {}),
        ...(b.point_seq != null ? { point_seq: b.point_seq } : {}),
        vendor: form.vendor.trim(),
        reference: form.reference.trim(),
        amount: Number(form.amount),
        ...(ticket ? { ticket_url: ticket.storage_path } : {}),
      })
      onRecorded(`Booking ${r.booking_no} recorded against ${b.trip_no}.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <View style={{ marginTop: S.sm }}>
      <Input label="Booked with" value={form.vendor} onChangeText={t => setForm(f => ({ ...f, vendor: t }))} placeholder="Airline, hotel or agent" />
      <Input label={b.kind === 'hotel' ? 'Booking reference' : 'PNR or ticket number'} value={form.reference} onChangeText={t => setForm(f => ({ ...f, reference: t }))} autoCapitalize="characters" />
      <Input label="What it cost (₹)" value={form.amount} onChangeText={t => setForm(f => ({ ...f, amount: t.replace(/[^\d.]/g, '') }))} keyboardType="decimal-pad" />
      <Txt size={F.tiny} w={700} tone="muted" upper style={{ marginBottom: 6 }}>{b.kind === 'hotel' ? 'The booking slip' : 'The ticket'}</Txt>
      <FilePickButton title={busy === 'ticket' ? 'Attaching…' : ticket ? 'Replace the file' : 'Attach the file'} loading={busy === 'ticket'}
        disabled={busy === 'ticket'} sheetTitle={b.kind === 'hotel' ? 'The booking slip' : 'The ticket'} onPicked={attach} />
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 4, marginBottom: S.sm }}>
        {busy === 'ticket' ? 'Attaching…' : ticket ? `Attached: ${ticket.file_name}` : 'A PDF or a photo. The traveller is sent this, and Finance matches the bill to it.'}
      </Txt>
      <Note>This is recorded as paid by the company. It is added to the trip so the employee cannot claim it again.</Note>
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
        <Button variant="outline" title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={busy === 'book' ? 'Recording…' : 'Record the booking'} disabled={!ready || busy === 'book'} onPress={() => void record()} style={{ flex: 1.6 }} />
      </View>
      {!ticket && filled ? <Txt size={F.tiny} tone="muted" style={{ marginTop: 4 }}>Attach the ticket to record this.</Txt> : null}
    </View>
  )
}

export function ToBookRoom({ rows, loading, mayBook, chains, onOpenTrip, onDone, setError }: {
  rows: DeskToBook[]; loading: boolean; mayBook: boolean; chains: Record<string, ChainStep[]>
  onOpenTrip: (tripId: string) => void; onDone: (message: string) => void; setError: (e: string) => void
}) {
  const { C } = useTheme()
  const [booking, setBooking] = React.useState<string | null>(null)
  return (
    <TeCard>
      <RoomHead title="To book" n={rows.length} />
      {!mayBook ? (
        <Note style={{ marginBottom: S.sm }}>You can see what is waiting, but booking is not switched on for you. An administrator sets “May book” on the travel desk.</Note>
      ) : null}
      {loading ? <TeEmpty title="Loading…" /> : null}
      {!loading && !rows.length ? <TeEmpty title="Nothing to book">Approved trips with journeys marked “Travel Desk books” appear here.</TeEmpty> : null}
      {rows.map(b => {
        const isOpen = booking === keyOf(b)
        return (
          <View key={keyOf(b)} style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
              <Ico name={b.kind === 'hotel' ? 'pin' : b.mode === 'train' ? 'train' : 'plane'} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.small} w={700}>{b.kind === 'hotel' ? 'Hotel' : `${b.from_name ?? '—'} → ${b.to_name ?? '—'}`}</Txt>
                <Txt size={F.tiny} tone="muted">
                  {`${b.full_name ?? ''} ${b.emp_code ?? ''} · ${b.trip_name}${b.on_date ? ` · ${day(b.on_date)}` : ''}${b.mode ? ` · ${b.mode}` : ''}`}
                </Txt>
                <DeskChain steps={chains[b.trip_id] ?? []} />
                <View style={{ marginTop: 4 }}><ContactLine contact={b.contact} /></View>
                {b.pref_time || b.pref_url || b.pref_note ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <TeIcon name="info" size="sm" color={C.info} />
                    <Txt size={F.tiny} style={{ flexShrink: 1 }}>
                      <Txt size={F.tiny} w={700}>Asked for:</Txt>
                      {b.pref_time ? ` around ${b.pref_time}` : ''}
                      {b.pref_note ? `${b.pref_time ? '. ' : ' '}${b.pref_note}` : ''}
                    </Txt>
                    {b.pref_url ? (
                      <Pressable onPress={() => void Linking.openURL(b.pref_url!)} hitSlop={6} accessibilityRole="link">
                        <Txt size={F.tiny} w={600} color={C.brand}>the option they found</Txt>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
            {isOpen ? (
              <BookingForm b={b} setError={setError} onCancel={() => setBooking(null)}
                onRecorded={m => { setBooking(null); onDone(m) }} />
            ) : (
              <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button size="sm" variant="outline" title="Details" onPress={() => onOpenTrip(b.trip_id)} />
                {mayBook && approved(b) ? <Button size="sm" title="Record" onPress={() => { setBooking(keyOf(b)); setError('') }} /> : null}
                {mayBook && !approved(b) ? <Txt size={F.tiny} tone="muted">Book once approved</Txt> : null}
              </View>
            )}
          </View>
        )
      })}
    </TeCard>
  )
}

function BookedRow({ b, mayBook, onOpenTrip, onDone, setError }: {
  b: DeskBooked; mayBook: boolean
  onOpenTrip: (tripId: string) => void; onDone: (message: string) => void; setError: (e: string) => void
}) {
  const { C } = useTheme()
  const [cancelling, setCancelling] = React.useState(false)
  const [why, setWhy] = React.useState('')
  const [busy, setBusy] = React.useState('')

  async function email() {
    setBusy('mail'); setError('')
    try {
      const r = await deskApi.bookingEmail(b.id)
      onDone(`${b.booking_no} sent to ${r.to}${r.address_kind === 'personal' ? ' (personal address)' : ''}.`)
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  async function cancel() {
    if (!why.trim()) return
    setBusy('cancel'); setError('')
    try {
      await deskApi.bookingCancel(b.id, why.trim())
      setCancelling(false); setWhy('')
      onDone(`${b.booking_no} cancelled.`)
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Ico name={b.kind === 'hotel' ? 'pin' : 'plane'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}><Mono size={F.small} tone="ink">{b.booking_no}</Mono>{` · ${b.vendor}`}</Txt>
          <Txt size={F.tiny} tone="muted">
            {`${b.full_name ?? ''} ${b.emp_code ?? ''} · ${b.trip_name} · ${b.reference} · ${rs(b.amount)}${b.booked_at ? ` · ${day(b.booked_at)}` : ''}`}
          </Txt>
          <View style={{ marginTop: 4 }}>
            {b.emailed_at ? <Chip tone="t-pos" label={`Sent to ${b.emailed_to}`} />
              : b.ticket_url ? <Chip tone="t-warn" label="Not sent yet" />
                : <Chip plain label="No ticket attached" />}
          </View>
          <View style={{ marginTop: 4 }}><ContactLine contact={b.contact} /></View>
        </View>
      </View>
      {cancelling ? (
        <View style={{ marginTop: S.sm }}>
          <Flag tone="crit" style={{ marginBottom: S.sm }}>The booking is cancelled and the expense recorded against the trip is reversed. Cancelling here does not tell the airline or the hotel.</Flag>
          <Input label="Why" value={why} onChangeText={setWhy} placeholder="Trip postponed" />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button variant="outline" title="Never mind" onPress={() => { setCancelling(false); setWhy('') }} style={{ flex: 1 }} />
            <Button variant="danger" title={busy === 'cancel' ? 'Cancelling…' : 'Cancel the booking'} disabled={!why.trim() || busy === 'cancel'} onPress={() => void cancel()} style={{ flex: 1.4 }} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm, flexWrap: 'wrap' }}>
          {b.ticket_url ? (
            <Button size="sm" variant="outline" disabled={busy === 'mail'} onPress={() => void email()}
              icon={<TeIcon name="mail" size="sm" color={C.brandDeep} />}
              title={busy === 'mail' ? 'Sending…' : b.emailed_at ? 'Send again' : 'Email the ticket'} />
          ) : null}
          <Button size="sm" variant="outline" title="Details" onPress={() => onOpenTrip(b.trip_id)} />
          {mayBook ? <Button size="sm" variant="danger" title="Cancel" onPress={() => { setCancelling(true); setWhy(''); setError('') }} /> : null}
        </View>
      )}
    </View>
  )
}

export function BookedRoom({ rows, total, mayBook, onOpenTrip, onDone, setError }: {
  rows: DeskBooked[]; total: number; mayBook: boolean
  onOpenTrip: (tripId: string) => void; onDone: (message: string) => void; setError: (e: string) => void
}) {
  if (!total) {
    return <TeCard><TeEmpty title="Nothing is booked">Tickets and rooms the desk has recorded appear here, so one can be cancelled when a trip changes.</TeEmpty></TeCard>
  }
  return (
    <TeCard>
      <RoomHead title="Booked" n={total} />
      {rows.map(b => <BookedRow key={b.id} b={b} mayBook={mayBook} onOpenTrip={onOpenTrip} onDone={onDone} setError={setError} />)}
    </TeCard>
  )
}
