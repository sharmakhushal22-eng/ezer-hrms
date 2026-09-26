// app/api/recruitment/doc-collection/zip/route.ts
//   GET ?candidate_id=…[&ids=id1,id2] -> a single .zip of the candidate's uploaded docs.
//
// Service-role, addressed by candidate_id (same trust model as the status GET). Pass
// `ids` to zip only a selection; omit to zip everything on the latest link.

import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get('candidate_id')
  const idsParam = req.nextUrl.searchParams.get('ids')
  if (!candidateId) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })

  const { data: link } = await sb.from('document_collection_links')
    .select('id').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!link) return NextResponse.json({ error: 'No documents found.' }, { status: 404 })

  let q = sb.from('candidate_documents_uploaded').select('id, doc_type, doc_label, file_name, file_url').eq('link_id', link.id)
  const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : null
  if (ids && ids.length) q = q.in('id', ids)
  const { data: docs } = await q
  if (!docs || !docs.length) return NextResponse.json({ error: 'No documents to download.' }, { status: 404 })

  const zip = new JSZip()
  const used = new Set<string>()
  for (const d of docs) {
    if (!d.file_url) continue
    const dl = await sb.storage.from('onboarding-docs').download(d.file_url)
    if (dl.error || !dl.data) continue
    const buf = Buffer.from(await dl.data.arrayBuffer())
    const ext = (d.file_name?.split('.').pop() || d.file_url.split('.').pop() || 'bin').toLowerCase()
    let name = `${d.doc_label || d.doc_type}.${ext}`.replace(/[\/\\:*?"<>|]+/g, '-')
    let n = 1
    while (used.has(name.toLowerCase())) { name = `${d.doc_label || d.doc_type} (${++n}).${ext}`; }
    used.add(name.toLowerCase())
    zip.file(name, buf)
  }

  const content = await zip.generateAsync({ type: 'nodebuffer' })
  const { data: cand } = await sb.from('candidates').select('full_name').eq('id', candidateId).maybeSingle()
  const safeName = (cand?.full_name || 'candidate').replace(/[^A-Za-z0-9]+/g, '_')
  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}_documents.zip"`,
    },
  })
}
