// ================================================================
// EZER HRMS — Template Preview (sample data, no real branch)
// Path: app/api/letters/preview/route.ts
//
// Deliberately branch-agnostic — at design time there's no specific
// employee yet, so this renders the token-replaced text on a plain
// page just to check wording and field placement look right. The
// REAL branded output (actual letterhead + signatory) only happens
// at generation time (api/letters/generate), which is what the
// employee's actual letter uses.
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export async function POST(req: NextRequest) {
  const { letter_name, body_text } = await req.json()
  if (!body_text) return NextResponse.json({ error: 'body_text required' }, { status: 400 })

  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89]) // A4 in points
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)

  const marginLeft = 56, marginRight = 56, marginTop = 70
  const contentWidth = page.getWidth() - marginLeft - marginRight
  let y = page.getHeight() - marginTop

  page.drawText('PREVIEW — SAMPLE DATA', { x: marginLeft, y: y + 20, size: 8, font, color: rgb(0.6, 0.6, 0.6) })
  page.drawText((letter_name ?? 'Letter').toUpperCase(), { x: marginLeft, y, size: 13, font: boldFont, color: rgb(0.12, 0.11, 0.29) })
  y -= 30

  const paragraphs = String(body_text).split(/\n\s*\n/).map((p: string) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const bodySize = 10.5, lineHeight = bodySize * 1.5

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, bodySize) > contentWidth) {
        page.drawText(line, { x: marginLeft, y, size: bodySize, font, color: rgb(0.2, 0.2, 0.2) })
        line = word; y -= lineHeight
      } else line = test
    }
    if (line) { page.drawText(line, { x: marginLeft, y, size: bodySize, font, color: rgb(0.2, 0.2, 0.2) }); y -= lineHeight }
    y -= lineHeight * 0.6
  }

  const bytes = await doc.save()
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf' } })
}
