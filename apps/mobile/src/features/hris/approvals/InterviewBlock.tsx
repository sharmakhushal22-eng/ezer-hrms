// Interviews to conduct — RoleTabs.tsx InterviewInvites.
// GET /api/ess/interview (any error → nothing rendered, as the website);
// POST acknowledge, POST feedback (main interviewer only — the server checks).
import * as React from 'react'
import { Linking, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { Chip, errMsg, FullModal, Pill, SectionTitle, SolidButton } from '../ui'
import { FeedbackForm, type Feedback } from './FeedbackForm'
import { afterDecision } from './shared'

const isMain = (i: any) => (i.role || 'MAIN') === 'MAIN'

export function InterviewBlock({ employeeId }: { employeeId: string }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useQuery({
    queryKey: ['approvals', 'interview', employeeId],
    queryFn: () => api<{ invites?: any[] }>('/api/ess/interview', { employeeId }).then(d => d.invites || []).catch(() => [] as any[]),
    enabled: !!employeeId,
  })
  const [busy, setBusy] = React.useState<string | null>(null)
  const [fbFor, setFbFor] = React.useState<any | null>(null)
  const [saving, setSaving] = React.useState(false)
  const invites = q.data
  if (!invites || invites.length === 0) return null
  const pending = invites.filter(i => isMain(i) ? i.status !== 'submitted' : i.status === 'invited')

  async function ack(id: string) {
    setBusy(id)
    try { await api('/api/ess/interview', { method: 'POST', employeeId, body: { action: 'acknowledge', invite_id: id } }); notify('Acknowledged. Record your feedback after the interview.'); void afterDecision() }
    catch (e) { notify(errMsg(e), 'error') }
    setBusy(null)
  }
  async function submit(fb: Feedback) {
    if (!fbFor) return
    setSaving(true)
    try { await api('/api/ess/interview', { method: 'POST', employeeId, body: { action: 'feedback', invite_id: fbFor.id, feedback: fb } }); notify('Feedback submitted. Thank you.'); setFbFor(null); void afterDecision() }
    catch (e) { notify(errMsg(e), 'error') }
    setSaving(false)
  }

  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`Interviews to conduct (${pending.length || invites.length})`}</SectionTitle>
      {invites.map(i => {
        const when = i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'time to be confirmed'
        return (
          <View key={i.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Txt size={F.small} w={600}>{i.candidate_name || 'Candidate'}</Txt>
              {!!i.round && <Chip label={i.round} />}
              <Pill tone={isMain(i) ? 'info' : 'mut'} label={isMain(i) ? 'Main interviewer' : 'Panelist'} />
            </View>
            <Txt size={11.5} tone="muted">
              {when}{i.scheduled_by_name ? ` · by ${i.scheduled_by_name}` : ''}
              {i.meet_link ? <> · <Txt size={11.5} w={600} tone="info" onPress={() => void Linking.openURL(i.meet_link).catch(() => {})}>Join link</Txt></> : null}
              {i.meet_passcode ? <> · Passcode: <Txt size={11.5} w={700}>{i.meet_passcode}</Txt></> : null}
            </Txt>
            <View>
              {i.status === 'submitted' ? (
                <Pill tone="ok" label={`Feedback submitted ✓${i.decision ? ` · ${i.decision === 'HOLD' ? 'On hold' : i.decision === 'REJECT' ? 'Rejected' : 'Shortlisted'}` : ''}`} />
              ) : i.status === 'acknowledged' && !isMain(i) ? (
                <Pill tone="mut" label="Acknowledged · panelist (feedback is the main interviewer's)" />
              ) : i.status === 'acknowledged' ? (
                <SolidButton title="Give feedback" tone="info" size="sm" onPress={() => setFbFor(i)} />
              ) : (
                <SolidButton title={busy === i.id ? '…' : 'Acknowledge'} tone="positive" size="sm" disabled={busy === i.id} onPress={() => void ack(i.id)} />
              )}
            </View>
          </View>
        )
      })}
      <FullModal visible={!!fbFor} onClose={() => { if (!saving) setFbFor(null) }} title={`${fbFor?.round || ''} · Interview Feedback`}>
        {fbFor && (
          <FeedbackForm round={fbFor.round} submitting={saving} questions={fbFor.questions}
            candidate={{ name: fbFor.candidate_name || 'Candidate', sub: fbFor.round }}
            onSubmit={fb => void submit(fb)} onClose={() => { if (!saving) setFbFor(null) }} />
        )}
      </FullModal>
    </Card>
  )
}
