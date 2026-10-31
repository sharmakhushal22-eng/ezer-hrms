// app/api/letters/employee — the letters issued to one employee, for the Documents tab of their
// record (People → Employees → employee, and their own ESS profile).
//   GET ?employee_id=…             -> { letters }   newest first
//   GET ?employee_id=…&file=<id>   -> { url }       a 5-minute signed link to one of them
// The employee themself sees only the letters released to ESS. HR — the Employees or HR Letters
// module, in a company their roles are valid in — sees every letter, the ones kept out of ESS
// (warning, show cause, PIP, welcome) marked so.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { allowedCompanies, hasLevel } from '@/lib/rms/resolve'

export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

export async function GET(req: NextRequest) {
  const auth = await requireDashboardUser(req)
  if (auth.error) return auth.error
  const sp = req.nextUrl.searchParams
  const employeeId = String(sp.get('employee_id') || '')
  if (!employeeId) return bad('Which employee?')
  const self = !!auth.user.employeeId && auth.user.employeeId === employeeId
  if (!self) {
    const g = await grantForRequest(req)
    const { data: emp } = await sb.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
    const may = g.isSuperAdmin || g.legacy || ((hasLevel(g, 'Employees', 'VIEW') || hasLevel(g, 'HR Letters', 'VIEW'))
      && (g.crossCompany || allowedCompanies(g, null).includes(emp?.company_id)))
    if (!may) return bad('You cannot see this employee’s letters.', 403)
  }

  const fileId = sp.get('file')
  if (fileId) {
    const { data: row } = await sb.from('generated_letters').select('employee_id, file_url, published_to_ess_at').eq('id', fileId).maybeSingle()
    if (!row || row.employee_id !== employeeId || (self && !row.published_to_ess_at)) return bad('Letter not found.', 404)
    const { data, error } = await sb.storage.from('generated-letters').createSignedUrl(row.file_url, 300)
    if (error || !data?.signedUrl) return bad(error?.message || 'Could not open the letter.', 500)
    return NextResponse.json({ url: data.signedUrl })
  }

  let q = sb.from('generated_letters').select('id, letter_name, letter_type, doc_id, letter_date, generated_at, published_to_ess_at, emailed_at, sent_to, generated_by_name, template_id')
    .eq('employee_id', employeeId).order('generated_at', { ascending: false }).limit(200)
  if (self) q = q.not('published_to_ess_at', 'is', null)
  let { data, error } = await q
  if (error) {
    // Before migration 204: the columns that existed.
    let q2 = sb.from('generated_letters').select('id, letter_name, letter_date, generated_at, published_to_ess_at, emailed_at, template_id').eq('employee_id', employeeId).order('generated_at', { ascending: false }).limit(200)
    if (self) q2 = q2.not('published_to_ess_at', 'is', null)
    ;({ data } = await q2 as any)
  }
  // Letters from HR Letters templates carry their template's name.
  const tids = [...new Set(((data as any[]) || []).filter(l => !l.letter_name && l.template_id).map(l => l.template_id))]
  const { data: tpl } = tids.length ? await sb.from('letter_templates').select('id, name').in('id', tids) : { data: [] as any[] }
  const tname = new Map(((tpl as any[]) || []).map(t => [t.id, t.name]))
  const letters = ((data as any[]) || []).map(l => ({
    id: l.id, name: l.letter_name || tname.get(l.template_id) || 'Letter', type: l.letter_type || null, doc_id: l.doc_id || null,
    date: l.letter_date || String(l.generated_at || '').slice(0, 10), in_ess: !!l.published_to_ess_at, emailed_at: l.emailed_at || null, sent_to: l.sent_to || null, by: l.generated_by_name || null,
  }))
  return NextResponse.json({ letters })
}
