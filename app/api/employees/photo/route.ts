// app/api/employees/photo/route.ts
//
//   GET ?id=<employee uuid> -> { url } a short-lived signed URL for that
//                              employee's profile photo, or { url: null }
//
// For the Employee Master detail screen. employee-photos is a private bucket,
// so the browser cannot sign a path itself — the ESS profile and the ID-card
// routes sign server-side for the same reason, and this does exactly what they
// do for one record.
//
// Gated like the screen it serves: a dashboard session holding Employees VIEW,
// and the caller's company scope. An id outside that scope answers the same as
// an employee with no photo, so the route cannot be used to map other
// companies' staff.

import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { grantForRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import { companyFilter } from '@/lib/rms/resolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const none = () => NextResponse.json({ url: null }, { headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Employees', 'VIEW')
  if (gate.error) return gate.error

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 })

  const { data: row } = await sb.from('employees')
    .select('company_id, photo_path').eq('id', id).maybeSingle()
  const r = row as { company_id?: string | null; photo_path?: string | null } | null
  if (!r?.photo_path) return none()

  const pinned = companyFilter(await grantForRequest(req))
  if (pinned && r.company_id !== pinned) return none()

  // Ten minutes: long enough to render the screen, short enough not to be a link.
  const { data } = await sb.storage.from('employee-photos').createSignedUrl(r.photo_path, 60 * 10)
  return NextResponse.json({ url: data?.signedUrl ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}
