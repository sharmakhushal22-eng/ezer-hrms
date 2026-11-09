// Exits waiting on you — RoleTabs.tsx HrExitApprovals.
//
// The company-started exits (People → Employees → HR Actions → Exit on the
// website) waiting on this approver. Same chain and buttons as a resignation:
// the Reporting Manager, L2 and HOD acknowledge, accept with their date or
// request retention (then resume); the HR Manager sets the final last working
// day, which puts the exit into effect. GET /api/ess/exit-employee?inbox=1 (an
// error renders nothing, as the website), POST { action:'act', id, act, note, lwd }.
// The action set is `x.actions` exactly as the server returned it.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { api } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Card, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, fmtDay, useOverlay } from '@/ui/overlays'
import { errMsg, Pill, SectionTitle, SolidButton } from '../ui'
import { afterDecision } from './shared'

/** RoleTabs fmtDay — the date part only, en-IN numeric/short/numeric, '-' for none. */
const fmtD = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
const stepText = (s: any) => s.status === 'HOLD' ? 'retention requested' : s.status === 'PENDING' ? 'waiting' : s.status === 'SKIPPED' ? 'skipped'
  : s.status === 'REJECTED' ? 'rejected' : s.status === 'WAITING' ? 'next'
  : s.action === 'STARTED' ? 'started it' : s.action === 'ACCEPTED_WITH_DATE' ? `accepted with ${fmtD(s.lwd)}` : s.action === 'FINAL_LWD_SET' ? `final LWD ${fmtD(s.lwd)}` : 'acknowledged'
const needs = (act: string) => act === 'ACCEPTED_WITH_DATE' || act === 'FINAL_LWD_SET' || act === 'REQUESTED_RETENTION'

function ExitItem({ x, employeeId, busy, setBusy, onDone }: { x: any; employeeId: string; busy: boolean; setBusy: (id: string | null) => void; onDone: () => void }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const [act, setAct] = React.useState<string | null>(null)
  const [note, setNote] = React.useState('')
  const [lwd, setLwd] = React.useState('')
  const [dateOpen, setDateOpen] = React.useState(false)
  const step = (x.chain || []).find((s: any) => s.status === 'PENDING' || s.status === 'HOLD')
  const acts: { code: string; label: string }[] = x.actions || []

  async function fire(code: string) {
    setBusy(x.id)
    try {
      const d = await api<any>('/api/ess/exit-employee', { method: 'POST', employeeId, body: { action: 'act', id: x.id, act: code, note, lwd } })
      notify(code === 'FINAL_LWD_SET' ? `Final last working day set: ${fmtD(lwd)}. The exit is in effect.`
        : code === 'REQUESTED_RETENTION' ? 'Retention requested. The exit is on hold until you resume it.'
        : code === 'RESUMED' ? 'Chain resumed.' : d?.request?.status === 'APPROVED' ? 'Done. The exit is in effect.' : 'Forwarded to the next approver.')
      setAct(null); setNote(''); setLwd(''); onDone()
    } catch (e) { notify(errMsg(e), 'error') }
    setBusy(null)
  }
  async function openDoc(d: any) {
    try {
      const j = await api<{ url: string }>('/api/exit/documents', { query: { request_id: x.id, path: d.path }, employeeId })
      await WebBrowser.openBrowserAsync(j.url)
    } catch (e) { notify(errMsg(e), 'error') }
  }

  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
      <Txt size={F.small} w={600}>{x.employee?.full_name} <Txt size={F.small} tone="muted">{x.employee?.emp_code}{x.employee?.designation ? ` · ${x.employee.designation}` : ''}</Txt></Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill tone="dang" label={`${x.reason_label || ''}${x.sub_reason ? ` · ${x.sub_reason}` : ''}`} />
        {step?.status === 'HOLD' && <Pill tone="warn" label="Retention hold" />}
      </View>
      <Txt size={11.5} tone="muted">
        Last working day {fmtD(x.last_working_day)}{x.proposed_lwd ? ` · proposed ${fmtD(x.proposed_lwd)}` : ''} · started by {x.initiated_by_name || 'HR'} · waiting on you as {step?.label || 'approver'}
      </Txt>
      {!!x.remarks && <Txt size={F.tiny}>{x.remarks}</Txt>}
      {(x.documents || []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Txt size={11.5}>Documents:</Txt>
          {x.documents.map((d: any) => (
            <Pressable key={d.path} onPress={() => void openDoc(d)} accessibilityRole="link" hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Txt size={11.5} tone="info" style={{ textDecorationLine: 'underline' }}>{d.name}</Txt>
            </Pressable>
          ))}
        </View>
      )}
      <Txt size={11} tone="faint">{(x.chain || []).map((s: any) => `${s.label}: ${stepText(s)}`).join(' → ')}</Txt>

      {!act && acts.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {acts.map(a => a.code === 'REQUESTED_RETENTION'
            ? <Button key={a.code} title={busy ? '…' : a.label} size="sm" variant="outline" disabled={busy} onPress={() => { setAct(a.code); setNote(''); setLwd('') }} />
            : <SolidButton key={a.code} title={busy ? '…' : a.label} size="sm" disabled={busy}
                tone={a.code === 'FINAL_LWD_SET' || a.code === 'ACKNOWLEDGED' || a.code === 'RESUMED' ? 'positive' : 'brand'}
                onPress={() => { if (needs(a.code)) { setAct(a.code); setNote(''); setLwd(x.proposed_lwd || x.last_working_day || '') } else void fire(a.code) }} />)}
        </View>
      )}
      {!!act && (
        <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: C.canvas }}>
          {act !== 'REQUESTED_RETENTION' && (
            <PickerField label={act === 'FINAL_LWD_SET' ? 'Final last working day' : 'The last working day you accept'} value={lwd ? fmtDay(lwd) : ''} placeholder="Pick a date" onPress={() => setDateOpen(true)} />
          )}
          <Input value={note} onChangeText={setNote} multiline inputStyle={{ minHeight: 50 }}
            placeholder={act === 'REQUESTED_RETENTION' ? 'Why the employee should be retained (optional)' : 'Note (optional)'} />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Back" size="sm" variant="outline" disabled={busy} onPress={() => { setAct(null); setNote(''); setLwd('') }} />
            <Button title={busy ? '…' : acts.find(a => a.code === act)?.label || 'Confirm'} size="sm" style={{ flex: 1 }}
              disabled={busy || (act !== 'REQUESTED_RETENTION' && !lwd)} onPress={() => void fire(act)} />
          </View>
          <DateSheet visible={dateOpen} onClose={() => setDateOpen(false)} value={lwd || null} onPick={setLwd}
            title={act === 'FINAL_LWD_SET' ? 'Final last working day' : 'The last working day you accept'} />
        </View>
      )}
    </View>
  )
}

export function HrExitBlock({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['approvals', 'hr-exit', employeeId],
    queryFn: () => api<{ items: any[] }>('/api/ess/exit-employee', { query: { inbox: 1 }, employeeId }).catch(() => ({ items: [] })),
    enabled: !!employeeId,
  })
  const [busy, setBusy] = React.useState<string | null>(null)
  const items = q.data?.items || []
  if (!items.length) return null
  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`Exits waiting on you (${items.length})`}</SectionTitle>
      {items.map(x => <ExitItem key={x.id} x={x} employeeId={employeeId} busy={busy === x.id} setBusy={setBusy} onDone={() => void afterDecision()} />)}
    </Card>
  )
}
