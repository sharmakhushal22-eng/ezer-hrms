'use client'
// components/te/desk/TeTravelDesk.tsx — tab 2 of three: the Travel Desk.
// Screens a1, a1b.
//
// FOUR JOBS THAT SHARE A DESK BUT NOT MUCH ELSE, as four rooms behind a
// segmented control rather than four cards stacked down one long page. The
// same shape the Finance desk took, and for the same reason: a desk is one
// job with several rooms, and one room at a time is what somebody does.
//
// THE COUNTS ARE ON THE TABS, which is the part that earns the restructure.
// Stacked, you learned there were nine vehicles waiting by scrolling past
// three other sections. The desk now says where the work is before you move.
//
// IT OPENS ON THE ROOM THAT HAS WORK. A desk person arriving at an empty
// "Hotels to choose" and leaving again, not knowing six tickets needed
// booking, is the failure this avoids. See firstWithWork below.
//
// BOOKINGS TO RECORD. When a trip is planned, each leg says who books it. The
// ones marked "Travel Desk" land here after approval. Recording one creates
// the expense against the trip as company-paid, so the employee never claims
// a ticket somebody else bought — which is the whole reason the distinction
// exists.
//
// VEHICLES TO CHECK. The other half of what the employee saw in step 4. When
// Vahan cannot confirm a registration the employee attaches an RC photo and
// is told HR will check it; this is where that happens. Confirming the TYPE
// is a money decision: the type sets the rate a kilometre, so a vehicle the
// employee called an SUV and the RC shows as a hatchback is paid as a
// hatchback from here on. The screen says what the rate becomes.
import { useCallback, useEffect, useState } from 'react'
import { te, type DeskBooked, type DeskStay, type DeskToBook, type DeskVehicle } from '@/lib/te/client'
import { ratePerKm } from '@/lib/te/vehicle'
import { errorText, day, rs } from '@/lib/te/format'
import type { TeVehicleType } from '@/lib/te/types'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'
import TeStayChoice from './TeStayChoice'

type Room = 'stays' | 'book' | 'booked' | 'vehicles'

export default function TeTravelDesk({ vehicleTypes, fuelPrice, onToast }: {
  /** cfg.vehicles — the types a vehicle can be, and what each pays. */
  vehicleTypes: TeVehicleType[]
  fuelPrice: Record<string, number>
  onToast: (message: string) => void
}) {
  /** null until somebody picks one: see firstWithWork in the body. */
  const [room, setRoom] = useState<Room | null>(null)
  const [toBook, setToBook] = useState<DeskToBook[] | null>(null)
  const [booked, setBooked] = useState<DeskBooked[]>([])
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const [vehicles, setVehicles] = useState<DeskVehicle[]>([])
  const [stays, setStays] = useState<DeskStay[]>([])
  const [error, setError] = useState('')
  const [booking, setBooking] = useState<DeskToBook | null>(null)
  const [form, setForm] = useState({ vendor: '', reference: '', amount: '' })
  const [chosenType, setChosenType] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.desk.list()
      .then(r => { if (current) { setToBook(r.to_book ?? []); setBooked(r.booked ?? []); setVehicles(r.vehicles ?? []); setStays(r.stays ?? []); setError('') } })
      .catch(e => { if (current) { setToBook([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

  const keyOf = (b: DeskToBook) => `${b.trip_id}:${b.leg_id ?? b.point_seq ?? b.kind}`
  const ready = !!form.vendor.trim() && !!form.reference.trim() && Number(form.amount) > 0

  async function record() {
    if (!booking) return
    setBusy('book'); setError('')
    try {
      const r = await te.desk.bookingRecord({
        trip_id: booking.trip_id,
        ...(booking.leg_id ? { leg_id: booking.leg_id } : {}),
        ...(booking.point_seq != null ? { point_seq: booking.point_seq } : {}),
        vendor: form.vendor.trim(),
        reference: form.reference.trim(),
        amount: Number(form.amount),
      })
      onToast(`Booking ${r.booking_no} recorded against ${booking.trip_no}.`)
      setBooking(null); setForm({ vendor: '', reference: '', amount: '' }); reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  /** Cancel a booking the desk made. The expense recorded against the trip is
   *  reversed by the server, which is the whole point: otherwise a ticket
   *  nobody travelled on stays on the employee's trip as company-paid. */
  async function cancelBooking(b: DeskBooked) {
    if (!why.trim()) return
    setBusy(b.id); setError('')
    try {
      await te.desk.bookingCancel(b.id, why.trim())
      onToast(`${b.booking_no} cancelled.`)
      setCancelling(null); setWhy(''); reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function verify(v: DeskVehicle) {
    const type = chosenType[v.id] ?? v.declared_type_code ?? v.vehicle_type_code
    setBusy(v.id); setError('')
    try {
      const r = await te.desk.vehicleVerify(v.id, type)
      const name = vehicleTypes.find(t => t.id === r.vehicle_type_code)?.name ?? r.vehicle_type_code
      onToast(`${v.reg_no} checked. It is paid as ${name}.`)
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  const bookings = toBook ?? []

  // In the order work flows: a hotel is chosen, then it and the tickets are
  // booked, then what was booked can be undone. Vehicles are their own thing
  // and sit last.
  const rooms: { k: Room; label: string; icon: string; n: number }[] = [
    { k: 'stays', label: 'Hotels to choose', icon: 'home', n: stays.length },
    { k: 'book', label: 'To book', icon: 'plane', n: bookings.length },
    { k: 'booked', label: 'Booked', icon: 'check', n: booked.length },
    { k: 'vehicles', label: 'Vehicles', icon: 'car', n: vehicles.length },
  ]
  // Where the work is. Only used until somebody chooses for themselves —
  // after that `room` is set and this is ignored, so the tab does not jump
  // out from under a person who has just emptied the room they were in.
  const firstWithWork = rooms.find(r => r.n)?.k ?? 'stays'
  const here = room ?? firstWithWork

  /** Leaving a room abandons whatever was half-typed in it. Coming back to a
   *  booking form still open over a different trip, or to a cancellation
   *  reason typed for a booking you have since scrolled away from, is how a
   *  reason ends up filed against the wrong row. */
  const goRoom = (k: Room) => {
    setRoom(k)
    setBooking(null)
    setCancelling(null)
    setWhy('')
    setError('')
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Travel Desk</h1>
          <p>Hotels to choose between, tickets and stays the company books, and the vehicles waiting to be checked.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="seg scopes" role="group" aria-label="Travel Desk">
        {rooms.map(r => (
          <button key={r.k} type="button" aria-pressed={here === r.k} onClick={() => goRoom(r.k)}>
            <TeIcon name={r.icon} size="sm" />{r.label}
            {r.n ? <span className="ct">{r.n}</span> : null}
          </button>
        ))}
      </div>

      {/* Choosing comes before booking, because it is what produces something
          to book. A trip sitting here has somebody waiting on an answer. */}
      {here === 'stays' ? <TeStayChoice stays={stays} onDone={message => { onToast(message); reload() }} /> : null}

      {here === 'book' ? (
      <div className="card pad0">
        <div className="day"><span>To book</span><span>{bookings.length}</span></div>
        {toBook === null ? <div className="empty"><b>Loading…</b></div> : null}
        {toBook !== null && !bookings.length ? (
          <div className="empty"><b>Nothing to book</b>Approved trips with journeys marked &ldquo;Travel Desk books&rdquo; appear here.</div>
        ) : null}
        {bookings.map(b => {
          const open = booking && keyOf(booking) === keyOf(b)
          return (
            <div key={keyOf(b)} className="li">
              <span className="ico"><TeIcon name={b.kind === 'hotel' ? 'pin' : b.mode === 'train' ? 'train' : 'plane'} /></span>
              <div className="grow">
                <div className="b">
                  {b.kind === 'hotel' ? 'Hotel' : `${b.from_name ?? '—'} → ${b.to_name ?? '—'}`}
                </div>
                <div className="small muted">
                  {b.full_name} <span className="mono">{b.emp_code}</span> · {b.trip_name}
                  {b.on_date ? ` · ${day(b.on_date)}` : ''}{b.mode ? ` · ${b.mode}` : ''}
                </div>
                {/* WHAT THEY ASKED FOR. The route and the date were never
                    enough to buy a ticket — there are a dozen flights that
                    day — so this desk was writing to travellers to ask. The
                    answer arrives with the request now. */}
                {b.pref_time || b.pref_url || b.pref_note ? (
                  <div className="askrow">
                    <TeIcon name="info" size="sm" />
                    <span>
                      <b>Asked for:</b>
                      {b.pref_time ? ` around ${b.pref_time}` : ''}
                      {b.pref_note ? `${b.pref_time ? '. ' : ' '}${b.pref_note}` : ''}
                      {b.pref_url ? (
                        <>
                          {(b.pref_time || b.pref_note) ? ' · ' : ' '}
                          {/* The traveller typed this. Opened in a new tab and
                              never prefetched; rel stops the opened page
                              reaching back through window.opener. */}
                          <a href={b.pref_url} target="_blank" rel="noopener noreferrer nofollow">the option they found</a>
                        </>
                      ) : null}
                    </span>
                  </div>
                ) : null}
                {open ? (
                  <div className="form">
                    <label className="fld sm"><span>Booked with</span>
                      <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Airline, hotel or agent" />
                    </label>
                    <label className="fld sm"><span>{b.kind === 'hotel' ? 'Booking reference' : 'PNR or ticket number'}</span>
                      <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
                    </label>
                    <label className="fld sm"><span>What it cost (₹)</span>
                      <input type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                    </label>
                    <div className="note">
                      <TeIcon name="info" size="sm" />
                      {/* The point of the distinction, said out loud. */}
                      <span>This is recorded as paid by the company. It is added to the trip so the employee cannot claim it again.</span>
                    </div>
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => setBooking(null)}>Cancel</button>
                      <button type="button" className="btn pri" disabled={!ready || busy === 'book'} onClick={record}>
                        {busy === 'book' ? 'Recording…' : 'Record the booking'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              {!open ? (
                <button type="button" className="btn sm pri" onClick={() => { setBooking(b); setForm({ vendor: '', reference: '', amount: '' }) }}>Record</button>
              ) : null}
            </div>
          )
        })}
      </div>
      ) : null}

      {/* What the desk has already booked. A trip can change after a ticket is
          bought, and an uncancelled booking stays on it as company-paid. */}
      {here === 'booked' ? (
        booked.length ? (
        <div className="card pad0">
          <div className="day"><span>Booked</span><span>{booked.length}</span></div>
          {booked.map(b => (
            <div key={b.id} className="li">
              <span className="ico"><TeIcon name={b.kind === 'hotel' ? 'pin' : 'plane'} /></span>
              <div className="grow">
                <div className="b"><span className="mono">{b.booking_no}</span> · {b.vendor}</div>
                <div className="small muted">
                  {b.full_name} <span className="mono">{b.emp_code}</span> · {b.trip_name}
                  {' · '}<span className="mono">{b.reference}</span> · {rs(b.amount)}
                  {b.booked_at ? ` · ${day(b.booked_at)}` : ''}
                </div>
                {cancelling === b.id ? (
                  <div className="form">
                    <div className="flag crit">
                      <TeIcon name="alert" size="sm" />
                      <span>The booking is cancelled and the expense recorded against the trip is reversed. Cancelling here does not tell the airline or the hotel.</span>
                    </div>
                    <label className="fld sm"><span>Why</span>
                      <input value={why} onChange={e => setWhy(e.target.value)} placeholder="Trip postponed" />
                    </label>
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => { setCancelling(null); setWhy('') }}>Never mind</button>
                      <button type="button" className="btn dan" disabled={!why.trim() || busy === b.id} onClick={() => cancelBooking(b)}>
                        {busy === b.id ? 'Cancelling…' : 'Cancel the booking'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              {cancelling !== b.id ? (
                <button type="button" className="btn sm dan" onClick={() => { setCancelling(b.id); setWhy(''); setError('') }}>Cancel</button>
              ) : null}
            </div>
          ))}
        </div>
        ) : (
          <div className="empty"><b>Nothing is booked</b>Tickets and rooms the desk has recorded appear here, so one can be cancelled when a trip changes.</div>
        )
      ) : null}

      {here === 'vehicles' ? (
      <div className="card pad0">
        <div className="day"><span>Vehicles to check</span><span>{vehicles.length}</span></div>
        {!vehicles.length ? (
          <div className="empty"><b>Nothing waiting</b>A vehicle appears here when Vahan could not confirm it and the employee attached the RC.</div>
        ) : null}
        {vehicles.map(v => {
          const chosen = chosenType[v.id] ?? v.declared_type_code ?? v.vehicle_type_code
          const type = vehicleTypes.find(t => t.id === chosen)
          const declared = vehicleTypes.find(t => t.id === v.declared_type_code)
          // The consequence of the choice, in money, before it is made.
          const rate = ratePerKm(type, fuelPrice)
          const differs = !!v.declared_type_code && chosen !== v.declared_type_code
          return (
            <div key={v.id} className="li">
              <span className="ico"><TeIcon name={chosen === 'bike' ? 'bike' : 'car'} /></span>
              <div className="grow">
                <div className="b"><span className="mono">{v.reg_no}</span> · {v.full_name}</div>
                <div className="small muted">
                  <span className="mono">{v.emp_code}</span>
                  {declared ? ` · they said ${declared.name}` : ''}
                  {v.ownership && v.ownership !== 'self' ? ` · ${v.ownership === 'family' ? 'a family member’s' : 'someone else’s'}` : ''}
                </div>
                <div className="form">
                  {vehicleTypes.length ? (
                    <label className="fld sm">
                      <span>What it actually is, from the RC</span>
                      <select value={chosen} onChange={e => setChosenType(s => ({ ...s, [v.id]: e.target.value }))}>
                        {vehicleTypes.filter(t => t.on).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <small>Paid at {rs(rate)} a km{differs ? ', not what they declared' : ''}.</small>
                    </label>
                  ) : (
                    // The vehicle types come from the admin config, which a desk
                    // user may not be able to read. Confirming still works; it
                    // keeps the type the employee declared.
                    <div className="note">
                      <TeIcon name="info" size="sm" />
                      <span>
                        The vehicle types are not visible to you, so confirming keeps
                        {declared ? ` ${declared.name}` : ' what the employee declared'}.
                        An administrator can change the type afterwards.
                      </span>
                    </div>
                  )}
                  {v.rc_file_url ? (
                    // This used to say "open it from the claim or the employee
                    // record". There was nowhere to open it, and comparing the
                    // RC is the entire job on this row.
                    <TeFileLink path={v.rc_file_url} name="Open the RC photo" kind="RC" small />
                  ) : (
                    <p className="small muted">No RC photo was attached.</p>
                  )}
                </div>
              </div>
              <button type="button" className="btn sm pri" disabled={busy === v.id} onClick={() => verify(v)}>
                {busy === v.id ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          )
        })}
      </div>
      ) : null}
    </div>
  )
}
