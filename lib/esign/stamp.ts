// lib/esign/stamp.ts — what EZER Sign writes into the PDF. Server only (pdf-lib, qrcode).
//
// Three things, modelled on what Leegality / Adobe Acrobat Sign / eMudra print:
//
//  1. stampSignature()  in each of the signer's boxes: the signature itself, then under a
//                       hairline the words that make it verifiable — "Digitally signed by",
//                       the IST time, how identity was proved (e-mail OTP / Aadhaar OTP),
//                       and the signer reference + envelope number.
//  2. finalise()        once everyone has signed: a footer on every original page
//                       (envelope no., page x of y, "verify at …"), then a Certificate of
//                       Completion appended at the end — document fingerprint (SHA-256 of
//                       the original), every signer with how they were verified, IP, device
//                       and their signature, and the full time-stamped audit trail — with a
//                       QR that opens the public verification page.
//  3. The SHA-256 of the finished file is stored by the caller; /sign/verify recomputes it
//     from an uploaded copy, so any later edit to the PDF shows up as "not authentic".
//
// Coordinates: fields are stored as fractions of the page, y from the TOP (how people place
// them on screen). pdf-lib measures y from the bottom, so every box is flipped here, and the
// page's /Rotate is honoured so a landscape scan still gets the box where it was placed.
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib'
import { toWinAnsi } from '../letters/winAnsi.ts'
import { istStamp, describeAgent, maskAadhaar } from './core.ts'

const INK = rgb(0.07, 0.11, 0.2)
const MUTED = rgb(0.38, 0.42, 0.5)
const BRAND = rgb(0.11, 0.33, 0.78)
const OK = rgb(0.03, 0.5, 0.33)
const HAIR = rgb(0.8, 0.84, 0.9)
const WASH = rgb(0.95, 0.97, 1)

export interface StampField { page: number; x: number; y: number; w: number; h: number; kind: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME' }
export interface StampSigner {
  id: string; name: string; email: string; role_label?: string | null; designation?: string | null
  auth_method: 'EMAIL_OTP' | 'EMAIL_AADHAAR_OTP'; aadhaar_last4?: string | null; aadhaar_mode?: string | null
  email_verified_at?: string | null; aadhaar_verified_at?: string | null
  signed_at?: string | null; signed_ip?: string | null; signed_user_agent?: string | null
  order_no: number; status: string
}
export interface StampEnvelope {
  envelope_no: string; title: string; original_name?: string | null; page_count?: number | null
  original_sha256: string; created_at: string; completed_at?: string | null
  created_by_name?: string | null; created_by_email?: string | null; signing_order: string
  company_name?: string | null
}
export interface StampEvent { at: string; action: string; actor?: string | null; ip?: string | null; user_agent?: string | null; details?: any }

const t = (s: string) => toWinAnsi(String(s ?? ''))

/** Shrink text until it fits the width (never below `min`), then ellipsise. */
function fit(font: PDFFont, text: string, size: number, maxW: number, min = 4.2): { text: string; size: number } {
  let s = size, x = t(text)
  while (s > min && font.widthOfTextAtSize(x, s) > maxW) s -= 0.25
  if (font.widthOfTextAtSize(x, s) <= maxW) return { text: x, size: s }
  while (x.length > 3 && font.widthOfTextAtSize(x + '...', s) > maxW) x = x.slice(0, -1)
  return { text: x + '...', size: s }
}

/** Box in PDF user space for a field stored as top-left fractions, honouring /Rotate. */
function boxOnPage(page: PDFPage, f: StampField) {
  const { width: W, height: H } = page.getSize()
  const rot = ((page.getRotation().angle % 360) + 360) % 360
  // Fractions are of the page AS DISPLAYED. For 90/270 the displayed width is H.
  const dw = rot % 180 === 0 ? W : H, dh = rot % 180 === 0 ? H : W
  const dx = f.x * dw, dy = f.y * dh, bw = f.w * dw, bh = f.h * dh
  // Displayed (top-left origin) → unrotated PDF space (bottom-left origin).
  if (rot === 0) return { x: dx, y: H - dy - bh, w: bw, h: bh, rot }
  if (rot === 90) return { x: dy, y: dx, w: bh, h: bw, rot }
  if (rot === 180) return { x: W - dx - bw, y: dy, w: bw, h: bh, rot }
  return { x: W - dy - bh, y: H - dx - bw, w: bh, h: bw, rot }
}

export function authLine(s: Pick<StampSigner, 'auth_method' | 'aadhaar_last4' | 'aadhaar_mode'>): string {
  if (s.auth_method === 'EMAIL_AADHAAR_OTP' && s.aadhaar_last4) return `Email OTP + Aadhaar OTP (${maskAadhaar(s.aadhaar_last4)}${s.aadhaar_mode === 'DEMO' ? ', demo' : ''})`
  return 'Email OTP verified'
}

/**
 * Draw one signer's signature into every one of their boxes. `ref` is the short signer
 * reference printed on the stamp (first 8 of the signer id, upper-case).
 */
export async function stampSignature(pdfBytes: Uint8Array, opts: {
  fields: StampField[]; signer: StampSigner; signaturePng: Uint8Array; initialsPng?: Uint8Array | null; envelopeNo: string; signedAt: Date
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const img = await doc.embedPng(opts.signaturePng)
  const iniImg = opts.initialsPng ? await doc.embedPng(opts.initialsPng) : img
  const pages = doc.getPages()
  const ref = opts.signer.id.replace(/-/g, '').slice(0, 8).toUpperCase()
  const when = istStamp(opts.signedAt)

  for (const f of opts.fields) {
    const page = pages[f.page - 1]
    if (!page) continue
    const b = boxOnPage(page, f)
    if (f.kind === 'DATE' || f.kind === 'NAME') {
      drawRotated(page, b, (x, y, w, h, draw) => {
        const txt = f.kind === 'DATE' ? when.replace(/, \d\d:\d\d:\d\d IST$/, '') : opts.signer.name
        const ft = fit(font, txt, Math.min(11, h * 0.6), w - 4)
        draw.text(ft.text, x + 2, y + (h - ft.size) / 2 + 1, ft.size, font, INK)
      })
      continue
    }
    drawRotated(page, b, (x, y, w, h, draw) => signatureBlock(draw, { x, y, w, h }, {
      img: f.kind === 'INITIALS' ? iniImg : img, font, bold, initials: f.kind === 'INITIALS', name: opts.signer.name, when, auth: authLine(opts.signer), ref, envelopeNo: opts.envelopeNo,
    }))
  }
  return doc.save({ useObjectStreams: false })
}

// A tiny drawing facade so the same layout code works on rotated pages: we lay out in an
// upright local frame and map to the page with a rotation about the box origin.
type Draw = {
  text(s: string, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void
  rect(x: number, y: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; stroke?: ReturnType<typeof rgb>; bw?: number; opacity?: number }): void
  line(x1: number, y1: number, x2: number, y2: number, color: ReturnType<typeof rgb>, bw?: number): void
  image(img: PDFImage, x: number, y: number, w: number, h: number): void
}
function drawRotated(page: PDFPage, b: { x: number; y: number; w: number; h: number; rot: number }, fn: (x: number, y: number, w: number, h: number, d: Draw) => void) {
  const rot = b.rot
  // Local upright frame: width/height as the reader sees the box.
  const lw = rot % 180 === 0 ? b.w : b.h, lh = rot % 180 === 0 ? b.h : b.w
  // Origin (local bottom-left) in page space, and the rotation to apply to content.
  const origin = rot === 0 ? { x: b.x, y: b.y } : rot === 90 ? { x: b.x + b.w, y: b.y } : rot === 180 ? { x: b.x + b.w, y: b.y + b.h } : { x: b.x, y: b.y + b.h }
  const ang = rot // content must be rotated by the page rotation to read upright
  const map = (lx: number, ly: number) => {
    const r = (ang * Math.PI) / 180
    return { x: origin.x + lx * Math.cos(r) - ly * Math.sin(r), y: origin.y + lx * Math.sin(r) + ly * Math.cos(r) }
  }
  const d: Draw = {
    text: (s, x, y, size, font, color) => { const p = map(x, y); page.drawText(s, { x: p.x, y: p.y, size, font, color, rotate: degrees(ang) }) },
    rect: (x, y, w, h, o) => { const p = map(x, y); page.drawRectangle({ x: p.x, y: p.y, width: w, height: h, rotate: degrees(ang), color: o.fill, borderColor: o.stroke, borderWidth: o.bw ?? (o.stroke ? 0.6 : 0), opacity: o.opacity, borderOpacity: o.opacity }) },
    line: (x1, y1, x2, y2, color, bw = 0.5) => { const a = map(x1, y1), c = map(x2, y2); page.drawLine({ start: a, end: c, color, thickness: bw }) },
    image: (img, x, y, w, h) => { const p = map(x, y); page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(ang) }) },
  }
  fn(0, 0, lw, lh, d)
}

function signatureBlock(d: Draw, b: { x: number; y: number; w: number; h: number }, o: {
  img: PDFImage; font: PDFFont; bold: PDFFont; initials: boolean; name: string; when: string; auth: string; ref: string; envelopeNo: string
}) {
  const { x, y, w, h } = b
  // Light wash + brand edge on the left, like a seal strip.
  d.rect(x, y, w, h, { fill: WASH, opacity: 0.55 })
  d.rect(x, y, 1.6, h, { fill: BRAND })
  if (o.initials) {
    const ratio = o.img.width / o.img.height
    let ih = h * 0.72, iw = ih * ratio
    if (iw > w - 6) { iw = w - 6; ih = iw / ratio }
    d.image(o.img, x + (w - iw) / 2, y + h * 0.22, iw, ih)
    const ft = fit(o.font, `${o.ref}`, 4.6, w - 4, 3.5)
    d.text(ft.text, x + 3, y + 2, ft.size, o.font, MUTED)
    return
  }
  // Text block: 4 lines at the bottom, sized from the box height.
  const fs = Math.max(4.3, Math.min(6.4, h / 13))
  const lh = fs * 1.22
  const textH = lh * 4 + 2
  const sigH = Math.max(h - textH - 4, h * 0.35)
  const ratio = o.img.width / o.img.height
  let ih = sigH, iw = ih * ratio
  if (iw > w - 10) { iw = w - 10; ih = iw / ratio }
  d.image(o.img, x + 6, y + textH + 2 + (sigH - ih) / 2, iw, ih)
  d.line(x + 5, y + textH + 1, x + w - 4, y + textH + 1, HAIR, 0.5)
  const lines: [string, PDFFont, ReturnType<typeof rgb>][] = [
    [`Digitally signed by ${o.name}`, o.bold, INK],
    [o.when, o.font, INK],
    [`${o.auth}`, o.font, OK],
    [`Ref ${o.ref}  |  ${o.envelopeNo}  |  EZER Sign`, o.font, MUTED],
  ]
  lines.forEach(([s, f, c], i) => {
    const ft = fit(f, s, fs, w - 10)
    d.text(ft.text, x + 6, y + textH - (i + 1) * lh + 1.5, ft.size, f, c)
  })
}

/** Footer on every original page + the Certificate of Completion at the end. */
export async function finalise(pdfBytes: Uint8Array, opts: {
  envelope: StampEnvelope; signers: StampSigner[]; events: StampEvent[]
  signatures: Record<string, Uint8Array | undefined>; verifyUrl: string
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const env = opts.envelope
  const original = doc.getPages()
  const total = original.length

  original.forEach((page, i) => {
    const { width: W } = page.getSize()
    const rot = ((page.getRotation().angle % 360) + 360) % 360
    if (rot !== 0) return // a rotated scan: the footer would land across the content
    const s = `EZER Sign  |  ${env.envelope_no}  |  Page ${i + 1} of ${total}  |  Verify: ${opts.verifyUrl}`
    const ft = fit(font, s, 6, W - 48)
    page.drawText(ft.text, { x: 24, y: 10, size: ft.size, font, color: MUTED })
  })

  // ── Certificate ────────────────────────────────────────────────────────────
  const QR = (await import('qrcode')).default
  const qrPng = await QR.toBuffer(opts.verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  const qr = await doc.embedPng(qrPng)
  const sigImgs: Record<string, PDFImage> = {}
  for (const [id, bytes] of Object.entries(opts.signatures)) if (bytes) sigImgs[id] = await doc.embedPng(bytes)

  const A4 = { w: 595.28, h: 841.89 }
  const M = 40
  let page = doc.addPage([A4.w, A4.h])
  let y = A4.h - M
  let certPage = 1
  const certPages: PDFPage[] = [page]
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); certPages.push(page); certPage++; y = A4.h - M; return page }
  const need = (hgt: number) => { if (y - hgt < M + 24) newPage() }
  const text = (s: string, x: number, size: number, f: PDFFont = font, color = INK, maxW = A4.w - M - x) => {
    const ft = fit(f, s, size, maxW, size * 0.8)
    page.drawText(ft.text, { x, y, size: ft.size, font: f, color })
  }

  // Header band
  page.drawRectangle({ x: 0, y: A4.h - 118, width: A4.w, height: 118, color: rgb(0.06, 0.15, 0.36) })
  page.drawRectangle({ x: 0, y: A4.h - 121, width: A4.w, height: 3, color: rgb(0.2, 0.55, 0.98) })
  page.drawText('EZER SIGN', { x: M, y: A4.h - 44, size: 9, font: bold, color: rgb(0.62, 0.75, 1) })
  page.drawText('Certificate of Completion', { x: M, y: A4.h - 70, size: 22, font: bold, color: rgb(1, 1, 1) })
  page.drawText(t(`Envelope ${env.envelope_no}  ·  all parties have signed`).replace('·', '-'), { x: M, y: A4.h - 92, size: 9.5, font, color: rgb(0.82, 0.88, 1) })
  page.drawImage(qr, { x: A4.w - M - 80, y: A4.h - 108, width: 80, height: 80 })
  y = A4.h - 150

  // Status chip
  page.drawRectangle({ x: M, y: y - 4, width: 92, height: 18, color: rgb(0.89, 0.97, 0.93), borderColor: rgb(0.6, 0.85, 0.72), borderWidth: 0.6 })
  page.drawText('COMPLETED', { x: M + 10, y: y + 1, size: 8.5, font: bold, color: OK })
  { const ft = fit(font, 'Scan the QR, or open the verification page and upload this PDF, to confirm it has not been altered.', 7.6, A4.w - M - (M + 104)); page.drawText(ft.text, { x: M + 104, y: y + 1, size: ft.size, font, color: MUTED }) }
  y -= 34

  const section = (title: string) => {
    need(40)
    page.drawText(title.toUpperCase(), { x: M, y, size: 8.5, font: bold, color: BRAND })
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: A4.w - M, y: y - 5 }, thickness: 0.6, color: HAIR })
    y -= 20
  }
  const kv = (k: string, v: string, mono = false) => {
    need(15)
    page.drawText(t(k), { x: M, y, size: 8.2, font, color: MUTED })
    const ft = fit(mono ? font : bold, v, mono ? 7.6 : 8.6, A4.w - M - (M + 130))
    page.drawText(ft.text, { x: M + 130, y, size: ft.size, font: mono ? font : bold, color: INK })
    y -= 14
  }

  section('Document')
  kv('Title', env.title)
  if (env.original_name) kv('File', env.original_name)
  if (env.company_name) kv('Company', env.company_name)
  kv('Pages', `${total} (+ this certificate)`)
  kv('Envelope ID', env.envelope_no)
  kv('Sent by', `${env.created_by_name || 'HR'}${env.created_by_email ? ` <${env.created_by_email}>` : ''}`)
  kv('Sent on', istStamp(env.created_at))
  kv('Completed on', istStamp(env.completed_at || new Date()))
  kv('Signing order', env.signing_order === 'PARALLEL' ? 'Any order' : 'One after another')
  kv('Original SHA-256', env.original_sha256, true)
  y -= 8

  section(`Signers (${opts.signers.length})`)
  for (const s of [...opts.signers].sort((a, b) => a.order_no - b.order_no)) {
    const cardH = s.aadhaar_verified_at ? 98 : 88
    need(cardH + 10)
    const top = y + 10
    page.drawRectangle({ x: M, y: top - cardH, width: A4.w - 2 * M, height: cardH, color: rgb(0.98, 0.99, 1), borderColor: HAIR, borderWidth: 0.6 })
    page.drawRectangle({ x: M, y: top - cardH, width: 2.4, height: cardH, color: OK })
    page.drawText(t(`${s.order_no}. ${s.name}`), { x: M + 12, y: top - 18, size: 10.5, font: bold, color: INK })
    const sub = [s.role_label, s.designation].filter(Boolean).join(' · ')
    page.drawText(t(`${s.email}${sub ? `  -  ${sub}` : ''}`), { x: M + 12, y: top - 31, size: 7.8, font, color: MUTED })
    const rows: [string, string][] = [
      ['Identity', authLine(s)],
      ['Email OTP verified', s.email_verified_at ? istStamp(s.email_verified_at) : '-'],
      ...(s.aadhaar_verified_at ? [['Aadhaar OTP verified', istStamp(s.aadhaar_verified_at)] as [string, string]] : []),
      ['Signed', s.signed_at ? istStamp(s.signed_at) : '-'],
      ['IP · device', `${s.signed_ip || '-'}  ·  ${describeAgent(s.signed_user_agent)}`],
    ]
    let ry = top - 45
    rows.forEach(([k, v]) => {
      page.drawText(t(k), { x: M + 12, y: ry, size: 7.2, font, color: MUTED })
      const ft = fit(font, v, 7.4, 230)
      page.drawText(ft.text, { x: M + 108, y: ry, size: ft.size, font, color: INK })
      ry -= 10
    })
    const img = sigImgs[s.id]
    const bx = A4.w - M - 150, bw = 140, bh = 56
    page.drawRectangle({ x: bx, y: top - 76, width: bw, height: bh, color: rgb(1, 1, 1), borderColor: HAIR, borderWidth: 0.6 })
    if (img) {
      const r = img.width / img.height
      let ih = bh - 10, iw = ih * r
      if (iw > bw - 10) { iw = bw - 10; ih = iw / r }
      page.drawImage(img, { x: bx + (bw - iw) / 2, y: top - 76 + (bh - ih) / 2, width: iw, height: ih })
    }
    page.drawText('Signature', { x: bx, y: top - 84, size: 6.4, font, color: MUTED })
    y -= cardH + 14
  }

  section('Audit trail')
  const label: Record<string, string> = {
    CREATED: 'Envelope created', SENT: 'Sent for signature', INVITED: 'Signing link e-mailed', OPENED: 'Link opened',
    OTP_SENT: 'E-mail OTP sent', OTP_VERIFIED: 'E-mail OTP verified', OTP_FAILED: 'Wrong OTP entered',
    AADHAAR_OTP_SENT: 'Aadhaar OTP requested', AADHAAR_VERIFIED: 'Aadhaar OTP verified', VIEWED: 'Document viewed',
    SIGNED: 'Signed', DECLINED: 'Declined', REMINDED: 'Reminder sent', VOIDED: 'Voided', COMPLETED: 'Completed', DOWNLOADED: 'Downloaded',
  }
  for (const e of opts.events) {
    need(22)
    page.drawText(t(istStamp(e.at)), { x: M, y, size: 7.4, font, color: MUTED })
    const what = `${label[e.action] || e.action}${e.actor ? ` - ${e.actor}` : ''}`
    const ft = fit(bold, what, 7.8, 222)
    page.drawText(ft.text, { x: M + 120, y, size: ft.size, font: bold, color: INK })
    const where = `${e.ip ? `IP ${e.ip}` : ''}${e.user_agent ? `  ${describeAgent(e.user_agent)}` : ''}`
    if (where.trim()) { const fw = fit(font, where, 7, 140); page.drawText(fw.text, { x: A4.w - M - 140, y, size: fw.size, font, color: MUTED }) }
    y -= 13
  }

  y -= 8
  need(70)
  section('About this certificate')
  const legal = [
    'This document was signed electronically on EZER Sign. Each signer opened a personal link sent to their e-mail and proved',
    'control of that address with a one-time password before signing; where stated, an Aadhaar OTP step was also completed.',
    'Electronic records and signatures are recognised under the Information Technology Act, 2000 (sections 3A, 4, 5 and 10A).',
    'The SHA-256 fingerprint of this final file is registered with EZER Sign. Any change to the file - even one character -',
    'changes the fingerprint, and the verification page will report it as not authentic.',
  ]
  legal.forEach(l => { need(12); page.drawText(t(l), { x: M, y, size: 7.4, font, color: MUTED }); y -= 11 })
  if (opts.signers.some(s => s.aadhaar_mode === 'DEMO')) {
    need(12); page.drawText(t('Aadhaar OTP shown as "demo" was simulated: it is not an Aadhaar eSign under the Second Schedule of the IT Act.'), { x: M, y, size: 7.4, font: bold, color: rgb(0.62, 0.36, 0.02) }); y -= 11
  }

  certPages.forEach((p, i) => {
    p.drawText(t(`EZER Sign  |  ${env.envelope_no}  |  Certificate page ${i + 1} of ${certPages.length}  |  ${opts.verifyUrl}`), { x: M, y: 18, size: 6.6, font, color: MUTED })
  })
  void certPage

  doc.setTitle(t(env.title))
  doc.setSubject(t(`Signed via EZER Sign — ${env.envelope_no}`))
  doc.setProducer('EZER Sign')
  doc.setKeywords([env.envelope_no, 'EZER Sign', 'electronically signed'])
  return doc.save({ useObjectStreams: false })
}
