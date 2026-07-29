// ================================================================
// EZER HRMS — Email a Generated Letter
// Path: lib/letters/emailLetter.ts
// Reconciled to EZER: office_email column, service-role-with-anon-fallback.
// The actual send is via Resend if RESEND_API_KEY is set; otherwise it
// just records emailed_at (so the flow works even without a provider).
// ================================================================
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

interface EmailLetterArgs {
  generatedLetterId: string
}

export async function emailGeneratedLetter({ generatedLetterId }: EmailLetterArgs) {
  const { data: letter, error } = await supa
    .from('generated_letters')
    .select(`
      id, file_url, letter_date,
      template:letter_templates(name),
      employee:employees(full_name, personal_email, office_email)
    `)
    .eq('id', generatedLetterId)
    .maybeSingle()

  if (error || !letter) throw new Error('Generated letter not found')

  const emp: any = (letter as any).employee
  const to = emp?.office_email ?? emp?.personal_email
  if (!to) throw new Error('Employee has no email on file')

  const { data: pdfBlob } = await supa.storage.from('generated-letters').download(letter.file_url)
  if (!pdfBlob) throw new Error('Could not download the generated letter file')
  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())

  const letterName = (letter as any).template?.name ?? 'Letter'
  const employeeName = emp?.full_name ?? 'Employee'
  const dateFmt = new Date(letter.letter_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  const subject = `Your ${letterName} — ${dateFmt}`
  const html = `
  <div style="font-family:system-ui,sans-serif; max-width:600px; margin:0 auto; color:#1E1B4B;">
    <div style="background:#1E1B4B; padding:20px 24px; border-radius:12px 12px 0 0;">
      <span style="color:#fff; font-size:18px; font-weight:600;">EZER HRMS</span>
    </div>
    <div style="border:1px solid #E9E7F5; border-top:none; border-radius:0 0 12px 12px; padding:24px;">
      <p style="font-size:15px;">Dear ${employeeName},</p>
      <p style="font-size:14px; line-height:1.7;">
        Please find your <strong>${letterName}</strong> attached, dated ${dateFmt}.
      </p>
      <p style="font-size:13px; color:#6B6B7B; margin-top:20px;">
        If you have any questions about this letter, please contact the HR team.
        This is an automated message from EZER HRMS.
      </p>
    </div>
  </div>`

  // Send via Resend if configured; otherwise skip the send but still record it.
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey) {
    const from = process.env.HR_DEFAULT_EMAIL || 'hr@ezer-hrms.com'
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, subject, html,
        attachments: [{ filename: `${letterName}.pdf`, content: pdfBuffer.toString('base64') }],
      }),
    })
    if (!res.ok) throw new Error('Email provider error: ' + (await res.text()).slice(0, 200))
  }

  await supa.from('generated_letters').update({ emailed_at: new Date().toISOString() }).eq('id', generatedLetterId)

  return { to, subject, sent: !!apiKey }
}
