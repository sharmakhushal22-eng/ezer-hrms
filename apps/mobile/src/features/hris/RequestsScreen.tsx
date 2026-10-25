// Raise a Request — components/ess/hris/RaiseRequest.tsx.
//
// The eight types, their order, routing and copy are the website's. The reads
// and the write are lib/supabase-ess.ts loadServiceRequests() /
// createServiceRequest(), verbatim (anon client, scoped to the signed-in
// employee). Web quirk kept: is_confidential / assigned_to are client-set flags
// on an allow-all table; there is no notification or server route behind them.
// Also kept: the load swallows a read error and shows "No requests yet.".
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import { Ic, type IconKey } from './icons'
import { fmtDate, NoteBox, Pill, type PillTone } from './ui'

const REQ_TYPES: { k: string; label: string; ic: IconKey; confidential?: boolean; assigned?: string }[] = [
  { k: 'LOAN', label: 'Loan / Advance Salary', ic: 'cash' },
  { k: 'RESIGNATION', label: 'Exit / Resignation', ic: 'door' },
  { k: 'NOMINEE', label: 'Nominee Update', ic: 'user' },
  { k: 'INSURANCE_CHANGE', label: 'Insurance Family Change', ic: 'shield' },
  { k: 'MARRIAGE', label: 'Marriage Detail Update', ic: 'ring' },
  { k: 'EMERGENCY', label: 'Emergency / SOS', ic: 'sos' },
  { k: 'BLOOD_DONATION', label: 'Blood Donation Request', ic: 'heart' },
  { k: 'POSH', label: 'POSH Complaint (Confidential)', ic: 'lock', confidential: true, assigned: 'IC' },
]
const LABEL: Record<string, string> = Object.fromEntries(REQ_TYPES.map(r => [r.k, r.label]))
const TONE: Record<string, PillTone> = { PENDING: 'warn', IN_REVIEW: 'info', APPROVED: 'ok', COMPLETED: 'ok', REJECTED: 'dang' }
const STATUS: Record<string, string> = { PENDING: 'Pending', IN_REVIEW: 'In review', APPROVED: 'Approved', COMPLETED: 'Completed', REJECTED: 'Rejected' }

interface ServiceRequestRow {
  id: string; request_type: string; request_data: { detail?: string } | null; is_confidential: boolean | null
  status: string; submitted_at: string | null; assigned_to: string | null
}

async function loadServiceRequests(employeeId: string): Promise<ServiceRequestRow[]> {
  const { data } = await supabase.from('ess_service_requests').select('*').eq('employee_id', employeeId).order('submitted_at', { ascending: false })
  return (data as any) || []
}

function TypeTile({ r, on, onPress }: { r: typeof REQ_TYPES[number]; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  const posh = !!r.confidential
  const edge = on ? (posh ? C.critical : C.brand) : C.line
  const bg = on ? (posh ? C.criticalTint : C.brandTint) : C.surface
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 64, borderRadius: R.md, borderWidth: on ? 2 : 1, borderColor: edge, backgroundColor: pressed ? C.brandTint : bg })}>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: posh ? C.criticalTint : C.brandTint }}>
        <Ic k={r.ic} size={16} color={posh ? C.critical : C.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={12.5} w={600}>{r.label}</Txt>
        <Txt size={11} tone="muted">Routed to {r.assigned || 'HR'}</Txt>
      </View>
    </Pressable>
  )
}

export default function RequestsScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const { notify } = useOverlay()
  const q = useQuery({ queryKey: ['hris', 'requests', employeeId], queryFn: () => loadServiceRequests(employeeId), enabled: !!employeeId })
  const rows = q.data || []
  const [type, setType] = React.useState(REQ_TYPES[0].k)
  const [detail, setDetail] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const def = REQ_TYPES.find(r => r.k === type)!

  async function submit() {
    if (!detail.trim()) { notify('Please add details', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('ess_service_requests').insert({
      employee_id: employeeId, request_type: type, request_data: { detail: detail.trim() },
      is_confidential: def.confidential || false, assigned_to: def.assigned || 'HR',
    })
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    setDetail('')
    notify(def.confidential ? 'Confidential request sent to the Internal Committee.' : 'Request submitted.')
    void invalidate('hris')
  }

  return (
    <Screen title="Raise a Request" subtitle="HR Services" onRefresh={() => q.refetch()}>
      <Card style={{ marginBottom: S.md }}>
        <Txt size={F.lead} w={700} style={{ marginBottom: S.md }}>Raise a request</Txt>
        <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Pick a request type</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
          {REQ_TYPES.map(r => <TypeTile key={r.k} r={r} on={type === r.k} onPress={() => setType(r.k)} />)}
        </View>
        {def.confidential && (
          <NoteBox tone="d" style={{ marginBottom: S.md }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <View style={{ paddingTop: 2 }}><Ic k="lock" size={14} color={C.critical} /></View>
              <Txt size={F.tiny} color={C.critical} style={{ flex: 1 }}>This is confidential and routes only to the Internal Committee, not regular HR.</Txt>
            </View>
          </NoteBox>
        )}
        <Input label="Details" value={detail} onChangeText={setDetail} multiline placeholder="Describe your request…" />
        <Button title={busy ? 'Submitting…' : 'Submit request'} onPress={() => void submit()} disabled={busy} full />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.sm }}>
          <Txt size={F.lead} w={700} style={{ flex: 1 }}>My requests</Txt>
          <Pill tone="mut" label={`${rows.length} filed`} />
        </View>
        {rows.length === 0 ? (
          <Txt size={12.5} tone="faint">No requests yet.</Txt>
        ) : rows.map((r, i) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.small} w={600}>{LABEL[r.request_type] || r.request_type}{r.is_confidential ? ' 🔒' : ''}</Txt>
              <Txt size={F.tiny} tone="muted">{(r.request_data?.detail || '').slice(0, 60) || '-'} · {fmtDate(r.submitted_at)}</Txt>
            </View>
            <Pill tone={TONE[r.status] || 'mut'} label={STATUS[r.status] || r.status} />
          </View>
        ))}
      </Card>
    </Screen>
  )
}
