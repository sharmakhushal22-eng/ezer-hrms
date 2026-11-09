// app/api/ess/investment-proofs/route.ts — the documents behind an investment proof.
//
//   GET    ?employee_id=&fy=          the employee's files (self, or Payroll VIEW for them)
//   GET    ?scope=company&fy=         every file in the caller's companies (Payroll VIEW) — HR review
//   POST   multipart { proof_id, file } attach a receipt / policy statement to a declared line
//   DELETE ?id=                       remove a file while the line is still open
//
// Identity comes from the session (lib/rms/authz requireSelfOrModule): the employee acts on
// their own lines; Payroll staff act for employees of their companies. Files live in the
// private `investment-proofs` bucket (migration 212) and are handed out as 30-minute signed
// URLs — never as stored public links.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSelfOrModule, requireAccess, inCompany, refuse } from '@/lib/rms/authz'
import { allowedCompanies } from '@/lib/rms/resolve'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const PROOF_BUCKET = 'investment-proofs'
const MAX_BYTES = 10 * 1024 * 1024
const SIGNED_FOR = 60 * 30
const DEFAULT_FY = '2026-27'

/** What the file actually is, from its first bytes — the browser's `file.type` is a claim. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

const safeName = (name: string) => (name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file'
const fyOf = (v: string | null) => (v && /^\d{4}-\d{2}$/.test(v) ? v : DEFAULT_FY)

interface FileRow {
  id: string; proof_id: string; employee_id: string; company_id: string | null; fy: string; section: string | null
  file_name: string; storage_path: string; mime_type: string | null; size_bytes: number | null; uploaded_at: string
}

async function withUrls(rows: FileRow[]) {
  if (!rows.length) return []
  const { data } = await sb.storage.from(PROOF_BUCKET).createSignedUrls(rows.map(r => r.storage_path), SIGNED_FOR)
  const urlOf = new Map((data ?? []).map(d => [d.path, d.signedUrl]))
  return rows.map(r => ({
    id: r.id, proof_id: r.proof_id, employee_id: r.employee_id, section: r.section,
    file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, uploaded_at: r.uploaded_at,
    url: urlOf.get(r.storage_path) ?? null,
  }))
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const fy = fyOf(p.get('fy'))

  if (p.get('scope') === 'company') {
    // HR's review screen: every file for the FY, pinned to the companies the caller's Payroll role covers.
    const gate = await requireAccess(req, 'Payroll', 'VIEW')
    if (gate.error) return gate.error
    let q = sb.from('investment_proof_files').select('*').eq('fy', fy).order('uploaded_at', { ascending: false })
    if (!(gate.grant.crossCompany || gate.grant.legacy || gate.grant.isSuperAdmin)) {
      const cos = allowedCompanies(gate.grant, 'Payroll')
      if (!cos.length) return NextResponse.json({ files: [] })
      q = q.in('company_id', cos)
    }
    const { data, error } = await q
    if (error) return refuse(500, error.message)
    return NextResponse.json({ files: await withUrls((data ?? []) as FileRow[]) })
  }

  const who = await requireSelfOrModule(req, p.get('employee_id'), 'Payroll', 'VIEW')
  if (who.error) return who.error
  const { data, error } = await sb.from('investment_proof_files').select('*')
    .eq('employee_id', who.subjectId).eq('fy', fy).order('uploaded_at', { ascending: false })
  if (error) return refuse(500, error.message)
  return NextResponse.json({ files: await withUrls((data ?? []) as FileRow[]) })
}

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return refuse(400, 'Send the file as multipart form data.') }
  const proofId = String(form.get('proof_id') || '')
  const file = form.get('file')
  if (!/^[0-9a-f-]{36}$/i.test(proofId)) return refuse(400, 'proof_id is required.')
  if (!(file instanceof File)) return refuse(400, 'Choose a file to upload.')
  if (file.size > MAX_BYTES) return refuse(413, 'Files up to 10 MB only.')

  const { data: proof } = await sb.from('investment_proofs')
    .select('id, employee_id, company_id, fy, section, status').eq('id', proofId).maybeSingle()
  if (!proof) return refuse(404, 'This proof line was not found.')

  // The line's owner, or Payroll staff of the owner's company. Never "whoever sent proof_id".
  const who = await requireSelfOrModule(req, proof.employee_id, 'Payroll', 'EDIT')
  if (who.error) return who.error
  if (proof.status === 'APPROVED') return refuse(409, 'This line is already approved; its documents are on file and cannot be changed.')

  const buf = Buffer.from(await file.arrayBuffer())
  const kind = sniff(buf)
  if (!kind) return refuse(415, 'Upload a PDF, JPG, PNG or WEBP — that is what the file has to actually be, not just be named.')

  const base = safeName(file.name).replace(/\.[^.]*$/, '')
  const path = `${proof.employee_id}/${proof.fy}/${proof.id}/${Date.now()}_${base}.${kind.ext}`
  const up = await sb.storage.from(PROOF_BUCKET).upload(path, buf, { contentType: kind.mime, upsert: false })
  if (up.error) return refuse(500, `The file could not be stored: ${up.error.message}`)

  const { data: row, error } = await sb.from('investment_proof_files').insert({
    proof_id: proof.id, employee_id: proof.employee_id, company_id: proof.company_id, fy: proof.fy, section: proof.section,
    file_name: `${base}.${kind.ext}`, storage_path: path, mime_type: kind.mime, size_bytes: buf.length,
    uploaded_by: who.grant.employeeId,
  }).select('*').single()
  if (error || !row) {
    await sb.storage.from(PROOF_BUCKET).remove([path])
    return refuse(500, error?.message || 'The document could not be recorded. Has migration 212 been run?')
  }

  // A rejected line with a fresh document goes back to HR on its own: the employee has
  // answered the rejection, and leaving it REJECTED would hide that from the review queue.
  if (proof.status === 'REJECTED') {
    await sb.from('investment_proofs').update({ status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString() }).eq('id', proof.id)
  }

  const [out] = await withUrls([row as FileRow])
  return NextResponse.json({ ok: true, file: out, resubmitted: proof.status === 'REJECTED' })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse(400, 'id is required.')
  const { data: f } = await sb.from('investment_proof_files').select('id, proof_id, employee_id, company_id, storage_path').eq('id', id).maybeSingle()
  if (!f) return refuse(404, 'File not found.')

  const who = await requireSelfOrModule(req, f.employee_id, 'Payroll', 'EDIT')
  if (who.error) return who.error
  if (!inCompany(who.grant, f.company_id, 'Payroll') && who.onBehalf) return refuse(403, 'This file belongs to a company outside your access.')

  const { data: proof } = await sb.from('investment_proofs').select('status').eq('id', f.proof_id).maybeSingle()
  if (proof?.status === 'APPROVED') return refuse(409, 'This line is approved; its documents stay on file.')

  await sb.storage.from(PROOF_BUCKET).remove([f.storage_path])
  const { error } = await sb.from('investment_proof_files').delete().eq('id', id)
  if (error) return refuse(500, error.message)
  return NextResponse.json({ ok: true })
}
