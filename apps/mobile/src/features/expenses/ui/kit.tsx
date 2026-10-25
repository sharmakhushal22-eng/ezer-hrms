// src/features/expenses/ui/kit.tsx — te.css's building blocks, for the phone.
//
// Each export is one recurring class of components/te/te.css, drawn with the
// app palette so light and dark both work:
//   Chip      .chip (+ .plain, + .t-*)          a pill with a 6px dot in its colour
//   Flag      .flag.crit/.warn/.info/.ok/.off   a tinted row with an icon
//   Note      .note (+ .warn)                   a brand-tint hint line with an icon
//   H4        .sec > h4                         a section heading
//   PageHead  .ph h1 + p                        a page title block
//   ListCard  .card.pad0 + .day                 a card holding rows, with a header line
//   Li        .li (.click)                      one row: icon square, text, right side
//   Ico       .ico (+ .k-<kind>)                the 36px icon square on a row
//   Seg       .seg (aria-pressed buttons)       a segmented choice
//   Opt       button.opt (aria-pressed)         a toggle chip in a wrap row
//   KvRow     dl.kv > dt/dd                     label on the left, value on the right
//   Mono      .mono                             numbers like claim no / reg no
//   Sunk      .sunk                             a sunken well
// Sub-components live at module level (the repo's focus-loss rule).
import * as React from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from './TeIcon'
import { flagColors, kindColors, MONO, toneColors, type FlagTone, type TeTone } from '../tones'

// ── Chip ────────────────────────────────────────────────────────────────────
export function Chip({ label, tone, plain, icon, style }: {
  label: React.ReactNode
  /** 't-pos' | 't-warn' | 't-crit' | 't-info' | 't-brand' | 'plain' | '' */
  tone?: TeTone
  /** .chip.plain: no dot. */
  plain?: boolean
  /** A TeIcon name drawn before the label (the scope / mode chips). */
  icon?: string
  style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  const t = toneColors(C, tone)
  const hasTone = !!tone && tone !== 'plain'
  const noDot = plain || tone === 'plain' || !!icon
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
      paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill,
      backgroundColor: t.bg, borderWidth: 1, borderColor: hasTone ? 'transparent' : C.line,
    }, style]}>
      {!noDot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.fg }} />}
      {!!icon && <TeIcon name={icon} px={12} color={t.fg} />}
      {typeof label === 'string' || typeof label === 'number'
        ? <Txt size={11.5} w={600} color={t.fg} numberOfLines={1}>{label}</Txt>
        : label}
    </View>
  )
}

// ── Flag ────────────────────────────────────────────────────────────────────
export function Flag({ tone, icon, title, children, off, style }: {
  tone: FlagTone
  /** TeIcon name; defaults: crit/warn → alert, info → info, ok → check. */
  icon?: string
  title?: React.ReactNode
  children?: React.ReactNode
  /** .flag.off — dimmed. */
  off?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  const t = flagColors(C, tone)
  const ic = icon ?? (tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert')
  return (
    <View style={[{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 10, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: t.bg, opacity: off ? 0.6 : 1 }, style]}>
      <View style={{ paddingTop: 1 }}><TeIcon name={ic} color={t.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {title != null && (typeof title === 'string' ? <Txt size={F.small} w={700}>{title}</Txt> : title)}
        {typeof children === 'string' ? <Txt size={12.5} tone="soft">{children}</Txt> : children}
      </View>
    </View>
  )
}

// ── Note ────────────────────────────────────────────────────────────────────
export function Note({ children, icon = 'info', warn, style }: { children: React.ReactNode; icon?: string; warn?: boolean; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const bg = warn ? C.warningTint : C.brandTint
  const fg = warn ? C.warning : C.brand
  return (
    <View style={[{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: bg }, style]}>
      <View style={{ paddingTop: 1 }}><TeIcon name={icon} size="sm" color={fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof children === 'string' ? <Txt size={12.5} tone="soft">{children}</Txt> : children}
      </View>
    </View>
  )
}

// ── Headings ────────────────────────────────────────────────────────────────
export function H4({ children, style, right }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; right?: React.ReactNode }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, marginTop: S.lg, marginBottom: S.sm }, style]}>
      <Txt size={F.lead} w={700} style={{ flexShrink: 1 }}>{children}</Txt>
      {right}
    </View>
  )
}

export function PageHead({ title, lead, right }: { title: string; lead?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ marginBottom: S.lg, flexDirection: 'row', alignItems: 'flex-start', gap: S.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.page} w={700}>{title}</Txt>
        {lead != null && (typeof lead === 'string' ? <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>{lead}</Txt> : lead)}
      </View>
      {right}
    </View>
  )
}

// ── Lists ───────────────────────────────────────────────────────────────────
/** .card.pad0, with an optional `.day` header (left text, right text). */
export function ListCard({ head, headRight, children, style }: { head?: React.ReactNode; headRight?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginBottom: S.md }, style]}>
      {(head != null || headRight != null) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: 10, backgroundColor: C.sunken, borderBottomWidth: 1, borderBottomColor: C.line }}>
          {typeof head === 'string' ? <Txt size={F.tiny} w={700} tone="muted" upper style={{ flexShrink: 1 }}>{head}</Txt> : head}
          {typeof headRight === 'string' || typeof headRight === 'number' ? <Txt size={F.tiny} w={700} tone="muted">{headRight}</Txt> : headRight}
        </View>
      )}
      {children}
    </View>
  )
}

/** One row of a ListCard. Tapping it = the website's `.li.click`. */
export function Li({ left, children, right, onPress, last, style, accessibilityLabel }: {
  left?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; onPress?: () => void; last?: boolean
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string
}) {
  const { C } = useTheme()
  const body = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>{children}</View>
      {right}
    </>
  )
  const base: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, minHeight: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }
  if (!onPress) return <View style={[base, style]}>{body}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { backgroundColor: C.brandTint }, style]}>
      {body}
    </Pressable>
  )
}

/** .ico — the icon square on a row. `kind` paints it .k-<kind> (local/domestic/international/other). */
export function Ico({ name, kind, size = 36 }: { name: string; kind?: string; size?: number }) {
  const { C } = useTheme()
  const k = kind ? kindColors(C, kind) : null
  return (
    <View style={{ width: size, height: size, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: k ? k.kt : C.sunken }}>
      <TeIcon name={name} color={k ? k.k : C.inkSoft} />
    </View>
  )
}

/** The solid kind square (.kind .ki / .hk / .kindrow .ki): kind colour fill, surface-coloured icon. */
export function KindSquare({ kind, size = 44, icon }: { kind: string; size?: number; icon?: string }) {
  const { C } = useTheme()
  const k = kindColors(C, kind)
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), alignItems: 'center', justifyContent: 'center', backgroundColor: k.k }}>
      <TeIcon name={icon ?? kind} size={size >= 40 ? 'lg' : 'sm'} color={C.surface} />
    </View>
  )
}

// ── Choices ─────────────────────────────────────────────────────────────────
/** .seg — a row of pressed / not-pressed buttons. */
export function Seg<K extends string>({ items, value, onChange, label, style }: {
  items: { key: K; label: string; icon?: string; note?: React.ReactNode }[]
  value: K | null | undefined
  onChange: (k: K) => void
  label?: string
  style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  return (
    <View accessibilityLabel={label} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 3, borderRadius: R.md + 2, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start' }, style]}>
      {items.map(it => {
        const on = it.key === value
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: C.brandEdge }}>
            {!!it.icon && <TeIcon name={it.icon} size="sm" color={on ? C.brand : C.muted} />}
            <Txt size={F.small} w={600} color={on ? C.ink : C.muted}>{it.label}</Txt>
            {it.note != null && (typeof it.note === 'string' || typeof it.note === 'number' ? <Txt size={F.small} tone="muted">{it.note}</Txt> : it.note)}
          </Pressable>
        )
      })}
    </View>
  )
}

/** button.opt — one toggle in a wrap row (planner "Why", etc.). */
export function Opt({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ selected: on, disabled }}
      style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: R.pill, justifyContent: 'center', borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : C.surface, opacity: disabled ? 0.5 : 1 }}>
      <Txt size={F.small} w={600} color={on ? C.brandDeep : C.inkSoft}>{label}</Txt>
    </Pressable>
  )
}

// ── Values ──────────────────────────────────────────────────────────────────
/** dl.kv — label left, value right. `tot` = the bold total line. */
export function KvRow({ label, value, tot, last }: { label: React.ReactNode; value: React.ReactNode; tot?: boolean; last?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.md, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, borderTopWidth: tot ? 1 : 0, borderTopColor: C.lineStrong }}>
      <View style={{ flex: 1, minWidth: 0 }}>{typeof label === 'string' ? <Txt size={F.small} tone={tot ? 'ink' : 'muted'} w={tot ? 700 : 400}>{label}</Txt> : label}</View>
      <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>{typeof value === 'string' || typeof value === 'number' ? <Txt size={F.small} w={tot ? 700 : 600}>{value}</Txt> : value}</View>
    </View>
  )
}

export function Mono({ children, size = 12, tone = 'muted' as const }: { children: React.ReactNode; size?: number; tone?: 'ink' | 'soft' | 'muted' }) {
  const { C } = useTheme()
  const color = tone === 'ink' ? C.ink : tone === 'soft' ? C.inkSoft : C.muted
  return <Txt size={size} color={color} style={{ fontFamily: MONO, letterSpacing: 0.2 }}>{children}</Txt>
}

export function Sunk({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return <View style={[{ backgroundColor: C.sunken, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14 }, style]}>{children}</View>
}

/** .card — the module's plain card (radius 14, hairline, padding 18 → 16 on a phone). */
export function TeCard({ children, style, tint, flat }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tint?: boolean; flat?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={[{ backgroundColor: tint ? C.brandTint : C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: tint ? C.brandEdge : C.line, padding: S.lg, marginBottom: S.md }, flat && { borderColor: C.line }, style]}>
      {children}
    </View>
  )
}

/** .ferr — a field error line under a section: warn icon + text in critical. */
export function FieldErr({ children }: { children?: string | null }) {
  const { C } = useTheme()
  if (!children) return null
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 6 }}>
      <TeIcon name="warn" size="sm" color={C.critical} />
      <Txt size={F.tiny} tone="critical" style={{ flex: 1 }}>{children}</Txt>
    </View>
  )
}

/** .empty — bold title + muted text, centred. */
export function TeEmpty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: S.xl, paddingHorizontal: S.lg, alignItems: 'center', gap: 4 }}>
      <Txt size={F.body} w={700} center>{title}</Txt>
      {typeof children === 'string' ? <Txt size={F.small} tone="muted" center>{children}</Txt> : children}
    </View>
  )
}

/** A link-style button (button.link). */
export function LinkBtn({ label, onPress, icon, disabled }: { label: string; onPress: () => void; icon?: string; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} hitSlop={8} accessibilityRole="button" accessibilityState={{ disabled }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, opacity: disabled ? 0.5 : 1, alignSelf: 'flex-start' }}>
      {!!icon && <TeIcon name={icon} size="sm" color={C.brand} />}
      <Txt size={F.small} w={600} tone="brand">{label}</Txt>
    </Pressable>
  )
}
