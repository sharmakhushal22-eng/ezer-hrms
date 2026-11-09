// GET /api/te/me — everything the signed-in employee's own Travel and Expense
// screens show: settings, places, vehicles, trips, legs, expense lines, claims,
// advances, bookings and the open months. One call (te_snapshot); the UI renders from it.
//
// Plus `contact`: the mobile and email on their ESS record, read live. The trip
// and claim forms PREFILL from it and the traveller may change what it put
// there — what they leave is stored on the trip, not written back here. So this
// is the starting point of those fields and never the answer to "how do we
// reach them about this trip", which the trip itself carries.
//
// It is merged in here rather than added to te_snapshot because the snapshot is
// one large SQL function serving every screen, and three columns of the
// caller's own employee row do not need to travel through it.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { rpcError } from '@/lib/te/errors'
import { me } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    const snap = await me(await t.ctx())
    const employeeId = await t.employee()
    const { data, error } = await t.sb()
      .from('employees').select('mobile, alternate_mobile, office_email, personal_email')
      .eq('id', employeeId).maybeSingle()
    if (error) throw rpcError(error, 'employees')
    return {
      ...snap,
      contact: {
        // The work address first, since this is company travel; the personal
        // one is a real fallback, because on this data most people have only
        // that. The form shows whichever it used and lets them change it.
        mobile: (data?.mobile as string | null) ?? '',
        altMobile: (data?.alternate_mobile as string | null) ?? '',
        email: ((data?.office_email as string | null) || (data?.personal_email as string | null)) ?? '',
      },
    }
  })
}
