// src/features/payroll-benefits/ui.tsx — the small building blocks the VPF, NPS,
// Loans and Travel Claims screens repeat (EmployeePortal.tsx `card`, `row`, the
// tinted callouts, the two-way choice buttons, the status pills).
// All defined at module level so typing never remounts an input.
import * as React from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

/** The screen's own title block ("Voluntary PF (VPF)" + one line). */
export function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Txt size={F.title} w={600}>{title}</Txt>
      <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>
    </View>
  )
}

/** The website's `card` (radius 14, padding 16, margin 14) with an optional fill. */
export function Box({ children, bg, edge, style }: { children: React.ReactNode; bg?: string; edge?: string; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ backgroundColor: bg || C.surface, borderWidth: 1, borderColor: edge || C.line, borderRadius: R.lg, padding: S.lg, marginBottom: 14 }, style]}>
      {children}
    </View>
  )
}

/** A label on the left, a value on the right — the website's `row`. */
export function Line({ label, value, labelColor, valueColor, valueSize = 13, valueWeight = 400, top, labelSize = 13 }: {
  label: string; value: React.ReactNode; labelColor?: string; valueColor?: string; valueSize?: number; valueWeight?: 400 | 500 | 600 | 700; top?: boolean; labelSize?: number
}) {
  const { C } = useTheme()
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm, paddingVertical: 5 }, top && { borderTopWidth: 1, borderTopColor: C.line }]}>
      <Txt size={labelSize} color={labelColor || C.muted} style={{ flexShrink: 1 }}>{label}</Txt>
      {typeof value === 'string' || typeof value === 'number'
        ? <Txt size={valueSize} w={valueWeight} color={valueColor || C.ink}>{value}</Txt>
        : value}
    </View>
  )
}

/** A tinted callout box (criticalTint / warningTint / brandTint) with text in the tone's ink. */
export function Callout({ bg, children, style }: { bg: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: bg, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14 }, style]}>{children}</View>
}

/** Rounded pill — LoanStatusBadge / TravelClaims Pill. */
export function Pill({ bg, fg, text }: { bg: string; fg: string; text: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, backgroundColor: bg }}>
      <Txt size={10} w={600} color={fg} numberOfLines={1}>{text}</Txt>
    </View>
  )
}

/** One of a pair of toggle buttons ("Yes, I have a PRAN" | "No, I need one", "E-sign" | "Upload signed PDF"). */
export function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1, minHeight: 44, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.sm,
        borderWidth: selected ? 2 : 1, borderColor: selected ? C.brand : C.line,
        backgroundColor: selected ? C.canvas : pressed ? C.brandTint : C.surface,
      })}>
      <Txt size={F.small} w={500} color={selected ? C.brandDeep : C.ink} center>{label}</Txt>
    </Pressable>
  )
}

/** A compact outlined action in a given colour ("Stop VPF", "Foreclose", "Part-payment"). */
export function SmallAction({ title, color, onPress, disabled, filled }: { title: string; color: string; onPress: () => void; disabled?: boolean; filled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 38, paddingHorizontal: 14, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: color, backgroundColor: filled ? color : C.surface, opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}>
      <Txt size={F.tiny} w={600} color={filled ? C.onAccent : color} numberOfLines={1}>{title}</Txt>
    </Pressable>
  )
}

/** Bulleted text lines inside a callout. */
export function Bullets({ lines, color }: { lines: React.ReactNode[]; color: string }) {
  return (
    <View style={{ marginTop: 2 }}>
      {lines.map((l, i) => <Txt key={i} size={F.tiny} color={color} style={{ lineHeight: 20 }}>• {l}</Txt>)}
    </View>
  )
}

/** A figure tile inside a hero card (PayStyles' ezp-tile): a small name over a figure. */
export function Tile({ name, value, unit }: { name: string; value: string; unit?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Txt size={F.micro} tone="muted">{name}</Txt>
      <Txt size={F.lead} w={700} style={{ marginTop: 2 }}>{value}{!!unit && <Txt size={F.micro} tone="muted">{unit}</Txt>}</Txt>
    </View>
  )
}
