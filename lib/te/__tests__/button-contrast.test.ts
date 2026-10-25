// lib/te/__tests__/button-contrast.test.ts — the label on a filled button is
// readable, in both themes, and the cascade actually delivers the fill the
// stylesheet appears to promise.
//
// WHY THIS EXISTS. The on-a-trip card's two actions were reported as badly
// contrasted twice before anybody measured them. The first report was a real
// bug of the worst kind — the secondary button's background was the SAME token
// as the card it sat on, so it had no edge at all — and the second was subtler:
// the fills passed AA by two thirds of a point, which on a 14px semibold label
// across an 84px target is what "bad contrast" looks like to the eye even
// though a checker says pass.
//
// Both were invisible to every other check in the repo. The type checker does
// not read CSS. The colour ratchet counts hex literals and these are all
// tokens. The CSS-collision test looks for duplicate selectors. `next build`
// parses the file but has no opinion about whether anybody can read it.
//
// So this computes it: resolve the cascade for the real selectors, read the
// real token values for light and dark, and assert WCAG ratios.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname
const CSS = readFileSync(`${ROOT}components/te/te.css`, 'utf8')
const THEME = readFileSync(`${ROOT}lib/ui/theme.css`, 'utf8')

// ── tokens ──────────────────────────────────────────────────────────────────
/** A token's value in one theme. The dark blocks come after the light :root,
 *  so "the last definition on the side we want" is the effective one. */
const DARK_AT = THEME.indexOf('prefers-color-scheme: dark')
function token(name: string, dark: boolean): string {
  const re = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g')
  let m: RegExpExecArray | null, found: string | null = null
  while ((m = re.exec(THEME))) if ((m.index > DARK_AT) === dark) found = m[1]
  assert.ok(found, `--${name} should be defined for the ${dark ? 'dark' : 'light'} theme`)
  return found!
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const mix = (a: string, b: string, keep: number) =>
  '#' + rgb(a).map((v, i) => Math.round(v * keep + rgb(b)[i] * (1 - keep)).toString(16).padStart(2, '0')).join('')
function luminance(hex: string): number {
  const c = rgb(hex).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── the cascade ─────────────────────────────────────────────────────────────
interface Rule { selector: string; decls: string; order: number }
/** Every rule in te.css, in source order. Comments stripped first so a
 *  commented-out rule is not read as a live one. */
function rules(): Rule[] {
  const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null, n = 0
  while ((m = re.exec(src))) {
    for (const sel of m[1].split(',')) out.push({ selector: sel.trim(), decls: m[2], order: n++ })
  }
  return out
}

/** Class-level specificity: classes plus pseudo-classes. Enough here — every
 *  selector in this file is classes, and none uses an id or !important. */
const specificity = (sel: string) =>
  (sel.match(/\.[A-Za-z][\w-]*/g) ?? []).length + (sel.match(/:(hover|active|focus-visible|disabled)/g) ?? []).length

/** Does this selector apply to an element carrying exactly these classes,
 *  with the given pseudo-state? Only the simple descendant forms this file
 *  uses are understood, which is all of them. */
function matches(sel: string, classes: string[], pseudo: string | null): boolean {
  if (/\[|>|\+|~|\bsvg\b|::/.test(sel)) return false
  const parts = sel.split(/\s+/).filter(Boolean)
  // every part must be a class chain the element or an ancestor carries; the
  // LAST part must be the element itself
  const last = parts[parts.length - 1]
  const want = last.split(':')[0].split('.').filter(Boolean)
  const pseudos = (last.match(/:(hover|active|focus-visible|disabled)/g) ?? []).map(p => p.slice(1))
  if (pseudos.length && (!pseudo || !pseudos.includes(pseudo))) return false
  if (!want.every(c => classes.includes(c))) return false
  // ancestors: ".te" is the root wrapper, always present
  return parts.slice(0, -1).every(p => p.split('.').filter(Boolean).every(c => c === 'te' || classes.includes(c)))
}

/** The winning value of one property for an element with these classes. */
function resolve(prop: string, classes: string[], pseudo: string | null = null): string | null {
  const hits = rules()
    .filter(r => matches(r.selector, classes, pseudo))
    .map(r => {
      const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g')
      let m: RegExpExecArray | null, v: string | null = null
      while ((m = re.exec(r.decls))) v = m[1].trim()
      return v ? { ...r, value: v } : null
    })
    .filter((r): r is Rule & { value: string } => !!r)
  if (!hits.length) return null
  hits.sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order)
  return hits[hits.length - 1].value
}

/** Turn a resolved CSS value into a hex, following var() and color-mix(). */
function paint(value: string, dark: boolean): string {
  const v = value.trim()
  let m = v.match(/^var\(--(ez-[\w-]+)\)$/)
  if (m) return token(m[1], dark)
  m = v.match(/^color-mix\(in srgb,\s*var\(--(ez-[\w-]+)\)\s*(\d+)%\s*,\s*var\(--(ez-[\w-]+)\)\s*\)$/)
  if (m) return mix(token(m[1], dark), token(m[3], dark), Number(m[2]) / 100)
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v
  assert.fail(`cannot work out the colour of "${value}"`)
}

const AA = 4.5, AAA = 7
/** The two hero actions on the on-a-trip card. */
const HERO = [
  { name: 'Add a bill', classes: ['te', 'btn', 'pri', 'big'] },
  { name: 'Add a journey', classes: ['te', 'btn', 'pos', 'big'] },
]

describe('the hero buttons’ labels are readable', () => {
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light'
    for (const btn of HERO) {
      for (const pseudo of [null, 'hover'] as const) {
        const state = pseudo ?? 'at rest'
        it(`${btn.name}, ${theme}, ${state} — AAA`, () => {
          const bg = resolve('background', btn.classes, pseudo)
          const fg = resolve('color', btn.classes, pseudo)
          assert.ok(bg, 'the cascade should give it a background')
          assert.ok(fg, 'the cascade should give it a text colour')
          const r = contrast(paint(fg!, dark), paint(bg!, dark))
          assert.ok(r >= AAA,
            `${btn.name} ${theme} ${state}: label ${paint(fg!, dark)} on ${paint(bg!, dark)} is ${r.toFixed(2)}, wanted ${AAA}`)
        })
      }
    }
  }
})

describe('the hero buttons are visible against the card they sit on', () => {
  // THE FIRST BUG. .btn.ok's background was the same --ez-positive-tint as
  // .ontrip, so the button had no edge of its own at all: 1.00.
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light'
    it(`neither shares the card's background — ${theme}`, () => {
      const card = resolve('background', ['te', 'card', 'ontrip']) ?? 'var(--ez-surface)'
      for (const btn of HERO) {
        const bg = resolve('background', btn.classes)
        const r = contrast(paint(bg!, dark), paint(card, dark))
        assert.ok(r >= 3,
          `${btn.name} is ${r.toFixed(2)} against the card in ${theme} — a filled button needs to read as one`)
      }
    })
  }

  it('the card itself no longer paints a wash that its buttons can match', () => {
    const card = resolve('background', ['te', 'card', 'ontrip'])
    assert.ok(card === null || !/positive-tint/.test(card),
      'a tinted card is what let a tinted button vanish into it')
  })
})

describe('the pair is one species', () => {
  it('both are filled, and both carry the same size class', () => {
    for (const btn of HERO) {
      assert.ok(resolve('background', btn.classes), `${btn.name} should have a fill`)
      assert.ok(btn.classes.includes('big'))
    }
  })

  it('no standalone .btn.ok rule paints a background', () => {
    // It reached into TeDrafts, whose "Keep them" is `btn ok glow` and had
    // always taken .btn's own surface.
    const bg = resolve('background', ['te', 'btn', 'ok', 'glow'])
    assert.ok(!bg || !/positive-tint/.test(bg),
      '`ok` should mean glow tokens only, not a green fill')
  })
})
