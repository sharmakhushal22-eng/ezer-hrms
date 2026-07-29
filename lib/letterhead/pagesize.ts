// ================================================================
// EZER HRMS — Read PDF page size (client-side)
// Path: lib/letterhead/pagesize.ts
//
// Runs in the browser the moment the admin picks a letterhead PDF, so
// the upload form can show "Detected: A4 (210 × 297mm)" and pre-fill
// the size fields instead of asking the admin to measure their own
// artwork.
// ================================================================
import { PDFDocument } from 'pdf-lib'
import type { PdfPageSize } from './types'

const PT_TO_MM = 0.352778

export async function readPdfInfo(file: File): Promise<{ size: PdfPageSize; pageCount: number }> {
  const bytes = await file.arrayBuffer()
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  return {
    size: { widthPt: page.getWidth(), heightPt: page.getHeight() },
    pageCount: doc.getPageCount(),
  }
}

export function ptToMm(pt: number): number {
  return Math.round(pt * PT_TO_MM * 10) / 10
}

export function describePageSize({ widthPt, heightPt }: PdfPageSize): string {
  const wMm = ptToMm(widthPt)
  const hMm = ptToMm(heightPt)
  const isA4 = Math.abs(wMm - 210) < 3 && Math.abs(hMm - 297) < 3
  const isLetter = Math.abs(wMm - 216) < 3 && Math.abs(hMm - 279) < 3
  const known = isA4 ? 'A4' : isLetter ? 'US Letter' : null
  return known ? `${known} (${wMm} × ${hMm}mm)` : `${wMm} × ${hMm}mm (custom)`
}
