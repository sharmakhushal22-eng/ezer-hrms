// scripts/sync-icons.mjs — regenerate src/ui/icons.tsx from the website's
// lib/ui/icons.tsx, so a new website icon reaches the app without redrawing it.
//   node scripts/sync-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = readFileSync(join(here, '../../../lib/ui/icons.tsx'), 'utf8')
const out = join(here, '../src/ui/icons.tsx')
const current = readFileSync(out, 'utf8')

// Keep this file's header (everything before the first icon), replace the icons.
const marker = '// --- navigation'
const head = current.slice(0, current.indexOf(marker))
let body = web.slice(web.indexOf(marker))
for (const [a, b] of [['<path', '<Path'], ['<circle', '<Circle'], ['<rect', '<Rect'], ['<ellipse', '<Ellipse']]) body = body.split(a).join(b)
writeFileSync(out, head + body)
console.log(`icons: ${(body.match(/export const Icon/g) || []).length} written to src/ui/icons.tsx`)
