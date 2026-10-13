// lib/letterhead/pdf-letter.ts — SERVER ONLY.
//
// A letter on the company's letterhead, for any document that needs one (the offer letters,
// the joining-day welcome card). The uploaded letterhead (Letters → Letterhead) at COMPANY
// scope, else GROUP scope, is the background of every page; with none uploaded the company's
// built-in design from lib/letterheads.tsx is drawn instead. Content is laid out with pdfkit
// inside safe margins, then stamped onto the letterhead with pdf-lib.
//
// Helvetica: "Rs." instead of the rupee glyph, which the core fonts lack.

import { PDFDocument as LibDoc, StandardFonts, rgb } from 'pdf-lib'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { resolveLetterhead } from '@/lib/letterheads'

export type Doc = PDFKit.PDFDocument
export const MM = 2.834645669
export const A4: [number, number] = [595.28, 841.89]
// The configured margins on the uploaded letterheads do not match their artwork (one says
// 0 mm at the top over a 50 mm header), so these floors keep text off the header and footer.
export const MIN_TOP_MM = 55, MIN_BOTTOM_MM = 35, MIN_SIDE_MM = 20
export const MUTED = '#6B7280'

// The core fonts only carry WinAnsi; anything else (a name in Devanagari, say) would print as
// garbage and break line widths, so it becomes "?" instead.
export const clean = (s: any) => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[−–—]/g, '-')
  .replace(/[^\x20-\x7E\xA0-\xFF‘’“”•…\n]/g, '?').trim()

export type Letterhead = { pdf: Uint8Array | null; size: [number, number]; margins: { top: number; bottom: number; left: number; right: number }; builtin: ReturnType<typeof resolveLetterhead> | null }
export type Signatory = { name: string; designation: string; image: Buffer | null }

async function resolveScope(table: 'letterhead_files' | 'letterhead_signatories', companyId: string | null, groupId: string | null) {
  for (const [scope, key] of [['COMPANY', companyId], ['GROUP', groupId]] as const) {
    if (!key) continue
    const { data } = await sb.from(table).select('*').eq('scope_type', scope).eq('scope_key', key).eq('is_active', true).maybeSingle()
    if (data) return data as any
  }
  return null
}

export async function loadLetterhead(company: any): Promise<Letterhead> {
  const row = await resolveScope('letterhead_files', company?.id || null, company?.group_id || null)
  if (row?.file_url) {
    const { data: blob } = await sb.storage.from('letterhead-files').download(row.file_url)
    if (blob) {
      const pdf = new Uint8Array(await blob.arrayBuffer())
      const p0 = (await LibDoc.load(pdf)).getPage(0)
      const mm = (v: any, floor: number) => Math.max(Number(v) || 0, floor) * MM
      return {
        pdf, size: [p0.getWidth(), p0.getHeight()], builtin: null,
        margins: { top: mm(row.content_top_mm, MIN_TOP_MM), bottom: mm(row.content_bottom_mm, MIN_BOTTOM_MM), left: mm(row.content_left_mm, MIN_SIDE_MM), right: mm(row.content_right_mm, MIN_SIDE_MM) },
      }
    }
  }
  // No upload: draw the company's built-in letterhead ourselves.
  return { pdf: null, size: A4, builtin: resolveLetterhead(company?.company_code || company?.company_name), margins: { top: 46 * MM, bottom: 30 * MM, left: MIN_SIDE_MM * MM, right: MIN_SIDE_MM * MM } }
}

export async function loadSignatory(company: any): Promise<Signatory> {
  const row = await resolveScope('letterhead_signatories', company?.id || null, company?.group_id || null)
  let image: Buffer | null = null
  if (row?.signature_url) {
    const { data: blob } = await sb.storage.from('letterhead-signatures').download(row.signature_url)
    if (blob) {
      const b = Buffer.from(await blob.arrayBuffer())
      // pdfkit takes PNG and JPEG only
      if (b.subarray(0, 4).toString('hex') === '89504e47' || b.subarray(0, 2).toString('hex') === 'ffd8') image = b
    }
  }
  return { name: row?.signatory_name || 'Authorised Signatory', designation: row?.signatory_designation || 'Human Resources', image }
}

/** The built-in letterhead (no upload): coloured band with name/address, footer with registered office. */
export function drawBuiltin(d: Doc, lh: NonNullable<Letterhead['builtin']>, company: any) {
  const [w, h] = [d.page.width, d.page.height]
  // Drawing in the margins must not trigger pdfkit's auto page-break, and the cursor must be
  // back at the top margin afterwards for the content that follows.
  // pdfkit's save()/restore() do not restore its own font/size/colour state, and a paragraph
  // that wraps onto this new page carries on with whatever is current — so put them back too.
  const st = d as any
  const { x: cx, y: cy } = d, mb = d.page.margins.bottom
  const font0 = st._font, size0 = st._fontSize, fill0 = st._fillColor
  d.page.margins.bottom = 0
  d.save()
  d.rect(0, 0, w, 34 * MM).fill(lh.headerBg)
  d.fillColor(lh.headerText).font('Helvetica-Bold').fontSize(18).text(company?.company_name || lh.name, 20 * MM, 11 * MM, { width: w * 0.55, lineBreak: false })
  d.font('Helvetica').fontSize(8).fillColor('#E5E7EB').text(lh.eyebrow, 20 * MM, 20 * MM, { width: w * 0.55, lineBreak: false })
  d.fontSize(7.5).fillColor('#E5E7EB')
  lh.addr.forEach((line, i) => d.text(clean(line), w - 20 * MM - 200, 8 * MM + i * 10, { width: 200, align: 'right', lineBreak: false }))
  d.fontSize(7).fillColor(MUTED).text(`CIN: ${company?.cin || lh.cin}    GSTIN: ${company?.gstin || lh.gstin}    PAN: ${company?.pan || lh.pan}`, 20 * MM, 38 * MM, { width: w - 40 * MM, lineBreak: false })
  d.moveTo(20 * MM, 42 * MM).lineTo(w - 20 * MM, 42 * MM).lineWidth(0.6).strokeColor(lh.accent).stroke()
  d.rect(0, h - 18 * MM, w, 18 * MM).fill(lh.headerBg)
  d.fontSize(7).fillColor('#E5E7EB').text(clean(company?.reg_office ? `Registered Office: ${company.reg_office}` : lh.footerRegistered), 20 * MM, h - 12 * MM, { width: w - 40 * MM, align: 'center', lineBreak: false })
  d.fontSize(6.5).fillColor(MUTED).text(clean(lh.confidential), 20 * MM, h - 22 * MM, { width: w - 40 * MM, align: 'center', lineBreak: false })
  d.restore()
  d.page.margins.bottom = mb; d.x = cx; d.y = cy
  st._font = font0; if (font0) st.font(font0.name); if (size0) d.fontSize(size0); if (fill0) d.fillColor(...(fill0 as [any, any]))
}

/**
 * Final pass: every content page onto the uploaded letterhead (when there is one), and a
 * small label ("Name - Title | Page x of y") just under the content area.
 */
export async function stampOnLetterhead(content: Buffer, lh: Letterhead, o: { title: string; author: string; label: (page: number, pages: number) => string }): Promise<Buffer> {
  const out = await LibDoc.create()
  const fgDoc = await LibDoc.load(content)
  const fgs = await out.embedPdf(fgDoc, fgDoc.getPageIndices())
  const bg = lh.pdf ? (await out.embedPdf(await LibDoc.load(lh.pdf), [0]))[0] : null
  const font = await out.embedFont(StandardFonts.Helvetica)
  // pdf-lib's standard fonts throw on characters outside WinAnsi (e.g. a name in Devanagari).
  const winAnsi = (t: string) => t.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
  fgs.forEach((fg, i) => {
    const p = out.addPage(lh.size)
    if (bg) p.drawPage(bg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    p.drawPage(fg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    const t = winAnsi(clean(o.label(i, fgs.length))), size = 7.5
    p.drawText(t, { x: (lh.size[0] - font.widthOfTextAtSize(t, size)) / 2, y: lh.margins.bottom - 14, size, font, color: rgb(0.42, 0.45, 0.5) })
  })
  out.setTitle(o.title); out.setAuthor(o.author)
  return Buffer.from(await out.save())
}
