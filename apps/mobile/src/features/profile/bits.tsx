// src/features/profile/bits.tsx — the small building blocks Profile360 repeats:
// Section (h4 + sub), the plain/brand/good/warn pills, an empty card, and the section sub-tab row (My Details / Letter Requests
// / My Letters — EmployeePortal.tsx SubTabs).
import * as React from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { router } from 'expo-router'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, toneOf } from '@/ui/theme'
import { Card, Segmented, Txt } from '@/ui/primitives'
import { sectionOf } from '@/core/nav'

export function Section({ title, sub, right, children, style }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: S.lg }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.lead} w={700}>{title}</Txt>
          {!!sub && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>}
        </View>
        {right}
      </View>
      <View style={{ marginTop: S.sm }}>{children}</View>
    </View>
  )
}

export type PillKind = 'plain' | 'brand' | 'good' | 'warn' | 'bad'
export function Pill({ label, kind = 'plain' }: { label: string; kind?: PillKind }) {
  const { C } = useTheme()
  const t = toneOf(C, kind === 'brand' ? 'brand' : kind === 'good' ? 'positive' : kind === 'warn' ? 'warning' : kind === 'bad' ? 'critical' : 'neutral')
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: t.bg, borderWidth: 1, borderColor: t.edge }}>
      <Txt size={F.micro} w={600} color={t.fg}>{label}</Txt>
    </View>
  )
}

/** `.empty` text inside a card. */
export function EmptyText({ children }: { children: React.ReactNode }) {
  return <Txt size={F.small} tone="faint" style={{ paddingVertical: S.sm }}>{children}</Txt>
}
export function EmptyCard({ children }: { children: React.ReactNode }) {
  return <Card><EmptyText>{children}</EmptyText></Card>
}

/** The `.lnk` text button. */
export function Lnk({ label, onPress, size = F.small }: { label: string; onPress: () => void; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 4 }}>
      <Txt size={size} w={600} tone="brand">{label}</Txt>
    </Pressable>
  )
}

/** A card heading row: title (+ sub) left, something on the right. */
export function CardHead({ title, sub, right }: { title?: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginBottom: S.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {!!title && <Txt size={F.body} w={700}>{title}</Txt>}
        {!!sub && <Txt size={F.tiny} tone="muted">{sub}</Txt>}
      </View>
      {right}
    </View>
  )
}

/** The Profile section's sub-tabs, as on the website: My Details, Letter
 *  Requests, My Letters, Documents to sign ('to-sign' → /esign, owned by the
 *  e-sign module). Driven by the nav entry, so a new sub-tab shows up here. */
export function ProfileSubTabs({ current }: { current: 'profile' | 'documents' | 'letters' }) {
  const s = sectionOf('profile')
  const items = (s?.items || []).map(i => ({ key: i.k, label: i.label }))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: S.lg, paddingVertical: S.sm }}>
      <Segmented items={items} value={current} onChange={k => {
        if (k === current) return
        const to = s?.items.find(i => i.k === k)?.route
        if (to) router.replace(to as any)
      }} />
    </ScrollView>
  )
}

/** A `.chain` row: a round tile (initials, an emoji, or a dot), a name and a line under it. */
export function ChainRow({ tile, n, r, me, first }: { tile: string; n: string; r: string; me?: boolean; first?: boolean }) {
  const { C } = useTheme()
  const dot = tile === ''
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      {dot ? (
        <View style={{ width: 36, alignItems: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.brand }} />
        </View>
      ) : (
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: me ? C.brand : C.brandTint, borderWidth: 1, borderColor: C.brandEdge }}>
          <Txt size={F.small} w={700} color={me ? C.onAccent : C.brandDeep}>{tile}</Txt>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={600}>{n}</Txt>
        <Txt size={F.tiny} tone="muted">{r}</Txt>
      </View>
    </View>
  )
}
