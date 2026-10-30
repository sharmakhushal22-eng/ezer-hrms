// src/features/attendance/MonthHero.tsx — (A) the month as one glance and
// (B) the seven stat tiles. EmployeePortal.tsx MonthHero / StatTile /
// AttendanceSummaryChips, phone layout (68px ring, 3-column tiles).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { R } from '@/ui/theme'
import { Hero, Txt } from '@/ui/primitives'
import { IconChevron } from '@/ui/icons'
import { MONTH_NAMES, type MonthSummary } from './model'
import { useVocab } from './bits'

function NavButton({ onPress, label, children, wide }: { onPress: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({
        minWidth: 36, height: 36, paddingHorizontal: wide ? 11 : 0, borderRadius: R.md, borderWidth: 1,
        borderColor: pressed ? C.brandEdge : C.line, backgroundColor: pressed ? C.brandTint : C.surface,
        alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }],
      })}>
      {children}
    </Pressable>
  )
}

function Ring({ pct }: { pct: number | null }) {
  const { C } = useTheme()
  const tone = pct == null ? C.faint : pct >= 95 ? C.positive : pct >= 85 ? C.warning : C.critical
  const size = 68
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Attendance ${pct == null ? 'not available' : `${pct}%`}`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={7} />
        {pct != null && (
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={`${(circ * pct) / 100} ${circ}`} />
        )}
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={17} w={700} style={{ lineHeight: 19 }}>{pct == null ? '-' : `${pct}%`}</Txt>
        <Txt size={9} w={600} tone="muted" style={{ letterSpacing: 0, marginTop: 1 }}>ATTENDANCE</Txt>
      </View>
    </View>
  )
}

export function MonthHero({ month, year, summary, onPrev, onNext, onToday, isThisMonth }: {
  month: number; year: number; summary: MonthSummary
  onPrev: () => void; onNext: () => void; onToday: () => void; isThisMonth: boolean
}) {
  const { C } = useTheme()
  const { working } = summary
  return (
    <Hero style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 3, flexWrap: 'wrap' }}>
            <NavButton onPress={onPrev} label="Previous month">
              <View style={{ transform: [{ rotate: '180deg' }] }}><IconChevron size={15} color={C.ink} strokeWidth={2} /></View>
            </NavButton>
            <Txt size={18} w={700}>{MONTH_NAMES[month - 1]} <Txt size={18} w={500} tone="faint">{year}</Txt></Txt>
            <NavButton onPress={onNext} label="Next month"><IconChevron size={15} color={C.ink} strokeWidth={2} /></NavButton>
            {!isThisMonth && <NavButton onPress={onToday} label="Today" wide><Txt size={12} w={600}>Today</Txt></NavButton>}
          </View>
          <Txt size={12.5} tone="muted">
            {working > 0
              ? `${working} working day${working === 1 ? '' : 's'} · ${summary.present} present, ${summary.absent} absent`
              : 'No working days recorded yet'}
          </Txt>
          {!!summary.totalOTHours && summary.totalOTHours !== '0h 0m' && (
            <Txt size={12} tone="positive" style={{ marginTop: 5 }}>⏱ {summary.totalOTHours} overtime this month</Txt>
          )}
        </View>
        <Ring pct={summary.pct} />
      </View>
    </Hero>
  )
}

function StatTile({ label, value, bg, fg, bar, width }: { label: string; value: string; bg: string; fg: string; bar: string; width: number }) {
  const { C } = useTheme()
  const empty = value === '0' || value === '0h 0m'
  return (
    <View style={{ width, backgroundColor: empty ? C.sunken : bg, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 13,
                   borderWidth: 1, borderColor: empty ? C.line : bg, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: empty ? C.line : bar }} />
      <Txt size={21} w={700} color={empty ? C.faint : fg} style={{ lineHeight: 23, marginLeft: 4 }} numberOfLines={1}>{value}</Txt>
      <Txt size={10} w={600} color={empty ? C.faint : fg} numberOfLines={1}
        style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 4, marginTop: 3, opacity: empty ? 1 : 0.8 }}>{label}</Txt>
    </View>
  )
}

export function SummaryTiles({ summary }: { summary: MonthSummary }) {
  const V = useVocab()
  const [w, setW] = React.useState(0)
  const tiles: { label: string; value: string; k: string }[] = [
    { label: 'Present', value: String(summary.present), k: 'PRESENT' },
    { label: 'Absent', value: String(summary.absent), k: 'ABSENT' },
    { label: 'Half day', value: String(summary.halfDay), k: 'HALF_DAY' },
    { label: 'Missed punch', value: String(summary.missPunch), k: 'MISS_OUT' },
    { label: 'Late', value: String(summary.lateCount), k: 'LATE' },
    { label: 'Overtime', value: summary.totalOTHours, k: 'ON_LEAVE' },
    { label: 'Loss of pay', value: String(summary.lopDays), k: 'LWP' },
  ]
  const tileW = w > 0 ? Math.floor((w - 16) / 3) : 0
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {tileW > 0 && tiles.map(t => {
        const [bg, fg] = V.style(t.k)
        return <StatTile key={t.label} label={t.label} value={t.value} bg={bg} fg={fg} bar={V.bar(t.k)} width={tileW} />
      })}
    </View>
  )
}

