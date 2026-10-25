// src/features/performance/ui.tsx — components/pms/pms.css, as phone parts.
//
// .card / .stat / .banner b-* / .pill p-* / .chips / .abar / .tabs, mapped onto
// the app's tokens. Module-level so inputs keep focus.
import * as React from 'react'
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { bandFor } from '@web/pms/scoring'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, FONT, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

// pms.css literals the tokens do not cover (light / dark blocks).
const PMS_LIGHT = { exitFg: '#9A3412', exitBg: '#FFEDD5', rowExit: '#FFF4ED', rowNotice: '#FEFCE8' }
const PMS_DARK = { exitFg: '#FDBA74', exitBg: 'rgba(249,115,22,0.18)', rowExit: 'rgba(249,115,22,0.10)', rowNotice: 'rgba(234,179,8,0.10)' }
export const usePmsLiterals = () => (useTheme().isDark ? PMS_DARK : PMS_LIGHT)

/** .card — h3 title + .sub line. */
export function PCard({ title, sub, children, style }: { title?: string; sub?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, padding: S.lg, marginBottom: S.lg }, style]}>
      {!!title && <Txt size={F.body} w={700} style={{ marginBottom: 4 }}>{title}</Txt>}
      {!!sub && <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>{sub}</Txt>}
      {children}
    </View>
  )
}

export type StatTone = 'accent' | 'warn' | 'good' | 'bad'
/** .stat — accent is the brand-filled card; warn the warning-tint one; good/bad colour the value. */
export function PStat({ label, value, note, tone, style }: { label: string; value: React.ReactNode; note?: string; tone?: StatTone; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  const accent = tone === 'accent'
  const warn = tone === 'warn'
  const valColor = accent ? C.onAccent : tone === 'good' ? C.positive : tone === 'bad' ? C.critical : C.ink
  return (
    <View style={[{
      flexGrow: 1, flexBasis: '45%', minWidth: 140, borderRadius: 12, padding: 14, borderWidth: 1,
      backgroundColor: accent ? C.brand : warn ? C.warningTint : C.surface,
      borderColor: accent ? C.brand : warn ? C.warning : C.line,
    }, style]}>
      <Txt size={F.micro} w={700} upper color={accent ? C.onAccentSoft : C.muted}>{label}</Txt>
      {typeof value === 'string' || typeof value === 'number'
        ? <Txt size={19} w={800} color={valColor} style={{ marginTop: 6 }}>{value}</Txt>
        : <View style={{ marginTop: 6 }}>{value}</View>}
      {!!note && <Txt size={F.micro} color={accent ? C.onAccent : C.muted} style={{ marginTop: 3 }}>{note}</Txt>}
    </View>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md, marginBottom: S.lg }}>{children}</View>
}

export type BannerTone = 'amber' | 'blue' | 'green' | 'red' | 'brand'
const bannerColours = (C: Palette, t: BannerTone) =>
  t === 'amber' ? { bg: C.warningTint, edge: C.warning, fg: C.warning }
  : t === 'green' ? { bg: C.positiveTint, edge: C.positive, fg: C.positive }
  : t === 'red' ? { bg: C.criticalTint, edge: C.critical, fg: C.critical }
  : t === 'brand' ? { bg: C.brandTint, edge: C.brandEdge, fg: C.brandDeep }
  : { bg: C.infoTint, edge: C.info, fg: C.info }

/** .banner — glyph + body; text inside uses <B> for the website's <b>. */
export function Banner({ tone, glyph, children, style, raw }: { tone: BannerTone; glyph: string; children: React.ReactNode; style?: StyleProp<ViewStyle>; raw?: boolean }) {
  const { C } = useTheme()
  const c = bannerColours(C, tone)
  return (
    <View style={[{ flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 12, borderRadius: 11, borderWidth: 1, borderColor: c.edge, backgroundColor: c.bg, marginBottom: 14 }, style]}>
      <Txt size={F.tiny} color={c.fg}>{glyph}</Txt>
      <View style={{ flex: 1 }}>
        {raw ? children : <Txt size={F.tiny} color={c.fg} style={{ lineHeight: 18 }}>{children}</Txt>}
      </View>
    </View>
  )
}
/** Bold run inside a Banner / note. Inherits colour from the surrounding Txt. */
export const B = ({ children }: { children: React.ReactNode }) => <Text style={{ fontFamily: FONT[700] }}>{children}</Text>

export type PillKind = 'green' | 'brand' | 'amber' | 'red' | 'grey' | 'blue' | 'orange'
export function Pill({ kind, label }: { kind: PillKind; label: string }) {
  const { C } = useTheme()
  const lit = usePmsLiterals()
  const map: Record<PillKind, { bg: string; fg: string }> = {
    green: { bg: C.positiveTint, fg: C.positive }, brand: { bg: C.brandTint, fg: C.brandDeep },
    amber: { bg: C.warningTint, fg: C.warning }, red: { bg: C.criticalTint, fg: C.critical },
    grey: { bg: C.sunken, fg: C.muted }, blue: { bg: C.infoTint, fg: C.info },
    orange: { bg: lit.exitBg, fg: lit.exitFg },
  }
  const p = map[kind]
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: p.bg }}>
      <Txt size={F.micro} w={700} color={p.fg}>{label}</Txt>
    </View>
  )
}

/** .k — 11px muted helper line. */
export const K = ({ children, style }: { children: React.ReactNode; style?: any }) => <Txt size={F.micro} tone="muted" style={[{ lineHeight: 17 }, style]}>{children}</Txt>

/** The 1–5 chip radiogroup (EmployeeTabs.tsx Chips). Tooltip "n: Label" becomes the a11y label. */
export function Chips({ value, onPick, name, disabled }: { value: number | null; onPick: (n: number) => void; name: string; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={name} style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {[1, 2, 3, 4, 5].map(n => {
        const on = value === n
        const band = bandFor(n)
        return (
          <Pressable key={n} disabled={disabled} onPress={() => onPick(n)} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }}
            accessibilityLabel={band ? `${n}: ${band.label}` : String(n)}
            style={{ minWidth: 44, height: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
              borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.surface, opacity: disabled && !on ? 0.6 : 1 }}>
            <Txt size={F.small} w={800} color={on ? C.onAccent : C.muted}>{n}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** .abar — name, track with optional self (pale, top half) and final (solid, bottom half), value. */
export function ABar({ name, self, final, solidOnly, value }: { name: string; self?: number; final: number; solidOnly?: boolean; value: string }) {
  const { C } = useTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm, marginBottom: 4 }}>
        <Txt size={F.tiny} w={600} style={{ flex: 1 }} numberOfLines={2}>{name}</Txt>
        <Txt size={F.micro} w={700} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
      </View>
      <View style={{ height: 16, backgroundColor: C.sunken, borderRadius: 5, overflow: 'hidden' }}>
        {solidOnly ? (
          <View style={{ width: `${Math.max(0, Math.min(1, final)) * 100}%`, height: '100%', backgroundColor: C.brand, borderRadius: 5 }} />
        ) : (
          <>
            <View style={{ position: 'absolute', left: 0, top: 0, height: 8, width: `${Math.max(0, Math.min(1, self ?? 0)) * 100}%`, backgroundColor: C.brandEdge }} />
            <View style={{ position: 'absolute', left: 0, bottom: 0, height: 8, width: `${Math.max(0, Math.min(1, final)) * 100}%`, backgroundColor: C.brand }} />
          </>
        )}
      </View>
    </View>
  )
}

/** .tabs — underline strip, scrolls sideways. */
export function TabStrip<K extends string>({ tabs, active, onPick }: { tabs: { k: K; label: string }[]; active: K; onPick: (k: K) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: C.line, marginTop: S.lg, marginBottom: S.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
        {tabs.map(t => {
          const on = t.k === active
          return (
            <Pressable key={t.k} onPress={() => onPick(t.k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 13, minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: on ? C.brand : 'transparent' }}>
              <Txt size={F.small} w={600} color={on ? C.brand : C.muted}>{t.label}</Txt>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

/** The table's "Nobody here yet" row, as a block. */
export function EmptyBlock({ title, note }: { title: string; note: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 22, paddingHorizontal: 14 }}>
      <Txt size={F.small} w={700} style={{ marginBottom: 4 }} center>{title}</Txt>
      <K style={{ textAlign: 'center' }}>{note}</K>
    </View>
  )
}

/** A label/value line inside a per-row card (a table column on the website). */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3 }}>
      <Txt size={F.micro} w={600} tone="muted" style={{ width: 92 }}>{label}</Txt>
      <View style={{ flex: 1, minWidth: 0 }}>{typeof children === 'string' || typeof children === 'number' ? <Txt size={F.tiny}>{children}</Txt> : children}</View>
    </View>
  )
}
