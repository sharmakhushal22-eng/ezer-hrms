// src/features/team/ui.tsx — the small pieces the Team line is drawn from.
//
// Ported from the website's components/ess/team/ui.tsx + icons.tsx + team.css.
// Module-level on purpose (the website's own rule): defined inside a render
// they would remount on every keystroke.
import * as React from 'react'
import { View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

// components/ess/team/ui.tsx initials() — first letters of the first two words.
export const initials = (name: string | null | undefined) =>
  (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

// components/ess/team/ui.tsx hueOf() — a stable hue per name.
export const hueOf = (name: string | null | undefined) => {
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** team.css .tm-av: initials in hsl(h, --ez-avatar-sat, --ez-avatar-light) on a
 *  12% wash of hsl(h 82% 52%). theme.css: light 62%/28%, dark 58%/82%. */
export function TeamAvatar({ name, size = 36 }: { name: string | null; size?: number }) {
  const { isDark } = useTheme()
  const h = hueOf(name)
  const ink = isDark ? `hsl(${h}, 58%, 82%)` : `hsl(${h}, 62%, 28%)`
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size / 3), alignItems: 'center', justifyContent: 'center',
      backgroundColor: `hsla(${h}, 82%, 52%, 0.12)`, borderWidth: 1, borderColor: `hsla(${h}, 82%, 52%, 0.26)`,
    }}>
      <Txt size={size <= 24 ? 9.5 : 12} w={700} color={ink}>{initials(name)}</Txt>
    </View>
  )
}

// components/ess/team/icons.tsx
export function LineIcon({ color, size = 15 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10 2.6v14.8" />
      <Circle cx={10} cy={10} r={2.6} fill={color} stroke="none" />
      <Path d="M6.6 6 10 2.6 13.4 6M6.6 14 10 17.4 13.4 14" />
    </Svg>
  )
}
export function SelfIcon({ color, size = 15 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={10} cy={6.8} r={2.7} />
      <Path d="M4.6 16.4c0-2.9 2.4-4.6 5.4-4.6s5.4 1.7 5.4 4.6" />
    </Svg>
  )
}
export function RosterIcon({ color, size = 15 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={2.5} y={3.5} width={15} height={13} rx={2.5} />
      <Path d="M2.5 8h15M7.5 8v8.5" />
    </Svg>
  )
}

/** team.css .tm-head: icon tile + title + plain-language line. */
export function PanelHead({ icon, title, sub, right }: { icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.md, marginBottom: S.md }}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.lead} w={700}>{title}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      {right}
    </View>
  )
}

/** One person on the line — a manager above, or a report branching below. */
export function LineNode({ name, sub, rank }: { name: string | null; sub: string | null; rank?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10 }}>
      <TeamAvatar name={name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Txt size={F.small} w={600} numberOfLines={1} style={{ flexShrink: 1 }}>{name || '-'}</Txt>
          {!!rank && (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.sm, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge }}>
              <Txt size={10.5} w={700} tone="brand" numberOfLines={1}>{rank}</Txt>
            </View>
          )}
        </View>
        <Txt size={11.5} tone="muted" numberOfLines={1}>{sub || '-'}</Txt>
      </View>
    </View>
  )
}

/** Four skeleton rows (ui.tsx LineSkeleton). */
export function LineSkeleton() {
  const { C } = useTheme()
  return (
    <View accessibilityLabel="Loading" style={{ gap: S.md, paddingVertical: S.sm }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.sunken }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 10, width: '55%', borderRadius: 5, backgroundColor: C.sunken }} />
            <View style={{ height: 8, width: '35%', borderRadius: 4, backgroundColor: C.sunken }} />
          </View>
        </View>
      ))}
    </View>
  )
}

export function YouDot() {
  const { C } = useTheme()
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
      <SelfIcon color={C.onAccent} />
    </View>
  )
}

/** The rail the chain is threaded on (team.css .tl-up::before / .tl-down::before). */
export function Rail({ children, indent }: { children: React.ReactNode; indent?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ position: 'relative', paddingLeft: indent ? 26 : 0 }}>
      <View style={{ position: 'absolute', left: 17, top: indent ? -8 : 28, bottom: indent ? 28 : -8, width: 2, borderRadius: 2, backgroundColor: C.brand, opacity: 0.35 }} />
      {children}
    </View>
  )
}

export function SectionLabel({ children, indent }: { children: React.ReactNode; indent?: boolean }) {
  return <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: S.sm, marginBottom: 2, paddingLeft: indent ? 26 : 0 }}>{children}</Txt>
}

export function EmptyLine({ children }: { children: string }) {
  return <Txt size={F.tiny} tone="muted" style={{ paddingVertical: S.sm }}>{children}</Txt>
}
