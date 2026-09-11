import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// Two ways this app silently overrides a component's own stylesheet.

// 1. Tailwind is imported in app/globals.css, so any BARE utility name used as
//    a class gets that utility's declarations. `ring` is the one that bit us:
//    it paints --tw-ring-shadow in currentColor, and on a div with no radius
//    that is a hard square around every progress circle. Our stylesheet never
//    set box-shadow, so it had nothing to win with.
const TAILWIND_BARE = new Set([
  'ring', 'shadow', 'border', 'outline', 'blur', 'grayscale', 'invert', 'sepia',
  'underline', 'overline', 'truncate', 'italic', 'uppercase', 'lowercase',
  'capitalize', 'hidden', 'block', 'inline', 'flex', 'grid', 'table', 'contents',
  'isolate', 'static', 'fixed', 'absolute', 'relative', 'sticky', 'visible',
  'invisible', 'antialiased', 'filter', 'rounded', 'container', 'sr-only',
])

const FILES = [
  ...readdirSync('components/ess/today').filter(f => f.endsWith('.tsx')).map(f => `components/ess/today/${f}`),
  ...readdirSync('components/profile').filter(f => f.endsWith('.tsx')).map(f => `components/profile/${f}`),
]

test('the scan covers real files', () => {
  assert.ok(FILES.length > 12, `only ${FILES.length} files — the scan broke`)
})

test('no class name collides with a bare Tailwind utility', () => {
  const bad: string[] = []
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)) {
      const line = src.slice(0, m.index).split('\n').length
      for (const cls of (m[1] ?? m[2] ?? '').split(/\s+/).filter(Boolean))
        if (TAILWIND_BARE.has(cls)) bad.push(`${f}:${line} uses "${cls}"`)
    }
  }
  assert.deepEqual(bad, [], `Tailwind will style these:\n  ${bad.join('\n  ')}`)
})

test('the collision check can still see a collision', () => {
  // Guards the matcher: if the regex stopped matching, the test above would
  // pass over any file at all.
  const sample = `<div className="ez-ring ring tile">`
  const found = [...sample.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)]
    .flatMap(m => (m[1] ?? '').split(/\s+/)).filter(c => TAILWIND_BARE.has(c))
  assert.deepEqual(found, ['ring'])
})

// 2. lib/ui/index.tsx squares off every <button> with !important. Any circular
//    or pill control in the Today tab has to re-assert its radius, or it
//    renders as a 10px rounded rectangle — which is what made the punch dial
//    "square" inside its own round ring.
test('the punch dial re-asserts its radius over the global button rule', () => {
  const css = readFileSync('components/ess/today/today.css', 'utf8')
  assert.match(css, /\.ezt \.punch\s*\{[^}]*border-radius:\s*50%\s*!important/,
    'the global button{border-radius:!important} will square the dial again')
  const global = readFileSync('lib/ui/index.tsx', 'utf8')
  assert.match(global, /button\s*\{[^}]*border-radius:[^;]*!important/,
    'if this rule is gone, the !important above is no longer needed')
})
