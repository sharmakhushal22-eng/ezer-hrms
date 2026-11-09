// app/api/esign/sign/[token]/document/route.ts — the PDF for a verified signer.
//
// Only after the e-mail OTP: the document itself is the confidential part (an offer, a
// salary), so a forwarded link shows the title and nothing more. A signer who has signed or
// whose document is complete can still download their copy with a fresh verification.
import { NextRequest, NextResponse } from 'next/server'
import { download, logEvent, sb } from '@/lib/esign/server'
import { loadLink, sessionOk } from '@/lib/esign/signer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const st = await loadLink(token)
  if (!st) return NextResponse.json({ error: 'Not valid' }, { status: 404 })
  if (!sessionOk(req, st.signer, false)) return NextResponse.json({ error: 'Verify your e-mail first.' }, { status: 401 })
  const { data: env } = await sb.from('esign_envelopes').select('id, signed_path, working_path, original_path').eq('id', st.env.id).single()
  const bytes = await download(env!.signed_path || env!.working_path || env!.original_path)
  if (req.nextUrl.searchParams.get('view') !== '0') await logEvent(st.env.id, 'VIEWED', { signerId: st.signer.id, actor: `${st.signer.name} <${st.signer.email}>`, req })
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
