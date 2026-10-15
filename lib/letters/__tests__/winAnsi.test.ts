import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toWinAnsi } from '../winAnsi.ts'

test('plain letter text is unchanged, including WinAnsi punctuation', () => {
  const s = 'Dear Rajesh,\n\nYour CTC is 12,00,000 — effective “1 April” • café'
  assert.equal(toWinAnsi(s), s)
})

test('symbols pdf-lib cannot encode are replaced, not fatal', () => {
  assert.equal(toWinAnsi('₹ 5,000 → paid ✓'), 'Rs. 5,000 -> paid v')
})

test('emoji are dropped and other unknown characters become ?', () => {
  assert.equal(toWinAnsi('Welcome 🎉 नमस्ते'), 'Welcome  ??????')
})
