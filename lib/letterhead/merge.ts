// ================================================================
// EZER HRMS — Letterhead Merge Utility
// Path: lib/letterhead/merge.ts
//
// The one function every letter-generation flow calls to get a finished
// PDF: the branch's resolved letterhead as the page background, the
// letter body placed inside the configured safe margins (paragraph-aware,
// multi-page), and the resolved signatory's image + name + designation
// stamped at the placed position (or bottom-right as a fallback).
// Runs server-side. Needs pdf-lib.
// ================================================================
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { ResolvedLetterhead, ResolvedSignatory } from './types'

const MM_TO_PT = 2.834645669

export interface MergeLetterInput {
  letterhead: ResolvedLetterhead
  letterheadPdfBytes: ArrayBuffer
  signatory: ResolvedSignatory | null
  signatureImageBytes?: ArrayBuffer
  signatureMimeType?: 'image/png' | 'image/jpeg'
  letterTypeLabel: string   // e.g. "Offer Letter" — printed as the title
  bodyText: string          // token-replaced letter body (blank line = new paragraph)
}

/** Merge one letter's content onto its branch's resolved letterhead. Returns finished PDF bytes. */
export async function mergeLetterOntoLetterhead(input: MergeLetterInput): Promise<Uint8Array> {
  const { letterhead, letterheadPdfBytes, signatory, signatureImageBytes, signatureMimeType, letterTypeLabel, bodyText } = input

  if (!letterhead.letterhead_configured || !letterhead.file_url) {
    throw new Error(`No letterhead configured for branch "${letterhead.location_name}" — configure one at Branch, Company, or Group level first.`)
  }

  const letterheadDoc = await PDFDocument.load(letterheadPdfBytes)
  const output = await PDFDocument.create()

  const pageWidthPt = letterheadDoc.getPage(0).getWidth()
  const pageHeightPt = letterheadDoc.getPage(0).getHeight()
  const scale = (letterhead.scale_percent ?? 100) / 100

  const bgPage0 = (await output.embedPdf(letterheadDoc, [0]))[0]
  let page = output.addPage([pageWidthPt, pageHeightPt])
  page.drawPage(bgPage0, { x: 0, y: 0, xScale: scale, yScale: scale })

  const marginTop    = (letterhead.content_top_mm ?? 40) * MM_TO_PT
  const marginBottom = (letterhead.content_bottom_mm ?? 30) * MM_TO_PT
  const marginLeft   = (letterhead.content_left_mm ?? 20) * MM_TO_PT
  const marginRight  = (letterhead.content_right_mm ?? 20) * MM_TO_PT
  const contentWidth = pageWidthPt - marginLeft - marginRight
  const contentTopY  = pageHeightPt - marginTop

  const font = await output.embedFont(StandardFonts.Helvetica)
  const boldFont = await output.embedFont(StandardFonts.HelveticaBold)

  // Title
  page.drawText(letterTypeLabel.toUpperCase(), {
    x: marginLeft, y: contentTopY, size: 13, font: boldFont, color: rgb(0.12, 0.11, 0.29),
  })

  // Body — paragraph-aware word-wrap; blank line = new paragraph; overflow
  // spills onto continuation pages with the SAME letterhead background.
  const bodySize = 10.5
  const lineHeight = bodySize * 1.5
  const paragraphGap = lineHeight * 0.6
  const minY = marginBottom + 70 // room for the signature block on the LAST page

  const paragraphs = bodyText.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)

  let currentPage = page
  let y = contentTopY - 28

  async function newContinuationPage() {
    const bg = (await output.embedPdf(letterheadDoc, [0]))[0]
    const p = output.addPage([pageWidthPt, pageHeightPt])
    p.drawPage(bg, { x: 0, y: 0, xScale: scale, yScale: scale })
    return p
  }

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, bodySize) > contentWidth) {
        if (y < minY) { currentPage = await newContinuationPage(); y = pageHeightPt - marginTop }
        currentPage.drawText(line, { x: marginLeft, y, size: bodySize, font, color: rgb(0.2, 0.2, 0.2) })
        line = word
        y -= lineHeight
      } else {
        line = test
      }
    }
    if (line) {
      if (y < minY) { currentPage = await newContinuationPage(); y = pageHeightPt - marginTop }
      currentPage.drawText(line, { x: marginLeft, y, size: bodySize, font, color: rgb(0.2, 0.2, 0.2) })
      y -= lineHeight
    }
    y -= paragraphGap
  }

  // Signature goes on the page the body actually ended on.
  page = currentPage

  const sigImage = (signatory?.signatory_configured && signatureImageBytes && signatureMimeType)
    ? (signatureMimeType === 'image/png' ? await output.embedPng(signatureImageBytes) : await output.embedJpg(signatureImageBytes))
    : null

  const placed = signatory && signatory.sig_x_pct != null && signatory.sig_y_pct != null && signatory.sig_width_pct != null

  if (placed) {
    // Absolute placement from the admin's drag-and-drop (percentages of the page).
    const imgW = (signatory!.sig_width_pct! / 100) * pageWidthPt
    const imgH = sigImage ? imgW * (sigImage.height / sigImage.width) : 40
    const x = (signatory!.sig_x_pct! / 100) * pageWidthPt
    const topY = pageHeightPt - (signatory!.sig_y_pct! / 100) * pageHeightPt
    const imgBottomY = topY - imgH
    if (sigImage) page.drawImage(sigImage, { x, y: imgBottomY, width: imgW, height: imgH })
    page.drawText(signatory?.signatory_name ?? '—', { x, y: imgBottomY - 13, size: 10, font: boldFont, color: rgb(0.12, 0.11, 0.29) })
    page.drawText(signatory?.signatory_designation ?? '—', { x, y: imgBottomY - 26, size: 8.5, font, color: rgb(0.42, 0.45, 0.5) })
  } else {
    // Fallback: bottom-right block inside the safe margins.
    const sigBlockX = pageWidthPt - marginRight - 180
    let sigY = marginBottom + 55
    if (sigImage) {
      const sigDims = sigImage.scale(Math.min(1, 100 / sigImage.width))
      page.drawImage(sigImage, { x: sigBlockX, y: sigY, width: sigDims.width, height: sigDims.height })
      sigY -= 6
    }
    page.drawLine({ start: { x: sigBlockX, y: sigY }, end: { x: sigBlockX + 160, y: sigY }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })
    page.drawText(signatory?.signatory_name ?? '—', { x: sigBlockX, y: sigY - 14, size: 10, font: boldFont, color: rgb(0.12, 0.11, 0.29) })
    page.drawText(signatory?.signatory_designation ?? '—', { x: sigBlockX, y: sigY - 27, size: 8.5, font, color: rgb(0.42, 0.45, 0.5) })
  }

  return output.save()
}
