// ================================================================
// EZER HRMS — Email a Generated Letter
// Path: lib/letters/emailLetter.ts
//
// The covering email's words come from Configuration → 'HR letter — covering
// email' for the letter's company, and it goes out through the shared sender
// (lib/mail/send.ts, Gmail SMTP) with the generated PDF attached.
//
// emailed_at is stamped ONLY when the email actually left. It used to be
// stamped even when no provider was configured, which made an unsent letter
// look sent.
// ================================================================
import { createClient } from '@supabase/supabase-js'
import { renderEmail } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

interface EmailLetterArgs {
  generatedLetterId: string
}

/** The generated_letters row as selected below. */
interface LetterRow {
  id: string; file_url: string; letter_date: string | null; company_id: string | null
  template: { name: string | null } | null
  employee: { full_name: string | null; personal_email: string | null; office_email: string | null } | null
}

export async function emailGeneratedLetter({ generatedLetterId }: EmailLetterArgs) {
  const { data, error } = await supa
    .from('generated_letters')
    .select(`
      id, file_url, letter_date, company_id,
      template:letter_templates(name),
      employee:employees(full_name, personal_email, office_email)
    `)
    .eq('id', generatedLetterId)
    .maybeSingle()

  if (error || !data) throw new Error('Generated letter not found')
  const letter = data as unknown as LetterRow

  const emp = letter.employee
  const to = emp?.office_email ?? emp?.personal_email
  if (!to) throw new Error('Employee has no email on file')

  const { data: pdfBlob } = await supa.storage.from('generated-letters').download(letter.file_url)
  if (!pdfBlob) throw new Error('Could not download the generated letter file')
  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())

  const letterName = letter.template?.name ?? 'Letter'
  const dateFmt = new Date(letter.letter_date || Date.now())
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  // Read separately rather than embedded: generated_letters was created outside the
  // migrations, so a companies foreign key on it is not guaranteed.
  const companyId = letter.company_id ?? null
  const co = companyId
    ? (await supa.from('companies').select('company_name').eq('id', companyId).maybeSingle()).data as { company_name: string | null } | null
    : null

  const mail = await renderEmail('hr_letter.email', companyId, {
    employee_name: emp?.full_name ?? 'Employee',
    letter_name: letterName,
    letter_date: dateFmt,
    company_name: co?.company_name ?? '',
  })

  const sent = await sendMail({
    to, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'HR Team',
    attachments: [{ filename: `${letterName}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  })
  if (!sent.sent) throw new Error(sent.skipped || sent.error || 'Email was not sent')

  await supa.from('generated_letters').update({ emailed_at: new Date().toISOString() }).eq('id', generatedLetterId)

  return { to, subject: mail.subject, sent: true }
}
