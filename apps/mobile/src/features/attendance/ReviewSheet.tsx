// src/features/attendance/ReviewSheet.tsx — the attendance log's review step:
// each picked day's times, one reason, submit. AttendanceLog.tsx ReviewPanel,
// opened as a full bottom sheet on the phone.
import * as React from 'react'
import { View } from 'react-native'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { afterChange, fileRegularisation } from './api'
import { dayLabel, istClock, proposed, type AttendanceDay } from './model'
import { KindBadge, TimeField } from './bits'

function DayRow({ d, t, onSet }: { d: AttendanceDay; t: { in: string; out: string } | undefined; onSet: (date: string, k: 'in' | 'out', v: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: R.sm, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <Txt size={F.small} w={700}>{dayLabel(d.date)}</Txt>
        <KindBadge day={d} compact />
      </View>
      <Txt size={F.micro} tone="faint">
        {d.work_in || d.work_out ? `recorded ${istClock(d.work_in) ?? 'no in'} – ${istClock(d.work_out) ?? 'no out'}` : 'no punches recorded'}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TimeField compact label={`In time, ${dayLabel(d.date)}`} value={t?.in || ''} onChange={v => onSet(d.date, 'in', v)} style={{ flex: 1 }} />
        <Txt tone="faint">→</Txt>
        <TimeField compact label={`Out time, ${dayLabel(d.date)}`} value={t?.out || ''} onChange={v => onSet(d.date, 'out', v)} style={{ flex: 1 }} />
      </View>
    </View>
  )
}

export function ReviewSheet({ days, onCancel, onDone }: { days: AttendanceDay[]; onCancel: () => void; onDone: () => void }) {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const [times, setTimes] = React.useState<Record<string, { in: string; out: string }>>(() => Object.fromEntries(days.map(d => [d.date, proposed(d)])))
  const [all, setAll] = React.useState<{ in: string; out: string }>(() => ({ in: days[0]?.expected_in || '09:00', out: days[0]?.expected_out || '18:00' }))
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const bad = days.find(d => !times[d.date]?.in || !times[d.date]?.out || times[d.date].out <= times[d.date].in)
  const set = React.useCallback((date: string, k: 'in' | 'out', v: string) => setTimes(t => ({ ...t, [date]: { ...t[date], [k]: v } })), [])
  const n = days.length

  const submit = async () => {
    if (bad) { setMsg({ text: `${dayLabel(bad.date)}: the out time has to be after the in time.`, ok: false }); return }
    if (!reason.trim()) { setMsg({ text: 'Give a reason — your approver reads it.', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fileRegularisation(employeeId, {
        reason: reason.trim(),
        days: days.map(d => ({ date: d.date, requested_in: times[d.date].in, requested_out: times[d.date].out })),
      })
      const to = res.waiting_on
      const skipped = res.skipped || []
      setMsg({ ok: true, text: `✓ ${res.filed} day${res.filed === 1 ? '' : 's'} sent${to ? ` to ${to.name} (${to.role})` : ' — no approver is set for you, so HR will see it'} for approval.`
        + (skipped.length ? ` Left out: ${skipped.map(x => `${dayLabel(x.date)} (${x.why})`).join(', ')}.` : '') })
      timer.current = setTimeout(() => { void afterChange(); onDone() }, 1400)
    } catch (e: any) {
      setMsg({ text: e?.message || 'Could not submit', ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible full onClose={busy ? () => {} : onCancel} title={`Regularise ${n} day${n === 1 ? '' : 's'}`}
      footer={
        <View style={{ paddingBottom: S.sm }}>
          {msg && <Txt size={F.tiny} tone={msg.ok ? 'positive' : 'critical'} style={{ marginBottom: S.sm }}>{msg.text}</Txt>}
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Back to list" variant="outline" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
            <Button title={busy ? 'Sending…' : `Send ${n} day${n === 1 ? '' : 's'} for approval`} onPress={submit} disabled={busy || !!msg?.ok} style={{ flex: 1.4 }} />
          </View>
        </View>
      }>
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>
        Check the times for each day — recorded punches are kept, missing ones are filled from your shift. Your reporting manager approves it, and your attendance updates when they do.
      </Txt>

      {n > 1 && (
        <View style={{ marginBottom: S.sm, padding: 10, borderRadius: R.sm, backgroundColor: C.sunken, gap: 6 }}>
          <Txt size={F.tiny} tone="muted">Same times for all:</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TimeField compact label="In time for all days" value={all.in} onChange={v => setAll(a => ({ ...a, in: v }))} style={{ flex: 1 }} />
            <TimeField compact label="Out time for all days" value={all.out} onChange={v => setAll(a => ({ ...a, out: v }))} style={{ flex: 1 }} />
            <Button title="Apply to all" size="sm" variant="outline" onPress={() => setTimes(Object.fromEntries(days.map(d => [d.date, { ...all }])))} />
          </View>
        </View>
      )}

      <View style={{ gap: 6, marginBottom: S.md }}>
        {days.map(d => <DayRow key={d.date} d={d} t={times[d.date]} onSet={set} />)}
      </View>

      <Input label="Reason (applies to every day)" required value={reason} onChangeText={setReason} multiline maxLength={500}
        placeholder="e.g. Forgot to punch out; biometric was down; on client visit" inputStyle={{ minHeight: 56 }} />
    </Sheet>
  )
}
