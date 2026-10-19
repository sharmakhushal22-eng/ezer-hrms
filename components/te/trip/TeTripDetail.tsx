'use client'
// components/te/trip/TeTripDetail.tsx — one trip, and what it needs next.
// Screens 18, 39b, 52, 53, 54, 61, 64, 68, 69a, 69e.
//
// One screen serves every state a trip can be in, because they are the same
// trip. What changes is the card at the top: a plan waiting for approval shows
// the chain, one sent back shows the question, one whose day passed with no
// leg started asks why, and an approved one offers its next leg.
//
// `trip.display` decides which — the server worked it out. This file chooses
// which card that state gets and what the card says.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeCategory, TeLeg, TeMasters, TeTripDetail as TripDetail, TripScope, Uuid } from '@/lib/te/types'
import { tripChip } from '@/lib/te/trips-list'
import { canBillTrip, coTravellerNote, isCoTraveller, myClaims, withText } from '@/lib/te/co-traveller'
import { foodBalance, foodBalanceText, foodBudget, foodSpent, stayDecisionText } from '@/lib/te/trip-stay'
import { day, dayAt, errorText, plural, rs, when } from '@/lib/te/format'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'
import TeStayRequest from './TeStayRequest'
import TeTripMap from '../plan/TeTripMap'
import TeJourneyAnswer from '../leg/TeJourneyAnswer'
import TeTripLedger from './TeTripLedger'
import TeTripPlan from './TeTripPlan'
import TeMapLinks from '../plan/TeMapLinks'
import type { MapPlace } from '@/lib/te/trip-map'

const SCOPE_WORD: Record<TripScope, string> = { local: 'Local', domestic: 'Domestic', international: 'International' }
const PATTERN_WORD: Record<string, string> = { oneway: 'One way', round: 'Round trip', multi: 'Multi-city' }
const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}
const LEG_KIND: Record<string, string> = {
  first: 'to the airport or station',
  last: 'from the airport or station',
  extra: 'added during the trip',
}
const NO_GPS = ['Forgot to start the travel', 'Phone battery was low', 'No network or GPS signal', 'The app did not work', 'Other']

/** What a leg is doing, in the employee's words. */
const LEG_STATE: Record<string, string> = {
  PLANNED: 'Not started', ACTIVE: 'On the road', PAUSED: 'Stopped',
  ENDED: 'Ended, report to save', SUBMITTED: 'Done', SKIPPED: 'Skipped', CANCELLED: 'Cancelled',
}

/** What each approval step's status is called, and how it is coloured. An
 *  'auto' step was passed by the workflow itself rather than by a person. */
const STEP_WORD: Record<string, string> = {
  approved: 'Approved', auto: 'Approved automatically', pending: 'Pending',
  rejected: 'Rejected', sent_back: 'Sent back', cancelled: 'Cancelled',
}
const STEP_TONE: Record<string, string> = {
  approved: 't-brand', auto: 't-brand', pending: 't-warn',
  rejected: 't-crit', sent_back: 't-warn', cancelled: 'plain',
}

export default function TeTripDetail({ tripId, me, today, masters, everyone, cats, onBack, onChanged, onEdit, onOpenClaim, onOpenLeg, onAddLeg, onAddBill, onClaim }: {
  tripId: Uuid
  /** snap.masters — only so the plan can name the airport or station the
   *  company has configured for a city, when the traveller did not pick one.
   *  "The company's airport" is not an answer a desk can buy a ticket from. */
  masters?: TeMasters
  /** The viewer. A trip can now be opened by somebody who did not plan it, so
   *  "whose claim is this" and "whose trip is this" are no longer the same
   *  question and the screen has to be told which one it is looking at. */
  me: Uuid
  today: string
  onBack: () => void
  onChanged: (message: string) => void
  /** Opens the planner on this trip. */
  onEdit: (detail: TripDetail) => void
  onOpenClaim: (claimId: Uuid) => void
  /** Opens a leg: recording it, reporting on it, or saying it was not recorded.
   *  Which of the three is the leg's own state, so the trip screen only says
   *  which leg. */
  onOpenLeg: (leg: TeLeg) => void
  /** Add a leg the plan did not have. Only while the trip is under way. */
  onAddLeg: (detail: TripDetail) => void
  /** Whether this reader may see EVERY traveller's spend on the trip, not just
   *  their own: a desk member, Finance, or an administrator. Off by default,
   *  because the person reading a trip is usually the person on it, and what a
   *  colleague was reimbursed is not theirs to see. */
  everyone?: boolean
  /** cfg.cats — the company's own category names and groups, for the ledger. */
  cats?: TeCategory[]
  /** Open the bill form against this trip. Straight to the form rather than
   *  via the claim screen: a hotel or a meal is a trip-only category, and this
   *  is the only place in the product either can be entered. */
  onAddBill: (tripId: Uuid) => void
  /** The claim for this trip: its lines, what they are worth, and submit. */
  onClaim: (detail: TripDetail) => void
}) {
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [answer, setAnswer] = useState('')
  const [missedReason, setMissedReason] = useState('')
  const [missedNote, setMissedNote] = useState('')
  const [confirming, setConfirming] = useState<'cancel' | 'delete' | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let current = true
    te.trip(tripId)
      .then(d => { if (current) { setDetail(d); setError('') } })
      .catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [tripId, tick])

  if (!detail) {
    return (
      <div className="page">
        <div className="row"><button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trips</button></div>
        <div className="card"><p className="muted">{error || 'Loading the trip…'}</p>
          {error ? <button type="button" className="btn sm" onClick={reload}>Try again</button> : null}
        </div>
      </div>
    )
  }

  const t = detail.trip
  const st = t.display
  // Asking only makes sense on your own trip, and only while there is still a
  // trip to book for. The SQL refuses the rest (te_booking_request); this is
  // about not offering a button that is going to be turned down.
  const canAskStay = !!detail.can?.own && !['CANCELLED', 'REJECTED', 'CLAIMED', 'CLOSED'].includes(t.status)
  const legs = [...detail.legs].sort((a, b) => a.n - b.n)
  const chip = tripChip(t)
  const pname = (id: string) => detail.places[id]?.s ?? ''
  const places = new Map<string, MapPlace>(
    Object.entries(detail.places).map(([id, p]) => [id, { id, s: p.s, lat: p.lat, lng: p.lng }]),
  )
  const started = legs.some(l => l.startedAt || l.manual)
  // `can.act` on a trip means "may this viewer APPROVE it" — the read model is
  // explicit that the owner is excluded. This is the employee's own screen, so
  // the guard for cancelling, editing and answering is `can.own`.
  const mine = detail.can.own
  // Taken along on somebody else's trip. `can.own` is already false for them,
  // so every owner-only action below hides itself; what is missing is the part
  // the server cannot supply — saying why the screen looks like that, and
  // leaving open the one thing that IS theirs: their own bills.
  const note = coTravellerNote(t, me, detail.employee.name)
  const riding = isCoTraveller(t, me)
  // "With Asha Rao and 2 others" — who else is on it, whoever is reading.
  const withWho = withText(t, me)
  const canBill = canBillTrip(t, me)
  // What the Travel Desk answered about the hotels, if it has yet.
  const decided = stayDecisionText(t.stay)
  // detail.expenses is every line on the trip, everyone's, so it has to be
  // narrowed to mine before anything is counted or added up.
  const myLines = canBill ? detail.expenses.filter(x => x.emp === me && x.status === 'UNCLAIMED') : []
  // The food budget and what is left of it. Only when food was actually asked
  // for: a trip where nobody expects to eat on expenses should not grow a bar.
  const food = canBill && t.foodWanted
    ? foodBalance(foodBudget(t), foodSpent(detail.expenses, t.id, me))
    : null
  // MY claims on this trip, not everybody's. te_trip_detail returns every
  // claim against the trip, and now that two people can each claim one, "a
  // claim exists" stopped meaning "my claim exists". Reading it unscoped would
  // have hidden my own claim button because a colleague had already claimed,
  // and shown me what they were paid.
  const claims = myClaims(detail.claims, me)
  // Legs still owing something before the trip can be claimed.
  const openLegs = legs.filter(l => l.status !== 'SUBMITTED' && l.status !== 'SKIPPED' && l.status !== 'CANCELLED')
  // The next thing to deal with: a leg in progress, one waiting for its report,
  // or the next one planned.
  const nextLeg = legs.find(l => l.status === 'ACTIVE' || l.status === 'PAUSED' || l.status === 'ENDED')
    ?? legs.find(l => l.status === 'PLANNED')
    ?? null

  async function act(what: string, run: () => Promise<string>) {
    setBusy(what); setError('')
    try {
      const message = await run()
      setConfirming(null)
      onChanged(message)
      // A cancelled trip no longer exists to look at; everything else is a
      // change to this same trip.
      if (what === 'cancel' || what === 'delete') onBack(); else reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  const isDraftPostFacto = st === 'DRAFT' && t.origin === 'POST_FACTO'

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trips</button>
        <span className="mono muted">{t.no}</span>
      </div>

      <div className="card">
        <div className="row sp top">
          <div>
            <h1 className="tname">{t.name}</h1>
            <p className="muted">{(t.points || []).map(p => pname(p.place) || '…').join(' → ')}</p>
            <p className="small muted">
              {t.start
                ? (t.start === t.end
                  ? dayAt(t.start, t.points?.[0]?.leaveAt)
                  : `${dayAt(t.start, t.points?.[0]?.leaveAt)} to ${day(t.end)}`)
                : 'No dates yet'}
              {t.purpose ? ` · ${t.purpose}` : ''}{t.project ? ` · ${t.project}` : ''}
            </p>
            {t.pax > 1 ? (
              <p className="small muted">
                {t.pax} people travel. Each claims their own expenses.{withWho ? ` ${withWho}.` : ''}
              </p>
            ) : null}
          </div>
          <div className="row tight">
            <span className={`chip plain sc sc-${t.scope}`}><TeIcon name={t.scope} size="sm" />{SCOPE_WORD[t.scope]}</span>
            <span className="chip plain">{PATTERN_WORD[t.pattern] ?? t.pattern}</span>
            {t.origin === 'POST_FACTO' ? <span className="chip plain t-warn">Recorded after travel</span> : null}
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>
        </div>
      </div>

      {/* ── you did not plan this one; you are on it ── */}
      {note ? (
        <div className="flag info">
          <TeIcon name="people" />
          <div className="tx">
            <b>You are travelling on this trip</b>
            <p>{note}</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {/* ── waiting, or sent back with a question ── (53, 68) */}
      {/* SHOWN AT ANY STATUS, not only while the trip is still waiting. It used
          to be gated to PENDING_APPROVAL and SENT_BACK, which hid it at exactly
          the moment the travel desk and Finance come looking: once a trip is
          approved, "who approved it, and did anyone else have to" is the
          question they are here to answer. The employee's own actions below
          stay gated on their own states. */}
      {(t.chain ?? []).length || st === 'PENDING_APPROVAL' || st === 'SENT_BACK' ? (
        <div className="card">
          <div className="ch"><h3>Approval</h3><span className={`chip ${chip.tone}`}>{chip.label}</span></div>
          <div className="stack sm">
            {(t.chain ?? []).map((s, i) => (
              <div key={i} className="row tight">
                <span className="av sm">{initials(s.whoName || s.role)}</span>
                <div className="grow"><b>{s.whoName || s.role}</b> <span className="muted small">{s.role}</span></div>
                {/* Four outcomes, not two. A rejected or sent-back step read
                    as "Pending" here, which is the opposite of what happened. */}
                <span className={`chip ${STEP_TONE[s.status] ?? 't-warn'}`}>{STEP_WORD[s.status] ?? 'Pending'}</span>
              </div>
            ))}
          </div>
          {t.why?.length ? <p className="small muted">Added by the workflow: {t.why.join('; ')}.</p> : null}

          {st === 'SENT_BACK' && mine ? (
            <>
              {detail.messages.length ? (
                <div className="thread">
                  {detail.messages.map((m, i) => (
                    <div key={i} className="msg"><small>{m.name} asked</small>{m.text}</div>
                  ))}
                </div>
              ) : null}
              <button type="button" className="btn pri wide" onClick={() => onEdit(detail)}>
                <TeIcon name="back" size="sm" />Edit the plan and send again
              </button>
              <details className="more">
                <summary>Answer without changes</summary>
                <label className="fld">
                  <span>Your answer</span>
                  <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Explain what your approver asked about" />
                </label>
                <button
                  type="button"
                  className="btn wide"
                  disabled={!answer.trim() || busy === 'answer'}
                  onClick={() => act('answer', async () => { await te.tripAnswer(t.id, answer.trim()); return 'Your answer was sent.' })}
                >
                  {busy === 'answer' ? 'Sending…' : 'Send the answer'}
                </button>
              </details>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── the dates passed before anybody approved it ── (69e) */}
      {st === 'EXPIRED' ? (
        <div className="card">
          <div className="ch"><h3>Request expired</h3><span className="chip t-crit">Expired</span></div>
          <p className="small muted">The trip dates passed before it was approved, so it can no longer be approved or booked.</p>
        </div>
      ) : null}

      {/* ── the day came and went with no leg started ── (69a) */}
      {st === 'MISSED' && mine ? (
        <div className="card">
          <div className="ch"><h3>Not travelled on {day(t.start)}</h3><span className="chip t-warn">Missed</span></div>
          <p className="small muted">No journey was started on the day, so there is no GPS record.</p>
          <label className="fld">
            <span>Why was GPS not used?</span>
            <select value={missedReason} onChange={e => setMissedReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {NO_GPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {/* Appears on picking Other, and the button stays disabled until it
              says something. A placeholder reading "Needed for Other" on a
              permanently visible box was not a requirement, only a hint, and
              an unexplained Other went through. */}
          {needsExplanation(missedReason) ? (
            <>
              <label className="fld">
                <span>{whyLabel('gps').label}</span>
                <textarea
                  autoFocus
                  value={missedNote}
                  placeholder="The tracking screen would not open on my phone"
                  onChange={e => setMissedNote(e.target.value)}
                />
                <small>{whyLabel('gps').hint}</small>
              </label>
              {missedNote.trim() && whyProblem(missedReason, missedNote)
                ? <div className="ferr"><TeIcon name="warn" size="sm" />{whyProblem(missedReason, missedNote)}</div>
                : null}
            </>
          ) : null}
          <button
            type="button"
            className="btn pri wide"
            disabled={!missedReason || !!whyProblem(missedReason, missedNote) || busy === 'missed'}
            onClick={() => act('missed', async () => {
              await te.tripRecordMissed(t.id, missedReason, missedNote.trim() || undefined)
              return 'Recorded. Add each journey without GPS, then claim.'
            })}
          >
            {busy === 'missed' ? 'Recording…' : 'Record the journeys without GPS'}
          </button>
        </div>
      ) : null}

      {/* ── ready to go, or on the way ── (52, 54, 61) */}
      {st === 'APPROVED' || st === 'ONGOING' ? (
        <div className="card">
          <div className="ch">
            <h3>
              {legs.some(l => l.status === 'ACTIVE' || l.status === 'PAUSED') ? 'On the road'
                : st === 'ONGOING' ? 'Next journey'
                  : t.start && t.start > today ? `Starts ${day(t.start)}`
                    : 'Ready to go'}
            </h3>
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>
          {nextLeg ? (
            <>
              <div className="row tight">
                <span className="ico-b sm"><TeIcon name={MODE_ICON[nextLeg.mode] ?? 'route'} size="sm" /></span>
                <div className="grow">
                  <b>Journey {nextLeg.n}: {pname(nextLeg.from)} → {pname(nextLeg.to)}</b>
                  <div className="small muted">
                    {nextLeg.mode} · {nextLeg.plannedKm} km · {nextLeg.gps === 'checkin' ? 'check-ins' : 'GPS'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn pri wide"
                onClick={() => onOpenLeg(nextLeg)}
              >
                <TeIcon name="play" size="sm" />
                {nextLeg.status === 'PLANNED' && nextLeg.date <= today
                  ? (nextLeg.gps === 'checkin' ? 'Check in and go' : 'Start this journey')
                  : nextLeg.status === 'ENDED' ? 'Save the journey report' : 'Open the journey'}
              </button>
            </>
          ) : null}
          {t.start && t.start > today ? <p className="small muted">The first journey can start on {day(t.start)}.</p> : null}

          {/* Once a leg has been travelled the plan is history, not a draft. */}
          {!started && mine ? (
            <div className="row tight">
              {!(t.chain ?? []).length ? <button type="button" className="btn sm grow" onClick={() => onEdit(detail)}>Change the plan</button> : null}
              <button type="button" className="btn dan sm grow" onClick={() => setConfirming('cancel')}>Cancel trip</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── recorded after travel, still a draft ── (39, 39b) */}
      {isDraftPostFacto && mine ? (
        <div className="card">
          <div className="ch"><h3>Recorded after travel</h3><span className="chip t-info">Draft</span></div>
          <p className="small muted">Open each journey to add its fare, add your other bills, and submit. A draft that is not needed can be deleted.</p>
          <div className="row tight">
            <button type="button" className="btn sm grow" onClick={() => onEdit(detail)}>Edit the trip</button>
            <button type="button" className="btn dan sm grow" onClick={() => setConfirming('delete')}>Delete draft</button>
          </div>
        </div>
      ) : null}

      {/* ── back, with legs still owing a report ── */}
      {st === 'COMPLETED' && openLegs.length && mine ? (
        <div className="card">
          <div className="ch"><h3>Close every journey</h3><span className="chip plain t-warn">{plural(openLegs.length, 'journey')} open</span></div>
          <p className="small muted">The claim goes once each journey has its report, was added without GPS, or was skipped.</p>
          <div className="stack sm">
            {openLegs.map(l => (
              <button key={l.id} type="button" className="act flat" onClick={() => onOpenLeg(l)}>
                <span className="ico-b sm"><TeIcon name={MODE_ICON[l.mode] ?? 'route'} size="sm" /></span>
                <span><b>Journey {l.n}: {pname(l.from)} → {pname(l.to)}</b><small>{LEG_STATE[l.status] ?? l.status}</small></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── back, every leg closed: the claim is what is left ── (65) */}
      {mine && !openLegs.length && (st === 'COMPLETED' || isDraftPostFacto) && !claims.some(c => c.status !== 'CANCELLED' && c.status !== 'REJECTED') ? (
        <div className="card">
          <div className="ch"><h3>Claim for this trip</h3><span className="chip plain t-brand">Every journey is closed</span></div>
          <p className="small muted">Check what each line is worth, add any other bills, and send it.</p>
          <button type="button" className="btn pri wide" onClick={() => onClaim(detail)}>
            Review and submit the claim<TeIcon name="go" size="sm" />
          </button>
        </div>
      ) : null}

      {/* ── what you spent on this trip ──
          THE ONLY DOOR TO A HOTEL OR A FOOD BILL. Both categories are
          `needsTrip`, so the Other-expenses form filters them out, and until
          this card existed the only way into a trip's bills was the claim card
          above — which appears once the trip is COMPLETED and every journey is
          closed. That is the one moment you are NOT spending. A hotel bill
          exists on the night, not a week later, and the two categories that
          need a trip could not be reached anywhere in the product.

          So it is shown to anyone on the trip, for as long as the trip could
          still be spent on. It is not gated on the journeys: for the owner a
          dinner does not wait on a GPS report, and for a co-traveller those
          journeys are the planner's to close anyway. The server agrees —
          te_expense_save takes a bill in any state, and te_claim_submit counts
          only the claimant's own open journeys. */}
      {canBill ? (
        <div className="card">
          <div className="ch">
            <h3>What you spent on this trip</h3>
            {myLines.length ? <span className="chip plain t-brand">{plural(myLines.length, 'bill')} saved</span> : null}
          </div>
          <p className="small muted">
            {myLines.length
              ? `${rs(myLines.reduce((a, x) => a + (Number(x.claimed) || 0), 0))} saved so far${riding ? `, in a claim of your own rather than ${detail.employee.name}’s` : ''}. Add the rest as you go.`
              : `The hotel, food, cabs and anything else you paid for${riding ? `. They go in a claim of your own, not ${detail.employee.name}’s` : '. Add them as you go rather than from memory afterwards'}.`}
          </p>
          <div className="row tight">
            <button type="button" className="btn pri grow" onClick={() => onAddBill(t.id)}>
              <TeIcon name="plus" size="sm" />Add a bill
            </button>
            {myLines.length ? (
              <button type="button" className="btn" onClick={() => onClaim(detail)}>
                See all {myLines.length}<TeIcon name="go" size="sm" />
              </button>
            ) : null}
          </div>

          {/* ── the food budget, coming down as the bills arrive ──
              The planner could not ask for a food plan, because nobody knows
              in advance where they will eat. What it did instead was show the
              budget the company had already set. This is the other half of
              that promise: every food bill saved against the trip comes off
              it, so the number means something while you are still travelling.
              The budget is the trip's own meals estimate — the per-day food
              limit for the grade and city, summed over the days — and not a
              second figure kept anywhere. */}
          {food ? (
            <div className={food.tone === 'ok' ? 'meter' : `meter ${food.tone}`}>
              <div className="t">
                <span>Food budget</span>
                <span className="num">{rs(food.spent)} of {rs(food.budget)}</span>
              </div>
              <div className="bar"><i style={{ width: `${food.pct}%` }} /></div>
              <small className="muted">{foodBalanceText(food, rs)}</small>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── the hotels asked for while planning ──
          Named before the trip and still worth showing: the desk books one of
          them, and until it does this is the only record of what was asked
          for. The links go out to wherever they were found; TeFileLink tells
          an http address apart from a file in the private bucket. */}
      {(t.stayOptions ?? []).length ? (
        <div className="card">
          <div className="ch">
            <h3>Hotels you asked for</h3>
            <span className="chip plain">{plural(t.stayOptions.length, 'option')}</span>
          </div>
          {/* What the desk said, once it has said anything. Until then the
              line below explains what is going to happen to these. */}
          {decided ? (
            <div className={decided.tone === 'ok' ? 'flag ok' : 'flag warn'}>
              <TeIcon name={decided.tone === 'ok' ? 'check' : 'alert'} />
              <div className="tx"><p>{decided.text}</p></div>
            </div>
          ) : (
            <p className="small muted">
              {t.stayBy === 'desk'
                ? 'The Travel Desk picks one of these and books it.'
                : 'You book one of these yourself and claim it back.'}
            </p>
          )}
          <div className="stack sm">
            {t.stayOptions.map((o, i) => (
              <div key={i} className={t.stay?.status === 'CHOSEN' && t.stay.chosen === i ? 'row tight picked' : 'row tight'}>
                <span className="ico-b sm"><TeIcon name="home" size="sm" /></span>
                <div className="grow">
                  <b className="small">
                    {i + 1}. {o.name}
                    {t.stay?.status === 'CHOSEN' && t.stay.chosen === i ? <span className="chip t-pos">Chosen</span> : null}
                  </b>
                  <div className="small muted">
                    {[o.location, o.price ? `about ${rs(o.price)} a night` : ''].filter(Boolean).join(' · ') || 'No other details given'}
                  </div>
                </div>
                {o.url ? <TeFileLink path={o.url} name="Open" small /> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* THE PLAN AS THEY FILLED IT IN, before the route the engine made of
          it. Every time, stop, note and link the traveller entered lives here;
          until this was added, t.segs was not referenced anywhere on this
          screen and the preferences from migrations 171 and 172 reached the
          desk's work list and no further. Not gated on `mine`: the travel desk
          and Finance are the readers who need it most. */}
      <TeTripPlan trip={t} places={detail.places} masters={masters} />

      {/* ── the route and its legs ── */}
      <div className="card">
        <div className="ch">
          <h3>Route</h3>
          <span className="row tight">
            <span className="muted small">{plural(legs.length, 'journey')}</span>
            {mine && (st === 'ONGOING' || st === 'COMPLETED') ? (
              <button type="button" className="btn sm" onClick={() => onAddLeg(detail)}>
                <TeIcon name="plus" size="sm" />Add a journey
              </button>
            ) : null}
          </span>
        </div>
        <TeTripMap
          legs={legs.map(l => ({ from: l.from, to: l.to, mode: l.mode }))}
          points={(t.points || []).map(p => p.place).filter(Boolean)}
          places={places}
          label={`Map of ${t.name}`}
        />
        {/* The panel above is a schematic; this hands the real route to the
            map app the person already has. No API key is involved. */}
        <TeMapLinks
          points={(t.points || []).map(p => detail.places[p.place]).filter(Boolean)}
          scope={t.scope}
          label={t.name}
        />
        <div className="tw-legs">
          {legs.map(l => (
            // The row, and — only when a desk has asked something about this
            // journey — the question and the box to answer it. A Fragment
            // because the answer must sit OUTSIDE the clickable row: nesting a
            // textarea inside a role="button" makes typing in it open the leg.
            <Fragment key={l.id}>
              <div className="row tight tw-leg click" role="button" tabIndex={0}
                onClick={() => onOpenLeg(l)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLeg(l) } }}
              >
                <span className="ln">{l.n}</span>
                <span className="ico-b sm"><TeIcon name={MODE_ICON[l.mode] ?? 'route'} size="sm" /></span>
                <div className="grow">
                  <b className="small">{pname(l.from)} → {pname(l.to)}</b>
                  <div className="small muted">
                    {t.scope === 'local' ? '' : `${day(l.date)} · `}
                    {l.mode}{l.bookedBy === 'desk' ? ', Travel Desk' : ''}
                    {` · ${l.plannedKm} km`}
                    {` · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}`}
                    {LEG_KIND[l.kind] ? ` · ${LEG_KIND[l.kind]}` : ''}
                  </div>
                </div>
                {/* A journey a desk has queried says so here rather than only
                    inside it: this list is where the traveller looks when their
                    claim will not send. */}
                {l.review?.backAt ? <span className="chip t-bad">Sent back</span> : null}
                <span className="chip plain">{LEG_STATE[l.status] ?? l.status}</span>
              </div>
              {mine && l.review?.backAt ? (
                <TeJourneyAnswer legId={l.id} n={l.n} review={l.review} onDone={onChanged} />
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>

      {t.origin !== 'POST_FACTO' && t.estimateTotal ? (
        <div className="card">
          <div className="ch"><h3>Estimate</h3><span className="muted small">from the plan and your limits</span></div>
          <dl className="kv">
            {([['travel', 'Travel you pay'], ['desk', 'Tickets the Travel Desk books'], ['hotel', t.stayBy === 'desk' ? 'Hotel, Travel Desk books' : 'Hotel'], ['meals', 'Food'], ['conv', 'Local rides at the destination']] as const)
              .filter(([k]) => t.estimate[k])
              .map(([k, label]) => <Fragment key={k}><dt>{label}</dt><dd>{rs(t.estimate[k])}</dd></Fragment>)}
            <dt className="tot">Total</dt><dd className="tot">{rs(t.estimateTotal)}</dd>
          </dl>
        </div>
      ) : null}

      {/* EVERYTHING THIS TRIP COST, in one place: the tickets the desk booked,
          the hotel, the food, and every journey's fare including the sub-trips
          added along the way. te_trip_detail has always returned all of it;
          nothing on this screen ever listed a single line. */}
      <TeTripLedger detail={detail} me={me} everyone={!!everyone} cats={cats} />

      {claims.length ? claims.map(c => (
        <div key={c.id} className="card">
          <div className="ch"><h3>Claim <span className="mono muted">{c.no}</span></h3><span className="chip plain">{c.status.replace(/_/g, ' ').toLowerCase()}</span></div>
          <dl className="kv">
            <dt>Claimed</dt><dd>{rs(c.claimed)}</dd>
            <dt>Approved</dt><dd>{rs(c.approved)}</dd>
            {c.net != null ? <><dt className="tot">{c.net >= 0 ? 'Paid to you' : 'Balance on advance'}</dt><dd className="tot">{rs(Math.abs(c.net))}</dd></> : null}
          </dl>
          <button type="button" className="btn wide sm" onClick={() => onOpenClaim(c.id)}>Track this claim</button>
        </div>
      )) : null}

      {/* Stays and tickets. A REQUESTED one is the employee asking the desk to
          book something they found: nothing is bought, so it is not "booked by
          the company" and does not claim to be. */}
      {detail.bookings.length || canAskStay ? (
        <div className="card">
          <div className="ch">
            <h3>Stays and tickets</h3>
            {canAskStay && !asking ? (
              <button type="button" className="btn sm" onClick={() => setAsking(true)}>Ask for a stay</button>
            ) : null}
          </div>
          <div className="stack sm">
            {detail.bookings.map(b => {
              const asked = b.status === 'REQUESTED'
              const off = b.status === 'CANCELLED'
              const d = b.details ?? {}
              return (
                <div key={b.id} className={off ? 'flag' : asked ? 'flag info' : 'flag ok'}>
                  <TeIcon name={off ? 'close' : asked ? 'clock' : 'check'} />
                  <div className="tx">
                    <b>{b.vendor}</b>
                    <p>
                      {asked ? 'Asked the Travel Desk' : off ? 'Cancelled' : `${b.kind === 'hotel' ? 'Booking' : 'PNR'} ${b.pnr ?? ''}`}
                      {' · '}{rs(b.amount)}{asked ? ' expected' : ''}
                      {d.check_in ? ` · ${day(d.check_in)}${d.check_out ? ` to ${day(d.check_out)}` : ''}` : ''}
                    </p>
                    {d.address || d.room || d.note ? (
                      <p className="small muted">{[d.address, d.room, d.note].filter(Boolean).join(' · ')}</p>
                    ) : null}
                    {b.ticket ? (
                      <TeFileLink path={b.ticket} name={asked ? `Open on ${d.platform || 'the booking site'}` : 'Open the ticket'} small />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          {asking ? (
            <TeStayRequest
              detail={detail}
              placeName={pname}
              onCancel={() => setAsking(false)}
              onDone={message => { setAsking(false); onChanged(message); reload() }}
            />
          ) : null}
        </div>
      ) : null}

      {detail.advance ? (
        <div className="card">
          <div className="ch"><h3>Advance</h3><span className="chip plain">{detail.advance.display}</span></div>
          <dl className="kv">
            <dt>Asked</dt><dd>{rs(detail.advance.requested)}</dd>
            {detail.advance.approved != null ? <><dt>Approved</dt><dd>{rs(detail.advance.approved)}</dd></> : null}
            <dt>Still with you</dt><dd>{rs(detail.advance.outstanding)}</dd>
          </dl>
        </div>
      ) : null}

      {detail.timeline.length ? (
        <div className="card">
          <div className="ch"><h3>History</h3></div>
          <div className="stack sm">
            {detail.timeline.filter(e => !e.internal).map((e, i) => (
              <div key={i} className="row tight">
                <span className="grow"><b className="small">{e.text}</b><div className="small muted">{e.name ?? 'System'}{e.role ? ` · ${e.role}` : ''}</div></span>
                <span className="small muted">{when(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── cancelling, and deleting a draft ── (64, 39b) */}
      {confirming ? (
        <div className="card">
          <div className="ch"><h3>{confirming === 'delete' ? 'Delete this draft?' : 'Cancel this trip?'}</h3></div>
          <p className="small muted">
            {confirming === 'delete'
              ? 'The draft and its journeys are removed. Nothing has been claimed against it, so nothing else changes.'
              : 'The plan is cancelled and its journeys are dropped. Any advance asked for is cancelled with it. This cannot be undone.'}
          </p>
          <div className="row tight">
            <button type="button" className="btn grow" onClick={() => setConfirming(null)}>Keep it</button>
            <button
              type="button"
              className="btn dan grow"
              disabled={!!busy}
              onClick={() => act(confirming, async () => {
                const r = await te.tripCancel(t.id)
                return r.deleted ? 'The draft was deleted.' : `${t.no} was cancelled.`
              })}
            >
              {busy ? 'Working…' : confirming === 'delete' ? 'Delete the draft' : 'Cancel the trip'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function initials(name: string): string {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
