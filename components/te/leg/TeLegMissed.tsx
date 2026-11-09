'use client'
// components/te/leg/TeLegMissed.tsx — a leg that was not recorded.
// Screens 69b, 69c, 69d.
//
// NOT AN EDGE CASE. A phone browser stops reading location when the screen
// locks, so "I travelled it but the app did not record it" is an ordinary
// Tuesday until a native wrapper exists. Two ways out:
//
//   without GPS  the leg happened and should be paid. The distance falls back
//                to the planned route, and the reason goes to the approver.
//   skip         the leg did not happen. Nothing is paid for it and the trip
//                can still be closed.
//
// Both need a reason, and the reason is shown to the approver — which is said
// on the screen, because a person choosing between two buttons deserves to
// know which one puts their name next to an explanation.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeLeg } from '@/lib/te/types'
import { errorText } from '@/lib/te/format'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'

/** Why the phone did not record it. The prototype's J_NOGPS. */
const NO_GPS = [
  'Forgot to start the travel',
  'Phone battery was low',
  'No network or GPS signal',
  'The app did not work',
  'Other',
]

/** Why the leg did not happen. */
const SKIP = [
  'The meeting was cancelled',
  'Someone else went instead',
  'Travelled a different way',
  'The plan changed',
  'Other',
]

export default function TeLegMissed({ snap, leg, placeName, onBack, onDone }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onBack: () => void
  onDone: (message: string) => void
}) {
  const [choice, setChoice] = useState<'' | 'nogps' | 'skip'>('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const manualAllowed = snap.cfg.track.manualAllowed !== false
  const reasons = choice === 'skip' ? SKIP : NO_GPS
  // "Other" with no explanation tells the approver nothing. This screen was
  // already the only one that asked; the shared rule adds the floor the rest
  // of the module now holds to, so "na" no longer counts as an explanation.
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
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trip</button>
        <span className="mono muted">Journey {leg.n}</span>
      </div>

      <div className="card">
        <div className="eyebrow">Journey {leg.n}</div>
        <h1 className="tname">{placeName(leg.from)} → {placeName(leg.to)}</h1>
        <p className="muted">Not recorded. {leg.plannedKm ? `${leg.plannedKm} km were planned.` : ''}</p>
      </div>

      {!choice ? (
        <div className="stack sm">
          {manualAllowed ? (
            <button type="button" className="act pri" onClick={() => { setChoice('nogps'); setReason('') }}>
              <span className="ico-b"><TeIcon name="route" /></span>
              <span>
                <b>I travelled it, but it was not recorded</b>
                <small>Paid on the planned distance{leg.plannedKm ? `, ${leg.plannedKm} km` : ''}. Your approver sees why there is no GPS.</small>
              </span>
            </button>
          ) : (
            <div className="flag warn">
              <TeIcon name="alert" />
              <div className="tx">
                <b>Your company accepts local travel only with a GPS record</b>
                <p>This journey cannot be added without one. It can be skipped, or the trip recorded again with GPS.</p>
              </div>
            </div>
          )}
          <button type="button" className="act" onClick={() => { setChoice('skip'); setReason('') }}>
            <span className="ico-b"><TeIcon name="close" /></span>
            <span>
              <b>I did not travel this journey</b>
              <small>Nothing is paid for it. The rest of the trip can still be closed and claimed.</small>
            </span>
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="ch">
            <h3>{choice === 'skip' ? 'Why was it not travelled?' : 'Why was GPS not used?'}</h3>
            <button type="button" className="btn sm" onClick={() => { setChoice(''); setReason(''); setNote('') }}>Change</button>
          </div>

          <label className="fld">
            <span>Reason</span>
            <select value={reason} onChange={e => { setReason(e.target.value); setError('') }}>
              <option value="">Choose a reason</option>
              {reasons.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {needsNote ? (
            <>
              <label className="fld">
                <span>{whyLabel('journey').label}</span>
                <textarea
                  autoFocus
                  value={note}
                  placeholder="The tracking screen would not open on my phone"
                  onChange={e => { setNote(e.target.value); setError('') }}
                />
                <small>{whyLabel('journey').hint}</small>
              </label>
              {note.trim() && noteProblem ? <div className="ferr"><TeIcon name="warn" size="sm" />{noteProblem}</div> : null}
            </>
          ) : (
            <label className="fld">
              <span>Anything to add</span>
              <input
                value={note}
                placeholder="Optional"
                onChange={e => { setNote(e.target.value); setError('') }}
              />
            </label>
          )}

          <div className="note">
            <TeIcon name="info" size="sm" />
            <span>
              {choice === 'skip'
                ? 'The journey is marked as not travelled and nothing is paid for it.'
                : `The journey is paid on its planned distance${leg.plannedKm ? ` of ${leg.plannedKm} km` : ''} rather than a recorded one. Your approver sees this reason on the claim.`}
            </span>
          </div>

          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

          <button type="button" className="btn pri wide" disabled={!ready || busy} onClick={go}>
            {busy ? 'Saving…' : choice === 'skip' ? 'Skip this journey' : 'Add it without GPS'}
          </button>
        </div>
      )}
    </div>
  )
}

/** The skip API takes one string, so "Other" needs its note folded in or the
 *  approver reads the word "Other" and nothing else. */
function fullReason(reason: string, note: string): string {
  const extra = note.trim()
  return extra ? `${reason}: ${extra}` : reason
}
