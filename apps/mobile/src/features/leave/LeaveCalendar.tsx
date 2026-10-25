// src/features/leave/LeaveCalendar.tsx — the Apply panel's month calendar.
// Source: components/ess/LeaveSection.tsx (.ezlv-cal and the day-cell classes).
// Kept: selected band (rounded at range ends and week-row breaks), today ring,
// weekly-off red, holiday amber + bar, struck-through non-working days inside
// the band, past days disabled, the legend. Dropped (web-only decoration, per
// the spec): hover preview, roving arrow-key focus, sweep/slide animations.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { IconChevron } from '@/ui/icons'
import { cellLabel, DOW, fromIso, MONTHS, monthWeeks, type DayRules, type LeaveForm } from './logic'

// The website paints selected-day text in a literal white (.ezlv-day.is-sel { color:#fff }).
// In dark the band is a light blue, where white is unreadable, so dark uses onAccent.
const SEL_INK_LIGHT = '#FFFFFF'

interface CellProps {
  k: string; rules: DayRules; floor: string; today: string; from: string; to: string
  onPick: (key: string) => void
}

function DayCell({ k, rules, floor, today, from, to, onPick }: CellProps) {
  const { C, isDark } = useTheme()
  const SEL_INK = isDark ? C.onAccent : SEL_INK_LIGHT
  const h = rules.holByDate.get(k)
  const past = k < floor
  const sel = !!from && !!to && k >= from && k <= to
  const isEdge = sel && (k === from || k === to)
  const dow = fromIso(k).getDay()
  const noCount = rules.isNonWorking(k)
  const off = rules.isWeeklyOff(k)
  const isToday = k === today
  const rs = sel && (dow === 0 || k === from)
  const re = sel && (dow === 6 || k === to)

  let bg = 'transparent'
  let fg = C.inkSoft
  let weight: 500 | 600 | 700 = 500
  let strike = false
  if (off) fg = C.critical
  if (h && !sel) { fg = C.warning; weight = 700 }
  if (past) fg = C.faint
  if (isToday) weight = 700
  if (sel) { bg = C.brand; fg = SEL_INK; weight = 700 }
  if (sel && noCount && !isEdge) { bg = C.brandEdge; fg = C.brandDeep; weight = 600; strike = true }
  if (isEdge) { bg = C.brandDeep; fg = SEL_INK; weight = 700 }
  const ring = isToday && (!sel || isEdge)

  return (
    <Pressable
      disabled={past}
      onPress={() => onPick(k)}
      accessibilityRole="button"
      accessibilityState={{ selected: sel, disabled: past }}
      accessibilityLabel={`${cellLabel(k)}${h ? `, ${h.description}` : ''}${past ? ', already passed' : ''}`}
      style={({ pressed }) => ({
        flex: 1, height: 42, alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg, opacity: past ? 0.55 : 1,
        borderTopLeftRadius: sel ? (rs ? R.sm : 0) : R.sm, borderBottomLeftRadius: sel ? (rs ? R.sm : 0) : R.sm,
        borderTopRightRadius: sel ? (re ? R.sm : 0) : R.sm, borderBottomRightRadius: sel ? (re ? R.sm : 0) : R.sm,
        borderWidth: ring ? 2 : 0, borderColor: isEdge ? C.surface : C.brand,
        transform: [{ scale: pressed ? 0.88 : isEdge ? 1.1 : 1 }], zIndex: isEdge ? 1 : 0,
      })}>
      <Txt size={13} w={weight} color={fg} style={strike ? { textDecorationLine: 'line-through' } : undefined}>{fromIso(k).getDate()}</Txt>
      {!!h && <View style={{ position: 'absolute', bottom: 4, width: 11, height: 2, borderRadius: 1, backgroundColor: past ? C.faint : isEdge || (sel && !noCount) ? fg : C.warning }} />}
    </Pressable>
  )
}

function LegendItem({ swatch, label }: { swatch?: React.ReactNode; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {swatch}
      <Txt size={F.micro} tone="muted">{label}</Txt>
    </View>
  )
}

export function LeaveCalendar({ cursor, onCursor, floor, today, form, rules, onPick }: {
  cursor: Date; onCursor: (d: Date) => void; floor: string; today: string
  form: LeaveForm; rules: DayRules; onPick: (key: string) => void
}) {
  const { C } = useTheme()
  const floorDate = fromIso(floor)
  const atFloorMonth = cursor.getFullYear() === floorDate.getFullYear() && cursor.getMonth() === floorDate.getMonth()
  const weeks = React.useMemo(() => monthWeeks(cursor), [cursor])
  const from = form.from_date, to = form.to_date
  const inSel = (k: string) => !!from && !!to && k >= from && k <= to

  return (
    <View style={{ marginTop: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: S.sm }}>
        <Pressable disabled={atFloorMonth} accessibilityLabel="Previous month" accessibilityRole="button"
          onPress={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: atFloorMonth ? 0.35 : 1, transform: [{ rotate: '180deg' }] }}>
          <IconChevron size={18} color={C.ink} strokeWidth={2.4} />
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', gap: 4 }}>
          <Txt size={F.lead} w={700}>{MONTHS[cursor.getMonth()]}</Txt>
          <Txt size={F.lead} w={500} tone="muted">{cursor.getFullYear()}</Txt>
        </View>
        {!atFloorMonth && (
          <Pressable accessibilityRole="button" onPress={() => onCursor(new Date(floorDate.getFullYear(), floorDate.getMonth(), 1))}
            style={{ minHeight: 32, paddingHorizontal: 10, borderRadius: R.pill, borderWidth: 1, borderColor: C.brandEdge, justifyContent: 'center' }}>
            <Txt size={F.tiny} w={600} color={C.brandDeep}>Today</Txt>
          </Pressable>
        )}
        <Pressable accessibilityLabel="Next month" accessibilityRole="button"
          onPress={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <IconChevron size={18} color={C.ink} strokeWidth={2.4} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 3 }} importantForAccessibility="no-hide-descendants">
        {DOW.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 2 }}>
            {/* Sunday is red in the header, like every Indian wall calendar. */}
            <Txt size={10} w={700} color={i === 0 ? C.critical : C.muted}>{d}</Txt>
          </View>
        ))}
      </View>

      <View style={{ gap: 2 }} accessibilityLabel="Choose dates">
        {weeks.map((week, wi) => (
          <View key={wi} style={{
            flexDirection: 'row', gap: 2, paddingVertical: 1, paddingHorizontal: 3, borderRadius: R.md,
            backgroundColor: week.some(k => !!k && inSel(k)) ? C.brandTint : 'transparent',
          }}>
            {week.map((k, i) => k
              ? <DayCell key={k} k={k} rules={rules} floor={floor} today={today} from={from} to={to} onPick={onPick} />
              : <View key={`b${wi}-${i}`} style={{ flex: 1, height: 42 }} />)}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: S.sm }}>
        <LegendItem swatch={<View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: C.brand }} />} label="Selected" />
        <LegendItem swatch={<View style={{ width: 10, height: 10, borderRadius: 3, borderWidth: 2, borderColor: C.brand }} />} label="Today" />
        <LegendItem swatch={<Txt size={F.micro} w={700} color={C.critical}>7</Txt>} label="Weekly off" />
        <LegendItem swatch={<Txt size={F.micro} w={700} color={C.warning}>7</Txt>} label="Holiday" />
        <LegendItem label="Struck-through days sit inside your dates but are not counted" />
        <LegendItem label="Tap again to clear · a later day extends · an earlier one starts over" />
      </View>
    </View>
  )
}
