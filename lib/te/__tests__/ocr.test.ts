// The file fingerprint, the tamper hints and the OCR normaliser.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sha256, normaliseOcr, fileMetadata, ocrProvider } from '../providers/ocr.ts'
import { TeConfigError } from '../errors.ts'

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))

describe('sha256', () => {
  test('known vectors', () => {
    assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    assert.equal(sha256(bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('one changed byte changes the fingerprint; the same bytes always give the same one', () => {
    assert.notEqual(sha256(bytes('bill-1')), sha256(bytes('bill-2')))
    assert.equal(sha256(bytes('bill-1')), sha256(bytes('bill-1')))
    assert.match(sha256(bytes('x')), /^[0-9a-f]{64}$/)
  })
})

describe('fileMetadata: only what is suspicious is reported', () => {
  const pdf = (info: string) => bytes(`%PDF-1.4\n1 0 obj\n<< ${info} >>\nendobj\ntrailer\n<< /Info 1 0 R >>\n%%EOF`)

  test('an ordinary PDF (an airline ticket, a hotel invoice) reports nothing', () => {
    assert.equal(fileMetadata(pdf('/Producer (iText 5.5.13) /Creator (Skyline Airways Billing)'), 'application/pdf'), null)
    assert.equal(fileMetadata(pdf('/Title (Invoice)'), 'application/pdf'), null)
  })
  test('a PDF made by a bill-generator site reports the producer (check E2)', () => {
    assert.deepEqual(fileMetadata(pdf('/Producer (FreeBillGenerator v3)'), 'application/pdf'), { software: null, producer: 'FreeBillGenerator v3' })
    assert.deepEqual(fileMetadata(pdf('/Creator (Fuel Bill  Generator online)'), 'application/pdf'), { software: null, producer: 'Fuel Bill  Generator online' })
  })
  test('a UTF-16 hex Producer string is read too', () => {
    const hex = 'FEFF' + [...'BillGenerator'].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')
    assert.deepEqual(fileMetadata(pdf(`/Producer <${hex}>`), 'application/pdf'), { software: null, producer: 'BillGenerator' })
  })
  test('a photo straight from a phone reports nothing', () => {
    assert.equal(fileMetadata(bytes('\xff\xd8\xff\xe1\x00\x40Exif\0\0Make\0Pixel 8\0Software\0HDR+ 1.0.5\0'), 'image/jpeg'), null)
  })
  test('a photo saved from an image editor reports the software (check E1)', () => {
    assert.deepEqual(fileMetadata(bytes('\xff\xd8\xff\xe1\x00\x40Exif\0\0Software\0Adobe Photoshop 25.0 (Windows)\0'), 'image/jpeg'), { software: 'Adobe Photoshop 25.0 (Windows)', producer: null })
    assert.equal(fileMetadata(bytes('\x89PNG\r\n\x1a\n<x:xmpmeta xmp:CreatorTool="GIMP 2.10"/>'), 'image/png')?.software, 'GIMP 2.10')
  })
})

describe('normaliseOcr', () => {
  test('a provider answer in common field names', () => {
    assert.deepEqual(normaliseOcr({ total_amount: '₹ 2,400.00', invoice_date: '06/11/2026', merchant_gstin: '06aakcs9087l1zi', invoice_no: ' DH-11873 ', raw_text: 'Dhaba  Estd 1986\n2 x Thali', phash: 'ph-1' }), {
      amount: 2400, date: '2026-11-06', gstin: '06AAKCS9087L1ZI', bill_no: 'DH-11873', text: 'Dhaba Estd 1986 2 x Thali', phash: 'ph-1',
    })
  })
  test('what cannot be read is null, never a guess', () => {
    assert.deepEqual(normaliseOcr({ amount: 'N/A', date: 'yesterday', gstin: 'NOTAGSTIN', text: 'ok' }), { amount: null, date: null, gstin: null, bill_no: null, text: 'ok', phash: null })
    assert.equal(normaliseOcr({ amount: 0 }), null)
    assert.equal(normaliseOcr(null), null)
  })
  test('the text is capped', () => {
    assert.equal(normaliseOcr({ text: 'a'.repeat(10000) })?.text?.length, 4000)
  })
})

describe('choosing the OCR provider', () => {
  test('nothing configured = none; a name that does not exist is a loud error', () => {
    assert.equal(ocrProvider({}), undefined)
    assert.equal(ocrProvider({ TE_OCR_PROVIDER: 'none' }), undefined)
    assert.throws(() => ocrProvider({ TE_OCR_PROVIDER: 'textract' }), TeConfigError)
  })
})
