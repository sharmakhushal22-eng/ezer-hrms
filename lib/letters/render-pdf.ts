// lib/letters/render-pdf.ts — SERVER ONLY. A People → Letters letter (lib/letters/catalog.ts) as
// a PDF on the company letterhead, drawn the same way as the appointment and exit letters
// (pdfkit for the content, lib/letterhead for the page): the document ID and date, the
// addressee, the subject, the letter's blocks, and the signature blocks it calls for.
import PDFDocument from 'pdfkit'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean } from '@/lib/letterhead/pdf-letter'
import { longDate, money, type LetterDef, type LetterDoc, type Values } from './catalog'

const INK = '#1E1B4B', MUTED = '#6B7280', LINE = '#D9DCE3', HEAD_BG = '#EEF2FF'

export async function letterPdf(o: { company: any; def: LetterDef; doc: LetterDoc; values: Values; docId: string; date: string }): Promise<{ name: string; content: Buffer }> {
  const { company, def, doc, values: v, docId } = o
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const M = lh.margins
  const companyName = v.company_name || company?.company_name || 'the Company'

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: `${def.name} — ${v.name || ''}`, Author: companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right, x0 = M.left
    const bottom = () => d.page.height - M.bottom
    const ensure = (h: number) => { if (d.y + h > bottom()) d.addPage() }
    const para = (t: string, indent = 0, bullet?: string) => {
      ensure(26)
      d.font('Helvetica').fontSize(10).fillColor(INK)
      if (bullet) { const y = d.y; d.text(bullet, x0 + indent, y, { width: 12, lineBreak: false }); d.y = y }
      d.text(clean(t), x0 + indent + (bullet ? 12 : 0), d.y, { width: W - indent - (bullet ? 12 : 0), align: 'justify', lineGap: 2 })
      d.moveDown(0.5)
    }
    const heading = (t: string) => { ensure(40); d.moveDown(0.3); d.font('Helvetica-Bold').fontSize(10.6).fillColor(INK).text(clean(t), x0, d.y, { width: W }); d.moveDown(0.3) }
    const kv = (rows: [string, string][]) => {
      for (const [k, val] of rows) {
        ensure(20); const y = d.y
        d.font('Helvetica').fontSize(9.8).fillColor(MUTED).text(clean(k), x0 + 6, y + 5, { width: 170 })
        d.font('Helvetica-Bold').fillColor(INK).text(clean(val || '-'), x0 + 182, y + 5, { width: W - 188 })
        const h = Math.max(d.y - y + 4, 20)
        d.moveTo(x0, y + h).lineTo(x0 + W, y + h).lineWidth(0.4).strokeColor(LINE).stroke()
        d.y = y + h
      }
      d.moveDown(0.7)
    }
    const table = (title: string, rows: [string, number][], total?: [string, number]) => {
      ensure(30); const y0 = d.y
      d.rect(x0, y0, W, 20).fill(HEAD_BG)
      d.font('Helvetica-Bold').fontSize(9.6).fillColor(INK).text(clean(title.toUpperCase()), x0 + 6, y0 + 6, { width: W - 140, lineBreak: false })
      d.text('AMOUNT', x0 + W - 130, y0 + 6, { width: 124, align: 'right', lineBreak: false })
      d.y = y0 + 20
      const line = (label: string, amt: number, bold = false) => {
        ensure(22); const y = d.y
        d.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.8).fillColor(INK).text(clean(label), x0 + 6, y + 5, { width: W - 150, lineBreak: false })
        d.text(clean(money(amt)), x0 + W - 130, y + 5, { width: 124, align: 'right', lineBreak: false })
        d.rect(x0, y, W, 20).lineWidth(0.4).strokeColor(LINE).stroke(); d.y = y + 20
      }
      if (!rows.length) line('None', 0)
      for (const [l, a] of rows) line(l, a)
      if (total) line(total[0], total[1], true)
      d.moveDown(0.8)
    }

    // Reference, date, addressee, subject
    d.font('Helvetica').fontSize(9.2).fillColor(MUTED).text(`Ref: ${docId}`, x0, d.y, { width: W / 2 + 40 })
    d.text(`Date: ${longDate(o.date)}`, x0 + W / 2, d.y - 11, { width: W / 2, align: 'right' })
    d.moveDown(1)
    if (doc.to === 'concern') {
      d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(clean(doc.subject.toUpperCase()), x0, d.y, { width: W, align: 'center' })
      d.moveDown(0.8)
      d.font('Helvetica-Bold').fontSize(10.4).text('TO WHOM IT MAY CONCERN', x0, d.y, { width: W })
      d.moveDown(0.8)
    } else {
      d.font('Helvetica-Bold').fontSize(10.4).fillColor(INK).text(clean(`${v.salutation || ''} ${v.name || ''}`.trim()), x0, d.y, { width: W })
      const sub = [v.emp_code ? `Employee Code: ${v.emp_code}` : '', [v.designation, v.department].filter(Boolean).join(', ')].filter(Boolean)
      for (const l of sub) d.font('Helvetica').fontSize(9.6).fillColor(MUTED).text(clean(l), x0, d.y, { width: W })
      d.moveDown(0.9)
      d.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(clean(`Subject: ${doc.subject}`), x0, d.y, { width: W, underline: true })
      d.moveDown(0.8)
      para(`Dear ${v.name || 'Employee'},`)
    }

    for (const b of doc.blocks) {
      if (b.t === 'p') para(b.text)
      else if (b.t === 'h') heading(b.text)
      else if (b.t === 'bullets') { for (const it of b.items) para(it, 10, '•'); d.moveDown(0.2) }
      else if (b.t === 'kv') kv(b.rows.filter(r => r[1] != null))
      else if (b.t === 'money') table(b.title, b.rows, b.total)
    }

    // Signatures
    if (doc.signers.length) {
      ensure(130); d.moveDown(1.2)
      const yTop = d.y
      if (doc.signers.includes('company')) {
        d.font('Helvetica').fontSize(10).fillColor(INK).text(clean(`For ${companyName}`), x0, d.y, { width: W / 2 })
        if (sig.image) { try { d.image(sig.image, x0, d.y + 4, { height: 38 }); d.y += 46 } catch { d.moveDown(2.2) } } else d.moveDown(2.2)
        d.font('Helvetica-Bold').text(clean(sig.name || 'Authorised Signatory'), x0, d.y, { width: W / 2 })
        d.font('Helvetica').fillColor(MUTED).text(clean(sig.designation || 'Human Resources'), x0, d.y, { width: W / 2 })
      }
      const others = doc.signers.filter(x => x !== 'company')
      if (others.length) {
        let y = doc.signers.includes('company') ? yTop : d.y
        const colW = doc.signers.includes('company') ? W / 2 : W / Math.max(1, others.length)
        others.forEach((who, i) => {
          const x = doc.signers.includes('company') ? x0 + W / 2 : x0 + i * colW
          const yy = doc.signers.includes('company') ? y + i * 52 : y
          const label = who === 'employee' ? `${v.name || 'Employee'} (Employee)` : who === 'manager' ? 'Reporting Manager' : 'HR'
          d.moveTo(x + 10, yy + 34).lineTo(x + colW - 10, yy + 34).lineWidth(0.5).strokeColor(MUTED).stroke()
          d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(`${label} · signature & date`), x + 10, yy + 38, { width: colW - 20 })
        })
        d.y = Math.max(d.y, y + (doc.signers.includes('company') ? others.length * 52 : 56))
      }
    }
    d.end()
  })

  const pdf = await stampOnLetterhead(content, lh, { title: `${def.name} — ${v.name || ''}`, author: companyName, label: (i, n) => `${docId} | ${def.name} | Page ${i + 1} of ${n}` })
  return { name: `${docId}.pdf`, content: pdf }
}
