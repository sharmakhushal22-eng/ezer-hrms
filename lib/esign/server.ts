// lib/esign/server.ts — EZER Sign's database and storage access. Server only.
//
// Everything runs with the service-role key: the esign_* tables have RLS on and no policy
// (migration 174), so this file and the /api/esign routes are the only way in.
import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { sendMail } from '@/lib/mail/send'
import { clientIp, istStamp, maskEmail, newToken, categoryLabel } from './core'

export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  { auth: { persistSession: false } },
)
export const BUCKET = 'esign'

/** Base URL for links in mails: the deployment the request came to (so a link made on a
 *  preview or on localhost opens there), else NEXT_PUBLIC_APP_URL. */
export function appBase(req: NextRequest): string {
  const origin = req.headers.get('origin') || req.nextUrl.origin
  return (origin || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com').replace(/\/+$/, '')
}
export const signUrl = (base: string, token: string) => `${base}/sign/${token}`
export const verifyUrl = (base: string, envelopeNo?: string) => `${base}/sign/verify${envelopeNo ? `?id=${encodeURIComponent(envelopeNo)}` : ''}`

/** A friendly error when migration 174 has not been run yet. */
export function migrationHint(e: any): string | null {
  const m = String(e?.message || e || '')
  if (/esign_(envelopes|signers|fields|events)/.test(m) && /(does not exist|schema cache|relation)/i.test(m))
    return 'E-Sign is not set up yet: run supabase/migrations/174_esign.sql in the Supabase SQL editor.'
  if (/Bucket not found/i.test(m)) return 'The private storage bucket "esign" is missing: run supabase/migrations/174_esign.sql.'
  return null
}

export async function logEvent(envelopeId: string, action: string, o: { signerId?: string | null; actor?: string | null; req?: NextRequest; details?: any } = {}) {
  await sb.from('esign_events').insert({
    envelope_id: envelopeId, signer_id: o.signerId || null, action, actor: o.actor || null,
    ip: o.req ? clientIp(o.req.headers) : null, user_agent: o.req?.headers.get('user-agent') || null,
    details: o.details || {},
  })
}

export async function upload(path: string, bytes: Uint8Array, type = 'application/pdf') {
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true })
  if (error) throw error
}
export async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(BUCKET).download(path)
  if (error || !data) throw error || new Error('file missing')
  return new Uint8Array(await data.arrayBuffer())
}
export async function signedFileUrl(path: string, name?: string, seconds = 300): Promise<string | null> {
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds, name ? { download: name } : undefined)
  return data?.signedUrl || null
}

// ── Mail ─────────────────────────────────────────────────────────────────────
// Plain, well-structured HTML that survives Gmail/Outlook: one table, inline styles, a
// single bulletproof button. Hex colours are fine here — this is mail, not the app theme.
function shell(o: { pre: string; title: string; body: string; cta?: { label: string; href: string }; foot?: string }) {
  const btn = o.cta ? `<tr><td style="padding:6px 32px 26px"><a href="${o.cta.href}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:9px">${o.cta.label}</a></td></tr>` : ''
  return `<!doctype html><html><body style="margin:0;background:#f1f5fb;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden">${o.pre}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5fb;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #dbe4f3;overflow:hidden">
<tr><td style="background:#0f2554;padding:18px 32px"><span style="color:#9fbfff;font-size:11px;font-weight:700;letter-spacing:.14em">EZER SIGN</span></td></tr>
<tr><td style="padding:26px 32px 8px"><div style="font-size:19px;font-weight:700;line-height:1.35">${o.title}</div></td></tr>
<tr><td style="padding:6px 32px 16px;font-size:14px;line-height:1.6;color:#334155">${o.body}</td></tr>
${btn}
<tr><td style="padding:16px 32px 22px;border-top:1px solid #e5ebf5;font-size:11.5px;line-height:1.55;color:#64748b">${o.foot || 'This link is personal to you. Do not forward it — anyone holding it can request a one-time password to your e-mail. EZER Sign never asks for your password.'}</td></tr>
</table></td></tr></table></body></html>`
}
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export async function mailInvite(o: { to: string; name: string; sender: string; title: string; message?: string | null; category?: string | null; link: string; envelopeNo: string; expiresAt?: string | null; reminder?: boolean }) {
  const subject = `${o.reminder ? 'Reminder: ' : ''}Please sign: ${o.title}`
  const body = `Dear ${esc(o.name)},<br><br>${esc(o.sender)} has sent you <b>${esc(o.title)}</b>${o.category ? ` (${esc(categoryLabel(o.category))})` : ''} to review and sign electronically.`
    + (o.message ? `<div style="margin:14px 0;padding:12px 14px;background:#f5f8ff;border-left:3px solid #1d4ed8;border-radius:6px;color:#1e293b">${esc(o.message).replace(/\n/g, '<br>')}</div>` : '<br><br>')
    + `You will verify your identity with a one-time password sent to this e-mail address, then draw, type or upload your signature.`
    + `<br><br><span style="color:#64748b;font-size:12.5px">Envelope <b>${o.envelopeNo}</b>${o.expiresAt ? ` · link valid till ${istStamp(o.expiresAt).replace(/, \d\d:\d\d:\d\d IST$/, '')}` : ''}</span>`
  const text = `Dear ${o.name},\n\n${o.sender} has sent you "${o.title}" to sign electronically.\n${o.message ? `\n${o.message}\n` : ''}\nReview and sign: ${o.link}\n\nEnvelope ${o.envelopeNo}`
  return sendMail({ to: o.to, subject, text, html: shell({ pre: `${o.sender} sent you a document to sign`, title: o.reminder ? `A document is still waiting for your signature` : `You have a document to sign`, body, cta: { label: 'Review & sign', href: o.link } }), fromName: 'EZER Sign' })
}

export async function mailOtp(o: { to: string; name: string; otp: string; title: string }) {
  const body = `Dear ${esc(o.name)},<br><br>Your one-time password to sign <b>${esc(o.title)}</b> is:<div style="margin:18px 0;font-size:30px;font-weight:800;letter-spacing:.32em;color:#0f2554">${o.otp}</div>It is valid for 10 minutes. If you did not request it, ignore this mail — nobody can sign without it.`
  return sendMail({ to: o.to, subject: `${o.otp} is your EZER Sign code`, text: `Your EZER Sign one-time password for "${o.title}" is ${o.otp}. Valid for 10 minutes.`, html: shell({ pre: `Your code is ${o.otp}`, title: 'Your signing code', body, foot: 'EZER Sign will never ask you to share this code with anyone, including HR.' }), fromName: 'EZER Sign' })
}

export async function mailCompleted(o: { to: string[]; title: string; envelopeNo: string; pdf: Uint8Array; fileName: string; verify: string; signers: string[] }) {
  const body = `<b>${esc(o.title)}</b> has been signed by everyone:<br><br>${o.signers.map(s => `&#10003; ${esc(s)}`).join('<br>')}<br><br>The signed PDF is attached. Its last page is the Certificate of Completion with the full audit trail. Keep this mail as your copy.`
  return sendMail({
    to: o.to, subject: `Completed: ${o.title}`, text: `"${o.title}" has been signed by everyone. The signed PDF with its certificate is attached.\nVerify it any time: ${o.verify}`,
    html: shell({ pre: 'Everyone has signed', title: 'Document completed ✓', body, cta: { label: 'Verify authenticity', href: o.verify }, foot: `Envelope ${o.envelopeNo}. To check a copy has not been altered, upload it at the verification page.` }),
    attachments: [{ filename: o.fileName, content: Buffer.from(o.pdf), contentType: 'application/pdf' }], fromName: 'EZER Sign',
  })
}

export async function mailDeclined(o: { to: string; title: string; who: string; reason: string; envelopeNo: string }) {
  return sendMail({ to: o.to, subject: `Declined: ${o.title}`, text: `${o.who} declined to sign "${o.title}". Reason: ${o.reason}`, html: shell({ pre: `${o.who} declined`, title: 'A signer declined', body: `<b>${esc(o.who)}</b> declined to sign <b>${esc(o.title)}</b>.<div style="margin:14px 0;padding:12px 14px;background:#fff7ed;border-left:3px solid #c2410c;border-radius:6px">${esc(o.reason)}</div>Open E-Sign in EZER HRMS to correct and resend.`, foot: `Envelope ${o.envelopeNo}` }), fromName: 'EZER Sign' })
}

/** Issue a fresh link for a signer (rotates the token: the previous link stops working). */
export async function issueLink(signerId: string): Promise<string> {
  const { token, hash } = newToken()
  const { error } = await sb.from('esign_signers').update({ token_hash: hash, token_issued_at: new Date().toISOString() }).eq('id', signerId)
  if (error) throw error
  return token
}

/** Invite whoever may sign now (sequential: the next in order; parallel: all still open). */
export async function inviteActive(envelopeId: string, base: string, opts: { reminder?: boolean; req?: NextRequest; actor?: string } = {}) {
  const { data: env } = await sb.from('esign_envelopes').select('*').eq('id', envelopeId).single()
  const { data: signers } = await sb.from('esign_signers').select('*').eq('envelope_id', envelopeId).order('order_no')
  if (!env || !signers) return { invited: 0, failed: [] as string[], links: [] as { name: string; email: string; link: string }[] }
  const open = signers.filter(s => s.status !== 'SIGNED' && s.status !== 'DECLINED')
  if (!open.length) return { invited: 0, failed: [], links: [] }
  const min = Math.min(...open.map(s => s.order_no))
  // Only people not yet invited get a new link — issuing one rotates the token, which would
  // break the link already sitting in an inbox. A reminder deliberately re-mails everyone open.
  const now = (env.signing_order === 'PARALLEL' ? open : open.filter(s => s.order_no === min))
    .filter(s => opts.reminder || s.status === 'WAITING')
  let invited = 0
  const failed: string[] = []
  // When a mail could not go out, HR gets the link to pass on another way (it still needs
  // the e-mail OTP to open, so handing it over does not let anyone else sign).
  const links: { name: string; email: string; link: string }[] = []
  for (const s of now) {
    const token = await issueLink(s.id)
    const r = await mailInvite({ to: s.email, name: s.name, sender: env.created_by_name || 'HR', title: env.title, message: env.message, category: env.category, link: signUrl(base, token), envelopeNo: env.envelope_no, expiresAt: env.expires_at, reminder: opts.reminder })
    await sb.from('esign_signers').update({ status: s.status === 'WAITING' ? 'PENDING' : s.status, invited_at: new Date().toISOString() }).eq('id', s.id)
    await logEvent(envelopeId, opts.reminder ? 'REMINDED' : 'INVITED', { signerId: s.id, actor: opts.actor || env.created_by_name || 'EZER Sign', req: opts.req, details: { to: maskEmail(s.email), mail: r.sent ? 'sent' : (r.skipped || r.error || 'not sent') } })
    if (r.sent) invited++; else { failed.push(`${s.email}: ${r.skipped || r.error}`); links.push({ name: s.name, email: s.email, link: signUrl(base, token) }) }
  }
  return { invited, failed, links }
}

/** Who is sending, for the mail and the certificate. */
export async function senderOf(user: { employeeId: string | null; email: string | null }) {
  if (user.employeeId) {
    const { data } = await sb.from('employees').select('full_name, office_email, personal_email, company_id').eq('id', user.employeeId).maybeSingle()
    if (data) return { id: user.employeeId, name: data.full_name || 'HR', email: data.office_email || data.personal_email || user.email, companyId: data.company_id as string | null }
  }
  return { id: null, name: user.email ? `HR (${user.email})` : 'HR', email: user.email, companyId: null }
}

/** A signer row without its secrets, for any response. */
export function publicSigner(s: any) {
  const { token_hash, session_hash, otp_hmac, aadhaar_otp_hmac, ...rest } = s || {}
  void token_hash; void session_hash; void otp_hmac; void aadhaar_otp_hmac
  return rest
}
