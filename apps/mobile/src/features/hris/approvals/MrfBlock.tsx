// Hiring Requests · MRF — RoleTabs.tsx MrfApprovals (list mode, the only mode
// Tasks & Approvals mounts). GET /api/ess/mrf; Acknowledge an assignment; open a
// waiting MRF on the Recruitment screen (a website page — no app screen exists,
// so it opens in the in-app browser); Edit & resubmit a sent-back MRF in the
// full MrfForm. The approve / reject / send-back modal is focus-mode only on the
// website (app/mrf-approve/[id]) and is not reachable from here.
import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { openWebsite } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errMsg, FullModal, NoteBox, Pill, SectionTitle, SolidButton } from '../ui'
import MrfForm from '../mrf/MrfForm'
import { mrfToForm } from '../mrf/model'
import { afterDecision } from './shared'

const openings = (m: any) => m.no_of_openings || m.openings || 1

function stepLabel(m: any) {
  const ch = Array.isArray(m.approval_chain) ? m.approval_chain : []
  const cur = ch.find((s: any) => s.status === 'PENDING')
  if (m.status === 'APPROVED') return 'Approved'
  if (m.status === 'REJECTED') return 'Rejected'
  return cur ? `With ${cur.role === 'HR_HEAD' ? 'HR Head' : 'RM2'} · ${cur.approver_name}` : m.status
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  const { C } = useTheme()
  return <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, paddingVertical: 10 }}>{children}</View>
}

export function useMrf(employeeId: string) {
  return useQuery({ queryKey: ['approvals', 'mrf', employeeId], queryFn: () => api<any>('/api/ess/mrf', { employeeId }), enabled: !!employeeId })
}

export function MrfBlock({ employeeId }: { employeeId: string }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useMrf(employeeId)
  const [editMrf, setEditMrf] = React.useState<any | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const editScroll = React.useRef<ScrollView>(null)

  async function acknowledge(id: string) {
    setBusy(id)
    try {
      await api('/api/ess/mrf', { method: 'POST', body: { action: 'acknowledge', id }, employeeId })
      notify('Acknowledged. This MRF is now in your Recruitment.'); void afterDecision()
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(null) }
  }

  if (q.error) return <NoteBox tone="d" style={{ marginBottom: S.md }}>{errMsg(q.error)}</NoteBox>
  const d = q.data
  if (!d) return null
  const assigned: any[] = d.myAssignments || []
  const toApprove: any[] = d.toApprove || []
  const mine: any[] = d.mine || []

  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>Hiring Requests · MRF</SectionTitle>

      {assigned.length > 0 && <>
        <Txt size={F.tiny} w={700} tone="positive" style={{ marginTop: 6, marginBottom: 4 }}>Assigned to you ({assigned.length})</Txt>
        {assigned.map((m, i) => (
          <Row key={m.id} last={i === assigned.length - 1 && !toApprove.length}>
            <Txt size={F.small} w={600}>{m.designation || m.position} · {openings(m)} opening(s)</Txt>
            <Txt size={11.5} tone="muted">{m.departments?.dept_name || '-'} · You’ve been assigned to hire for this. Run it in Recruitment.</Txt>
            <View style={{ marginTop: 8 }}>
              {m.acknowledged
                ? <Pill tone="ok" label="Acknowledged ✓" />
                : <SolidButton title="Acknowledge" tone="positive" size="sm" loading={busy === m.id} disabled={!!busy} onPress={() => void acknowledge(m.id)} />}
            </View>
          </Row>
        ))}
      </>}

      {toApprove.length > 0 && <>
        <Txt size={F.tiny} w={700} tone="warning" style={{ marginTop: 6, marginBottom: 4 }}>Waiting on you ({toApprove.length})</Txt>
        {toApprove.map(m => (
          <Row key={m.id}>
            <View style={{ backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge, borderRadius: 9, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Txt size={18}>📋</Txt>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={F.small} w={600}>{m.designation || m.position} · {openings(m)} opening(s)</Txt>
                  <Txt size={11.5} tone="warning">Needs your approval · raised by {m.raised_by_name || '-'}{m.raised_by_role ? ` (${m.raised_by_role})` : ''} · {m.urgency || 'Normal'}</Txt>
                </View>
              </View>
              <SolidButton title="Open MRF to review & approve →" tone="positive" size="sm" full
                onPress={() => void openWebsite(`/ess/recruitment/mrf?mrfSub=approvals&mrf=${m.id}`)} />
            </View>
          </Row>
        ))}
      </>}

      <Txt size={F.tiny} w={700} tone="muted" style={{ marginTop: 10, marginBottom: 4 }}>My requests ({mine.length})</Txt>
      {mine.length === 0 && <Txt size={F.tiny} tone="faint">You haven’t raised any MRF yet.</Txt>}
      {mine.map((m, i) => {
        const needsRevision = m.status === 'NEEDS_REVISION'
        const color = m.status === 'APPROVED' ? C.positive : (m.status === 'REJECTED' || needsRevision) ? C.critical : C.warning
        return (
          <Row key={m.id} last={i === mine.length - 1}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.small} w={600}>{m.designation || m.position} · {openings(m)}</Txt>
                <Txt size={11.5} tone="muted">{m.departments?.dept_name || '-'}</Txt>
              </View>
              <Txt size={11.5} w={600} color={color} style={{ flexShrink: 1, textAlign: 'right' }}>{needsRevision ? 'Sent back: needs changes' : stepLabel(m)}</Txt>
            </View>
            {needsRevision && (
              <View style={{ marginTop: 6, backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warning, borderRadius: 7, padding: 10, gap: 6 }}>
                {!!m.remarks && <Txt size={F.tiny} tone="warning">“{m.remarks}”</Txt>}
                <SolidButton title="✎ Edit & resubmit" tone="warning" size="sm" onPress={() => setEditMrf(m)} />
              </View>
            )}
          </Row>
        )
      })}

      <FullModal visible={!!editMrf} onClose={() => setEditMrf(null)} title="Edit & resubmit MRF" closeLabel="← Back" scrollRef={editScroll}>
        {editMrf && (
          <>
            {!!editMrf.remarks && <NoteBox tone="w" style={{ marginBottom: S.md }}>{`Sent back for changes: “${editMrf.remarks}”. Fix and resubmit below.`}</NoteBox>}
            <MrfForm employeeId={employeeId} initial={mrfToForm(editMrf)} replaceId={editMrf.id}
              onDone={() => { setEditMrf(null); void afterDecision() }} onCancel={() => setEditMrf(null)}
              onShowTop={() => editScroll.current?.scrollTo({ y: 0, animated: false })} />
          </>
        )}
      </FullModal>
    </Card>
  )
}

