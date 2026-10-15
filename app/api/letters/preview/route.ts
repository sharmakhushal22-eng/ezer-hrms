// ================================================================
// EZER HRMS — Template Preview (sample data, no real branch)
// Path: app/api/letters/preview/route.ts
//
// Renders the token-replaced text on a plain page. The drawing lives in
// lib/letters/previewPdf.ts, shared with the Configuration preview.
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { renderLetterPreviewPdf } from '@/lib/letters/previewPdf'

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters')
  if (gate.error) return gate.error

  const { letter_name, body_text } = await req.json()
  if (!body_text) return NextResponse.json({ error: 'body_text required' }, { status: 400 })

  const bytes = await renderLetterPreviewPdf(letter_name, body_text)
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf' } })
}
