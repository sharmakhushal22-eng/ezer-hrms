// src/features/expenses/leg/LegScreen.tsx — /expenses/leg/<legId>?trip=<tripId>, one journey
// (TeHome view `leg`). Which screen a journey gets is its own status (spec Part 4):
//
//   ACTIVE · PAUSED                       LegLive (the recorder)
//   PLANNED, still startable              LegLive, with "Not recorded?" → LegMissed
//   PLANNED, its day passed / trip over   LegMissed  (spec fix: the web opened the
//                                         recorder, whose Start the server refuses)
//   ENDED                                 LegReport
//   SUBMITTED · SKIPPED · CANCELLED       LegDone, read-only (spec fix: the web opened
//                                         TeLegMissed, whose actions always fail)
//
// The leg is resolved by id from the freshest snapshot / trip detail on every
// render (findLeg) — never a copy taken on open (the web's stale-leg defect).
// A desk's question about the journey shows on every state (JourneyAnswer).
import * as React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText } from '../api'
import { findLeg, findTrip, reloadTe, useSnap, useTripDetail } from '../data'
import { param, toTrip } from '../nav'
import { TeCard } from '../ui/kit'
import { SnapState, TeScreen } from '../ui/TeScreen'
import { JourneyAnswer } from './JourneyAnswer'
import { LegLive } from './LegLive'
import { LegDone, LegMissed } from './LegMissed'
import { LegReport } from './LegReport'

export default function LegScreen() {
  const params = useLocalSearchParams<{ id: string; trip?: string }>()
  const legId = param(params.id)
  const snapQ = useSnap()
  const snap = snapQ.data
  const fromSnap = snap?.journeys.find(j => j.id === legId) ?? null
  const tripId = param(params.trip) || fromSnap?.tripId || ''
  const detailQ = useTripDetail(tripId || null)
  const { notify } = useOverlay()
  const leg = findLeg(snap, legId, detailQ.data)
  const [notRecorded, setNotRecorded] = React.useState(false)

  const back = React.useCallback(() => { if (leg?.tripId || tripId) toTrip(leg?.tripId || tripId) }, [leg?.tripId, tripId])
  const done = React.useCallback((msg: string) => { notify(msg); void reloadTe(); back() }, [notify, back])
  const changed = React.useCallback((msg: string) => { notify(msg); void reloadTe() }, [notify])

  const placeName = (id: string) => snap?.masters.places.find(p => p.id === id)?.s ?? detailQ.data?.places[id]?.s ?? ''

  let body: React.ReactNode
  if (!snap) {
    body = <SnapState error={snapQ.error} onRetry={() => void snapQ.refetch()} />
  } else if (!leg) {
    body = (
      <TeCard>
        <Txt size={F.small} tone="muted">{detailQ.error ? errorText(detailQ.error) : detailQ.isLoading ? 'Loading the journey…' : 'This journey could not be found.'}</Txt>
        {detailQ.error ? <View style={{ marginTop: S.md }}><Button size="sm" variant="outline" title="Try again" onPress={() => void detailQ.refetch()} /></View> : null}
      </TeCard>
    )
  } else {
    const trip = findTrip(snap, leg.tripId) ?? detailQ.data?.trip ?? null
    const tooLate = leg.status === 'PLANNED'
      && (leg.date < snap.today || trip?.display === 'COMPLETED' || trip?.display === 'MISSED')
    const screen = leg.status === 'ACTIVE' || leg.status === 'PAUSED' || (leg.status === 'PLANNED' && !tooLate && !notRecorded)
      ? <LegLive snap={snap} leg={leg} placeName={placeName} onChanged={changed}
          onEnded={() => { notify('Journey ended. Add what it cost.'); void reloadTe(); back() }}
          onNotRecorded={leg.status === 'PLANNED' ? () => setNotRecorded(true) : undefined} />
      : leg.status === 'PLANNED'
        ? <LegMissed snap={snap} leg={leg} placeName={placeName} onDone={done} />
        : leg.status === 'ENDED'
          ? <LegReport snap={snap} leg={leg} placeName={placeName} onFiled={done} />
          : <LegDone snap={snap} leg={leg} placeName={placeName} />
    body = (
      <>
        {leg.emp === snap.me ? <JourneyAnswer legId={leg.id} n={leg.n} review={leg.review} onDone={changed} /> : null}
        {screen}
        {notRecorded && leg.status === 'PLANNED' && !tooLate ? (
          <Button variant="ghost" title="Back to starting the journey" onPress={() => setNotRecorded(false)} style={{ marginTop: S.sm }} />
        ) : null}
      </>
    )
  }

  return (
    <TeScreen title={leg ? `Journey ${leg.n}` : 'Journey'} subtitle={findTrip(snap, leg?.tripId ?? tripId)?.name} live={false}
      onBack={leg?.tripId || tripId ? back : undefined}
      onRefresh={() => detailQ.refetch()}>
      {body}
    </TeScreen>
  )
}
