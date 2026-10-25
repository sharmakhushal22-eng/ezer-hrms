// lib/onboarding/welcome-card.ts — SERVER ONLY.
//
// The greeting card attached to the day-before welcome mail: one page on the company's
// letterhead — a big warm welcome, the day and where to be, the joining-day programme and
// what to bring. Drawn with pdfkit, stamped on the letterhead by lib/letterhead/pdf-letter.ts.

import PDFDocument from 'pdfkit'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean, MM } from '@/lib/letterhead/pdf-letter'
import type { JoinerFacts, ScheduleItem } from './joining-day'
import { BRING_ALONG } from './joining-day'

const INK = '#1F2937', MUTED = '#6B7280', BRAND = '#1D4ED8', DEEP = '#0B1D4D', TINT = '#EFF6FF', LINE = '#DBEAFE'

const dayLong = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(iso)
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const hhmm12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }

export async function welcomeCardPdf(company: any, f: JoinerFacts, p: { report: string; items: ScheduleItem[] }, venue: string | null, contact: { name: string | null; phone: string | null; email: string | null }): Promise<{ name: string; content: Buffer }> {
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const M = lh.margins
  const first = f.name.trim().split(/\s+/)[0] || f.name
  const title = `Welcome aboard — ${f.name}`

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: title, Author: f.company } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right, x0 = M.left
    const ensure = (h: number) => { if (d.y + h > d.page.height - M.bottom) d.addPage() }

    // ── the greeting ──
    d.font('Helvetica').fontSize(9).fillColor(BRAND).text('TOMORROW IS THE DAY', x0, d.y, { width: W, characterSpacing: 1.6 })
    d.moveDown(0.3)
    d.font('Helvetica-Bold').fontSize(27).fillColor(DEEP).text(clean(`Welcome aboard, ${first}!`), x0, d.y, { width: W })
    d.moveDown(0.25)
    d.font('Helvetica').fontSize(10.5).fillColor(INK).text(clean(`The whole team at ${f.company} is looking forward to welcoming you${f.role ? ` as our new ${f.role}` : ''}${f.department ? ` in ${f.department}` : ''}. We could not be happier that you said yes.`), x0, d.y, { width: W, lineGap: 2 })
    d.moveDown(0.8)

    // ── when / where card ──
    const rows: [string, string][] = [
      ['When', `${dayLong(f.doj)} - please reach by ${hhmm12(p.report)}`],
      ['Where', venue || 'our office'],
    ]
    const ask = [contact.name, contact.phone, contact.email].filter(Boolean).join('  ·  ')
    if (ask) rows.push(['Ask for', ask])
    const cardH = 14 + rows.length * 17
    ensure(cardH + 6)
    const top = d.y
    d.roundedRect(x0, top, W, cardH, 8).fillAndStroke(TINT, LINE)
    let y = top + 9
    rows.forEach(([k, v]) => {
      d.font('Helvetica').fontSize(9).fillColor(MUTED).text(k.toUpperCase(), x0 + 12, y + 1, { width: 70, characterSpacing: .8, lineBreak: false })
      d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(v), x0 + 84, y, { width: W - 96, lineBreak: false })
      y += 17
    })
    d.y = top + cardH + 16

    // ── the programme ──
    d.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text('YOUR FIRST DAY', x0, d.y, { width: W, characterSpacing: 1.6 })
    d.moveDown(0.4)
    p.items.forEach(i => {
      d.font('Helvetica').fontSize(9.5)
      const h = Math.max(14, d.heightOfString(clean(i.detail || ''), { width: W - 110 }) + (i.detail ? 12 : 0)) + 5
      ensure(h)
      const yy = d.y
      d.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND).text(hhmm12(i.time), x0, yy, { width: 60, lineBreak: false })
      d.circle(x0 + 72, yy + 5, 2.4).fill(BRAND)
      d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(i.title), x0 + 84, yy, { width: W - 84 })
      if (i.detail) d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(i.detail), x0 + 84, d.y, { width: W - 84 })
      d.moveTo(x0 + 72, yy + 9).lineTo(x0 + 72, yy + h - 2).lineWidth(0.8).strokeColor(LINE).stroke()
      d.y = yy + h
    })
    d.moveDown(0.6)

    // ── what to bring ──
    ensure(20 + BRING_ALONG.length * 13)
    d.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text('PLEASE BRING ALONG', x0, d.y, { width: W, characterSpacing: 1.6 })
    d.moveDown(0.4)
    BRING_ALONG.forEach(b => { d.font('Helvetica').fontSize(9.5).fillColor(INK).text(clean(`•  ${b}`), x0 + 4, d.y, { width: W - 8 }); d.moveDown(0.1) })
    d.moveDown(0.6)

    // ── sign-off: the closing line, then the signatory beside it, so it stays on the page ──
    ensure(64)
    d.font('Helvetica').fontSize(10).fillColor(INK).text(clean(`Come with a smile — we have the rest covered. See you tomorrow!`), x0, d.y, { width: W })
    d.moveDown(0.5)
    const sy = d.y
    d.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Warmly, for ${clean(f.company)}`, x0, sy, { width: W * 0.55, lineBreak: false })
    if (sig.image) { try { d.image(sig.image, x0, sy + 12, { fit: [90, 30] }) } catch { /* no signature image */ } }
    d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(sig.name), x0 + W * 0.55, sy, { width: W * 0.45, align: 'right', lineBreak: false })
    d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(sig.designation), x0 + W * 0.55, sy + 13, { width: W * 0.45, align: 'right', lineBreak: false })
    d.y = sy + 46
    d.end()
  })

  const safe = f.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Candidate'
  return { name: `Welcome_${safe}.pdf`, content: await stampOnLetterhead(content, lh, { title, author: f.company, label: (i, n) => `${f.name} - Welcome aboard | Page ${i + 1} of ${n}` }) }
}
