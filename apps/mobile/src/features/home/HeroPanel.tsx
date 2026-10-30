// src/features/home/HeroPanel.tsx — components/ess/today/HeroPanel.tsx at phone width
// (today.css @container ≤520px): clock + format picker, greeting, meta tiles, and
// the punch dial underneath. The one-line "brief" is hidden at this width on the
// website ("On a phone, Punch in should be on the first screen"), so it is here too.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { fmtDate, fmtHHMM, greeting, two } from '@web/today/format'
import type { Prefs, TodayPayload } from './data'
import { useNow } from './kit'
import { GClock } from './glyphs'

/**
 * The hero's own colours (today.css --hero-* / --on-hero / --chip-* / --meta-* / --av-*).
 * Light is a bright surface with ink text; dark keeps the navy slab. The evening and
 * afternoon tones only shift the navy's far stop (--hero-c), so they show in dark only.
 */
export function heroTheme(isDark: boolean, tone: '' | 'afternoon' | 'evening') {
  if (!isDark) return {
    bg: ['#FFFFFF', '#F8FAFC', '#EEF2F8'] as const, edge: '#DCE3EE', glow: '#2563EB26',
    onHero: null as string | null, onHeroSoft: null as string | null,
    chipBg: null as string | null, chipEdge: null as string | null, chipFg: null as string | null,
    metaBg: 'rgba(255,255,255,0.75)', metaEdge: 'rgba(37,99,235,0.12)',
    pillBg: 'rgba(255,255,255,0.85)', pillEdge: null as string | null, pillFg: null as string | null,
    avBg: ['#3B82F6', '#1D4ED8'] as const, avFg: '#FFFFFF', avDotEdge: '#FFFFFF', heroA: '#0B1D4D',
  }
  const c = tone === 'evening' ? '#6366F1' : tone === 'afternoon' ? '#22D3EE' : '#0EA5E9'
  return {
    bg: ['#070F2B', '#1E3A8A', c] as const, edge: 'transparent', glow: '#60A5FA55',
    onHero: '#FFFFFF', onHeroSoft: 'rgba(255,255,255,0.72)',
    chipBg: 'rgba(255,255,255,0.14)', chipEdge: 'rgba(255,255,255,0.18)', chipFg: '#FFFFFF',
    metaBg: 'rgba(255,255,255,0.06)', metaEdge: 'rgba(255,255,255,0.12)',
    pillBg: 'rgba(255,255,255,0.10)', pillEdge: 'rgba(255,255,255,0.22)', pillFg: 'rgba(255,255,255,0.72)',
    avBg: ['#FFFFFF', '#BFDBFE'] as const, avFg: '#070F2B', avDotEdge: '#1E3A8A', heroA: '#070F2B',
  }
}
export type HeroTheme = ReturnType<typeof heroTheme>

const LIVE_DOT = '#34D399' // today.css .av .on.live

export function HeroPanel({ data, prefs, onPrefs, children }: { data: TodayPayload; prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; children: React.ReactNode }) {
  const { C, isDark } = useTheme()
  const now = useNow(15000)
  const h = now.getHours()
  const tone = h >= 17 || h < 6 ? 'evening' : h >= 12 ? 'afternoon' : ''
  const H = heroTheme(isDark, tone)
  const ink = H.onHero || C.ink, soft = H.onHeroSoft || C.muted
  const [fmtOpen, setFmtOpen] = React.useState(false)

  const e = data.employee
  const weekH = Math.floor(data.week_hours), weekM = Math.round((data.week_hours - weekH) * 60)
  const live = !!(data.today?.punch_in && !data.today.punch_out)

  const chip = (label: string) => (
    <View key={label} style={{ height: 22, paddingHorizontal: 9, borderRadius: R.pill, justifyContent: 'center', backgroundColor: H.chipBg || C.surface, borderWidth: 1, borderColor: H.chipEdge || C.line }}>
      <Txt size={11.5} w={600} color={H.chipFg || C.inkSoft} numberOfLines={1}>{label}</Txt>
    </View>
  )
  const meta = (label: string, value: string) => (
    <View key={label} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: H.metaBg, borderWidth: 1, borderColor: H.metaEdge, maxWidth: '100%' }}>
      <Txt size={11.5} w={500} color={soft}>{label}</Txt>
      <Txt size={13.5} w={700} color={ink} style={{ marginTop: 1 }}>{value}</Txt>
    </View>
  )

  return (
    <View accessibilityLabel="Today" style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: H.edge }}>
      <LinearGradient colors={H.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 20, paddingHorizontal: 18 }}>
        {/* The soft light in the top-right corner (today.css --hero-bg radial / .hero-bg::before). */}
        <Svg pointerEvents="none" width={420} height={420} style={{ position: 'absolute', right: -170, top: -230 }}>
          <Defs>
            <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={H.glow} stopOpacity={1} /><Stop offset="1" stopColor={H.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={210} cy={210} r={210} fill="url(#heroGlow)" />
        </Svg>

        {/* hero-top: clock and the format picker */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Txt size={22} w={600} color={ink} style={{ lineHeight: 26, fontVariant: ['tabular-nums'] }}>
                {prefs.time_format === '24' ? `${two(h)}:${two(now.getMinutes())}` : `${h % 12 || 12}:${two(now.getMinutes())}`}
              </Txt>
              {prefs.time_format === '12' && <Txt size={14} w={600} color={ink} style={{ marginLeft: 5 }}>{h >= 12 ? 'PM' : 'AM'}</Txt>}
            </View>
            <Txt size={13} color={soft}>{fmtDate(now, prefs.date_format)}</Txt>
          </View>
          <Pressable onPress={() => setFmtOpen(true)} accessibilityRole="button" accessibilityLabel="Time & date format" hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: H.pillEdge || C.line, backgroundColor: pressed ? C.brandTint : H.pillBg })}>
            <GClock size={14} color={H.pillFg || C.muted} />
            <Txt size={12.5} w={600} color={H.pillFg || C.muted}>{prefs.time_format}h</Txt>
          </Pressable>
        </View>

        {/* greet */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 54, height: 54 }}>
            <LinearGradient colors={H.avBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={18} w={700} color={H.avFg}>{e.initials}</Txt>
            </LinearGradient>
            <View style={{ position: 'absolute', right: 1, bottom: 1, width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: H.avDotEdge, backgroundColor: live ? LIVE_DOT : C.lineStrong }} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={23} color={ink} style={{ fontFamily: SERIF, lineHeight: 27 }}>{greeting(h)}, {e.first_name}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {!!e.designation && <Txt size={13.5} color={soft}>{e.designation}</Txt>}
              {chip(e.code)}
              {!!e.location && chip(e.location)}
            </View>
          </View>
        </View>

        {/* hero-meta */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          {meta('Shift', `${fmtHHMM(data.shift.start, prefs.time_format)} – ${fmtHHMM(data.shift.end, prefs.time_format)}`)}
          {meta('This week', `${weekH}h ${two(weekM)}m logged`)}
          {data.next_holiday && meta('Next holiday', `${data.next_holiday.name}, ${new Date(data.next_holiday.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`)}
        </View>

        <View style={{ marginTop: 18 }}>{children /* <PunchDial/> */}</View>
      </LinearGradient>
      <FormatSheet visible={fmtOpen} onClose={() => setFmtOpen(false)} prefs={prefs} onPrefs={onPrefs} now={now} />
    </View>
  )
}

/* ── time & date format picker (the website's popover, as a sheet) ─────────── */
function FmtOption({ label, example, on, onPress }: { label: string; example: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        borderColor: on ? C.brand : pressed ? C.brandEdge : C.line, backgroundColor: on ? C.brandTint : C.sunken,
      })}>
      <Txt size={13} w={600} color={on ? C.brand : C.ink}>{label}</Txt>
      <Txt size={12} w={500} color={on ? C.brand : C.muted} style={{ fontFamily: FONT[500], fontVariant: ['tabular-nums'] }}>{example}</Txt>
    </Pressable>
  )
}

function FormatSheet({ visible, onClose, prefs, onPrefs, now }: { visible: boolean; onClose: () => void; prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; now: Date }) {
  const dates: [Prefs['date_format'], string, string][] = [
    ['long', 'Long', now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })],
    ['short', 'Short', fmtDate(now, 'short')],
    ['dmy', 'DD/MM/YYYY', fmtDate(now, 'dmy')],
    ['mdy', 'MM/DD/YYYY', fmtDate(now, 'mdy')],
    ['iso', 'YYYY-MM-DD', fmtDate(now, 'iso')],
  ]
  return (
    <Sheet visible={visible} onClose={onClose} title="Time and date format">
      <Txt size={11.5} w={600} tone="faint" style={{ marginBottom: 6 }}>Time</Txt>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <FmtOption label="24-hour" example="18:30" on={prefs.time_format === '24'} onPress={() => onPrefs({ time_format: '24' })} />
        <FmtOption label="12-hour" example="6:30 PM" on={prefs.time_format === '12'} onPress={() => onPrefs({ time_format: '12' })} />
      </View>
      <Txt size={11.5} w={600} tone="faint" style={{ marginTop: S.md, marginBottom: 6 }}>Date</Txt>
      <View style={{ gap: 6 }}>
        {dates.map(([k, label, ex]) => (
          <View key={k} style={{ flexDirection: 'row' }}>
            <FmtOption label={label} example={ex} on={prefs.date_format === k} onPress={() => onPrefs({ date_format: k })} />
          </View>
        ))}
      </View>
      <View style={{ height: F.small }} />
    </Sheet>
  )
}
