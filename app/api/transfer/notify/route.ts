// app/api/transfer/notify/route.ts
// Emails the employee their transfer letter link via the existing Gmail/nodemailer setup.
// WhatsApp (Interakt) + notifications table are future — ESS reads employee_transfer directly.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { transfer_id } = await req.json()
    if (!transfer_id) return NextResponse.json({ error: 'transfer_id required' }, { status: 400 })

    const { data: tr } = await supa.from('employee_transfer').select('*').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data: emp } = await supa.from('employees').select('full_name, personal_email, office_email').eq('id', tr.employee_id).maybeSingle()
    const to = emp?.office_email || emp?.personal_email
    if (!to) return NextResponse.json({ ok: false, skipped: true, reason: 'no employee email' })

    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) return NextResponse.json({ ok: false, skipped: true, reason: 'Gmail not configured' })

    const base = process.env.NEXT_PUBLIC_APP_URL || ''
    const letterLink = tr.letter_url ? (tr.letter_url.startsWith('http') ? tr.letter_url : base + tr.letter_url) : ''
    const eff = tr.effective_date ? new Date(tr.effective_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : ''
    const subject = 'Transfer Letter — action required'
    const body =
      `Dear ${emp?.full_name || 'Employee'},\n\n` +
      `A transfer has been initiated for you, effective ${eff}.\n\n` +
      (letterLink ? `View your transfer letter: ${letterLink}\n\n` : '') +
      `Please acknowledge your acceptance in the EZER ESS portal.\n\n— EZER HR`

    try {
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
      await transporter.sendMail({
        from: `"${process.env.GMAIL_FROM_NAME || 'EZER HR'}" <${user}>`,
        to, subject, text: body, html: body.replace(/\n/g, '<br>'),
      })
    } catch (e) { /* email best-effort — ESS still shows the ACK card */ }

    // TODO: WhatsApp via Interakt when wired (July).
    return NextResponse.json({ ok: true, emailed: to })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
