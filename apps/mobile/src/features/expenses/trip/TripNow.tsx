// src/features/expenses/trip/TripNow.tsx — "while you are travelling"
// (components/te/trip/TeTripNow.tsx): the two mid-trip actions as hero tiles at the
// top of the trip (Add a bill · Add a journey), and the "Recording now" strip.
//
// The strip is sticky on the web (position: sticky under the header); here it
// leads the page, because TeScreen has no under-header slot (wish listed). The web's slim "On this trip" bar that appears once the tiles scroll
// away needs a scroll callback the shared Screen does not expose yet, so it is
// not drawn (listed as a wish); both actions stay reachable further down the
// page (Bills card, Route card), exactly as on the web.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { TeLeg } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'

function HeroTile({ icon, title, text, foot, tone, onPress }: {
  icon: string; title: string; text: string; foot: string; tone: 'brand' | 'positive'; onPress: () => void
}) {
  const { C } = useTheme()
  const k = tone === 'brand' ? C.brand : C.positive
  const kt = tone === 'brand' ? C.brandTint : C.positiveTint
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [{ flex: 1, minWidth: 0, borderRadius: R.card, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...elevation(C, 1), transform: [{ translateY: pressed ? 1 : 0 }] }]}>
      <LinearGradient colors={[kt, C.surface]} locations={[0, 0.6]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }}
        style={{ flex: 1, minHeight: 150, padding: 12, gap: 8 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: k }}>
          <TeIcon name={icon} size="lg" color={C.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={F.body} w={700}>{title}</Txt>
          <Txt size={F.tiny} tone="muted">{text}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <Txt size={11} w={700} color={k} numberOfLines={1} style={{ flexShrink: 1 }}>{foot}</Txt>
          <TeIcon name="go" size="sm" color={k} />
        </View>
      </LinearGradient>
    </Pressable>
  )
}

/** The hero tiles. Renders nothing for a reader who may do neither. */
export function TripNowTiles({ canBill, mine, onAddBill, onAddLeg }: {
  canBill: boolean; mine: boolean; onAddBill: () => void; onAddLeg: () => void
}) {
  if (!canBill && !mine) return null
  return (
    <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.md }}>
      {canBill ? (
        <HeroTile icon="receipt" tone="brand" title="Add a bill" onPress={onAddBill}
          text="The hotel, a meal, a cab — anything you paid for on this trip." foot="Paid with this trip" />
      ) : null}
      {mine ? (
        <HeroTile icon="route" tone="positive" title="Add a journey" onPress={onAddLeg}
          text="Travelling across the city? GPS records the route and the distance." foot="Starts in two taps" />
      ) : null}
    </View>
  )
}

/** .recnow — a journey of this trip is being recorded. */
export function RecordingNow({ leg, nameOf, onOpen }: { leg: TeLeg; nameOf: (id: string) => string; onOpen: (l: TeLeg) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: S.md, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.positive, borderRadius: R.md, backgroundColor: C.positiveTint, ...elevation(C, 1) }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.positive, borderWidth: 2, borderColor: C.positiveEdge }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={11} w={700} upper color={C.positive}>Recording now</Txt>
        <Txt size={F.small} w={700} numberOfLines={1}>{`Journey ${leg.n}: ${nameOf(leg.from)} → ${nameOf(leg.to)}`}</Txt>
      </View>
      <Button size="sm" title="Open it" icon={<TeIcon name="play" size="sm" color={C.onAccent} />} onPress={() => onOpen(leg)} />
    </View>
  )
}
