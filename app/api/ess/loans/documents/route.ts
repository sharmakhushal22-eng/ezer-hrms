// app/api/ess/loans/documents/route.ts — the supporting documents behind a loan request.
//
//   GET    ?request_id=                 the files on one loan request (its owner, or Loans staff)
//   POST   multipart { request_id, file } attach a document to a loan request
//   DELETE ?id=                         remove a file while the request is still in approval
//
// Identity comes from the session (lib/rms/authz requireSelfOrModule): the employee acts on
// their own request; Loans staff act for employees of their companies. Files live in the
// private `loan-documents` bucket (migration 227) and are handed out as 30-minute signed URLs —
// never as stored public links. Mirrors /api/ess/investment-proofs.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSelfOrModule, inCompany, refuse } from '@/lib/rms/authz'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const LOAN_BUCKET = 'loan-documents'
const MAX_BYTES = 10 * 1024 * 1024
const SIGNED_FOR = 60 * 30
// Documents may be added or removed only while the request is still being decided. Once it is
// APPROVED / REJECTED / CANCELLED, what was on file at the decision stays on file.
const OPEN_STATES = new Set(['SUBMITTED', 'IN_APPROVAL'])

/** What the file actually is, from its first bytes — the browser's `file.type` is a claim. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

const safeName = (name: string) => (name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

interface FileRow {
  id: string; request_id: string; employee_id: string; company_id: string | null
  file_name: string; storage_path: string; mime_type: string | null; size_bytes: number | null; uploaded_at: string
}

async function withUrls(rows: FileRow[]) {
  if (!rows.length) return []
  const { data } = await sb.storage.from(LOAN_BUCKET).createSignedUrls(rows.map(r => r.storage_path), SIGNED_FOR)
  const urlOf = new Map((data ?? []).map(d => [d.path, d.signedUrl]))
  return rows.map(r => ({
    id: r.id, request_id: r.request_id, employee_id: r.employee_id,
    file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, uploaded_at: r.uploaded_at,
    url: urlOf.get(r.storage_path) ?? null,
  }))
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('request_id') || ''
  if (!isUuid(requestId)) return refuse(400, 'request_id is required.')

  const { data: lr } = await sb.from('loan_requests').select('id, employee_id, company_id').eq('id', requestId).maybeSingle()
  if (!lr) return refuse(404, 'This loan request was not found.')

  // The request's owner, or Loans staff of the owner's company. Never "whoever sent request_id".
  const who = await requireSelfOrModule(req, lr.employee_id, 'Loans', 'VIEW')
  if (who.error) return who.error

  const { data, error } = await sb.from('loan_request_files').select('*')
    .eq('request_id', requestId).order('uploaded_at', { ascending: false })
  if (error) return refuse(500, error.message)
  return NextResponse.json({ files: await withUrls((data ?? []) as FileRow[]) })
}

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return refuse(400, 'Send the file as multipart form data.') }
  const requestId = String(form.get('request_id') || '')
  const file = form.get('file')
  if (!isUuid(requestId)) return refuse(400, 'request_id is required.')
  if (!(file instanceof File)) return refuse(400, 'Choose a file to upload.')
  if (file.size > MAX_BYTES) return refuse(413, 'Files up to 10 MB only.')

  const { data: lr } = await sb.from('loan_requests')
    .select('id, employee_id, company_id, status').eq('id', requestId).maybeSingle()
  if (!lr) return refuse(404, 'This loan request was not found.')

  const who = await requireSelfOrModule(req, lr.employee_id, 'Loans', 'EDIT')
  if (who.error) return who.error
  if (!OPEN_STATES.has(String(lr.status))) return refuse(409, 'This request is no longer in approval; its documents cannot be changed.')

  const buf = Buffer.from(await file.arrayBuffer())
  const kind = sniff(buf)
  if (!kind) return refuse(415, 'Upload a PDF, JPG, PNG or WEBP — that is what the file has to actually be, not just be named.')

  const base = safeName(file.name).replace(/\.[^.]*$/, '')
  const path = `${lr.employee_id}/${lr.id}/${Date.now()}_${base}.${kind.ext}`
  const up = await sb.storage.from(LOAN_BUCKET).upload(path, buf, { contentType: kind.mime, upsert: false })
  if (up.error) return refuse(500, `The file could not be stored: ${up.error.message}`)

  const { data: row, error } = await sb.from('loan_request_files').insert({
    request_id: lr.id, employee_id: lr.employee_id, company_id: lr.company_id,
    file_name: `${base}.${kind.ext}`, storage_path: path, mime_type: kind.mime, size_bytes: buf.length,
    uploaded_by: who.grant.employeeId,
  }).select('*').single()
  if (error || !row) {
    await sb.storage.from(LOAN_BUCKET).remove([path])
    return refuse(500, error?.message || 'The document could not be recorded. Has migration 227 been run?')
  }

  const [out] = await withUrls([row as FileRow])
  return NextResponse.json({ ok: true, file: out })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!isUuid(id)) return refuse(400, 'id is required.')

  const { data: f } = await sb.from('loan_request_files')
    .select('id, request_id, employee_id, company_id, storage_path').eq('id', id).maybeSingle()
  if (!f) return refuse(404, 'File not found.')

  const who = await requireSelfOrModule(req, f.employee_id, 'Loans', 'EDIT')
  if (who.error) return who.error
  if (!inCompany(who.grant, f.company_id, 'Loans') && who.onBehalf) return refuse(403, 'This file belongs to a company outside your access.')

  const { data: lr } = await sb.from('loan_requests').select('status').eq('id', f.request_id).maybeSingle()
  if (lr && !OPEN_STATES.has(String(lr.status))) return refuse(409, 'This request is no longer in approval; its documents stay on file.')

  await sb.storage.from(LOAN_BUCKET).remove([f.storage_path])
  const { error } = await sb.from('loan_request_files').delete().eq('id', id)
  if (error) return refuse(500, error.message)
  return NextResponse.json({ ok: true })
}
