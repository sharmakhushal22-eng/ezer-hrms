// src/features/expenses/data.ts — the module's server state, as TanStack queries.
//
// THE WEBSITE'S MODEL, KEPT (spec Part 0.3 / 8.4): one Snapshot (GET /api/te/me)
// plus the approver queue (GET /api/te/queue), read together and read again
// after every change. Screens never keep their own copy of server state. Trip
// and claim detail are the two one-record reads.
//
// THE WEBSITE'S BUGS, NOT KEPT: on the web a leg screen holds the leg object it
// was opened with and the trip screen holds its own fetched detail, so neither
// changes after Start / Stop / Add a journey. Here every one of those is a
// query under the 'te' prefix, and reloadTe() invalidates the whole prefix —
// so the snapshot, the open trip, the open claim and the queue all refetch
// after any mutation. Leg screens resolve their leg by id from the freshest
// snapshot (useLeg) instead of holding a copy.
//
// Query keys (all start with 'te'):
//   ['te','me']            the snapshot
//   ['te','queue']         approvals waiting for me (a failure reads as [])
//   ['te','trip',id]       TeTripDetail
//   ['te','claim',id]      TeClaimDetail
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { invalidate, queryClient } from '@/core/query'
import { useSession } from '@/core/session'
import type { Snapshot, TeClaimDetail, TeExpense, TeLeg, TeQueueRow, TeTrip, TeTripDetail, Uuid } from '@web/te/types'
import { te } from './api'

export const TE = 'te'
export const qk = {
  me: [TE, 'me'] as const,
  queue: [TE, 'queue'] as const,
  trip: (id: Uuid) => [TE, 'trip', id] as const,
  claim: (id: Uuid) => [TE, 'claim', id] as const,
}

/** Queries wait for the stored session to be restored: on a cold start straight into
 *  /expenses (a deep link, or a reload of the web build) the screen mounts before the
 *  token is read back, and a call without it would be a 401 that signs the person out. */
export function useSignedIn() {
  return useSession().status === 'signedIn'
}

/** GET /api/te/me. */
export function useSnap() {
  return useQuery({ queryKey: qk.me, queryFn: te.me, enabled: useSignedIn() })
}

/** GET /api/te/queue. Empty for most people; a failure must not hide the rest (TeHome). */
export function useQueue() {
  return useQuery<TeQueueRow[]>({ queryKey: qk.queue, queryFn: () => te.queue().catch(() => []), enabled: useSignedIn() })
}

/** GET /api/te/trips/:id. */
export function useTripDetail(id: Uuid | null | undefined) {
  return useQuery<TeTripDetail>({ queryKey: qk.trip(id || ''), queryFn: () => te.trip(id!), enabled: useSignedIn() && !!id })
}

/** GET /api/te/claims/:id. */
export function useClaimDetail(id: Uuid | null | undefined) {
  return useQuery<TeClaimDetail>({ queryKey: qk.claim(id || ''), queryFn: () => te.claim(id!), enabled: useSignedIn() && !!id })
}

/** The website's reload(): read the snapshot, the queue and every open detail again.
 *  Also refreshes the app Home figures and the notification bell, which T&E changes feed. */
export function reloadTe() {
  return invalidate(TE, 'today', 'notifications')
}

/** Pull-to-refresh for a screen: wait for the module's queries to come back. */
export function refetchTe() {
  return queryClient.refetchQueries({ queryKey: [TE], type: 'active' })
}

// ── lookups every screen needs (TeHome's derived values, spec Part 1.3) ──────

export function placeNameOf(snap: Snapshot) {
  return (id: string | null | undefined) => (id ? snap.masters.places.find(p => p.id === id)?.s ?? '' : '')
}
export function modeNameOf(snap: Snapshot) {
  return (id: string | null | undefined) => (id ? snap.cfg.modes.find(m => m.id === id)?.name ?? '' : '')
}
export function catNameOf(snap: Snapshot) {
  return new Map(snap.cfg.cats.map(c => [c.id, c.name]))
}
export const meOf = (snap: Snapshot) => snap.emp[snap.me]
export const initialsOf = (name: string | null | undefined) =>
  (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

/** The figures TeHome computes from the snapshot — exact formulas. */
export function homeFigures(snap: Snapshot) {
  const open = snap.claims.filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD'].includes(c.status))
  const coming = snap.claims
    .filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD', 'VERIFIED'].includes(c.status))
    .reduce((a, c) => a + (c.net ?? c.approved ?? c.claimed), 0)
  const advance = snap.advances.reduce((a, x) => a + (x.outstanding || 0), 0)
  const unclaimed = snap.expenses.filter(x => !x.other && !x.tripId && x.status === 'UNCLAIMED')
  const sentBack = snap.claims.filter(c => c.status === 'SENT_BACK')
  const liveLeg = snap.journeys.find(j => j.emp === snap.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null
  return { open, coming, advance, unclaimed, sentBack, liveLeg }
}

/** Memoised lookups for a snapshot. */
export function useLookups(snap: Snapshot | undefined) {
  return React.useMemo(() => snap ? {
    me: meOf(snap),
    placeName: placeNameOf(snap),
    modeName: modeNameOf(snap),
    catName: catNameOf(snap),
  } : null, [snap])
}

/** A leg by id, from the freshest data: the snapshot first, else the open trip's detail.
 *  Never a copy taken when a screen opened (the web's stale-leg defect, spec Part 4). */
export function findLeg(snap: Snapshot | undefined, legId: Uuid, detail?: TeTripDetail): TeLeg | null {
  return snap?.journeys.find(j => j.id === legId) ?? detail?.legs.find(l => l.id === legId) ?? null
}

/** A trip by id: the snapshot, else a cached trip detail. */
export function findTrip(snap: Snapshot | undefined, tripId: Uuid | null | undefined): TeTrip | null {
  if (!tripId) return null
  return snap?.trips.find(t => t.id === tripId)
    ?? queryClient.getQueryData<TeTripDetail>(qk.trip(tripId))?.trip
    ?? null
}

/** An expense line by id: my snapshot lines, else a cached claim detail's or trip detail's lines. */
export function findLine(snap: Snapshot | undefined, lineId: Uuid | null | undefined, o: { claimId?: Uuid | null; tripId?: Uuid | null } = {}): TeExpense | null {
  if (!lineId) return null
  return snap?.expenses.find(x => x.id === lineId && !x.other)
    ?? (o.claimId ? queryClient.getQueryData<TeClaimDetail>(qk.claim(o.claimId))?.lines.find(x => x.id === lineId) : undefined)
    ?? (o.tripId ? queryClient.getQueryData<TeTripDetail>(qk.trip(o.tripId))?.expenses.find(x => x.id === lineId) : undefined)
    ?? null
}
