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
import type { TeTripDetail as TripDetail, TripScope, Uuid } from '@/lib/te/types'
import { tripChip } from '@/lib/te/trips-list'
import { day, errorText, plural, rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeTripMap from '../plan/TeTripMap'
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

export default function TeTripDetail({ tripId, today, onBack, onChanged, onEdit, onOpenClaim, onNotBuilt }: {
  tripId: Uuid
  today: string
  onBack: () => void
  onChanged: (message: string) => void
  /** Opens the planner on this trip. */
  onEdit: (detail: TripDetail) => void
  onOpenClaim: (claimId: Uuid) => void
  onNotBuilt: (what: string) => void
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
              {t.start ? (t.start === t.end ? day(t.start) : `${day(t.start)} to ${day(t.end)}`) : 'No dates yet'}
              {t.purpose ? ` · ${t.purpose}` : ''}{t.project ? ` · ${t.project}` : ''}
            </p>
            {t.pax > 1 ? <p className="small muted">{t.pax} people travel. Each claims their own expenses.</p> : null}
          </div>
          <div className="row tight">
            <span className={`chip plain sc sc-${t.scope}`}><TeIcon name={t.scope} size="sm" />{SCOPE_WORD[t.scope]}</span>
            <span className="chip plain">{PATTERN_WORD[t.pattern] ?? t.pattern}</span>
            {t.origin === 'POST_FACTO' ? <span className="chip plain t-warn">Recorded after travel</span> : null}
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {/* ── waiting, or sent back with a question ── (53, 68) */}
      {st === 'PENDING_APPROVAL' || st === 'SENT_BACK' ? (
        <div className="card">
          <div className="ch"><h3>Approval</h3><span className={`chip ${chip.tone}`}>{chip.label}</span></div>
          <div className="stack sm">
            {(t.chain ?? []).map((s, i) => (
              <div key={i} className="row tight">
                <span className="av sm">{initials(s.whoName || s.role)}</span>
                <div className="grow"><b>{s.whoName || s.role}</b> <span className="muted small">{s.role}</span></div>
                <span className={`chip ${s.status === 'approved' ? 't-brand' : 't-warn'}`}>{s.status === 'approved' ? 'Approved' : 'Pending'}</span>
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
          <p className="small muted">No leg was started on the day, so there is no GPS record.</p>
          <label className="fld">
            <span>Why was GPS not used?</span>
            <select value={missedReason} onChange={e => setMissedReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {NO_GPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>What happened</span>
            <input value={missedNote} onChange={e => setMissedNote(e.target.value)} placeholder="Needed for Other" />
          </label>
          <button
            type="button"
            className="btn pri wide"
            disabled={!missedReason || busy === 'missed'}
            onClick={() => act('missed', async () => {
              await te.tripRecordMissed(t.id, missedReason, missedNote.trim() || undefined)
              return 'Recorded. Add each leg without GPS, then claim.'
            })}
          >
            {busy === 'missed' ? 'Recording…' : 'Record the legs without GPS'}
          </button>
        </div>
      ) : null}

      {/* ── ready to go, or on the way ── (52, 54, 61) */}
      {st === 'APPROVED' || st === 'ONGOING' ? (
        <div className="card">
          <div className="ch">
            <h3>
              {legs.some(l => l.status === 'ACTIVE' || l.status === 'PAUSED') ? 'On the road'
                : st === 'ONGOING' ? 'Next leg'
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
                  <b>Leg {nextLeg.n}: {pname(nextLeg.from)} → {pname(nextLeg.to)}</b>
                  <div className="small muted">
                    {nextLeg.mode} · {nextLeg.plannedKm} km · {nextLeg.gps === 'checkin' ? 'check-ins' : 'GPS'}
                  </div>
                </div>
              </div>
              <button type="button" className="btn pri wide" onClick={() => onNotBuilt('Recording a leg is build step 6.')}>
                <TeIcon name="play" size="sm" />
                {nextLeg.status === 'PLANNED' && nextLeg.date <= today
                  ? (nextLeg.gps === 'checkin' ? 'Check in and go' : 'Start this leg')
                  : nextLeg.status === 'ENDED' ? 'Save the leg report' : 'Open the leg'}
              </button>
            </>
          ) : null}
          {t.start && t.start > today ? <p className="small muted">The first leg can start on {day(t.start)}.</p> : null}

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
          <p className="small muted">Open each leg to add its fare, add your other bills, and submit. A draft that is not needed can be deleted.</p>
          <div className="row tight">
            <button type="button" className="btn sm grow" onClick={() => onEdit(detail)}>Edit the trip</button>
            <button type="button" className="btn dan sm grow" onClick={() => setConfirming('delete')}>Delete draft</button>
          </div>
        </div>
      ) : null}

      {/* ── back, with legs still owing a report ── */}
      {st === 'COMPLETED' && openLegs.length && mine ? (
        <div className="card">
          <div className="ch"><h3>Close every leg</h3><span className="chip plain t-warn">{plural(openLegs.length, 'leg')} open</span></div>
          <p className="small muted">The claim goes once each leg has its report, was added without GPS, or was skipped.</p>
          <div className="stack sm">
            {openLegs.map(l => (
              <button key={l.id} type="button" className="act flat" onClick={() => onNotBuilt('The leg report is build step 6.')}>
                <span className="ico-b sm"><TeIcon name={MODE_ICON[l.mode] ?? 'route'} size="sm" /></span>
                <span><b>Leg {l.n}: {pname(l.from)} → {pname(l.to)}</b><small>{LEG_STATE[l.status] ?? l.status}</small></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── the route and its legs ── */}
      <div className="card">
        <div className="ch"><h3>Route</h3><span className="muted small">{plural(legs.length, 'leg')}</span></div>
        <TeTripMap
          legs={legs.map(l => ({ from: l.from, to: l.to, mode: l.mode }))}
          points={(t.points || []).map(p => p.place).filter(Boolean)}
          places={places}
          label={`Map of ${t.name}`}
        />
        <div className="tw-legs">
          {legs.map(l => (
            <div key={l.id} className="row tight tw-leg">
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
              <span className="chip plain">{LEG_STATE[l.status] ?? l.status}</span>
            </div>
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

      {detail.claims.length ? detail.claims.map(c => (
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

      {detail.bookings.length ? (
        <div className="card">
          <div className="ch"><h3>Booked by the company</h3></div>
          <div className="stack sm">
            {detail.bookings.map(b => (
              <div key={b.id} className="flag ok">
                <TeIcon name="check" />
                <div className="tx"><b>{b.vendor}</b><p>{b.kind === 'hotel' ? 'Booking' : 'PNR'} {b.pnr} · {rs(b.amount)}</p></div>
              </div>
            ))}
          </div>
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
              ? 'The draft and its legs are removed. Nothing has been claimed against it, so nothing else changes.'
              : 'The plan is cancelled and its legs are dropped. Any advance asked for is cancelled with it. This cannot be undone.'}
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
