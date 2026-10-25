// src/features/expenses/home/EntrySheets.tsx — the entry flow's sheets (TeHome).
//
// NewClaimSheet  sheet `new`: step 1 "What" — the four tiles.
// KindSheet      sheet `kind{kind, way}`: step 2 "How" (Continue rows + the ways)
//                and, with way='approved', step 3 "Choose the trip" (PickTrip).
// Moving between steps replaces the sheet (swap), so Android back from any step
// closes the flow, as Escape closes the website's drawer. The "Back" link and
// the step chips go to the earlier step exactly as on the website.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { approvedTrips, continueItems, wayCount, wayOff, FLOW_WAYS, KIND_NAME, type WayId } from '@web/te/entry-flow'
import type { Snapshot, TripScope } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { homeFigures, placeNameOf, useSnap } from '../data'
import { close, param, swap, teHref } from '../nav'
import { TeIcon } from '../ui/TeIcon'
import { Chip, H4, KindSquare } from '../ui/kit'
import { TeSheet } from '../ui/TeSheet'
import { TeSteps } from '../ui/TeSteps'
import { SnapState } from '../ui/TeScreen'
import { entryFacts, KindTiles, KIND_TEXT } from './KindTiles'
import { PickTrip } from './PickTrip'

const SCOPES: TripScope[] = ['local', 'domestic', 'international']

export function NewClaimSheet() {
  const q = useSnap()
  return (
    <TeSheet title="New claim" lead="Three steps: what, how, then the form."
      bar={<TeSteps on={1} kind={null} way={null} onTo={() => {}} />}>
      {q.data
        ? <KindTiles snap={q.data} onPick={k => swap(k === 'other' ? teHref.expense() : teHref.kind(k))} />
        : <SnapState error={q.error} onRetry={() => void q.refetch()} />}
    </TeSheet>
  )
}

function ContinueRow({ x, onGo }: { x: ReturnType<typeof continueItems>[number]; onGo: () => void }) {
  const { C } = useTheme()
  const hot = x.tone === 'go' || x.tone === 'live'
  const bg = hot ? C.brandTint : x.tone === 'warn' ? C.warningTint : C.surface
  const edge = hot ? C.brandEdge : x.tone === 'warn' ? C.warningEdge : C.line
  return (
    <View style={{ padding: 12, paddingHorizontal: 14, borderRadius: R.lg, borderWidth: 1, borderColor: edge, backgroundColor: bg, gap: S.sm }}>
      <View>
        <Txt size={F.micro} w={700} tone="muted" upper numberOfLines={1}>{x.trip}</Txt>
        <Txt size={F.body} w={700}>{x.title}</Txt>
        <Txt size={F.tiny} tone="muted">{x.sub}</Txt>
      </View>
      <Button title={x.btn} size="sm" variant={hot ? 'primary' : 'outline'} onPress={onGo} style={{ alignSelf: 'flex-start' }}
        icon={<TeIcon name="go" size="sm" color={hot ? C.onAccent : C.brandDeep} />} />
    </View>
  )
}

function WayButton({ w, first, off, count, onPress }: { w: typeof FLOW_WAYS['local'][number]; first: boolean; off: string; count: number; onPress: () => void }) {
  const { C } = useTheme()
  const pri = first && !off
  return (
    <Pressable disabled={!!off} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, borderWidth: 1.5,
        borderColor: pri ? C.brand : C.line, backgroundColor: pri ? C.brandTint : C.surface, opacity: off ? 0.62 : pressed ? 0.85 : 1,
      })}>
      <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: off ? C.sunken : pri ? C.brand : C.brandTint }}>
        <TeIcon name={w.icon} size="lg" color={off ? C.faint : pri ? C.onAccent : C.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size={15.5} w={700}>{w.title}</Txt>
          {count > 0 && <Chip label={String(count)} tone="t-brand" plain />}
        </View>
        <Txt size={F.small} tone="soft" style={{ marginTop: 2 }}>{off || w.text}</Txt>
        {!off && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {w.chips.map(c => (
              <View key={c} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
                <Txt size={11.5} w={600} tone="muted">{c}</Txt>
              </View>
            ))}
          </View>
        )}
      </View>
      {!off && <TeIcon name="go" color={C.brand} />}
    </Pressable>
  )
}

function KindBody({ snap, kind, way }: { snap: Snapshot; kind: TripScope; way: WayId | null }) {
  const { notify } = useOverlay()
  const facts = entryFacts(snap)
  const { unclaimed } = homeFigures(snap)
  const placeName = placeNameOf(snap)

  /** TeHome.openLeg(): the Continue list knows a leg by id; it must still be in the snapshot. */
  const openLeg = (tripId: string, legId: string) => {
    const leg = snap.journeys.find(j => j.id === legId)
    if (!leg) { notify('That journey is no longer there. Open the trip to see what changed.', 'info'); return }
    swap(teHref.leg(legId, tripId))
  }

  if (way === 'approved') {
    return (
      <PickTrip scope={kind} me={snap.me} trips={snap.trips} journeys={snap.journeys} today={snap.today} placeName={placeName}
        onStartLeg={(_legId, leg) => swap(teHref.leg(leg.id, leg.tripId))}
        onOpenTrip={id => swap(teHref.trip(id))} />
    )
  }

  const items = continueItems(kind, facts)
  const wayFacts = {
    manualAllowed: Boolean(snap.cfg.track.manualAllowed),
    postFacto: snap.cfg.postFacto,
    savedBills: unclaimed.length,
    approved: approvedTrips(kind, facts).length,
  }
  return (
    <View>
      {items.length > 0 && (
        <View>
          <H4 style={{ marginTop: 0 }}>Continue</H4>
          <View style={{ gap: S.sm }}>
            {items.map(x => (
              <ContinueRow key={x.id} x={x} onGo={() => (x.action === 'openTrip' ? swap(teHref.trip(x.id)) : openLeg(x.tripId, x.id))} />
            ))}
          </View>
        </View>
      )}
      <H4 style={items.length ? undefined : { marginTop: 0 }}>{items.length ? 'Or start something new' : 'How do you want to start?'}</H4>
      <View style={{ gap: 10 }}>
        {FLOW_WAYS[kind].map((w, i) => {
          const off = wayOff(kind, w.id, wayFacts)
          return (
            <WayButton key={w.id} w={w} first={i === 0} off={off} count={wayCount(w.id, wayFacts)}
              onPress={() => {
                if (w.id === 'approved') return swap(teHref.kind(kind, 'approved'))
                if (w.id === 'plan' || w.id === 'past') return swap(teHref.plan({ kind, past: w.id === 'past' }))
                if (w.id === 'start') return swap(teHref.start)
                close(); notify(`There is no screen for “${w.id}”.`, 'info')
              }} />
          )
        })}
      </View>
    </View>
  )
}

export function KindSheet() {
  const params = useLocalSearchParams<{ kind?: string; way?: string }>()
  const kindP = param(params.kind)
  const kind: TripScope = (SCOPES as string[]).includes(kindP) ? (kindP as TripScope) : 'local'
  const way = param(params.way) === 'approved' ? 'approved' as const : null
  const q = useSnap()
  const onApproved = way === 'approved'
  return (
    <TeSheet title={KIND_NAME[kind]} titleIcon={<KindSquare kind={kind} size={28} />} lead={KIND_TEXT(kind)}
      back={() => (onApproved ? swap(teHref.kind(kind)) : swap(teHref.newClaim))}
      bar={<TeSteps on={onApproved ? 3 : 2} kind={kind} way={way} onTo={step => swap(step === 1 ? teHref.newClaim : teHref.kind(kind))} />}>
      {q.data ? <KindBody snap={q.data} kind={kind} way={way} /> : <SnapState error={q.error} onRetry={() => void q.refetch()} />}
    </TeSheet>
  )
}
