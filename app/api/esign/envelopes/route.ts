// app/api/esign/envelopes/route.ts — HR's list of documents sent for signature, and sending.
//
// GET   ?status=&q=&limit=   envelopes with their signers (secrets stripped)
// POST  { uploadPath, title, signers[], fields[], recipients?[], … }  → creates one
//       envelope (or one per recipient for a bulk send) and mails the first invites.
// Gated by HR Letters: sending documents for signature is an HR documents job.
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { sb, appBase, senderOf, publicSigner, migrationHint } from '@/lib/esign/server'
import { createEnvelopes, type CreateInput } from '@/lib/esign/flow'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters', 'VIEW')
  if (gate.error) return gate.error
  const sp = req.nextUrl.searchParams
  const limit = Math.min(500, Number(sp.get('limit')) || 300)
  let q = sb.from('esign_envelopes')
    .select('id, envelope_no, title, category, source, batch_id, status, signing_order, page_count, original_name, expires_at, created_by_name, created_at, updated_at, completed_at, void_reason, esign_signers(id, order_no, name, email, status, role_label, auth_method, signed_at, viewed_at, invited_at, declined_at, decline_reason, employee_id)')
    .order('created_at', { ascending: false }).limit(limit)
  const st = sp.get('status')
  // A DRAFT is a joining-forms bundle the candidate has opened but not signed yet (lib/onboarding/esign.ts).
  q = st ? q.in('status', st.split(',')) : q.neq('status', 'DRAFT')
  const { data, error } = await q
  if (error) return NextResponse.json({ error: migrationHint(error) || error.message, setup: !!migrationHint(error) }, { status: migrationHint(error) ? 503 : 500 })

  // An envelope past its expiry is shown — and stored — as expired.
  const now = Date.now()
  const stale = (data || []).filter(e => ['SENT', 'IN_PROGRESS'].includes(e.status) && e.expires_at && new Date(e.expires_at).getTime() < now)
  if (stale.length) await sb.from('esign_envelopes').update({ status: 'EXPIRED' }).in('id', stale.map(e => e.id))
  const rows = (data || []).map((e: any) => ({
    ...e, status: stale.some(s => s.id === e.id) ? 'EXPIRED' : e.status,
    signers: (e.esign_signers || []).map(publicSigner).sort((a: any, b: any) => a.order_no - b.order_no), esign_signers: undefined,
  }))
  return NextResponse.json({ envelopes: rows })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters', 'EDIT')
  if (gate.error) return gate.error
  try {
    const body = await req.json()
    if (!/^uploads\/[0-9a-f-]{36}\.pdf$/.test(String(body.uploadPath || ''))) return NextResponse.json({ error: 'Upload the PDF first.' }, { status: 400 })
    const sender = await senderOf(gate.user)
    const input: CreateInput = {
      uploadPath: body.uploadPath, originalName: body.originalName, title: String(body.title || ''), message: body.message,
      category: body.category, companyId: body.companyId || sender.companyId, signingOrder: body.signingOrder === 'PARALLEL' ? 'PARALLEL' : 'SEQUENTIAL',
      expiresDays: Number(body.expiresDays) || 14, ccEmails: (body.ccEmails || []).map((s: string) => String(s).trim()).filter(Boolean),
      signers: body.signers || [], fields: body.fields || [], recipients: body.recipients, source: body.source, sourceRef: body.sourceRef,
      sender,
    }
    const out = await createEnvelopes(input, appBase(req), req)
    return NextResponse.json(out)
  } catch (e: any) {
    const hint = migrationHint(e)
    return NextResponse.json({ error: hint || e?.message || String(e) }, { status: e?.status || (hint ? 503 : 500) })
  }
}
