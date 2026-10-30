// src/features/expenses/home/OnTripCard.tsx — Home's card for the trip that still
// wants something from you (components/te/TeHome.tsx, `.card.ontrip`, since 4a92155).
//
// Which trip: tripForHomeCard (lib/te/trips-list, tested) — a trip under way, or
// one you are back from with the claim not sent. Which actions: tripHero, the
// same rule the trip screen uses. Nothing at all when there is no such trip.
//
// "Add a journey" opens the add-a-journey sheet (/expenses/add-leg?trip=), which
// reads the trip's detail itself — the website's openAddLeg() fetch-then-open.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot } from '@web/te/types'
import { tripForHomeCard, tripHero } from '@web/te/trips-list'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { open, teHref } from '../nav'
import { Chip, TeCard } from '../ui/kit'
import { MONO } from '../tones'
import { TeIcon } from '../ui/TeIcon'

export function OnTripCard({ snap }: { snap: Snapshot }) {
  const { C } = useTheme()
  const t = tripForHomeCard(snap.trips, snap.me)
  if (!t) return null
  const can = tripHero(t, { canBill: true, mine: true })
  const underWay = t.display === 'ONGOING'
  const openTrip = () => open(teHref.trip(t.id))
  return (
    <TeCard style={{ marginBottom: S.lg, borderLeftWidth: 3, borderLeftColor: underWay ? C.positive : C.warning }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.micro} w={700} tone="muted" upper>{underWay ? 'You are on a trip' : 'Back from a trip'}</Txt>
          <Txt size={F.body} w={700} style={{ marginTop: 2 }}>{t.name || t.no}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* The number IS the trip, so it opens it. */}
            <Pressable onPress={openTrip} accessibilityRole="link" hitSlop={8}
              accessibilityLabel={`Open ${t.no} — the journeys, the bills, the stay and what it has cost so far`}>
              <Txt size={12} w={600} color={C.brand} style={{ fontFamily: MONO, textDecorationLine: 'underline' }}>{t.no}</Txt>
            </Pressable>
            {t.to ? <Txt size={F.tiny} tone="muted">{` · ${t.to}`}</Txt> : null}
          </View>
        </View>
        <Chip tone={underWay ? 't-pos' : 't-warn'} label={underWay ? 'On the way' : 'Not claimed yet'} />
      </View>
      <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>
        {underWay
          ? 'Paid for something, or hopping across the city? Put it on the trip now and it is paid with the rest of it, instead of becoming a loose bill you have to explain later.'
          : 'Add the hotel, the food and anything else you paid for, and any journey you did not record at the time. Then send the claim.'}
      </Txt>
      {can.bill || can.journey ? (
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
          {can.bill ? (
            <View style={{ flex: 1 }}>
              <Button title="Add a bill" size="lg" full onPress={() => open(teHref.expense({ trip: t.id }))}
                icon={<TeIcon name="receipt" color={C.onAccent} />} />
            </View>
          ) : null}
          {can.journey ? (
            <View style={{ flex: 1 }}>
              <Button title="Add a journey" variant="positive" size="lg" full onPress={() => open(teHref.addLeg(t.id))}
                icon={<TeIcon name="route" color={C.onAccent} />} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ marginTop: S.sm, borderRadius: R.sm }}>
        <Button title="Open the trip" variant="outline" size="sm" full onPress={openTrip}
          icon={<TeIcon name="go" size="sm" color={C.brandDeep} />} />
      </View>
    </TeCard>
  )
}
