// lib/te/__tests__/icon-names.test.ts — every icon a screen asks for exists.
//
// TeIcon renders `PATHS[name] ?? PATHS.info`. A name that is not in PATHS is
// therefore not an error: it quietly draws the information glyph. So a typo
// survives typecheck (the prop is `keyof typeof PATHS | string`), survives
// lint, survives the test suite, and ships as the wrong picture — which is how
// `name="edit"` got written in TeClaims.tsx for a button that had nothing to do
// with information.
//
// This reads the components as text rather than importing them: the test
// runner cannot load .tsx, and the question here is only which literal names
// appear in them.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname
const ICON = `${ROOT}components/te/TeIcon.tsx`

/** The names TeIcon can actually draw, read from its PATHS map. */
function known(): Set<string> {
  const src = readFileSync(ICON, 'utf8')
  const open = src.indexOf('PATHS')
  assert.notEqual(open, -1, 'TeIcon.tsx should define a PATHS map')
  const names = new Set<string>()
  for (const m of src.slice(open).matchAll(/^\s{2}([a-z][a-zA-Z0-9]*)\s*:/gm)) names.add(m[1])
  return names
}

/** Every .tsx under components/te. */
function screens(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`
    if (statSync(p).isDirectory()) screens(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('the icons the screens ask for', () => {
  const names = known()

  it('finds the icon set', () => {
    // If this map ever stops being readable the rest of the file would pass
    // by finding nothing, so the shape is asserted first.
    assert.ok(names.size > 20, `expected a real icon set, got ${names.size}`)
    assert.ok(names.has('info'), 'info is the fallback and must exist')
  })

  it('all exist in TeIcon', () => {
    const missing: string[] = []
    for (const file of screens(`${ROOT}components/te`)) {
      const src = readFileSync(file, 'utf8')
      // Literal names only: `name={cond ? 'a' : 'b'}` is covered because both
      // branches are literals, while a name built from data cannot be checked.
      for (const m of src.matchAll(/<TeIcon[^>]*?\bname=(?:"([a-z][a-zA-Z0-9]*)"|\{\s*'([a-z][a-zA-Z0-9]*)'\s*\})/g)) {
        const n = m[1] ?? m[2]
        if (!names.has(n)) missing.push(`${file.replace(ROOT, '')}: ${n}`)
      }
      for (const m of src.matchAll(/\bname=\{[^}]*?\?\s*'([a-z][a-zA-Z0-9]*)'\s*:\s*'([a-z][a-zA-Z0-9]*)'/g)) {
        for (const n of [m[1], m[2]]) {
          if (!names.has(n)) missing.push(`${file.replace(ROOT, '')}: ${n}`)
        }
      }
    }
    assert.deepEqual([...new Set(missing)], [], 'these icon names fall back to the info glyph')
  })
})
