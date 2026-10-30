// src/features/attendance/bits.tsx — small pieces shared by the Attendance sections:
// the two status pills, a tinted message box, the amber "Raise" button, and a
// 24-hour time picker (the website's <input type="time">).
import * as React from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, FieldLabel, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { IconClock } from '@/ui/icons'
import { kindMeta, pad2, statusVocab, type AttendanceDay } from './model'

export function useVocab() {
  const { C } = useTheme()
  return React.useMemo(() => statusVocab(C), [C])
}

/** EmployeePortal.tsx StatusBadge — the calendar's status pill. */
export function StatusBadge({ status }: { status: string }) {
  const V = useVocab()
  const [bg, c] = V.style(status)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill, backgroundColor: bg, alignSelf: 'flex-start' }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: V.bar(status) }} />
      <Txt size={10} w={600} color={c}>{V.full(status)}</Txt>
    </View>
  )
}

/** AttendanceLog.tsx KindBadge — the list's status pill. */
export function KindBadge({ day, compact }: { day: Pick<AttendanceDay, 'kind' | 'leave' | 'note' | 'late_minutes'>; compact?: boolean }) {
  const { C } = useTheme()
  const m = React.useMemo(() => kindMeta(C), [C])[day.kind]
  const extra = day.kind === 'LEAVE' || day.kind === 'HALF_LEAVE' ? (day.leave?.short_name ? ` · ${day.leave.short_name}` : '')
    : day.kind === 'LATE' && day.late_minutes ? ` · ${day.late_minutes}m`
    : day.kind === 'HOLIDAY' && day.note && !compact ? ` · ${day.note}` : ''
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill,
                   backgroundColor: m.bg, borderWidth: 1, borderColor: day.kind === 'UPCOMING' ? C.line : 'transparent', alignSelf: 'flex-start', flexShrink: 1 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.bar }} />
      <Txt size={F.micro} w={600} color={m.fg} numberOfLines={1} style={{ flexShrink: 1 }}>{m.label}{extra}</Txt>
    </View>
  )
}

/** A tinted line of text (the day panel's notes). */
export function TintBox({ fg, bg, children, size = 12.5, style }: { fg: string; bg: string; children: React.ReactNode; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: bg, borderRadius: R.sm, paddingVertical: 8, paddingHorizontal: 11, marginBottom: 10 }, style]}>
      <Txt size={size} color={fg}>{children}</Txt>
    </View>
  )
}

/** The day panel's primary button, painted C.warning as on the website. */
export function WarnButton({ title, onPress }: { title: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ marginTop: 12, minHeight: 46, borderRadius: R.md, backgroundColor: C.warning, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.lg, opacity: pressed ? 0.85 : 1 })}>
      <Txt size={F.small + 1} w={600} color={C.onAccent}>{title}</Txt>
    </Pressable>
  )
}

/** Section eyebrow (EmployeePortal.tsx T.section). */
export function Section({ children }: { children: React.ReactNode }) {
  return <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: S.md }}>{children}</Txt>
}

// ── Time picker ─────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i))
const ROW = 44

function Column({ items, value, onPick, label }: { items: string[]; value: string; onPick: (v: string) => void; label: string }) {
  const { C } = useTheme()
  const ref = React.useRef<ScrollView>(null)
  const idx = Math.max(0, items.indexOf(value))
  return (
    <View style={{ flex: 1 }}>
      <Txt size={F.micro} w={700} tone="muted" upper center style={{ marginBottom: 6 }}>{label}</Txt>
      <ScrollView ref={ref} style={{ height: ROW * 5, borderRadius: R.md, backgroundColor: C.sunken }} nestedScrollEnabled
        onLayout={() => ref.current?.scrollTo({ y: Math.max(0, (idx - 2) * ROW), animated: false })}>
        {items.map(v => {
          const on = v === value
          return (
            <Pressable key={v} onPress={() => onPick(v)} accessibilityRole="button" accessibilityLabel={`${label} ${v}`} accessibilityState={{ selected: on }}
              style={{ height: ROW, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6, borderRadius: R.sm, backgroundColor: on ? C.brand : 'transparent' }}>
              <Txt size={F.lead} w={on ? 700 : 500} color={on ? C.onAccent : C.ink}>{v}</Txt>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function TimeSheet({ visible, onClose, value, onPick, title }: { visible: boolean; onClose: () => void; value: string; onPick: (v: string) => void; title: string }) {
  const [h, setH] = React.useState('09')
  const [m, setM] = React.useState('00')
  // Start from the field's value each time the sheet opens (state adjusted while
  // rendering, React's pattern for "reset when a prop changes").
  const [seen, setSeen] = React.useState<string | null>(null)
  const key = visible ? value || '' : null
  if (key !== seen) {
    setSeen(key)
    if (key !== null) {
      const x = /^(\d{2}):(\d{2})/.exec(key)
      setH(x ? x[1] : '09'); setM(x ? x[2] : '00')
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title}
      footer={<Button title={`Set ${h}:${m}`} full onPress={() => { onPick(`${h}:${m}`); onClose() }} style={{ marginBottom: S.sm }} />}>
      {visible && (
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Column label="Hour" items={HOURS} value={h} onPick={setH} />
          <Column label="Minute" items={MINUTES} value={m} onPick={setM} />
        </View>
      )}
    </Sheet>
  )
}

/** A labelled HH:mm field that opens the time sheet. */
export function TimeField({ label, required, value, onChange, compact, style }: {
  label?: string; required?: boolean; value: string; onChange: (v: string) => void; compact?: boolean; style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  return (
    <View style={[!compact && { marginBottom: S.md }, style]}>
      {!!label && !compact && <FieldLabel label={label} required={required} />}
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label || 'Time'}: ${value || 'not set'}`}
        style={({ pressed }) => ({
          minHeight: compact ? 40 : 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: S.md,
          backgroundColor: pressed ? C.brandTint : C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        })}>
        <Txt size={F.body} w={500} color={value ? C.ink : C.faint}>{value || '--:--'}</Txt>
        <IconClock size={15} color={C.faint} />
      </Pressable>
      <TimeSheet visible={open} onClose={() => setOpen(false)} value={value} onPick={onChange} title={label || 'Pick a time'} />
    </View>
  )
}
