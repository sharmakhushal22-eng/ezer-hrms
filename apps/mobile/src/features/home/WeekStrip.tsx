// src/features/home/WeekStrip.tsx — components/ess/today/WeekStrip.tsx.
//
// Monday–Sunday of the device-local week, from GET /api/ess/attendance — the same
// per-day verdict (`kind`) the Attendance calendar renders. The payload's `week`
// is only the fallback while that loads or if it fails.
import * as React from 'react'
import { View } from 'react-native'
import { openLink } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { Txt } from '@/ui/primitives'
import { fmtISO, weekday } from '@web/today/format'
import { ROUTES } from '@web/today/schema'
import { useWeekDays, ymd, type DayKind, type Prefs, type TodayPayload } from './data'
import { alpha, CardHead, HomeCard, useMounted } from './kit'

const CLASS_OF: Record<DayKind, string> = {
  PRESENT: 'present', LATE: 'late', HALF_DAY: 'half', MISS_IN: 'miss', MISS_OUT: 'miss',
  IN_PROGRESS: 'present', ABSENT: 'absent', LEAVE: 'leave', HALF_LEAVE: 'leave',
  HOLIDAY: 'holiday', WEEKLY_OFF: 'off', UPCOMING: 'next',
}
interface Cell { date: string; kind: DayKind | null; in: string | null; out: string | null; minutes: number | null; note: string | null }
const SHIFT_H = 9

export function WeekStrip({ data, prefs, liveIn }: { data: TodayPayload; prefs: Prefs; liveIn: Date | null }) {
  const { C } = useTheme()
  const ready = useMounted(250)
  const q = useWeekDays(data.employee.id)
  const days = q.data || null
  const todayISO = ymd(new Date())

  const cells: Cell[] = days
    ? days.map(d => ({ date: d.date, kind: d.kind, in: d.work_in, out: d.work_out, minutes: d.total_minutes,
        note: d.kind === 'LEAVE' || d.kind === 'HALF_LEAVE' ? (d.leave?.name ?? d.note) : d.note }))
    : data.week.map(d => ({ date: String(d.date).slice(0, 10), kind: d.is_off ? 'WEEKLY_OFF' : null, in: d.punch_in, out: d.punch_out,
        minutes: d.hours != null ? d.hours * 60 : null, note: null }))

  const t = (iso: string | null) => fmtISO(iso, prefs.time_format)
  const span = (a: string | null, b: string | null) => prefs.time_format === '24' && b ? `${t(a)}–${t(b)}` : t(a)

  return (
    <HomeCard>
      <CardHead title="This week" more={{ label: 'Attendance', onPress: () => openLink(ROUTES.attendance) }} />
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {cells.map(d => {
          const isToday = d.date === todayISO, future = d.date > todayISO
          const liveHours = isToday && liveIn ? (Date.now() - liveIn.getTime()) / 3.6e6 : null
          const offDay = d.kind === 'HOLIDAY' || d.kind === 'WEEKLY_OFF' || d.kind === 'LEAVE' || d.kind === 'ABSENT'
          const w = ready && !offDay ? Math.min(100, ((liveHours ?? (d.minutes ?? 0) / 60) / SHIFT_H) * 100) : 0

          let l1 = '', l2 = ''
          switch (d.kind) {
            case 'WEEKLY_OFF': l1 = 'Weekly off'; break
            case 'HOLIDAY': l1 = 'Holiday'; l2 = d.note ?? ''; break
            case 'LEAVE': l1 = 'On leave'; l2 = d.note ?? ''; break
            case 'HALF_LEAVE': l1 = d.in ? t(d.in) : 'Half-day leave'; l2 = d.in ? 'Half-day leave' : (d.note ?? ''); break
            case 'ABSENT': l1 = 'Absent'; break
            case 'MISS_OUT': l1 = t(d.in); l2 = 'Missed out'; break
            case 'MISS_IN': l1 = t(d.out); l2 = 'Missed in'; break
            case 'HALF_DAY': l1 = span(d.in, d.out); l2 = 'Half day'; break
            case 'LATE': l1 = span(d.in, d.out); l2 = 'Late'; break
            case 'PRESENT': l1 = span(d.in, d.out); l2 = 'Present'; break
            case 'IN_PROGRESS': l1 = t(liveIn ? liveIn.toISOString() : d.in); l2 = 'In progress'; break
            case 'UPCOMING': l1 = isToday ? 'Not in yet' : 'Upcoming'; break
            default:
              if (d.in) { l1 = t(d.in); l2 = d.out ? t(d.out) : (isToday ? 'In progress' : '') }
              else l1 = future ? 'Upcoming' : isToday ? 'Not in yet' : ''
          }
          const cls = isToday ? 'today' : d.kind ? CLASS_OF[d.kind] : (future ? 'next' : '')
          // today.css v3: each day coloured by its status (--d), matching the calendar.
          const hue = cls === 'present' ? C.positive : cls === 'late' || cls === 'half' ? C.warning
            : cls === 'miss' || cls === 'absent' ? C.critical : cls === 'leave' ? C.brand : cls === 'holiday' ? C.info : null
          let bg = C.sunken, edge = C.line, dd = C.ink, l2c = C.muted, l1c = C.muted, barBg = C.line, barFg = C.positive, op = 1
          if (hue) {
            bg = alpha(hue, 0.11); edge = alpha(hue, 0.3); dd = hue; l2c = hue; barBg = alpha(hue, 0.18)
            if (cls === 'miss') { bg = alpha(C.warning, 0.12); edge = alpha(C.critical, 0.45) }
            if (cls === 'absent') l1c = hue
            if (cls === 'present' || cls === 'late' || cls === 'half' || cls === 'miss') barFg = hue
          }
          if (cls === 'off') { bg = C.sunken; op = 0.55 }
          if (cls === 'next') { bg = C.surface; dd = C.faint }
          if (cls === 'today') { bg = C.brandTint; edge = C.brandEdge; dd = C.brand; barFg = C.brand }
          const title = [l1, l2].filter(Boolean).join(' · ')
          return (
            <View key={d.date} accessible accessibilityLabel={`${weekday(d.date)} ${new Date(d.date + 'T00:00:00').getDate()}${title ? ` · ${title}` : ''}`}
              style={{ flex: 1, minWidth: 0, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 3, backgroundColor: bg, borderWidth: 1, borderColor: edge, opacity: op, alignItems: 'center' }}>
              <Txt size={11} w={600} tone="faint">{weekday(d.date)}</Txt>
              <Txt size={17} w={700} color={dd} style={{ marginTop: 2, marginBottom: 3 }}>{new Date(d.date + 'T00:00:00').getDate()}</Txt>
              <Txt size={9.5} w={600} color={l1c} numberOfLines={1}>{l1 || ' '}</Txt>
              <Txt size={9.5} w={600} color={l2c} numberOfLines={1}>{l2 || ' '}</Txt>
              <View style={{ alignSelf: 'stretch', height: 4, borderRadius: 99, backgroundColor: barBg, marginTop: 7, overflow: 'hidden' }}>
                <View style={{ width: `${w}%`, height: '100%', borderRadius: 99, backgroundColor: barFg }} />
              </View>
            </View>
          )
        })}
      </View>
    </HomeCard>
  )
}
