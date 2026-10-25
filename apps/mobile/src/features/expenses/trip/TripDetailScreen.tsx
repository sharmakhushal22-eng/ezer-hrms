// src/features/expenses/trip/TripDetailScreen.tsx — /expenses/trip/<id>, one trip in
// every state it can be in (components/te/trip/TeTripDetail.tsx; screens 18, 39b,
// 52, 53, 54, 61, 64, 68, 69a, 69e).
//
// `trip.display` decides which card sits near the top (TripStatusCards); the
// rest of the page (TripSections) is the same trip in every state.
//
// THE WEBSITE'S STALE-DETAIL DEFECT, NOT KEPT (spec Part 4, known defect 2): on
// the web TeTripDetail holds its own fetched detail and TeHome's reload() never
// refreshes it, so after "Add a journey", a bill or a journey started elsewhere
// the trip screen shows the old trip. Here the detail is useTripDetail(id), a
// query under 'te', and every child action ends in reloadTe(), which refetches
// it with the snapshot.
import * as React from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { TeLeg } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { day, errorText, te } from '../api'
import { reloadTe, useSnap, useTripDetail } from '../data'
import { open, param, teHref } from '../nav'
import { Chip, FieldErr, Flag, TeCard } from '../ui/kit'
import { SnapState, TeScreen } from '../ui/TeScreen'
import { ScopeChip } from './TripsScreen'
import { ApprovalCard, ClaimCard, CloseEveryCard, DraftCard, ExpiredCard, MissedCard, ReadyCard, type Busy } from './TripStatusCards'
import { AdvanceCard, BillsCard, ClaimsCards, EstimateCard, HistoryCard, HotelsCard, RouteCard, StaysCard } from './TripSections'
import { tripView, type TripView } from './view'
import { PATTERN_WORD } from './words'

/** The web's onBack() after a cancel: the Trips list — popped to when it is under
 *  this screen, otherwise this screen is replaced with it. */
function toTrips() {
  try { router.dismissTo(teHref.trips as never) } catch { router.replace(teHref.trips as never) }
}

export default function TripDetailScreen() {
  const id = param(useLocalSearchParams<{ id: string }>().id)
  const snapQ = useSnap()
  const q = useTripDetail(id)
  const snap = snapQ.data
  const d = q.data
  return (
    <TeScreen title="Trip" subtitle={d?.trip.no} onRefresh={() => q.refetch()}>
      {!snap ? (
        <SnapState error={snapQ.error} onRetry={() => void snapQ.refetch()} />
      ) : !d ? (
        <TeCard>
          <Txt size={F.small} tone="muted">{q.error ? errorText(q.error) : 'Loading the trip…'}</Txt>
          {q.error ? <View style={{ marginTop: S.md }}><Button size="sm" variant="outline" title="Try again" onPress={() => void q.refetch()} /></View> : null}
        </TeCard>
      ) : (
        <TripBody v={tripView(d, snap.me, snap.today)} />
      )}
    </TeScreen>
  )
}

function TripHeader({ v }: { v: TripView }) {
  const { t, pname, withWho, chip } = v
  return (
    <TeCard>
      <Txt size={F.title + 2} w={700}>{t.name}</Txt>
      <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{(t.points || []).map(p => pname(p.place) || '…').join(' → ')}</Txt>
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>
        {t.start ? (t.start === t.end ? day(t.start) : `${day(t.start)} to ${day(t.end)}`) : 'No dates yet'}
        {t.purpose ? ` · ${t.purpose}` : ''}{t.project ? ` · ${t.project}` : ''}
      </Txt>
      {t.pax > 1 ? (
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>
          {`${t.pax} people travel. Each claims their own expenses.${withWho ? ` ${withWho}.` : ''}`}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
        <ScopeChip scope={t.scope} />
        <Chip plain label={PATTERN_WORD[t.pattern] ?? t.pattern} />
        {t.origin === 'POST_FACTO' ? <Chip plain tone="t-warn" label="Recorded after travel" /> : null}
        <Chip label={chip.label} tone={chip.tone} />
      </View>
    </TeCard>
  )
}

function TripBody({ v }: { v: TripView }) {
  const { notify, confirm } = useOverlay()
  const { t, st, mine, detail, note, openLegs, isDraftPostFacto, claims, canBill, canAskStay } = v
  const [busy, setBusy] = React.useState<Busy>('')
  const [error, setError] = React.useState('')
  const [asking, setAsking] = React.useState(false)

  // TeHome's callbacks for this view.
  const onChanged = (msg: string) => { notify(msg); void reloadTe() }
  const onEdit = () => open(teHref.plan({ kind: t.scope, past: t.origin === 'POST_FACTO', edit: t.id }))
  const onOpenLeg = (leg: TeLeg) => open(teHref.leg(leg.id, t.id))
  const onClaim = () => open(teHref.tripClaim(t.id))

  /** TeTripDetail act(): busy, run, toast + reload; a cancelled trip goes back to Trips. */
  async function act(what: Busy, run: () => Promise<string>): Promise<boolean> {
    setBusy(what); setError('')
    try {
      const message = await run()
      onChanged(message)
      if (what === 'cancel' || what === 'delete') toTrips()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy('')
    }
  }

  /** The web's inline "Cancel this trip?" / "Delete this draft?" card, as a confirm dialog. */
  async function askCancel(kind: 'cancel' | 'delete') {
    const ok = await confirm({
      title: kind === 'delete' ? 'Delete this draft?' : 'Cancel this trip?',
      message: kind === 'delete'
        ? 'The draft and its journeys are removed. Nothing has been claimed against it, so nothing else changes.'
        : 'The plan is cancelled and its journeys are dropped. Any advance asked for is cancelled with it. This cannot be undone.',
      confirm: kind === 'delete' ? 'Delete the draft' : 'Cancel the trip',
      cancel: 'Keep it',
      destructive: true,
    })
    if (!ok) return
    void act(kind, async () => {
      const r = await te.tripCancel(t.id)
      return r.deleted ? 'The draft was deleted.' : `${t.no} was cancelled.`
    })
  }

  return (
    <View>
      <TripHeader v={v} />

      {note ? (
        <Flag tone="info" icon="people" title="You are travelling on this trip" style={{ marginBottom: S.md }}>{note}</Flag>
      ) : null}

      {error ? <View style={{ marginBottom: S.md }}><FieldErr>{error}</FieldErr></View> : null}

      {st === 'PENDING_APPROVAL' || st === 'SENT_BACK' ? (
        <ApprovalCard v={v} busy={busy} onEdit={onEdit}
          onAnswer={text => act('answer', async () => { await te.tripAnswer(t.id, text); return 'Your answer was sent.' })} />
      ) : null}

      {st === 'EXPIRED' ? <ExpiredCard /> : null}

      {st === 'MISSED' && mine ? (
        <MissedCard v={v} busy={busy} onRecord={(reason, n) => void act('missed', async () => {
          await te.tripRecordMissed(t.id, reason, n)
          return 'Recorded. Add each journey without GPS, then claim.'
        })} />
      ) : null}

      {st === 'APPROVED' || st === 'ONGOING' ? (
        <ReadyCard v={v} busy={busy} onOpenLeg={onOpenLeg} onEdit={onEdit} onCancel={() => void askCancel('cancel')} />
      ) : null}

      {isDraftPostFacto && mine ? <DraftCard busy={busy} onEdit={onEdit} onDelete={() => void askCancel('delete')} /> : null}

      {st === 'COMPLETED' && openLegs.length && mine ? <CloseEveryCard v={v} onOpenLeg={onOpenLeg} /> : null}

      {mine && !openLegs.length && (st === 'COMPLETED' || isDraftPostFacto) && !claims.some(c => c.status !== 'CANCELLED' && c.status !== 'REJECTED')
        ? <ClaimCard onClaim={onClaim} /> : null}

      {canBill ? <BillsCard v={v} onAddBill={() => open(teHref.expense({ trip: t.id }))} onClaim={onClaim} /> : null}

      {(t.stayOptions ?? []).length ? <HotelsCard v={v} /> : null}

      <RouteCard v={v} onAddLeg={() => open(teHref.addLeg(t.id))} onOpenLeg={onOpenLeg} />

      {t.origin !== 'POST_FACTO' && t.estimateTotal ? <EstimateCard v={v} /> : null}

      <ClaimsCards v={v} onOpenClaim={id => open(teHref.claim(id))} />

      {detail.bookings.length || canAskStay ? (
        <StaysCard v={v} asking={asking} onAsk={() => setAsking(true)} onCancelAsk={() => setAsking(false)}
          onAsked={msg => { setAsking(false); onChanged(msg) }} />
      ) : null}

      <AdvanceCard v={v} />

      {detail.timeline.length ? <HistoryCard v={v} /> : null}
    </View>
  )
}
