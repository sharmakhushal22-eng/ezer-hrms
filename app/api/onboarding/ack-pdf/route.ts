// app/api/onboarding/ack-pdf/route.ts
// GET ?token= — the joining acknowledgement as a PDF on the company's letterhead, for the
// "Download acknowledgement" button on the last screen of the onboarding link.
// Token-gated like every other /api/onboarding route; read-only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ackPdf, loadAckFacts } from '@/lib/onboarding/ack-pdf'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const loaded = await loadAckFacts(supa, { token })
    if (!loaded) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    const { name, content } = await ackPdf(loaded.company, loaded.facts)

    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${req.nextUrl.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Could not build the PDF' }, { status: 500 })
  }
}
