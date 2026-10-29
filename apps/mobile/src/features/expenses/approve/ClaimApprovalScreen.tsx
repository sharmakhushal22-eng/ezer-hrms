// src/features/expenses/approve/ClaimApprovalScreen.tsx — deciding a claim, line by line
// (components/te/approve/TeClaimApproval.tsx, screens 92/93/95/96).
// Route /expenses/approvals/claim/<claimId>. Managers approve; a Finance-team employee
// (G2) gets the finance stage here too: Verify / Hold / Send back / Reject and
// answering flags. The arithmetic and gates are '@web/te/claim-decide' and
// '@web/te/flag-review'; the flags, band and eligible amounts are the server's.
//
// Journey evidence opens over this screen and keeps the half-made decision (state
// lives here); its back — header or Android back — returns to the claim.
import * as React from 'react'
import { BackHandler, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import {
  actionsForStage, decidedTotal, describe as describeDecision, emptyDecision, toDecideInput, whyNotReady,
  type DecideAction, type DecisionDraft, type LineDecision,
} from '@web/te/claim-decide'
import { flagOffers, openFlags, whyFlagNotReady, type FlagVerdict } from '@web/te/flag-review'
import type { Uuid } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, SERIF } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { claimChip, errorText, rs, te, when } from '../api'
import { reloadTe, useClaimDetail, useTripDetail } from '../data'
import { param } from '../nav'
import { Chip, KvRow, ListCard, Mono, Note, Seg, TeCard } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { BookingRow, FlagRow, JourneyRow, LineRow } from './ClaimParts'
import { LegEvidence } from './LegEvidence'
import { TripPlan } from '../trip/TripPlan'
import { afterDecision, DecideButton, DetailState, ErrLine, NotYours } from './shared'

export default function ClaimApprovalScreen() {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const claimId = param(useLocalSearchParams<{ id: string }>().id)
  const q = useClaimDetail(claimId)
  const detail = q.data
  // Place names for journey evidence come from the trip; a failure leaves them blank, silently.
  const tq = useTripDetail(detail?.trip?.id)
  const places = tq.data?.places ?? {}

  const [evidence, setEvidence] = React.useState<Uuid | null>(null)
  const [draft, setDraft] = React.useState<DecisionDraft>(emptyDecision)
  const [action, setAction] = React.useState<DecideAction | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [resolving, setResolving] = React.useState<{ id: Uuid; verdict: FlagVerdict } | null>(null)
  const [note, setNote] = React.useState('')
  const [flagBusy, setFlagBusy] = React.useState(false)

  // Android back closes the evidence first, as its "Claim" button does.
  React.useEffect(() => {
    if (!evidence) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setEvidence(null); return true })
    return () => sub.remove()
  }, [evidence])

  if (!detail) {
    return (
      <TeScreen title="Approvals">
        <DetailState loading="Loading the claim…" error={q.error ? errorText(q.error) : ''} onRetry={() => void q.refetch()} />
      </TeScreen>
    )
  }

  const c = detail.claim
  const lines = detail.lines.map(l => ({ id: l.id, eligible: l.eligible ?? 0 }))
  const eligibleOf = (id: Uuid) => lines.find(l => l.id === id)?.eligible ?? 0
  const flagsFor = (id: Uuid) => c.flags.filter(f => f.lineId === id)
  const chip = claimChip(c)
  const sums = decidedTotal(lines, draft.lines)
  const mayAct = detail.can.act
  const verbs = actionsForStage(detail.can.stage)
  const chosen: DecideAction = action ?? verbs[0].action
  const blocked = whyNotReady(chosen, draft, lines)
  const who = detail.employee.name

  const setLine = (id: Uuid, patch: Partial<LineDecision>) =>
    setDraft(d => ({ ...d, lines: { ...d.lines, [id]: { ...d.lines[id], ...patch } } }))
  const clearLine = (id: Uuid) => setDraft(d => { const l2 = { ...d.lines }; delete l2[id]; return { ...d, lines: l2 } })
  const toggleFix = (id: Uuid) => setDraft(d => ({ ...d, fix: d.fix.includes(id) ? d.fix.filter(x => x !== id) : [...d.fix, id] }))

  async function send() {
    if (blocked) { setTried(true); setError(blocked); return }
    setBusy(true); setError('')
    try {
      await te.claimDecide(c.id, chosen, toDecideInput(chosen, draft))
      afterDecision(c.id, {
        approve: `${c.no} approved.`,
        verify: `${c.no} verified. It joins the next payout.`,
        hold: `${c.no} put on hold.`,
        sendback: `${c.no} sent back to ${who}.`,
        reject: `${c.no} rejected.`,
      }[chosen], notify)
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  async function resolveFlag() {
    if (!resolving) return
    const why = whyFlagNotReady(resolving.verdict, note)
    if (why) { setError(why); return }
    setFlagBusy(true); setError('')
    try {
      await te.flagResolve(resolving.id, resolving.verdict, note.trim())
      setResolving(null); setNote('')
      // Re-read so the band, the chips and the count are the server's (no toast, as on the web).
      await reloadTe()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setFlagBusy(false)
    }
  }

  const openLeg = evidence ? detail.legs.find(l => l.id === evidence) ?? null : null
  if (openLeg) {
    return (
      <TeScreen title="Claim" subtitle={`Journey ${openLeg.n}`} onBack={() => setEvidence(null)}>
        <LegEvidence leg={openLeg} places={places} />
      </TeScreen>
    )
  }

  const timeline = (detail.timeline ?? []).filter(e => !e.internal)
  return (
    <TeScreen title="Approvals" right={<View style={{ paddingRight: S.md }}><Mono>{c.no}</Mono></View>}>
      <TeCard>
        <Txt size={22} style={{ fontFamily: SERIF }}>{detail.employee.name}</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>
          {detail.trip ? detail.trip.name : 'Other expenses'} · {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'}
        </Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{detail.employee.code} · {detail.employee.title || detail.employee.dept}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
          {!!c.band && <Chip label={`${c.band} risk`} tone={c.band === 'High' ? 't-crit' : c.band === 'Medium' ? 't-warn' : 't-pos'} />}
          <Chip label={chip.label} tone={chip.tone} />
        </View>
      </TeCard>

      {!mayAct && <NotYours why={detail.can.why} />}

      <ListCard head="Lines" headRight={String(detail.lines.length)}>
        {detail.lines.map((l, i) => {
          const d = draft.lines[l.id]
          return (
            <LineRow key={l.id} l={l} d={d} eligible={eligibleOf(l.id)} flags={flagsFor(l.id)} claimId={c.id}
              mayAct={mayAct} sendback={chosen === 'sendback'} marked={draft.fix.includes(l.id)} last={i === detail.lines.length - 1}
              onReduce={() => setLine(l.id, { amount: d?.amount ?? eligibleOf(l.id), reject: undefined })}
              onRefuse={() => setLine(l.id, { reject: d?.reject ? undefined : 'refile', amount: undefined })}
              onFix={() => toggleFix(l.id)} onUndo={() => clearLine(l.id)} onPatch={p => setLine(l.id, p)} />
          )
        })}
      </ListCard>

      {c.flags.length > 0 && (
        <ListCard head="Checks that fired" headRight={String(openFlags(c.flags) || 'all answered')}>
          {c.flags.map((fl, i) => {
            const offers = flagOffers(fl.status, detail.can.stage, mayAct)
            const open = resolving?.id === fl.id ? resolving : null
            return (
              <FlagRow key={fl.id} fl={fl} line={fl.lineId ? detail.lines.find(l => l.id === fl.lineId) ?? null : null}
                offers={offers} resolving={open?.verdict ?? null} note={note} busy={flagBusy} last={i === c.flags.length - 1}
                onPick={v => { setResolving(open?.verdict === v ? null : { id: fl.id, verdict: v }); setNote(''); setError('') }}
                onNote={setNote} onCancel={() => { setResolving(null); setNote('') }} onSubmit={() => void resolveFlag()} />
            )
          })}
        </ListCard>
      )}

      {/* What was planned, beside what is being claimed (TeClaimApproval since 4a92155):
          a bill is judged against the plan — nights asked for, flight time, the stop
          that explains an extra cab. */}
      {tq.data?.trip ? <TripPlan trip={tq.data.trip} places={places} claimId={c.id} /> : null}
      {!!detail.bookings?.length && (
        <ListCard head="Stays and tickets" headRight={String(detail.bookings.length)}>
          {detail.bookings.map((b, i) => <BookingRow key={b.id} b={b} claimId={c.id} last={i === detail.bookings.length - 1} />)}
        </ListCard>
      )}

      {!!detail.legs?.length && (
        <ListCard head="Journeys on this trip" headRight={String(detail.legs.length)}>
          {detail.legs.map((l, i) => <JourneyRow key={l.id} l={l} last={i === detail.legs.length - 1} onPress={() => setEvidence(l.id)} />)}
        </ListCard>
      )}

      {mayAct && (
        <TeCard>
          <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Your decision</Txt>
          <Seg label="Decision" value={chosen} onChange={k => { setAction(k); setTried(false) }}
            items={verbs.map(v => ({ key: v.action, label: v.label }))} style={{ marginBottom: S.md }} />
          <Input label={chosen === 'approve' || chosen === 'verify' ? 'Comment, if any' : 'What the employee needs to know'} multiline
            value={draft.comment} onChangeText={v => setDraft(d => ({ ...d, comment: v }))} />
          <KvRow label="Claimed" value={rs(c.claimed)} />
          <KvRow label="Eligible under policy" value={rs(lines.reduce((a, l) => a + l.eligible, 0))} />
          {!!sums.cut && <KvRow label="Cut by you" value={rs(-sums.cut)} />}
          {!!sums.rejected && <KvRow label="Refused by you" value={rs(-sums.rejected)} />}
          <KvRow label={chosen === 'approve' || chosen === 'verify' ? 'Will be approved' : 'Would be approved'} value={rs(chosen === 'reject' ? 0 : sums.total)} tot last />
          <Note style={{ marginTop: S.sm }}>{describeDecision(chosen, draft, lines)}</Note>
          {tried && !!blocked && <ErrLine>{blocked}</ErrLine>}
          {!!error && error !== blocked && <ErrLine>{error}</ErrLine>}
          <DecideButton danger={chosen === 'reject'} busy={busy} onPress={() => void send()}
            title={busy ? 'Sending…' : `${verbs.find(v => v.action === chosen)?.label ?? 'Send'} the claim`} />
        </TeCard>
      )}

      {!!detail.timeline?.length && (
        <TeCard>
          <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>History</Txt>
          <View style={{ gap: S.sm }}>
            {timeline.map((e, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt size={F.small} w={700}>{e.text}</Txt>
                  <Txt size={F.tiny} color={C.muted}>{e.name ?? 'System'}</Txt>
                </View>
                <Txt size={F.tiny} tone="muted">{when(e.at)}</Txt>
              </View>
            ))}
          </View>
        </TeCard>
      )}
    </TeScreen>
  )
}
