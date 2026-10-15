'use client'
// components/te/approve/TeTripApproval.tsx — approving a trip before it happens.
// Screen 91.
//
// Deciding a PLAN, not a bill. Nothing has been spent, so there are no lines
// to cut: the choice is whether this journey should happen at all, at roughly
// this cost. Three outcomes, and both of the negative ones need a reason —
// an employee told "no" with no explanation has nowhere to go.
//
// An advance is the part worth looking at twice: approving the trip releases
// company money before the travel, so the amount is shown on its own rather
// than folded into the estimate.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeTripDetail as TripDetail, Uuid } from '@/lib/te/types'
import { tripChip } from '@/lib/te/trips-list'
import { day, errorText, plural, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

type Action = 'approve' | 'sendback' | 'reject'

export default function TeTripApproval({ tripId, onBack, onDecided }: {
  tripId: Uuid
  onBack: () => void
  onDecided: (message: string) => void
}) {
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [action, setAction] = useState<Action>('approve')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
        <div className="row"><button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Approvals</button></div>
        <div className="card"><p className="muted">{error || 'Loading the trip…'}</p>
          {error ? <button type="button" className="btn sm" onClick={reload}>Try again</button> : null}</div>
      </div>
    )
  }

  const t = detail.trip
  const chip = tripChip(t)
  const legs = [...detail.legs].sort((a, b) => a.n - b.n)
  const pname = (id: string) => detail.places[id]?.s ?? ''
  const mayAct = detail.can.act
  const who = detail.employee.name
  // A reason is what makes a refusal actionable; without one the employee is
  // told no and left to guess.
  const needsReason = action !== 'approve' && !comment.trim()

  async function send() {
    if (needsReason) { setError(action === 'reject' ? 'A rejected trip needs a reason.' : 'Say what needs changing.'); return }
    setBusy(true); setError('')
    try {
      await te.tripDecide(t.id, action, comment.trim() || undefined)
      onDecided(
        action === 'approve' ? `${t.no} approved.`
          : action === 'sendback' ? `${t.no} sent back to ${who}.`
            : `${t.no} rejected.`,
      )
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Approvals</button>
        <span className="mono muted">{t.no}</span>
      </div>

      <div className="card">
        <div className="row sp top">
          <div>
            <h1 className="tname">{t.name}</h1>
            <p className="muted">{who} · {detail.employee.code}</p>
            <p className="small muted">
              {(t.points || []).map(p => pname(p.place) || '…').join(' → ')}
            </p>
            <p className="small muted">
              {t.start ? (t.start === t.end ? day(t.start) : `${day(t.start)} to ${day(t.end)}`) : 'No dates'}
              {` · ${plural(legs.length, 'journey')}`}{t.purpose ? ` · ${t.purpose}` : ''}
            </p>
          </div>
          <div className="row tight">
            {t.origin === 'POST_FACTO' ? <span className="chip plain t-warn">Already travelled</span> : null}
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>
        </div>
      </div>

      {!mayAct ? (
        <div className="flag info">
          <TeIcon name="info" />
          <div className="tx"><b>This is not yours to decide</b><p>{detail.can.why || 'It is with somebody else at the moment.'}</p></div>
        </div>
      ) : null}

      {/* The money, with the advance called out: approving releases it. */}
      <div className="card">
        <div className="ch"><h3>What it is expected to cost</h3></div>
        <dl className="kv">
          {t.estimate.travel ? <><dt>Travel they pay</dt><dd>{rs(t.estimate.travel)}</dd></> : null}
          {t.estimate.desk ? <><dt>Tickets the Travel Desk books</dt><dd>{rs(t.estimate.desk)}</dd></> : null}
          {t.estimate.hotel ? <><dt>Hotel</dt><dd>{rs(t.estimate.hotel)}</dd></> : null}
          {t.estimate.meals ? <><dt>Food</dt><dd>{rs(t.estimate.meals)}</dd></> : null}
          {t.estimate.conv ? <><dt>Local rides</dt><dd>{rs(t.estimate.conv)}</dd></> : null}
          <dt className="tot">Total estimate</dt><dd className="tot">{rs(t.estimateTotal)}</dd>
        </dl>
        {t.advance ? (
          <div className="flag warn">
            <TeIcon name="alert" />
            <div className="tx">
              <b>An advance of {rs(t.advance)} is asked for</b>
              <p>Approving the trip releases this before the travel. It is set against the claim afterwards, and anything left over is recovered.</p>
            </div>
          </div>
        ) : null}
        {t.why?.length ? <p className="small muted">Added by the workflow: {t.why.join('; ')}.</p> : null}
      </div>

      <div className="card pad0">
        <div className="day"><span>Journeys</span><span>{legs.length}</span></div>
        {legs.map(l => (
          <div key={l.id} className="li">
            <span className="ln">{l.n}</span>
            <div className="grow">
              <div className="b">{pname(l.from)} → {pname(l.to)}</div>
              <div className="small muted">
                {t.scope === 'local' ? '' : `${day(l.date)} · `}{l.mode}
                {l.bookedBy === 'desk' ? ', Travel Desk' : ''} · {l.plannedKm} km
                {` · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      {mayAct ? (
        <div className="card">
          <div className="ch"><h3>Your decision</h3></div>
          <div className="seg" role="group" aria-label="Decision">
            <button type="button" aria-pressed={action === 'approve'} onClick={() => { setAction('approve'); setError('') }}>Approve</button>
            <button type="button" aria-pressed={action === 'sendback'} onClick={() => { setAction('sendback'); setError('') }}>Send back</button>
            <button type="button" aria-pressed={action === 'reject'} onClick={() => { setAction('reject'); setError('') }}>Reject</button>
          </div>
          <label className="fld">
            <span>{action === 'approve' ? 'Comment, if any' : 'What they need to know'}</span>
            <textarea value={comment} onChange={e => { setComment(e.target.value); setError('') }} />
          </label>
          <div className="note">
            <TeIcon name="info" size="sm" />
            <span>
              {action === 'approve'
                ? t.advance
                  ? `Approves the trip and releases the ${rs(t.advance)} advance.`
                  : 'Approves the trip. They can start its first journey on the day.'
                : action === 'sendback' ? 'Goes back for them to change and send again.'
                  : 'The trip is refused. Any advance asked for is cancelled with it.'}
            </span>
          </div>
          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
          <button
            type="button"
            className={action === 'reject' ? 'btn dan lg wide' : 'btn pri lg wide'}
            disabled={busy}
            onClick={send}
          >
            {busy ? 'Sending…' : action === 'approve' ? 'Approve the trip' : action === 'sendback' ? 'Send it back' : 'Reject the trip'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
