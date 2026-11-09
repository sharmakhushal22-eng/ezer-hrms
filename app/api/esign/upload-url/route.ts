// app/api/esign/upload-url/route.ts — a one-time signed upload URL for the PDF to be signed.
//
// The browser uploads straight to the private `esign` bucket: a 10 MB PDF would not fit
// through a serverless request body (Vercel caps those at 4.5 MB). The envelope route then
// reads the file back, hashes it and refuses anything that is not a readable PDF.
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { sb, BUCKET, migrationHint } from '@/lib/esign/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters', 'EDIT')
  if (gate.error) return gate.error
  const path = `uploads/${crypto.randomUUID()}.pdf`
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: migrationHint(error) || error?.message || 'Could not start the upload' }, { status: 500 })
  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl })
}
