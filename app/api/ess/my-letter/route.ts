// /api/ess/my-letter?id=…[&employee_id=…] — a 5-minute link to one of the caller's letters in
// ESS → Profile → My Letters (generated_letters, released to ESS). The bucket is private, so the
// link is signed here, for the portal's own employee only (an admin viewing a portal sees that
// employee's letters, read-only, as everywhere else in ESS).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Which letter?' }, { status: 400 })
  const { data: row } = await sb.from('generated_letters').select('employee_id, file_url, published_to_ess_at').eq('id', id).maybeSingle()
  if (!row || row.employee_id !== r.ctx.caller.employeeId || !row.published_to_ess_at) return NextResponse.json({ error: 'Letter not found.' }, { status: 404 })
  const { data, error } = await sb.storage.from('generated-letters').createSignedUrl(row.file_url, 300)
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || 'Could not open the letter.' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}
