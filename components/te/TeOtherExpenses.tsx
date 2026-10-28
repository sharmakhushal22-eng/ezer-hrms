'use client'
// components/te/TeOtherExpenses.tsx — saved expense lines, and the claim they
// become. Two screens from one component:
//   no trip   "Other expenses" — client meals, courier, parking (screens 80-82)
//   a trip    the claim for that trip, once you are back (screens 65, 66)
// They are the same screen because they are the same act: lines waiting, what
// they add up to, what is wrong with them, and one submit. The only real
// difference is which lines belong and what the claim is called.
//
// Markup and class names: design/html/other-expenses.html.
// The aside is the claim review: POST /api/te/claims/preview gives the totals,
// every flag, what stops the claim and who will approve it; "Submit claim"
// is POST /api/te/claims with the declaration. Nothing is added up in the browser.
import { useEffect, useMemo, useState } from 'react'
import { te, TeApiError } from '@/lib/te/client'
import type { ClaimPreview, Snapshot, TeExpense, TeFlag, TeTrip } from '@/lib/te/types'
import TeIcon from './TeIcon'
import TeContactFields, { type ContactValue } from './TeContactFields'
import { errorText, flagClass, plural, rs } from '@/lib/te/format'
import { linesWaitingInTrips, tripsForLine } from '@/lib/te/trips-list'
import { claimDateOf, periodFor } from '@/lib/te/period'
import { isCoTraveller } from '@/lib/te/co-traveller'

export default function TeOtherExpenses({ snap, trip, onAdd, onEdit, onSubmitted, onBack, onOpenTrip, onChanged }: {
  snap: Snapshot
  /** Set to claim one trip; left out for the standing "Other expenses" claim. */
  trip?: TeTrip
  onAdd: () => void
  onEdit: (line: TeExpense) => void
  onSubmitted: (claimId: string, message: string) => void
  onBack?: () => void
  /** Open a trip whose bills are waiting in it (screen 44). */
  onOpenTrip?: (tripId: string) => void
  /** Something changed on the server that this screen does not own — a line
   *  moved into a trip, so it belongs to a different bucket now and the
   *  snapshot has to be read again. */
  onChanged?: (message: string) => void
}) {
  // My own saved lines. Colleagues' lines are in the snapshot (other: true)
  // only so the server can check for duplicates; they are never mine to claim.
  const lines = useMemo(
    () => snap.expenses.filter(x => !x.other && x.status === 'UNCLAIMED' && (trip ? x.tripId === trip.id : !x.tripId)),
    [snap, trip],
  )
  const catName = useMemo(() => new Map(snap.cfg.cats.map(c => [c.id, c.name])), [snap])
  // Declared HERE, above every hook that reads it. It used to sit further down,
  // which was fine until `movable` below listed it as a dependency: a const in
  // its temporal dead zone throws on the first render rather than reading as
  // undefined, so the whole screen would have gone white.
  const tripId = trip?.id ?? null
  // Only on the standing monthly claim: on a trip's own claim these lines ARE
  // the list above.
  const waitingInTrips = useMemo(
    () => (trip ? [] : linesWaitingInTrips(snap.expenses, snap.trips)),
    [snap, trip],
  )
  const [preview, setPreview] = useState<ClaimPreview | null>(null)
  const [declared, setDeclared] = useState(false)
  // HOW TO REACH THEM ABOUT THIS CLAIM, asked only on a claim with no trip:
  // "Other expenses" never passes through the planner, so this screen is the
  // only place the question can be put. A trip claim inherits what the trip
  // already carries, so nobody is asked the same thing twice.
  //
  // Prefilled from their own EZER record and editable. What they leave is
  // stored on the claim; the record is not written back to.
  const [contact, setContact] = useState<ContactValue>(() => ({
    contactMobile: snap.contact?.mobile ?? '',
    contactAltMobile: snap.contact?.altMobile ?? '',
    contactEmail: snap.contact?.email ?? '',
  }))
  /** Which contact field the server refused, if it was one. Cleared on the next
   *  attempt, so a corrected field stops being red as soon as it is re-sent. */
  const [contactField, setContactField] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; flags: TeFlag[] } | null>(null)
  /** Which line is being moved into a trip, and what went wrong if it did.
   *
   *  MOVING IS SEPARATE FROM EDITING on purpose. Opening the form to change
   *  which trip a bill belongs to would put the most consequential field on the
   *  screen next to the merchant's name — and the form cannot do it anyway:
   *  te_expense_save throws away any trip the browser sends, deliberately, so
   *  that a form POST can never shift money between trips. */
  const [moving, setMoving] = useState<string | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState('')
  /** Trips this bill could go into. Only the ones the server would accept. */
  const movable = useMemo(() => tripsForLine(snap.trips, snap.me, { exclude: tripId }), [snap.trips, snap.me, tripId])

  async function moveTo(lineId: string, toTripId: string, toName: string) {
    setMoveBusy(true); setMoveError('')
    try {
      const r = await te.expenseMoveTrip(lineId, toTripId)
      setMoving(null)
      // The trip number, not the name: the number is the thing the desks and
      // Finance will see it under, and it is what the person should remember.
      onChanged?.(r.moved
        ? `${r.expense_no} moved into ${r.trip_no ?? toName}.`
        : `${r.expense_no} was already there.`)
    } catch (e) {
      setMoveError(errorText(e))
    } finally {
      setMoveBusy(false)
    }
  }
  // The preview is asked again whenever the set of lines, or one of their amounts, changes.
  const signature = lines.map(x => `${x.id}:${x.claimed}:${x.reason}`).join('|')

  useEffect(() => {
    let current = true
    // Nothing to price. A stale preview cannot leak through: `review` below is
    // null whenever there are no lines.
    if (!signature) return
    te.claimPreview(tripId ? { tripId } : {})
      .then(p => { if (current) setPreview(p) })
      .catch(e => { if (current) { setPreview(null); setError({ text: errorText(e), flags: [] }) } })
    return () => { current = false }
  }, [signature, tripId])

  async function submit() {
    setBusy(true); setError(null); setContactField('')
    try {
      const c = await te.claimSubmit(tripId ? { tripId, declared } : { declared, ...contact })
      onSubmitted(c.claim_id, `Claim ${c.claim_no} sent.`)
    } catch (e) {
      setError({ text: errorText(e), flags: e instanceof TeApiError ? e.flags : [] })
      // The server names the field it refused, so the message can sit under it
      // rather than only at the bottom of a long form.
      if (e instanceof TeApiError && typeof e.field === 'string') setContactField(e.field)
    } finally {
      setBusy(false)
    }
  }

  const review = lines.length ? preview : null
  const stops = review ? [...review.blockers, ...review.needs] : []
  // The month this claim will actually land in. This used to be "the first
  // open month in the list", which showed a 17 October trip as "Jun 2026"
  // whenever an older month was still open. The claim went into October
  // regardless — te_period_for decides at submit — but the screen promised the
  // wrong one. periodFor mirrors that rule; see lib/te/period.ts.
  // With no lines there is no claim yet and no date to place it by, so the
  // month is not asserted at all rather than guessed and painted amber.
  const period = useMemo(() => {
    if (!lines.length) return null
    const when = claimDateOf(trip?.end, lines.map(x => x.date))
    return periodFor(snap.periods, when, snap.today)
  }, [snap.periods, snap.today, trip?.end, lines])

  return (
    <>
      {trip && onBack ? (
        <div className="row"><button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trip</button><span className="mono muted">{trip.no}</span></div>
      ) : null}

      <div className="ph">
        <div>
          <h1>{trip ? `Claim for ${trip.name}` : 'Other expenses'}</h1>
          <p>
            {trip
              ? 'Every bill and every journey of this trip, in one claim. Check what each line is worth, then send it.'
              : 'Client meals, courier, parking, printing and other work spends with no travel. Saved lines wait here until you submit them together as one claim.'}
          </p>
        </div>
        <button type="button" className="btn pri" onClick={onAdd}>Add an expense</button>
      </div>

      <div className="cols">
        <div className="stack">
          <div className="card pad0">
            <div className="day"><span>Not submitted yet</span><span>{lines.length}</span></div>
            {lines.length === 0 ? (
              <div className="empty">
                <b>Nothing waiting</b>
                {/* The advice to close the legs is the owner's: a co-traveller
                    has none on this trip, and telling them to close somebody
                    else's would send them looking for a button they cannot see. */}
                {!trip ? 'Add a bill and it appears here.'
                  : isCoTraveller(trip, snap.me) ? 'Add what you paid for on this trip and it appears here.'
                  : 'Close the trip’s journeys and add any other bills, and they appear here.'}
              </div>
            ) : null}
            {lines.map(x => {
              const flags = review?.lines.find(l => l.id === x.id)?.flags ?? []
              return (
                <div key={x.id}>
                  <div className="li click" role="button" tabIndex={0} onClick={() => onEdit(x)} onKeyDown={e => { if (e.key === 'Enter') onEdit(x) }}>
                    <span className="ico"><TeIcon name="other" /></span>
                    <div className="grow">
                      <div className="b">{x.merchant || catName.get(x.cat) || x.cat}</div>
                      <div className="small muted">{[catName.get(x.cat), x.desc, x.billNo].filter(Boolean).join(' · ')}</div>
                      <div className="row tight">
                        {flags.map(fl => <span key={fl.code} className={fl.block ? 'chip t-crit' : 'chip t-warn'}>{fl.code} {fl.title}</span>)}
                      </div>
                    </div>
                    <div className="amt"><b>{rs(x.claimed)}</b></div>
                    {/* THE WHOLE ROW OPENS THE FORM, so this stops the click
                        here: a tap meant for "move" must not also open the
                        editor behind the picker it just opened. Offered only on
                        the loose bucket, and only when there is somewhere to
                        move it to — a button that opens an empty list is a
                        button that wastes a tap. */}
                    {!trip && movable.length ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={e => { e.stopPropagation(); setMoveError(''); setMoving(moving === x.id ? null : x.id) }}
                      >
                        <TeIcon name="route" size="sm" />
                        {moving === x.id ? 'Cancel' : 'Move to a trip'}
                      </button>
                    ) : null}
                  </div>
                  {/* OUTSIDE the clickable row, not inside it. A list of buttons
                      nested in something that is itself a button is unusable
                      with a keyboard and ambiguous with a mouse. */}
                  {moving === x.id ? (
                    // NOT className="form". That is a two-column grid, and the
                    // question would have sat beside the list of trips instead
                    // of above it. A stack is what this wants.
                    <div className="stack sm pad">
                      <p className="small muted">
                        Which trip does {x.merchant || catName.get(x.cat) || 'this bill'} belong to? It will be
                        claimed with that trip instead of this month&rsquo;s other expenses.
                      </p>
                      {/* .ferr, not "small warn": the latter is not a class
                          this stylesheet defines, so the refusal rendered in
                          ordinary body text with nothing to say it had failed. */}
                      {moveError ? <p className="ferr"><TeIcon name="warn" size="sm" />{moveError}</p> : null}
                      <div className="stack sm">
                        {movable.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            className="li click"
                            disabled={moveBusy}
                            onClick={() => void moveTo(x.id, t.id, t.no)}
                          >
                            <span className="ico"><TeIcon name="route" /></span>
                            <span className="grow">
                              <span className="b">{t.name}</span>
                              <span className="small muted"><span className="mono">{t.no}</span>{t.start ? <> · {t.start}</> : null}</span>
                            </span>
                            <TeIcon name="go" size="sm" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          {/* Screen 44. Lines saved against a trip are real, unclaimed, and not
              part of this claim — so without this card they are invisible here
              and get entered a second time. */}
          {!trip && waitingInTrips.length ? (
            <div className="card pad0">
              <div className="day"><span>Waiting inside trips</span><span>{waitingInTrips.length}</span></div>
              {waitingInTrips.map(w => (
                <div
                  key={w.tripId}
                  className={onOpenTrip ? 'li click' : 'li'}
                  role={onOpenTrip ? 'button' : undefined}
                  tabIndex={onOpenTrip ? 0 : undefined}
                  onClick={onOpenTrip ? () => onOpenTrip(w.tripId) : undefined}
                  onKeyDown={onOpenTrip ? e => { if (e.key === 'Enter') onOpenTrip(w.tripId) } : undefined}
                >
                  <span className="ico"><TeIcon name="route" /></span>
                  <div className="grow">
                    <div className="b">{w.name}</div>
                    <div className="small muted">{plural(w.count, 'bill')} · claimed with that trip, not here</div>
                  </div>
                  <div className="amt"><b>{rs(w.total)}</b>{onOpenTrip ? <span className="nr-go">Open<TeIcon name="go" size="sm" /></span> : null}</div>
                </div>
              ))}
            </div>
          ) : null}

          {trip ? null : (
            <div className="note"><TeIcon name="info" size="sm" /><span>Travelled within the city? Start a local trip instead. It records the route and works out the amount for you.</span></div>
          )}
        </div>

        <div className="aside">
          <div className="card">
            <div className="ch">
              <h3>{trip ? 'This claim' : 'This month’s claim'}</h3>
              {period ? (
                <span className={period.isLate ? 'chip plain t-warn' : 'chip plain t-brand'}>{period.period.label}</span>
              ) : null}
            </div>
            {review ? (
              <>
                <dl className="kv">
                  <dt>You paid</dt><dd>{rs(review.claimed)}</dd>
                  {review.eligible !== review.claimed ? <><dt>Eligible under policy</dt><dd>{rs(review.eligible)}</dd></> : null}
                  {review.outstanding > 0 ? <><dt>Advance with you</dt><dd>{rs(-review.outstanding)}</dd></> : null}
                  <dt className="tot">Expected to be paid</dt><dd className="tot">{rs(review.net)}</dd>
                </dl>
                {/* Worth saying out loud: it is how an October bill ends up
                    reimbursed in November, and the employee should hear it
                    before they submit rather than after. */}
                {period?.isLate ? (
                  <p className="small muted">Its own month is closed, so this goes into {period.period.label}.</p>
                ) : null}
                {review.chain.length ? <p className="small muted">Goes to {review.chain.map(c => c.name || c.role).join(', then ')}.</p> : null}
                <div className="stack sm">
                  {stops.map(fl => (
                    <div key={`${fl.lineId}-${fl.code}`} className={flagClass(fl)}>
                      <TeIcon name="warn" />
                      <div className="tx"><b><span className="code">{fl.code}</span> {fl.title}</b><p>{fl.block ? fl.evidence : 'Open the line and add a reason.'}</p></div>
                    </div>
                  ))}
                  {review.stop.map(s => <div key={s} className="flag crit"><TeIcon name="warn" /><div className="tx"><b>{s}</b></div></div>)}
                </div>
                {/* ASKED ONLY WHERE THERE IS NOTHING TO INHERIT. A claim on a
                    trip already carries the details that were given when the
                    trip was planned. */}
                {!tripId ? (
                  <TeContactFields
                    heading="How we reach you about this claim"
                    value={contact}
                    prefilled={snap.contact ? { mobile: snap.contact.mobile, altMobile: snap.contact.altMobile, email: snap.contact.email } : undefined}
                    onChange={patch => { setContact(c => ({ ...c, ...patch })); setContactField('') }}
                    error={k => (contactField === k ? error?.text ?? '' : '')}
                  />
                ) : null}
                <label className="check small">
                  <input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)} />
                  <span>I confirm these expenses are genuine, were incurred for company work and have not been claimed elsewhere.</span>
                </label>
                <button type="button" className="btn pri lg wide" disabled={busy || !declared || stops.length > 0 || review.stop.length > 0} onClick={submit}>
                  {busy ? 'Sending…' : 'Submit claim'}
                </button>
              </>
            ) : (
              <p className="small muted">{lines.length ? 'Checking your lines…' : 'Saved expenses are added up here.'}</p>
            )}
            {error ? (
              <div className="flag crit" role="alert">
                <TeIcon name="warn" />
                <div className="tx"><b>{error.text}</b>{error.flags.map(fl => <p key={`${fl.lineId}-${fl.code}`}>{fl.code} {fl.title}</p>)}</div>
              </div>
            ) : null}
          </div>
          <div className="note"><TeIcon name="info" size="sm" /><span>Bills older than {snap.cfg.billAgeDays} days cannot be claimed.</span></div>
        </div>
      </div>
    </>
  )
}
