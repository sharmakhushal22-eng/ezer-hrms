// app/api/recruitment/share-report/route.ts
// Takes a generated Job Status report, parks it in the 'onboarding-docs'
// storage bucket and hands back a signed URL that can be sent to someone who
// has no login — the "shareable" half of Export Report. Mirrors the upload
// pattern in app/api/recruitment/upload-mrf-doc/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const MAX_BYTES = 15 * 1024 * 1024
const LINK_DAYS = 7

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData()
    const file = fd.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Report is larger than 15 MB' }, { status: 400 })
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-90)
    const path = `recruitment/job-status-reports/${Date.now()}_${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supa.storage
      .from('onboarding-docs')
      .upload(path, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      })
    if (upErr) {
      return NextResponse.json({ error: 'Upload failed: ' + upErr.message }, { status: 500 })
    }

    const { data: signed, error: signErr } = await supa.storage
      .from('onboarding-docs')
      .createSignedUrl(path, 60 * 60 * 24 * LINK_DAYS)
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: 'Could not create a share link: ' + (signErr?.message || 'unknown') },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, url: signed.signedUrl, expiresInDays: LINK_DAYS })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not share the report' }, { status: 500 })
  }
}
