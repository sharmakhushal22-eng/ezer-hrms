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
    const [book, veh, done, stays, watch] = await Promise.all([
      sb.from('v_te_to_book').select('*').eq('company_id', company).order('on_date', { ascending: true }).limit(500),
      sb.from('te_employee_vehicles')
        .select('id, employee_id, reg_no, vehicle_type_code, declared_type_code, ownership, rc_file_url, created_at')
        .eq('company_id', company).eq('is_active', true).eq('is_verified', false)
        .neq('employee_id', employeeId).order('created_at', { ascending: true }).limit(500),
      // Only what is still standing: a cancelled booking is history, and the
      // only thing left to do with a live one is cancel it.
      sb.from('te_bookings')
        .select('id, booking_no, trip_id, leg_id, point_seq, kind, vendor, reference, amount, paid_by, status, booked_at')
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
    ].filter(Boolean))]
    const names = new Map<string, { emp_code: string | null; full_name: string | null }>()
    if (ids.length) {
      const { data, error } = await sb.from('employees').select('id, emp_code, full_name').in('id', ids)
      if (error) throw rpcError(error, 'employees')
      for (const e of data ?? []) names.set(e.id as string, { emp_code: e.emp_code as string | null, full_name: e.full_name as string | null })
    }
    const withName = <T extends { employee_id: unknown }>(r: T) => ({ ...r, ...(names.get(r.employee_id as string) ?? { emp_code: null, full_name: null }) })
    return {
      company_id: company,
      // Whether this reader may actually spend. Migration 175 lets a desk
      // member whose "May book" is unticked onto the desk — they verify
      // vehicles and decide stays — so the screen has to stop offering them
      // the one thing they cannot do, rather than let them find out from a 403.
      may_book: await t.deskMayBook(),
      to_book: (book.data ?? []).map(withName),
      booked: booked.map(withName),
      vehicles: (veh.data ?? []).map(withName),
      stays: stayRows.map(withName),
      watch: watchRows.map(withName),
    }
  })
}
