// GET /api/te/desk — the Travel Desk's work list for the caller's company:
//   to_book    tickets and hotel stays on approved trips that the desk still has to book (v_te_to_book)
//   booked     what the desk has already recorded, so a booking can be cancelled when a trip changes
//   vehicles   vehicles whose RC could not be checked automatically and wait for a person to look at the photo
// Needs the dashboard Travel Claims permission (edit).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { rpcError } from '@/lib/te/errors'

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
    const [book, veh, done, stays] = await Promise.all([
      sb.from('v_te_to_book').select('*').eq('company_id', company).order('on_date', { ascending: true }).limit(500),
      sb.from('te_employee_vehicles')
        .select('id, employee_id, reg_no, vehicle_type_code, declared_type_code, ownership, rc_file_url, created_at')
        .eq('company_id', company).eq('is_active', true).eq('is_verified', false).order('created_at', { ascending: true }).limit(500),
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
      to_book: (book.data ?? []).map(withName),
      booked: booked.map(withName),
      vehicles: (veh.data ?? []).map(withName),
      stays: stayRows.map(withName),
    }
  })
}
