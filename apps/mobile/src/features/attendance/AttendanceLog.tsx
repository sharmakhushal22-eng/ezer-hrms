// src/features/attendance/AttendanceLog.tsx — (F) the day-by-day list and
// picking days to regularise together. components/ess/attendance/AttendanceLog.tsx,
// in its mobile layout (cards, horizontally scrolling filter chips).
//
// The state lives in useLogController(), held by the screen, because two pieces
// sit outside this card on a phone: the selection bar floats above the tab bar
// (the website's sticky bar), and the review step opens as a full sheet.
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, PickerField, Segmented, Txt } from '@/ui/primitives'
import { DateSheet } from '@/ui/overlays'
import { IconCheck, IconChevronDown } from '@/ui/icons'
import { useRange } from './api'
import {
  addDays, dayLabel, fmt, hours, isOff, istClock, kindMeta, MAX_DAYS, NEEDS_ATTENTION, rangeErrorOf, rangeFor, selectable, ymdLocal,
  type AttendanceDay, type Filter, type Preset,
} from './model'
import { KindBadge } from './bits'

export function useLogController() {
  const todayLocal = ymdLocal(new Date())
  const [open, setOpen] = React.useState(false)
  const [preset, setPreset] = React.useState<Preset>('week')
  const [custom, setCustom] = React.useState<{ from: string; to: string }>(() => ({ from: addDays(todayLocal, -13), to: todayLocal }))
  const range = React.useMemo(() => rangeFor(preset, custom, todayLocal), [preset, custom, todayLocal])
  const rangeError = rangeErrorOf(range)
  const [filter, setFilter] = React.useState<Filter>('ALL')
  const [rawPicked, setPicked] = React.useState<Set<string>>(new Set())
  const [review, setReview] = React.useState(false)

  const q = useRange(range.from, range.to, open && !rangeError)
  const data = q.data
  const fresh = !!data && data.from === range.from && data.to === range.to
  const err = !rangeError && q.error ? (q.error as Error).message || 'Could not load attendance' : ''
  const loading = !rangeError && !err && !fresh

  // After each load, only picks that are still in range and still pickable count.
  const picked = React.useMemo(() => {
    if (!fresh || !data) return rawPicked
    const n = new Set([...rawPicked].filter(dt => data.days.some(d => d.date === dt && selectable(d, data.today).ok)))
    return n.size === rawPicked.size ? rawPicked : n
  }, [rawPicked, data, fresh])

  const today = data?.today ?? todayLocal
  const days = React.useMemo(() => [...(data?.days || [])].reverse(), [data])
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {}
    for (const d of days) c[d.kind] = (c[d.kind] || 0) + 1
    c.ATTENTION = days.filter(d => NEEDS_ATTENTION.includes(d.kind) && selectable(d, today).ok).length
    return c
  }, [days, today])
  const shown = days.filter(d => filter === 'ALL' ? true
    : filter === 'ATTENTION' ? NEEDS_ATTENTION.includes(d.kind) && selectable(d, today).ok
    : d.kind === filter)
  const shownPickable = shown.filter(d => selectable(d, today).ok)
  const allShownPicked = shownPickable.length > 0 && shownPickable.every(d => picked.has(d.date))
  const toggle = (date: string) => setPicked(p => { const n = new Set(p); if (n.has(date)) n.delete(date); else n.add(date); return n })
  const toggleAllShown = () => setPicked(p => {
    const n = new Set(p)
    if (allShownPicked) shownPickable.forEach(d => n.delete(d.date)); else shownPickable.forEach(d => n.add(d.date))
    return n
  })
  const pickedDays = days.filter(d => picked.has(d.date)).sort((a, b) => a.date.localeCompare(b.date))

  return {
    todayLocal, open, setOpen, preset, setPreset, custom, setCustom, range, rangeError, filter, setFilter,
    picked, setPicked, review, setReview, data, err, loading, retry: () => void q.refetch(),
    today, days, counts, shown, shownPickable, allShownPicked, toggle, toggleAllShown, pickedDays,
  }
}
export type LogController = ReturnType<typeof useLogController>

const CHIPS: [Filter, string][] = [
  ['ALL', 'All'], ['ATTENTION', 'Needs attention'],
  ['PRESENT', 'Present'], ['LATE', 'Late'], ['HALF_DAY', 'Half day'],
  ['MISS_IN', 'Missed punch-in'], ['MISS_OUT', 'Missed punch-out'], ['ABSENT', 'Absent'],
  ['LEAVE', 'Leave'], ['HALF_LEAVE', 'Half-day leave'], ['WEEKLY_OFF', 'Weekly off'], ['HOLIDAY', 'Holiday'],
]
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'week', label: 'Last 7 days' }, { key: 'month', label: 'This month' }, { key: 'last', label: 'Last month' }, { key: 'custom', label: 'Custom' },
]

function Tick({ on, disabled }: { on: boolean; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? C.brand : C.lineStrong,
                   backgroundColor: on ? C.brand : disabled ? C.sunken : C.surface, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      {on && <IconCheck size={14} color={C.onAccent} strokeWidth={2.4} />}
    </View>
  )
}

/** AttendanceLog.tsx correctionCell, with the declined remark printed (it was a hover tooltip). */
function CorrectionLine({ d }: { d: AttendanceDay }) {
  const c = d.correction
  if (c?.status === 'PENDING') return <Txt size={F.tiny} tone="warning">Pending{c.waiting_on ? ` · ${c.waiting_on.name}` : ''}</Txt>
  if (c?.status === 'APPROVED' || d.regularised) return <Txt size={F.tiny} tone="positive">Regularised{c?.decided_by ? ` · ${c.decided_by}` : ''}</Txt>
  if (c?.status === 'REJECTED') return (
    <View>
      <Txt size={F.tiny} tone="critical">Declined{c.decided_by ? ` · ${c.decided_by}` : ''}</Txt>
      {!!c.review_remark && <Txt size={F.micro} tone="faint">{c.review_remark}</Txt>}
    </View>
  )
  return <Txt size={F.tiny} tone="faint">—</Txt>
}

function DayCard({ d, today, on, onToggle }: { d: AttendanceDay; today: string; on: boolean; onToggle: (date: string) => void }) {
  const { C } = useTheme()
  const meta = React.useMemo(() => kindMeta(C), [C])
  const s = selectable(d, today)
  const off = isOff(d)
  return (
    <Pressable disabled={!s.ok} onPress={() => onToggle(d.date)} accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: !s.ok }} accessibilityLabel={`Select ${dayLabel(d.date)}`}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.md,
        borderWidth: 1, borderColor: on ? C.brand : C.line, borderLeftWidth: 3, borderLeftColor: meta[d.kind].bar,
        backgroundColor: on || pressed ? C.brandTint : C.surface,
      })}>
      <View style={{ marginTop: 1 }}><Tick on={on} disabled={!s.ok} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <Txt size={F.small} w={700}>{dayLabel(d.date)}{d.date === today ? <Txt size={F.micro} tone="brand">  TODAY</Txt> : null}</Txt>
          <KindBadge day={d} compact />
        </View>
        {!off && (
          <Txt size={F.tiny} tone="muted" style={{ marginTop: 3 }}>
            In {istClock(d.work_in) ?? '—'}{!!d.expected_in && <Txt size={F.tiny} tone="faint"> (exp {d.expected_in})</Txt>}
            {' · '}Out {d.kind === 'IN_PROGRESS' ? 'at work' : istClock(d.work_out) ?? '—'}{!!d.expected_out && <Txt size={F.tiny} tone="faint"> (exp {d.expected_out})</Txt>}
            {' · '}{hours(d.total_minutes)}
          </Txt>
        )}
        {(!!d.correction || d.regularised) && <View style={{ marginTop: 3 }}><CorrectionLine d={d} /></View>}
        {!s.ok && !off && !d.correction && !d.regularised && !!s.why && <Txt size={F.micro} tone="faint" style={{ marginTop: 3 }}>{s.why}</Txt>}
      </View>
    </Pressable>
  )
}

function Chip({ label, count, on, dot, meta, onPress }: { label: string; count: number; on: boolean; dot?: string; meta?: { bg: string; fg: string; bar: string }; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: R.pill, borderWidth: 1,
               borderColor: on ? (meta?.bar ?? C.brand) : C.line, backgroundColor: on ? (meta?.bg ?? C.brandTint) : C.surface }}>
      {!!dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />}
      <Txt size={F.tiny} w={600} color={on ? (meta?.fg ?? C.brandDeep) : C.inkSoft}>{label} <Txt size={F.tiny} w={700} color={on ? (meta?.fg ?? C.brandDeep) : C.inkSoft}>{count}</Txt></Txt>
    </Pressable>
  )
}

function ToggleButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Button title={open ? 'Hide log' : 'View attendance log'} variant={open ? 'outline' : 'primary'} size="sm" onPress={onPress}
      icon={<View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><IconChevronDown size={14} color={open ? C.brandDeep : C.onAccent} /></View>} />
  )
}

export function AttendanceLog({ ctl }: { ctl: LogController }) {
  const { C } = useTheme()
  const meta = React.useMemo(() => kindMeta(C), [C])
  const [dateSheet, setDateSheet] = React.useState<'from' | 'to' | null>(null)

  if (!ctl.open) {
    return (
      <Card style={{ marginBottom: S.md }}>
        <Txt size={F.lead} w={700}>Attendance log</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2, marginBottom: S.md }}>
          Day-by-day punches, hours and status. Open it to review a range or correct several days at once.
        </Txt>
        <View style={{ alignSelf: 'flex-start' }}><ToggleButton open={false} onPress={() => ctl.setOpen(true)} /></View>
      </Card>
    )
  }

  const { data, shown } = ctl
  return (
    <Card style={{ marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginBottom: S.md }}>
        <View style={{ flex: 1 }}>
          <Txt size={F.lead} w={700}>Attendance log</Txt>
          <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>
            Every day in the range. Tick the days to correct — any days, they need not be in a row — and send them for approval together.
          </Txt>
        </View>
        <ToggleButton open onPress={() => ctl.setOpen(false)} />
      </View>
      <Segmented items={PRESETS} value={ctl.preset} onChange={ctl.setPreset} style={{ marginBottom: S.md }} />

      {ctl.preset === 'custom' && (
        <View style={{ marginBottom: S.sm }}>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <PickerField label="From" value={fmt(ctl.custom.from)} onPress={() => setDateSheet('from')} style={{ flex: 1, marginBottom: 4 }} />
            <PickerField label="To" value={fmt(ctl.custom.to)} onPress={() => setDateSheet('to')} style={{ flex: 1, marginBottom: 4 }} />
          </View>
          <Txt size={F.tiny} tone="faint">Up to {MAX_DAYS} days.</Txt>
          <DateSheet visible={!!dateSheet} onClose={() => setDateSheet(null)} max={ctl.todayLocal}
            title={dateSheet === 'to' ? 'To' : 'From'} value={dateSheet ? ctl.custom[dateSheet] : null}
            onPick={v => { const k = dateSheet; if (k) ctl.setCustom(c => ({ ...c, [k]: v })) }} />
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: S.md, marginHorizontal: -S.lg }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: S.lg }}>
        {CHIPS.filter(([k]) => k === 'ALL' || (ctl.counts[k] || 0) > 0).map(([k, l]) => {
          const m = k === 'ALL' || k === 'ATTENTION' ? undefined : meta[k]
          return <Chip key={k} label={l} count={k === 'ALL' ? ctl.days.length : ctl.counts[k] || 0} on={ctl.filter === k}
            dot={m?.bar} meta={m} onPress={() => ctl.setFilter(k)} />
        })}
      </ScrollView>

      {!!ctl.rangeError && <Txt size={F.tiny} tone="critical" style={{ marginBottom: S.sm }}>{ctl.rangeError}</Txt>}
      {!!ctl.err && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm, flexWrap: 'wrap' }}>
          <Txt size={F.tiny} tone="critical" style={{ flexShrink: 1 }}>{ctl.err}</Txt>
          <Button title="Try again" size="sm" variant="outline" onPress={ctl.retry} />
        </View>
      )}

      {!data && ctl.loading && <Txt size={F.tiny} tone="faint" style={{ paddingVertical: 18 }}>Loading attendance…</Txt>}
      {!!data && shown.length === 0 && (
        <Txt size={F.tiny} tone="faint" center style={{ paddingVertical: 18 }}>
          {ctl.filter === 'ATTENTION' ? 'Nothing needs correcting in this range.' : 'No days match this filter.'}
        </Txt>
      )}
      {!!data && shown.length > 0 && (
        <View style={{ gap: S.sm, opacity: ctl.loading ? 0.6 : 1 }}>
          {ctl.shownPickable.length > 0 && (
            <Pressable onPress={ctl.toggleAllShown} accessibilityRole="checkbox" accessibilityState={{ checked: ctl.allShownPicked }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
              <Tick on={ctl.allShownPicked} />
              <Txt size={F.tiny} tone="muted">Select every correctable day shown</Txt>
            </Pressable>
          )}
          {shown.map(d => <DayCard key={d.date} d={d} today={ctl.today} on={ctl.picked.has(d.date)} onToggle={ctl.toggle} />)}
        </View>
      )}
      {ctl.picked.size > 0 && !ctl.review && <View style={{ height: 64 }} />}
    </Card>
  )
}

/** The sticky selection bar, floated above the tab bar while days are picked. */
export function SelectionBar({ ctl, bottom }: { ctl: LogController; bottom: number }) {
  const { C } = useTheme()
  if (!ctl.open || ctl.picked.size === 0 || ctl.review) return null
  const n = ctl.picked.size
  return (
    <View style={{ position: 'absolute', left: S.lg, right: S.lg, bottom, flexDirection: 'row', alignItems: 'center', gap: S.sm,
                   paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1, borderColor: C.brand,
                   shadowColor: C.shadow, shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}>
      <Txt size={F.small} w={600} style={{ flexShrink: 1 }}>{n} day{n === 1 ? '' : 's'} selected</Txt>
      <Button title="Clear" size="sm" variant="outline" onPress={() => ctl.setPicked(new Set())} />
      <View style={{ flex: 1 }} />
      <Button title="Regularise selected →" size="sm" onPress={() => ctl.setReview(true)} />
    </View>
  )
}
