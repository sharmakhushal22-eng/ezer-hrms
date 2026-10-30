// src/features/expenses/home/KindTiles.tsx — the four kind tiles (TeHome KINDS), shared by
// Home and the "New claim" sheet, with their badges:
//   · "On the way" (green dot) when a continueItems() row of that kind is `live`;
//   · else "<n> to do" (trip kinds) / "<n> unclaimed" (Other expense).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { Snapshot, TripScope } from '@web/te/types'
import { continueItems } from '@web/te/entry-flow'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'
import { KindSquare } from '../ui/kit'
import { kindColors, type KindId } from '../tones'
import { homeFigures, modeNameOf, placeNameOf } from '../data'

export const KINDS: { id: KindId; title: string; text: string; foot: string }[] = [
  { id: 'local', title: 'Local trip', text: 'Office, factory, client or warehouse in your city. Back the same day.', foot: 'Any travel except flight' },
  { id: 'domestic', title: 'Domestic trip', text: 'Another city in India. Flights, trains, cabs, hotel and food in one trip.', foot: 'Flight or any travel' },
  { id: 'international', title: 'International trip', text: 'Any country. Flights, cabs abroad, hotel and food in one trip.', foot: 'Any country' },
  { id: 'other', title: 'Other expense', text: 'Client meal, courier, parking, printing. A bill with no travel.', foot: 'Bill with no trip' },
]

/** The facts entry-flow.ts reads, from one snapshot. */
export function entryFacts(snap: Snapshot) {
  return { me: snap.me, today: snap.today, trips: snap.trips, journeys: snap.journeys, placeName: placeNameOf(snap), modeName: modeNameOf(snap) }
}

/** TeHome's `todo` and `live` per kind. */
export function kindBadges(snap: Snapshot) {
  const facts = entryFacts(snap)
  const { unclaimed } = homeFigures(snap)
  const nowBy = {
    local: continueItems('local', facts),
    domestic: continueItems('domestic', facts),
    international: continueItems('international', facts),
  }
  const todo: Record<KindId, string> = {
    other: unclaimed.length ? `${unclaimed.length} unclaimed` : '',
    local: nowBy.local.length ? `${nowBy.local.length} to do` : '',
    domestic: nowBy.domestic.length ? `${nowBy.domestic.length} to do` : '',
    international: nowBy.international.length ? `${nowBy.international.length} to do` : '',
  }
  const live: Record<KindId, boolean> = {
    local: nowBy.local.some(x => x.tone === 'live'),
    domestic: nowBy.domestic.some(x => x.tone === 'live'),
    international: nowBy.international.some(x => x.tone === 'live'),
    other: false,
  }
  return { todo, live }
}

function KindTile({ k, badge, live, onPress }: { k: typeof KINDS[number]; badge: string; live: boolean; onPress: () => void }) {
  const { C } = useTheme()
  const kc = kindColors(C, k.id)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={k.title}
      style={({ pressed }) => [{ width: '48.5%', borderRadius: R.card, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...elevation(C, 1), transform: [{ translateY: pressed ? 1 : 0 }] }]}>
      <LinearGradient colors={[kc.kt, C.surface]} locations={[0, 0.58]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }}
        style={{ minHeight: 168, padding: 14, gap: 10 }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -34, top: -34, width: 120, height: 120, borderRadius: 60, backgroundColor: kc.k, opacity: 0.07 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <KindSquare kind={k.id} size={44} />
          {(live || !!badge) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: kc.k + '59' }}>
              {live && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.positive }} />}
              <Txt size={11} w={700} color={kc.k} numberOfLines={1}>{live ? 'On the way' : badge}</Txt>
            </View>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size={16} w={700}>{k.title}</Txt>
          <Txt size={12} tone="soft" numberOfLines={3}>{k.text}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <Txt size={11.5} w={500} tone="muted" style={{ flex: 1 }} numberOfLines={1}>{k.foot}</Txt>
          <TeIcon name="go" size="sm" color={kc.k} />
        </View>
      </LinearGradient>
    </Pressable>
  )
}

/** The grid. `onPick('other')` = the expense form; any trip kind = step 2 of the entry flow. */
export function KindTiles({ snap, onPick }: { snap: Snapshot; onPick: (kind: TripScope | 'other') => void }) {
  const { todo, live } = kindBadges(snap)
  return (
    <View accessibilityRole="list" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: S.md - 2 }}>
      {KINDS.map(k => (
        <KindTile key={k.id} k={k} badge={todo[k.id]} live={live[k.id]} onPress={() => onPick(k.id)} />
      ))}
    </View>
  )
}

export const KIND_TEXT = (kind: KindId) => KINDS.find(k => k.id === kind)?.text
