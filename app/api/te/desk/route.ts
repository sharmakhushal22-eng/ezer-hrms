// GET /api/te/desk — the Travel Desk's work for the caller's company:
//   to_book    tickets and hotel stays the desk still has to book (v_te_to_book).
//              Includes trips still WAITING for approval, since migration 177:
//              each row carries trip_status so the screen can show the wait and
//              withhold the Record button. Seeing is not booking —
//              te_booking_record still refuses anything but APPROVED.
//   booked     what the desk has already recorded, so a booking can be cancelled when a trip changes
//   stays      trips where hotels were suggested and nobody has chosen one yet
//   vehicles   vehicles whose RC could not be checked automatically and wait for a person to look at the photo
//   watch      travel the desk is NOT booking — every leg the traveller's own,
//              no hotel asked for. For information only, never work.
//   journeys   recorded journeys waiting for the desk to agree they happened
//              (v_te_journey_review, migration 180). This is where a GPS
//              sub-trip — a journey added mid-trip, kind='extra' — finally
//              reaches a human: it can never appear in to_book, because an
//              added journey is always self-booked and to_book only shows
//              desk-booked legs that have not started.
// Needs a place on the travel desk, or the dashboard Travel Claims permission.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { missingSchema, rpcError } from '@/lib/te/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    // WHO MAY OPEN THE TRAVEL DESK. Being on the desk, or holding full admin
    // access to the module. It used to be the dashboard "Travel Claims" EDIT
    // permission alone, which in this data is every HR Manager — eleven
    // people, none of whom was asked to book a ticket. Membership is now the
    // primary test and the permission is the administrator's way in.
    //
    // Falls back to the old test while migration 161 is unapplied: te_on_desk
    // does not exist yet then, and the desk must not go dark in between.
    // The same rule the Finance routes use, in the same one place.
    if (!(await t.onDesk('travel')) && !(await t.holds('Travel Claims', 'FULL'))) {
      await t.permit('Travel Claims', 'EDIT')
    }
    const company = await t.company()
    const sb = t.sb()
    // NOT YOUR OWN VEHICLE. te_vehicle_verify refuses the actor's own row —
    // "Nobody verifies their own vehicle" — so a desk member who declares a
    // car used to see it in their own queue under a Confirm button that could
    // only ever fail. A work list should hold work the reader can do; somebody
    // else on the desk still sees it.
    const employeeId = await t.employee()
    const [book, veh, done, stays, watch, jrny] = await Promise.all([
      sb.from('v_te_to_book').select('*').eq('company_id', company).order('on_date', { ascending: true }).limit(500),
      sb.from('te_employee_vehicles')
        .select('id, employee_id, reg_no, vehicle_type_code, declared_type_code, ownership, rc_file_url, created_at')
        .eq('company_id', company).eq('is_active', true).eq('is_verified', false)
        .neq('employee_id', employeeId).order('created_at', { ascending: true }).limit(500),
      // Only what is still standing: a cancelled booking is history, and the
      // only thing left to do with a live one is cancel it.
      sb.from('te_bookings')
        .select('id, booking_no, trip_id, leg_id, point_seq, kind, vendor, reference, amount, paid_by, status, booked_at, ticket_url, emailed_at, emailed_to')
        .eq('company_id', company).eq('status', 'BOOKED').order('booked_at', { ascending: false }).limit(200),
      // Trips where somebody asked for a stay, named hotels, and nobody has
      // answered yet. stay_status = 'NONE' is exactly that, and there is a
      // partial index on this predicate.
      sb.from('te_trips')
        .select('id, trip_no, name, employee_id, scope, start_date, end_date, stay_options, stay_by')
        .eq('company_id', company).eq('stay_wanted', true).eq('stay_status', 'NONE')
        .not('status', 'in', '(CANCELLED,REJECTED)')
        .order('start_date', { ascending: true }).limit(200),
      // Travel the desk is NOT booking: every leg is the traveller's own and no
      // hotel was asked for. Shown for information, never as work.
      sb.from('v_te_desk_watch').select('*').eq('company_id', company)
        .order('start_date', { ascending: true }).limit(200),
      // RECORDED JOURNEYS WAITING TO BE AGREED. A GPS sub-trip reaches a human
      // here and nowhere else: v_te_to_book only ever shows a leg that is still
      // PLANNED and desk-booked, and a journey added during a trip is always
      // self-booked, so it could never appear there at all.
      //
      // Newest first, because the desk is agreeing to things that happened and
      // the thing that happened this morning is the one somebody is waiting on.
      sb.from('v_te_journey_review').select('*').eq('company_id', company)
        .order('leg_date', { ascending: false }).limit(300),
    ])
    if (book.error) throw rpcError(book.error, 'v_te_to_book')
    if (veh.error) throw rpcError(veh.error, 'te_employee_vehicles')
    if (done.error) throw rpcError(done.error, 'te_bookings')
    // 42703 is "column does not exist": migration 158 adds stay_wanted and 159
    // adds stay_status. Until both are applied this half of the desk simply is
    // not there yet, and the desk's other two jobs must not go down with it.
    // Any OTHER error is a real fault and still throws.
    const notMigrated = stays.error?.code === '42703'
    if (stays.error && !notMigrated) throw rpcError(stays.error, 'te_trips')
    const stayRows = notMigrated ? [] : (stays.data ?? [])

    // v_te_desk_watch arrives with migration 177. Same reasoning — the rest of
    // the desk keeps working while that one is unapplied, and any other error is
    // still a real fault. missingSchema covers PostgREST's PGRST205 as well as
    // Postgres's 42P01: a view the API has never seen is reported as the former,
    // which is how the first version of this check let the whole desk 503.
    const noWatch = missingSchema(watch.error)
    if (watch.error && !noWatch) throw rpcError(watch.error, 'v_te_desk_watch')
    const watchRows = noWatch ? [] : (watch.data ?? [])

    // v_te_journey_review arrives with migration 180. Same reasoning again: the
    // desk's booking work must not go dark because the review list is not there
    // yet, and any error that is not a missing object is still a real fault.
    const noJourneys = missingSchema(jrny.error)
    if (jrny.error && !noJourneys) throw rpcError(jrny.error, 'v_te_journey_review')
    const journeyRows = noJourneys ? [] : (jrny.data ?? [])

    // A booking names its trip, not its traveller. The trip is read separately
    // for the same reason the names are below: te_trips links to employees more
    // than once, so an embedded join would have to be disambiguated.
    const tripIds = [...new Set((done.data ?? []).map(b => b.trip_id as string))]
    const trips = new Map<string, { trip_no: string; name: string; employee_id: string }>()
    if (tripIds.length) {
      const { data, error } = await sb.from('te_trips').select('id, trip_no, name, employee_id').in('id', tripIds)
      if (error) throw rpcError(error, 'te_trips')
      for (const t2 of data ?? []) {
        trips.set(t2.id as string, { trip_no: t2.trip_no as string, name: t2.name as string, employee_id: t2.employee_id as string })
      }
    }
    const booked = (done.data ?? []).map(b => {
      const trip = trips.get(b.trip_id as string)
      return { ...b, trip_no: trip?.trip_no ?? '', trip_name: trip?.name ?? '', employee_id: trip?.employee_id ?? '' }
    })

    // Names for both lists in one read (no embedded join: these tables have several links to employees).
    const ids = [...new Set([
      ...(book.data ?? []).map(r => r.employee_id as string),
      ...(veh.data ?? []).map(r => r.employee_id as string),
      ...booked.map(r => r.employee_id),
      ...stayRows.map(r => r.employee_id as string),
      ...watchRows.map(r => r.employee_id as string),
      ...journeyRows.map(r => r.employee_id as string),
    ].filter(Boolean))]
    // WHO THEY ARE, plus the ESS record's numbers — which are the FALLBACK
    // now, not the answer. The answer is on the trip; see tripContact below.
    const names = new Map<string, {
      emp_code: string | null; full_name: string | null
      mobile: string | null; alternate_mobile: string | null
      office_email: string | null; personal_email: string | null
    }>()
    if (ids.length) {
      const { data, error } = await sb.from('employees')
        .select('id, emp_code, full_name, mobile, alternate_mobile, office_email, personal_email').in('id', ids)
      if (error) throw rpcError(error, 'employees')
      for (const e of data ?? []) {
        names.set(e.id as string, {
          emp_code: e.emp_code as string | null,
          full_name: e.full_name as string | null,
          mobile: (e.mobile as string | null) ?? null,
          alternate_mobile: (e.alternate_mobile as string | null) ?? null,
          office_email: (e.office_email as string | null) ?? null,
          personal_email: (e.personal_email as string | null) ?? null,
        })
      }
    }

    // HOW TO REACH THEM ABOUT THIS TRIP, as the traveller left it on the form.
    //
    // The desk used to read the employee record live, which is the right answer
    // to "what is on file for this person" and the wrong one to "how do I reach
    // them about this trip": somebody abroad is on a local SIM, somebody whose
    // handset is in for repair is on a colleague's, and none of that belongs on
    // a permanent HR record. The form asks, prefilled from ESS and editable,
    // and migration 179 stores the answer on the trip. This reads that.
    //
    // THE RECORD IS THE FALLBACK, per field. A trip saved before the form asked
    // carries nothing, and showing the desk a blank where a number should be
    // would be a regression; `from` tells the screen which it got, so an
    // unconfirmed number can be labelled as one.
    // The stay list IS a list of trips, so its row id is the trip id; every
    // other list names its trip in trip_id.
    const contactTrips = [...new Set([
      ...(book.data ?? []).map(r => r.trip_id as string),
      ...booked.map(r => r.trip_id as string),
      ...stayRows.map(r => r.id as string),
      ...watchRows.map(r => r.trip_id as string),
    ].filter(Boolean))]
    const tripContact = new Map<string, { mobile: string; alt: string; email: string }>()
    if (contactTrips.length) {
      const { data, error } = await sb.from('te_trips')
        .select('id, contact_mobile, contact_alt_mobile, contact_email').in('id', contactTrips)
      // 179 is the only reason these columns would be missing. The desk's work
      // list must not go down with the phone numbers beside it.
      if (error && !missingSchema(error)) throw rpcError(error, 'te_trips')
      for (const r of data ?? []) {
        tripContact.set(r.id as string, {
          mobile: ((r.contact_mobile as string | null) ?? '').trim(),
          alt: ((r.contact_alt_mobile as string | null) ?? '').trim(),
          email: ((r.contact_email as string | null) ?? '').trim(),
        })
      }
    }

    const BLANK = { emp_code: null, full_name: null }
    /** The row with the traveller's name and the contact for THIS trip. Pass
     *  the trip id; a row with no trip at all — a vehicle waiting to be
     *  verified — passes none and gets the record, which is correct: there is
     *  no trip to have asked. */
    const withName = <T extends { employee_id: unknown }>(r: T, tripId?: string) => {
      const e = names.get(r.employee_id as string)
      const form = tripId ? tripContact.get(tripId) : undefined
      // ALL FROM THE FORM, OR ALL FROM THE RECORD — never half of each. Mixing
      // them would put a number the traveller deliberately replaced back on the
      // screen next to the one that replaced it, and the desk would have no way
      // to tell which to ring.
      const answered = !!(form && (form.mobile || form.alt || form.email))
      const contact = answered
        ? { mobile: form!.mobile, altMobile: form!.alt, email: form!.email, from: 'form' as const }
        : {
            mobile: (e?.mobile ?? '').trim(),
            altMobile: (e?.alternate_mobile ?? '').trim(),
            email: ((e?.office_email ?? '') || (e?.personal_email ?? '')).trim(),
            from: 'record' as const,
          }
      return { ...r, emp_code: e?.emp_code ?? BLANK.emp_code, full_name: e?.full_name ?? BLANK.full_name, contact }
    }

    // WHERE EACH REQUEST HAS GOT TO. The desk was told "waiting for approval"
    // and nothing else, which on a two-step chain is the difference between a
    // trip it can expect to book tomorrow and one nobody has opened. The steps
    // are read for the trips already on this screen — never the whole table —
    // and the names come from the map built above.
    const chainTrips = [...new Set([
      ...(book.data ?? []).map(r => r.trip_id as string),
      ...watchRows.map(r => r.trip_id as string),
    ].filter(Boolean))]
    const chains: Record<string, unknown[]> = {}
    if (chainTrips.length) {
      const { data, error } = await sb.from('te_approval_steps')
        .select('entity_id, step_no, role_label, status, approver_id, team_code, acted_by, acted_at')
        .eq('entity_type', 'trip').in('entity_id', chainTrips)
        .order('step_no', { ascending: true })
      // A pending migration is the only reason this table would be missing, and
      // the desk's work list must not go down with the chain beside it.
      if (error && !missingSchema(error)) throw rpcError(error, 'te_approval_steps')
      // The approvers are not in `names`: that map was built from the people
      // TRAVELLING. One more read, for the handful of people who approve.
      const approverIds = [...new Set((data ?? []).flatMap(r => [r.approver_id, r.acted_by]).filter(Boolean) as string[])]
      const approvers = new Map<string, string>()
      if (approverIds.length) {
        const who = await sb.from('employees').select('id, full_name').in('id', approverIds)
        if (who.error) throw rpcError(who.error, 'employees')
        for (const e of who.data ?? []) approvers.set(e.id as string, (e.full_name as string | null) ?? '')
      }
      for (const r of data ?? []) {
        const key = r.entity_id as string
        ;(chains[key] ??= []).push({
          stepNo: r.step_no,
          roleLabel: r.role_label,
          status: r.status,
          who: approvers.get(r.approver_id as string) || (r.team_code as string | null) || null,
          actedBy: approvers.get(r.acted_by as string) || null,
          actedAt: r.acted_at,
        })
      }
    }
    return {
      company_id: company,
      // Whether this reader may actually spend. Migration 175 lets a desk
      // member whose "May book" is unticked onto the desk — they verify
      // vehicles and decide stays — so the screen has to stop offering them
      // the one thing they cannot do, rather than let them find out from a 403.
      may_book: await t.deskMayBook(),
      to_book: (book.data ?? []).map(r => withName(r, r.trip_id as string)),
      booked: booked.map(r => withName(r, r.trip_id as string)),
      // No trip behind a vehicle: nobody was asked, so the record stands.
      vehicles: (veh.data ?? []).map(r => withName(r)),
      stays: stayRows.map(r => withName(r, r.id as string)),
      watch: watchRows.map(r => withName(r, r.trip_id as string)),
      /** Recorded journeys, newest first. Each carries its own route as an
       *  encoded polyline and where the two desks have got to on it. */
      journeys: journeyRows.map(r => withName(r, r.trip_id as string)),
      /** Keyed by trip id. Every trip in to_book and watch has an entry, or
       *  none when it needed no approval at all. */
      chains,
    }
  })
}
