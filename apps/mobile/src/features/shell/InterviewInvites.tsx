// src/features/shell/InterviewInvites.tsx — "Interviews to conduct", inside the bell.
//
// Website: components/ess/RoleTabs.tsx InterviewInvites, rendered at the top of the
// notification panel (EmployeePortal.tsx Notifications) since 179bb35 — the
// interviewer acknowledges and gives feedback from the notification itself, not
// from Tasks & Approvals.
//   GET  /api/ess/interview                      (any error → nothing, as the website)
//   POST { action: 'acknowledge', invite_id }
//   POST { action: 'feedback', invite_id, feedback }   (main interviewer only; server checks)
// Only what still needs doing is listed: a main interviewer's row until feedback is
// in, a panelist's until acknowledged. Nothing renders when there is none.
//
// The 8-parameter feedback form is HR Services' (features/hris/approvals/FeedbackForm),
// the app's port of components/recruitment/InterviewFeedbackForm — one form, not two.
import * as React from 'react'
import { Linking, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { FeedbackForm, type Feedback } from '@/features/hris/approvals/FeedbackForm'
import { Chip, FullModal, Pill, SolidButton } from '@/features/hris/ui'

interface Invite {
  id: string; role?: string | null; status: string; round: string; candidate_name?: string | null
  scheduled_at?: string | null; scheduled_by_name?: string | null; meet_link?: string | null; meet_passcode?: string | null
  questions?: string[] | null; decision?: string | null
}
const isMain = (i: Invite) => (i.role || 'MAIN') === 'MAIN'
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useInterviewInvites(employeeId: string, enabled = true) {
  return useQuery({
    // Under 'notifications' so every bell refresh re-reads it too.
    queryKey: ['notifications', 'interview', employeeId],
    queryFn: () => api<{ invites?: Invite[] }>('/api/ess/interview', { employeeId }).then(d => d.invites || []).catch(() => [] as Invite[]),
    enabled: !!employeeId && enabled,
  })
}

/** After an acknowledge / feedback: the bell, Home and HR Services' copy all re-read. */
const after = () => invalidate('notifications', 'approvals', 'today')

export function InterviewInvites({ employeeId }: { employeeId: string }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useInterviewInvites(employeeId)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [fbFor, setFbFor] = React.useState<Invite | null>(null)
  const [saving, setSaving] = React.useState(false)
  const pending = (q.data || []).filter(i => isMain(i) ? i.status !== 'submitted' : i.status === 'invited')
  if (pending.length === 0) return null

  async function ack(i: Invite) {
    setBusy(i.id)
    try {
      await api('/api/ess/interview', { method: 'POST', employeeId, body: { action: 'acknowledge', invite_id: i.id } })
      notify(isMain(i) ? 'Acknowledged. Give your feedback here after the interview.' : 'Acknowledged.', 'success')
      await after()
    } catch (e) { notify(errMsg(e), 'error') }
    setBusy(null)
  }
  async function submit(fb: Feedback) {
    if (!fbFor) return
    setSaving(true)
    try {
      await api('/api/ess/interview', { method: 'POST', employeeId, body: { action: 'feedback', invite_id: fbFor.id, feedback: fb } })
      notify('Feedback submitted. Thank you.', 'success')
      setFbFor(null)
      await after()
    } catch (e) { notify(errMsg(e), 'error') }
    setSaving(false)
  }

  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, backgroundColor: C.surface, paddingHorizontal: S.md, paddingTop: S.md, paddingBottom: 4, marginBottom: S.md }}>
      <Txt size={F.tiny} w={700} tone="brand" upper style={{ letterSpacing: 0.6, marginBottom: 4 }}>{`Interviews to conduct (${pending.length})`}</Txt>
      {pending.map(i => {
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
              {i.meet_link ? <> · <Txt size={11.5} w={600} tone="info" onPress={() => void Linking.openURL(i.meet_link!).catch(() => {})}>Join link</Txt></> : null}
              {i.meet_passcode ? <> · Passcode: <Txt size={11.5} w={700}>{i.meet_passcode}</Txt></> : null}
            </Txt>
            <View>
              {i.status === 'acknowledged' && !isMain(i) ? (
                <Pill tone="mut" label="Acknowledged · panelist (feedback is the main interviewer's)" />
              ) : i.status === 'acknowledged' ? (
                <SolidButton title="Give feedback" tone="info" size="sm" onPress={() => setFbFor(i)} />
              ) : (
                <SolidButton title={busy === i.id ? '…' : 'Acknowledge'} tone="positive" size="sm" disabled={busy === i.id} onPress={() => void ack(i)} />
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
    </View>
  )
}
