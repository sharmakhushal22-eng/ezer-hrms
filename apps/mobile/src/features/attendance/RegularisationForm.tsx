// src/features/attendance/RegularisationForm.tsx — (E) one day's correction,
// raised from the day panel. EmployeePortal.tsx RegularisationForm: same fields,
// defaults, validation order and messages. The date is read-only (the web's
// `editable` variant is never used).
import * as React from 'react'
import { View } from 'react-native'
import { useEmployeeId } from '@/core/session'
import { useOverlay } from '@/ui/overlays'
import { Button, Card, Input, Txt } from '@/ui/primitives'
import { afterChange, fileRegularisation } from './api'
import { fmt, fmtT, ymdLocal, type AttendanceRecord } from './model'
import { Section, TimeField } from './bits'

export function RegularisationForm({ date, rec, expected, onDone, onCancel }: {
  date: string; rec: AttendanceRecord | null
  /** The shift's times that day, used where a punch is missing. */
  expected?: { in: string | null; out: string | null }
  onDone: () => void; onCancel: () => void
}) {
  const employeeId = useEmployeeId()
  const { notify } = useOverlay()
  const [actualIn, setActualIn] = React.useState(() => (rec?.work_in ? fmtT(rec.work_in) : null) || expected?.in || '09:00')
  const [actualOut, setActualOut] = React.useState(() => (rec?.work_out ? fmtT(rec.work_out) : null) || expected?.out || '18:00')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null)

  const submit = async () => {
    const todayStr = ymdLocal(new Date())
    if (!date) { setMsg({ text: 'Select the attendance date', ok: false }); return }
    if (date >= todayStr) { setMsg({ text: 'Regularisation is allowed only for past dates, not the current day or future.', ok: false }); return }
    if (!actualIn || !actualOut) { setMsg({ text: 'Enter both actual IN and OUT times', ok: false }); return }
    if (actualIn >= actualOut) { setMsg({ text: 'Actual IN must be before Actual OUT', ok: false }); return }
    if (!reason.trim()) { setMsg({ text: 'Reason is required', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fileRegularisation(employeeId, { date, requested_in: actualIn, requested_out: actualOut, reason: reason.trim() })
      const to = res.waiting_on
      // The website sets this line and closes the form in the same tick, so it is
      // never seen there; here it is shown as the toast the form leaves behind.
      notify(to ? `Sent to ${to.name} (${to.role}) for approval` : 'Submitted — no approver is set for you, so HR will see it')
      await afterChange()
      onDone()
    } catch (e: any) {
      setMsg({ text: e?.message || 'Could not submit', ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ marginBottom: 10 }}>
      <Section>Raise Regularisation</Section>
      <Input label="Attendance date" required hint="(past dates only)" value={fmt(date)} editable={false} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Input label="Recorded IN" value={rec?.work_in ? fmtT(rec.work_in) : 'Not recorded'} editable={false} style={{ flex: 1 }} />
        <Input label="Recorded OUT" value={rec?.work_out ? fmtT(rec.work_out) : 'Not recorded'} editable={false} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TimeField label="Actual IN" required value={actualIn} onChange={setActualIn} style={{ flex: 1 }} />
        <TimeField label="Actual OUT" required value={actualOut} onChange={setActualOut} style={{ flex: 1 }} />
      </View>
      <Input label="Reason" required value={reason} onChangeText={setReason} placeholder="Why was the punch missed?" />
      {msg && <Txt size={12} tone={msg.ok ? 'positive' : 'critical'} style={{ marginBottom: 10 }}>{msg.text}</Txt>}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={busy ? 'Submitting…' : 'Submit request'} onPress={submit} disabled={busy} style={{ flex: 1 }} />
      </View>
    </Card>
  )
}
