// app/api/recruitment/send-letter/route.ts
// Generic letter emailer — renders a professional A4 letter PDF and emails it
// via Gmail. Used for Resignation-Acceptance / Joining-Confirmation / etc.
//
// Two ways to call it:
//   { acceptance: 'EXPERIENCED' | 'FRESHER', candidate_id, company_id?, doj?, to, cc? }
//       Pre-onboarding's acceptance letters. The letter and the covering email are rendered
//       here from Configuration → Recruitment ("Offer acceptance & resignation advisory" /
//       "Joining confirmation letter" and their emails), for the candidate's company / branch.
//   { to, cc?, subject, body, letter? }
//       Any other letter, sent exactly as given (the original contract, kept for callers).
import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import { renderLetterPng, type LetterData } from '@/lib/letters'
import { pngToPdf } from '@/lib/offer-letter-image'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { resolveTemplate, renderResolvedEmail, mrfScope, isUuid } from '@/lib/config/store'
import { renderText, stripMarkup } from '@/lib/config/render'
import { sendMail, MAIL_NOT_CONFIGURED } from '@/lib/mail/send'

export const runtime = 'nodejs'

// GET ?preview=1 — returns a sample letter PNG for visual verification.
export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const sp = new URL(req.url).searchParams
  if (sp.get('preview') !== '1') return NextResponse.json({ error: 'add ?preview=1' }, { status: 400 })
  const png = await renderLetterPng({
    company_name: sp.get('company_name') || 'Sharma Sons Pvt. Ltd.',
    title: sp.get('title') || 'JOINING CONFIRMATION LETTER',
    recipient: sp.get('recipient') || 'Rohan Mehta',
    paragraphs: [
      'Congratulations and welcome aboard! We are pleased to confirm your joining and look forward to having you on the team.',
      'Please report on your date of joining with the required documents. Our HR team will guide you through the onboarding formalities and your workspace setup.',
    ],
    highlights: [
      { label: 'Position', value: 'Demand Planning Manager' },
      { label: 'Date of Joining', value: '01 July 2026' },
    ],
    from_name: 'Nayan Ahuja',
  })
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
}

/** The acceptance letter and its email, from Configuration. */
async function acceptanceMail(kind: 'EXPERIENCED' | 'FRESHER', candidateId: string, companyIdHint: string | null, dojHint: string | null) {
  const { data: c } = await sb.from('candidates').select('full_name, designation, company_id, mrf_id, doj').eq('id', candidateId).maybeSingle()
  if (!c) return null
  const companyId = (isUuid(companyIdHint) ? companyIdHint : null) || c.company_id || null
  const { data: co } = companyId ? await sb.from('companies').select('company_name').eq('id', companyId).maybeSingle() : { data: null }
  const scope = await mrfScope(c.mrf_id, companyId)
  const k = kind === 'EXPERIENCED' ? 'experienced' : 'fresher'
  const [tLetter, tEmail] = await Promise.all([resolveTemplate(`acceptance.${k}.letter`, scope), resolveTemplate(`acceptance.${k}.email`, scope)])
  const vars = {
    candidate_name: c.full_name,
    role: c.designation || 'the role',
    company_name: co?.company_name || 'our organization',
    doj: String(dojHint || c.doj || 'to be confirmed'),
  }
  const letterText = stripMarkup(renderText(tLetter!.body, vars).text)
  const mail = renderResolvedEmail(tEmail!, { ...vars, letter_body: letterText })
  const letter: LetterData = {
    company_name: vars.company_name,
    title: stripMarkup(renderText(tLetter!.subject, vars).text) || (kind === 'EXPERIENCED' ? 'OFFER ACCEPTANCE & RESIGNATION ADVISORY' : 'JOINING CONFIRMATION LETTER'),
    recipient: c.full_name,
    paragraphs: letterText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean),
    highlights: [{ label: 'Position', value: vars.role }, { label: 'Date of Joining', value: vars.doj }],
  }
  return { mail, letter }
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  try {
    const b = (await req.json()) as {
      to: string
      cc?: string
      subject?: string
      body?: string
      letter?: LetterData
      acceptance?: 'EXPERIENCED' | 'FRESHER'
      candidate_id?: string
      company_id?: string | null
      doj?: string | null
    }
    let { subject, body, letter } = b
    let html: string | undefined
    let template: unknown = null
    if (b.acceptance) {
      if (b.acceptance !== 'EXPERIENCED' && b.acceptance !== 'FRESHER') return NextResponse.json({ error: 'acceptance must be EXPERIENCED or FRESHER' }, { status: 400 })
      if (!isUuid(b.candidate_id)) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })
      const built = await acceptanceMail(b.acceptance, b.candidate_id, b.company_id ?? null, b.doj ?? null)
      if (!built) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
      subject = built.mail.subject; body = built.mail.text; html = built.mail.html; letter = built.letter; template = built.mail.template
    }
    if (!b.to || !subject || !body) {
      return NextResponse.json({ error: 'Missing recipient, subject, or body' }, { status: 400 })
    }

    const ccList = (b.cc || '').split(',').map((e) => e.trim()).filter(Boolean)

    const attachments: { filename: string; content: Buffer; contentType: string }[] = []
    if (letter) {
      try {
        const png = await renderLetterPng({ ...letter, from_name: process.env.GMAIL_FROM_NAME })
        const pdf = await pngToPdf(png)
        const fname = (letter.title || 'Letter').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') + '.pdf'
        attachments.push({ filename: fname, content: Buffer.from(pdf), contentType: 'application/pdf' })
      } catch (e) {
        console.error('letter PDF build failed — sending without attachment:', e)
      }
    }

    const r = await sendMail({
      to: b.to, cc: ccList, subject, text: body, html: html ?? String(body).replace(/\n/g, '<br>'), attachments,
    })
    if (r.skipped) {
      return NextResponse.json({ error: `${MAIL_NOT_CONFIGURED} Set GMAIL_USER and GMAIL_APP_PASSWORD.` }, { status: 502 })
    }
    if (!r.sent) return NextResponse.json({ error: r.error || 'Failed to send letter' }, { status: 502 })
    return NextResponse.json({ ok: true, messageId: r.messageId, template })
  } catch (err: any) {
    console.error('send-letter failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send letter' }, { status: 502 })
  }
}
