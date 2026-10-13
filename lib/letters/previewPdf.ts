// ================================================================
// EZER HRMS — Plain preview of an HR letter (sample data, no branch)
// Path: lib/letters/previewPdf.ts
//
// Deliberately branch-agnostic — at design time there's no specific
// employee yet, so this renders the token-replaced text on a plain
// page just to check wording and field placement look right. The
// REAL branded output (actual letterhead + signatory) only happens
// at generation time (api/letters/generate), which is what the
// employee's actual letter uses.
//
// Shared by /api/letters/preview and the Configuration preview.
// ================================================================
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { toWinAnsi } from './winAnsi'

export async function renderLetterPreviewPdf(letterName: string | null | undefined, rawBody: string): Promise<Uint8Array> {
  // Same font limit as the real letter (lib/letterhead/merge.ts): only WinAnsi prints.
  const bodyText = toWinAnsi(rawBody)
  letterName = letterName == null ? letterName : toWinAnsi(letterName)
  const doc = await PDFDocument.create()
  let page = doc.addPage([595.28, 841.89]) // A4 in points
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)

  const marginLeft = 56, marginRight = 56, marginTop = 70, marginBottom = 60
  const contentWidth = page.getWidth() - marginLeft - marginRight
  let y = page.getHeight() - marginTop

  page.drawText('PREVIEW — SAMPLE DATA', { x: marginLeft, y: y + 20, size: 8, font, color: rgb(0.6, 0.6, 0.6) })
  page.drawText((letterName ?? 'Letter').toUpperCase(), { x: marginLeft, y, size: 13, font: boldFont, color: rgb(0.12, 0.11, 0.29) })
  y -= 30

  const paragraphs = String(bodyText).split(/\n\s*\n/).map((p: string) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const bodySize = 10.5, lineHeight = bodySize * 1.5
  const draw = (text: string) => {
    if (y < marginBottom) { page = doc.addPage([595.28, 841.89]); y = page.getHeight() - marginTop }
    page.drawText(text, { x: marginLeft, y, size: bodySize, font, color: rgb(0.2, 0.2, 0.2) })
    y -= lineHeight
  }

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, bodySize) > contentWidth) { draw(line); line = word }
      else line = test
    }
    if (line) draw(line)
    y -= lineHeight * 0.6
  }

  return doc.save()
}
