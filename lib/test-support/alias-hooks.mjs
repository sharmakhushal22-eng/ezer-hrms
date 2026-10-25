// lib/test-support/alias-hooks.mjs — module resolution for `node --test` runs.
//
// The test runner is plain Node with --experimental-strip-types, which knows nothing of the
// `@/` path alias tsconfig gives the app, and insists on file extensions. Source modules are
// written for the bundler (`@/lib/...`, `./ctc-model`), so a test that wants one of them
// registers these hooks first and then imports:
//
//   import { register } from 'node:module'
//   register('../../test-support/alias-hooks.mjs', import.meta.url)
//   const { thing } = await import('../thing.ts')
//
// `@/x` becomes <repo>/x; an extensionless relative or aliased path tries .ts, .tsx, .mts,
// .js and /index.ts. Nothing else changes, so modules that already import with extensions
// resolve exactly as before.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXTS = ['.ts', '.tsx', '.mts', '.js', '/index.ts']

export async function resolve(specifier, context, next) {
  let s = specifier
  if (s.startsWith('@/')) s = pathToFileURL(path.join(ROOT, s.slice(2))).href
  const relative = s.startsWith('./') || s.startsWith('../')
  if ((s.startsWith('file:') || relative) && !/\.[a-z]+$/i.test(s)) {
    const base = s.startsWith('file:') ? fileURLToPath(s) : path.resolve(path.dirname(fileURLToPath(context.parentURL)), s)
    for (const ext of EXTS) if (existsSync(base + ext)) { s = pathToFileURL(base + ext).href; break }
  }
  return next(s, context)
}
