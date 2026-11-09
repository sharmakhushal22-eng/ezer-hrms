// lib/lms/certificate.ts — issue, draw and verify certificates. Server only.
//
// The PDF is drawn on demand from the certificate row rather than stored: it is small, it
// always reads the current company name and logo position, and a revoked certificate has no
// orphaned file still in circulation. The row is the record; the PDF is a view of it.
import crypto from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { toWinAnsi } from '@/lib/letters/winAnsi'
import { must, sb, settingsFor } from './server'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // no 0/O or 1/I: this gets read aloud

function certNo(now: number): string {
  const bytes = crypto.randomBytes(6)
  const code = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('')
  return `EZL-${new Date(now).getUTCFullYear()}-${code}`
}

export interface IssueInput {
  companyId: string
  learnerId: string
  enrollmentId?: string
  pathEnrollmentId?: string
  recipient: string
  title: string
  scorePct: number | null
  expiresAt: string | null
  now?: number
}

/** Issue once. A retried completion finds the existing row and returns it. */
export async function issueCertificate(i: IssueInput) {
  const col = i.enrollmentId ? 'enrollment_id' : 'path_enrollment_id'
  const key = i.enrollmentId || i.pathEnrollmentId!
  const { data: existing } = await sb.from('lms_certificates').select('*').eq(col, key).maybeSingle()
  if (existing) return existing
  const now = i.now ?? Date.now()
  const made = await sb.from('lms_certificates').insert({
    company_id: i.companyId, learner_id: i.learnerId, enrollment_id: i.enrollmentId || null, path_enrollment_id: i.pathEnrollmentId || null,
    cert_no: certNo(now), verify_code: crypto.randomBytes(18).toString('base64url'), recipient_name: i.recipient, title: i.title,
    score_pct: i.scorePct, issued_at: new Date(now).toISOString(), expires_at: i.expiresAt,
  }).select('*').single()
  return must(made)
}

// On Learning's own domain when it has one (lib/lms/site.ts); the HRMS address keeps working too.
export const verifyUrl = (code: string) =>
  `${(process.env.NEXT_PUBLIC_LMS_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com').replace(/\/+$/, '')}/learn/verify/${code}`

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' })

export async function certificatePdf(cert: any): Promise<Uint8Array> {
  const [{ data: company }, settings] = await Promise.all([
    sb.from('companies').select('company_name').eq('id', cert.company_id).maybeSingle(),
    settingsFor(cert.company_id),
  ])
  const doc = await PDFDocument.create()
  doc.setTitle(`${cert.title}: ${cert.cert_no}`)
  doc.setAuthor('EZER Learn')
  const page = doc.addPage([842, 595])   // A4 landscape
  const { width: W, height: H } = page.getSize()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const ink = rgb(0.06, 0.09, 0.16), muted = rgb(0.39, 0.45, 0.55), brand = rgb(0.11, 0.31, 0.85)

  page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: brand, borderWidth: 1.5 })
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: rgb(0.86, 0.89, 0.95), borderWidth: 0.75 })

  // Helvetica carries WinAnsi only: a name in another script must not stop the PDF.
  const center = (raw: string, y: number, size: number, font = regular, color = ink, maxWidth = W - 160) => {
    const s = toWinAnsi(String(raw ?? ''))
    let sz = size
    while (font.widthOfTextAtSize(s, sz) > maxWidth && sz > 10) sz -= 1
    page.drawText(s, { x: (W - font.widthOfTextAtSize(s, sz)) / 2, y, size: sz, font, color })
  }

  center(company?.company_name || 'EZER HRMS', H - 92, 14, bold, muted)
  center(settings.cert_title || 'Certificate of Completion', H - 150, 32, bold, brand)
  center('This certifies that', H - 200, 13, italic, muted)
  center(cert.recipient_name, H - 248, 30, bold)
  center(cert.enrollment_id ? 'has successfully completed the course' : 'has successfully completed the programme', H - 288, 13, italic, muted)
  center(cert.title, H - 328, 20, bold)
  const facts = [`Issued ${fmt(cert.issued_at)}`]
  if (cert.score_pct != null) facts.push(`Score ${Number(cert.score_pct)}%`)
  if (cert.expires_at) facts.push(`Valid until ${fmt(cert.expires_at)}`)
  center(facts.join('   ·   '), H - 362, 12, regular, muted)

  if (settings.cert_signatory_name) {
    const x = 96
    page.drawLine({ start: { x, y: 112 }, end: { x: x + 190, y: 112 }, thickness: 0.75, color: muted })
    page.drawText(toWinAnsi(settings.cert_signatory_name), { x, y: 96, size: 11, font: bold, color: ink })
    if (settings.cert_signatory_title) page.drawText(toWinAnsi(settings.cert_signatory_title), { x, y: 82, size: 10, font: regular, color: muted })
  }
  const url = verifyUrl(cert.verify_code)
  const qr = await doc.embedPng(await QRCode.toBuffer(url, { margin: 0, width: 220 }))
  page.drawImage(qr, { x: W - 164, y: 62, width: 76, height: 76 })
  const no = `Certificate ${cert.cert_no}`
  page.drawText(no, { x: W - 180 - bold.widthOfTextAtSize(no, 9), y: 96, size: 9, font: bold, color: ink })
  const hint = 'Scan to verify'
  page.drawText(hint, { x: W - 180 - regular.widthOfTextAtSize(hint, 9), y: 83, size: 9, font: regular, color: muted })

  return doc.save()
}

/** What the public verification page may say. Enough to confirm a certificate is genuine,
 *  and nothing else about the person: no employee code, department or email. */
export async function verifyCertificate(code: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null
  const { data: c } = await sb.from('lms_certificates').select('cert_no, company_id, recipient_name, title, issued_at, expires_at, revoked_at').eq('verify_code', code).maybeSingle()
  if (!c) return null
  const { data: co } = await sb.from('companies').select('company_name').eq('id', c.company_id).maybeSingle()
  const status = c.revoked_at ? 'REVOKED' : c.expires_at && new Date(c.expires_at).getTime() < now ? 'EXPIRED' : 'VALID'
  return { status, cert_no: c.cert_no, recipient: c.recipient_name, title: c.title, company: co?.company_name || null, issued_at: c.issued_at, expires_at: c.expires_at }
}
