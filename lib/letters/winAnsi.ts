// lib/letters/winAnsi.ts — make text printable by pdf-lib's standard fonts.
//
// HR letters are drawn with Helvetica (pdf-lib StandardFonts), which can only encode
// WinAnsi (Windows-1252). Any other character — ₹, →, ✓, an emoji — makes pdf-lib
// throw "WinAnsi cannot encode …" and the letter fails to generate. Templates are
// typed by HR in Configuration, so such characters will turn up; this swaps the common
// ones for a readable equivalent and anything else for '?', instead of failing.
//
// Pure — unit-tested in lib/letters/__tests__/winAnsi.test.ts.

const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

const SUBSTITUTE: Record<string, string> = {
  '₹': 'Rs.', '→': '->', '←': '<-', '⇒': '=>', '↔': '<->',
  '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x',
  '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '×': 'x',
  ' ': ' ', '\t': '    ', '​': '', '﻿': '',
}

export function toWinAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') { out += ch; continue }
    const c = ch.codePointAt(0)!
    if (ch in SUBSTITUTE) { out += SUBSTITUTE[ch]; continue }
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || CP1252_EXTRA.includes(ch)) { out += ch; continue }
    // Emoji and other astral characters are dropped; anything else shows as '?'.
    out += c > 0xffff ? '' : '?'
  }
  return out
}
