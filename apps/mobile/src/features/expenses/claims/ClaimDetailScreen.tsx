// src/features/expenses/claims/ClaimDetailScreen.tsx — /expenses/claim/<id>
// (components/te/TeClaims.tsx TeClaimDetail, view 'claim'). Also the target of the
// deep link /expenses?tab=claims&ref=<id> (HomeScreen pushes this route).
//
// One claim: tracker, lines, open flags, the journeys behind it (evidence), totals,
// the owner's actions (answer a send-back, take it back), the plain approver /
// Finance buttons, and history. GET /api/te/claims/:id is a query under 'te', so
// reloadTe() after every action refetches it (the website's `tick`).
//
// Differences from the website, on purpose:
//   · the bill links get `claimId`, so an approver opening a colleague's bill
//     here works (spec Part 5 "Known gaps"; the server ignores it for own files);
//   · the trip's place names come from useTripDetail (cached, refetched with the rest);
//   · the owner's answer to a send-back autosaves as a draft (as on the website) and,
//     unlike the website, reopens with that draft (claims/OwnerReply.tsx).
import * as React from 'react'
import { BackHandler, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { TeClaimDetail, TeDraft, TeExpense, TePlaceBrief } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { claimChip, claimHolder, errorText, te } from '../api'
import { catNameOf, reloadTe, useClaimDetail, useDrafts, useSnap, useTripDetail } from '../data'
import { close, open, param, teHref } from '../nav'
import { Chip, Flag, Mono, Note, TeCard } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { ClaimHistory, ClaimLines, ClaimTotals, ClaimTracker, ErrorFlag, FlagBlock, LegRows, toClaims } from './parts'
import { LegEvidence } from './LegEvidence'
import { OwnerReply } from './OwnerReply'

const EMPTY_PLACES: Record<string, TePlaceBrief> = {}

/** The aside's action card: answer, take back, or decide. */
function ClaimActions({ d, onChanged, replyDraft, draftsReady }: {
  d: TeClaimDetail; onChanged: (msg: string) => void
  /** My saved, unsent answer to this claim, if any. */
  replyDraft?: TeDraft
  /** The drafts list has answered, so the reply can open with what was saved. */
  draftsReady: boolean
}) {
  const c = d.claim
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [recalling, setRecalling] = React.useState(false)
  const finance = d.can.stage === 'finance'

  async function run(label: string, act: () => Promise<unknown>, after?: () => void): Promise<boolean> {
    setBusy(true); setError('')
    try {
      await act()
      setText(''); after?.(); onChanged(label)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const showCard = (d.can.own && (c.status === 'SENT_BACK' || c.status === 'IN_APPROVAL')) || d.can.act
  return (
    <>
      {showCard ? (
        <TeCard>
          {d.can.own && c.status === 'SENT_BACK' ? (
            draftsReady ? (
              <OwnerReply claimId={c.id} resuming={replyDraft} busy={busy}
                onSend={answer => run('Answer sent.', () => te.claimRespond(c.id, answer))} />
            ) : <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>Loading…</Txt>
          ) : null}
          {d.can.own ? (
            recalling ? (
              <View style={{ gap: S.sm }}>
                <Flag tone="crit" icon="warn" title={`Take ${c.no} back?`}>
                  It leaves the approval chain and becomes yours to change again. Sending it back in starts the approvals from the beginning.
                </Flag>
                <View style={{ flexDirection: 'row', gap: S.sm }}>
                  <View style={{ flex: 1 }}><Button title="Never mind" variant="outline" full onPress={() => setRecalling(false)} /></View>
                  <View style={{ flex: 1 }}>
                    <Button title={busy ? 'Taking it back…' : 'Take it back'} variant="danger" full disabled={busy}
                      onPress={() => void run('Claim taken back.', () => te.claimRecall(c.id), () => setRecalling(false))} />
                  </View>
                </View>
              </View>
            ) : (
              <Button title="Take this claim back" variant="outline" full disabled={busy} onPress={() => setRecalling(true)} />
            )
          ) : null}
          {d.can.act ? (
            <View style={{ gap: S.sm, marginTop: d.can.own ? S.md : 0 }}>
              <Txt size={F.tiny} tone="muted">
                You are deciding as {d.can.role}. To reduce or refuse single lines, or to answer a check, open this claim from the Approvals desk.
              </Txt>
              <Input label="Comment" multiline value={text} onChangeText={setText} style={{ marginBottom: 0 }} />
              <Button title={finance ? 'Verify' : 'Approve'} full disabled={busy}
                onPress={() => void run(finance ? 'Verified.' : 'Approved.', () => te.claimDecide(c.id, finance ? 'verify' : 'approve', { comment: text }))} />
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Send back" variant="outline" size="sm" full disabled={busy || !text.trim()}
                    onPress={() => void run('Sent back.', () => te.claimDecide(c.id, 'sendback', { comment: text, stage: finance ? 'finance' : 'manager' }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Reject" variant="danger" size="sm" full disabled={busy || !text.trim()}
                    onPress={() => void run('Rejected.', () => te.claimDecide(c.id, 'reject', { comment: text, stage: finance ? 'finance' : 'manager' }))} />
                </View>
              </View>
            </View>
          ) : null}
          {error ? <ErrorFlag text={error} style={{ marginTop: S.md }} /> : null}
        </TeCard>
      ) : null}
      {!showCard && error ? <ErrorFlag text={error} style={{ marginBottom: S.md }} /> : null}
      {!d.can.act && d.can.why && !d.can.own ? <Note style={{ marginBottom: S.md }}>{d.can.why}</Note> : null}
    </>
  )
}

function ClaimBody({ d, catName, onChanged, onFixLine, onEvidence, replyDraft, draftsReady }: {
  d: TeClaimDetail
  replyDraft?: TeDraft
  draftsReady: boolean
  catName: Map<string, string>
  onChanged: (msg: string) => void
  onFixLine?: (line: TeExpense, tripId?: string) => void
  onEvidence: (legId: string) => void
}) {
  const c = d.claim
  const chip = claimChip(c)
  const openFlags = c.flags.filter(f => f.status === 'open')
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
        <Button title="My claims" variant="outline" size="sm" onPress={toClaims} />
        <Mono>{c.no}</Mono>
      </View>
      <TeCard>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={F.page} w={700}>{d.trip?.name || 'Other expenses'}</Txt>
            <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>
              {[d.employee.name, claimHolder(c), c.period ? `${c.period} period` : ''].filter(Boolean).join(' · ')}
            </Txt>
          </View>
          <Chip label={chip.label} tone={chip.tone} />
        </View>
        <ClaimTracker c={c} />
      </TeCard>

      <ClaimLines lines={d.lines} catName={catName} claimId={c.id}
        fixFor={x => (x.fix && onFixLine && d.can.own ? () => onFixLine(x, d.trip?.id) : undefined)} />
      {openFlags.map(f => (
        <FlagBlock key={f.id} code={f.code} title={f.title} text={f.evidence} block={f.block} style={{ marginBottom: S.sm }} />
      ))}
      <LegRows legs={d.legs ?? []} onOpen={onEvidence} />

      <View style={{ height: openFlags.length ? S.sm : 0 }} />
      <ClaimTotals c={c} />
      <ClaimActions key={`${c.id}-${c.status}`} d={d} onChanged={onChanged} replyDraft={replyDraft} draftsReady={draftsReady} />
      <ClaimHistory timeline={d.timeline} />
    </View>
  )
}

export default function ClaimDetailScreen() {
  const id = param(useLocalSearchParams<{ id?: string }>().id)
  const { notify } = useOverlay()
  const q = useClaimDetail(id)
  const snap = useSnap().data
  const catName = React.useMemo(() => (snap ? catNameOf(snap) : new Map<string, string>()), [snap])
  const d = q.data
  // The trip is read alongside for the place names the evidence shows; a failure leaves them blank.
  const places = useTripDetail(d?.trip?.id).data?.places ?? EMPTY_PLACES
  const draftsQ = useDrafts('claim')
  const replyDraft = draftsQ.data?.find(x => x.claim_id === id)
  const draftsReady = draftsQ.isFetched || !!draftsQ.error
  const [evidence, setEvidence] = React.useState<string | null>(null)
  const openLeg = evidence && d ? d.legs.find(l => l.id === evidence) ?? null : null

  // Android back closes the evidence first, as its "Claim" button does.
  React.useEffect(() => {
    if (!openLeg) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setEvidence(null); return true })
    return () => sub.remove()
  }, [openLeg])

  const onChanged = React.useCallback((msg: string) => { notify(msg, 'success'); void reloadTe() }, [notify])

  return (
    <TeScreen title={openLeg ? `Journey ${openLeg.n}` : 'Claim'} tab="claim" onBack={openLeg ? () => setEvidence(null) : close}
      onRefresh={() => q.refetch()}>
      {!d ? (
        <TeCard>
          <Txt size={F.small} tone="muted">{q.error ? errorText(q.error) : 'Loading the claim…'}</Txt>
          <View style={{ marginTop: S.md, alignSelf: 'flex-start' }}><Button title="My claims" variant="outline" size="sm" onPress={toClaims} /></View>
        </TeCard>
      ) : openLeg ? (
        <LegEvidence leg={openLeg} places={places} onBack={() => setEvidence(null)} />
      ) : (
        <ClaimBody d={d} catName={catName} onChanged={onChanged} onEvidence={setEvidence} replyDraft={replyDraft} draftsReady={draftsReady}
          onFixLine={(line, tripId) => open(teHref.expense({ line: line.id, trip: tripId, claim: d.claim.id }))} />
      )}
    </TeScreen>
  )
}
