// src/features/intro/Lobby.tsx — the two things the entrance and the login screen
// share: the logo block, and the lobby you are standing in once you are through
// the doors (the login screen's background).
import * as React from 'react'
import { useWindowDimensions, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Line, Rect } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Logo } from '@/ui/Logo'

export function LobbyHeader({ line, ink, soft }: { line: string; ink?: string; soft?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ alignItems: 'center' }}>
      <Logo height={30} tagline ink={ink} inkSoft={soft} />
      <Txt size={17} center color={ink || C.ink} style={{ fontFamily: SERIF, marginTop: 12, lineHeight: 22 }}>{line}</Txt>
    </View>
  )
}

/** The glass wall behind the reception card, and the street you came in from. */
export function LobbyBackdrop() {
  const { C, isDark } = useTheme()
  const { width: W, height: H } = useWindowDimensions()
  const top = H * 0.46, foot = 92
  const stroke = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(37,99,235,0.07)'
  const block = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(37,99,235,0.06)'
  const u = W / 360
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.canvas }}>
      <LinearGradient colors={isDark ? ['#12235A', C.canvas] : ['#DBEAFE', C.canvas]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: top }} />
      <Svg width={W} height={top} style={{ position: 'absolute', top: 0 }}>
        {[1, 2, 3, 4, 5].map(i => <Line key={i} x1={(W / 6) * i} y1={0} x2={(W / 6) * i} y2={top} stroke={stroke} strokeWidth={1} />)}
        <Line x1={0} y1={top * 0.52} x2={W} y2={top * 0.52} stroke={stroke} strokeWidth={1} />
      </Svg>
      <Svg width={W} height={foot} style={{ position: 'absolute', bottom: 0 }}>
        <Rect x={18 * u} y={foot - 44} width={44 * u} height={44} fill={block} />
        <Rect x={66 * u} y={foot - 68} width={36 * u} height={68} fill={block} />
        <Rect x={134 * u} y={foot - 88} width={92 * u} height={88} fill={block} />
        <Rect x={248 * u} y={foot - 58} width={40 * u} height={58} fill={block} />
        <Rect x={292 * u} y={foot - 36} width={50 * u} height={36} fill={block} />
      </Svg>
    </View>
  )
}
