// lib/onboarding/ack-pdf.ts — SERVER ONLY.
//
// The joining acknowledgement the candidate downloads from the last screen of the onboarding
// link: one document on the company's letterhead. The uploaded letterhead (Letters →
// Letterhead) at company scope, else group scope, is the page background; with none uploaded
// the company's built-in design is drawn. Same engine as the offer letter and the welcome card
// (lib/letterhead/pdf-letter.ts), so all three look like they came from the same office.
//
// Layout, top to bottom: title and reference block, the joiner's details as a two-column
// grid, what was e-signed, the policies acknowledged (with dates), the declaration, and an
// e-sign stamp beside the company's signatory.

import PDFDocument from 'pdfkit'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean } from '@/lib/letterhead/pdf-letter'

const INK = '#111827', SOFT = '#374151', MUTED = '#6B7280', BRAND = '#1D4ED8', DEEP = '#0B1D4D'
const TINT = '#EFF6FF', LINE = '#DBEAFE', HAIR = '#E5E7EB', OK = '#047857', OK_TINT = '#ECFDF5', OK_EDGE = '#A9DCC7'

export interface AckFacts {
  ackNo: string
  generatedAt: Date
  employeeName: string
  fatherName: string | null
  employeeCode: string | null
  designation: string | null
  department: string | null
  doj: string | null
  companyName: string
  workLocation: string | null
  aadhaarLast4: string | null
  esignedAt: string | null
  forms: string[]
  documents: number
  policies: { code: string; title: string; version?: string | null; at: string | null }[]
}

const dateLong = (iso: string | null) => {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (d: Date) => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

export async function ackPdf(company: any, f: AckFacts): Promise<{ name: string; content: Buffer }> {
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const M = lh.margins
  const title = `Joining Acknowledgement - ${f.employeeName}`

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: title, Author: f.companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right, x0 = M.left
    const ensure = (h: number) => { if (d.y + h > d.page.height - M.bottom) d.addPage() }
    const eyebrow = (t: string) => { d.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND).text(t, x0, d.y, { width: W, characterSpacing: 1.4 }); d.moveDown(0.35) }

    // ── title + reference ─────────────────────────────────────────────
    const ty = d.y
    d.font('Helvetica').fontSize(8.5).fillColor(BRAND).text('JOINING FORMALITIES', x0, ty, { width: W * 0.6, characterSpacing: 1.5 })
    d.font('Helvetica-Bold').fontSize(19).fillColor(DEEP).text('Acknowledgement & Declaration', x0, ty + 13, { width: W * 0.62 })
    // reference box, top right
    const rw = W * 0.34, rx = x0 + W - rw
    d.roundedRect(rx, ty, rw, 44, 6).fillAndStroke(TINT, LINE)
    d.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('REFERENCE', rx + 10, ty + 8, { width: rw - 20, characterSpacing: .8, lineBreak: false })
    d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(f.ackNo), rx + 10, ty + 18, { width: rw - 20, lineBreak: false })
    d.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(clean(`Generated ${stamp(f.generatedAt)}`), rx + 10, ty + 31, { width: rw - 20, lineBreak: false })
    d.y = ty + 52
    d.font('Helvetica').fontSize(10).fillColor(SOFT).text(clean(
      `This confirms that ${f.employeeName} has completed the joining formalities with ${f.companyName}, read and acknowledged the company policies listed below, and e-signed the statutory forms with an Aadhaar OTP.`),
      x0, d.y, { width: W, lineGap: 1.5 })
    d.moveDown(0.7)

    // ── the joiner, as a two-column grid of labelled cells ────────────
    eyebrow('EMPLOYEE DETAILS')
    const cells: [string, string | null][] = [
      ['Employee name', f.employeeName], ["Father's name", f.fatherName],
      ['Employee ID', f.employeeCode || 'To be issued by HR'], ['Designation', f.designation],
      ['Department', f.department], ['Date of joining', dateLong(f.doj)],
      ['Company', f.companyName], ['Work location', f.workLocation],
      ['Aadhaar', `XXXX XXXX ${f.aadhaarLast4 || '****'}`], ['Documents submitted', String(f.documents)],
    ]
    const cw = (W - 10) / 2, ch = 27
    for (let i = 0; i < cells.length; i += 2) {
      ensure(ch + 6)
      const y = d.y
      cells.slice(i, i + 2).forEach(([k, v], j) => {
        const cx = x0 + j * (cw + 10)
        d.roundedRect(cx, y, cw, ch, 5).fillAndStroke('#FFFFFF', HAIR)
        d.font('Helvetica').fontSize(7).fillColor(MUTED).text(k.toUpperCase(), cx + 9, y + 5, { width: cw - 18, characterSpacing: .7, lineBreak: false })
        d.font('Helvetica-Bold').fontSize(9.5).fillColor(v ? INK : MUTED).text(clean(v || 'Not given'), cx + 9, y + 14.5, { width: cw - 18, lineBreak: false, ellipsis: true })
      })
      d.y = y + ch + 5
    }
    d.moveDown(0.5)

    // ── forms e-signed: chips ──────────────────────────────────────────
    ensure(40)
    eyebrow('STATUTORY FORMS E-SIGNED')
    let fx = x0
    const fy = d.y
    f.forms.forEach(fm => {
      d.font('Helvetica-Bold').fontSize(8.5)
      const w = d.widthOfString(clean(fm)) + 26
      if (fx + w > x0 + W) return
      d.roundedRect(fx, fy, w, 18, 9).fillAndStroke(OK_TINT, OK_EDGE)
      // a drawn tick: the core fonts have no check-mark glyph
      d.moveTo(fx + 8, fy + 9.5).lineTo(fx + 10.5, fy + 12).lineTo(fx + 14.5, fy + 6.5).lineWidth(1.4).strokeColor(OK).stroke()
      d.font('Helvetica-Bold').fontSize(8.5).fillColor(OK).text(clean(fm), fx + 18, fy + 5, { lineBreak: false })
      fx += w + 6
    })
    d.y = fy + 26

    // ── policies acknowledged: a small table ──────────────────────────
    ensure(50)
    eyebrow(`POLICIES ACKNOWLEDGED (${f.policies.length})`)
    if (!f.policies.length) {
      d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('No company policy was set up for acknowledgement.', x0, d.y, { width: W })
      d.moveDown(0.6)
    } else {
      const hy = d.y
      d.rect(x0, hy, W, 18).fill('#F3F4F6')
      d.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
      d.text('POLICY', x0 + 9, hy + 6, { width: W * 0.55, characterSpacing: .6, lineBreak: false })
      d.text('CODE', x0 + W * 0.58, hy + 6, { width: W * 0.2, characterSpacing: .6, lineBreak: false })
      d.text('ACKNOWLEDGED ON', x0 + W * 0.76, hy + 6, { width: W * 0.24 - 9, characterSpacing: .6, lineBreak: false, align: 'right' })
      d.y = hy + 18
      f.policies.forEach(p => {
        ensure(18)
        const y = d.y
        d.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(clean(p.title), x0 + 9, y + 4.5, { width: W * 0.55, lineBreak: false, ellipsis: true })
        d.font('Helvetica').fontSize(8.5).fillColor(SOFT).text(clean(`${p.code}${p.version ? ` · v${p.version}` : ''}`), x0 + W * 0.58, y + 5, { width: W * 0.2, lineBreak: false })
        d.text(clean(p.at ? stamp(new Date(p.at)) : '-'), x0 + W * 0.76, y + 5, { width: W * 0.24 - 9, lineBreak: false, align: 'right' })
        d.moveTo(x0, y + 17.5).lineTo(x0 + W, y + 17.5).lineWidth(0.5).strokeColor(HAIR).stroke()
        d.y = y + 18
      })
      d.moveDown(0.6)
    }

    // ── declaration ───────────────────────────────────────────────────
    const decl = 'I hereby declare that the information I have provided is true, correct and complete to the best of my knowledge, and that I have received, read and understood the policies listed above. I understand that false or misleading information may lead to withdrawal of the offer or termination of employment, and I consent to background verification of my credentials.'
    d.font('Helvetica').fontSize(9.5)
    const dh = d.heightOfString(clean(decl), { width: W - 28, lineGap: 1.5 }) + 28
    ensure(dh)
    const dy = d.y
    d.roundedRect(x0, dy, W, dh, 6).fillAndStroke(TINT, LINE)
    d.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND).text('DECLARATION', x0 + 14, dy + 10, { width: W - 28, characterSpacing: 1.2 })
    d.font('Helvetica').fontSize(9.5).fillColor(SOFT).text(clean(decl), x0 + 14, dy + 22, { width: W - 28, lineGap: 1.5 })
    d.y = dy + dh + 12
    ensure(68)

    // ── signatures: the joiner's e-sign stamp, and the company's signatory ──
    const sy = d.y, half = (W - 20) / 2
    d.roundedRect(x0, sy, half, 58, 6).fillAndStroke(OK_TINT, OK_EDGE)
    d.font('Helvetica-Bold').fontSize(8).fillColor(OK).text('E-SIGNED WITH AADHAAR OTP', x0 + 12, sy + 9, { width: half - 24, characterSpacing: .8, lineBreak: false })
    d.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(clean(f.employeeName), x0 + 12, sy + 22, { width: half - 24, lineBreak: false, ellipsis: true })
    d.font('Helvetica').fontSize(8).fillColor(SOFT).text(clean(`Aadhaar XXXX XXXX ${f.aadhaarLast4 || '****'}${f.esignedAt ? `  ·  ${stamp(new Date(f.esignedAt))}` : ''}`), x0 + 12, sy + 38, { width: half - 24, lineBreak: false })

    const rx2 = x0 + half + 20
    d.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(clean(`For ${f.companyName}`), rx2, sy + 2, { width: half, align: 'right', lineBreak: false })
    if (sig.image) { try { d.image(sig.image, rx2 + half - 100, sy + 14, { fit: [100, 26] }) } catch { /* no signature image */ } }
    d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(sig.name), rx2, sy + 42, { width: half, align: 'right', lineBreak: false })
    d.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(clean(sig.designation), rx2, sy + 55, { width: half, align: 'right', lineBreak: false })
    d.y = sy + 74
    d.end()
  })

  const safe = f.employeeName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Joiner'
  return {
    name: `Joining_Acknowledgement_${safe}.pdf`,
    content: await stampOnLetterhead(content, lh, { title, author: f.companyName, label: (i, n) => `${f.employeeName} - Joining acknowledgement ${f.ackNo} | Page ${i + 1} of ${n}` }),
  }
}
