// scripts/check-shared.mjs — the app may import the website's pure logic from lib/
// through the `@web/*` alias. This proves every such file (and everything IT
// imports) is pure: no supabase, no next/*, no react-dom, no node built-ins, no
// server-only code. A website change that makes a shared module impure fails here
// instead of failing on someone's phone.
//
//   node scripts/check-shared.mjs        (also run by `npm run check`)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '..')
const webLib = resolve(app, '../../lib')
const FORBIDDEN = [/^@supabase\//, /^next(\/|$)/, /^react-dom/, /^server-only$/, /^node:/, /^(crypto|fs|path|os|child_process|http|https|stream|zlib|buffer)$/, /^@\/lib\/supabase/, /^nodemailer/, /^pdfkit/, /^pdf-lib/]
const BROWSER_TOP_LEVEL = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:window|document|localStorage|sessionStorage)\b/m

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

const importsOf = src => [...src.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
  .map(m => ({ spec: m[3], typeOnly: !!m[2] }))
  .concat([...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => ({ spec: m[1], typeOnly: false })))

function resolveLib(fromFile, spec) {
  const base = spec.startsWith('@web/') ? join(webLib, spec.slice(5)) : spec.startsWith('@/lib/') ? join(webLib, spec.slice(6)) : resolve(dirname(fromFile), spec)
  for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

const problems = []
const seen = new Set()
function check(file, via) {
  if (seen.has(file)) return
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  if (BROWSER_TOP_LEVEL.test(src)) problems.push(`${relative(webLib, file)}: touches window/document/localStorage at module level (via ${via})`)
  for (const { spec, typeOnly } of importsOf(src)) {
    if (typeOnly) continue
    if (FORBIDDEN.some(r => r.test(spec))) { problems.push(`${relative(webLib, file)} imports "${spec}" (via ${via})`); continue }
    if (spec.startsWith('.') || spec.startsWith('@/lib/') || spec.startsWith('@web/')) {
      const r = resolveLib(file, spec)
      if (!r) problems.push(`${relative(webLib, file)}: cannot resolve "${spec}"`)
      else if (!r.startsWith(webLib)) problems.push(`${relative(webLib, file)}: "${spec}" leaves lib/`)
      else check(r, via)
    } else if (spec.startsWith('@/')) {
      problems.push(`${relative(webLib, file)} imports website code "${spec}" outside lib/ (via ${via})`)
    } else if (!['react'].includes(spec)) {
      problems.push(`${relative(webLib, file)} imports package "${spec}" — the app may not have it (via ${via})`)
    }
  }
}

let count = 0
for (const f of walk(join(app, 'src'))) {
  for (const { spec } of importsOf(readFileSync(f, 'utf8'))) {
    if (!spec.startsWith('@web/')) continue
    const r = resolveLib(f, spec)
    if (!r) { problems.push(`${relative(app, f)}: cannot resolve ${spec}`); continue }
    count++
    check(r, relative(app, f))
  }
}

if (problems.length) {
  console.error(`Shared-code check FAILED (${problems.length}):\n  ` + [...new Set(problems)].join('\n  '))
  process.exit(1)
}
console.log(`Shared-code check passed: ${count} @web imports, ${seen.size} website lib files, all pure.`)
