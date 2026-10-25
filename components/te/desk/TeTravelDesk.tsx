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
import { te, type DeskBooked, type DeskJourney, type DeskStay, type DeskToBook, type DeskVehicle, type DeskWatch } from '@/lib/te/client'
import { ratePerKm } from '@/lib/te/vehicle'
import { errorText, day, rs } from '@/lib/te/format'
import type { TeMode, TeUploadedFile, TeVehicleType } from '@/lib/te/types'
import type { ChainStep } from '@/lib/te/approval-chain'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'
import TeChain from '../TeChain'
import TeContact from '../TeContact'
import { focusDeskRows } from '@/lib/te/desk-buckets'
import TeDeskByTrip from './TeDeskByTrip'
import TeStayChoice from './TeStayChoice'
import TeJourneyReview from './TeJourneyReview'

type Room = 'trips' | 'stays' | 'book' | 'booked' | 'vehicles' | 'watch' | 'journeys'

export default function TeTravelDesk({ vehicleTypes, fuelPrice, modes, onOpenTrip, onToast }: {
  /** cfg.vehicles — the types a vehicle can be, and what each pays. */
  vehicleTypes: TeVehicleType[]
  fuelPrice: Record<string, number>
  /** cfg.modes — needed only for `basis`, which decides whether a journey with
   *  no bill attached is missing something. A cab is paid on its bill; own
   *  vehicle is paid per km and is not missing anything. */
  modes: TeMode[]
  /** Open the whole trip behind a row. A desk row is one line of somebody's
   *  plan; everything they filled in — the route, the times they asked for, the
   *  hotels they suggested, who else is going — is on the trip screen. */
  onOpenTrip?: (tripId: string) => void
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
  // Travel the desk is not booking anything for. Information, never work.
  const [watch, setWatch] = useState<DeskWatch[]>([])
  // Recorded journeys waiting for the desk to agree they happened — including
  // the local sub-trips a traveller adds while away, which reach a human here
  // and nowhere else. Empty while migration 180 is unapplied.
  const [journeys, setJourneys] = useState<DeskJourney[]>([])
  // Where each request has got to, keyed by trip id.
  const [chains, setChains] = useState<Record<string, ChainStep[]>>({})
  // Whether this reader may spend. A desk member without "May book" belongs on
  // the desk — vehicles and hotels are their work — so the screen stays whole
  // and only the two controls that commit money go away. Starts true so the
  // controls do not flicker out from under somebody who does have the right.
  const [mayBook, setMayBook] = useState(true)
  const [error, setError] = useState('')
  const [booking, setBooking] = useState<DeskToBook | null>(null)
  const [form, setForm] = useState({ vendor: '', reference: '', amount: '' })
  // THE TICKET ITSELF. te_booking_record refuses a booking without one since
  // migration 178: the traveller is sent this and Finance matches the bill to
  // it, and the desk holds the file now rather than a week from now. Uploaded
  // the moment it is chosen, so what is kept here is the stored file and not
  // the bytes.
  const [ticket, setTicket] = useState<TeUploadedFile | null>(null)
  const [chosenType, setChosenType] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.desk.list()
      .then(r => { if (current) { setToBook(r.to_book ?? []); setBooked(r.booked ?? []); setVehicles(r.vehicles ?? []); setStays(r.stays ?? []); setWatch(r.watch ?? []); setJourneys(r.journeys ?? []); setChains(r.chains ?? {}); setMayBook(r.may_book !== false); setError('') } })
      .catch(e => { if (current) { setToBook([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

  const keyOf = (b: DeskToBook) => `${b.trip_id}:${b.leg_id ?? b.point_seq ?? b.kind}`
  /** Whether this row can actually be booked yet. Since migration 177 the list
   *  also carries trips still waiting for their approvers, so the desk gets the
   *  lead time the notice rule promises it — but te_booking_record still
   *  refuses anything but APPROVED, and a button that cannot work should not be
   *  offered. Absent trip_status means 177 is unapplied, and then every row in
   *  this list was approved to get here. */
  const approved = (b: DeskToBook) => !b.trip_status || b.trip_status === 'APPROVED'
  // The ticket is part of being ready, because the floor refuses without it.
  // Gating here means the desk is told before it presses, not after a 409.
  const ready = !!form.vendor.trim() && !!form.reference.trim() && Number(form.amount) > 0 && !!ticket

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
        // The stored path, not a signed link: a signed one expires and this is
        // read back months later by Finance.
        ...(ticket ? { ticket_url: ticket.storage_path } : {}),
      })
      onToast(`Booking ${r.booking_no} recorded against ${booking.trip_no}.`)
      setBooking(null); setForm({ vendor: '', reference: '', amount: '' }); setTicket(null); reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  /** Send the traveller their ticket. Only ever pressed, never automatic: a
   *  wrong attachment or a mistyped PNR is caught by the person who just typed
   *  it rather than landing in somebody's inbox first. Safe to press again —
   *  travellers lose emails. */
  async function emailTicket(b: DeskBooked) {
    setBusy(`mail:${b.id}`); setError('')
    try {
      const r = await te.desk.bookingEmail(b.id)
      onToast(`${b.booking_no} sent to ${r.to}${r.address_kind === 'personal' ? ' (personal address)' : ''}.`)
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  /** Store the ticket the airline or hotel sent back. Uploaded on choosing,
   *  so by the time Record is pressed there is a path to hand over and no
   *  second thing that can fail. */
  async function attach(picked: File) {
    setBusy('ticket'); setError('')
    try {
      setTicket(await te.upload(picked, 'TICKET'))
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

  const allBookings = toBook ?? []

  /** The trip every room is narrowed to, or null for all of them.
   *
   *  WHY IT IS ONE TRIP AND NOT A PERSISTENT MODE. A room narrowed to a trip
   *  and left that way turns "nothing to do" into "nothing for this trip",
   *  which are opposite messages wearing the same empty list. It is shown as a
   *  chip the whole time it is on, and every room that honours it says how many
   *  rows it is hiding. */
  const [focus, setFocus] = useState<{ tripId: string; tripNo: string } | null>(null)
  // Narrowed through focusDeskRows, which knows a hotel row's trip id is `id`
  // rather than `trip_id` — filtering those on trip_id empties the room and
  // reads as "nothing to choose" while somebody waits on the answer.
  const fid = focus?.tripId ?? null
  const bookings = focusDeskRows('book', allBookings, fid)
  const staysHere = focusDeskRows('stays', stays, fid)
  const bookedHere = focusDeskRows('booked', booked, fid)
  const journeysHere = focusDeskRows('journeys', journeys, fid)
  const watchHere = focusDeskRows('watch', watch, fid)

  // In the order work flows: a hotel is chosen, then it and the tickets are
  // booked, then what was booked can be undone. Vehicles are their own thing
  // and sit last.
  const rooms: { k: Room; label: string; icon: string; n: number }[] = [
    // FIRST, because "where are we on this trip" is the question the desk is
    // asked most and the rooms answer it worst: the same work, gathered under
    // the trip it belongs to. The rooms below are unchanged.
    { k: 'trips', label: 'By trip', icon: 'route', n: 0 },
    { k: 'stays', label: 'Hotels to choose', icon: 'home', n: stays.length },
    { k: 'book', label: 'To book', icon: 'plane', n: allBookings.length },
    { k: 'booked', label: 'Booked', icon: 'check', n: booked.length },
    // Journeys that have happened and are waiting to be agreed. After the
    // booking rooms because it is work about the past, not about a ticket
    // nobody has bought yet.
    { k: 'journeys', label: 'Journeys', icon: 'route', n: journeys.filter(j => !j.desk_confirmed_at).length },
    // Last, and counted, because it is the only list here with nothing to do.
    { k: 'watch', label: 'For information', icon: 'people', n: watch.length },
    { k: 'vehicles', label: 'Vehicles', icon: 'car', n: vehicles.length },
  ]
  // Where the work is. Only used until somebody chooses for themselves —
  // after that `room` is set and this is ignored, so the tab does not jump
  // out from under a person who has just emptied the room they were in.
  // "For information" is excluded on purpose: it is the one room with nothing
  // to act on, so landing a desk person in it would be the exact failure the
  // note above describes, in a new place.
  // 'trips' carries no count of its own (it is a view OF the others), so it is
  // never the room somebody is dropped into — the same reasoning that keeps
  // 'watch' out of this.
  const firstWithWork = rooms.find(r => r.n && r.k !== 'watch' && r.k !== 'trips')?.k ?? 'trips'
  const here = room ?? firstWithWork

  /** Leaving a room abandons whatever was half-typed in it. Coming back to a
   *  booking form still open over a different trip, or to a cancellation
   *  reason typed for a booking you have since scrolled away from, is how a
   *  reason ends up filed against the wrong row. */
  const goRoom = (k: Room, on?: { tripId: string; tripNo: string } | null) => {
    setRoom(k)
    // Passing undefined leaves the focus alone (a tab click); passing null
    // clears it, which is what "show all" does.
    if (on !== undefined) setFocus(on)
    setBooking(null)
    setTicket(null)
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

      {/* SAID WHILE IT IS ON, not just when it is set. An empty room under a
          silent filter is the worst screen here: it reads as "nothing to do"
          when it means "nothing for this trip". */}
      {focus ? (
        <div className="note">
          <TeIcon name="pin" size="sm" />
          <span>
            Showing <span className="mono">{focus.tripNo}</span> only
            {(() => {
              // How much is being held back, said plainly. "2 of 7" is the
              // difference between "nothing to do" and "nothing for this trip".
              const shown = staysHere.length + bookings.length + bookedHere.length + journeysHere.length + watchHere.length
              const all = stays.length + allBookings.length + booked.length + journeys.length + watch.length
              return all > shown ? <> — {shown} of {all} rows across the desk</> : null
            })()}
            . Other trips&rsquo; work is still here.
          </span>
          <button type="button" className="btn sm" onClick={() => setFocus(null)}>Show all trips</button>
        </div>
      ) : null}

      {/* Choosing comes before booking, because it is what produces something
          to book. A trip sitting here has somebody waiting on an answer. */}
      {here === 'trips' ? (
        <TeDeskByTrip
          stays={stays}
          toBook={allBookings}
          booked={booked}
          journeys={journeys}
          watch={watch}
          onGoRoom={goRoom}
          onOpenTrip={onOpenTrip}
        />
      ) : null}

      {here === 'stays' ? <TeStayChoice stays={staysHere} onDone={message => { onToast(message); reload() }} onOpenTrip={onOpenTrip} /> : null}

      {here === 'book' ? (
      <div className="card pad0">
        <div className="day"><span>To book</span><span>{bookings.length}</span></div>
        {/* Said once, at the top, rather than leaving a list of work with no
            button on it and no reason given. */}
        {!mayBook ? (
          <div className="note">
            <TeIcon name="info" size="sm" />
            <span>You can see what is waiting, but booking is not switched on for you. An administrator sets &ldquo;May book&rdquo; on the travel desk.</span>
          </div>
        ) : null}
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
                {/* WHERE IT HAS GOT TO, not merely that it is waiting. On a
                    two-step chain "waiting for approval" covers both a trip
                    nobody has opened and one where R1 has signed and only the
                    Head of department is left — the same status, and very
                    different news for a desk deciding whether to hold a fare
                    today. Shown on an approved trip too: knowing who approved
                    it is the answer to "can I book this". */}
                <TeChain steps={chains[b.trip_id] ?? []} />
                {/* Straight from the employee record, every request. */}
                <TeContact who={b} />
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
                    {/* REQUIRED, and said so. The floor refuses a booking with
                        no ticket, so the form asks for it rather than letting
                        somebody fill three fields and meet a refusal. */}
                    <label className="fld sm">
                      <span>{b.kind === 'hotel' ? 'The booking slip' : 'The ticket'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                        disabled={busy === 'ticket'}
                        onChange={e => { const f = e.target.files?.[0]; if (f) void attach(f) }}
                      />
                      <small>
                        {busy === 'ticket' ? 'Attaching…'
                          : ticket ? `Attached: ${ticket.file_name}`
                            : 'A PDF or a photo. The traveller is sent this, and Finance matches the bill to it.'}
                      </small>
                    </label>
                    <div className="note">
                      <TeIcon name="info" size="sm" />
                      {/* The point of the distinction, said out loud. */}
                      <span>This is recorded as paid by the company. It is added to the trip so the employee cannot claim it again.</span>
                    </div>
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => { setBooking(null); setTicket(null) }}>Cancel</button>
                      <button type="button" className="btn pri" disabled={!ready || busy === 'book'} onClick={record}>
                        {busy === 'book' ? 'Recording…' : 'Record the booking'}
                      </button>
                      {!ticket && form.vendor.trim() && form.reference.trim() && Number(form.amount) > 0
                        ? <span className="small muted">Attach the ticket to record this.</span>
                        : null}
                    </div>
                  </div>
                ) : null}
              </div>
              {/* THE WHOLE PLAN, not the fragment of it on this row. A desk
                  cannot judge a flight from "Delhi T3 to Pune, 15 Dec": the
                  times the traveller asked for, the hotels they suggested, who
                  else is going and why they are going are all on the trip. */}
              {!open && onOpenTrip ? (
                <button type="button" className="btn sm" onClick={() => onOpenTrip(b.trip_id)}>Details</button>
              ) : null}
              {!open && mayBook && approved(b) ? (
                <button type="button" className="btn sm pri" onClick={() => { setBooking(b); setForm({ vendor: '', reference: '', amount: '' }); setTicket(null) }}>Record</button>
              ) : null}
              {!open && mayBook && !approved(b) ? (
                // Not a disabled Record button: there is nothing wrong with the
                // row and nothing for the desk to fix. Look at fares, hold an
                // option, then book it when the approval lands.
                <span className="small muted">Book once approved</span>
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
          {bookedHere.map(b => (
            <div key={b.id} className="li">
              <span className="ico"><TeIcon name={b.kind === 'hotel' ? 'pin' : 'plane'} /></span>
              <div className="grow">
                <div className="b"><span className="mono">{b.booking_no}</span> · {b.vendor}</div>
                <div className="small muted">
                  {b.full_name} <span className="mono">{b.emp_code}</span> · {b.trip_name}
                  {' · '}<span className="mono">{b.reference}</span> · {rs(b.amount)}
                  {b.booked_at ? ` · ${day(b.booked_at)}` : ''}
                </div>
                {/* WHETHER THE TRAVELLER HAS IT. A desk that cannot tell sent
                    from unsent either sends twice or never — and "never" means
                    somebody reaches an airport without a booking reference. */}
                <div className="row tight" style={{ marginTop: 4 }}>
                  {b.emailed_at
                    ? <span className="chip t-pos">Sent to {b.emailed_to}</span>
                    : b.ticket_url
                      ? <span className="chip t-warn">Not sent yet</span>
                      // Recorded before the ticket field existed, or a link
                      // rather than a file. Say which, so the desk knows the
                      // button is missing for a reason.
                      : <span className="chip plain">No ticket attached</span>}
                </div>
                {/* A booked ticket is the most likely thing to need a call:
                    a schedule change reaches the desk, not the traveller. */}
                <TeContact who={b} />
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
              {cancelling !== b.id && b.ticket_url ? (
                <button type="button" className="btn sm" disabled={busy === `mail:${b.id}`} onClick={() => emailTicket(b)}>
                  <TeIcon name="mail" size="sm" />
                  {busy === `mail:${b.id}` ? 'Sending…' : b.emailed_at ? 'Send again' : 'Email the ticket'}
                </button>
              ) : null}
              {cancelling !== b.id && onOpenTrip ? (
                <button type="button" className="btn sm" onClick={() => onOpenTrip(b.trip_id)}>Details</button>
              ) : null}
              {cancelling !== b.id && mayBook ? (
                <button type="button" className="btn sm dan" onClick={() => { setCancelling(b.id); setWhy(''); setError('') }}>Cancel</button>
              ) : null}
            </div>
          ))}
        </div>
        ) : (
          <div className="empty"><b>Nothing is booked</b>Tickets and rooms the desk has recorded appear here, so one can be cancelled when a trip changes.</div>
        )
      ) : null}

      {/* JOURNEYS THAT HAVE HAPPENED. The desk agrees they did, or asks the
          traveller about one. This is the only place a GPS sub-trip — a journey
          added mid-trip — is ever seen by this team: it cannot appear in "To
          book", because an added journey is always self-booked and that list
          only shows desk-booked legs that have not started. */}
      {here === 'journeys' ? (
        <TeJourneyReview
          rows={journeysHere}
          desk="travel"
          basisOf={m => modes.find(x => x.id === m)?.basis}
          onOpenTrip={onOpenTrip}
          onDone={reload}
          onToast={onToast}
        />
      ) : null}

      {/* FOR INFORMATION. Travel the desk is not booking anything for, because
          the traveller is arranging every leg themselves and asked for no
          hotel. The desk wanted to know what is moving in its company; it is
          kept out of "To book" so a work list stays work. */}
      {here === 'watch' ? (
        watch.length ? (
        <div className="card pad0">
          <div className="day"><span>For information</span><span>{watch.length}</span></div>
          <div className="note">
            <TeIcon name="info" size="sm" />
            <span>Nothing here is yours to book — every journey is the traveller&rsquo;s own and no hotel was asked for. It is listed so you know what is travelling.</span>
          </div>
          {watchHere.map(w => (
            // Nothing on this row competes for the click, so the row itself is
            // the control. Rendered as a button, not a div with an onClick, so
            // it is reachable by keyboard and announced as what it is.
            <div key={w.trip_id} className={`li${onOpenTrip ? ' click' : ''}`}
                 {...(onOpenTrip ? { role: 'button', tabIndex: 0, onClick: () => onOpenTrip(w.trip_id),
                   onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTrip(w.trip_id) } } } : {})}>
              <span className="ico"><TeIcon name={w.scope === 'local' ? 'local' : w.scope === 'international' ? 'international' : 'domestic'} /></span>
              <div className="grow">
                <div className="b"><span className="mono">{w.trip_no}</span> · {w.trip_name}</div>
                <div className="small muted">
                  {w.full_name} <span className="mono">{w.emp_code}</span>
                  {' · '}{day(w.start_date)}{w.end_date !== w.start_date ? ` to ${day(w.end_date)}` : ''}
                  {' · '}{w.leg_count} journey{w.leg_count === 1 ? '' : 's'}, all their own
                </div>
                <TeContact who={w} />
              </div>
              <TeChain steps={chains[w.trip_id] ?? []} compact />
            </div>
          ))}
        </div>
        ) : (
          <div className="empty"><b>Nothing else travelling</b>Trips the desk is not booking for appear here, so you can see what is moving without them crowding the work list.</div>
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
