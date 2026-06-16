// app/api/recruitment/upload-doc/route.ts
// Uploads a recruitment candidate document (Aadhaar / previous offer letter)
// to the 'onboarding-docs' storage bucket (service role) and records the path
// on the candidate. Used by the Negotiation → Pre-negotiation Checks flow.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const COL: Record<string, string> = { AADHAAR: 'aadhaar_url', PREV_OFFER: 'prev_offer_url' }

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData()
    const candidateId = fd.get('candidate_id') as string
    const docType = fd.get('doc_type') as string
    const file = fd.get('file') as File | null

    if (!candidateId || !docType || !file) {
      return NextResponse.json({ error: 'candidate_id, doc_type, file required' }, { status: 400 })
    }
    if (!COL[docType]) return NextResponse.json({ error: 'invalid doc_type' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const path = `recruitment/${candidateId}/${docType}_${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supa.storage
      .from('onboarding-docs')
      .upload(path, buffer, { contentType: file.type, upsert: true })
    if (upErr) return NextResponse.json({ error: 'Storage upload failed: ' + upErr.message }, { status: 500 })

    const { error: updErr } = await supa.from('candidates').update({ [COL[docType]]: path }).eq('id', candidateId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, path })
  } catch (e: any) {
    console.error('upload-doc error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
