// app/api/collect-docs/upload/route.ts — public, token-gated candidate file upload.
//   POST multipart { token, doc_type, file }  -> stores the file, records the row
//
// One row per doc_type per link (re-uploading replaces it). Files go to the private
// onboarding-docs bucket under recruitment/<candidate>/<doctype>_<ts>.<ext>.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { COLLECT_DOCS } from '@/lib/recruitment/collect-docs'
import { verifyAccess } from '@/lib/recruitment/collect-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX = 8 * 1024 * 1024 // 8 MB
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }) }
  const token = String(form.get('token') || '')
  const docType = String(form.get('doc_type') || '')
  const file = form.get('file') as File | null

  const access = req.headers.get('x-collect-access') || String(form.get('access') || '')
  if (!verifyAccess(access, token)) return NextResponse.json({ error: 'Please verify your email to continue.' }, { status: 401 })

  const def = COLLECT_DOCS.find(d => d.type === docType)
  if (!def) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  if (!file || !file.size) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: 'File too large (max 8 MB)' }, { status: 400 })
  if (file.type && !OK_TYPES.includes(file.type)) return NextResponse.json({ error: 'Only PDF, JPG, PNG or WEBP' }, { status: 400 })

  const { data: link } = await sb.from('document_collection_links').select('*').eq('link_token', token).maybeSingle()
  if (!link) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (link.status === 'EXPIRED' || (link.expires_at && new Date(link.expires_at).getTime() < Date.now()))
    return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
  if (link.status === 'SUBMITTED') return NextResponse.json({ error: 'This submission is already complete.' }, { status: 409 })

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
  const path = `recruitment/${link.candidate_id}/${docType}_${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const up = await sb.storage.from('onboarding-docs').upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: true })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

  // Single-file docs keep one row per (link, doc_type) — a re-upload replaces the
  // previous file (and removes it from storage). Multi-file docs (Aadhaar front/back,
  // multiple appraisal letters) append, so several files live under one doc_type.
  if (!def.multiple) {
    const { data: prev } = await sb.from('candidate_documents_uploaded').select('file_url').eq('link_id', link.id).eq('doc_type', docType)
    const paths = (prev || []).map((p: any) => p.file_url).filter(Boolean)
    if (paths.length) await sb.storage.from('onboarding-docs').remove(paths)
    await sb.from('candidate_documents_uploaded').delete().eq('link_id', link.id).eq('doc_type', docType)
  }
  const { data: row, error } = await sb.from('candidate_documents_uploaded').insert({
    link_id: link.id, candidate_id: link.candidate_id, company_id: link.company_id || null,
    doc_type: docType, doc_label: def.label, file_name: file.name, file_url: path,
    file_size: file.size, file_type: file.type || null, is_mandatory: def.mandatory,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: row?.id, doc_type: docType, file_name: file.name })
}
