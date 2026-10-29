// src/features/expenses/desk/FinanceDeskScreen.tsx — /expenses/desk/finance, the
// Finance desk (components/te/finance/TeFinanceDesk.tsx), offered in ESS only to
// members of the Finance desk (useDeskAccess: te_finance_summary answering IS the
// permission; each call is re-checked in SQL).
//
// Rooms in the order the money moves. In the app:
//   Verification  components/te/finance/TeVerification.tsx — ported (to verify /
//                 rejected, attention vs routine, reopen with a reason; a claim
//                 opens in the app's claim approval screen, which carries the
//                 finance stage: Verify / Hold / Send back / Reject).
//   Journeys      components/te/finance/TeJourneys.tsx — ported (shares JourneyReview).
//   Advances, Payouts, Corrections, Months — NOT in the app yet (TeAdvanceDesk,
//                 TePayouts, TeAdjustments, TePeriods): bank files, payout batches
//                 and month locks are back-office work; the room says so.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText, rs } from '../api'
import { reloadTe, useDeskAccess, useSignedIn, useSnap } from '../data'
import { open, teHref } from '../nav'
import { Chip, Ico, Note, PageHead, Seg, TeCard, TeEmpty } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { TeIcon } from '../ui/TeIcon'
import { JourneyReview } from './JourneyReview'
import { deskApi, deskKey, type ClaimSummaryRow } from './types'

type Room = 'verify' | 'journeys' | 'advances' | 'payouts' | 'corrections' | 'periods'
const ROOMS: { key: Room; label: string; icon: string }[] = [
  { key: 'verify', label: 'Verification', icon: 'verify' },
  { key: 'journeys', label: 'Journeys', icon: 'route' },
  { key: 'advances', label: 'Advances', icon: 'advances' },
  { key: 'payouts', label: 'Payouts', icon: 'claims' },
  { key: 'corrections', label: 'Corrections', icon: 'swap' },
  { key: 'periods', label: 'Months', icon: 'cal' },
]
const BAND_TONE: Record<string, string> = { High: 't-crit', Medium: 't-warn', Low: 't-pos' }
const openTrip = (id: string) => open(teHref.trip(id))
const openClaim = (id: string) => open(`/expenses/approvals/claim/${id}`)

function ClaimRowView({ r, onPress }: { r: ClaimSummaryRow; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
      <Pressable onPress={onPress} accessibilityRole="button" style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Ico name="other" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{`${r.claim_no} · ${r.employee_name}`}</Txt>
          <Txt size={F.tiny} tone="muted">{[r.trip_name || 'Other expenses', r.grade, r.department, r.period_label].filter(Boolean).join(' · ')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {r.status === 'ON_HOLD' ? <Chip tone="t-crit" label="On hold" /> : null}
            <Chip tone={BAND_TONE[r.risk_band] ?? 'plain'} label={`${r.risk_band} risk`} />
            {r.open_flags ? <Chip tone="t-warn" label={`${r.open_flags} flag${r.open_flags === 1 ? '' : 's'}`} /> : null}
            {r.is_exception ? <Chip tone="t-crit" label="Exception" /> : null}
            {r.is_post_facto ? <Chip plain label="After travel" /> : null}
            {r.is_late ? <Chip tone="t-warn" label="Late" /> : null}
            {r.waiting_role ? <Chip plain label={r.waiting_role} /> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt size={F.small} w={700}>{rs(r.eligible_total)}</Txt>
          <Txt size={F.tiny} tone="muted">eligible</Txt>
          {r.claimed_total !== r.eligible_total ? <Txt size={F.tiny} tone="muted" style={{ textDecorationLine: 'line-through' }}>{rs(r.claimed_total)}</Txt> : null}
        </View>
      </Pressable>
      {r.trip_id ? (
        <View style={{ marginTop: S.sm, alignSelf: 'flex-start' }}>
          <Button size="sm" variant="outline" title={r.trip_no ?? 'Trip'} icon={<TeIcon name="route" size="sm" color={C.brandDeep} />} onPress={() => openTrip(r.trip_id!)} />
        </View>
      ) : null}
    </View>
  )
}

function RejectedRow({ r, onReopened }: { r: ClaimSummaryRow; onReopened: (message: string) => void }) {
  const { C } = useTheme()
  const [reopening, setReopening] = React.useState(false)
  const [why, setWhy] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  async function reopen() {
    if (!why.trim()) return
    setBusy(true); setError('')
    try {
      await deskApi.claimReopen(r.id, why.trim())
      onReopened(`${r.claim_no} reopened. It goes back into approval.`)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Ico name="close" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{`${r.claim_no} · ${r.employee_name}`}</Txt>
          <Txt size={F.tiny} tone="muted">{[r.trip_name || 'Other expenses', r.department, r.period_label].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Txt size={F.small} w={700}>{rs(r.claimed_total)}</Txt>
      </View>
      {reopening ? (
        <View style={{ marginTop: S.sm }}>
          <Note style={{ marginBottom: S.sm }}>The claim goes back into its approval chain from the beginning. The employee is told it was reopened, and your reason is kept on it.</Note>
          <Input label="Why it should not have been refused" value={why} onChangeText={setWhy} placeholder="Rejected by mistake; the client is on the visitor log" error={error || undefined} />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button variant="outline" title="Never mind" onPress={() => { setReopening(false); setWhy('') }} style={{ flex: 1 }} />
            <Button title={busy ? 'Reopening…' : 'Reopen it'} disabled={!why.trim() || busy} onPress={() => void reopen()} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: S.sm, alignSelf: 'flex-start' }}><Button size="sm" variant="outline" title="Reopen" onPress={() => setReopening(true)} /></View>
      )}
    </View>
  )
}

function Verification({ onToast }: { onToast: (m: string) => void }) {
  const [showing, setShowing] = React.useState<'IN_VERIFICATION' | 'REJECTED'>('IN_VERIFICATION')
  const status = showing === 'IN_VERIFICATION' ? 'IN_VERIFICATION,ON_HOLD' : 'REJECTED'
  const q = useQuery({ queryKey: deskKey.claims(status), queryFn: () => deskApi.financeClaims(status).then(p => p.rows ?? []), enabled: useSignedIn() })
  const list = q.data ?? []
  const attention = list.filter(r => r.status === 'ON_HOLD' || r.risk_band === 'High' || r.is_exception || r.open_flags > 0)
  const routine = list.filter(r => !attention.includes(r))
  return (
    <View>
      <PageHead title="Verification" lead="Claims a manager has approved, waiting on Finance. Check the bills and the flags, then verify, hold or send back." />
      <Seg value={showing} onChange={setShowing} label="Which claims" style={{ marginBottom: S.md }}
        items={[{ key: 'IN_VERIFICATION', label: 'To verify', icon: 'verify' }, { key: 'REJECTED', label: 'Rejected', icon: 'close' }]} />
      {q.error ? (
        <TeCard>
          <Txt size={F.small} tone="muted">{errorText(q.error)}</Txt>
          <View style={{ marginTop: S.sm, alignSelf: 'flex-start' }}><Button size="sm" variant="outline" title="Try again" onPress={() => void q.refetch()} /></View>
        </TeCard>
      ) : null}
      {showing === 'REJECTED' ? (
        <TeCard>
          <Txt size={F.tiny} w={700} tone="muted" upper>{`Rejected · ${list.length}`}</Txt>
          {q.isLoading ? <TeEmpty title="Loading…" /> : null}
          {q.isSuccess && !list.length ? <TeEmpty title="Nothing rejected">A refused claim appears here, and can be put back if it was refused by mistake.</TeEmpty> : null}
          {list.map(r => <RejectedRow key={r.id} r={r} onReopened={m => { onToast(m); void reloadTe() }} />)}
        </TeCard>
      ) : (
        <>
          {[{ title: 'Needs a look', rows: attention }, { title: 'Routine', rows: routine }].map(g => g.rows.length ? (
            <TeCard key={g.title}>
              <Txt size={F.tiny} w={700} tone="muted" upper>{`${g.title} · ${g.rows.length}`}</Txt>
              {g.rows.map(r => <ClaimRowView key={r.id} r={r} onPress={() => openClaim(r.id)} />)}
            </TeCard>
          ) : null)}
          {q.isLoading ? <TeCard><TeEmpty title="Loading…" /></TeCard> : null}
          {q.isSuccess && !list.length ? (
            <TeCard><TeEmpty title="Nothing to verify">Claims appear here once a manager has approved them, including the ones held for audit.</TeEmpty></TeCard>
          ) : null}
        </>
      )}
    </View>
  )
}

function Journeys({ onToast }: { onToast: (m: string) => void }) {
  const [filter, setFilter] = React.useState<'waiting' | 'back' | 'done'>('waiting')
  const modes = useSnap().data?.cfg.modes ?? []
  const q = useQuery({ queryKey: deskKey.journeys(filter), queryFn: () => deskApi.financeJourneys(filter).then(p => p.rows ?? []), enabled: useSignedIn() })
  return (
    <View>
      <PageHead title="Journeys" lead="Journeys travellers have recorded and reported, including the local sub-trips they add while they are away. Confirming records that you looked and agreed; the money is settled on the claim, in Verification." />
      <Seg value={filter} onChange={setFilter} label="Which journeys" style={{ marginBottom: S.md }}
        items={[{ key: 'waiting', label: 'Waiting on Finance' }, { key: 'back', label: 'Sent back' }, { key: 'done', label: 'Confirmed' }]} />
      {q.error ? <TeCard><Txt size={F.small} tone="critical">{errorText(q.error)}</Txt></TeCard> : null}
      {q.isLoading ? <Txt size={F.small} tone="muted">Loading…</Txt> : (
        <JourneyReview rows={q.data ?? []} desk="finance" basisOf={m => modes.find(x => x.id === m)?.basis}
          onOpenTrip={openTrip} onDone={() => void reloadTe()} onToast={m => { onToast(m); void reloadTe() }} />
      )}
    </View>
  )
}

const NOT_YET: Record<Exclude<Room, 'verify' | 'journeys'>, string> = {
  advances: 'Paying, refusing, refunding and carrying advances',
  payouts: 'Payout batches and their bank files',
  corrections: 'Corrections to a settlement that was wrong either way',
  periods: 'Which months still accept claims, and closing or locking a month',
}

export default function FinanceDeskScreen() {
  const { notify } = useOverlay()
  const access = useDeskAccess()
  const [room, setRoom] = React.useState<Room>('verify')
  const toast = (m: string) => notify(m)
  return (
    <TeScreen title="Finance desk">
      {!access.finance ? (
        <Note style={{ marginBottom: S.md }}>The Finance desk is for the people on it. If you are, it opens once that is confirmed.</Note>
      ) : null}
      <Seg value={room} onChange={setRoom} label="Finance" items={ROOMS} style={{ marginBottom: S.md }} />
      {room === 'verify' ? <Verification onToast={toast} /> : null}
      {room === 'journeys' ? <Journeys onToast={toast} /> : null}
      {room !== 'verify' && room !== 'journeys' ? (
        <TeCard>
          <TeEmpty title="On the website for now">
            {`${NOT_YET[room]} is done on the website: open Travel and Expenses there, then Finance desk. Everything you do there shows here.`}
          </TeEmpty>
        </TeCard>
      ) : null}
    </TeScreen>
  )
}
