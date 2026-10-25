// src/features/expenses/expense/ExpenseSheet.tsx — /expenses/expense?line=&trip=&claim=
// TeHome's sheet {name:'expense', line?, tripId?}: TeExpenseForm in a TeSheet.
//
// Which line: the snapshot's own lines, else a cached claim / trip detail
// (findLine); when a `line` id is given and is in none of those, the claim's or
// the trip's detail is read for it. The form mounts once the line is known (the
// website keys the form by line id) and keeps that copy while it is open.
//
// onSaved(msg) → toast, reload, and ALWAYS Other expenses — website parity
// (TeHome: done(message); setView({name:'expenses'})), even when the bill was on
// a trip or was a send-back fix. The person reopens the trip claim / the claim.
import * as React from 'react'
import { useLocalSearchParams } from 'expo-router'
import type { TeExpense } from '@web/te/types'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText } from '../api'
import { findLine, reloadTe, useClaimDetail, useSnap, useTripDetail } from '../data'
import { close, param, swap, teHref } from '../nav'
import { TeSheet } from '../ui/TeSheet'
import { SnapState } from '../ui/TeScreen'
import { ExpenseForm } from './ExpenseForm'

export default function ExpenseSheet() {
  const p = useLocalSearchParams<{ line?: string; trip?: string; claim?: string }>()
  const lineId = param(p.line)
  const tripId = param(p.trip) || undefined
  const claimId = param(p.claim) || undefined
  const { notify } = useOverlay()
  const snapQ = useSnap()
  const snap = snapQ.data

  const cached = snap && lineId ? findLine(snap, lineId, { claimId, tripId }) : null
  const needFetch = !!snap && !!lineId && !cached
  const claimQ = useClaimDetail(needFetch ? claimId : null)
  const tripQ = useTripDetail(needFetch ? tripId : null)
  const found: TeExpense | null = cached
    ?? claimQ.data?.lines.find(x => x.id === lineId)
    ?? tripQ.data?.expenses.find(x => x.id === lineId)
    ?? null

  // Hold the line the form opened with: a reload while the sheet is open must not unmount it.
  const [held, setHeld] = React.useState<TeExpense | null>(null)
  if (found && !held) setHeld(found)
  const line = held ?? found

  const onSaved = React.useCallback((msg: string) => {
    notify(msg, 'success')
    void reloadTe()
    swap(teHref.other)
  }, [notify])

  if (!snap) {
    return (
      <TeSheet title={lineId ? 'Change this expense' : 'Add an expense'}>
        <SnapState error={snapQ.error} onRetry={() => void snapQ.refetch()} />
      </TeSheet>
    )
  }
  if (lineId && !line) {
    const loading = claimQ.isLoading || tripQ.isLoading
    const err = claimQ.error || tripQ.error
    return (
      <TeSheet title="Change this expense">
        <Txt size={F.small} tone="muted">{loading ? 'Loading…' : err ? errorText(err) : 'Expense not found.'}</Txt>
      </TeSheet>
    )
  }
  return <ExpenseForm key={line?.id ?? 'new'} snap={snap} line={line ?? undefined} tripId={tripId} onClose={close} onSaved={onSaved} />
}
