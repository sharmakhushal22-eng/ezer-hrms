// app/api/transfer/notify/route.ts
// Emails the employee their transfer letter link. Words: Configuration → Employee lifecycle →
// "Transfer — email to employee", for the company / branch the employee moves to.
// WhatsApp (Interakt) + notifications table are future — ESS reads employee_transfer directly.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTransferEditor } from '@/lib/employees/transfer-auth'
import { renderEmail } from '@/lib/config/store'
import { mailConfigured, sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  const denied = await requireTransferEditor(req)
  if (denied) return denied
  try {
    const { transfer_id } = await req.json()
    if (!transfer_id) return NextResponse.json({ error: 'transfer_id required' }, { status: 400 })

    const { data: tr } = await supa.from('employee_transfer').select('*').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data: emp } = await supa.from('employees').select('full_name, personal_email, office_email').eq('id', tr.employee_id).maybeSingle()
    const to = emp?.office_email || emp?.personal_email
    if (!to) return NextResponse.json({ ok: false, skipped: true, reason: 'no employee email' })

    if (!mailConfigured()) return NextResponse.json({ ok: false, skipped: true, reason: 'Gmail not configured' })

    const base = process.env.NEXT_PUBLIC_APP_URL || ''
    const letterLink = tr.letter_url ? (tr.letter_url.startsWith('http') ? tr.letter_url : base + tr.letter_url) : ''
    const eff = tr.effective_date ? new Date(tr.effective_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : ''
    const mail = await renderEmail('transfer.notice',
      { companyId: tr.to_company_id || tr.from_company_id || null, locationId: tr.to_branch_id || null },
      { employee_name: emp?.full_name || 'Employee', effective_date: eff, letter_link: letterLink })
    // Email best-effort — ESS still shows the ACK card.
    await sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'EZER HR' })

    // TODO: WhatsApp via Interakt when wired (July).
    return NextResponse.json({ ok: true, emailed: to })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
