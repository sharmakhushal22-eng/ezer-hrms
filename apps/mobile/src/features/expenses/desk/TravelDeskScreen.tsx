// src/features/expenses/desk/TravelDeskScreen.tsx — /expenses/desk/travel, the Travel
// desk (components/te/desk/TeTravelDesk.tsx; screens a1, a1b).
//
// Offered in ESS only to members of the Travel desk (useDeskAccess, data.ts — the
// GET /api/te/desk call succeeding IS the permission). Seven rooms behind a
// segmented control with their counts; it opens on the first room that has work
// (never "For information" or "By trip"), and once somebody picks a room it stays
// put. "By trip" narrows every room to one trip and says how many rows it hides.
// A desk member without "May book" keeps everything except the two controls that
// commit money.
import * as React from 'react'
import { View } from 'react-native'
import { focusDeskRows, type WorkKind } from './buckets'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText } from '../api'
import { reloadTe, useDeskAccess, useSnap } from '../data'
import { open, teHref } from '../nav'
import { FieldErr, Note, PageHead, Seg, TeCard } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { TeIcon } from '../ui/TeIcon'
import { BookedRoom, ToBookRoom } from './BookRooms'
import { ByTrip, type Focus } from './ByTrip'
import { VehiclesRoom, WatchRoom } from './InfoRooms'
import { JourneyReview } from './JourneyReview'
import { StayChoice } from './StayChoice'
import { useDeskConfig, useDeskList } from './types'

type Room = 'trips' | 'stays' | 'book' | 'booked' | 'vehicles' | 'watch' | 'journeys'

const openTrip = (id: string) => open(teHref.trip(id))

export default function TravelDeskScreen() {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const access = useDeskAccess()
  const q = useDeskList()
  const cfg = useDeskConfig(q.isSuccess).data ?? null
  const modes = useSnap().data?.cfg.modes ?? []
  const [room, setRoom] = React.useState<Room | null>(null)
  const [focus, setFocus] = React.useState<Focus | null>(null)
  const [error, setError] = React.useState('')

  const d = q.data
  const toBook = d?.to_book ?? []
  const booked = d?.booked ?? []
  const stays = d?.stays ?? []
  const watch = d?.watch ?? []
  const journeys = d?.journeys ?? []
  const vehicles = d?.vehicles ?? []
  const chains = d?.chains ?? {}
  const mayBook = d ? d.may_book !== false : true

  const fid = focus?.tripId ?? null
  const bookings = focusDeskRows('book', toBook, fid)
  const staysHere = focusDeskRows('stays', stays, fid)
  const bookedHere = focusDeskRows('booked', booked, fid)
  const journeysHere = focusDeskRows('journeys', journeys, fid)
  const watchHere = focusDeskRows('watch', watch, fid)

  const rooms: { k: Room; label: string; icon: string; n: number }[] = [
    { k: 'trips', label: 'By trip', icon: 'route', n: 0 },
    { k: 'stays', label: 'Hotels to choose', icon: 'home', n: stays.length },
    { k: 'book', label: 'To book', icon: 'plane', n: toBook.length },
    { k: 'booked', label: 'Booked', icon: 'check', n: booked.length },
    { k: 'journeys', label: 'Journeys', icon: 'route', n: journeys.filter(j => !j.desk_confirmed_at).length },
    { k: 'watch', label: 'For information', icon: 'people', n: watch.length },
    { k: 'vehicles', label: 'Vehicles', icon: 'car', n: vehicles.length },
  ]
  const firstWithWork = rooms.find(r => r.n && r.k !== 'watch' && r.k !== 'trips')?.k ?? 'trips'
  const here = room ?? firstWithWork

  const goRoom = (k: Room, on?: Focus | null) => {
    setRoom(k)
    if (on !== undefined) setFocus(on)
    setError('')
  }
  const done = (message: string) => { notify(message); void reloadTe() }

  const shown = staysHere.length + bookings.length + bookedHere.length + journeysHere.length + watchHere.length
  const all = stays.length + toBook.length + booked.length + journeys.length + watch.length

  return (
    <TeScreen title="Travel desk" onRefresh={() => q.refetch()}>
      <PageHead title="Travel Desk" lead="Hotels to choose between, tickets and stays the company books, and the vehicles waiting to be checked." />
      {q.isError && !d ? (
        <TeCard>
          <Txt size={F.small} tone="muted">{access.travel ? errorText(q.error) : 'The Travel desk is for the people on it. An administrator adds members on the Desks screen.'}</Txt>
          <View style={{ marginTop: S.md, alignSelf: 'flex-start' }}><Button size="sm" variant="outline" title="Try again" onPress={() => void q.refetch()} /></View>
        </TeCard>
      ) : (
        <>
          <Seg label="Travel Desk" value={here} onChange={k => goRoom(k)} style={{ marginBottom: S.md }}
            items={rooms.map(r => ({ key: r.k, label: r.label, icon: r.icon, note: r.n ? String(r.n) : undefined }))} />
          {error ? <View style={{ marginBottom: S.md }}><FieldErr>{error}</FieldErr></View> : null}
          {focus ? (
            <Note icon="pin" style={{ marginBottom: S.md }}>
              <Txt size={12.5} tone="soft">
                {`Showing ${focus.tripNo} only${all > shown ? ` — ${shown} of ${all} rows across the desk` : ''}. Other trips’ work is still here.`}
              </Txt>
              <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                <Button size="sm" variant="outline" title="Show all trips" onPress={() => setFocus(null)} />
              </View>
            </Note>
          ) : null}

          {here === 'trips' ? (
            <ByTrip stays={stays} toBook={toBook} booked={booked} journeys={journeys} watch={watch}
              onGoRoom={(k: WorkKind, f) => goRoom(k, f)} onOpenTrip={openTrip} />
          ) : null}
          {here === 'stays' ? <StayChoice stays={staysHere} onDone={done} onOpenTrip={openTrip} /> : null}
          {here === 'book' ? (
            <ToBookRoom rows={bookings} loading={!d} mayBook={mayBook} chains={chains} onOpenTrip={openTrip} onDone={done} setError={setError} />
          ) : null}
          {here === 'booked' ? (
            <BookedRoom rows={bookedHere} total={booked.length} mayBook={mayBook} onOpenTrip={openTrip} onDone={done} setError={setError} />
          ) : null}
          {here === 'journeys' ? (
            <JourneyReview rows={journeysHere} desk="travel" basisOf={m => modes.find(x => x.id === m)?.basis}
              onOpenTrip={openTrip} onDone={() => void reloadTe()} onToast={m => notify(m)} />
          ) : null}
          {here === 'watch' ? <WatchRoom rows={watchHere} total={watch.length} chains={chains} onOpenTrip={openTrip} /> : null}
          {here === 'vehicles' ? (
            <VehiclesRoom rows={vehicles} vehicleTypes={cfg?.vehicles ?? []} fuelPrice={cfg?.fuelPrice ?? {}} onDone={done} setError={setError} />
          ) : null}
          {!d && q.isLoading ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TeIcon name="clock" size="sm" color={C.muted} /><Txt size={F.small} tone="muted">Loading…</Txt>
            </View>
          ) : null}
        </>
      )}
    </TeScreen>
  )
}
