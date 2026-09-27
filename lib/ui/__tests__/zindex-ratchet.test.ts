// A ratchet on raw z-index numbers, and a check that the scale stays coherent.
//
// Reported as: open the "People" menu in the ESS nav bar and the page's own tab
// row paints over the open dropdown.
//
// The menu was not the problem. The nav bar was z-index 25; the recruitment
// page's sticky header was 30. They are siblings in one stacking context, so
// the page won — and it took the dropdown with it, because the dropdown is a
// DESCENDANT of the bar and therefore never competes on its own value. Its
// z-index of 40 was irrelevant. Raising it would have fixed nothing, which is
// the trap: the obvious move is the wrong one.
//
// So this tests two different things:
//   1. the SCALE is internally ordered and correct — a unit test of Z;
//   2. no NEW raw number appears — a ratchet, same shape as the colour one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Z } from '../tokens.ts'
import { scan } from './zindex-audit.ts'
import { ZINDEX_BASELINE, ZINDEX_TOTAL } from './zindex-baseline.ts'

// ── The scale ──────────────────────────────────────────────────────────────
test('the nav bar sits above a page’s own sticky header', () => {
  // The reported bug, as an assertion. If these ever invert again, the nav
  // menu disappears behind page content.
  assert.ok(Z.nav > Z.sticky, `nav (${Z.nav}) must exceed sticky (${Z.sticky})`)
})

test('a nav menu clears the bar it hangs from', () => {
  assert.ok(Z.navMenu > Z.nav)
})

test('the ladder only ever goes up', () => {
  const order = ['base', 'raised', 'sticky', 'nav', 'navMenu', 'drawer', 'overlay', 'modal', 'toast', 'dock', 'screenFilter'] as const
  const values = order.map(k => Z[k])
  assert.deepEqual(values, [...values].sort((a, b) => a - b),
    'Z is out of order: ' + order.map((k, i) => `${k}=${values[i]}`).join(' '))
  assert.equal(new Set(values).size, values.length, 'two tiers share a value, so their order is undefined')
})

test('a focused surface covers the nav, and a toast covers the dialog', () => {
  // A drawer or modal is a focused task and should obscure navigation.
  assert.ok(Z.drawer > Z.navMenu)
  assert.ok(Z.modal > Z.overlay)
  // A toast reporting a failure inside a dialog is useless underneath it.
  assert.ok(Z.toast > Z.modal)
})

test('the display controls stay reachable, and the screen filter is on top', () => {
  assert.ok(Z.dock > Z.toast)
  // EyeComfort tints the whole interface including the dock. Deliberate.
  assert.ok(Z.screenFilter > Z.dock)
})

// ── The ratchet ────────────────────────────────────────────────────────────
const current = scan(['app', 'components', 'lib'])

test('no file has gained a raw z-index', () => {
  const regressed: string[] = []
  for (const [file, n] of Object.entries(current)) {
    const allowed: number = ZINDEX_BASELINE[file] ?? 0
    if (n > allowed) regressed.push(`  ${file}: ${allowed} → ${n}`)
  }
  assert.deepEqual(regressed, [],
    'Use the scale in lib/ui/tokens.ts — `zIndex: Z.modal`, not a number.\n' +
    'A raw value can only be chosen by looking at what is currently on top,\n' +
    'which is how this repo reached 37 of them.\n' + regressed.join('\n'))
})

test('a new file cannot introduce one at all', () => {
  const fresh = Object.keys(current).filter(f => !(f in ZINDEX_BASELINE))
  assert.deepEqual(fresh, [],
    'New files must use Z from lib/ui/tokens.ts:\n' +
    fresh.map(f => `  ${f}: ${current[f]}`).join('\n'))
})

test('the baseline is tightened when a file is converted', () => {
  const stale: string[] = []
  for (const [file, allowed] of Object.entries(ZINDEX_BASELINE)) {
    const n = current[file] ?? 0
    if (n < allowed) stale.push(`  ${file}: ${allowed} → ${n}`)
  }
  assert.deepEqual(stale, [],
    'Converted — lower these in lib/ui/__tests__/zindex-baseline.ts:\n' + stale.join('\n'))
})

test('the total never rises', () => {
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  assert.ok(total <= ZINDEX_TOTAL, `Total rose from ${ZINDEX_TOTAL} to ${total}.`)
})

// ── The scanner ────────────────────────────────────────────────────────────
test('a scale reference is not a violation', async () => {
  const { countIn } = await import('./zindex-audit.ts')
  assert.equal(countIn('zIndex: Z.nav'), 0)
  assert.equal(countIn('zIndex: Z.modal,'), 0)
})

test('a raw number IS a violation, whatever its size', async () => {
  const { countIn } = await import('./zindex-audit.ts')
  assert.equal(countIn('zIndex: 40'), 1)
  assert.equal(countIn('z-index:1'), 1)
  assert.equal(countIn('zIndex: 2147483000'), 1)
})

test('a z-index in a comment is not a violation, and lines do not shift', async () => {
  const { countIn, violatingLines } = await import('./zindex-audit.ts')
  assert.equal(countIn('// was zIndex: 25, which lost to the page header'), 0)
  const src = ['const a = 1;', '/* block', '   comment */', 'zIndex: 30'].join('\n')
  assert.deepEqual(violatingLines(src), [4])
})
