// app/api/esign/verify/route.ts — public authenticity check.
//
// POST multipart { file }   SHA-256 of the uploaded PDF, looked up against every completed
//                           envelope's final fingerprint (and every original, so we can say
//                           "this is the unsigned original" rather than just "unknown").
// GET  ?id=EZS-2026-XXXXXX  the public summary of one envelope (no document, no e-mails).
import { NextRequest, NextResponse } from 'next/server'
import { sb, logEvent, migrationHint } from '@/lib/esign/server'
import { sha256Hex, maskEmail } from '@/lib/esign/core'

export const runtime = 'nodejs'

async function summary(env: any) {
  const { data: signers } = await sb.from('esign_signers').select('order_no, name, email, role_label, status, signed_at, auth_method, aadhaar_verified_at, aadhaar_mode').eq('envelope_id', env.id).order('order_no')
  const company = env.company_id ? (await sb.from('companies').select('company_name').eq('id', env.company_id).maybeSingle()).data : null
  return {
    envelope_no: env.envelope_no, title: env.title, status: env.status, company: company?.company_name || null,
    sent_by: env.created_by_name, created_at: env.created_at, completed_at: env.completed_at, page_count: env.page_count,
    original_sha256: env.original_sha256, signed_sha256: env.signed_sha256,
    signers: (signers || []).map(s => ({ ...s, email: maskEmail(s.email) })),
  }
}

export async function GET(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get('id') || '').trim().toUpperCase()
  if (!/^EZS-\d{4}-[A-Z0-9]{6}$/.test(id)) return NextResponse.json({ error: 'Enter an envelope ID like EZS-2026-7KQ2MX.' }, { status: 400 })
  const { data: env, error } = await sb.from('esign_envelopes').select('*').eq('envelope_no', id).maybeSingle()
  if (error) return NextResponse.json({ error: migrationHint(error) || error.message }, { status: 500 })
  if (!env) return NextResponse.json({ found: false })
  return NextResponse.json({ found: true, envelope: await summary(env) })
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose the PDF to check.' }, { status: 400 })
  if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: 'That file is too large.' }, { status: 400 })
  const sha = sha256Hex(new Uint8Array(await file.arrayBuffer()))
  const { data: signed } = await sb.from('esign_envelopes').select('*').eq('signed_sha256', sha).maybeSingle()
  if (signed) {
    await logEvent(signed.id, 'VERIFIED', { actor: 'Public verification', req, details: { result: 'AUTHENTIC' } })
    return NextResponse.json({ result: 'AUTHENTIC', sha256: sha, envelope: await summary(signed) })
  }
  const { data: orig } = await sb.from('esign_envelopes').select('*').eq('original_sha256', sha).limit(1).maybeSingle()
  if (orig) return NextResponse.json({ result: 'ORIGINAL', sha256: sha, envelope: await summary(orig) })
  return NextResponse.json({ result: 'UNKNOWN', sha256: sha })
}
