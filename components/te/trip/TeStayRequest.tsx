'use client'
// components/te/trip/TeStayRequest.tsx — asking the Travel Desk for a hotel.
//
// The employee has found somewhere to stay and wants the desk to book it.
// Nothing is bought here: this writes a REQUESTED booking with no reference
// and no expense line, because putting a cost on the trip for a stay that may
// never be booked would corrupt the sheet the approver reads. The desk turns
// it into a real booking with te_booking_record, which is when the expense
// appears.
//
// WHICH STOP. A stay belongs to a place on the route, not to a leg, so the
// picker lists the trip's points. The start is offered too — people do stay
// near the office the night before an early flight — but the dates default
// from the point itself, which is almost always what is meant.
//
// THE LINK. Whatever page the hotel was found on. It is stored as given and
// rendered as a link out, never fetched: see TeFileLink, which tells an
// external URL apart from a path in the private bucket.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import { errorText, rs } from '@/lib/te/format'
import type { TeTripDetail as TripDetail, Uuid } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TeStayRequest({ detail, placeName, onDone, onCancel }: {
  detail: TripDetail
  placeName: (id: Uuid) => string
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const points = detail.trip.points ?? []
  // Default to the first place that is not the start: where you actually stay.
  const [seq, setSeq] = useState(() => (points.length > 1 ? 1 : 0))
  const point = points[seq]

  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [link, setLink] = useState('')
  const [checkIn, setCheckIn] = useState(() => points[1]?.arrive || '')
  const [checkOut, setCheckOut] = useState(() => points[1]?.leave || '')
  const [address, setAddress] = useState('')
  const [room, setRoom] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The server decides; this only avoids offering a send that cannot work.
  const ready = !!vendor.trim() && Number(amount) > 0

  function pickStop(next: number) {
    setSeq(next)
    // The dates follow the stop unless they have been typed over.
    const p = points[next]
    if (p && !checkIn) setCheckIn(p.arrive || '')
    if (p && !checkOut) setCheckOut(p.leave || '')
  }

  async function send() {
    if (!ready || busy) return
    setBusy(true); setError('')
    try {
      const r = await te.stayRequest({
        trip_id: detail.trip.id,
        point_seq: seq,
        vendor: vendor.trim(),
        amount: Number(amount),
        ...(link.trim() ? { ticket_url: link.trim() } : {}),
        details: {
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(room.trim() ? { room: room.trim() } : {}),
          ...(checkIn ? { check_in: checkIn } : {}),
          ...(checkOut ? { check_out: checkOut } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          // Where it was found, taken from the link rather than asked for.
          ...(platformOf(link) ? { platform: platformOf(link)! } : {}),
        },
      })
      onDone(`Asked the Travel Desk to book ${vendor.trim()} · ${r.booking_no}`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="ch"><h3>Ask the desk to book a stay</h3></div>
      <div className="form">
        {points.length > 1 ? (
          <label className="fld sm">
            <span>Where you are staying</span>
            <select value={seq} onChange={e => pickStop(Number(e.target.value))}>
              {points.map((p, i) => (
                <option key={i} value={i}>
                  {placeName(p.place) || `Stop ${i + 1}`}{i === 0 ? ' (where you start)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="fld sm"><span>Hotel</span>
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="The name of the hotel" />
        </label>

        <div className="g2">
          <label className="fld sm"><span>Check in</span>
            <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} />
          </label>
          <label className="fld sm"><span>Check out</span>
            <input type="date" value={checkOut} min={checkIn || undefined} onChange={e => setCheckOut(e.target.value)} />
          </label>
        </div>

        <label className="fld sm"><span>What you expect it to cost (₹)</span>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} />
          <small>{Number(amount) > 0 ? `About ${rs(Number(amount))} for the stay.` : 'The desk books against this, so an estimate is enough.'}</small>
        </label>

        <label className="fld sm"><span>Link to the hotel</span>
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://www.makemytrip.com/hotels/…" />
          <small>{platformOf(link) ? `From ${platformOf(link)}. The desk and your approver can open it.` : 'Any booking site. Paste the page you found.'}</small>
        </label>

        <label className="fld sm"><span>Address, if you have it</span>
          <input value={address} onChange={e => setAddress(e.target.value)} />
        </label>
        <div className="g2">
          <label className="fld sm"><span>Room</span>
            <input value={room} onChange={e => setRoom(e.target.value)} placeholder="Standard, twin, …" />
          </label>
          <label className="fld sm"><span>Anything else</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Near the client office" />
          </label>
        </div>

        <div className="note">
          <TeIcon name="info" size="sm" />
          <span>
            This asks the Travel Desk to book it. Nothing is charged to the trip until they do, and
            {point ? ` it is recorded against ${placeName(point.place) || 'this stop'}.` : ' it is recorded against this trip.'}
          </span>
        </div>

        {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

        <div className="row tight">
          <button type="button" className="btn" onClick={onCancel}>Never mind</button>
          <button type="button" className="btn pri" disabled={!ready || busy} onClick={send}>
            {busy ? 'Sending…' : 'Ask the desk'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The site a link points at, for the subtitle and for `details.platform`.
 *  Best-effort only: an unparseable address simply has no platform. */
function platformOf(url: string): string | null {
  const v = url.trim()
  if (!v) return null
  try {
    const host = new URL(v).hostname.replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}
