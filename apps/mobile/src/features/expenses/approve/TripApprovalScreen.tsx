// src/features/expenses/approve/TripApprovalScreen.tsx — deciding a trip PLAN before travel
// (components/te/approve/TeTripApproval.tsx): approve, send back or reject. No lines to cut.
// Route /expenses/approvals/trip/<tripId>. The header back is the web's "Approvals" button.
import * as React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { tripChip } from '@web/te/trips-list'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, SERIF } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { day, errorText, plural, rs, te } from '../api'
import { dayAt } from '@web/te/format'
import { useTripDetail } from '../data'
import { param } from '../nav'
import { Chip, Flag, KvRow, Li, ListCard, Mono, Note, Seg, TeCard } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { afterDecision, DecideButton, DetailState, ErrLine, NotYours } from './shared'

type Action = 'approve' | 'sendback' | 'reject'

export default function TripApprovalScreen() {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const tripId = param(useLocalSearchParams<{ id: string }>().id)
  const q = useTripDetail(tripId)
  const [action, setAction] = React.useState<Action>('approve')
  const [comment, setComment] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const detail = q.data
  if (!detail) {
    return (
      <TeScreen title="Approvals">
        <DetailState loading="Loading the trip…" error={q.error ? errorText(q.error) : ''} onRetry={() => void q.refetch()} />
      </TeScreen>
    )
  }

  const t = detail.trip
  const chip = tripChip(t)
  const legs = [...detail.legs].sort((a, b) => a.n - b.n)
  const pname = (id: string) => detail.places[id]?.s ?? ''
  const mayAct = detail.can.act
  const who = detail.employee.name
  const needsReason = action !== 'approve' && !comment.trim()

  async function send() {
    if (needsReason) { setError(action === 'reject' ? 'A rejected trip needs a reason.' : 'Say what needs changing.'); return }
    setBusy(true); setError('')
    try {
      await te.tripDecide(t.id, action, comment.trim() || undefined)
      afterDecision(t.id,
        action === 'approve' ? `${t.no} approved.` : action === 'sendback' ? `${t.no} sent back to ${who}.` : `${t.no} rejected.`,
        notify)
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  return (
    <TeScreen title="Approvals" right={<View style={{ paddingRight: S.md }}><Mono>{t.no}</Mono></View>}>
      <TeCard>
        <Txt size={22} style={{ fontFamily: SERIF }}>{t.name}</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>{who} · {detail.employee.code}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{(t.points || []).map(p => pname(p.place) || '…').join(' → ')}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>
          {t.start
            ? (t.start === t.end ? dayAt(t.start, t.points?.[0]?.leaveAt) : `${dayAt(t.start, t.points?.[0]?.leaveAt)} to ${day(t.end)}`)
            : 'No dates'}
          {` · ${plural(legs.length, 'journey')}`}{t.purpose ? ` · ${t.purpose}` : ''}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
          {t.origin === 'POST_FACTO' && <Chip label="Already travelled" tone="t-warn" plain />}
          <Chip label={chip.label} tone={chip.tone} />
        </View>
      </TeCard>

      {!mayAct && <NotYours why={detail.can.why} />}

      <TeCard>
        <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>What it is expected to cost</Txt>
        {!!t.estimate.travel && <KvRow label="Travel they pay" value={rs(t.estimate.travel)} />}
        {!!t.estimate.desk && <KvRow label="Tickets the Travel Desk books" value={rs(t.estimate.desk)} />}
        {!!t.estimate.hotel && <KvRow label="Hotel" value={rs(t.estimate.hotel)} />}
        {!!t.estimate.meals && <KvRow label="Food" value={rs(t.estimate.meals)} />}
        {!!t.estimate.conv && <KvRow label="Local rides" value={rs(t.estimate.conv)} />}
        <KvRow label="Total estimate" value={rs(t.estimateTotal)} tot last />
        {!!t.advance && (
          <Flag tone="warn" icon="alert" title={`An advance of ${rs(t.advance)} is asked for`} style={{ marginTop: S.md }}>
            Approving the trip releases this before the travel. It is set against the claim afterwards, and anything left over is recovered.
          </Flag>
        )}
        {!!t.why?.length && <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>Added by the workflow: {t.why.join('; ')}.</Txt>}
      </TeCard>

      <ListCard head="Journeys" headRight={String(legs.length)}>
        {legs.map((l, i) => (
          <Li key={l.id} last={i === legs.length - 1}
            left={<View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}><Txt size={12} w={700} tone="soft">{l.n}</Txt></View>}>
            <Txt size={F.small} w={700}>{pname(l.from)} → {pname(l.to)}</Txt>
            <Txt size={F.tiny} tone="muted">
              {t.scope === 'local' ? '' : `${day(l.date)} · `}{l.mode}{l.bookedBy === 'desk' ? ', Travel Desk' : ''} · {l.plannedKm} km{` · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}`}
            </Txt>
          </Li>
        ))}
      </ListCard>

      {mayAct && (
        <TeCard>
          <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Your decision</Txt>
          <Seg label="Decision" value={action} onChange={k => { setAction(k); setError('') }}
            items={[{ key: 'approve', label: 'Approve' }, { key: 'sendback', label: 'Send back' }, { key: 'reject', label: 'Reject' }]}
            style={{ marginBottom: S.md }} />
          <Input label={action === 'approve' ? 'Comment, if any' : 'What they need to know'} multiline value={comment}
            onChangeText={v => { setComment(v); setError('') }} />
          <Note>
            {action === 'approve'
              ? t.advance ? `Approves the trip and releases the ${rs(t.advance)} advance.` : 'Approves the trip. They can start its first journey on the day.'
              : action === 'sendback' ? 'Goes back for them to change and send again.'
                : 'The trip is refused. Any advance asked for is cancelled with it.'}
          </Note>
          {!!error && <ErrLine>{error}</ErrLine>}
          <DecideButton danger={action === 'reject'} busy={busy} onPress={() => void send()}
            title={busy ? 'Sending…' : action === 'approve' ? 'Approve the trip' : action === 'sendback' ? 'Send it back' : 'Reject the trip'} />
        </TeCard>
      )}
    </TeScreen>
  )
}
