// Shared bits for the HR Services screens.
//
// Formatters are ported as-is from components/ess/hris/ui.tsx (a DOM file, so
// copied, not imported). The visual pieces mirror the website's two styles that
// meet on these screens: the HRIS redesign (.hx-pill / .hx-note / .hx-kpi) and
// RoleTabs' local `S` (section titles, notes with a coloured left rule).
import * as React from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { IconClose } from '@/ui/icons'

/* ---------------------------------------------------------------- formats */

/** hris/ui.tsx fmtDateTime — '' for null, the raw string when unparseable. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
/** hris/ui.tsx fmtDate — '-' for null. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
/** RoleTabs / OnboardingApprovals `day()` — en-IN numeric/short/numeric. */
export const day = (v?: string | null, empty = '') => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : empty

export function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h) % 360
}
export function initials(name: string): string {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

/* ---------------------------------------------------------------- visuals */

/** .hx-av — a per-name hue, so a long roster is not one colour. Computed, not a palette hex. */
export function HueAvatar({ name, size = 46 }: { name: string; size?: number }) {
  const { isDark } = useTheme()
  const h = hueOf(name)
  const bg = isDark ? `hsl(${h}, 22%, 22%)` : `hsl(${h}, 48%, 92%)`
  const fg = isDark ? `hsl(${h}, 55%, 82%)` : `hsl(${h}, 52%, 32%)`
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={Math.round(size * 0.32)} w={700} color={fg}>{initials(name)}</Txt>
    </View>
  )
}

export type PillTone = 'ok' | 'warn' | 'dang' | 'info' | 'mut'
export function Pill({ label, tone = 'mut', style }: { label: string; tone?: PillTone; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const m = {
    ok: [C.positiveTint, C.positive], warn: [C.warningTint, C.warning], dang: [C.criticalTint, C.critical],
    info: [C.infoTint, C.info], mut: [C.sunken, C.muted],
  }[tone]
  return (
    <View style={[{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: m[0], borderWidth: tone === 'mut' ? 1 : 0, borderColor: C.line }, style]}>
      <Txt size={10.5} w={700} color={m[1]}>{label}</Txt>
    </View>
  )
}

/** .hx-note / RoleTabs S.note — a tinted box with a coloured left rule. */
export function NoteBox({ tone = 'i', children, style }: { tone?: 'i' | 'w' | 'd' | 'g'; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const bg = tone === 'w' ? C.warningTint : tone === 'd' ? C.criticalTint : tone === 'g' ? C.positiveTint : C.canvas
  const fg = tone === 'w' ? C.warning : tone === 'd' ? C.critical : tone === 'g' ? C.positive : C.muted
  const edge = tone === 'w' ? C.warning : tone === 'd' ? C.critical : tone === 'g' ? C.positive : C.brand
  return (
    <View style={[{ backgroundColor: bg, borderLeftWidth: 3, borderLeftColor: edge, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 }, style]}>
      {typeof children === 'string' ? <Txt size={F.tiny} color={fg} style={{ lineHeight: 19 }}>{children}</Txt> : children}
    </View>
  )
}
export const noteInk = (C: ReturnType<typeof useTheme>['C'], tone: 'i' | 'w' | 'd' | 'g') =>
  tone === 'w' ? C.warning : tone === 'd' ? C.critical : tone === 'g' ? C.positive : C.muted

/** RoleTabs S.section — 12px brand, uppercase. */
export function SectionTitle({ children, right, style }: { children: React.ReactNode; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 10 }, style]}>
      <View style={{ flex: 1 }}><Txt size={F.tiny} w={600} tone="brand" upper>{children}</Txt></View>
      {right}
    </View>
  )
}

/** A KPI strip: .hx-kpis on the web, two columns on a phone. */
export function KpiGrid({ items }: { items: { k: string; v: React.ReactNode; tone?: 'ok' | 'warn' | 'dang' | ''; note?: string; small?: boolean }[] }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
      {items.map(k => (
        <View key={k.k} style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.hair, padding: 14, borderLeftWidth: k.tone === 'warn' ? 3 : 1, borderLeftColor: k.tone === 'warn' ? C.warning : C.hair }}>
          <Txt size={10} w={700} tone="muted" upper>{k.k}</Txt>
          {typeof k.v === 'string' || typeof k.v === 'number'
            ? <Txt size={k.small ? 15 : 22} w={700} style={{ marginTop: 4 }} color={k.tone === 'ok' ? C.positive : k.tone === 'warn' ? C.warning : k.tone === 'dang' ? C.critical : C.ink}>{k.v}</Txt>
            : k.v}
          {!!k.note && <Txt size={11} tone="faint" style={{ marginTop: 3 }}>{k.note}</Txt>}
        </View>
      ))}
    </View>
  )
}

/** A full-screen modal with its own header — the web's centred review modals, phone-sized. */
export function FullModal({ visible, onClose, title, subtitle, children, footer, closeLabel = 'Close' }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; closeLabel?: string
}) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: C.canvas }}>
        <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: S.lg, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={F.lead + 1} w={800} numberOfLines={2}>{title}</Txt>
            {!!subtitle && <Txt size={F.tiny} tone="muted" numberOfLines={3}>{subtitle}</Txt>}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: R.sm, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: pressed ? C.brandTint : C.surface })}>
            <IconClose size={14} color={C.brandDeep} />
            <Txt size={F.tiny} w={600} color={C.brandDeep}>{closeLabel}</Txt>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, paddingBottom: footer ? S.lg : insets.bottom + S.xl }}>
          {children}
        </ScrollView>
        {footer && (
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: insets.bottom + S.sm, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
            {footer}
          </View>
        )}
      </View>
    </Modal>
  )
}

/** A short coloured tag (the mrf_number / round chip on the web). */
export function Chip({ label }: { label: string }) {
  const { C } = useTheme()
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 1, borderRadius: R.pill, backgroundColor: C.brandTint }}>
      <Txt size={10} w={700} color={C.brandDeep}>{label}</Txt>
    </View>
  )
}

/** The website's muted 12.5px "Loading…" line. */
export function LoadingLine({ label = 'Loading…' }: { label?: string }) {
  return <Txt size={12.5} tone="faint" style={{ paddingVertical: S.sm }}>{label}</Txt>
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e))

/** A solid button in a semantic colour — the website's green / red / amber / blue
 *  action buttons (S.btn with a background override). Ink is onAccent. */
export function SolidButton({ title, tone = 'brand', onPress, disabled, loading, full, size = 'md', style }: {
  title: string; tone?: 'brand' | 'positive' | 'critical' | 'warning' | 'info' | 'faint'; onPress?: () => void; disabled?: boolean; loading?: boolean; full?: boolean; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  const bg = { brand: C.brand, positive: C.positive, critical: C.critical, warning: C.warning, info: C.info, faint: C.faint }[tone]
  const off = disabled || loading
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} onPress={off ? undefined : onPress}
      style={({ pressed }) => [{ minHeight: size === 'sm' ? 38 : 46, paddingHorizontal: S.lg, borderRadius: R.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: S.sm, opacity: off ? 0.55 : pressed ? 0.85 : 1, alignSelf: full ? 'stretch' : 'flex-start' }, style]}>
      {loading && <ActivityIndicator size="small" color={C.onAccent} />}
      <Txt size={size === 'sm' ? F.tiny : F.small + 1} w={700} color={C.onAccent} center>{title}</Txt>
    </Pressable>
  )
}
