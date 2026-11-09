// lib/esign/__tests__/core.test.ts — EZER Sign's pure pieces and the PDF stamping engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'

process.env.ESIGN_SECRET ||= 'test-secret'
const core = await import('../core.ts')
const stamp = await import('../stamp.ts')

test('Aadhaar: Verhoeff check accepts valid numbers and rejects typos', () => {
  // Valid test numbers (Verhoeff-correct, UIDAI never issues 0/1-leading numbers).
  assert.equal(core.isValidAadhaar('2345 6789 0124'), true)
  assert.equal(core.isValidAadhaar('234567890125'), false)  // last digit flipped
  assert.equal(core.isValidAadhaar('123456789012'), false)  // starts with 1
  assert.equal(core.isValidAadhaar('23456789012'), false)   // 11 digits
})

test('OTP sealing is bound to signer and purpose, and compared safely', () => {
  const otp = core.newOtp()
  assert.match(otp, /^\d{6}$/)
  const sealed = core.sealOtp('s1', 'email', otp)
  assert.equal(core.otpMatches(sealed, 's1', 'email', otp), true)
  assert.equal(core.otpMatches(sealed, 's2', 'email', otp), false, 'another signer')
  assert.equal(core.otpMatches(sealed, 's1', 'aadhaar', otp), false, 'another purpose')
  assert.equal(core.otpMatches(sealed, 's1', 'email', '12345'), false, 'malformed')
  assert.equal(core.otpMatches(null, 's1', 'email', otp), false)
})

test('link tokens: only the hash is stored, and it is reproducible', () => {
  const { token, hash } = core.newToken()
  assert.ok(token.length >= 40)
  assert.equal(core.tokenHash(token), hash)
  assert.notEqual(core.newToken().token, token)
})

test('envelope numbers avoid ambiguous characters', () => {
  for (let i = 0; i < 200; i++) assert.match(core.newEnvelopeNo(new Date('2026-10-27')), /^EZS-2026-[A-HJ-NP-Z2-9]{6}$/)
})

test('masking and agent description', () => {
  assert.equal(core.maskEmail('girish@gmail.com'), 'gi••••@gmail.com')
  assert.equal(core.maskAadhaar('0124'), 'XXXX XXXX 0124')
  assert.equal(core.describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'), 'Chrome 141 · macOS')
  assert.match(core.istStamp('2026-10-27T08:35:09Z'), /27 Oct 2026, 14:05:09 IST/)
})

async function samplePdf(rotate = 0) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) { const p = d.addPage([595, 842]); p.drawText(`Page ${i + 1}`, { x: 50, y: 780, size: 20, font: f }); if (rotate) p.setRotation(degrees(rotate)) }
  return d.save()
}
// 1x1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
const signer = { id: 'a1b2c3d4-0000-4000-8000-000000000000', name: 'Priya Sharma', email: 'priya@example.com', auth_method: 'EMAIL_OTP' as const, order_no: 1, status: 'SIGNED', email_verified_at: '2026-10-27T08:30:00Z', signed_at: '2026-10-27T08:35:00Z', signed_ip: '1.2.3.4', signed_user_agent: 'Chrome/141 Mac OS X' }

test('stampSignature + finalise produce a valid PDF with a certificate page', async () => {
  const src = await samplePdf()
  const stamped = await stamp.stampSignature(src, {
    fields: [{ page: 2, x: 0.6, y: 0.8, w: 0.3, h: 0.1, kind: 'SIGNATURE' }, { page: 1, x: 0.85, y: 0.92, w: 0.1, h: 0.05, kind: 'INITIALS' }, { page: 2, x: 0.1, y: 0.8, w: 0.2, h: 0.03, kind: 'DATE' }],
    signer, signaturePng: PNG, envelopeNo: 'EZS-2026-ABCDEF', signedAt: new Date('2026-10-27T08:35:00Z'),
  })
  const out = await stamp.finalise(stamped, {
    envelope: { envelope_no: 'EZS-2026-ABCDEF', title: 'Appointment letter — Priya', original_sha256: core.sha256Hex(src), created_at: '2026-10-27T08:00:00Z', completed_at: '2026-10-27T08:35:00Z', created_by_name: 'HR Head', signing_order: 'SEQUENTIAL' },
    signers: [signer], events: [{ at: '2026-10-27T08:00:00Z', action: 'CREATED', actor: 'HR Head' }, { at: '2026-10-27T08:35:00Z', action: 'SIGNED', actor: 'Priya', ip: '1.2.3.4' }],
    signatures: { [signer.id]: PNG }, verifyUrl: 'https://app.ezerhrms.com/sign/verify?id=EZS-2026-ABCDEF',
  })
  const doc = await PDFDocument.load(out)
  assert.equal(doc.getPageCount(), 3, 'two pages + one certificate page')
  assert.notEqual(core.sha256Hex(out), core.sha256Hex(src))
})

test('boxes on rotated pages still stamp without throwing', async () => {
  for (const r of [90, 180, 270]) {
    const out = await stamp.stampSignature(await samplePdf(r), { fields: [{ page: 1, x: 0.5, y: 0.5, w: 0.3, h: 0.1, kind: 'SIGNATURE' }], signer, signaturePng: PNG, envelopeNo: 'EZS-2026-ABCDEF', signedAt: new Date() })
    assert.equal((await PDFDocument.load(out)).getPageCount(), 2)
  }
})

test('activeOrder: sequential picks the lowest open, parallel lets everyone act', () => {
  const s = [{ order_no: 1, status: 'SIGNED' }, { order_no: 2, status: 'PENDING' }, { order_no: 3, status: 'WAITING' }]
  assert.equal(core.activeOrder(s, 'SEQUENTIAL'), 2)
  assert.equal(core.activeOrder(s, 'PARALLEL'), -1)
  assert.equal(core.activeOrder([{ order_no: 1, status: 'SIGNED' }], 'SEQUENTIAL'), null)
})
