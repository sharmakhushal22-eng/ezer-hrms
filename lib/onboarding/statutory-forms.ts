// lib/onboarding/statutory-forms.ts — SERVER ONLY. The official statutory forms, filled.
//
// The blank forms HR gave us live in public/statutory-forms/ exactly as issued (they have no
// fillable fields), and the candidate's details are drawn onto them with pdf-lib at the places
// the printed boxes sit:
//   form11  EPF New Form 11 (declaration)              1 page
//   form2   EPF Form 2 (revised) nomination, Part A + Part B (EPS)   2 pages
//   esic1   ESIC Form 1 declaration + family particulars + TIC        2 pages (page 2 = instructions)
//   formf   Gratuity Form F (Payment of Gratuity (Central) Rules, 1972, rule 6(1)) — no blank was
//           issued, so it is drawn here in the statutory wording, nominees and statement filled.
// Positions are given in pixels of the 1800px-tall renders the layout was measured on and
// converted to points per page, so a template re-measured at that size drops straight in.
// What is printed comes from statutory-data.ts, shared with the tests.

import fs from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import { toWinAnsi } from '@/lib/letters/winAnsi'
import { statutoryData, type StatutoryData } from './statutory-data'
export { statutoryData, type StatutoryData }

export type FormKey = 'form11' | 'form2' | 'esic1' | 'formf'
export const FORMS: Record<FormKey, { file: string | null; label: string; filename: (d: StatutoryData) => string; imgW: number }> = {
  form11: { file: 'form11.pdf', label: 'EPF Form 11 — Declaration', filename: d => `EPF_Form11_${slug(d.name)}.pdf`, imgW: 1390 },
  form2:  { file: 'form2.pdf',  label: 'EPF Form 2 — Nomination & Declaration', filename: d => `EPF_Form2_${slug(d.name)}.pdf`, imgW: 1272 },
  esic1:  { file: 'esi1.pdf',   label: 'ESIC Form 1 — Declaration', filename: d => `ESIC_Form1_${slug(d.name)}.pdf`, imgW: 1080 },
  formf:  { file: null,         label: 'Gratuity Form F — Nomination', filename: d => `Gratuity_FormF_${slug(d.name)}.pdf`, imgW: 595 },
}
/** Where the EMPLOYEE signs, for e-signing (lib/onboarding/esign.ts): 1-based page within the
 *  form, fractions of the page from the top-left. Measured on the official blanks next to the
 *  printed "Signature of member / subscriber / I.P." labels, in the white space each leaves.
 *  Form F is drawn here, so its spot is reported by the drawing code instead. Witnesses and
 *  the employer still sign by hand where the forms ask for them. */
export interface SignSpot { page: number; x: number; y: number; w: number; h: number }
const SIGN_SPOTS: Record<Exclude<FormKey, 'formf'>, SignSpot[]> = {
  form11: [{ page: 1, x: 0.727, y: 0.641, w: 0.245, h: 0.053 }],                    // above "Signature of Member"
  form2:  [{ page: 1, x: 0.672, y: 0.905, w: 0.31, h: 0.055 },                      // under "Signature or thumb impression of the" (Part A)
           { page: 2, x: 0.595, y: 0.648, w: 0.34, h: 0.045 }],                     // under the subscriber's label (Part B)
  esic1:  [{ page: 1, x: 0.704, y: 0.578, w: 0.263, h: 0.047 },                     // under "Signature / T.I. of IP" (declaration)
           { page: 1, x: 0.352, y: 0.927, w: 0.259, h: 0.034 }],                    // above "Signature / T.I. of I.P." (identity card)
}

export const isFormKey = (k: any): k is FormKey => k === 'form11' || k === 'form2' || k === 'esic1' || k === 'formf'
const slug = (n: string) => (n || 'candidate').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')

const INK = rgb(0.08, 0.14, 0.42)
const BLACK = rgb(0.1, 0.1, 0.1)

/** A page with a drawing helper that takes pixel coordinates of the measured render. */
class Sheet {
  private k: number
  constructor(public page: PDFPage, imgW: number, private font: PDFFont, private bold: PDFFont) { this.k = page.getWidth() / imgW }
  private pt = (px: number) => px * this.k
  /** Draw text with its baseline at (x, y) px. `w` clips to a width (px) by shrinking the size, never below 5.5pt. */
  text(t: string, x: number, y: number, o: { size?: number; bold?: boolean; w?: number; align?: 'left' | 'center' | 'right'; black?: boolean } = {}) {
    const str = toWinAnsi(String(t ?? '')).trim()
    if (!str) return
    const f = o.bold ? this.bold : this.font
    let size = o.size ?? 9
    const maxW = o.w ? this.pt(o.w) : 0
    if (maxW) while (size > 5.5 && f.widthOfTextAtSize(str, size) > maxW) size -= 0.5
    let px = this.pt(x)
    if (o.align === 'center') px -= f.widthOfTextAtSize(str, size) / 2
    if (o.align === 'right') px -= f.widthOfTextAtSize(str, size)
    this.page.drawText(str, { x: px, y: this.page.getHeight() - this.pt(y), size, font: f, color: o.black ? BLACK : INK })
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
  /** The lines `t` wraps into inside width w (px) at `size`. */
  wrap(t: string, w: number, size: number): string[] {
    const str = toWinAnsi(String(t ?? '')).trim()
    if (!str) return []
    const maxW = this.pt(w), out: string[] = []
    let cur = ''
    for (const word of str.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word
      if (this.font.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next
      else { out.push(cur); cur = word }
    }
    if (cur) out.push(cur)
    return out
  }
  width(t: string, size: number, bold = false) { return (bold ? this.bold : this.font).widthOfTextAtSize(toWinAnsi(String(t ?? '')), size) / this.k }
  rule(x1: number, y1: number, x2: number, y2: number, thickness = 0.6) {
    const H = this.page.getHeight()
    this.page.drawLine({ start: { x: this.pt(x1), y: H - this.pt(y1) }, end: { x: this.pt(x2), y: H - this.pt(y2) }, thickness, color: rgb(0.1, 0.1, 0.1) })
  }
  box(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x: this.pt(x), y: this.page.getHeight() - this.pt(y + h), width: this.pt(w), height: this.pt(h), borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.6 })
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

async function open(key: FormKey): Promise<{ doc: PDFDocument; sheets: Sheet[]; sheet: () => Sheet }> {
  const file = FORMS[key].file
  const doc = file ? await PDFDocument.load(await fs.readFile(path.join(process.cwd(), 'public', 'statutory-forms', file)), { ignoreEncryption: true }) : await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  // `sheet()` adds an A4 page for a form that is drawn rather than filled in.
  return { doc, sheets: doc.getPages().map(p => new Sheet(p, FORMS[key].imgW, font, bold)), sheet: () => new Sheet(doc.addPage([595, 842]), 595, font, bold) }
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
  // Ticks sit ON the printed boxes (re-measured: Yes box centre x 1013, No x 1180).
  s.tick(d.has_uan ? 1013 : 1180, 515, 13)      // 7. earlier a member of EPF 1952
  s.tick(d.has_uan ? 1013 : 1180, 543, 13)      // 8. earlier a member of EPS 1995
  if (d.has_uan) {
    s.text(d.uan, 848, 607, { size: 10, bold: true, w: 430 })
    // 9(b): the form splits the PF number into AP | HYD | EST.CODE | EXTN | PF NO cells
    // (x 838-897 | 897-963 | 963-1127 | 1127-1167 | 1167-1290). A number that does not parse
    // stays on one line, shrunk to fit inside the row.
    const pf = String(d.prev_pf_id || '').replace(/[\s/]/g, '').toUpperCase().match(/^([A-Z]{2})([A-Z]{3})(\d{1,7})([A-Z0-9]{3})(\d{1,7})$/)
    if (pf) [[pf[1], 867, 55], [pf[2], 930, 62], [pf[3], 1045, 158], [pf[4], 1147, 36], [pf[5], 1228, 116]].forEach(([v, x, w]) => s.text(v as string, x as number, 646, { size: 9, align: 'center', w: w as number }))
    else s.text(d.prev_pf_id, 848, 646, { size: 9, w: 438 })
    const ex = dmy(d.prev_exit)
    if (ex) { s.text(ex.d, 932, 679, { size: 10, align: 'center' }); s.text(ex.m, 1100, 679, { size: 10, align: 'center' }); s.text(ex.y, 1235, 679, { size: 10, align: 'center' }) }
    else s.text(d.prev_exit, 848, 679, { size: 10 })
  }
  s.tick(d.is_foreign ? 1013 : 1180, 777, 13)   // 10. international worker
  s.text(d.country, 848, 809, { size: 10, w: 430 })
  if (d.is_foreign) { s.text(d.passport_no, 848, 835, { size: 10, w: 430 }); s.text(d.passport_valid, 848, 862, { size: 9, w: 430 }) }
  s.text([d.bank_account, d.ifsc].filter(Boolean).join('   IFSC '), 848, 922, { size: 9.5, w: 430 })
  s.text(d.aadhaar, 848, 962, { size: 10, w: 430 })
  s.text(d.pan, 848, 1002, { size: 10, w: 430 })
  s.text(d.date, 280, 1231, { size: 10 })
  s.text(d.place, 280, 1263, { size: 10, w: 400 })
  // Declaration by the present employer — the facts we hold; the PF number stays for the employer.
  // The printed dot leaders are whited out under each value, so it reads as filled in, not overprinted.
  s.blank(406, 1291, 132, 15); s.text(d.name, 410, 1304, { size: 8.5, w: 126 })
  s.blank(652, 1291, 104, 15); s.text(d.doj, 704, 1304, { size: 8.5, w: 100, align: 'center' })
}

// ── EPF Form 2 revised (595 × 842 A4, measured on 1272 × 1800) ─────────────────────────────
function drawForm2(p1: Sheet, p2: Sheet, d: StatutoryData) {
  const X = 602, W = 560
  // Values sit a few px above the printed dot leaders, which then underline them (on the
  // baseline they struck through the letters).
  const UP = (y: number) => y - 6
  p1.text(d.name.toUpperCase(), X, UP(269), { size: 10, bold: true, w: W })
  p1.text(d.parent.name, X, UP(320), { size: 10, w: W })
  p1.text(d.dob, X, UP(369), { size: 10 })
  p1.text(d.gender, X, UP(419), { size: 10 })
  p1.text(d.marital, X, UP(469), { size: 10 })
  p1.text(d.has_uan ? `UAN ${d.uan}` : 'New member — to be allotted', X, UP(519), { size: 10, w: W })
  p1.lines(d.perm_address, X, 556, W, { size: 8, lh: 48, max: 2 })   // address dot rows: 562 / 610
  p1.lines(d.curr_address, X, 650, W, { size: 8, lh: 48, max: 2 })   // 656 / 704
  p1.text(d.doj, X, UP(758), { size: 10 })
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
  p2.blank(150, 1138, 120, 18); p2.text(d.date, 160, 1150, { size: 10 })
  // Certificate by the employer — the member's name is ours to print; the rest is signed by hand.
  p2.text(d.name, 100, UP(1351), { size: 9, w: 440 })
  p2.blank(160, 1443, 250, 18); p2.text(d.place, 170, 1455, { size: 9, w: 200 })
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
  // PIN boxes, measured: six cells 26.3px wide starting at x 111 (present) and 370.5 (permanent).
  const pin = (v: string, x0: number) => v.replace(/\D/g, '').slice(0, 6).split('').forEach((ch, i) => s.text(ch, x0 + i * 26.3, 646, { size: 8, align: 'center' }))
  pin(d.curr_pin, 124.5); pin(d.perm_pin, 383.5)
  s.text(d.mobile, 222, 681, { size: 7, w: 66 }); s.text(d.mobile, 470, 681, { size: 7, w: 68 })
  s.text(d.dispensary, 405, 723, { size: 6.5, w: 132 })
  // Employer
  s.text(d.esic_code, 775, 277, { size: 8.5, w: 260 })
  const doj = dmy(d.doj)
  if (doj) { s.text(doj.d, 840, 374, { size: 8.5, align: 'center' }); s.text(doj.m, 920, 374, { size: 8.5, align: 'center' }); s.text(doj.y, 1000, 374, { size: 8.5, align: 'center' }) }
  // 11. three ruled lines at y 420 / 443 / 465, under the printed label
  s.lines([d.company_name, d.company_address].filter(Boolean).join(', '), 592, 417, 440, { size: 7, lh: 23, max: 3 })
  s.text(d.esic_prev_ip, 805, 559, { size: 8.5, w: 230 })
  // (c) nominee for the cash benefit
  if (d.esic_nominee) {
    s.text(d.esic_nominee.name, 50, 853, { size: 8, w: 285 })
    s.text(d.esic_nominee.relation, 345, 853, { size: 8, w: 285 })
    s.text(d.esic_nominee.address, 640, 853, { size: 7, w: 390 })
  }
  // (D) family particulars — eight rows
  d.family.slice(0, 8).forEach((m, i) => {
    const y = 1286 + i * 20   // rows ruled every 20px from 1270; baseline 4px above the lower rule
    s.text(String(i + 1), 66, y, { size: 7, align: 'center' })
    // columns ruled at x 102 / 300 / 481 / 669 / 761 / 856 / 959; values start 6px inside
    s.text(m.name, 108, y, { size: 7, w: 186 })
    s.text(m.dob, 307, y, { size: 7, w: 168 })
    s.text(m.relation, 488, y, { size: 7, w: 175 })
    s.tick(m.residing ? 715 : 812, y - 5, 8)
    if (!m.residing) { s.text(m.town, 862, y, { size: 6.5, w: 92 }); s.text(m.state, 965, y, { size: 6.5, w: 72 }) }
  })
  // Temporary identity card
  s.text(d.name, 190, 1500, { size: 9, bold: true, w: 475 })
  s.text(d.doj, 662, 1547, { size: 7.5, align: 'right' })   // cell 1518-1553
  s.text(d.dispensary, 496, 1583, { size: 7, w: 170 })
  s.lines([d.esic_code, d.company_name, d.company_address].filter(Boolean).join(' · '), 350, 1627, 316, { size: 6.5, lh: 15, max: 2 })   // cell 1610-1662
  s.text(d.date, 112, 1723, { size: 8 })
  if (photo) { try { await s.image(photo.bytes, photo.mime, 768, 1492, 258, 185) } catch { /* a photo that is not a PNG/JPG is simply not printed */ } }
}

// ── Gratuity Form F (A4, drawn in points: imgW = 595 so px = pt) ──────────────────────────
function drawFormF(sheet: () => Sheet, d: StatutoryData, spots?: SignSpot[]) {
  const W = 595, M = 46, CW = W - 2 * M, BODY = 9.3, LH = 12.6
  let s = sheet(), y = 44
  const text = (t: string, x: number, o: { size?: number; bold?: boolean; w?: number; align?: 'left' | 'center' | 'right'; black?: boolean } = {}) => s.text(t, x, y, { black: true, ...o })
  /** A wrapped paragraph; `strike` draws the statutory strike-out through it. */
  const para = (t: string, o: { size?: number; bold?: boolean; indent?: number; after?: number; strike?: boolean; align?: 'center' } = {}) => {
    const size = o.size ?? BODY, lh = size * 1.36, x = M + (o.indent ?? 0)
    for (const l of s.wrap(t, CW - (o.indent ?? 0), size)) {
      // Static wording is black like a printed form; what came from the candidate (bold) stays ink-blue.
      if (o.align === 'center') s.text(l, W / 2, y, { size, bold: o.bold, align: 'center', black: !o.bold })
      else s.text(l, x, y, { size, bold: o.bold, black: !o.bold })
      if (o.strike) s.rule(x, y - size * 0.32, x + s.width(l, size, o.bold), y - size * 0.32, 0.7)
      y += lh
    }
    y += o.after ?? 3
  }
  const field = (label: string, value: string, labelW = 215) => {   // "label : value", value wrapped
    s.text(label, M, y, { size: BODY, black: true }); s.text(':', M + labelW - 8, y, { size: BODY, black: true })
    const ls = s.wrap(value || '', CW - labelW, BODY)
    if (!ls.length) s.rule(M + labelW, y + 1, W - M, y + 1, 0.4)
    ls.forEach((l, i) => s.text(l, M + labelW, y + i * LH, { size: BODY, bold: true }))
    y += Math.max(1, ls.length) * LH + 2
  }
  const hasFamily = d.grat_nominees.length > 0
  const female = /^f/i.test(d.gender)
  const marital = d.marital === 'Widow' ? (female ? 'Widow' : 'Widower') : d.marital

  text("FORM 'F'", W / 2, { size: 13, bold: true, align: 'center' }); y += 15
  text('[See sub-rule (1) of rule 6]', W / 2, { size: 8.5, align: 'center' }); y += 14
  text('NOMINATION', W / 2, { size: 11, bold: true, align: 'center' }); y += 18
  text('To,', M, { size: BODY }); y += LH
  para([d.company_name, d.company_address].filter(Boolean).join(', ') || '(Name or description of the establishment with full address)', { indent: 18, bold: true, after: 6 })
  para(`I, Shri/Shrimati/Kumari ${d.name.toUpperCase() || '______________________'}, whose particulars are given in the statement below, hereby nominate the person(s) mentioned below to receive the gratuity payable after my death as also the gratuity standing to my credit in the event of my death before that amount has become payable, or having become payable has not been paid, and direct that the said amount of gratuity shall be paid in proportion indicated against the name(s) of the nominee(s).`)
  para('2. I hereby certify that the person(s) mentioned is/are a member(s) of my family within the meaning of clause (h) of section 2 of the Payment of Gratuity Act, 1972.', { strike: !hasFamily })
  para('3. I hereby declare that I have no family within the meaning of clause (h) of section 2 of the said Act.', { strike: hasFamily })
  para('4. (a) My father/mother/parents is/are not dependent on me.', { indent: 0, after: 1 })
  para('    (b) My husband\'s father/mother/parents is/are not dependent on my husband.', { strike: !female })
  para('5. I have excluded my husband from my family by a notice dated the ______________ to the controlling authority in view of the proviso to clause (h) of section 2 of the said Act.', { strike: !female })
  para('6. Nomination made herein invalidates my previous nomination.', { after: 8 })

  // Nominee table
  text('Nominee(s)', W / 2, { size: 10.5, bold: true, align: 'center' }); y += 14
  const cols = [0, 232, 335, 395, CW]
  const heads = ['Name in full with full address of nominee(s)', 'Relationship with the employee', 'Age of nominee', 'Proportion by which the gratuity will be shared']
  const headLines = heads.map((h, i) => s.wrap(h, cols[i + 1] - cols[i] - 8, 8.2))
  const headH = Math.max(...headLines.map(l => l.length)) * 10.5 + 18
  s.box(M, y - 4, CW, headH)
  cols.slice(1, -1).forEach(c => s.rule(M + c, y - 4, M + c, y - 4 + headH))
  headLines.forEach((ls, i) => ls.forEach((l, j) => s.text(l, M + cols[i] + 4, y + 7 + j * 10.5, { size: 8.2, black: true })))
  heads.forEach((_, i) => s.text(`(${i + 1})`, M + (cols[i] + cols[i + 1]) / 2, y + headH - 8, { size: 8, align: 'center', black: true }))
  y += headH - 4
  const rows = d.grat_nominees.length ? d.grat_nominees : [{ name: '', address: '', relation: '', age: '', share: '', dob: '' }]
  for (const n of rows) {
    const nameLs = n.name ? [n.name] : [], addrLs = s.wrap(n.address, cols[1] - 10, 8.5)
    const h = Math.max(2, nameLs.length + addrLs.length) * 11 + 10
    s.box(M, y, CW, h)
    cols.slice(1, -1).forEach(c => s.rule(M + c, y, M + c, y + h))
    nameLs.forEach((l, j) => s.text(l, M + 4, y + 13 + j * 11, { size: 9, bold: true, w: cols[1] - 8 }))
    addrLs.forEach((l, j) => s.text(l, M + 4, y + 13 + (nameLs.length + j) * 11, { size: 8.5 }))
    s.text(n.relation, M + cols[1] + 4, y + 13, { size: 9, w: cols[2] - cols[1] - 8 })
    s.text(n.age ? `${n.age} years` : '', M + cols[2] + 4, y + 13, { size: 9, w: cols[3] - cols[2] - 8 })
    s.text(n.share || '', M + cols[3] + 4, y + 13, { size: 9, w: cols[4] - cols[3] - 8 })
    y += h
  }
  y += 14

  // Statement
  text('Statement', W / 2, { size: 10.5, bold: true, align: 'center' }); y += 15
  field('1. Name of employee in full', d.name.toUpperCase())
  field('2. Sex', d.gender)
  field('3. Religion', d.religion)
  field('4. Whether unmarried / married / widow / widower', marital)
  field('5. Department / Branch / Section where employed', d.department)
  field('6. Post held with Ticket or Serial No., if any', [d.designation, d.emp_code ? `(${d.emp_code})` : ''].filter(Boolean).join(' '))
  field('7. Date of appointment', d.doj)
  const pp = d.perm_parts
  field('8. Permanent address', [pp.line1, pp.city, pp.pin].filter(Boolean).join(', '))
  const parts: [string, string][] = [['Village', pp.village], ['Thana', pp.thana], ['Sub-division', pp.sub_division], ['Post Office', pp.po], ['District', pp.district], ['State', pp.state]]
  parts.forEach(([l, v], i) => {
    const col = i % 2, x = M + 20 + col * (CW / 2)
    s.text(`${l}:`, x, y, { size: BODY, black: true }); s.text(v || '', x + 62, y, { size: BODY, bold: true, w: CW / 2 - 70 })
    if (!v) s.rule(x + 62, y + 1, x + CW / 2 - 12, y + 1, 0.4)
    if (col === 1 || i === parts.length - 1) y += LH
  })
  y += 10
  s.text(`Place: ${d.place || '____________'}`, M, y, { size: BODY }); s.text('Signature / Thumb-impression of the employee', W - M, y, { size: BODY, align: 'right', black: true })
  // The e-signature goes right under its label (A4 drawn in points, so px = pt).
  spots?.push({ page: 1, x: (W - M - 190) / 595, y: (y + 5) / 842, w: 190 / 595, h: 44 / 842 })
  y += LH
  s.text(`Date: ${d.date}`, M, y, { size: BODY })

  // ── Page 2: witnesses, employer, acknowledgement ──
  s = sheet(); y = 50
  text('Declaration by witnesses', W / 2, { size: 10.5, bold: true, align: 'center' }); y += 16
  para('Nomination signed / thumb-impressed before me.', { after: 6 })
  s.text('Name in full and full address of witnesses', M, y, { size: BODY, bold: true, black: true }); s.text('Signature of witnesses', M + CW * 0.62, y, { size: BODY, bold: true, black: true }); y += LH + 4
  for (const n of ['1.', '2.']) {
    s.text(n, M, y, { size: BODY, black: true }); s.rule(M + 16, y + 1, M + CW * 0.58, y + 1, 0.4); s.text(n, M + CW * 0.62, y, { size: BODY, black: true }); s.rule(M + CW * 0.62 + 16, y + 1, W - M, y + 1, 0.4); y += LH + 8
    s.rule(M + 16, y + 1, M + CW * 0.58, y + 1, 0.4); y += LH + 6
  }
  s.text('Place: ______________________', M, y, { size: BODY, black: true }); s.text('Date: ______________________', M + CW * 0.62, y, { size: BODY, black: true }); y += 34

  text('Certificate by the employer', W / 2, { size: 10.5, bold: true, align: 'center' }); y += 16
  para('Certified that the particulars of the above nomination have been verified and recorded in this establishment.', { after: 8 })
  field("Employer's Reference No., if any", '', 200)
  y += 6
  s.text('Signature of the employer / Officer authorised: ________________________________', M, y, { size: BODY, black: true }); y += LH + 6
  s.text('Date: ______________________', M, y, { size: BODY, black: true }); s.text('Designation: ________________________', M + CW * 0.5, y, { size: BODY, black: true }); y += LH + 6
  para('Name and address of the establishment or rubber stamp thereof:', { after: 2 })
  para([d.company_name, d.company_address].filter(Boolean).join(', ') || '______________________________________________', { indent: 18, bold: true, after: 30 })

  text('Acknowledgement by the employee', W / 2, { size: 10.5, bold: true, align: 'center' }); y += 16
  para("Received the duplicate copy of nomination in Form 'F' filed by me and duly certified by the employer.", { after: 14 })
  s.text('Date: ______________________', M, y, { size: BODY, black: true }); s.text('Signature of the employee', W - M, y, { size: BODY, align: 'right', black: true }); y += 40
  para('Note: Strike out the words / paragraphs not applicable. Paragraphs are struck through here from the details given on the onboarding form; the employee confirms them while signing.', { size: 8, after: 0 })
}

export interface RenderOptions {
  photo?: { bytes: Uint8Array; mime: string } | null
  /** Filled with where the employee signs on this form (for e-signing). */
  spots?: SignSpot[]
}

/** The filled form as PDF bytes. */
export async function renderStatutoryForm(key: FormKey, d: StatutoryData, o: RenderOptions = {}): Promise<Uint8Array> {
  const { doc, sheets, sheet } = await open(key)
  if (key === 'form11') drawForm11(sheets[0], d)
  else if (key === 'form2') drawForm2(sheets[0], sheets[1], d)
  else if (key === 'formf') drawFormF(sheet, d, o.spots)
  else await drawEsic1(sheets[0], d, o.photo || null)
  if (key !== 'formf') o.spots?.push(...SIGN_SPOTS[key])
  doc.setTitle(`${FORMS[key].label} — ${d.name}`)
  doc.setProducer('EZER HRMS')
  return doc.save()
}

/** The forms a candidate gets: EPF Form 11, EPF Form 2 and Gratuity Form F always, ESIC Form 1 when ESIC applies. */
export function formsFor(d: StatutoryData): FormKey[] {
  return d.esic_applicable ? ['form11', 'form2', 'formf', 'esic1'] : ['form11', 'form2', 'formf']
}

// ── Loading the facts from the database (the route and the acknowledgement mail share this) ──

const OC_SELECT = 'id, full_name, email, mobile, designation, department, employment_type, date_of_joining, submitted_at, employee_code, company_id, esic_applicable, form_data, hiring_track'

/** An overseas employee (lib/onboarding/hiring-track.ts) is outside Indian PF, gratuity and ESIC — no forms at all. */
export const hasStatutoryForms = (oc: { hiring_track?: string | null } | null | undefined) => oc?.hiring_track !== 'OVERSEAS'

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
  if (!l || !hasStatutoryForms(l.oc)) return []
  const out: { filename: string; content: Buffer; contentType: string }[] = []
  for (const k of formsFor(l.data)) {
    try { out.push({ filename: FORMS[k].filename(l.data), content: Buffer.from(await renderStatutoryForm(k, l.data, { photo: l.photo })), contentType: 'application/pdf' }) }
    catch (e) { console.error('statutory form attachment failed', k, e) }
  }
  return out
}
