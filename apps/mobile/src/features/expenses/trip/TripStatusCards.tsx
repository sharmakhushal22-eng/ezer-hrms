// src/features/expenses/trip/TripStatusCards.tsx — the cards near the top of a trip
// that change with `trip.display` (components/te/trip/TeTripDetail.tsx):
//   Approval (53, 68) · Request expired (69e) · Not travelled on … (69a)
//   Ready / on the way (52, 54, 61) · Recorded after travel draft (39, 39b)
//   Close every journey · Claim for this trip (65)
// Each is a module-level component (the repo's focus-loss rule); the form ones
// keep their own typing state.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { TeLeg } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { needsExplanation, whyLabel, whyProblem } from '@web/te/other-reason'
import { day, plural } from '../api'
import { initialsOf } from '../data'
import { modeIcon } from '../tones'
import { TeIcon } from '../ui/TeIcon'
import { Chip, FieldErr, TeCard } from '../ui/kit'
import { Act, CardHead, IcoB } from './parts'
import { LEG_STATE, NO_GPS, STEP_TONE, STEP_WORD } from './words'
import type { TripView } from './view'

export type Busy = '' | 'answer' | 'missed' | 'cancel' | 'delete'

// ── waiting, or sent back with a question ── (53, 68)
export function ApprovalCard({ v, busy, onEdit, onAnswer }: {
  v: TripView; busy: Busy; onEdit: () => void; onAnswer: (text: string) => Promise<boolean>
}) {
  const { C } = useTheme()
  const { t, st, chip, mine, detail } = v
  const [answer, setAnswer] = React.useState('')
  const [more, setMore] = React.useState(false)
  return (
    <TeCard>
      <CardHead title="Approval" right={<Chip label={chip.label} tone={chip.tone} />} />
      <View style={{ gap: S.sm }}>
        {(t.chain ?? []).map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={11} w={700} tone="brand">{initialsOf(s.whoName || s.role)}</Txt>
            </View>
            <Txt size={F.small} style={{ flex: 1 }}>
              <Txt size={F.small} w={700}>{s.whoName || s.role}</Txt> <Txt size={F.tiny} tone="muted">{s.role}</Txt>
            </Txt>
            {/* Four outcomes, not two (TeTripDetail STEP_WORD / STEP_TONE). */}
            <Chip label={STEP_WORD[s.status] ?? 'Pending'} tone={STEP_TONE[s.status] ?? 't-warn'} />
          </View>
        ))}
      </View>
      {t.why?.length ? <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>{`Added by the workflow: ${t.why.join('; ')}.`}</Txt> : null}

      {st === 'SENT_BACK' && mine ? (
        <View style={{ marginTop: S.md, gap: S.sm }}>
          {detail.messages.length ? (
            <View style={{ gap: 8 }}>
              {detail.messages.map((m, i) => (
                <View key={i} style={{ backgroundColor: C.sunken, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, maxWidth: '90%', alignSelf: 'flex-start' }}>
                  <Txt size={F.tiny} tone="muted">{`${m.name} asked`}</Txt>
                  <Txt size={F.small}>{m.text}</Txt>
                </View>
              ))}
            </View>
          ) : null}
          <Button full title="Edit the plan and send again" icon={<TeIcon name="back" size="sm" color={C.onAccent} />} onPress={onEdit} />
          <Pressable onPress={() => setMore(x => !x)} accessibilityRole="button" accessibilityState={{ expanded: more }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 }}>
            <View style={{ transform: [{ rotate: more ? '90deg' : '0deg' }] }}><TeIcon name="rightc" size="sm" color={C.brand} /></View>
            <Txt size={F.small} w={600} tone="brand">Answer without changes</Txt>
          </Pressable>
          {more ? (
            <View>
              <Input label="Your answer" multiline value={answer} onChangeText={setAnswer} placeholder="Explain what your approver asked about" />
              <Button full variant="outline" title={busy === 'answer' ? 'Sending…' : 'Send the answer'}
                disabled={!answer.trim() || busy === 'answer'}
                onPress={() => void onAnswer(answer.trim()).then(ok => { if (ok) setAnswer('') })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </TeCard>
  )
}

// ── the dates passed before anybody approved it ── (69e)
export function ExpiredCard() {
  return (
    <TeCard>
      <CardHead title="Request expired" right={<Chip label="Expired" tone="t-crit" />} />
      <Txt size={F.tiny} tone="muted">The trip dates passed before it was approved, so it can no longer be approved or booked.</Txt>
    </TeCard>
  )
}

// ── the day came and went with no journey started ── (69a)
export function MissedCard({ v, busy, onRecord }: { v: TripView; busy: Busy; onRecord: (reason: string, note?: string) => void }) {
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [picking, setPicking] = React.useState(false)
  return (
    <TeCard>
      <CardHead title={`Not travelled on ${day(v.t.start)}`} right={<Chip label="Missed" tone="t-warn" />} />
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>No journey was started on the day, so there is no GPS record.</Txt>
      <PickerField label="Why was GPS not used?" value={reason} placeholder="Choose a reason" onPress={() => setPicking(true)} />
      {/* Appears on picking Other; the button stays disabled until it says something. */}
      {needsExplanation(reason) ? (
        <>
          <Input label={whyLabel('gps').label} multiline autoFocus value={note} onChangeText={setNote}
            placeholder="The tracking screen would not open on my phone" help={whyLabel('gps').hint} />
          {note.trim() && whyProblem(reason, note) ? <View style={{ marginBottom: S.md }}><FieldErr>{whyProblem(reason, note)}</FieldErr></View> : null}
        </>
      ) : null}
      <Button full title={busy === 'missed' ? 'Recording…' : 'Record the journeys without GPS'}
        disabled={!reason || !!whyProblem(reason, note) || busy === 'missed'} onPress={() => onRecord(reason, note.trim() || undefined)} />
      <SelectSheet visible={picking} onClose={() => setPicking(false)} title="Why was GPS not used?" searchable={false}
        value={reason} onPick={setReason} options={NO_GPS.map(r => ({ value: r, label: r }))} />
    </TeCard>
  )
}

/** The label of the open-leg button on the ready card. */
function nextLegLabel(l: TeLeg, today: string) {
  return l.status === 'PLANNED' && l.date <= today
    ? (l.gps === 'checkin' ? 'Check in and go' : 'Start this journey')
    : l.status === 'ENDED' ? 'Save the journey report' : 'Open the journey'
}

// ── ready to go, or on the way ── (52, 54, 61)
export function ReadyCard({ v, busy, onOpenLeg, onEdit, onCancel }: {
  v: TripView; busy: Busy; onOpenLeg: (l: TeLeg) => void; onEdit: () => void; onCancel: () => void
}) {
  const { C } = useTheme()
  const { t, st, legs, chip, nextLeg, today, pname, started, mine } = v
  const future = !!t.start && t.start > today
  const title = legs.some(l => l.status === 'ACTIVE' || l.status === 'PAUSED') ? 'On the road'
    : st === 'ONGOING' ? 'Next journey'
      : future ? `Starts ${day(t.start)}`
        : 'Ready to go'
  return (
    <TeCard>
      <CardHead title={title} right={<Chip label={chip.label} tone={chip.tone} />} />
      {nextLeg ? (
        <View style={{ gap: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <IcoB name={modeIcon(nextLeg.mode)} sm />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.small} w={700}>{`Journey ${nextLeg.n}: ${pname(nextLeg.from)} → ${pname(nextLeg.to)}`}</Txt>
              <Txt size={F.tiny} tone="muted">{`${nextLeg.mode} · ${nextLeg.plannedKm} km · ${nextLeg.gps === 'checkin' ? 'check-ins' : 'GPS'}`}</Txt>
            </View>
          </View>
          <Button full title={nextLegLabel(nextLeg, today)} icon={<TeIcon name="play" size="sm" color={C.onAccent} />} onPress={() => onOpenLeg(nextLeg)} />
        </View>
      ) : null}
      {future ? <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>{`The first journey can start on ${day(t.start)}.`}</Txt> : null}

      {/* Once a journey has been travelled the plan is history, not a draft. */}
      {!started && mine ? (
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
          {!(t.chain ?? []).length ? <Button style={{ flex: 1 }} size="sm" variant="outline" title="Change the plan" onPress={onEdit} /> : null}
          <Button style={{ flex: 1 }} size="sm" variant="danger" title={busy === 'cancel' ? 'Working…' : 'Cancel trip'} disabled={!!busy} onPress={onCancel} />
        </View>
      ) : null}
    </TeCard>
  )
}

// ── recorded after travel, still a draft ── (39, 39b)
export function DraftCard({ busy, onEdit, onDelete }: { busy: Busy; onEdit: () => void; onDelete: () => void }) {
  return (
    <TeCard>
      <CardHead title="Recorded after travel" right={<Chip label="Draft" tone="t-info" />} />
      <Txt size={F.tiny} tone="muted">Open each journey to add its fare, add your other bills, and submit. A draft that is not needed can be deleted.</Txt>
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
        <Button style={{ flex: 1 }} size="sm" variant="outline" title="Edit the trip" onPress={onEdit} />
        <Button style={{ flex: 1 }} size="sm" variant="danger" title={busy === 'delete' ? 'Working…' : 'Delete draft'} disabled={!!busy} onPress={onDelete} />
      </View>
    </TeCard>
  )
}

// ── back, with journeys still owing a report ──
export function CloseEveryCard({ v, onOpenLeg }: { v: TripView; onOpenLeg: (l: TeLeg) => void }) {
  const { openLegs, pname } = v
  return (
    <TeCard>
      <CardHead title="Close every journey" right={<Chip plain tone="t-warn" label={`${plural(openLegs.length, 'journey')} open`} />} />
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>The claim goes once each journey has its report, was added without GPS, or was skipped.</Txt>
      <View style={{ gap: S.sm }}>
        {openLegs.map(l => (
          <Act key={l.id} flat icon={modeIcon(l.mode)} title={`Journey ${l.n}: ${pname(l.from)} → ${pname(l.to)}`}
            note={LEG_STATE[l.status] ?? l.status} onPress={() => onOpenLeg(l)} />
        ))}
      </View>
    </TeCard>
  )
}

// ── back, every journey closed: the claim is what is left ── (65)
export function ClaimCard({ onClaim }: { onClaim: () => void }) {
  const { C } = useTheme()
  return (
    <TeCard>
      <CardHead title="Claim for this trip" right={<Chip plain tone="t-brand" label="Every journey is closed" />} />
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>Check what each line is worth, add any other bills, and send it.</Txt>
      <Button full title="Review and submit the claim" icon={<TeIcon name="go" size="sm" color={C.onAccent} />} onPress={onClaim} />
    </TeCard>
  )
}
