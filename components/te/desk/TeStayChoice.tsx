'use client'
// components/te/desk/TeStayChoice.tsx — the Travel Desk answers the hotels an
// employee suggested. The other end of the question the planner asks.
//
// WHAT THIS SCREEN IS FOR. Somebody planning a trip named three hotels they
// would be happy with and pasted the page for each. One decision closes that:
// pick one, or turn them all down and say why. Either way the employee is told
// in the trip's own History, which is where everything else that happened to
// the trip already is.
//
// THE LINKS ARE THE POINT. The desk cannot judge a hotel from a name, so every
// row opens the page the employee found it on. TeFileLink renders an http
// address as a plain link out — it tells one apart from a file in the private
// bucket, which needs a signed URL.
//
// A REFUSAL HAS TO SAY WHY. "No" on its own sends somebody back to search with
// nothing to go on; "too far from the client office" sends them back knowing
// what to look for. The button stays disabled until there is a reason, the
// route refuses it, and te_stay_decide refuses it again.
//
// NOTHING IS BOOKED HERE. Choosing records which hotel was chosen, and no
// more: no PNR, no money, no expense on the trip. The desk books it afterwards
// through "To book" above, which is the moment a cost exists. Keeping the two
// apart is what stops a trip carrying the price of a room nobody reserved.
import { useState } from 'react'
import { te, type DeskStay } from '@/lib/te/client'
import { errorText, day, rs } from '@/lib/te/format'
import { platformOf, rejectReady } from '@/lib/te/trip-stay'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'

export default function TeStayChoice({ stays, onDone, onOpenTrip }: {
  stays: DeskStay[]
  /** Reload the desk and say what happened. */
  onDone: (message: string) => void
  /** Open the whole trip. Choosing a hotel is a decision about somebody's
   *  trip, and the dates, the route and what else has been booked on it are
   *  all on the trip — not on this row. */
  onOpenTrip?: (tripId: string) => void
}) {
  // Which trip is open, which row is picked in it, and the remark being typed.
  // Kept per trip so switching between two does not carry one's note into the
  // other.
  const [openTrip, setOpenTrip] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, number>>({})
  const [remark, setRemark] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function decide(s: DeskStay, action: 'choose' | 'reject') {
    setBusy(s.id); setError('')
    try {
      const r = await te.desk.stayDecide({
        tripId: s.id,
        action,
        ...(action === 'choose' ? { choice: pick[s.id] ?? 0 } : {}),
        ...(remark[s.id]?.trim() ? { remark: remark[s.id].trim() } : {}),
      })
      onDone(action === 'choose'
        ? `${r.name || 'The hotel'} chosen for ${s.trip_no}. ${s.full_name ?? 'The traveller'} has been told.`
        : `Hotels turned down for ${s.trip_no}. ${s.full_name ?? 'The traveller'} has been told why.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card pad0">
      <div className="day"><span>Hotels to choose</span><span>{stays.length}</span></div>

      {!stays.length ? (
        <div className="empty">
          <b>Nothing waiting</b>
          When somebody asks for a stay while planning a trip, the hotels they suggested appear here.
        </div>
      ) : null}

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {stays.map(s => {
        const open = openTrip === s.id
        const chosen = pick[s.id] ?? 0
        const note = remark[s.id] ?? ''
        const options = s.stay_options ?? []
        return (
          <div key={s.id} className="li col">
            <div className="row tight">
              <span className="ico"><TeIcon name={s.scope === 'international' ? 'international' : s.scope === 'domestic' ? 'domestic' : 'local'} /></span>
              <div className="grow">
                <div className="b">{s.name}</div>
                <div className="small muted">
                  {s.full_name ?? '—'} {s.emp_code ? `· ${s.emp_code}` : ''} ·{' '}
                  {onOpenTrip ? (
                    <button type="button" className="link small mono" onClick={() => onOpenTrip(s.id)}
                      title="Everything on this trip: the dates, the route, and what else is booked">
                      {s.trip_no}
                    </button>
                  ) : <span className="mono">{s.trip_no}</span>}
                </div>
                <div className="small muted">
                  {s.start_date ? day(s.start_date) : 'No dates'}{s.end_date && s.end_date !== s.start_date ? ` to ${day(s.end_date)}` : ''}
                  {' · '}{options.length === 1 ? '1 hotel suggested' : `${options.length} hotels suggested`}
                  {s.stay_by === 'desk' ? ' · the desk books it' : ' · they book it themselves'}
                </div>
              </div>
              <button type="button" className="btn sm" onClick={() => setOpenTrip(open ? null : s.id)}>
                {open ? 'Close' : 'Look at them'}<TeIcon name={open ? 'up' : 'down'} size="sm" />
              </button>
            </div>

            {open ? (
              <div className="stack sm">
                {!options.length ? (
                  <p className="small muted">No hotels were named on this trip, so there is nothing to choose between.</p>
                ) : null}

                {options.map((o, i) => {
                  const site = platformOf(o.url)
                  return (
                    <label key={i} className={chosen === i ? 'pickrow on' : 'pickrow'}>
                      <input
                        type="radio"
                        name={`stay-${s.id}`}
                        checked={chosen === i}
                        onChange={() => setPick(p => ({ ...p, [s.id]: i }))}
                      />
                      <div className="grow">
                        <b className="small">{o.name}</b>
                        <div className="small muted">
                          {[o.location, o.price ? `about ${rs(o.price)} a night` : '', site].filter(Boolean).join(' · ') || 'No other details given'}
                        </div>
                      </div>
                      {o.url ? <TeFileLink path={o.url} name="Open the page" small /> : null}
                    </label>
                  )
                })}

                <label className="fld">
                  <span>{rejecting === s.id ? 'Why none of these work' : 'A note for the traveller, if you want one'}</span>
                  <input
                    value={note}
                    placeholder={rejecting === s.id ? 'Too far from the client office — try something near Andheri' : 'Optional'}
                    onChange={e => setRemark(p => ({ ...p, [s.id]: e.target.value }))}
                  />
                </label>

                <div className="row tight">
                  <button
                    type="button"
                    className="btn pri grow"
                    disabled={!options.length || busy === s.id}
                    onClick={() => decide(s, 'choose')}
                  >
                    {busy === s.id ? 'Saving…' : `Choose ${options[chosen]?.name || 'this one'}`}
                  </button>
                  {rejecting === s.id ? (
                    <button
                      type="button"
                      className="btn dan"
                      disabled={!rejectReady(note) || busy === s.id}
                      onClick={() => decide(s, 'reject')}
                    >
                      {rejectReady(note) ? 'Turn all of them down' : 'Add a reason first'}
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={() => setRejecting(s.id)}>None of these</button>
                  )}
                </div>

                <p className="small muted">
                  Choosing records which hotel was picked and tells {s.full_name ?? 'the traveller'}. Nothing is booked
                  and nothing is charged to the trip until you record the booking above.
                </p>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
