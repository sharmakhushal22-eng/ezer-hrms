// lib/onboarding/statutory-forms.ts — SERVER ONLY. The official statutory forms, filled.
//
// The blank forms HR gave us live in public/statutory-forms/ exactly as issued (they have no
// fillable fields), and the candidate's details are drawn onto them with pdf-lib at the places
// the printed boxes sit:
//   form11  EPF New Form 11 (declaration)              1 page
//   form2   EPF Form 2 (revised) nomination, Part A + Part B (EPS)   2 pages
//   esic1   ESIC Form 1 declaration + family particulars + TIC        2 pages (page 2 = instructions)
// Positions are given in pixels of the 1800px-tall renders the layout was measured on and
// converted to points per page, so a template re-measured at that size drops straight in.
// What is printed comes from statutory-data.ts, shared with the tests.

import fs from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import { toWinAnsi } from '@/lib/letters/winAnsi'
import { statutoryData, type StatutoryData } from './statutory-data'
export { statutoryData, type StatutoryData }

export type FormKey = 'form11' | 'form2' | 'esic1'
export const FORMS: Record<FormKey, { file: string; label: string; filename: (d: StatutoryData) => string; imgW: number }> = {
  form11: { file: 'form11.pdf', label: 'EPF Form 11 — Declaration', filename: d => `EPF_Form11_${slug(d.name)}.pdf`, imgW: 1390 },
  form2:  { file: 'form2.pdf',  label: 'EPF Form 2 — Nomination & Declaration', filename: d => `EPF_Form2_${slug(d.name)}.pdf`, imgW: 1272 },
  esic1:  { file: 'esi1.pdf',   label: 'ESIC Form 1 — Declaration', filename: d => `ESIC_Form1_${slug(d.name)}.pdf`, imgW: 1080 },
}
export const isFormKey = (k: any): k is FormKey => k === 'form11' || k === 'form2' || k === 'esic1'
const slug = (n: string) => (n || 'candidate').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')

const INK = rgb(0.08, 0.14, 0.42)

/** A page with a drawing helper that takes pixel coordinates of the measured render. */
class Sheet {
  private k: number
  constructor(public page: PDFPage, imgW: number, private font: PDFFont, private bold: PDFFont) { this.k = page.getWidth() / imgW }
  private pt = (px: number) => px * this.k
  /** Draw text with its baseline at (x, y) px. `w` clips to a width (px) by shrinking the size, never below 5.5pt. */
  text(t: string, x: number, y: number, o: { size?: number; bold?: boolean; w?: number; align?: 'left' | 'center' | 'right' } = {}) {
    const str = toWinAnsi(String(t ?? '')).trim()
    if (!str) return
    const f = o.bold ? this.bold : this.font
    let size = o.size ?? 9
    const maxW = o.w ? this.pt(o.w) : 0
    if (maxW) while (size > 5.5 && f.widthOfTextAtSize(str, size) > maxW) size -= 0.5
    let px = this.pt(x)
    if (o.align === 'center') px -= f.widthOfTextAtSize(str, size) / 2
    if (o.align === 'right') px -= f.widthOfTextAtSize(str, size)
    this.page.drawText(str, { x: px, y: this.page.getHeight() - this.pt(y), size, font: f, color: INK })
  }
  /** Wrap `t` inside width w (px) from baseline y, `lh` px between lines, at most `max` lines. Returns lines used. */
  lines(t: string, x: number, y: number, w: number, o: { size?: number; lh?: number; max?: number } = {}): number {
    const str = toWinAnsi(String(t ?? '')).trim()
    if (!str) return 0
    const size = o.size ?? 8, lh = o.lh ?? 22, max = o.max ?? 3, maxW = this.pt(w)
    const out: string[] = []
    let cur = ''
    for (const word of str.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word
      if (this.font.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next
      else { out.push(cur); cur = word }
    }
    if (cur) out.push(cur)
    const shown = out.slice(0, max)
    if (out.length > max) shown[max - 1] = shown[max - 1].replace(/.{2}$/, '…')
    shown.forEach((l, i) => this.text(l, x, y + i * lh, { size, w }))
    return shown.length
  }
  /** A tick drawn as two strokes (no standard font has the glyph), centred on (x, y) px, `size` px wide. */
  tick(x: number, y: number, size = 16) {
    const H = this.page.getHeight(), k = this.k, w = size * k
    const cx = x * k, cy = H - y * k
    const stroke = { thickness: Math.max(1, 0.12 * w), color: INK }
    this.page.drawLine({ start: { x: cx - w / 2, y: cy }, end: { x: cx - w / 8, y: cy - w * 0.38 }, ...stroke })
    this.page.drawLine({ start: { x: cx - w / 8, y: cy - w * 0.38 }, end: { x: cx + w / 2, y: cy + w * 0.45 }, ...stroke })
  }
  /** Cover a printed word so a value can sit where the form only had options. */
  blank(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x: this.pt(x), y: this.page.getHeight() - this.pt(y + h), width: this.pt(w), height: this.pt(h), color: rgb(1, 1, 1) })
  }
  async image(bytes: Uint8Array, mime: string, x: number, y: number, w: number, h: number) {
    const doc = this.page.doc
    const img = /png/i.test(mime) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    const bw = this.pt(w), bh = this.pt(h)
    const r = Math.min(bw / img.width, bh / img.height)
    const dw = img.width * r, dh = img.height * r
    this.page.drawImage(img, { x: this.pt(x) + (bw - dw) / 2, y: this.page.getHeight() - this.pt(y) - bh + (bh - dh) / 2, width: dw, height: dh })
  }
}

async function open(key: FormKey): Promise<{ doc: PDFDocument; sheets: Sheet[] }> {
  const bytes = await fs.readFile(path.join(process.cwd(), 'public', 'statutory-forms', FORMS[key].file))
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  return { doc, sheets: doc.getPages().map(p => new Sheet(p, FORMS[key].imgW, font, bold)) }
}
const dmy = (v: string) => { const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? { d: m[1], m: m[2], y: m[3] } : null }
const yesNo = (b: boolean) => b ? 'Yes' : 'No'

// ── EPF Form 11 (612 × 792, measured on a 1390 × 1800 render) ────────────────────────────
function drawForm11(s: Sheet, d: StatutoryData) {
  s.text(d.emp_code, 960, 126, { size: 10, bold: true, w: 290 })
  s.text(d.company_name, 960, 177, { size: 9, w: 290 })
  s.text(d.name, 848, 272, { size: 10, bold: true, w: 430 })
  s.tick(d.parent.kind === 'Father' ? 327 : 551, 303)
  s.text(d.parent.name, 848, 309, { size: 10, w: 430 })
  const dob = dmy(d.dob)
  if (dob) { s.text(dob.d, 917, 360, { size: 10, align: 'center' }); s.text(dob.m, 1052, 360, { size: 10, align: 'center' }); s.text(dob.y, 1202, 360, { size: 10, align: 'center' }) }
  else s.text(d.dob, 848, 360, { size: 10 })
  s.text(d.gender, 848, 392, { size: 10 })
  s.text(d.marital, 848, 425, { size: 10 })
  s.text(d.email, 848, 457, { size: 9, w: 430 })
  s.text(d.mobile, 848, 494, { size: 10 })
  s.tick(d.has_uan ? 1008 : 1179, 524)          // 7. earlier a member of EPF 1952
  s.tick(d.has_uan ? 1008 : 1179, 552)          // 8. earlier a member of EPS 1995
  if (d.has_uan) {
    s.text(d.uan, 848, 607, { size: 10, bold: true, w: 430 })
    s.text(d.prev_pf_id, 848, 646, { size: 9, w: 430 })
    const ex = dmy(d.prev_exit)
    if (ex) { s.text(ex.d, 932, 679, { size: 10, align: 'center' }); s.text(ex.m, 1100, 679, { size: 10, align: 'center' }); s.text(ex.y, 1235, 679, { size: 10, align: 'center' }) }
    else s.text(d.prev_exit, 848, 679, { size: 10 })
  }
  s.tick(d.is_foreign ? 1008 : 1179, 782)       // 10. international worker
  s.text(d.country, 848, 809, { size: 10, w: 430 })
  if (d.is_foreign) { s.text(d.passport_no, 848, 835, { size: 10, w: 430 }); s.text(d.passport_valid, 848, 862, { size: 9, w: 430 }) }
  s.text([d.bank_account, d.ifsc].filter(Boolean).join('   IFSC '), 848, 922, { size: 9.5, w: 430 })
  s.text(d.aadhaar, 848, 962, { size: 10, w: 430 })
  s.text(d.pan, 848, 1002, { size: 10, w: 430 })
  s.text(d.date, 280, 1231, { size: 10 })
  s.text(d.place, 280, 1263, { size: 10, w: 400 })
  // Declaration by the present employer — the facts we hold; the PF number stays for the employer.
  s.text(d.name, 408, 1307, { size: 8, w: 130 })
  s.text(d.doj, 698, 1307, { size: 7.5, w: 62 })
}

// ── EPF Form 2 revised (595 × 842 A4, measured on 1272 × 1800) ─────────────────────────────
function drawForm2(p1: Sheet, p2: Sheet, d: StatutoryData) {
  const X = 602, W = 560
  p1.text(d.name.toUpperCase(), X, 269, { size: 10, bold: true, w: W })
  p1.text(d.parent.name, X, 320, { size: 10, w: W })
  p1.text(d.dob, X, 369, { size: 10 })
  p1.text(d.gender, X, 419, { size: 10 })
  p1.text(d.marital, X, 469, { size: 10 })
  p1.text(d.has_uan ? `UAN ${d.uan}` : 'New member — to be allotted', X, 519, { size: 10, w: W })
  p1.lines(d.perm_address, X, 569, W, { size: 8, lh: 49, max: 2 })
  p1.lines(d.curr_address, X, 666, W, { size: 8, lh: 47, max: 2 })
  p1.text(d.doj, X, 758, { size: 10 })
  // Part A — nominees, one row of 56px each, four at most
  d.pf_nominees.slice(0, 4).forEach((n, i) => {
    const y = 1120 + i * 62
    p1.lines(n.name, 96, y, 130, { size: 8, lh: 12, max: 2 })
    p1.lines(n.address, 238, y, 200, { size: 7, lh: 11, max: 3 })
    p1.text(n.relation, 451, y, { size: 8, w: 155 })
    p1.text(n.dob, 618, y, { size: 8, w: 128 })
    p1.text(n.share || '', 756, y, { size: 8, w: 200 })
  })
  // Part B — family for the pension, five rows
  d.eps_family.slice(0, 5).forEach((m, i) => {
    const y = 318 + i * 60
    p2.lines(m.name, 188, y, 345, { size: 8.5, lh: 12, max: 2 })
    p2.lines(m.address, 546, y, 292, { size: 7.5, lh: 11, max: 3 })
    p2.text(m.dob, 850, y, { size: 8, w: 92 })
    p2.text(m.relation, 950, y, { size: 8.5, w: 295 })
  })
  if (d.eps_fallback) {
    p2.lines([d.eps_fallback.name, d.eps_fallback.address].filter(Boolean).join(', '), 96, 880, 625, { size: 9, lh: 14, max: 3 })
    p2.text(d.eps_fallback.dob, 740, 880, { size: 9, w: 140 })
    p2.text(d.eps_fallback.relation, 895, 880, { size: 9, w: 350 })
  }
  p2.text(d.date, 165, 1153, { size: 10 })
  // Certificate by the employer — the member's name is ours to print; the rest is signed by hand.
  p2.text(d.name, 100, 1351, { size: 9, w: 440 })
  p2.text(d.place, 175, 1458, { size: 9, w: 200 })
}

// ── ESIC Form 1 (540 × 900, measured on 1080 × 1800) ──────────────────────────────────────
async function drawEsic1(s: Sheet, d: StatutoryData, photo: { bytes: Uint8Array; mime: string } | null) {
  s.text(d.name.toUpperCase(), 250, 322, { size: 9, bold: true, w: 285 })
  s.text(d.parent.name, 250, 367, { size: 9, w: 285 })
  const dob = dmy(d.dob)
  if (dob) { s.text(dob.d, 261, 522, { size: 8, align: 'center' }); s.text(dob.m, 304, 522, { size: 8, align: 'center' }); s.text(dob.y, 355, 522, { size: 8, align: 'center' }) }
  if (d.marital) { s.blank(467, 477, 71, 16); s.text(d.marital, 470, 490, { size: 7.5, bold: true, w: 66 }) }   // in place of the M/U/W key
  s.blank(506, 509, 32, 22); s.text(/^f/i.test(d.gender) ? 'F' : d.gender ? 'M' : '', 522, 524, { size: 9, bold: true, align: 'center' })
  s.lines(d.curr_address, 48, 572, 240, { size: 7, lh: 25, max: 3 })
  s.lines(d.perm_address, 302, 572, 236, { size: 7, lh: 25, max: 3 })
  const pin = (v: string, x0: number) => v.replace(/\D/g, '').slice(0, 6).split('').forEach((ch, i) => s.text(ch, x0 + i * 22.5, 646, { size: 8, align: 'center' }))
  pin(d.curr_pin, 126); pin(d.perm_pin, 401)
  s.text(d.mobile, 222, 681, { size: 7, w: 66 }); s.text(d.mobile, 470, 681, { size: 7, w: 68 })
  s.text(d.dispensary, 405, 723, { size: 6.5, w: 132 })
  // Employer
  s.text(d.esic_code, 775, 277, { size: 8.5, w: 260 })
  const doj = dmy(d.doj)
  if (doj) { s.text(doj.d, 840, 374, { size: 8.5, align: 'center' }); s.text(doj.m, 920, 374, { size: 8.5, align: 'center' }); s.text(doj.y, 1000, 374, { size: 8.5, align: 'center' }) }
  s.lines([d.company_name, d.company_address].filter(Boolean).join(', '), 592, 411, 440, { size: 7.5, lh: 30, max: 3 })
  s.text(d.esic_prev_ip, 805, 559, { size: 8.5, w: 230 })
  // (c) nominee for the cash benefit
  if (d.esic_nominee) {
    s.text(d.esic_nominee.name, 50, 853, { size: 8, w: 285 })
    s.text(d.esic_nominee.relation, 345, 853, { size: 8, w: 285 })
    s.text(d.esic_nominee.address, 640, 853, { size: 7, w: 390 })
  }
  // (D) family particulars — eight rows
  d.family.slice(0, 8).forEach((m, i) => {
    const y = 1281 + i * 19.3
    s.text(String(i + 1), 66, y, { size: 7, align: 'center' })
    s.text(m.name, 100, y, { size: 7, w: 198 })
    s.text(m.dob, 306, y, { size: 7, w: 170 })
    s.text(m.relation, 486, y, { size: 7, w: 180 })
    s.tick(m.residing ? 715 : 812, y, 8)
    if (!m.residing) { s.text(m.town, 866, y, { size: 6.5, w: 92 }); s.text(m.state, 966, y, { size: 6.5, w: 72 }) }
  })
  // Temporary identity card
  s.text(d.name, 190, 1500, { size: 9, bold: true, w: 475 })
  s.text(d.doj, 664, 1553, { size: 6.5, align: 'right' })
  s.text(d.dispensary, 496, 1583, { size: 7, w: 170 })
  s.lines([d.esic_code, d.company_name, d.company_address].filter(Boolean).join(' · '), 350, 1618, 316, { size: 6.5, lh: 14, max: 2 })
  s.text(d.date, 112, 1723, { size: 8 })
  if (photo) { try { await s.image(photo.bytes, photo.mime, 768, 1492, 258, 185) } catch { /* a photo that is not a PNG/JPG is simply not printed */ } }
}

export interface RenderOptions { photo?: { bytes: Uint8Array; mime: string } | null }

/** The filled form as PDF bytes. */
export async function renderStatutoryForm(key: FormKey, d: StatutoryData, o: RenderOptions = {}): Promise<Uint8Array> {
  const { doc, sheets } = await open(key)
  if (key === 'form11') drawForm11(sheets[0], d)
  else if (key === 'form2') drawForm2(sheets[0], sheets[1], d)
  else await drawEsic1(sheets[0], d, o.photo || null)
  doc.setTitle(`${FORMS[key].label} — ${d.name}`)
  doc.setProducer('EZER HRMS')
  return doc.save()
}

/** The forms a candidate gets: EPF Form 11 and Form 2 always, ESIC Form 1 when ESIC applies. */
export function formsFor(d: StatutoryData): FormKey[] {
  return d.esic_applicable ? ['form11', 'form2', 'esic1'] : ['form11', 'form2']
}

// ── Loading the facts from the database (the route and the acknowledgement mail share this) ──

const OC_SELECT = 'id, full_name, email, mobile, designation, department, employment_type, date_of_joining, submitted_at, employee_code, company_id, esic_applicable, form_data'

export interface Loaded { oc: Record<string, any>; data: StatutoryData; photo: { bytes: Uint8Array; mime: string } | null }

/** The onboarding record by id or magic-link token, with the company, the Aadhaar number from
 *  the AI extraction and (when asked) the passport photo for the ESIC identity card. */
export async function loadStatutory(sb: any, by: { id?: string; token?: string }, o: { photo?: boolean } = {}): Promise<Loaded | null> {
  let q = sb.from('onboarding_candidates').select(OC_SELECT)
  q = by.token ? q.eq('magic_link_token', by.token) : q.eq('id', by.id || '')
  const { data: oc } = await q.maybeSingle()
  if (!oc) return null
  const [{ data: company }, { data: docs }] = await Promise.all([
    oc.company_id ? sb.from('companies').select('company_name, reg_office, corp_office, epf_code, esic_code').eq('id', oc.company_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('onboarding_documents').select('doc_code, storage_path, mime_type, ai_extracted_data').eq('onboarding_id', oc.id).in('doc_code', ['AADHAAR_FRONT', 'PHOTO']),
  ])
  const aadhaarDoc = (docs || []).find((d: any) => d.doc_code === 'AADHAAR_FRONT')
  const aadhaar = String(aadhaarDoc?.ai_extracted_data?.aadhaar_number || aadhaarDoc?.ai_extracted_data?.aadhaar || '').replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')
  const data = statutoryData({ oc, company, aadhaar })
  let photo: Loaded['photo'] = null
  const photoDoc = (docs || []).find((p: any) => p.doc_code === 'PHOTO')
  if (o.photo && photoDoc?.storage_path && /^image\/(png|jpe?g)$/i.test(photoDoc.mime_type || '')) {
    try {
      const { data: file } = await sb.storage.from('onboarding-docs').download(photoDoc.storage_path)
      if (file) photo = { bytes: new Uint8Array(await file.arrayBuffer()), mime: photoDoc.mime_type }
    } catch { /* the card simply has no photo */ }
  }
  return { oc, data, photo }
}

/** Every applicable form as a mail attachment (nodemailer shape). Empty when the record is missing. */
export async function statutoryAttachments(sb: any, onboardingId: string): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const l = await loadStatutory(sb, { id: onboardingId }, { photo: true })
  if (!l) return []
  const out: { filename: string; content: Buffer; contentType: string }[] = []
  for (const k of formsFor(l.data)) {
    try { out.push({ filename: FORMS[k].filename(l.data), content: Buffer.from(await renderStatutoryForm(k, l.data, { photo: l.photo })), contentType: 'application/pdf' }) }
    catch (e) { console.error('statutory form attachment failed', k, e) }
  }
  return out
}
