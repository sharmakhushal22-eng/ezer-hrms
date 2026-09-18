// scripts/build-fz-styles.mjs — design/funzone.css → components/funzone/fzStyles.ts
//
// The stylesheet is written once, as CSS. The app gets it as a string so
// <FunZone/> can inject it without a global import. Run after any CSS edit:
//
//   node scripts/build-fz-styles.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'design/funzone.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')      // comments stay in the .css, not the bundle
  .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim()

writeFileSync(join(root, 'components/funzone/fzStyles.ts'),
`// GENERATED from design/funzone.css by scripts/build-fz-styles.mjs — do not edit.
// Edit the .css and run: node scripts/build-fz-styles.mjs
export const FZ_CSS = ${JSON.stringify(css)}
`)
console.log(`fzStyles.ts written (${css.length} chars)`)
