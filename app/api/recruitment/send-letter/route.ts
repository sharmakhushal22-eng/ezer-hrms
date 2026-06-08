// app/api/recruitment/send-letter/route.ts
// Generic letter emailer — renders a professional A4 letter PDF and emails it
// via Gmail. Used for Resignation-Acceptance / Joining-Confirmation / etc.
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { renderLetterPng, type LetterData } from '@/lib/letters'
import { pngToPdf } from '@/lib/offer-letter-image'

export const runtime = 'nodejs'

// GET ?preview=1 — returns a sample letter PNG for visual verification.
export async function GET(req: NextRequest) {
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

export async function POST(req: NextRequest) {
  try {
    const { to, cc, subject, body, letter } = (await req.json()) as {
      to: string
      cc?: string
      subject: string
      body: string
      letter?: LetterData
    }
    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Missing recipient, subject, or body' }, { status: 400 })
    }

    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) {
      return NextResponse.json(
        { error: 'Email is not configured on the server. Set GMAIL_USER and GMAIL_APP_PASSWORD.' },
        { status: 502 },
      )
    }

    const ccList = (cc || '').split(',').map((e) => e.trim()).filter(Boolean)

    const attachments: any[] = []
    if (letter) {
      try {
        const png = await renderLetterPng({ ...letter, from_name: process.env.GMAIL_FROM_NAME })
        const pdf = await pngToPdf(png)
        const fname = (letter.title || 'Letter').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') + '.pdf'
        attachments.push({ filename: fname, content: pdf, contentType: 'application/pdf' })
      } catch (e) {
        console.error('letter PDF build failed — sending without attachment:', e)
      }
    }

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    const info = await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
      to,
      cc: ccList.length ? ccList : undefined,
      subject,
      text: body,
      html: String(body).replace(/\n/g, '<br>'),
      attachments,
    })

    return NextResponse.json({ ok: true, messageId: info.messageId })
  } catch (err: any) {
    console.error('send-letter failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send letter' }, { status: 502 })
  }
}
