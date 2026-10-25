// src/features/profile/ChangeRequests.tsx — components/profile/ChangeRequests.tsx.
//
// "My change requests" (with Withdraw while pending) and, only when the server
// puts something in it, "To review" for an approver. Whether somebody is an
// approver is the server's question (profile_change_can_act), not this file's.
import * as React from 'react'
import { View } from 'react-native'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, Notice, Txt } from '@/ui/primitives'
import { cancelRequest, decideRequest, useMyRequests, useReviewQueue, type MyRequest, type QueueRequest } from './api'
import { when } from './format'
import { CardHead } from './bits'

const toneOf = (status: string) =>
  status === 'approved' ? 'positive' : status === 'rejected' ? 'critical' : status === 'cancelled' ? 'muted' : 'warning'

function Value({ from, to }: { from: string | null; to: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6, padding: S.sm, borderRadius: R.sm, backgroundColor: C.sunken }}>
      {from?.trim()
        ? <Txt size={F.small} tone="muted" style={{ textDecorationLine: 'line-through' }}>{from}</Txt>
        : <Txt size={F.small} tone="faint" style={{ fontStyle: 'italic' }}>empty</Txt>}
      <Txt size={F.small} tone="muted">→</Txt>
      <Txt size={F.small} w={600}>{to}</Txt>
    </View>
  )
}

function QueueItem({ r, busy, rejecting, remarks, setRemarks, onReject, onBack, onConfirm, onApprove }: {
  r: QueueRequest; busy: boolean; rejecting: boolean; remarks: string; setRemarks: (s: string) => void
  onReject: () => void; onBack: () => void; onConfirm: () => void; onApprove: () => void
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{r.employee} <Txt size={F.tiny} tone="muted">{r.emp_code}</Txt></Txt>
          <Txt size={F.tiny} tone="soft">{r.field_label}</Txt>
        </View>
        <Txt size={F.tiny} w={r.waiting_days >= 7 ? 700 : 400} tone={r.waiting_days >= 7 ? 'warning' : 'muted'}>
          {r.waiting_days === 0 ? 'today' : `${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'}`}
        </Txt>
      </View>
      <Value from={r.old_value} to={r.new_value} />
      {!!r.reason && <Txt size={F.small} tone="soft" style={{ marginTop: 6, fontStyle: 'italic' }}>“{r.reason}”</Txt>}
      {rejecting ? (
        <View style={{ marginTop: S.sm }}>
          <Input label={`Why is this not approved? ${r.employee.split(' ')[0]} will see this.`} value={remarks} onChangeText={setRemarks} multiline />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Back" variant="outline" style={{ flex: 1 }} onPress={onBack} />
            <Button title={busy ? 'Sending…' : 'Confirm rejection'} variant="danger" style={{ flex: 1 }} disabled={!remarks.trim() || busy} onPress={onConfirm} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
          <Button title="Reject" variant="outline" style={{ flex: 1 }} disabled={busy} onPress={onReject} />
          <Button title={busy ? 'Working…' : 'Approve'} style={{ flex: 1 }} disabled={busy} onPress={onApprove} />
        </View>
      )}
    </View>
  )
}

function MineItem({ r, busy, onWithdraw }: { r: MyRequest; busy: boolean; onWithdraw: () => void }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Txt size={F.small} w={700} style={{ flex: 1 }}>{r.field_label}</Txt>
        <Txt size={F.tiny} w={700} tone={toneOf(r.status)} style={{ maxWidth: '55%', textAlign: 'right' }}>{r.stage_label}</Txt>
      </View>
      <Value from={r.old_value} to={r.new_value} />
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 6 }}>
        Asked {when(r.requested_at)}{r.decided_at ? ` · answered ${when(r.decided_at)}` : ''}
      </Txt>
      {!!r.remarks && <Txt size={F.small} tone="soft" style={{ marginTop: 4, fontStyle: 'italic' }}>{r.remarks}</Txt>}
      {r.status.startsWith('pending') && (
        <Button title={busy ? 'Withdrawing…' : 'Withdraw'} variant="outline" size="sm" disabled={busy} onPress={onWithdraw} style={{ marginTop: S.sm, alignSelf: 'flex-start' }} />
      )}
    </View>
  )
}

export function ChangeRequests({ canSee }: { canSee: boolean }) {
  const { C } = useTheme()
  const mineQ = useMyRequests(canSee)
  const queueQ = useReviewQueue(canSee)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)
  const [rejecting, setRejecting] = React.useState<string | null>(null)
  const [remarks, setRemarks] = React.useState('')
  if (!canSee) return null

  const mine = mineQ.data ?? []
  const queue = queueQ.data ?? []
  const listErr = err ?? (mineQ.error instanceof Error ? mineQ.error.message : null)
  const refresh = () => invalidate('profile')

  async function act(id: string, decision: 'approve' | 'reject', text?: string) {
    setBusy(id); setErr(null); setNote(null)
    try {
      const r = await decideRequest(id, decision, text)
      setRejecting(null); setRemarks('')
      setNote(r.applied ? 'Approved. The record has been updated.' : r.message ?? (decision === 'reject' ? 'Rejected.' : 'Approved.'))
      await refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(null) }
  }

  async function withdraw(id: string) {
    setBusy(id); setErr(null); setNote(null)
    try {
      await cancelRequest(id)
      setNote('Withdrawn.')
      await refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(null) }
  }

  const sep = (i: number) => ({ paddingVertical: S.md, borderTopWidth: i ? 1 : 0, borderTopColor: C.line })

  return (
    <View style={{ marginTop: S.xl, gap: S.md }}>
      {!!listErr && <Notice tone="critical">{listErr}</Notice>}
      {!!note && <Notice tone="positive">{note}</Notice>}

      {queue.length > 0 && (
        <Card>
          <CardHead title="To review" right={<Txt size={F.tiny} tone="muted">{queue.length} waiting on you</Txt>} />
          {queue.map((r, i) => (
            <View key={r.id} style={sep(i)}>
              <QueueItem r={r} busy={busy === r.id} rejecting={rejecting === r.id} remarks={remarks} setRemarks={setRemarks}
                onReject={() => { setRejecting(r.id); setRemarks('') }} onBack={() => { setRejecting(null); setRemarks('') }}
                onConfirm={() => act(r.id, 'reject', remarks.trim())} onApprove={() => act(r.id, 'approve')} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <CardHead title="My change requests" right={mine.length > 0 ? <Txt size={F.tiny} tone="muted">{mine.length}</Txt> : null} />
        {mine.length === 0 ? (
          <Txt size={F.small} tone="faint">
            {mineQ.isLoading ? 'Loading…' : <>Nothing pending. Fields marked <Txt size={F.small} w={700} tone="faint">Request</Txt> go for approval when you change them.</>}
          </Txt>
        ) : mine.map((r, i) => (
          <View key={r.id} style={sep(i)}>
            <MineItem r={r} busy={busy === r.id} onWithdraw={() => withdraw(r.id)} />
          </View>
        ))}
      </Card>
    </View>
  )
}
