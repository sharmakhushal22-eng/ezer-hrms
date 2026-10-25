// src/ui/Logo.tsx — the EZER mark, the same vector the website draws in
// lib/ui/Logo.tsx (disc, E, three figures, orbit), minus the CSS animation.
// Gradient stops and geometry are copied verbatim; only the wordmark ink comes
// from the palette, as it does on the web.
import * as React from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from './ThemeProvider'
import { Txt } from './primitives'

export function Emblem({ size = 40, id = 'ezl' }: { size?: number; id?: string }) {
  const { C } = useTheme()
  return (
    <Svg width={size * (108 / 105)} height={size} viewBox="10 9 108 105" fill="none">
      <Defs>
        <LinearGradient id={`${id}-disc`} x1="26" y1="18" x2="104" y2="112" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#7DD3FC" /><Stop offset=".38" stopColor="#38BDF8" />
          <Stop offset=".72" stopColor="#2563EB" /><Stop offset="1" stopColor="#1E3A8A" />
        </LinearGradient>
        <RadialGradient id={`${id}-spec`} cx="42" cy="34" r="42" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity=".72" /><Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={`${id}-ring`} x1="8" y1="40" x2="120" y2="92" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#BAE6FD" stopOpacity=".15" /><Stop offset=".28" stopColor="#7DD3FC" stopOpacity=".95" />
          <Stop offset=".62" stopColor="#38BDF8" stopOpacity=".85" /><Stop offset="1" stopColor="#2563EB" stopOpacity=".18" />
        </LinearGradient>
        <LinearGradient id={`${id}-people`} x1="40" y1="6" x2="88" y2="40" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#E0F2FE" /><Stop offset="1" stopColor="#7DD3FC" />
        </LinearGradient>
        <LinearGradient id={`${id}-bar`} x1="44" y1="48" x2="92" y2="88" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" /><Stop offset="1" stopColor="#DBEAFE" />
        </LinearGradient>
      </Defs>
      <Circle cx="64" cy="66" r="46" fill={C.logoGlow} />
      <Ellipse cx="64" cy="108" rx="30" ry="5.5" fill="#1E3A8A" opacity={0.16} />
      <Circle cx="64" cy="66" r="35.2" fill="none" stroke="#1D4ED8" strokeOpacity={0.55} strokeWidth={2.2} />
      <Circle cx="64" cy="66" r="34" fill={`url(#${id}-disc)`} />
      <Circle cx="64" cy="66" r="34" fill={`url(#${id}-spec)`} />
      <Circle cx="64" cy="66" r="33" fill="none" stroke="#BAE6FD" strokeOpacity={0.45} strokeWidth={1.4}
        strokeDasharray="60 150" strokeDashoffset={-96} strokeLinecap="round" />
      <G transform="translate(0,1)" opacity={0.22}>
        <Rect x="49" y="50" width="9" height="34" rx="4.5" fill="#0C2A6B" />
        <Rect x="49" y="50" width="32" height="9" rx="4.5" fill="#0C2A6B" />
        <Rect x="49" y="61.5" width="24" height="8" rx="4" fill="#0C2A6B" />
        <Rect x="49" y="75" width="32" height="9" rx="4.5" fill="#0C2A6B" />
      </G>
      <G fill={`url(#${id}-bar)`}>
        <Rect x="49" y="49" width="9" height="34" rx="4.5" />
        <Rect x="49" y="49" width="32" height="9" rx="4.5" />
        <Rect x="49" y="60.5" width="24" height="8" rx="4" />
        <Rect x="49" y="74" width="32" height="9" rx="4.5" />
      </G>
      <G fill={`url(#${id}-people)`}>
        <Circle cx="44" cy="24" r="6" /><Path d="M34 39c0-5.5 4.5-9 10-9s10 3.5 10 9z" />
        <Circle cx="64" cy="17" r="7.5" /><Path d="M52 34c0-6.6 5.4-11 12-11s12 4.4 12 11z" />
        <Circle cx="84" cy="24" r="6" /><Path d="M74 39c0-5.5 4.5-9 10-9s10 3.5 10 9z" />
      </G>
      <Ellipse cx="64" cy="66" rx="58" ry="23" transform="rotate(-24 64 66)" fill="none" stroke={`url(#${id}-ring)`} strokeWidth={5} strokeLinecap="round" />
    </Svg>
  )
}

/** Emblem + EZER / HRMS lockup. `height` is the wordmark's type size, as on the web. */
export function Logo({ height = 28, tagline = false }: { height?: number; tagline?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: height * 0.22 }} accessibilityRole="image" accessibilityLabel="EZER HRMS">
      <Emblem size={height * 1.32} />
      <View>
        <Txt size={height * 0.86} w={800} color={C.logoWord} style={{ letterSpacing: -0.6, lineHeight: height * 0.92 }}>EZER</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: height * 0.13, marginTop: height * 0.06 }}>
          <Txt size={height * 0.34} w={700} color={C.logoWordSoft} style={{ letterSpacing: height * 0.34 * 0.34, lineHeight: height * 0.4 }}>HRMS</Txt>
          <View style={{ height: 1, width: height * 0.5, backgroundColor: C.logoWordSoft, opacity: 0.6 }} />
        </View>
        {tagline && <Txt size={height * 0.21} w={600} color={C.logoWordSoft} style={{ letterSpacing: height * 0.04, marginTop: height * 0.14 }}>PEOPLE · PROCESS · PERFORMANCE</Txt>}
      </View>
    </View>
  )
}
