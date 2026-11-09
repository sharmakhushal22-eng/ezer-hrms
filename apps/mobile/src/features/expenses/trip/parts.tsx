// src/features/expenses/trip/parts.tsx — small pieces the trip and journey screens share:
// the card header (.ch h3 + right side), the brand icon square (.ico-b), the
// .act choice button, the stats tile (.tile) and the food meter (.meter).
import * as React from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { HERO } from '../tones'
import { TeIcon } from '../ui/TeIcon'

/** .ch — a card's heading row: h3 on the left, chips / a button on the right. */
export function CardHead({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: S.sm, marginBottom: S.sm }}>
      {typeof title === 'string' ? <Txt size={F.lead} w={700} style={{ flexShrink: 1 }}>{title}</Txt> : title}
      {right != null ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{right}</View> : null}
    </View>
  )
}

/** .ico-b (.sm) — the brand-tint icon square. `glass` = inside an .act.pri. */
export function IcoB({ name, sm, glass }: { name: string; sm?: boolean; glass?: boolean }) {
  const { C } = useTheme()
  const size = sm ? 28 : 34
  return (
    <View style={{ width: size, height: size, borderRadius: sm ? 8 : 10, alignItems: 'center', justifyContent: 'center', backgroundColor: glass ? HERO.glass : C.brandTint }}>
      <TeIcon name={name} size="sm" color={glass ? C.onAccent : C.brand} />
    </View>
  )
}

/** .act (+ .pri, + .flat) — a big choice button: icon, bold line, small line. */
export function Act({ icon, title, note, pri, flat, onPress }: { icon: string; title: string; note?: string; pri?: boolean; flat?: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: R.lg, borderWidth: 1,
        borderColor: pri ? C.brand : pressed ? C.brand : C.line,
        backgroundColor: pri ? (pressed ? C.brandDeep : C.brand) : C.surface,
        padding: flat ? 10 : 14, paddingHorizontal: flat ? 12 : 14, minHeight: flat ? 52 : 64,
      }, !flat && elevation(C, 1)]}>
      <IcoB name={icon} sm={flat} glass={pri} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14.5} w={700} color={pri ? C.onAccent : C.ink}>{title}</Txt>
        {!!note && <Txt size={F.tiny} color={pri ? C.onAccent : C.muted} style={pri ? { opacity: 0.85 } : undefined}>{note}</Txt>}
      </View>
    </Pressable>
  )
}

/** .tile — one number with its label and a small note. Two to a row on a phone. */
export function Tile({ label, value, note, style }: { label: string; value: string; note: string; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ flexGrow: 1, flexBasis: '45%', minWidth: 0, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 14 }, style]}>
      <Txt size={F.tiny} tone="muted">{label}</Txt>
      <Txt size={20} w={600} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
      <Txt size={F.tiny} tone="muted">{note}</Txt>
    </View>
  )
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>{children}</View>
}

/** .meter (.close, .over) — a label, a figure, a bar and a line under it. */
export function Meter({ label, figure, pct, tone, note }: { label: string; figure: string; pct: number; tone: 'ok' | 'close' | 'over'; note: string }) {
  const { C } = useTheme()
  const bar = tone === 'over' ? C.critical : tone === 'close' ? C.warning : C.brand
  const track = tone === 'over' ? C.criticalTint : tone === 'close' ? C.warningTint : C.brandTint
  return (
    <View style={{ gap: 5, marginTop: S.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Txt size={12.5}>{label}</Txt>
        <Txt size={12.5} style={{ fontVariant: ['tabular-nums'] }}>{figure}</Txt>
      </View>
      <View style={{ height: 8, borderRadius: 99, backgroundColor: track, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 99, backgroundColor: bar }} />
      </View>
      <Txt size={F.tiny} tone="muted">{note}</Txt>
    </View>
  )
}

/** .ln — the small journey number box on a route row. */
export function LegNo({ n }: { n: number }) {
  const { C } = useTheme()
  return (
    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 7, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={11.5} w={700} tone="soft">{String(n)}</Txt>
    </View>
  )
}
