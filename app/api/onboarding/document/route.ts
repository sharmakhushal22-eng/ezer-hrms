// app/api/onboarding/document/route.ts — a document on the candidate's onboarding form.
//
//   GET  ?token=&doc_code=&mode=view|download  → redirects to a short-lived signed URL
//   DELETE { token, doc_code }                 → removes the document from the form
//
// The candidate is identified by the magic-link token, like every other onboarding route.
// Removing a carried-over document (from the pre-offer collection) only drops it from the
// form — the recruiter's copy stays; a file the candidate uploaded here is deleted from
// storage too.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!)
const BUCKET = 'onboarding-docs'

async function owned(token: string, docCode: string) {
  const { data: cand } = await supa.from('onboarding_candidates').select('id, status, token_expires_at').eq('magic_link_token', token).maybeSingle()
  if (!cand) return { error: 'Invalid token', status: 404 as const }
  const { data: doc } = await supa.from('onboarding_documents').select('id, storage_path, file_name, mime_type').eq('onboarding_id', cand.id).eq('doc_code', docCode).maybeSingle()
  if (!doc) return { error: 'No such document', status: 404 as const }
  return { cand, doc }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const token = q.get('token') || '', docCode = q.get('doc_code') || '', mode = q.get('mode') === 'download' ? 'download' : 'view'
  if (!token || !docCode) return NextResponse.json({ error: 'token and doc_code required' }, { status: 400 })
  const o = await owned(token, docCode)
  if ('error' in o) return NextResponse.json({ error: o.error }, { status: o.status })
  if (!o.doc.storage_path) return NextResponse.json({ error: 'No file stored' }, { status: 404 })
  const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(o.doc.storage_path, 300, mode === 'download' ? { download: o.doc.file_name || true } : undefined)
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || 'Could not sign' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl, 302)
}

export async function DELETE(req: NextRequest) {
  const { token, doc_code } = await req.json().catch(() => ({}))
  if (!token || !doc_code) return NextResponse.json({ error: 'token and doc_code required' }, { status: 400 })
  const o = await owned(token, doc_code)
  if ('error' in o) return NextResponse.json({ error: o.error }, { status: o.status })
  if (!['INVITED', 'IN_PROGRESS'].includes(o.cand.status)) return NextResponse.json({ error: 'The form is already submitted' }, { status: 409 })
  // Only a file the portal itself stored (<onboarding_id>/…) is deleted from storage.
  if (o.doc.storage_path && o.doc.storage_path.startsWith(`${o.cand.id}/`)) await supa.storage.from(BUCKET).remove([o.doc.storage_path]).catch(() => null)
  await supa.from('onboarding_documents').delete().eq('id', o.doc.id)
  await supa.from('onboarding_audit_log').insert({ onboarding_id: o.cand.id, action: 'DOCUMENT_REMOVED', actor_type: 'CANDIDATE', details: { doc_code } }).then(() => null, () => null)
  return NextResponse.json({ ok: true })
}
