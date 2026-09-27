// app/api/recruitment/doc-collection/file/route.ts
//   GET ?doc_id=…&mode=view|download  -> a short-lived signed URL for one uploaded doc.
//
// Recruiter-side (Review Documents). Uses the service role and is addressed by the
// document's own id, the same trust model as the doc-collection status GET — so it
// works from the dashboard AND from the ESS-embedded recruitment module (no dashboard
// session needed, which is what the old upload-mrf-doc endpoint required).

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get('doc_id')
  const mode = req.nextUrl.searchParams.get('mode') === 'download' ? 'download' : 'view'
  if (!docId) return NextResponse.json({ error: 'doc_id is required' }, { status: 400 })

  const { data: doc } = await sb.from('candidate_documents_uploaded')
    .select('id, file_url, file_name').eq('id', docId).maybeSingle()
  if (!doc || !doc.file_url) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  const opts = mode === 'download' ? { download: doc.file_name || true } : undefined
  const { data, error } = await sb.storage.from('onboarding-docs').createSignedUrl(doc.file_url, 60 * 10, opts as any)
  if (error || !data) return NextResponse.json({ error: error?.message || 'Could not open file' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl, file_name: doc.file_name })
}
