// lib/te/providers/ocr.ts — what the server can tell about an uploaded bill.
//
// THREE THINGS, IN ORDER OF HOW REAL THEY ARE TODAY
//
// 1. sha256(bytes) — IMPLEMENTED. The fingerprint of the exact file. The
//    duplicate checks (B1: same file claimed twice, also across employees)
//    compare it. Computed on the server from the bytes it received; a hash the
//    browser sends is never used.
//
// 2. fileMetadata(bytes, mime) — IMPLEMENTED AS A HEURISTIC. Two checks of the
//    rules engine fire on ANY non-empty value, so this layer decides what counts:
//      E1 "Image was saved from editing software"  fires when metadata.software is set
//      E2 "PDF came from a bill-generator tool"    fires when metadata.producer is set
//    A phone photo names its camera app and an airline PDF names its PDF library;
//    neither is suspicious. So `software` is set only when the file names a known
//    image editor, and `producer` only when a PDF names a known bill-generator
//    site. The lists are below; extend them as Finance meets new ones. It reads
//    plain text in the file: an encrypted or object-stream-compressed PDF yields
//    nothing, which means "no finding", never "clean".
//
// 3. OCR (amount, date, GSTIN, bill number, words on the bill, perceptual hash)
//    — NO PROVIDER IS CONTRACTED. TE_OCR_PROVIDER unset or "none" -> no OCR: the
//    employee types the amount, and checks A5 (typed amount differs from the
//    bill), D9 (restricted items) and B2 (re-photographed copy) simply have
//    nothing to compare. Any other value is a configuration error. To add one,
//    return `async file => normaliseOcr(await callProvider(file))` from
//    ocrProvider() under its own name.
import { createHash } from 'node:crypto'
import { TeConfigError } from '../errors.ts'

export interface OcrResult {
  amount: number | null
  /** 'YYYY-MM-DD' */
  date: string | null
  gstin: string | null
  bill_no: string | null
  /** The words on the bill, for the restricted-items check. Capped at 4,000 characters. */
  text: string | null
  /** Perceptual hash of the image, when the provider computes one. */
  phash: string | null
}
export interface OcrFile { bytes: Uint8Array; mime: string; name: string }
export type OcrProvider = (file: OcrFile) => Promise<OcrResult | null>

/** Lower-case hex SHA-256 of the file. */
export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** A provider's raw answer -> the fields the engine reads. Unusable values become null, never a guess. */
export function normaliseOcr(raw: unknown): OcrResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pick = (...keys: string[]): unknown => keys.map(k => r[k]).find(v => v !== undefined && v !== null && v !== '')
  const amountRaw = pick('amount', 'total', 'total_amount', 'grand_total')
  const amount = typeof amountRaw === 'number' ? amountRaw : typeof amountRaw === 'string' ? Number(amountRaw.replace(/[^0-9.]/g, '')) : NaN
  const dateRaw = String(pick('date', 'bill_date', 'invoice_date') ?? '')
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateRaw) ? dateRaw.slice(0, 10)
    : /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.test(dateRaw) ? dateRaw.replace(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/, '$3-$2-$1') : ''
  const gstin = String(pick('gstin', 'merchant_gstin', 'seller_gstin') ?? '').toUpperCase().replace(/\s+/g, '')
  const text = String(pick('text', 'raw_text', 'full_text') ?? '').replace(/\s+/g, ' ').trim()
  const out: OcrResult = {
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
    date: iso && Number.isFinite(Date.parse(iso + 'T00:00:00Z')) ? iso : null,
    gstin: GSTIN.test(gstin) ? gstin : null,
    bill_no: String(pick('bill_no', 'invoice_no', 'invoice_number', 'bill_number') ?? '').trim() || null,
    text: text ? text.slice(0, 4000) : null,
    phash: String(pick('phash', 'perceptual_hash') ?? '').trim() || null,
  }
  return Object.values(out).some(v => v !== null) ? out : null
}

/** Image editors whose name inside a photo means it was opened and saved again. */
export const EDITING_SOFTWARE = ['Adobe Photoshop', 'Photoshop', 'GIMP', 'Pixelmator', 'Affinity Photo', 'PicsArt', 'Snapseed', 'Canva', 'Paint.NET', 'Pixlr', 'Photopea', 'Fotor', 'Inkscape', 'CorelDRAW']
/** Words in a PDF's Producer / Creator that mean a fake-receipt site made it. */
export const BILL_GENERATORS = ['billgenerator', 'bill generator', 'freebillgenerator', 'fakebill', 'fake bill', 'receiptmaker', 'receipt maker', 'makereceipt', 'expressexpense', 'invoice-generator.com', 'fuelbillgenerator', 'rentreceiptgenerator']

const latin1 = (bytes: Uint8Array, max: number): string => Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, max)).toString('latin1')

/** A PDF string as written in an Info dictionary: "(text)" with \-escapes, or UTF-16 hex "<FEFF…>". */
function pdfInfo(text: string, key: string): string {
  const paren = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(text)
  if (paren) return paren[1].replace(/\\([()\\])/g, '$1').replace(/[^\x20-\x7E]/g, '').trim()
  const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`).exec(text)
  if (hex) {
    const h = hex[1].replace(/\s+/g, '')
    const utf16 = /^FEFF/i.test(h)
    let out = ''
    for (let i = utf16 ? 4 : 0; i + (utf16 ? 4 : 2) <= h.length; i += utf16 ? 4 : 2) out += String.fromCharCode(parseInt(h.slice(i, i + (utf16 ? 4 : 2)), 16))
    return out.replace(/[^\x20-\x7E]/g, '').trim()
  }
  return ''
}

/**
 * { software, producer } for te_expense_files.metadata, or null when nothing
 * suspicious was found. See the header for why "nothing found" is the normal case.
 */
export function fileMetadata(bytes: Uint8Array, mime: string): { software: string | null; producer: string | null } | null {
  const isPdf = mime === 'application/pdf' || latin1(bytes, 5) === '%PDF-'
  if (isPdf) {
    const text = latin1(bytes, 2_000_000)
    const named = [pdfInfo(text, 'Producer'), pdfInfo(text, 'Creator')].filter(Boolean)
    const hit = named.find(n => BILL_GENERATORS.some(g => n.toLowerCase().replace(/\s+/g, ' ').includes(g)))
    return hit ? { software: null, producer: hit.slice(0, 120) } : null
  }
  // EXIF "Software" and XMP "CreatorTool" are plain text near the start of a JPEG, PNG or WebP.
  const head = latin1(bytes, 262_144)
  const editor = EDITING_SOFTWARE.find(name => head.includes(name))
  if (!editor) return null
  const at = head.indexOf(editor)
  const label = head.slice(at, at + 60).split(/[\0<"\r\n]/)[0].replace(/[^\x20-\x7E]/g, '').trim()
  return { software: (label || editor).slice(0, 80), producer: null }
}

/** The OCR provider, or undefined when none is configured. Throws on a name that does not exist. */
export function ocrProvider(env: Record<string, string | undefined> = process.env): OcrProvider | undefined {
  const name = String(env.TE_OCR_PROVIDER || '').trim().toLowerCase()
  if (!name || name === 'none') return undefined
  throw new TeConfigError(`TE_OCR_PROVIDER is set to "${name}", but no bill-scanning provider is implemented. Leave it unset (employees type the amount), or add the provider in lib/te/providers/ocr.ts.`)
}
