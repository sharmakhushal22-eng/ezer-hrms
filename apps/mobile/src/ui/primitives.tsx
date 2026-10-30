// src/ui/primitives.tsx — the building blocks every screen is made of.
//
// The website has 28 primitives in lib/ui/index.tsx (Card, Stat, Tabs, Field,
// Notice, Badge…). These are their phone counterparts: the same names where the
// idea is the same, the same tokens, adapted to touch (44dp+ targets, sheets
// instead of dropdowns, full-width actions).
//
// Rule carried over from the website: sub-components live at module level, never
// inside another component, so typing in an input never remounts it.
import * as React from 'react'
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { useTheme } from './ThemeProvider'
import { elevation, F, FONT, R, S, toneOf, type Tone } from './theme'
import { IconAlert, IconCheck, IconChevron } from './icons'

// ── Text ────────────────────────────────────────────────────────────────────
type Weight = 400 | 500 | 600 | 700 | 800
export interface TxtProps {
  children?: React.ReactNode
  size?: number
  w?: Weight
  color?: string
  /** Shorthand colours from the palette. */
  tone?: 'ink' | 'soft' | 'muted' | 'faint' | 'brand' | 'positive' | 'warning' | 'critical' | 'info' | 'onAccent'
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  center?: boolean
  upper?: boolean
  selectable?: boolean
  onPress?: () => void
}
export function Txt({ children, size = F.body, w = 400, color, tone = 'ink', style, numberOfLines, center, upper, selectable, onPress }: TxtProps) {
  const { C } = useTheme()
  const toneColor = {
    ink: C.ink, soft: C.inkSoft, muted: C.muted, faint: C.faint, brand: C.brand, positive: C.positive,
    warning: C.warning, critical: C.critical, info: C.info, onAccent: C.onAccent,
  }[tone]
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} onPress={onPress}
      style={[{ fontFamily: FONT[w], fontSize: size, color: color || toneColor, lineHeight: Math.round(size * 1.38) },
        center && { textAlign: 'center' }, upper && { textTransform: 'uppercase', letterSpacing: size * 0.08 }, style]}>
      {children}
    </Text>
  )
}

/** Uppercase eyebrow above a section — lib/ui/tokens.ts `eyebrow`. */
export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Txt size={F.micro} w={700} tone="muted" upper style={[{ marginBottom: S.sm }, style]}>{children}</Txt>
}

// ── Surfaces ────────────────────────────────────────────────────────────────
export function Card({ children, style, padded = true, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onPress?: () => void }) {
  const { C } = useTheme()
  const base: ViewStyle = { backgroundColor: C.surface, borderRadius: R.card, borderWidth: 1, borderColor: C.hair, ...elevation(C, 1) }
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, padded && { padding: S.lg }, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    )
  }
  return <View style={[base, padded && { padding: S.lg }, style]}>{children}</View>
}

/** The portal's soft hero banner (portal.css .ess-soft-hero) — used by Attendance, Leave, Profile. */
export function Hero({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C, isDark } = useTheme()
  return (
    <View style={[{ borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.hair, ...elevation(C, 1) }, style]}>
      <LinearGradient colors={isDark ? [C.surface, C.sunken] : [C.surface, C.brandTint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: S.lg }}>
        {children}
      </LinearGradient>
    </View>
  )
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: S.md }, style]} />
}

export function Gap({ h = S.md, w }: { h?: number; w?: number }) { return <View style={{ height: w ? undefined : h, width: w }} /> }

export function RowView({ children, gap = S.sm, style, wrap }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>
}

// ── Buttons ─────────────────────────────────────────────────────────────────
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'positive' | 'soft'
export interface ButtonProps {
  title: string
  onPress?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  style?: StyleProp<ViewStyle>
}
export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, size = 'md', full, style }: ButtonProps) {
  const { C } = useTheme()
  const h = size === 'sm' ? 36 : size === 'lg' ? 52 : 46
  const fs = size === 'sm' ? F.tiny : F.small + 1
  const palette: Record<ButtonVariant, { bg: string; fg: string; edge: string }> = {
    primary: { bg: C.brand, fg: C.onAccent, edge: C.brand },
    outline: { bg: C.surface, fg: C.brandDeep, edge: C.brandEdge },
    ghost: { bg: 'transparent', fg: C.brand, edge: 'transparent' },
    danger: { bg: C.criticalTint, fg: C.critical, edge: C.criticalEdge },
    positive: { bg: C.positive, fg: C.onAccent, edge: C.positive },
    soft: { bg: C.brandTint, fg: C.brandDeep, edge: C.brandEdge },
  }
  const p = palette[variant]
  const off = disabled || loading
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, height: h, paddingHorizontal: size === 'sm' ? S.md : S.lg }}>
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : icon}
      <Txt size={fs} w={600} color={p.fg} numberOfLines={1}>{title}</Txt>
    </View>
  )
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} onPress={off ? undefined : onPress}
      style={({ pressed }) => [{
        borderRadius: R.md, borderWidth: 1, borderColor: p.edge, backgroundColor: variant === 'primary' ? undefined : p.bg,
        overflow: 'hidden', opacity: off ? 0.55 : pressed ? 0.85 : 1, alignSelf: full ? 'stretch' : 'auto',
      }, variant === 'primary' && elevation(C, 1), style]}>
      {variant === 'primary'
        ? <LinearGradient colors={[C.gradFrom, C.gradTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>{inner}</LinearGradient>
        : inner}
    </Pressable>
  )
}

/** Small round icon button (44dp touch target). */
export function IconButton({ children, onPress, label, badge, style }: { children: React.ReactNode; onPress?: () => void; label: string; badge?: number; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.brandTint : 'transparent' }, style]}>
      {children}
      {!!badge && badge > 0 && (
        <View style={{ position: 'absolute', top: 4, right: 3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.critical, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Txt size={10} w={700} color="#FFFFFF">{badge > 99 ? '99+' : badge}</Txt>
        </View>
      )}
    </Pressable>
  )
}

// ── Status ──────────────────────────────────────────────────────────────────
export function Badge({ label, tone = 'neutral', style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const t = toneOf(C, tone)
  return (
    <View style={[{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: t.bg, borderWidth: 1, borderColor: t.edge }, style]}>
      <Txt size={11} w={600} color={t.fg} numberOfLines={1}>{label}</Txt>
    </View>
  )
}

export function Notice({ children, tone = 'info', title, style }: { children?: React.ReactNode; tone?: Tone; title?: string; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const t = toneOf(C, tone)
  return (
    <View style={[{ flexDirection: 'row', gap: S.sm, padding: S.md, borderRadius: R.md, backgroundColor: t.bg, borderWidth: 1, borderColor: t.edge }, style]}>
      <View style={{ paddingTop: 1 }}>{tone === 'positive' ? <IconCheck size={16} color={t.fg} /> : <IconAlert size={16} color={t.fg} />}</View>
      <View style={{ flex: 1 }}>
        {!!title && <Txt size={F.small} w={600} color={t.fg}>{title}</Txt>}
        {typeof children === 'string' ? <Txt size={F.small} color={t.fg}>{children}</Txt> : children}
      </View>
    </View>
  )
}

/** A figure with its label — lib/ui Stat. */
export function Stat({ label, value, note, tone, style }: { label: string; value: React.ReactNode; note?: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const fg = tone && tone !== 'neutral' ? toneOf(C, tone).fg : C.ink
  return (
    <Card style={[{ flex: 1, minWidth: 140 }, style]} padded>
      <Txt size={F.micro} w={700} tone="muted" upper numberOfLines={2}>{label}</Txt>
      <Gap h={6} />
      {typeof value === 'string' || typeof value === 'number' ? <Txt size={F.title + 2} w={700} color={fg}>{value}</Txt> : value}
      {!!note && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{note}</Txt>}
    </Card>
  )
}

/** A label above a value, for read-only detail grids. */
export function KV({ label, value, style }: { label: string; value?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingVertical: 8 }, style]}>
      <Txt size={F.micro} w={600} tone="muted" upper>{label}</Txt>
      {typeof value === 'string' || typeof value === 'number' || value == null
        ? <Txt size={F.body} w={500} style={{ marginTop: 2 }} selectable>{value === null || value === undefined || value === '' ? '—' : String(value)}</Txt>
        : <View style={{ marginTop: 2 }}>{value}</View>}
    </View>
  )
}

/** A tappable list row with chevron. */
export function ListRow({ title, subtitle, left, right, onPress, chevron = true, style }: {
  title: React.ReactNode; subtitle?: React.ReactNode; left?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; chevron?: boolean; style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, minHeight: 52, backgroundColor: pressed ? C.brandTint : 'transparent' }, style]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? <Txt size={F.body} w={600} numberOfLines={2}>{title}</Txt> : title}
        {!!subtitle && (typeof subtitle === 'string' ? <Txt size={F.tiny} tone="muted" numberOfLines={3} style={{ marginTop: 2 }}>{subtitle}</Txt> : subtitle)}
      </View>
      {right}
      {onPress && chevron && <IconChevron size={16} color={C.faint} />}
    </Pressable>
  )
}

// ── States ──────────────────────────────────────────────────────────────────
export function Loading({ label = 'Loading…', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ padding: S.xxl, alignItems: 'center', gap: S.md }, style]}>
      <ActivityIndicator color={C.brand} />
      <Txt size={F.small} tone="muted">{label}</Txt>
    </View>
  )
}

export function Empty({ title, note, icon, action }: { title: string; note?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: S.xxl, paddingHorizontal: S.lg, alignItems: 'center', gap: S.sm }}>
      {icon}
      <Txt size={F.lead} w={600} center>{title}</Txt>
      {!!note && <Txt size={F.small} tone="muted" center>{note}</Txt>}
      {action}
    </View>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.'
  return (
    <View style={{ padding: S.lg, gap: S.md }}>
      <Notice tone="critical" title="Couldn't load this">{msg}</Notice>
      {onRetry && <Button title="Try again" variant="outline" onPress={onRetry} />}
    </View>
  )
}

// ── Inputs ──────────────────────────────────────────────────────────────────
/** The browser test build draws its own focus ring over ours; Android has none. */
export const webNoOutline: any = Platform.OS === 'web' ? { outlineStyle: 'none' } : null

export function FieldLabel({ label, required, hint }: { label: string; required?: boolean; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
      <Txt size={F.micro} w={700} tone="muted" upper>{label}{required ? ' *' : ''}</Txt>
      {!!hint && <Txt size={F.micro} tone="faint">{hint}</Txt>}
    </View>
  )
}

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string
  required?: boolean
  error?: string | null
  hint?: string
  help?: string
  style?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
  right?: React.ReactNode
}
export function Input({ label, required, error, hint, help, style, inputStyle, right, multiline, editable = true, ...rest }: InputProps) {
  const { C } = useTheme()
  const [focus, setFocus] = React.useState(false)
  return (
    <View style={[{ marginBottom: S.md }, style]}>
      {!!label && <FieldLabel label={label} required={required} hint={hint} />}
      <View style={{
        flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', borderRadius: R.sm + 1, borderWidth: 1,
        borderColor: error ? C.critical : focus ? C.brand : C.lineStrong, backgroundColor: editable ? C.surface : C.sunken,
      }}>
        <TextInput
          {...rest}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={C.faint}
          onFocus={e => { setFocus(true); rest.onFocus?.(e) }}
          onBlur={e => { setFocus(false); rest.onBlur?.(e) }}
          style={[{
            flex: 1, minHeight: multiline ? 96 : 46, paddingHorizontal: S.md, paddingVertical: multiline ? S.md : 0,
            fontFamily: FONT[400], fontSize: F.body, color: C.ink, textAlignVertical: multiline ? 'top' : 'center',
          }, webNoOutline, inputStyle]}
        />
        {right}
      </View>
      {!!error && <Txt size={F.tiny} tone="critical" style={{ marginTop: 4 }}>{error}</Txt>}
      {!error && !!help && <Txt size={F.tiny} tone="faint" style={{ marginTop: 4 }}>{help}</Txt>}
    </View>
  )
}

/** A field that looks like an input but opens something (a picker sheet, a calendar). */
export function PickerField({ label, required, value, placeholder, onPress, error, style, disabled, help }: {
  label?: string; required?: boolean; value?: string | null; placeholder?: string; onPress: () => void; error?: string | null; style?: StyleProp<ViewStyle>; disabled?: boolean; help?: string
}) {
  const { C } = useTheme()
  return (
    <View style={[{ marginBottom: S.md }, style]}>
      {!!label && <FieldLabel label={label} required={required} />}
      <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button"
        style={({ pressed }) => ({
          minHeight: 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: error ? C.critical : C.lineStrong,
          backgroundColor: disabled ? C.sunken : pressed ? C.brandTint : C.surface, paddingHorizontal: S.md,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        })}>
        <Txt size={F.body} color={value ? C.ink : C.faint} numberOfLines={1} style={{ flex: 1 }}>{value || placeholder || 'Select'}</Txt>
        <View style={{ transform: [{ rotate: '90deg' }] }}><IconChevron size={14} color={C.faint} /></View>
      </Pressable>
      {!!error && <Txt size={F.tiny} tone="critical" style={{ marginTop: 4 }}>{error}</Txt>}
      {!error && !!help && <Txt size={F.tiny} tone="faint" style={{ marginTop: 4 }}>{help}</Txt>}
    </View>
  )
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : () => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? C.brand : C.lineStrong, backgroundColor: checked ? C.brand : C.surface, alignItems: 'center', justifyContent: 'center' }}>
        {checked && <IconCheck size={14} color={C.onAccent} strokeWidth={2.4} />}
      </View>
      {typeof label === 'string' ? <Txt size={F.small} style={{ flex: 1 }}>{label}</Txt> : label}
    </Pressable>
  )
}

export function Radio({ selected, onPress, label, note }: { selected: boolean; onPress: () => void; label: string; note?: string }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10 }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: selected ? C.brand : C.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.brand }} />}
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={F.small} w={500}>{label}</Txt>
        {!!note && <Txt size={F.tiny} tone="muted">{note}</Txt>}
      </View>
    </Pressable>
  )
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : () => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} hitSlop={8}
      style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: value ? C.brand : C.lineStrong, opacity: disabled ? 0.5 : 1, alignItems: value ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' }} />
    </Pressable>
  )
}

/** Segmented pills — the website's .ess-seg sub-tab row. Scrolls when it does not fit. */
export function Segmented<K extends string>({ items, value, onChange, style }: {
  items: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 13, backgroundColor: C.chip, borderWidth: 1, borderColor: C.brandEdge, alignSelf: 'flex-start' }, style]}>
      {items.map(it => {
        const on = it.key === value
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: on ? C.surface : 'transparent', borderBottomWidth: on ? 2.5 : 0, borderBottomColor: C.brand }}>
            <Txt size={F.small} w={600} color={on ? C.chipInk : C.essInk3}>{it.label}{it.count ? ` · ${it.count}` : ''}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ProgressBar({ value, max = 1, tone = 'brand' }: { value: number; max?: number; tone?: Tone }) {
  const { C } = useTheme()
  const pct = Math.max(0, Math.min(1, max ? value / max : 0))
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: toneOf(C, tone).fg, borderRadius: 3 }} />
    </View>
  )
}

/** Circle with initials, or the photo. */
export function Avatar({ name, uri, size = 40 }: { name?: string | null; uri?: string | null; size?: number }) {
  const { C } = useTheme()
  const ini = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center' }}>
      {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        : <Txt size={Math.round(size * 0.38)} w={700} tone="brand">{ini}</Txt>}
    </View>
  )
}
