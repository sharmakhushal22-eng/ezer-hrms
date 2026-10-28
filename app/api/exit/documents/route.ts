// /api/exit/documents — supporting documents on a company exit (spec §4 Step 2: warning letters,
// inquiry reports). Private bucket `exit-documents` (migration 173).
//   POST multipart { request_id, file }  -> { documents }   hiring / HR roles, same company
//   GET  ?request_id=&path=              -> { url }          a 10-minute signed link
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { canExitOthers } from '@/lib/exit/hr-exit'

export const dynamic = 'force-dynamic'
const BUCKET = 'exit-documents'
const MAX = 10 * 1024 * 1024
const OK_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

async function guard(req: NextRequest, requestId: string | null) {
  const r = await essRoute(req); if (r.error) return { error: r.error }
  const { ctx } = r
  const approver = async (row: any) => (row.chain || []).some((s: any) => (s.approvers || []).some((p: any) => p.id === ctx.caller.employeeId))
  if (!requestId) return { error: bad('Which exit?') }
  const { data: row } = await sb.from('hr_exit_requests').select('id, company_id, documents, chain').eq('id', requestId).maybeSingle()
  if (!row) return { error: bad('Exit not found.', 404) }
  const hr = canExitOthers(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
  const scoped = ctx.grant.isSuperAdmin || ctx.grant.crossCompany || row.company_id === ctx.companyId
  if (!((hr && scoped) || await approver(row))) return { error: forbidden('Only the HR team, Hiring Managers and this exit’s approvers can see its documents.') }
  return { ctx, row, hr: hr && scoped }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const g = await guard(req, sp.get('request_id')); if ('error' in g && g.error) return g.error
  const { row } = g as any
  const path = sp.get('path') || ''
  if (!(row.documents || []).some((d: any) => d.path === path)) return bad('Document not found.', 404)
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error) return bad(error.message, 500)
  return NextResponse.json({ url: data.signedUrl })
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  if (!form) return bad('Send the file as multipart form data.')
  const g = await guard(req, String(form.get('request_id') || '') || null); if ('error' in g && g.error) return g.error
  const { ctx, row, hr } = g as any
  if (!hr) return forbidden('Only the HR team and Hiring Managers can add documents.')
  if (ctx.caller.viewAs) return forbidden(ctx.caller.actorEmployeeId === null
    ? 'Your ESS session is not active, so this has nobody to act on it. Sign in again with your own ESS account.'
    : 'Add documents from your own portal.')
  const file = form.get('file')
  if (!(file instanceof File)) return bad('Attach a file.')
  if (file.size > MAX) return bad('A document can be at most 10 MB.')
  if (!OK_TYPES.test(file.type)) return bad('PDF, Word or image files only.')
  if ((row.documents || []).length >= 10) return bad('At most 10 documents per exit.')
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `${row.id}/${Date.now()}_${safe}`
  const { error } = await sb.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return bad(/not found/i.test(error.message) ? 'The exit-documents bucket is missing. Run migration 173_exit_clearance_fnf.sql.' : error.message, 500)
  const { data: me } = await sb.from('employees').select('full_name, emp_code').eq('id', ctx.caller.employeeId).maybeSingle()
  const documents = [...(row.documents || []), { name: file.name, path, size: file.size, type: file.type, uploaded_at: new Date().toISOString(), uploaded_by: me ? `${me.full_name} (${me.emp_code})` : null }]
  await sb.from('hr_exit_requests').update({ documents, updated_at: new Date().toISOString() }).eq('id', row.id)
  return NextResponse.json({ documents })
}
