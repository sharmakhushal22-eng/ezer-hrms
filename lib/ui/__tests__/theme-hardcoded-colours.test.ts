// A ratchet on colours that cannot follow the theme.
//
// Reported as: open "New MRF" while the product is in dark mode and the form
// renders light. The cause was structural rather than local — a hex literal
// resolves through nothing, so a screen built from literals stays light for
// ever while everything around it repaints.
//
// This test exists because that class of bug is invisible until somebody opens
// the right screen in the right theme, and there were 63 files carrying it.
//
// HOW THE RATCHET WORKS
//
//   * a file above its baseline  → FAIL. A regression was just added.
//   * a file below its baseline  → FAIL, asking for the number to be lowered.
//     Slightly annoying on purpose: it is what stops the list drifting upward
//     again once somebody fixes something and forgets to record it.
//   * a file absent from the baseline with any violation → FAIL. New screens
//     start clean; the debt is closed to new entrants.
//
// WHAT IT DOES NOT CLAIM
//
// A zero here does not mean a screen looks right in dark mode. It means no
// frozen colour is left in it. Contrast, gradients over images, and anything
// set outside a .tsx are beyond what static text can see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scan } from './theme-audit.ts'
import { THEME_AUDIT_BASELINE, THEME_AUDIT_TOTAL } from './theme-audit-baseline.ts'

const current = scan(['app', 'components'])

test('no file has gained a hardcoded colour', () => {
  const regressed: string[] = []
  for (const [file, n] of Object.entries(current)) {
    const allowed = THEME_AUDIT_BASELINE[file] ?? 0
    if (n > allowed) regressed.push(`  ${file}: ${allowed} → ${n}`)
  }
  assert.deepEqual(regressed, [],
    'These files gained colours that cannot follow the theme.\n' +
    'Use the tokens in lib/ui/tokens.ts (C.surface, C.ink, C.brand, …) —\n' +
    'they resolve through lib/ui/theme.css, so one attribute on <html>\n' +
    'repaints them.\n' + regressed.join('\n'))
})

test('a new file cannot introduce one at all', () => {
  const fresh = Object.keys(current).filter(f => !(f in THEME_AUDIT_BASELINE))
  assert.deepEqual(fresh, [],
    'New files must use the design tokens rather than hex literals:\n' +
    fresh.map(f => `  ${f}: ${current[f]}`).join('\n'))
})

test('the baseline is tightened when a file is fixed', () => {
  // Without this the list is a floor nobody ever lowers, and the number stops
  // meaning anything.
  const stale: string[] = []
  for (const [file, allowed] of Object.entries(THEME_AUDIT_BASELINE)) {
    const n = current[file] ?? 0
    if (n < allowed) stale.push(`  ${file}: ${allowed} → ${n}`)
  }
  assert.deepEqual(stale, [],
    'Fixed — lower these in lib/ui/__tests__/theme-audit-baseline.ts:\n' + stale.join('\n'))
})

test('the total never rises', () => {
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  assert.ok(total <= THEME_AUDIT_TOTAL,
    `Total rose from ${THEME_AUDIT_TOTAL} to ${total}.`)
})

// ── The scanner itself ─────────────────────────────────────────────────────
// It is the measuring instrument, and its first version was wrong in a way that
// looked right: it reported accurate COUNTS with fictional LINE NUMBERS,
// because stripping block comments collapsed the newlines they spanned. 97 of
// 203 files were affected. These pin the behaviour that matters.
test('a var() fallback is not a violation', async () => {
  const { countIn } = await import('./theme-audit.ts')
  // The scoped stylesheets in LeaveSection and FunZone are built this way and
  // ARE theme-aware. Counting them reported 759 problems where there were 287.
  assert.equal(countIn('background: var(--ez-surface, #FFFFFF);'), 0)
  assert.equal(countIn('color: var(--ez-ink, #1E1B4B);'), 0)
})

test('a plain hex on a colour property IS a violation', async () => {
  const { countIn } = await import('./theme-audit.ts')
  assert.equal(countIn("background: '#FFFFFF'"), 1)
  assert.equal(countIn("border: '1px solid #DDD6FE'"), 1)
})

test('a hex in a comment is not a violation', async () => {
  const { countIn } = await import('./theme-audit.ts')
  assert.equal(countIn("// onAccent, not '#fff'. White fails in dark."), 0)
  assert.equal(countIn('/* background: #FFFFFF was here */'), 0)
})

test('stripping comments does not shift the line numbers reported', async () => {
  const { violatingLines } = await import('./theme-audit.ts')
  // The exact defect: a block comment spanning lines used to collapse, so every
  // hit after it was reported too early. PunchDial pointed at a <div> when the
  // real colour was two lines further down.
  const src = [
    'const a = 1;',      // 1
    '/* a block',        // 2
    '   comment */',     // 3
    "background: '#fff'" // 4
  ].join('\n')
  assert.deepEqual(violatingLines(src), [4])
})
