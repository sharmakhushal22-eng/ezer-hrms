// app/api/esign/envelopes/[id]/route.ts — one envelope for HR.
//
// GET                       envelope, signers, fields, audit trail, short-lived file links
// POST { action: 'remind' }               re-mail whoever may sign now (fresh links)
// POST { action: 'void', reason }         cancel: links stop working, signers are told nothing more
// POST { action: 'resend', signer_id }    one signer's link again (e.g. "I deleted the mail")
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { sb, appBase, inviteActive, logEvent, senderOf, publicSigner, signedFileUrl, migrationHint, issueLink, mailInvite, signUrl } from '@/lib/esign/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireModule(req, 'HR Letters', 'VIEW')
  if (gate.error) return gate.error
  const { id } = await params
  const { data: env, error } = await sb.from('esign_envelopes').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: migrationHint(error) || error.message }, { status: 500 })
  if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [{ data: signers }, { data: fields }, { data: events }] = await Promise.all([
    sb.from('esign_signers').select('*').eq('envelope_id', id).order('order_no'),
    sb.from('esign_fields').select('id, signer_id, page, x, y, w, h, kind').eq('envelope_id', id),
    sb.from('esign_events').select('id, signer_id, action, actor, ip, user_agent, details, at').eq('envelope_id', id).order('at'),
  ])
  const stem = String(env.title || 'document').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'document'
  const files = {
    original: await signedFileUrl(env.original_path, `${stem}_original.pdf`),
    current: env.working_path && env.working_path !== env.original_path ? await signedFileUrl(env.working_path, `${stem}_in_progress.pdf`) : null,
    signed: env.signed_path ? await signedFileUrl(env.signed_path, `${stem}_signed_${env.envelope_no}.pdf`) : null,
    preview: await signedFileUrl(env.signed_path || env.working_path || env.original_path),
  }
  return NextResponse.json({ envelope: env, signers: (signers || []).map(publicSigner), fields: fields || [], events: events || [], files })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const gate = await requireModule(req, 'HR Letters', 'EDIT')
  if (gate.error) return gate.error
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { data: env } = await sb.from('esign_envelopes').select('*').eq('id', id).maybeSingle()
  if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const open = ['SENT', 'IN_PROGRESS'].includes(env.status)
  const who = (await senderOf(gate.user)).name

  if (body.action === 'void') {
    if (!open) return NextResponse.json({ error: `This document is ${env.status.toLowerCase()} and cannot be voided.` }, { status: 409 })
    const reason = String(body.reason || '').trim()
    if (reason.length < 3) return NextResponse.json({ error: 'Give a reason for voiding.' }, { status: 400 })
    await sb.from('esign_envelopes').update({ status: 'VOIDED', void_reason: reason, updated_at: new Date().toISOString() }).eq('id', id)
    await sb.from('esign_signers').update({ token_hash: null, session_hash: null }).eq('envelope_id', id)
    await logEvent(id, 'VOIDED', { actor: who, req, details: { reason } })
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'remind') {
    if (!open) return NextResponse.json({ error: 'Only a document still waiting for signatures can be reminded.' }, { status: 409 })
    const r = await inviteActive(id, appBase(req), { reminder: true, req, actor: who })
    await sb.from('esign_envelopes').update({ last_reminded_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, ...r })
  }
  if (body.action === 'resend') {
    if (!open) return NextResponse.json({ error: 'This document is not waiting for signatures.' }, { status: 409 })
    const { data: s } = await sb.from('esign_signers').select('*').eq('id', body.signer_id).eq('envelope_id', id).maybeSingle()
    if (!s || s.status === 'SIGNED' || s.status === 'DECLINED' || s.status === 'WAITING') return NextResponse.json({ error: 'That signer cannot be sent a link right now.' }, { status: 409 })
    const token = await issueLink(s.id)
    const r = await mailInvite({ to: s.email, name: s.name, sender: env.created_by_name || 'HR', title: env.title, message: env.message, category: env.category, link: signUrl(appBase(req), token), envelopeNo: env.envelope_no, expiresAt: env.expires_at, reminder: true })
    await logEvent(id, 'REMINDED', { signerId: s.id, actor: who, req, details: { mail: r.sent ? 'sent' : (r.skipped || r.error) } })
    return NextResponse.json({ ok: true, sent: r.sent, error: r.sent ? null : (r.skipped || r.error), link: r.sent ? null : signUrl(appBase(req), token) })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
