// lib/profile/id-card-pdf.ts — the printable ID card, as a PDF.
//
// WHY THE PRINTED CARD HAS NO WORKING QR
//
// The digital card's QR is a 30-second, single-use, signed token bound to
// card_version (see lib/profile/idcard.ts). Printing one is impossible in both
// directions:
//
//   * print the LIVE token and it is dead before the PDF finishes saving;
//   * print a STATIC "EZER-ID|code|name" string — which is what the design
//     reference did — and you have manufactured a permanent, forgeable
//     credential that no longer expires, cannot be revoked when a phone is
//     lost, and carries the employee's identity in plain text.
//
// So the card prints a DELIBERATELY BLURRED QR with a line telling the holder
// where the real one lives. A blurred code is honest in a way an empty square
// is not: it reads as "there is a QR for this, and it is not this one".
//
// The blur is applied to a REAL generated code rather than a fake pattern, so
// it degrades like a photograph of a code rather than looking like decoration.
//
// FORMAT
//
// CR80 portrait, 54 x 85.6 mm — the ISO/IEC 7810 ID-1 size every card printer
// and lanyard holder expects. Two pages: front, then back. Drawn to canvas at
// 12 px/mm and embedded as JPEG, which is how the reference produced a sharp
// card without shipping fonts into the PDF.
//
// pdf-lib rather than jsPDF: it is already a dependency (lib/payroll/payslip-pdf.ts
// draws a whole payslip with it, and components/payroll/PayslipDownload.tsx
// already runs it in the browser), so this adds no third PDF library and no CDN.

import { PDFDocument } from 'pdf-lib'

/** ID-1 / CR80 portrait, in millimetres. */
export const CARD_MM = { w: 54, h: 85.6 } as const
/** Canvas scale. 12 px/mm gives ~305 dpi — card-printer sharp. */
const PX_PER_MM = 12
const CW = Math.round(CARD_MM.w * PX_PER_MM)
const CH = Math.round(CARD_MM.h * PX_PER_MM)

/**
 * Corner radius, from ISO/IEC 7810 ID-1: 3.18 mm (the standard allows
 * 2.88-3.48). The same curve every bank card and driving licence uses, so a
 * card cut to this line sits right in a wallet slot and looks like a card
 * rather than a trimmed rectangle. Was 30px / 2.5mm, which was inside no spec.
 */
const CARD_R = Math.round(3.18 * PX_PER_MM)

/**
 * A PDF page is a rectangle. It cannot have rounded corners — no clipping
 * trick changes that, and the first attempt at this failed for exactly that
 * reason: the corners WERE cut, but the area outside the radius was painted
 * white and the page is white, so a rounded corner on a white page is
 * invisible. All it produced was a pale wedge where the dark header band
 * stopped short of the square page corner.
 *
 * The only thing that makes a corner read as round is contrast. So the page
 * is 3mm larger than the card on every side and that margin is filled with a
 * backdrop: the card then sits ON something, its rounded corners visibly cut
 * against it, the way a card looks photographed on a desk.
 *
 * The card itself stays exactly CR80 / ISO ID-1. The margin is trim, not card
 * — print at 100% and cut the rounded outline and you hold a real 54 x 85.6mm
 * card. Growing the page was the only way to keep that true AND show the shape.
 */
const PAGE_MARGIN_MM = 3
export const PAGE_MM = {
  w: CARD_MM.w + PAGE_MARGIN_MM * 2,
  h: CARD_MM.h + PAGE_MARGIN_MM * 2,
} as const
const PM = Math.round(PAGE_MARGIN_MM * PX_PER_MM)
const PW = CW + PM * 2
const PH = CH + PM * 2

/** The trim area. Light enough to spare toner, dark enough to cut a corner. */
const BACKDROP = '#E7E4F2'

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'
const F = (weight: number, size: number) => `${weight} ${size}px ${FONT}`

export interface IdCardData {
  name: string
  designation: string | null
  company: string
  code: string
  department?: string | null
  location?: string | null
  doj?: string | null
  blood?: string | null
  cardNo?: string | null
  validTill?: string | null
  /** Composed elsewhere so this module never guesses which column won. */
  emergencyName?: string | null
  emergencyRelation?: string | null
  emergencyPhone?: string | null
  /** A data: or blob: URL. Absent for ~397 of 398 today, so initials are the norm. */
  photoDataUrl?: string | null
  /** Where the live QR actually lives, printed under the blurred one. */
  qrHint?: string
}

/** Not available, spelled the same way everywhere on the card. */
const NA = 'Not available'
const dash = (v?: string | null) => (v && String(v).trim()) || '—'

const initials = (n: string) =>
  n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

export function prettyDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── canvas helpers ─────────────────────────────────────────────────────────

function rounded(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, r: number) {
  x.beginPath()
  x.moveTo(a + r, b)
  x.arcTo(a + w, b, a + w, b + h, r)
  x.arcTo(a + w, b + h, a, b + h, r)
  x.arcTo(a, b + h, a, b, r)
  x.arcTo(a, b, a + w, b, r)
  x.closePath()
}

/** Shrink until it fits. A long designation must not run off the card. */
function fit(x: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  let s = size
  x.font = F(weight, s)
  while (x.measureText(text).width > maxW && s > 10) { s--; x.font = F(weight, s) }
}

function wrap(x: CanvasRenderingContext2D, text: string, a: number, b: number, maxW: number, lh: number): number {
  const words = text.split(' ')
  let line = '', y = b
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (x.measureText(next).width > maxW && line) { x.fillText(line, a, y); line = w; y += lh }
    else line = next
  }
  if (line) x.fillText(line, a, y)
  return y
}

function brandBand(x: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = x.createLinearGradient(0, y0, CW, y1)
  g.addColorStop(0, '#1E1B4B')
  g.addColorStop(1, '#6D28D9')
  return g
}

/**
 * A guilloche wash — the interfering wave pattern on banknotes and passports.
 *
 * Not security in itself; a determined forger reproduces it. What it does is
 * make a photocopy look obviously like a photocopy, because the fine lines
 * moire badly, and it stops a blank white card reading as something printed
 * off a home printer. Kept very low contrast so it never competes with text.
 */
function guilloche(x: CanvasRenderingContext2D, top: number, bottom: number) {
  x.save()
  x.strokeStyle = 'rgba(124,58,237,.055)'
  x.lineWidth = 1
  for (let i = 0; i < 26; i++) {
    const amp = 16 + (i % 5) * 7
    const yBase = top + ((bottom - top) / 26) * i
    x.beginPath()
    for (let px = -10; px <= CW + 10; px += 6) {
      const y = yBase + Math.sin((px / CW) * Math.PI * 4 + i * 0.7) * amp
      if (px === -10) x.moveTo(px, y)
      else x.lineTo(px, y)
    }
    x.stroke()
  }
  x.restore()
}

/**
 * Repeated hairline text. Legible under a loupe, a grey smear to a scanner —
 * the cheapest anti-copy mark there is, and the reason real cards carry it.
 */
function microtext(x: CanvasRenderingContext2D, phrase: string, y: number) {
  x.save()
  x.fillStyle = 'rgba(30,27,75,.16)'
  x.font = F(600, 5)
  x.textAlign = 'left'
  const unit = `${phrase.toUpperCase()} · `
  let s = ''
  // HARD CAP, not decoration. This loop grows a string until it measures wider
  // than the card — and measureText returns 0 for a font that failed to load or
  // a context with no metrics available, in which case the condition is never
  // satisfied and the tab hangs the moment somebody clicks Download. A missing
  // watermark is a blemish; a frozen browser is a broken feature.
  for (let i = 0; i < 200 && x.measureText(s).width < CW + 40; i++) s += unit
  if (s) x.fillText(s, -12, y)
  x.restore()
}

function newCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CW; c.height = CH
  return c
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    return await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = src
    })
  } catch { return null }
}

/**
 * A real QR, blurred past readability.
 *
 * Generated from a harmless string — never a live token, never the employee's
 * identity. If `qrcode` fails for any reason the caller gets null and the card
 * draws a plain placeholder instead of pretending.
 */
async function blurredQr(size: number): Promise<HTMLCanvasElement | null> {
  try {
    const QR = (await import('qrcode')).default
    const url = await QR.toDataURL('EZER · live code available in ESS', {
      width: size * 2, margin: 1, errorCorrectionLevel: 'L',
      color: { dark: '#1E1B4B', light: '#FFFFFF' },
    })
    const im = await loadImage(url)
    if (!im) return null
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const x = c.getContext('2d')
    if (!x) return null
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, size, size)
    // Enough blur that no scanner will resolve it, little enough that a human
    // still recognises the shape as a QR code.
    x.filter = `blur(${Math.max(2, Math.round(size / 28))}px)`
    x.drawImage(im, 0, 0, size, size)
    x.filter = 'none'
    return c
  } catch { return null }
}

// ── the two faces ──────────────────────────────────────────────────────────

export async function drawFront(d: IdCardData): Promise<HTMLCanvasElement> {
  const c = newCanvas()
  const x = c.getContext('2d')!
  x.save()
  rounded(x, 0, 0, CW, CH, CARD_R); x.clip()
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, CW, CH)
  guilloche(x, 300, CH - 90)

  x.fillStyle = brandBand(x, 0, 260); x.fillRect(0, 0, CW, 250)
  x.fillStyle = 'rgba(255,255,255,.07)'
  x.beginPath(); x.arc(CW - 30, 20, 150, 0, Math.PI * 2); x.fill()
  x.beginPath(); x.arc(CW - 150, 230, 70, 0, Math.PI * 2); x.fill()
  // A hairline of light where the band ends, so the photo sits on an edge
  // rather than floating on a colour change.
  x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(0, 248, CW, 2)

  // logo tile + company
  x.fillStyle = '#FFFFFF'; rounded(x, 44, 42, 60, 60, 16); x.fill()
  x.fillStyle = '#1E1B4B'; x.font = F(800, 30)
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText((d.company || 'E').trim()[0]?.toUpperCase() || 'E', 74, 73)
  x.textBaseline = 'alphabetic'; x.textAlign = 'left'
  x.fillStyle = '#FFFFFF'; fit(x, d.company, 800, 24, CW - 122 - 36); x.fillText(d.company, 122, 68)
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = F(700, 15)
  x.fillText('EMPLOYEE IDENTITY CARD', 122, 96)

  // photo, or initials on a brand gradient
  const pw = 230, ph = 270, px = (CW - pw) / 2, py = 148
  x.fillStyle = '#FFFFFF'; rounded(x, px - 9, py - 9, pw + 18, ph + 18, 30); x.fill()
  x.save(); rounded(x, px, py, pw, ph, 24); x.clip()
  const photo = d.photoDataUrl ? await loadImage(d.photoDataUrl) : null
  if (photo) {
    const s = Math.max(pw / photo.width, ph / photo.height)
    const dw = photo.width * s, dh = photo.height * s
    x.drawImage(photo, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh)
  } else {
    const g = x.createLinearGradient(px, py, px + pw, py + ph)
    g.addColorStop(0, '#A5B4FC'); g.addColorStop(1, '#4F46E5')
    x.fillStyle = g; x.fillRect(px, py, pw, ph)
    x.fillStyle = 'rgba(255,255,255,.95)'; x.font = F(800, 88)
    x.textAlign = 'center'; x.textBaseline = 'middle'
    x.fillText(initials(d.name), px + pw / 2, py + ph / 2)
    x.textBaseline = 'alphabetic'
  }
  x.restore()

  // name + designation
  x.textAlign = 'center'
  x.fillStyle = '#1E1B4B'; fit(x, d.name, 800, 40, CW - 80); x.fillText(d.name, CW / 2, 490)
  x.fillStyle = '#7C3AED'; const desig = dash(d.designation)
  fit(x, desig, 700, 22, CW - 80); x.fillText(desig, CW / 2, 526)
  x.strokeStyle = '#E9E7F5'; x.lineWidth = 2
  x.beginPath(); x.moveTo(56, 558); x.lineTo(CW - 56, 558); x.stroke()

  // detail rows
  const rows: [string, string][] = [
    ['EMPLOYEE CODE', d.code],
    ['DEPARTMENT', dash(d.department)],
    ['BLOOD GROUP', dash(d.blood)],
    ['LOCATION', dash(d.location)],
  ]
  let y = 604
  for (const [k, v] of rows) {
    x.textAlign = 'left'; x.fillStyle = '#9C99B8'; x.font = F(700, 15); x.fillText(k, 56, y)
    x.textAlign = 'right'; x.fillStyle = '#1E1B4B'; fit(x, v, 700, 22, CW - 56 - 210)
    x.fillText(v, CW - 56, y)
    y += 48
  }

  // the blurred QR, and what it is for
  const qy = 800, qs = 132
  x.fillStyle = '#F5F3FF'; rounded(x, 48, qy - 8, qs + 16, qs + 16, 16); x.fill()
  const qr = await blurredQr(qs)
  if (qr) x.drawImage(qr, 56, qy, qs, qs)
  else {
    x.strokeStyle = '#C4B5FD'; x.setLineDash([6, 6]); rounded(x, 56, qy, qs, qs, 10); x.stroke(); x.setLineDash([])
  }
  x.textAlign = 'left'
  x.fillStyle = '#1E1B4B'; x.font = F(800, 19); x.fillText('Entry pass', 214, qy + 36)
  x.fillStyle = '#6B6890'; x.font = F(600, 15)
  // NOTHING about how the live code works. A printed card explaining its own
  // security model hands that model to whoever picks the card up; "use the app"
  // is all the holder needs, and all a finder should learn.
  wrap(x, d.qrHint || 'Open your digital ID in ESS to scan at the gate.',
    214, qy + 64, CW - 214 - 48, 22)

  microtext(x, `${d.company} · ${d.code}`, CH - 72)

  // footer
  x.fillStyle = brandBand(x, CH - 62, CH); x.fillRect(0, CH - 62, CW, 62)
  x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.font = F(600, 15)
  x.fillText(`Property of ${d.company}`, CW / 2, CH - 24)
  x.restore()
  return c
}

export async function drawBack(d: IdCardData): Promise<HTMLCanvasElement> {
  const c = newCanvas()
  const x = c.getContext('2d')!
  x.save()
  rounded(x, 0, 0, CW, CH, CARD_R); x.clip()
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, CW, CH)
  guilloche(x, 170, CH - 90)
  x.fillStyle = brandBand(x, 0, 140); x.fillRect(0, 0, CW, 130)
  x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(0, 128, CW, 2)

  x.textAlign = 'center'; x.fillStyle = '#FFFFFF'; x.font = F(800, 27)
  x.fillText('IN CASE OF EMERGENCY', CW / 2, 72)
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = F(600, 15)
  x.fillText('Please contact the person below', CW / 2, 102)

  // Emergency contact. Missing for ~391 of 398 today — it prints "Not
  // available" and does NOT block the download, deliberately.
  x.textAlign = 'left'; x.fillStyle = '#9C99B8'; x.font = F(700, 15)
  x.fillText('EMERGENCY CONTACT', 56, 190)
  if (d.emergencyName || d.emergencyPhone) {
    x.fillStyle = '#1E1B4B'; fit(x, d.emergencyName || NA, 800, 32, CW - 56 - 200)
    x.fillText(d.emergencyName || NA, 56, 232)
    if (d.emergencyRelation) {
      x.fillStyle = '#7C3AED'; x.font = F(700, 20); x.fillText(d.emergencyRelation, 56, 264)
    }
    x.fillStyle = '#1E1B4B'; const ph = d.emergencyPhone || NA
    fit(x, ph, 800, 34, CW - 56 - 200); x.fillText(ph, 56, 322)
  } else {
    // Just "Not available". It used to add "Add one in ESS › Profile" — an
    // instruction to the holder, printed on a card whose whole audience is
    // whoever is READING it: security at a gate, a paramedic. They cannot act
    // on it, and it spends a line telling them about a form they will never
    // open. The prompt to fill the field belongs in ESS, where the employee is.
    x.fillStyle = '#9C99B8'; x.font = F(800, 24); x.fillText(NA, 56, 236)
  }

  // blood group disc
  const bx = CW - 112, by = 250
  const blood = (d.blood || '').trim()
  x.fillStyle = blood ? '#DC2626' : '#E9E7F5'
  x.beginPath(); x.arc(bx, by, 64, 0, Math.PI * 2); x.fill()
  x.fillStyle = blood ? '#FFFFFF' : '#9C99B8'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.font = F(800, blood.length > 2 ? 34 : 40); x.fillText(blood || '—', bx, by + 2)
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#9C99B8'; x.font = F(700, 14); x.fillText('BLOOD GROUP', bx, by + 94)

  x.strokeStyle = '#E9E7F5'; x.lineWidth = 2
  x.beginPath(); x.moveTo(56, 382); x.lineTo(CW - 56, 382); x.stroke()

  // "Issued on" is deliberately absent. It would have to be the download date,
  // and a card that claims a new issue date every time it is saved is worse
  // than one that makes no claim at all. Valid-till below is the real bound.
  const rows: [string, string][] = [
    ['DATE OF JOINING', prettyDate(d.doj)],
    ['CARD NUMBER', dash(d.cardNo)],
    ['VALID TILL', prettyDate(d.validTill)],
  ]
  let y = 430
  for (const [k, v] of rows) {
    x.textAlign = 'left'; x.fillStyle = '#9C99B8'; x.font = F(700, 15); x.fillText(k, 56, y)
    x.textAlign = 'right'; x.fillStyle = '#1E1B4B'; fit(x, v, 700, 21, CW - 56 - 200)
    x.fillText(v, CW - 56, y)
    y += 46
  }

  x.strokeStyle = '#E9E7F5'; x.beginPath(); x.moveTo(56, 584); x.lineTo(CW - 56, 584); x.stroke()
  x.textAlign = 'left'; x.fillStyle = '#9C99B8'; x.font = F(700, 15)
  x.fillText('IF FOUND, PLEASE RETURN TO', 56, 626)
  x.fillStyle = '#1E1B4B'; fit(x, d.company, 800, 21, CW - 112); x.fillText(d.company, 56, 660)

  // Authorised signatory — the mark that makes a card read as issued by
  // somebody rather than printed by anybody. Drawn, not an image, so the PDF
  // carries no asset and nothing to go missing.
  const sx = 56, sy = 760
  x.save()
  x.strokeStyle = '#3C3489'; x.lineWidth = 3; x.lineCap = 'round'
  x.beginPath(); x.moveTo(sx, sy)
  x.bezierCurveTo(sx + 26, sy - 40, sx + 46, sy + 16, sx + 74, sy - 10)
  x.bezierCurveTo(sx + 96, sy - 30, sx + 112, sy + 12, sx + 142, sy - 16)
  x.bezierCurveTo(sx + 162, sy - 32, sx + 178, sy + 2, sx + 202, sy - 8)
  x.stroke()
  x.restore()
  x.strokeStyle = '#C9C5DD'; x.lineWidth = 2
  x.beginPath(); x.moveTo(56, 786); x.lineTo(56 + 240, 786); x.stroke()
  x.fillStyle = '#9C99B8'; x.font = F(600, 14); x.textAlign = 'left'
  x.fillText('Authorised Signatory', 56, 808)

  // This card is not a credential, and says so — without describing why.
  x.fillStyle = '#9C99B8'; x.font = F(600, 14)
  wrap(x, 'For identification only. This card does not grant entry.',
    56, 848, CW - 112, 20)

  microtext(x, `${d.company} · ${d.code}`, CH - 72)

  x.fillStyle = brandBand(x, CH - 62, CH); x.fillRect(0, CH - 62, CW, 62)
  x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.font = F(600, 15)
  x.fillText('Non-transferable · Report loss to HR immediately', CW / 2, CH - 24)
  x.restore()
  return c
}

// ── assembly ───────────────────────────────────────────────────────────────

/**
 * The card outline — the cut line, and what defines the rounded corner.
 *
 * Both faces already clip to a rounded rectangle — but the old flatten() painted white
 * across the whole canvas and the PDF page is cut to exactly card size, so a
 * white rounded corner lands on a white page and disappears. The radius only
 * showed where the dark header and footer bands happened to cross the edge,
 * which is why the middle of the card read as a plain rectangle.
 *
 * This hairline is what actually makes the shape visible, and it doubles as
 * the cut line for anyone trimming a printed sheet by hand. Drawn after
 * drawImage so it sits above the artwork, and inset by 1px because a stroke
 * straddles its path — centred on the edge, half of it would fall off canvas.
 */
function cardEdge(x: CanvasRenderingContext2D, ox: number, oy: number) {
  x.save()
  rounded(x, ox + 1, oy + 1, CW - 2, CH - 2, CARD_R - 1)
  // Was 2px at 30% — 0.17mm of pale grey, which rendered as nothing at all.
  // This is the cut line; it has to survive a printer.
  x.strokeStyle = 'rgba(30,27,75,.45)'
  x.lineWidth = 3
  x.stroke()
  x.restore()
}

/**
 * Card onto page.
 *
 * The face canvas is transparent outside the rounded clip — that alpha is the
 * whole mechanism, and the previous version destroyed it by filling white
 * before drawing. Here the backdrop goes down first, so the transparent
 * corners let it through and the radius becomes visible.
 *
 * The white rounded fill under drawImage is not redundant: it carries the
 * shadow (a shadow needs a shape to cast from) and guarantees an opaque card
 * body, so JPEG — which has no alpha — never flattens a corner to black.
 */
function compose(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PW; c.height = PH
  const x = c.getContext('2d')!

  x.fillStyle = BACKDROP; x.fillRect(0, 0, PW, PH)

  x.save()
  x.shadowColor = 'rgba(30,27,75,.30)'
  x.shadowBlur = 16
  x.shadowOffsetY = 5
  rounded(x, PM, PM, CW, CH, CARD_R)
  x.fillStyle = '#FFFFFF'
  x.fill()
  x.restore()

  x.drawImage(src, PM, PM)
  cardEdge(x, PM, PM)
  return c
}

const PT_PER_MM = 72 / 25.4

/** Both faces as a two-page PDF at exact card size. Returns the bytes. */
export async function buildIdCardPdf(d: IdCardData): Promise<Uint8Array> {
  const faces = [await drawFront(d), await drawBack(d)]
  const doc = await PDFDocument.create()
  doc.setTitle(`ID Card — ${d.name} (${d.code})`)
  doc.setProducer('EZER HRMS')
  const w = PAGE_MM.w * PT_PER_MM, h = PAGE_MM.h * PT_PER_MM
  for (const face of faces) {
    const jpeg = compose(face).toDataURL('image/jpeg', 0.94)
    const img = await doc.embedJpg(jpeg)
    const page = doc.addPage([w, h])
    page.drawImage(img, { x: 0, y: 0, width: w, height: h })
  }
  return doc.save()
}

/** `ID-Card_SRS9010_Shreya-Reddy.pdf` */
export function idCardFileName(d: IdCardData): string {
  const slug = d.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `ID-Card_${d.code}_${slug}.pdf`
}
