// src/features/profile/bits.tsx — the small building blocks Profile360 repeats:
// Section (h4 + sub), the plain/brand/good/warn pills, an empty card, the
// "Elsewhere" block, and the section sub-tab row (My Details / Letter Requests
// / My Letters — EmployeePortal.tsx SubTabs).
import * as React from 'react'
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { router } from 'expo-router'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, toneOf } from '@/ui/theme'
import { Card, Segmented, Txt } from '@/ui/primitives'
import { sectionOf } from '@/core/nav'

export function Section({ title, sub, children, style }: { title: string; sub?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: S.lg }, style]}>
      <Txt size={F.lead} w={700}>{title}</Txt>
      {!!sub && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>}
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

/** A block this profile genuinely does not hold — named, not left blank. */
export function Elsewhere({ title, owner }: { title: string; owner: string }) {
  return (
    <Section title={title}>
      <EmptyCard>Kept in {owner}, which owns it. Named here so the profile does not look as though it is missing something it never held.</EmptyCard>
    </Section>
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

/** The Profile section's three sub-tabs, as on the website. */
export function ProfileSubTabs({ current }: { current: 'profile' | 'documents' | 'letters' }) {
  const s = sectionOf('profile')
  const items = (s?.items || []).map(i => ({ key: i.k as 'profile' | 'documents' | 'letters', label: i.label }))
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
