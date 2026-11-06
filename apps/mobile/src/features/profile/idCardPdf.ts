// src/features/profile/idCardPdf.ts — the printable ID card, built on the phone.
//
// The website draws lib/profile/id-card-pdf.ts on a browser canvas and packs it
// with pdf-lib; neither runs in React Native, and the in-app browser that used
// to open /ess/profile has no session, so it only ever reached the login page.
// Here the same two faces are written as SVG, at the same coordinates, and
// expo-print turns them into a PDF. Layout and wording follow that file. The
// colours are today's brand blue: the web PDF still prints the retired purple.
//
// Same rules as the website, for the same reasons (see that file's header):
// the QR is deliberately blurred and is never a live token, and a missing field
// prints "Not available" rather than stopping the download.
import { Platform } from 'react-native'
import * as ImageManipulator from 'expo-image-manipulator'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { encodeQr } from './qr'

export interface IdCardData {
  name: string; designation: string | null; company: string; code: string
  department?: string | null; location?: string | null; doj?: string | null; blood?: string | null
  cardNo?: string | null; validTill?: string | null
  emergencyName?: string | null; emergencyRelation?: string | null; emergencyPhone?: string | null
  photoDataUrl?: string | null
}

// CR80 at 12 px/mm with a 3 mm trim margin, as lib/profile/id-card-pdf.ts.
const CW = 648, CH = 1027, CARD_R = 38, PM = 36
const PW = CW + PM * 2, PH = CH + PM * 2
const MM = 72 / 25.4
// Whole points on purpose. Android snaps a page to its own steps (this comes back
// as 168.96 x 258.96), and the content shrinks to fit only when it is the wider of
// the two; asking for a page a shade larger spilled each face onto a second sheet.
const PAGE = { w: Math.round(60 * MM), h: Math.round(91.6 * MM) }

const INK = '#0B1D4D', BRAND = '#1D4ED8', MUTED = '#6B7A99', RULE = '#E2E8F3'
const BACKDROP = '#E4EAF5', WASH = '#EFF6FF', BAND_A = '#0B1D4D', BAND_B = '#2563EB'
const NA = 'Not available'
const FONT = 'Roboto,Arial,sans-serif'

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dash = (v?: string | null) => (v && String(v).trim()) || '-'
const initials = (n: string) => n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

export function prettyDate(v?: string | null) {
  if (!v) return '-'
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** The canvas's fit(): no text metrics here, so a bold glyph is taken as 0.58 em. */
export const fitSize = (text: string, size: number, maxW: number) =>
  Math.max(10, Math.min(size, Math.floor(maxW / Math.max(1, text.length * 0.58))))

function t(x: number, y: number, text: string, size: number, weight: number, fill: string, anchor: 'start' | 'middle' | 'end' = 'start', opacity = 1) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(text)}</text>`
}
const fitted = (x: number, y: number, text: string, size: number, weight: number, fill: string, maxW: number, anchor: 'start' | 'middle' | 'end' = 'start') =>
  t(x, y, text, fitSize(text, size, maxW), weight, fill, anchor)

/** Word wrap by estimated width (0.52 em for this weight). */
function wrapped(x: number, y: number, text: string, size: number, weight: number, fill: string, maxW: number, lh: number) {
  const perLine = Math.floor(maxW / (size * 0.52))
  const lines: string[] = []
  let line = ''
  for (const w of text.split(' ')) {
    if (line && (line.length + 1 + w.length) > perLine) { lines.push(line); line = w } else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines.map((l, i) => t(x, y + i * lh, l, size, weight, fill)).join('')
}

/** The interfering wave wash from the website's guilloche(). */
function guilloche(top: number, bottom: number) {
  let d = ''
  for (let i = 0; i < 26; i++) {
    const amp = 16 + (i % 5) * 7
    const yBase = top + ((bottom - top) / 26) * i
    for (let px = -10; px <= CW + 10; px += 12) {
      const y = yBase + Math.sin((px / CW) * Math.PI * 4 + i * 0.7) * amp
      d += `${px === -10 ? 'M' : 'L'}${px} ${y.toFixed(1)}`
    }
  }
  return `<path d="${d}" fill="none" stroke="#2563EB" stroke-opacity=".055" stroke-width="1"/>`
}

const microtext = (phrase: string, y: number) =>
  `<text x="-12" y="${y}" font-size="5" font-weight="600" fill="${INK}" opacity=".16">${esc(`${phrase.toUpperCase()} · `.repeat(14))}</text>`

/** A real QR blurred past reading, from a harmless string: never a live token. */
function blurredQr(x: number, y: number, size: number) {
  const m = encodeQr('EZER · live code available in ESS')
  let d = ''
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.modules[r][c]) d += `M${c + 1} ${r + 1}h1v1h-1z`
  const n = m.size + 2
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="${INK}" filter="url(#qrBlur)"/></svg>`
}

function frontFace(d: IdCardData) {
  const pw = 230, ph = 270, px = (CW - pw) / 2, py = 148
  const photo = d.photoDataUrl
    ? `<image href="${d.photoDataUrl}" x="${px}" y="${py}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)"/>`
    : `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="24" fill="url(#avatar)"/>${t(px + pw / 2, py + ph / 2 + 30, initials(d.name), 88, 800, '#FFFFFF', 'middle', 0.95)}`
  const rows: [string, string][] = [['EMPLOYEE CODE', d.code], ['DEPARTMENT', dash(d.department)], ['BLOOD GROUP', dash(d.blood)], ['LOCATION', dash(d.location)]]
  const qy = 800, qs = 132
  return `${guilloche(300, CH - 90)}
  <rect width="${CW}" height="250" fill="url(#band)"/>
  <circle cx="${CW - 30}" cy="20" r="150" fill="#fff" opacity=".07"/><circle cx="${CW - 150}" cy="230" r="70" fill="#fff" opacity=".07"/>
  <rect y="248" width="${CW}" height="2" fill="#fff" opacity=".22"/>
  <rect x="44" y="42" width="60" height="60" rx="16" fill="#fff"/>
  ${t(74, 84, (d.company || 'E').trim()[0]?.toUpperCase() || 'E', 30, 800, INK, 'middle')}
  ${fitted(122, 68, d.company, 24, 800, '#FFFFFF', CW - 122 - 36)}
  ${t(122, 96, 'EMPLOYEE IDENTITY CARD', 15, 700, '#FFFFFF', 'start', 0.75)}
  <rect x="${px - 9}" y="${py - 9}" width="${pw + 18}" height="${ph + 18}" rx="30" fill="#fff"/>
  ${photo}
  ${fitted(CW / 2, 490, d.name, 40, 800, INK, CW - 80, 'middle')}
  ${fitted(CW / 2, 526, dash(d.designation), 22, 700, BRAND, CW - 80, 'middle')}
  <line x1="56" y1="558" x2="${CW - 56}" y2="558" stroke="${RULE}" stroke-width="2"/>
  ${rows.map(([k, v], i) => t(56, 604 + i * 48, k, 15, 700, MUTED) + fitted(CW - 56, 604 + i * 48, v, 22, 700, INK, CW - 56 - 210, 'end')).join('')}
  <rect x="48" y="${qy - 8}" width="${qs + 16}" height="${qs + 16}" rx="16" fill="${WASH}"/>
  ${blurredQr(56, qy, qs)}
  ${t(214, qy + 36, 'Entry pass', 19, 800, INK)}
  ${wrapped(214, qy + 64, 'Open your digital ID in ESS to scan at the gate.', 15, 600, MUTED, CW - 214 - 48, 22)}
  ${microtext(`${d.company} · ${d.code}`, CH - 72)}
  <rect y="${CH - 62}" width="${CW}" height="62" fill="url(#band)"/>
  ${t(CW / 2, CH - 24, `Property of ${d.company}`, 15, 600, '#FFFFFF', 'middle')}`
}

function backFace(d: IdCardData) {
  const contact = d.emergencyName || d.emergencyPhone
    ? fitted(56, 232, d.emergencyName || NA, 32, 800, INK, CW - 56 - 200)
      + (d.emergencyRelation ? t(56, 264, d.emergencyRelation, 20, 700, BRAND) : '')
      + fitted(56, 322, d.emergencyPhone || NA, 34, 800, INK, CW - 56 - 200)
    : t(56, 236, NA, 24, 800, MUTED)
  const blood = (d.blood || '').trim()
  const bx = CW - 112, by = 250
  const rows: [string, string][] = [['DATE OF JOINING', prettyDate(d.doj)], ['CARD NUMBER', dash(d.cardNo)], ['VALID TILL', prettyDate(d.validTill)]]
  const sx = 56, sy = 760
  return `${guilloche(170, CH - 90)}
  <rect width="${CW}" height="130" fill="url(#bandShort)"/>
  <rect y="128" width="${CW}" height="2" fill="#fff" opacity=".22"/>
  ${t(CW / 2, 72, 'IN CASE OF EMERGENCY', 27, 800, '#FFFFFF', 'middle')}
  ${t(CW / 2, 102, 'Please contact the person below', 15, 600, '#FFFFFF', 'middle', 0.75)}
  ${t(56, 190, 'EMERGENCY CONTACT', 15, 700, MUTED)}
  ${contact}
  <circle cx="${bx}" cy="${by}" r="64" fill="${blood ? '#DC2626' : RULE}"/>
  ${t(bx, by + 14, blood || '-', blood.length > 2 ? 34 : 40, 800, blood ? '#FFFFFF' : MUTED, 'middle')}
  ${t(bx, by + 94, 'BLOOD GROUP', 14, 700, MUTED, 'middle')}
  <line x1="56" y1="382" x2="${CW - 56}" y2="382" stroke="${RULE}" stroke-width="2"/>
  ${rows.map(([k, v], i) => t(56, 430 + i * 46, k, 15, 700, MUTED) + fitted(CW - 56, 430 + i * 46, v, 21, 700, INK, CW - 56 - 200, 'end')).join('')}
  <line x1="56" y1="584" x2="${CW - 56}" y2="584" stroke="${RULE}" stroke-width="2"/>
  ${t(56, 626, 'IF FOUND, PLEASE RETURN TO', 15, 700, MUTED)}
  ${fitted(56, 660, d.company, 21, 800, INK, CW - 112)}
  <path d="M${sx} ${sy}C${sx + 26} ${sy - 40} ${sx + 46} ${sy + 16} ${sx + 74} ${sy - 10}C${sx + 96} ${sy - 30} ${sx + 112} ${sy + 12} ${sx + 142} ${sy - 16}C${sx + 162} ${sy - 32} ${sx + 178} ${sy + 2} ${sx + 202} ${sy - 8}" fill="none" stroke="${BRAND}" stroke-width="3" stroke-linecap="round"/>
  <line x1="56" y1="786" x2="296" y2="786" stroke="${RULE}" stroke-width="2"/>
  ${t(56, 808, 'Authorised Signatory', 14, 600, MUTED)}
  ${wrapped(56, 848, 'For identification only. This card does not grant entry.', 14, 600, MUTED, CW - 112, 20)}
  ${microtext(`${d.company} · ${d.code}`, CH - 72)}
  <rect y="${CH - 62}" width="${CW}" height="62" fill="url(#band)"/>
  ${t(CW / 2, CH - 24, 'Non-transferable · Report loss to HR immediately', 15, 600, '#FFFFFF', 'middle')}`
}

function page(face: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" font-family="${FONT}">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="${BAND_A}"/><stop offset="1" stop-color="${BAND_B}"/></linearGradient>
    <linearGradient id="bandShort" x1="0" y1="0" x2="1" y2="0.2"><stop offset="0" stop-color="${BAND_A}"/><stop offset="1" stop-color="${BAND_B}"/></linearGradient>
    <linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93C5FD"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient>
    <clipPath id="card"><rect width="${CW}" height="${CH}" rx="${CARD_R}"/></clipPath>
    <clipPath id="photoClip"><rect x="${(CW - 230) / 2}" y="148" width="230" height="270" rx="24"/></clipPath>
    <filter id="qrBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.7"/></filter>
  </defs>
  <rect width="${PW}" height="${PH}" fill="${BACKDROP}"/>
  <g transform="translate(${PM} ${PM})">
    <rect width="${CW}" height="${CH}" rx="${CARD_R}" fill="#fff"/>
    <g clip-path="url(#card)">${face}</g>
    <rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="${CARD_R - 1}" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="3"/>
  </g></svg>`
}

/** Both faces, one to a page. Pure, so it can be looked at in any browser. */
export function idCardHtml(d: IdCardData) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { margin: 0 }
  html, body { margin: 0; padding: 0; background: ${BACKDROP} }
  .p { width: ${PAGE.w}pt; height: ${PAGE.h}pt; overflow: hidden; page-break-after: always; break-after: page }
  .p:last-child { page-break-after: auto; break-after: auto }
  svg { display: block; width: 100%; height: 100% }
  </style></head><body><div class="p">${page(frontFace(d))}</div><div class="p">${page(backFace(d))}</div></body></html>`
}

/** `ID-Card_SRS9010_Shreya-Reddy.pdf`, as on the website. */
export function idCardFileName(d: { name: string; code: string }) {
  return `ID-Card_${d.code}_${d.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`
}

/** "Name · Relation · Phone" → its parts. Any of them can be missing. */
export function parseEmergency(v?: string | null) {
  const parts = String(v || '').split('·').map(x => x.trim()).filter(Boolean)
  if (!parts.length) return { emergencyName: null, emergencyRelation: null, emergencyPhone: null }
  const phone = parts.length > 1 && /\d{5}/.test(parts[parts.length - 1]) ? parts.pop()! : /^\+?[\d\s-]{7,}$/.test(parts[0]) ? parts.shift()! : null
  return { emergencyName: parts[0] || null, emergencyRelation: parts[1] || null, emergencyPhone: phone }
}

/** A failed photo is not a failed download: the card falls back to initials. */
async function photoData(url?: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const img = await ImageManipulator.ImageManipulator.manipulate(url).resize({ width: 460 }).renderAsync()
    const out = await img.saveAsync({ base64: true, compress: 0.85, format: ImageManipulator.SaveFormat.JPEG })
    return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null
  } catch { return null }
}

/** Build the PDF and hand it to the phone's share sheet (save, open, send). */
export async function downloadIdCard(d: IdCardData, photoUrl?: string | null) {
  const data = { ...d, photoDataUrl: await photoData(photoUrl) }
  const html = idCardHtml(data)
  if (Platform.OS === 'web') { await Print.printAsync({ html }); return }
  const { uri } = await Print.printToFileAsync({ html, width: PAGE.w, height: PAGE.h, margins: { top: 0, right: 0, bottom: 0, left: 0 } })
  const { File, Paths } = await import('expo-file-system')
  const name = idCardFileName(d)
  const named = new File(Paths.cache, name)
  if (named.exists) named.delete()
  new File(uri).move(named)
  await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name })
}
