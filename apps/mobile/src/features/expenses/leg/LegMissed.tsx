// src/features/expenses/leg/LegMissed.tsx — a journey that was not recorded
// (components/te/leg/TeLegMissed.tsx, screens 69b-d): "I travelled it, but it was
// not recorded" (no-gps, paid on the planned distance) or "I did not travel this
// journey" (skip). "Other" needs a real explanation (lib/te/other-reason whyProblem).
//
// Also LegDone: the read-only summary for a SUBMITTED / SKIPPED / CANCELLED journey.
// The website sends those legs to TeLegMissed, whose actions the server always
// refuses (spec Part 4 "Reachability defect"); the spec's RN fix is a summary.
import * as React from 'react'
import { View } from 'react-native'
import { needsExplanation, whyLabel, whyProblem } from '@web/te/other-reason'
import type { Snapshot, TeLeg } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, te, when } from '../api'
import { Chip, FieldErr, Flag, KvRow, Note, TeCard } from '../ui/kit'
import { SelectField } from '../plan/parts'
import { Act, CardHead } from '../trip/parts'
import { NO_GPS, SKIP, LEG_STATE } from '../trip/words'
import { LegHead } from './LegHead'

/** The skip API takes one string, so "Other" needs its note folded in. */
function fullReason(reason: string, note: string): string {
  const extra = note.trim()
  return extra ? `${reason}: ${extra}` : reason
}

export function LegMissed({ snap, leg, placeName, onDone }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onDone: (message: string) => void
}) {
  const [choice, setChoice] = React.useState<'' | 'nogps' | 'skip'>('')
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const manualAllowed = snap.cfg.track.manualAllowed !== false
  const reasons = choice === 'skip' ? SKIP : NO_GPS
  const needsNote = needsExplanation(reason)
  const noteProblem = whyProblem(reason, note)
  const ready = !!reason && !noteProblem

  async function go() {
    setBusy(true); setError('')
    try {
      if (choice === 'skip') {
        await te.legSkip(leg.id, fullReason(reason, note))
        onDone(`Journey ${leg.n} skipped.`)
      } else {
        await te.legNoGps(leg.id, reason, note.trim() || undefined)
        onDone(`Journey ${leg.n} added without GPS. Add its fare next.`)
      }
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  return (
    <View>
      <LegHead eyebrow={`Journey ${leg.n}`} title={`${placeName(leg.from)} → ${placeName(leg.to)}`}
        sub={`Not recorded. ${leg.plannedKm ? `${leg.plannedKm} km were planned.` : ''}`.trim()} />

      {!choice ? (
        <View style={{ gap: S.sm }}>
          {manualAllowed ? (
            <Act pri icon="route" title="I travelled it, but it was not recorded"
              note={`Paid on the planned distance${leg.plannedKm ? `, ${leg.plannedKm} km` : ''}. Your approver sees why there is no GPS.`}
              onPress={() => { setChoice('nogps'); setReason('') }} />
          ) : (
            <Flag tone="warn" title="Your company accepts local travel only with a GPS record">
              This journey cannot be added without one. It can be skipped, or the trip recorded again with GPS.
            </Flag>
          )}
          <Act icon="close" title="I did not travel this journey"
            note="Nothing is paid for it. The rest of the trip can still be closed and claimed."
            onPress={() => { setChoice('skip'); setReason('') }} />
        </View>
      ) : (
        <TeCard>
          <CardHead title={choice === 'skip' ? 'Why was it not travelled?' : 'Why was GPS not used?'}
            right={<Button size="sm" variant="outline" title="Change" onPress={() => { setChoice(''); setReason(''); setNote('') }} />} />
          <SelectField label="Reason" value={reason} placeholder="Choose a reason" onPick={v => { setReason(v); setError('') }}
            options={reasons.map(r => ({ value: r, label: r }))} />
          {needsNote ? (
            <>
              <Input label={whyLabel('journey').label} multiline autoFocus value={note} help={whyLabel('journey').hint}
                placeholder="The tracking screen would not open on my phone" onChangeText={t => { setNote(t); setError('') }} />
              {note.trim() && noteProblem ? <View style={{ marginBottom: S.md }}><FieldErr>{noteProblem}</FieldErr></View> : null}
            </>
          ) : (
            <Input label="Anything to add" value={note} placeholder="Optional" onChangeText={t => { setNote(t); setError('') }} />
          )}
          <Note style={{ marginBottom: S.md }}>
            {choice === 'skip'
              ? 'The journey is marked as not travelled and nothing is paid for it.'
              : `The journey is paid on its planned distance${leg.plannedKm ? ` of ${leg.plannedKm} km` : ''} rather than a recorded one. Your approver sees this reason on the claim.`}
          </Note>
          {error ? <View style={{ marginBottom: S.md }}><FieldErr>{error}</FieldErr></View> : null}
          <Button full title={busy ? 'Saving…' : choice === 'skip' ? 'Skip this journey' : 'Add it without GPS'}
            disabled={!ready || busy} onPress={() => void go()} />
        </TeCard>
      )}
    </View>
  )
}

/** A closed journey, read-only. */
export function LegDone({ snap, leg, placeName }: { snap: Snapshot; leg: TeLeg; placeName: (id: string) => string }) {
  const modeName = snap.cfg.modes.find(m => m.id === leg.mode)?.name ?? leg.mode
  const s = leg.stats
  return (
    <View>
      <LegHead eyebrow={`Journey ${leg.n}`} title={`${placeName(leg.from)} → ${placeName(leg.to)}`}
        sub={`${modeName}${leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}`}
        chips={<>
          <Chip plain label={LEG_STATE[leg.status] ?? leg.status} />
          {leg.manual ? <Chip plain tone="t-warn" label="Added without GPS" /> : null}
        </>} />
      <TeCard>
        <CardHead title="What was recorded" />
        {leg.plannedKm ? <KvRow label="Planned" value={`${leg.plannedKm} km`} /> : null}
        {s ? <KvRow label="GPS distance" value={`${Math.round(s.gpsKm * 10) / 10} km`} /> : null}
        {s ? <KvRow label="Paid on" value={`${Math.round(s.payBase * 10) / 10} km`} /> : null}
        {s && s.dur ? <KvRow label="Time on the road" value={`${s.dur} min`} /> : null}
        {leg.noGps ? <KvRow label="Why no GPS" value={leg.noGps} /> : null}
        {leg.skipReason ? <KvRow label="Why it was skipped" value={leg.skipReason} /> : null}
        {leg.payKm ? <KvRow label="Payable distance" value={`${leg.payKm} km`} last /> : null}
        {!s && !leg.noGps && !leg.skipReason && !leg.plannedKm ? <Txt size={F.tiny} tone="muted">Nothing more to show for this journey.</Txt> : null}
      </TeCard>
    </View>
  )
}
