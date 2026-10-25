// src/features/attendance/Calendar.tsx — (C) the month grid, its legend and the
// loading shimmer. EmployeePortal.tsx AttendanceCalendar / CalendarLegend, phone
// layout (one-letter weekdays, 12px day numbers, 8px codes). The 3D tilt, cell
// entrance wave and sheen are web-only decoration (spec, RN notes) and are left out.
// Hover tooltips become a long-press toast with the same text.
import * as React from 'react'
import { Animated, Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { atMidnight, fmtT, pad2, resolveDay, WEEKDAYS, type MonthlyData } from './model'
import { useVocab } from './bits'

const GAP = 4
const CELL_H = 44   // web: 40 on mobile; 44 keeps the touch target at 44dp

function Legend() {
  const { C } = useTheme()
  const V = useVocab()
  const items = ['PRESENT', 'LATE', 'HALF_DAY', 'MISS_IN', 'MISS_OUT', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF']
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, columnGap: 13, marginTop: 11, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.brandEdge }}>
      {items.map(k => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt size={9} w={800} color={V.bar(k)} center style={{ minWidth: 18 }}>{V.label(k) || '•'}</Txt>
          <Txt size={10} tone="muted">{V.full(k)}</Txt>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.warning }} />
        <Txt size={10} tone="muted">Correction pending</Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Txt size={10} w={800} tone="positive">✓</Txt>
        <Txt size={10} tone="muted">Regularised</Txt>
      </View>
    </View>
  )
}

/** 35 pulsing cells while the month loads (web: brandTint shimmer). */
export function CalendarShimmer() {
  const { C } = useTheme()
  const a = React.useRef(new Animated.Value(0.55)).current
  const [w, setW] = React.useState(0)
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.55, duration: 600, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [a])
  return (
    <Animated.View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, opacity: a, minHeight: CELL_H * 5 + GAP * 4 }}
      accessibilityLabel="Loading attendance">
      {w > 0 && Array.from({ length: 35 }).map((_, i) => (
        <View key={i} style={{ width: (w - GAP * 6) / 7, height: CELL_H, borderRadius: R.md, backgroundColor: C.brandTint }} />
      ))}
    </Animated.View>
  )
}

function DayCell({ dateStr, d, monthData, todayStr, selected, width, onPick }: {
  dateStr: string; d: number; monthData: MonthlyData; todayStr: string; selected: boolean; width: number; onPick: (d: string) => void
}) {
  const { C } = useTheme()
  const V = useVocab()
  const { notify } = useOverlay()
  const { status, rec, leave, day } = resolveDay(dateStr, monthData, todayStr)
  const [bg, ink] = V.style(status)
  const dot = V.bar(status)
  const isToday = dateStr === todayStr
  const isFuture = status === 'FUTURE'
  const code = status === 'ON_LEAVE' || status === 'HALF_LEAVE' ? (leave?.short_name || V.label(status)) : V.label(status)
  const pendingFix = day?.correction?.status === 'PENDING'
  const fixed = !!day?.regularised || day?.correction?.status === 'APPROVED'
  const title = `${V.full(status) || status}${rec?.work_in ? ` · in ${fmtT(rec.work_in)}` : ''}${rec?.work_out ? ` · out ${fmtT(rec.work_out)}` : ''}${rec?.late_minutes ? ` · ${rec.late_minutes}m late` : ''}${pendingFix ? ' · correction pending' : fixed ? ' · regularised' : ''}`

  const inner = (
    <>
      <Txt size={12} w={isToday ? 800 : 600} color={selected ? C.onAccent : ink} style={{ lineHeight: 13 }}>{d}</Txt>
      {!isFuture && !!code && (
        <Txt size={8} w={800} color={selected ? C.onAccent : dot} style={{ lineHeight: 9, marginTop: 1, letterSpacing: 0.16 }} numberOfLines={1}>{code}</Txt>
      )}
      {pendingFix && <View style={{ position: 'absolute', top: 3, left: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: C.warning }} />}
      {!pendingFix && fixed && (
        <Txt size={8} w={800} color={selected ? C.onAccent : C.positive} style={{ position: 'absolute', top: 1, left: 3, lineHeight: 9 }}>✓</Txt>
      )}
      {isToday && !selected && <View style={{ position: 'absolute', top: 3, right: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: C.brand }} />}
    </>
  )
  const box = {
    width, height: CELL_H, borderRadius: R.md, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    borderWidth: selected ? 1 : isToday ? 2 : 1, borderColor: selected ? C.brandDeep : isToday ? C.brand : C.line,
    opacity: isFuture ? 0.45 : 1,
  }
  return (
    <Pressable disabled={isFuture} onPress={() => onPick(dateStr)} onLongPress={isFuture ? undefined : () => notify(title, 'info')}
      accessibilityRole="button" accessibilityLabel={`${atMidnight(dateStr).getDate()} — ${isFuture ? 'upcoming' : title}`}
      accessibilityState={{ selected, disabled: isFuture }}
      style={({ pressed }) => [box, { backgroundColor: selected ? undefined : isFuture ? 'transparent' : bg, transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
      {selected
        ? <LinearGradient colors={[C.brand, C.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>{inner}</LinearGradient>
        : inner}
    </Pressable>
  )
}

export function AttendanceCalendar({ year, month, monthData, todayStr, onDayClick, selectedDate }: {
  year: number; month: number; monthData: MonthlyData; todayStr: string; onDayClick: (d: string) => void; selectedDate: string | null
}) {
  const { C } = useTheme()
  const [w, setW] = React.useState(0)
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = new Date(year, month - 1, 1).getDay()
  const offDows = new Set([...monthData.weekoffSet].map(d => atMidnight(d).getDay()))
  const cellW = w > 0 ? (w - GAP * 6) / 7 : 0

  const cells: React.ReactNode[] = []
  for (let i = 0; i < lead; i++) cells.push(<View key={'b' + i} style={{ width: cellW, height: CELL_H }} />)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`
    cells.push(<DayCell key={dateStr} dateStr={dateStr} d={d} monthData={monthData} todayStr={todayStr}
      selected={dateStr === selectedDate} width={cellW} onPick={onDayClick} />)
  }

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)}>
      <View style={{ flexDirection: 'row', gap: GAP, marginBottom: 3 }}>
        {WEEKDAYS.map((wd, n) => (
          <View key={wd} style={{ flex: 1, alignItems: 'center', paddingVertical: 3 }}>
            <Txt size={10} w={700} color={offDows.has(n) ? C.brand : C.muted} style={{ letterSpacing: 0.5 }}>{wd[0]}</Txt>
          </View>
        ))}
      </View>
      {cellW > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>{cells}</View>}
      <Legend />
    </View>
  )
}
