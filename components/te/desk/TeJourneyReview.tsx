'use client'
// components/te/desk/TeJourneyReview.tsx — recorded journeys, and the two
// things a desk can do about one.
//
// THIS IS WHERE A GPS SUB-TRIP BECOMES VISIBLE. A journey added during a trip —
// land in Mumbai, add a journey to the client office, record it, add another —
// could never appear in the booking queue: that list only shows a leg while it
// is still unstarted AND desk-booked, and an added journey is always
// self-booked. So until migration 180 the only human who ever saw one was an
// approver, bundled inside a claim, weeks later.
//
// WHAT A REVIEWER IS ACTUALLY ASKED. Not "is this correct" — the engine's
// twelve journey checks already run on the claim and say what they think. The
// question here is narrower and more human: does this route look like the
// journey somebody says they made. Hence the map, the two ends with how far off
// the named places they were, and the handful of absences in evidenceNotes.
// Everything on this screen is a fact; none of it is a verdict.
//
// CONFIRMING PAYS NOTHING. The money is the claim's, settled by the approval
// chain and by Finance on the claim. Sending one back does exactly one thing
// beyond recording the question: it holds that trip's claim, because letting it
// through would ask the approver to sign off the very thing just queried.
//
// WHO MUST CONFIRM IS THE COMPANY'S SETTING, and both desks read the same list.
// The button each sees comes from canConfirm(), which mirrors te_leg_confirm
// refusal for refusal — so a desk that is not a gate is told so, and told it
// can still ask a question, rather than pressing a button that 409s.
import { useMemo, useState } from 'react'
import { te, TeApiError, type DeskJourney } from '@/lib/te/client'
import type { DeskKind } from '@/lib/te/desks'
import {
  canConfirm, canSendBack, confirmPolicy, evidenceNotes, reviewState, reviewTone,
} from '@/lib/te/journey-review'
import { journeyBuckets } from '@/lib/te/desk-buckets'
import { errorText, plural, rs } from '@/lib/te/format'
import TeContact from '../TeContact'
import TeIcon from '../TeIcon'
import TeRouteMap from '../TeRouteMap'

/** How a mode is paid, which decides whether a missing bill matters. Mirrors
 *  te_modes.basis; passed in by the caller from the snapshot so this component
 *  does not have to carry a copy of the mode table. */
export type ModeBasis = (mode: string) => string | undefined

const whenOf = (d: string | null): string => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return ''
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getUTCMonth()]
  return `${t.getUTCDate()} ${mon}`
}

/** Metres off the named place, in the words a desk reads. Under the GPS's own
 *  error there is nothing to say, so nothing is said. */
const offBy = (m: number | null): string => {
  const n = Number(m ?? 0)
  if (!Number.isFinite(n) || n < 50) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km off` : `${Math.round(n)} m off`
}

function OneJourney({ j, desk, basisOf, onOpenTrip, onDone, onToast }: {
  j: DeskJourney
  desk: DeskKind
  basisOf: ModeBasis
  onOpenTrip?: (tripId: string) => void
  onDone: () => void
  onToast: (s: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The row carries the columns; the shared logic wants the nested shape the
  // snapshot uses. One place that maps between them.
  const review = useMemo(() => ({
    deskAt: j.desk_confirmed_at, deskBy: j.desk_confirmed_by, deskName: null,
    finAt: j.fin_confirmed_at, finBy: j.fin_confirmed_by, finName: null,
    backAt: j.sent_back_at, backBy: j.sent_back_by, backName: null,
    backDesk: j.sent_back_desk, backWhy: j.sent_back_reason, answer: j.review_answer,
  }), [j])

  const policy = confirmPolicy(j.confirm_policy)
  const state = reviewState(review, policy)
  const tone = reviewTone(state)
  // The view only ever holds SUBMITTED journeys, but the gate is asked properly
  // rather than assumed: this component is the one that would be wrong if the
  // view ever widened.
  const mayConfirm = canConfirm({ desk, policy, status: 'SUBMITTED', review })
  const mayAsk = canSendBack({ status: 'SUBMITTED', review })
  const notes = evidenceNotes({
    routeLine: j.route_polyline, manual: j.is_manual, noGps: j.no_gps_reason,
    gpsPoints: j.gps_points, mode: j.mode, fileCount: j.file_count, basis: basisOf(j.mode),
  })

  async function act(what: 'confirm' | 'back') {
    setBusy(true); setError('')
    try {
      if (what === 'confirm') {
        await te.legConfirm(j.leg_id, desk)
        onToast(`Journey ${j.leg_no} of ${j.trip_no} confirmed.`)
      } else {
        await te.legSendBack(j.leg_id, desk, reason.trim())
        onToast(`Journey ${j.leg_no} of ${j.trip_no} was sent back.`)
      }
      setAsking(false); setReason('')
      onDone()
    } catch (e) {
      setError(e instanceof TeApiError ? e.message : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const km = j.gps_km ?? j.planned_km
  return (
    <div className={`jrev${state === 'back' ? ' back' : state === 'done' ? ' done' : ''}`}>
      <div className="jrev-head">
        <div className="grow">
          <div className="jrev-route">
            {j.from_name || 'Somewhere'} → {j.to_name || 'somewhere'}
          </div>
          <div className="small muted">
            {j.full_name || 'Unknown'} {j.emp_code ? <span className="mono">{j.emp_code}</span> : null}
            {' · '}
            {/* The trip number is the trip's identity, so it is the way into
                it: one journey is rarely the whole question a reviewer has. */}
            {onOpenTrip ? (
              <button type="button" className="link small" onClick={() => onOpenTrip(j.trip_id)}
                title="Everything on this trip: the tickets, the stay, the food and every journey">
                {j.trip_no}
              </button>
            ) : j.trip_no}
            {' · '}{whenOf(j.leg_date)} · {j.mode}
          </div>
        </div>
        <span className={`chip ${tone.tone === 'ok' ? 't-pos' : tone.tone === 'bad' ? 't-crit' : tone.tone === 'warn' ? 't-warn' : 'plain'}`}>
          {tone.text}
        </span>
      </div>

      <div className="jrev-facts">
        {/* A sub-trip is named as one. A desk reading a list of journeys needs
            to know which were planned and which were decided on the spot. */}
        {j.is_subtrip ? <span className="chip plain">Local sub-trip</span> : null}
        {km ? <span className="chip plain">{km} km</span> : null}
        {j.payable_km != null && j.gps_km != null && j.payable_km < j.gps_km
          ? <span className="chip t-warn" title="The engine capped the payable distance">{j.payable_km} km payable</span>
          : null}
        {j.claimed != null && j.claimed > 0 ? <span className="chip plain">{rs(j.claimed)}</span> : null}
        {j.file_count > 0 ? <span className="chip t-pos"><TeIcon name="file" size="sm" />{plural(j.file_count, 'bill')}</span> : null}
        {offBy(j.start_off_m) ? <span className="chip plain" title="Where the journey was started, against the place named">Start {offBy(j.start_off_m)}</span> : null}
        {offBy(j.end_off_m) ? <span className="chip plain" title="Where the journey was ended, against the place named">End {offBy(j.end_off_m)}</span> : null}
      </div>

      {j.added_reason ? <p className="small">Added during the trip: {j.added_reason}</p> : null}

      {notes.map(n => (
        <div key={n} className="note"><TeIcon name="info" size="sm" /><span>{n}</span></div>
      ))}

      <TeRouteMap
        line={j.route_polyline}
        start={j.start_lat != null && j.start_lng != null ? { lat: Number(j.start_lat), lng: Number(j.start_lng), label: j.from_name || 'Start' } : null}
        end={j.end_lat != null && j.end_lng != null ? { lat: Number(j.end_lat), lng: Number(j.end_lng), label: j.to_name || 'End' } : null}
        km={km}
        label={`Recorded route of journey ${j.leg_no} of ${j.trip_no}`}
      />

      {/* How to reach the traveller about it — the same contact the rest of the
          desk uses, read off the trip rather than their HR record. */}
      <TeContact who={j} />

      {j.sent_back_at ? (
        <div className="flag crit">
          <TeIcon name="warn" />
          <div className="tx">
            <b>Sent back to the traveller</b>
            <p>{j.sent_back_reason}</p>
          </div>
        </div>
      ) : null}
      {j.review_answer ? (
        <div className="note"><TeIcon name="info" size="sm" /><span>The traveller answered: {j.review_answer}</span></div>
      ) : null}

      {error ? <div className="flag crit" role="alert"><TeIcon name="warn" size="sm" /><span>{error}</span></div> : null}

      {asking ? (
        <div className="jrev-ask">
          <label className="fld full">
            <span>What do you want the traveller to do?</span>
            <textarea
              autoFocus
              value={reason}
              placeholder="The route stops short of the client office — did you walk the last part, or is the end point wrong?"
              onChange={e => setReason(e.target.value)}
            />
            <small>They see this, and the trip&rsquo;s claim waits until they answer.</small>
          </label>
          <div className="row tight">
            <button type="button" className="btn pri" disabled={busy || !reason.trim()} onClick={() => act('back')}>
              {busy ? 'Sending…' : 'Send it back'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setAsking(false); setReason(''); setError('') }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row tight">
          {mayConfirm.ok ? (
            <button type="button" className="btn pri" disabled={busy} onClick={() => act('confirm')}>
              {busy ? 'Saving…' : 'Confirm it happened'}
            </button>
          ) : (
            // The reason is shown rather than the button being silently absent:
            // a desk member who cannot act should know why, especially when the
            // answer is "the other desk has not looked yet".
            <span className="small muted">{mayConfirm.why}</span>
          )}
          {mayAsk.ok ? (
            <button type="button" className="btn" disabled={busy} onClick={() => setAsking(true)}>
              <TeIcon name="warn" size="sm" />Ask the traveller
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function TeJourneyReview({ rows, desk, basisOf, onOpenTrip, onDone, onToast }: {
  rows: DeskJourney[]
  /** Which desk the reader is sitting at. Decides which confirmation the
   *  buttons offer, never what they can see: both desks read the same list. */
  desk: DeskKind
  basisOf: ModeBasis
  /** Open the whole trip behind a journey. */
  onOpenTrip?: (tripId: string) => void
  onDone: () => void
  onToast: (s: string) => void
}) {
  // GATHERED UNDER THE TRIP THEY BELONG TO. A trip's journeys are the trip —
  // leg 1 out, a sub-trip across the city, leg 2 home — and flat they were
  // scattered: sorted by urgency across every trip, two sub-trips of the same
  // trip could sit ten rows apart with other people's journeys between them,
  // and a reviewer asking "does this trip hang together" had to reassemble it
  // by eye from the trip number on each row.
  //
  // The ordering rule lives in lib/te/desk-buckets so that the order of the
  // buckets and the order of the rows inside one cannot drift apart: sent back
  // first (it is holding a claim), then unlooked-at, then agreed; and within a
  // trip, journey order once urgency ties, because a trip reads as a sequence.
  const buckets = useMemo(() => journeyBuckets(rows, desk), [rows, desk])

  if (!rows.length) {
    return (
      <div className="empty">
        <span className="ico-b"><TeIcon name="route" /></span>
        <b>No journeys to look at</b>
        <p>Recorded journeys appear here once a traveller has reported them, including the local sub-trips they add while they are away.</p>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="note">
        <TeIcon name="info" size="sm" />
        <span>
          Confirming records that you looked and agreed; it pays nothing. Asking the traveller a question holds that
          trip&rsquo;s claim until they answer.
        </span>
      </div>
      {buckets.map(b => (
        <div key={b.tripId} className="jbucket">
          <div className="jb-head">
            <div className="grow">
              {/* The number is the bucket: everything under it belongs to this
                  trip, and it opens the whole record. */}
              {onOpenTrip ? (
                <button
                  type="button"
                  className="tripno"
                  onClick={() => onOpenTrip(b.tripId)}
                  title={`Open ${b.tripNo} — every journey, bill, stay and what it has cost`}
                >
                  {b.tripNo}
                </button>
              ) : <span className="mono">{b.tripNo}</span>}
              <div className="b">{b.tripName || 'A trip'}</div>
              <div className="small muted">
                {b.who || 'A traveller'}{b.empCode ? <> · <span className="mono">{b.empCode}</span></> : null}
                {' · '}{plural(b.journeys.length, 'journey')}
                {b.subTrips ? <> · {b.subTrips === 1 ? 'one a sub-trip' : `${b.subTrips} sub-trips`}</> : null}
              </div>
            </div>
            {/* The two facts a reviewer sorts by, said on the bucket so the
                trip can be triaged without opening every journey in it. */}
            {b.sentBack ? <span className="chip t-crit">{b.sentBack} sent back</span> : null}
            {b.waiting
              ? <span className="chip t-warn">{b.waiting} to confirm</span>
              : <span className="chip plain t-pos">All confirmed</span>}
          </div>
          <div className="stack">
            {b.journeys.map(j => (
              <OneJourney key={j.leg_id} j={j} desk={desk} basisOf={basisOf} onOpenTrip={onOpenTrip} onDone={onDone} onToast={onToast} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
