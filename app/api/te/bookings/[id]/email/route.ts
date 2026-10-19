// POST /api/te/bookings/[id]/email — send the traveller their ticket.
//
// WHEN. Only once the booking has been RECORDED and is standing: a ticket is
// not a ticket until the desk has it, and a cancelled booking must never be
// mailed as though the trip were on. The desk presses this; nothing sends
// itself, so a wrong attachment or a mistyped PNR is caught by the person who
// just typed it rather than landing in the traveller's inbox first.
//
// AGAIN IS FINE. Travellers lose emails and itineraries change. The record
// holds the LAST send (te_bookings.emailed_at / emailed_to), not a count, and
// this route is happy to be called twice.
//
// WHO. The same right as acting on the booking at all — Travel Claims (edit)
// on a booking of this company. Deliberately NOT the "May book" right:
// recording and cancelling commit company money, and sending somebody their
// own ticket does not. A desk member who may not spend may still post the
// ticket on.
//
// NO PROVIDER MEANS NO SEND, AND IT SAYS SO. Other modules in this repo record
// "emailed" even when RESEND_API_KEY is absent, so the flow appears to work.
// For a ticket that is a lie with consequences: the desk would believe the
// traveller is holding a boarding pass they have never been sent. This refuses
// instead.
import { NextRequest } from 'next/server'
import { tePermitFor, teRoute } from '@/lib/te/server'
import { TeHttpError, needUuid, rpcError } from '@/lib/te/errors'
import { addressFor, renderBookingMail, type BookingMailFacts, type MailTemplate } from '@/lib/te/booking-mail'
import { bookingEmailed } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'onboarding-docs'

/** A date as the traveller reads it on a ticket. */
function readable(d: string | null): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return ''
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]
  return `${day} ${dt.getUTCDate()} ${mon} ${dt.getUTCFullYear()}`
}

/** Plain text to the simplest HTML that keeps its line breaks, with the text
 *  escaped: a traveller's name or a hotel's remark is not markup. */
function asHtml(text: string): string {
  const safe = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<div style="font:14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;white-space:pre-wrap">${safe}</div>`
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const bookingId = needUuid(id, 'Booking')
    await tePermitFor(t, 'te_bookings', bookingId, 'Travel Claims', 'EDIT')
    const sb = t.sb()

    const bk = await sb.from('te_bookings')
      .select('id, company_id, booking_no, trip_id, leg_id, point_seq, kind, vendor, reference, amount, status, ticket_url')
      .eq('id', bookingId).maybeSingle()
    if (bk.error) throw rpcError(bk.error, 'te_bookings')
    const b = bk.data
    if (!b) throw new TeHttpError(404, 'TE_BOOKING', 'Booking not found.')
    if (b.status !== 'BOOKED') {
      throw new TeHttpError(409, 'TE_BOOKING', b.status === 'CANCELLED'
        ? 'This booking is cancelled. Sending it would tell the traveller their travel is on.'
        : 'This is a request, not a booking yet. Record the booking first.')
    }
    if (!b.ticket_url) {
      throw new TeHttpError(409, 'TE_BOOKING', 'There is no ticket on this booking to send.')
    }

    // The trip and the traveller. THE TRIP'S OWN ADDRESS IS THE ONE TO USE:
    // the traveller was asked for it on the form, prefilled from their ESS
    // record and editable, so somebody who wants their itinerary somewhere
    // other than their work inbox while they are away has already said so.
    // The record is the fallback for trips planned before the form asked.
    const trip = await sb.from('te_trips')
      .select('id, trip_no, name, employee_id, company_id, contact_email')
      .eq('id', b.trip_id).maybeSingle()
    if (trip.error) throw rpcError(trip.error, 'te_trips')
    if (!trip.data) throw new TeHttpError(404, 'TE_BOOKING', 'The trip behind this booking has gone.')
    const who = await sb.from('employees').select('full_name, office_email, personal_email')
      .eq('id', trip.data.employee_id as string).maybeSingle()
    if (who.error) throw rpcError(who.error, 'employees')
    const addr = addressFor({ ...(who.data ?? {}), trip_email: trip.data.contact_email as string | null })
    if (!addr) {
      throw new TeHttpError(409, 'TE_BOOKING', 'There is no email address on this trip or on that employee’s record, so there is nowhere to send this. Ask them to add one to the trip.')
    }

    // What the ticket is FOR, in the words a traveller recognises: the leg's
    // own places and date, or the stay's city. Read from the desk's own view so
    // the wording matches the row the desk just acted on.
    const row = await sb.from('v_te_to_book').select('from_name, to_name, on_date, mode')
      .eq('trip_id', b.trip_id).eq('company_id', b.company_id as string).limit(1)
    const leg = row.error ? null : (row.data?.[0] ?? null)
    const legs = b.leg_id
      ? await sb.from('te_legs').select('leg_date, mode, from_place_id, to_place_id').eq('id', b.leg_id as string).maybeSingle()
      : { data: null, error: null }
    const places = new Map<string, string>()
    if (legs.data) {
      const ids = [legs.data.from_place_id, legs.data.to_place_id].filter(Boolean) as string[]
      if (ids.length) {
        const pl = await sb.from('te_places').select('id, short_name').in('id', ids)
        for (const p of pl.data ?? []) places.set(p.id as string, (p.short_name as string | null) ?? '')
      }
    }
    const route = legs.data
      ? `${places.get(legs.data.from_place_id as string) ?? ''} → ${places.get(legs.data.to_place_id as string) ?? ''}`
      : (leg?.to_name as string | null) ?? trip.data.name as string
    const on = readable((legs.data?.leg_date as string | null) ?? (leg?.on_date as string | null) ?? null)
    const kindWord = b.kind === 'hotel' ? 'Stay' : ((legs.data?.mode as string | null) ?? 'Travel')

    // The company's own wording, or the default. te_settings.extra is where a
    // setting an admin adds later lives; a company that has never touched it
    // gets a template that is sendable as it stands.
    const settings = await sb.from('te_settings').select('extra').eq('company_id', b.company_id as string).maybeSingle()
    if (settings.error) throw rpcError(settings.error, 'te_settings')
    const extra = (settings.data?.extra ?? {}) as Record<string, unknown>
    const template = (extra.bookingMail ?? null) as Partial<MailTemplate> | null

    const company = await sb.from('companies').select('company_name').eq('id', b.company_id as string).maybeSingle()
    const sender = await sb.from('employees').select('full_name').eq('id', await t.employee()).maybeSingle()

    const facts: BookingMailFacts = {
      name: (who.data?.full_name as string | null) ?? '',
      tripNo: trip.data.trip_no as string,
      tripName: trip.data.name as string,
      route,
      on,
      vendor: b.vendor as string,
      reference: b.reference as string,
      amount: `₹${Number(b.amount ?? 0).toLocaleString('en-IN')}`,
      kind: kindWord,
      company: (company.data?.company_name as string | null) ?? '',
      from: (sender.data?.full_name as string | null) ?? 'Travel Desk',
    }
    const mail = renderBookingMail(template, facts)

    // CHECKED BEFORE THE FILE IS FETCHED. A missing provider is a deployment
    // problem, not a data one, so there is no point pulling a PDF out of
    // storage to then refuse. It is checked after the booking's own problems
    // (cancelled, no ticket, no address) because those are the ones the desk
    // can actually do something about.
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new TeHttpError(503, 'TE_NOT_CONFIGURED', 'No email provider is set up on this deployment, so nothing was sent. Ask an administrator to configure RESEND_API_KEY.')
    }

    // THE TICKET. A stored path is attached; an http link — which is what the
    // desk used before there was a file field — cannot be, so it goes into the
    // body as a link rather than being silently dropped.
    const ticketPath = b.ticket_url as string
    const isLink = /^https?:\/\//i.test(ticketPath)
    let attachment: { filename: string; content: string } | null = null
    if (!isLink) {
      const dl = await sb.storage.from(BUCKET).download(ticketPath)
      if (dl.error || !dl.data) {
        throw new TeHttpError(502, 'TE_BOOKING', 'The ticket file could not be read from storage, so nothing was sent. Try again.')
      }
      const bytes = Buffer.from(await dl.data.arrayBuffer())
      attachment = {
        filename: ticketPath.split('/').pop() || `${b.booking_no}.pdf`,
        content: bytes.toString('base64'),
      }
    }
    const body = isLink ? `${mail.body}\n\nYour booking: ${ticketPath}` : mail.body

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.HR_DEFAULT_EMAIL || 'hr@ezer-hrms.com',
        to: addr.to,
        subject: mail.subject,
        html: asHtml(body),
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    })
    if (!res.ok) {
      const said = (await res.text()).slice(0, 200)
      console.error('[te] booking mail failed', said)
      throw new TeHttpError(502, 'TE_BOOKING', 'The email provider refused the message, so nothing was sent. Try again, and tell your administrator if it keeps happening.')
    }

    // Recorded only now, after the provider has taken it: the row says what
    // happened, not what was attempted.
    await bookingEmailed(await t.ctx(), bookingId, addr.to)
    return { sent: true, to: addr.to, address_kind: addr.kind, subject: mail.subject, attached: !!attachment }
  })
}
