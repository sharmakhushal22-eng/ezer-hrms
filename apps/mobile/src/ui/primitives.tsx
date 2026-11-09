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
  ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { useTheme } from './ThemeProvider'
import { elevation, F, FONT, R, S, toneOf, type Tone } from './theme'
import { IconAlert, IconCheck, IconChevron } from './icons'
import { tick } from './feel'

/** How far a phone's "font size" setting may grow the text. Layouts are built for
 *  this much; beyond it, labels start to fight for the room numbers need. */
export const MAX_FONT_SCALE = 1.15

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
  /** One line that shrinks to fit rather than being cut: amounts, times, short codes. */
  fit?: boolean
}
export function Txt({ children, size = F.body, w = 400, color, tone = 'ink', style, numberOfLines, center, upper, selectable, onPress, fit }: TxtProps) {
  const { C } = useTheme()
  const toneColor = {
    ink: C.ink, soft: C.inkSoft, muted: C.muted, faint: C.faint, brand: C.brand, positive: C.positive,
    warning: C.warning, critical: C.critical, info: C.info, onAccent: C.onAccent,
  }[tone]
  return (
    <Text numberOfLines={fit ? 1 : numberOfLines} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.6 : undefined}
      maxFontSizeMultiplier={MAX_FONT_SCALE} selectable={selectable} onPress={onPress}
      style={[{ fontFamily: FONT[w], fontSize: size, color: color || toneColor, lineHeight: Math.round(size * 1.38), flexShrink: 1 },
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
      <Pressable onPress={onPress} android_ripple={{ color: C.chip }} style={({ pressed }) => [base, padded && { padding: S.lg }, pressed && Platform.OS !== 'android' && { opacity: 0.85 }, style]}>
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
  const h = size === 'sm' ? 38 : size === 'lg' ? 52 : 46
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
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, minHeight: h, paddingVertical: 6, paddingHorizontal: S.md }}>
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : icon}
      <Txt size={fs} w={600} color={p.fg} center style={{ flexShrink: 1 }}>{title}</Txt>
    </View>
  )
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} onPress={off ? undefined : onPress}
      android_ripple={off ? undefined : { color: variant === 'primary' || variant === 'positive' ? 'rgba(255,255,255,0.22)' : C.chip }}
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
export function IconButton({ children, onPress, label, badge, badgeInset = 4, style }: { children: React.ReactNode; onPress?: () => void; label: string; badge?: number; badgeInset?: number; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.brandTint : 'transparent' }, style]}>
      {children}
      {!!badge && badge > 0 && (
        <View style={{ position: 'absolute', top: badgeInset, right: badgeInset - 1, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.critical, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
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
    <View style={[{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: t.bg, borderWidth: 1, borderColor: t.edge, maxWidth: '100%' }, style]}>
      <Txt size={11} w={600} color={t.fg}>{label}</Txt>
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
      <Txt size={F.micro} w={700} tone="muted" upper>{label}</Txt>
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
    <Pressable onPress={onPress} disabled={!onPress} android_ripple={onPress ? { color: C.chip } : undefined}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, minHeight: 52, backgroundColor: pressed && Platform.OS !== 'android' ? C.brandTint : 'transparent' }, style]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? <Txt size={F.body} w={600}>{title}</Txt> : title}
        {!!subtitle && (typeof subtitle === 'string' ? <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{subtitle}</Txt> : subtitle)}
      </View>
      {right}
      {onPress && chevron && <IconChevron size={16} color={C.faint} />}
    </Pressable>
  )
}

// ── States ──────────────────────────────────────────────────────────────────
/** A resting block that pulses while its content loads. */
export function Skeleton({ width = '100%', height = 12, radius = 6, style }: { width?: ViewStyle['width']; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: C.sunken }, style]} />
}

/** The shape of what is coming, in place of a spinner, so a screen opens already
 *  laid out and the content settles in rather than arriving on a blank page. */
export function Loading({ label = 'Loading…', style, rows = 3 }: { label?: string; style?: StyleProp<ViewStyle>; rows?: number }) {
  const [pulse] = React.useState(() => new Animated.Value(1))
  React.useEffect(() => {
    const beat = (toValue: number) => Animated.timing(pulse, { toValue, duration: 650, useNativeDriver: Platform.OS !== 'web' })
    const loop = Animated.loop(Animated.sequence([beat(0.45), beat(1)]))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLabel={label} style={[{ paddingVertical: S.sm, gap: S.lg, opacity: pulse }, style]}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Skeleton width={44} height={44} radius={12} />
          <View style={{ flex: 1, gap: S.sm }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="85%" height={11} />
          </View>
        </View>
      ))}
    </Animated.View>
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
          maxFontSizeMultiplier={MAX_FONT_SCALE}
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
        <Txt size={F.body} color={value ? C.ink : C.faint} style={{ flex: 1, paddingVertical: 10 }}>{value || placeholder || 'Select'}</Txt>
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

/** Segmented pills — the website's .ess-seg sub-tab row. A row that does not fit
 *  scrolls sideways inside itself, and the open tab is kept centred, so it can never
 *  sit past the edge unseen. `bleed` runs it to the screen edges (portal.css, phones):
 *  the cut-off tab then reads as "swipe for more" rather than as a clipped box. */
export function Segmented<K extends string>({ items, value, onChange, style, bleed }: {
  items: { key: K; label: string; count?: number; soon?: boolean }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>; bleed?: boolean
}) {
  const { C } = useTheme()
  const row = React.useRef<ScrollView>(null)
  const boxW = React.useRef(0)
  const spots = React.useRef<Partial<Record<K, { x: number; w: number }>>>({})
  const centre = React.useCallback((animated: boolean) => {
    const at = spots.current[value]
    if (at && boxW.current) row.current?.scrollTo({ x: Math.max(0, at.x - (boxW.current - at.w) / 2), animated })
  }, [value])
  React.useEffect(() => { centre(true) }, [centre])
  return (
    <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      onLayout={e => { boxW.current = e.nativeEvent.layout.width }}
      style={[{ flexGrow: 0, flexShrink: 0, backgroundColor: C.chip, borderColor: C.brandEdge },
        bleed ? { borderTopWidth: 1, borderBottomWidth: 1 } : { borderWidth: 1, borderRadius: 13, alignSelf: 'flex-start', maxWidth: '100%' }, style]}
      contentContainerStyle={{ gap: 4, padding: 4, paddingHorizontal: bleed ? S.md : 4 }}>
      {items.map(it => {
        const on = it.key === value
        return (
          <Pressable key={it.key} onPress={() => { tick(); onChange(it.key) }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onLayout={e => { spots.current[it.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (on) centre(false) }}
            style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.surface : 'transparent', borderBottomWidth: on ? 2.5 : 0, borderBottomColor: C.brand }}>
            <Txt size={F.small} w={600} color={on ? C.chipInk : C.essInk3}>{it.label}{it.count ? ` · ${it.count}` : ''}</Txt>
            {it.soon && <Txt size={9.5} w={700} color={C.essInk3} upper>Soon</Txt>}
          </Pressable>
        )
      })}
    </ScrollView>
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
