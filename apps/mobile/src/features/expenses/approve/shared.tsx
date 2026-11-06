// src/features/expenses/approve/shared.tsx — what the approval screens share.
//
// afterDecision() is TeApprovals.afterDecision: toast, then open the NEXT row of
// the queue as it was before the reload (the following row, or wraps to the
// first other row), else back to the list. Each entity gets a fresh screen
// (swap to its own route), so nothing of the previous decision — busy, comment,
// chosen verb, line draft, `tried` — carries over. That is the web's missing-key
// parity bug (spec Part 6, TeApprovals), fixed on purpose.
import * as React from 'react'
import { View } from 'react-native'
import type { TeQueueRow, Uuid } from '@web/te/types'
import { queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { qk, reloadTe } from '../data'
import { close, swap, teHref } from '../nav'
import { TeIcon } from '../ui/TeIcon'
import { Flag } from '../ui/kit'

/** The Approvals list's own read of the queue (errors are shown there, not swallowed). */
export const APPROVALS_KEY = ['te', 'approvals'] as const

export const approvalHref =(r: Pick<TeQueueRow, 'entity_type' | 'entity_id'>) =>
  r.entity_type === 'trip' ? `${teHref.approvals}/trip/${r.entity_id}` : `${teHref.approvals}/claim/${r.entity_id}`

export function afterDecision(openId: Uuid, message: string, notify: (m: string, k?: 'success' | 'error' | 'info') => void) {
  notify(message)
  const rows = queryClient.getQueryData<TeQueueRow[]>(APPROVALS_KEY) ?? queryClient.getQueryData<TeQueueRow[]>(qk.queue) ?? []
  const at = rows.findIndex(r => r.entity_id === openId)
  const next = rows[at + 1] ?? rows.find((_, i) => i !== at) ?? null
  void reloadTe()
  if (next && next.entity_id !== openId) swap(approvalHref(next))
  else close()
}

/** `flag info` "This is not yours to decide" (G7). */
export function NotYours({ why }: { why: string }) {
  return (
    <Flag tone="info" icon="info" title="This is not yours to decide" style={{ marginBottom: S.md }}>
      {why || 'It is with somebody else at the moment.'}
    </Flag>
  )
}

/** The loading / error card of the decision screens ("Loading the trip…" / "Loading the claim…"). */
export function DetailState({ loading, error, onRetry }: { loading: string; error: string; onRetry: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: S.lg, gap: S.md }}>
      <Txt size={F.small} tone="muted">{error || loading}</Txt>
      {!!error && <Button title="Try again" size="sm" variant="outline" style={{ alignSelf: 'flex-start' }} onPress={onRetry} />}
    </View>
  )
}

/** `.ferr` with the alert icon (the decision cards' error line). */
export function ErrLine({ children }: { children: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: S.sm }}>
      <TeIcon name="alert" size="sm" color={C.critical} />
      <Txt size={F.small} tone="critical" style={{ flex: 1 }}>{children}</Txt>
    </View>
  )
}

/** btn pri lg wide / btn dan lg wide. */
export function DecideButton({ title, danger, busy, onPress }: { title: string; danger?: boolean; busy: boolean; onPress: () => void }) {
  return <Button title={title} size="lg" full variant={danger ? 'danger' : 'primary'} disabled={busy} onPress={onPress} style={{ marginTop: S.md }} />
}
