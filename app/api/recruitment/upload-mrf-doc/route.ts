// app/api/recruitment/upload-mrf-doc/route.ts
// Uploads an MRF supporting document (org chart / budget approval / other) to
// the 'onboarding-docs' storage bucket and appends it to the requisition's
// `attachments` JSONB. Mirrors app/api/recruitment/upload-doc/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const KINDS = ['ORG_CHART', 'BUDGET_DOC', 'OTHER']
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  // Same hole as share-report had: a service-role upload with nothing guarding it.
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  try {
    const fd = await req.formData()
    const mrfId = fd.get('mrf_id') as string
    const kind = (fd.get('kind') as string) || 'OTHER'
    const file = fd.get('file') as File | null

    if (!mrfId || !file) {
      return NextResponse.json({ error: 'mrf_id and file are required' }, { status: 400 })
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File is larger than 10 MB' }, { status: 400 })
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `recruitment/mrf/${mrfId}/${kind}_${Date.now()}_${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supa.storage
      .from('onboarding-docs')
      .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: true })
    if (upErr) {
      return NextResponse.json({ error: 'Storage upload failed: ' + upErr.message }, { status: 500 })
    }

    // Append rather than replace — a requisition can carry several documents.
    // Read-modify-write is safe here: attachments are only edited from this
    // route, one file at a time.
    const { data: row, error: readErr } = await supa
      .from('manpower_requisitions').select('attachments').eq('id', mrfId).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

    const existing = Array.isArray(row?.attachments)
      ? row!.attachments
      : (typeof row?.attachments === 'string' ? JSON.parse(row!.attachments) : [])

    const entry = { kind, name: file.name, path, size: file.size, uploaded_at: new Date().toISOString() }

    const { error: updErr } = await supa.from('manpower_requisitions')
      .update({ attachments: [...existing, entry] }).eq('id', mrfId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    const { data: signed } = await supa.storage
      .from('onboarding-docs').createSignedUrl(path, 60 * 60 * 24 * 7)

    return NextResponse.json({ ok: true, attachment: { ...entry, url: signed?.signedUrl || null } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}

// Signed URL for viewing an already-uploaded attachment (bucket is private).
export async function GET(req: NextRequest) {
  // A signed URL for any path is a read of any file in the bucket — guessing a path
  // should not be enough.
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
  const { data, error } = await supa.storage
    .from('onboarding-docs').createSignedUrl(path, 60 * 60)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}

// Remove an attachment from both storage and the requisition's JSONB.
export async function DELETE(req: NextRequest) {
  // Deleting somebody's document is the one that cannot be undone.
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const mrfId = req.nextUrl.searchParams.get('mrf_id')
  const path = req.nextUrl.searchParams.get('path')
  if (!mrfId || !path) return NextResponse.json({ error: 'mrf_id and path required' }, { status: 400 })

  await supa.storage.from('onboarding-docs').remove([path])

  const { data: row } = await supa
    .from('manpower_requisitions').select('attachments').eq('id', mrfId).maybeSingle()
  const existing = Array.isArray(row?.attachments)
    ? row!.attachments
    : (typeof row?.attachments === 'string' ? JSON.parse(row!.attachments) : [])

  const { error } = await supa.from('manpower_requisitions')
    .update({ attachments: existing.filter((a: any) => a.path !== path) }).eq('id', mrfId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
