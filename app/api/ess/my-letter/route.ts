// /api/ess/my-letter?id=…[&employee_id=…] — a 5-minute link to one of an employee's letters
// (generated_letters, released to ESS): ESS → My Letters, and the Documents tab of the
// employee's record (their own, or People → Employees → employee). The bucket is private, so
// the link is signed here. Somebody else's letter needs the Employees module, in their company.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { grantForEmployee } from '@/lib/rms/server'
import { hasLevel } from '@/lib/rms/resolve'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Which letter?' }, { status: 400 })
  const { data: row } = await sb.from('generated_letters').select('employee_id, file_url, published_to_ess_at').eq('id', id).maybeSingle()
  if (!row || row.employee_id !== r.ctx.caller.employeeId || !row.published_to_ess_at) return NextResponse.json({ error: 'Letter not found.' }, { status: 404 })
  if (r.ctx.caller.viewAs) {
    // Somebody else's letter: say which situation it is (see lib/ess/__tests__/viewas-messages).
    if (r.ctx.caller.actorEmployeeId === null) return NextResponse.json({ error: 'Your ESS session is not active, so there is nobody to open this letter for. Sign in again with your own ESS account.' }, { status: 403 })
    const g = await grantForEmployee(r.ctx.caller.actorEmployeeId)
    const { data: emp } = await sb.from('employees').select('company_id').eq('id', row.employee_id).maybeSingle()
    const ok = g.isSuperAdmin || (hasLevel(g, 'Employees', 'VIEW') && (g.crossCompany || emp?.company_id === g.companyId))
    if (!ok) return NextResponse.json({ error: 'Opening somebody else’s letters needs the Employees module.' }, { status: 403 })
  }
  const { data, error } = await sb.storage.from('generated-letters').createSignedUrl(row.file_url, 300)
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || 'Could not open the letter.' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}
