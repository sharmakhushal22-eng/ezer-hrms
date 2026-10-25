// src/features/expenses/claims/TripClaimScreen.tsx — /expenses/trip-claim/<tripId>,
// "Claim for <trip>" (TeOtherExpenses with `trip`, view 'tripClaim').
// The trip comes from the snapshot, else from GET /api/te/trips/:id.
// TeHome's callbacks: onBack → the trip (toTrip) · onAdd → the expense sheet on
// this trip · onEdit(line) → the sheet on that line · onSubmitted → toast,
// reload, the new claim (swap, as the website replaces the view). No onOpenTrip.
import * as React from 'react'
import { useLocalSearchParams } from 'expo-router'
import type { Snapshot } from '@web/te/types'
import { useOverlay } from '@/ui/overlays'
import { findTrip, reloadTe, useTripDetail } from '../data'
import { open, param, swap, teHref, toTrip } from '../nav'
import { SnapScreen, SnapState } from '../ui/TeScreen'
import { OtherExpensesView } from './OtherExpensesView'

function Body({ snap, id }: { snap: Snapshot; id: string }) {
  const { notify } = useOverlay()
  const fromSnap = findTrip(snap, id)
  const detail = useTripDetail(fromSnap ? null : id)
  const trip = fromSnap ?? detail.data?.trip ?? null
  if (!trip) return <SnapState error={detail.error} onRetry={() => void detail.refetch()} />
  return (
    <OtherExpensesView snap={snap} trip={trip}
      onBack={() => toTrip(id)}
      onAdd={() => open(teHref.expense({ trip: id }))}
      onEdit={line => open(teHref.expense({ line: line.id, trip: id }))}
      onSubmitted={(cid, msg) => { notify(msg, 'success'); void reloadTe(); swap(teHref.claim(cid)) }} />
  )
}

export default function TripClaimScreen() {
  const id = param(useLocalSearchParams<{ id?: string }>().id)
  return (
    <SnapScreen title="Claim this trip">
      {snap => <Body snap={snap} id={id} />}
    </SnapScreen>
  )
}
