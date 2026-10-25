// src/features/expenses/plan/parts.tsx — the small pieces the planner, Start now,
// Add a journey and the vehicle form share (te.css classes the lead's kit does
// not cover). All at module level (the repo's focus-loss rule).
//
//   Ferr        .ferr (+ .warn)            an error line under a section
//   DateField   <input type=date>          a field that opens DateSheet (min / max kept)
//   SelectField <select>                   a field that opens SelectSheet
//   ModeChip    button.mchip               a travel mode, pressed or not
//   VChip       button.vchip               a vehicle / known-place chip
//   IconOpt     button.opt with an icon    the vehicle-type options
//   Mk          span.mk.a / .b / .s        the A / B / stop-number marker
//   LocBtn      button.locb                a "choose a place" row
//   Stepper     div.stepper                minus / number / plus
//   SheetToast  .toasts > .toast.err       the planner's own in-sheet toast
//   Crumb       span.fpath                 "Step 3 of 3 · Local trip › Plan a trip"
import * as React from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { FieldLabel, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, type Option } from '@/ui/overlays'
import { day } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { MONO } from '../tones'

// ── .ferr ───────────────────────────────────────────────────────────────────
export function Ferr({ children, icon = 'warn', warn }: { children?: string | null; icon?: string; warn?: boolean }) {
  const { C } = useTheme()
  if (!children) return null
  const fg = warn ? C.warning : C.critical
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 6 }}>
      <View style={{ paddingTop: 1 }}><TeIcon name={icon} size="sm" color={fg} /></View>
      <Txt size={F.tiny} color={fg} style={{ flex: 1 }}>{children}</Txt>
    </View>
  )
}

// ── fields ──────────────────────────────────────────────────────────────────
/** "16 Nov 2026" for the field; the website's date input shows the full date. */
const longDate = (iso: string) => (iso ? `${day(iso)} ${iso.slice(0, 4)}` : '')

export function DateField({ label, value, min, max, onPick, help, clearable, style }: {
  label: string
  value: string
  min?: string | null
  max?: string | null
  onPick: (ymd: string) => void
  help?: string
  /** A date the person may leave empty (a native date input can be cleared). */
  clearable?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <View style={style}>
      <PickerField label={label} value={value ? longDate(value) : ''} placeholder="Choose a date" onPress={() => setOpen(true)}
        help={help} style={{ marginBottom: clearable && value ? 2 : S.md }} />
      {clearable && !!value && (
        <Pressable onPress={() => onPick('')} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginBottom: S.sm }}>
          <Txt size={F.tiny} w={600} tone="brand">Clear the date</Txt>
        </Pressable>
      )}
      <DateSheet visible={open} onClose={() => setOpen(false)} value={value || null} title={label}
        min={min || null} max={max || null} onPick={onPick} />
    </View>
  )
}

export function SelectField<V extends string>({ label, value, options, placeholder = 'Choose', onPick, title, help, style }: {
  label: string
  value: V | ''
  options: Option<V>[]
  placeholder?: string
  onPick: (v: V) => void
  title?: string
  help?: string
  style?: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = React.useState(false)
  const shown = options.find(o => o.value === value)?.label ?? ''
  return (
    <View style={style}>
      <PickerField label={label} value={shown} placeholder={placeholder} onPress={() => setOpen(true)} help={help} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={title || label} options={options}
        value={value || null} onPick={v => onPick(v as V)} searchable={false} />
    </View>
  )
}

// ── chips ───────────────────────────────────────────────────────────────────
export function ModeChip({ icon, label, on, onPress, hint }: { icon: string; label: string; on: boolean; onPress: () => void; hint?: string }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityHint={hint}
      style={({ pressed }) => ({
        minHeight: 44, paddingHorizontal: 12, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6,
        borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : pressed ? C.sunken : C.surface,
      })}>
      <TeIcon name={icon} size="sm" color={on ? C.brand : C.muted} />
      <Txt size={F.small} w={600} color={on ? C.brandDeep : C.inkSoft}>{label}</Txt>
    </Pressable>
  )
}

export function VChip({ icon, title, sub, on, onPress, mono, add }: {
  icon: string; title: string; sub?: string; on?: boolean; onPress: () => void; mono?: boolean; add?: boolean
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={({ pressed }) => ({
        minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', gap: 8,
        borderWidth: 1.5, borderStyle: add ? 'dashed' : 'solid', borderColor: on ? C.brand : C.line,
        backgroundColor: on ? C.brandTint : pressed ? C.sunken : C.surface, maxWidth: '100%',
      })}>
      <TeIcon name={icon} size="sm" color={on ? C.brand : C.muted} />
      <View style={{ flexShrink: 1 }}>
        <Txt size={F.small} w={700} color={on ? C.brandDeep : C.ink} style={mono ? { fontFamily: MONO } : undefined} numberOfLines={1}>{title}</Txt>
        {!!sub && <Txt size={F.micro} tone="muted">{sub}</Txt>}
      </View>
    </Pressable>
  )
}

/** button.opt with an icon before the label (TeVehicleAdd's type options). */
export function IconOpt({ icon, label, on, onPress }: { icon?: string; label: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : C.surface }}>
      {!!icon && <TeIcon name={icon} size="sm" color={on ? C.brand : C.muted} />}
      <Txt size={F.small} w={600} color={on ? C.brandDeep : C.inkSoft}>{label}</Txt>
    </Pressable>
  )
}

// ── route markers ───────────────────────────────────────────────────────────
/** span.mk.a (green "A"), .mk.b (ink, letter or flag), .mk.s (stop number). */
export function Mk({ kind, label, flag }: { kind: 'a' | 'b' | 's'; label?: string; flag?: boolean }) {
  const { C } = useTheme()
  const bg = kind === 'a' ? C.positive : kind === 's' ? C.surface : C.ink
  const fg = kind === 's' ? C.inkSoft : C.surface
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 's' ? 1.5 : 0, borderColor: C.lineStrong }}>
      {flag ? <TeIcon name="flag" px={13} color={fg} /> : <Txt size={11.5} w={700} color={fg}>{label}</Txt>}
    </View>
  )
}

/** button.locb — choose a place. `need` = .hubb.need (nothing chosen yet). */
export function LocBtn({ left, small, title, ad, placeholder, onPress, need }: {
  left: React.ReactNode; small: string; title?: string | null; ad?: string; placeholder: string; onPress: () => void; need?: boolean
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10,
        borderRadius: R.md, borderWidth: 1.5, borderStyle: need ? 'dashed' : 'solid', borderColor: need ? C.warningEdge : C.lineStrong,
        backgroundColor: pressed ? C.brandTint : C.surface,
      })}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.micro} tone="muted">{small}</Txt>
        {title ? <Txt size={F.small} w={700} numberOfLines={1}>{title}</Txt> : <Txt size={F.small} w={600} tone="faint">{placeholder}</Txt>}
        {!!ad && <Txt size={F.micro} tone="muted" numberOfLines={2}>{ad}</Txt>}
      </View>
      <TeIcon name="rightc" size="sm" color={C.muted} />
    </Pressable>
  )
}

// ── stepper ─────────────────────────────────────────────────────────────────
export function Stepper({ value, min, max, onStep, unit, label }: {
  value: number; min: number; max: number; onStep: (delta: 1 | -1) => void; unit: string; label: string
}) {
  const { C } = useTheme()
  const btn = (delta: 1 | -1) => {
    const off = delta < 0 ? value <= min : value >= max
    return (
      <Pressable onPress={off ? undefined : () => onStep(delta)} accessibilityRole="button" accessibilityLabel={delta < 0 ? 'One less' : 'One more'}
        accessibilityState={{ disabled: off }} hitSlop={4}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.sunken : C.surface, opacity: off ? 0.4 : 1 })}>
        <TeIcon name={delta < 0 ? 'minus' : 'plus'} size="sm" color={C.ink} />
      </Pressable>
    )
  }
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {btn(-1)}
      <View style={{ alignItems: 'center', minWidth: 44 }}>
        <Txt size={F.title} w={700}>{value}</Txt>
        <Txt size={F.micro} tone="muted">{unit}</Txt>
      </View>
      {btn(1)}
    </View>
  )
}

// ── the planner's own toast ─────────────────────────────────────────────────
/** TePlanner keeps its toast inside the sheet (div.toasts > div.toast.err), cleared after 4200 ms. */
export function useSheetToast(ms = 4200): [string, (t: string) => void] {
  const [toast, setToast] = React.useState('')
  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), ms)
    return () => clearTimeout(t)
  }, [toast, ms])
  return [toast, setToast]
}

export function SheetToast({ text }: { text: string }) {
  const { C } = useTheme()
  if (!text) return null
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: C.critical }}>
      <View style={{ paddingTop: 1 }}><TeIcon name="warn" size="sm" color={C.onAccent} /></View>
      <Txt size={F.small} w={600} color={C.onAccent} style={{ flex: 1 }}>{text}</Txt>
    </View>
  )
}

// ── entry-flow crumb ────────────────────────────────────────────────────────
export function Crumb({ kind, way }: { kind: string; way: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.brandTint }}>
        <Txt size={F.micro} w={700} tone="brand">Step 3 of 3</Txt>
      </View>
      <Txt size={F.tiny} w={600} tone="soft">{kind}<Txt size={F.tiny} tone="muted"> › </Txt>{way}</Txt>
    </View>
  )
}

/** A labelled group (the website's div.fld with a <span> label and no single input). */
export function Group({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginBottom: S.md }, style]}>
      <FieldLabel label={label} />
      {children}
    </View>
  )
}

/** Hairline section spacing (.sec). */
export function Sec({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ marginBottom: S.lg }, style]}>{children}</View>
}

/** platformOf (lib/te/trip-stay.ts) uses `new URL(v).hostname`. When this
 *  runtime's URL cannot do that (older React Native URL), use the same reading
 *  done by hand: a scheme, //, optional user@, then the host up to / ? # or :. */
const URL_OK = (() => {
  try { return new URL('https://www.example.com/a?b=1').hostname === 'www.example.com' } catch { return false }
})()
export function safePlatformOf(webPlatformOf: (url: string) => string | null, url: string): string | null {
  if (URL_OK) return webPlatformOf(url)
  const v = url.trim()
  if (!v) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]+\]|[^/?#:]+)/i.exec(v)
  return m ? (m[1].toLowerCase().replace(/^www\./, '') || null) : null
}
