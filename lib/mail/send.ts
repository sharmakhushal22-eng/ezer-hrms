// lib/mail/send.ts — the one place an email leaves the portal from.
//
// Gmail SMTP through nodemailer, exactly as the routes did one by one before
// (GMAIL_USER / GMAIL_APP_PASSWORD / GMAIL_FROM_NAME). Each of those routes built its
// own transport; the ones moved onto Configuration templates now call this instead,
// and the rest can follow without changing behaviour.
//
// It never throws. A caller gets { sent, skipped?, error? } and decides what to tell
// the user — the offer flow refuses to mark an offer sent, the interview flow carries
// on and reports "email skipped", as each did before.
//
// Server only (Node runtime — nodemailer does not run on Edge).
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface MailAttachment { filename: string; content: Buffer; contentType?: string }

export interface MailInput {
  to: string | string[]
  cc?: string[]
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  /** Display name when GMAIL_FROM_NAME is not set. Routes keep the fallback they had. */
  fromName?: string
}

export interface MailResult {
  sent: boolean
  /** Set when nothing was attempted (no mail configuration). */
  skipped?: string
  /** Set when the provider refused or the connection failed. */
  error?: string
  messageId?: string
}

export const MAIL_NOT_CONFIGURED = 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD).'

let transport: Transporter | null = null

export function mailConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

export async function sendMail(m: MailInput): Promise<MailResult> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return { sent: false, skipped: MAIL_NOT_CONFIGURED }

  try {
    if (!transport) transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    const info = await transport.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || m.fromName || 'HR Team'}" <${user}>`,
      to: m.to,
      cc: m.cc && m.cc.length ? m.cc : undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
      attachments: m.attachments,
    })
    return { sent: true, messageId: info.messageId }
  } catch (e) {
    console.error('sendMail failed:', e)
    return { sent: false, error: e instanceof Error ? e.message : 'Failed to send email' }
  }
}
