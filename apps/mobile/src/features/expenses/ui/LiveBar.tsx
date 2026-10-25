// src/features/expenses/ui/LiveBar.tsx — a journey is running while you are elsewhere
// (components/te/leg/TeLiveBar.tsx, screen e3).
//
// A pointer, not a second recorder: it starts no watcher and sends nothing. The
// recorder collects fixes only while its own screen is open (as on the website),
// and this bar says so and is the one-tap way back.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { TeLeg } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from './TeIcon'

export function LiveBar({ leg, tripName, placeName, onOpen }: {
  leg: TeLeg
  tripName: string
  placeName: (id: string) => string
  onOpen: (leg: TeLeg) => void
}) {
  const { C } = useTheme()
  const state = leg.status === 'PAUSED' ? 'At a stop'
    : leg.gps === 'checkin' ? (leg.mode === 'flight' ? 'In flight' : 'On the way')
      : 'Travelling now'
  return (
    <Pressable onPress={() => onOpen(leg)} accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.positiveTint, borderWidth: 1, borderColor: C.positive,
        borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14, opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.positive, borderWidth: 3, borderColor: C.positiveEdge }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small}>
          <Txt size={F.small} w={700}>{state}</Txt>
          {` ${tripName} · journey ${leg.n}: ${placeName(leg.from)} → ${placeName(leg.to)}`}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Txt size={F.tiny} w={600} tone="positive">{leg.gps === 'checkin' ? 'Open' : 'Not recording here'}</Txt>
        <TeIcon name="go" size="sm" color={C.positive} />
      </View>
    </Pressable>
  )
}
