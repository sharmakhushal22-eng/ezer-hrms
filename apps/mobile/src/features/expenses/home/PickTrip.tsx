// src/features/expenses/home/PickTrip.tsx — "Start an approved trip: choose the trip"
// (components/te/trip/TePickTrip.tsx, screen 07), step 3 of the entry flow.
//
// Everything is read from the snapshot; no call of its own. Owner trips only
// (approvedTrips). A journey can start on its date: canStart = next PLANNED and
// next.date <= today; the server refuses an early start either way.
import * as React from 'react'
import { View } from 'react-native'
import { approvedTrips, currentLeg, legsOf, routeText, tripDates, KIND_NAME } from '@web/te/entry-flow'
import type { TeLeg, TeTrip, TripScope, Uuid } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { day, plural } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { H4, Ico, Li, ListCard } from '../ui/kit'

export function PickTrip({ scope, me, trips, journeys, today, placeName, onStartLeg, onOpenTrip }: {
  scope: TripScope
  me: Uuid
  trips: TeTrip[]
  journeys: TeLeg[]
  today: string
  placeName: (id: Uuid) => string
  onStartLeg: (legId: Uuid, leg: TeLeg) => void
  onOpenTrip: (tripId: Uuid) => void
}) {
  const { C } = useTheme()
  const list = approvedTrips(scope, { me, trips })
  const kindLower = KIND_NAME[scope].toLowerCase()
  return (
    <View>
      <H4 style={{ marginTop: 0 }}>{`Approved ${kindLower}s`}</H4>
      <ListCard>
        {list.length ? list.map((t, i) => {
          const legs = legsOf(t, journeys)
          const next = currentLeg(legs)
          const canStart = !!next && next.status === 'PLANNED' && next.date <= today
          return (
            <Li key={t.id} last={i === list.length - 1} left={<Ico name={scope} kind={scope} />} style={{ alignItems: 'flex-start' }}>
              <Txt size={F.small} w={700}>{t.name}</Txt>
              <Txt size={F.tiny} tone="muted">{routeText(t, placeName)}</Txt>
              <Txt size={F.tiny} tone="muted">
                {tripDates(t)} · {plural(legs.length, 'journey')}{next ? ` · next: journey ${next.n}, ${day(next.date)}` : ''}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm }}>
                {canStart && next && (
                  <Button size="sm" title={next.gps === 'checkin' ? 'Check in' : `Start journey ${next.n}`}
                    icon={<TeIcon name="play" size="sm" color={C.onAccent} />} onPress={() => onStartLeg(next.id, next)} />
                )}
                <Button size="sm" variant="outline" title="Open" onPress={() => onOpenTrip(t.id)} />
              </View>
            </Li>
          )
        }) : (
          <Li last><Txt size={F.tiny} tone="muted">{`No approved ${kindLower} right now.`}</Txt></Li>
        )}
      </ListCard>
      <Txt size={F.tiny} tone="muted">A journey can start on its date. Before that, open the trip to see its journeys and bookings.</Txt>
    </View>
  )
}
