// Every dropdown in the admin editor that offers a policy or a period says
// which company it belongs to.
//
// ── WHY THIS IS WORTH A TEST ─────────────────────────────────────────────
//
// Three organisations share this database and each runs its own PMS. Their
// policies are all called "Standard Quarterly" and their periods are all
// called "Q2 2026-27". A dropdown that renders the bare name offers three
// identical-looking options distinguished only by an invisible uuid.
//
// This has been fixed in components/pms/AdminEditor.tsx THREE TIMES:
//
//   1. PolicyPanel's policy picker. Its own comment records the cost:
//      "attempts to change one policy's minimum KRA count landed on three
//      different companies' policies, leaving them at 1, 5 and 2."
//   2. CyclePanel's two period pickers — "Open a period" and the window
//      editor. Opening enrols every eligible employee and cannot be undone
//      from the screen.
//   3. CyclePanel's POLICY picker, feeding "Generate a year of periods",
//      which lays a whole financial year against whichever company was
//      picked. The companyName map was already in scope for (2); only this
//      list was missed.
//
// Each fix was correct and each left the next instance standing, because
// nothing connected them. That is what this file is for: not to check a
// label, but to stop the same bug returning in a list nobody has written
// yet. A new picker added below will fail here until it is labelled too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = readFileSync(
  join(process.cwd(), 'components/pms/AdminEditor.tsx'), 'utf8')

/** Line and block comments gone. The prose in this file names the very
 *  fields the assertions forbid — the note above PolicyPanel quotes
 *  `policy_name` while explaining why it must not be rendered bare. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
}
const SRC = code(RAW)

test('the stripper really does remove the prose that names these fields', () => {
  // Without this, every assertion below could pass or fail for reasons that
  // have nothing to do with the dropdowns.
  assert.ok(/policy_name/.test(RAW), 'policy_name is not in the file at all')
  assert.ok(RAW.includes('landed on three'),
    'the PolicyPanel incident note has gone; if the history was deliberately '
    + 'removed, update this file rather than deleting the check')
  assert.ok(!/landed on three/.test(SRC),
    'the comment stripper left prose behind, so the matches below are unsafe')
})

test('no <option> renders a bare policy_name or period_name', () => {
  // The whole bug in one regex: an option element whose body is the raw
  // field rather than a label function that has seen the company.
  const bare = [...SRC.matchAll(/<option[^>]*>\s*\{[^}]*\b(policy_name|period_name)\b[^}]*\}\s*<\/option>/g)]
  assert.deepEqual(bare.map(m => m[0]), [],
    'an <option> renders a bare name. Three companies share these names, so '
    + 'this dropdown offers identical choices. Route it through a label '
    + 'function that prefixes the company, as policyLabel and periodLabel do.')
})

test('both label helpers consult the company name map', () => {
  for (const fn of ['policyLabel', 'periodLabel']) {
    // Each is defined more than once — PolicyPanel and CyclePanel keep their
    // own — so check every definition, not the first.
    const defs = [...SRC.matchAll(
      new RegExp(`const ${fn} = useCallback\\(\\(p: Row\\) => \\{([\\s\\S]*?)\\}, \\[`, 'g'))]
    assert.ok(defs.length >= 1, `${fn} is not defined in the shape this reads`)
    for (const d of defs) {
      assert.ok(/companyName\.get\(/.test(d[1]),
        `a definition of ${fn} never looks the company up, so its label `
        + `cannot distinguish one company's row from another's`)
    }
  }
})

test('CyclePanel labels its policy picker, not just its periods', () => {
  // The specific miss, named so a regression says which one broke. The panel
  // is found by its heading, which is also the user-visible wording.
  const start = SRC.indexOf('Generate a year of periods')
  assert.ok(start > 0, 'the generate-periods panel has been renamed')
  const panel = SRC.slice(start, start + 1200)
  assert.ok(/policyLabel\(p\)/.test(panel),
    '"Generate a year of periods" does not label its policy options. It '
    + 'creates a financial year of periods against the policy picked, and '
    + 'all three companies call theirs "Standard Quarterly".')
})

test('every option that names a policy or period also names the company', () => {
  // The general form, and the one that catches the NEXT instance wherever it
  // lands. Read whole <option> elements — including the multi-line ones —
  // rather than slicing map() bodies: `{s(p.id)}` ends with the same `)}`
  // that closes a map, so a slice stops before it reaches the label.
  const options = [...SRC.matchAll(/<option\b[\s\S]*?<\/option>/g)].map(m => m[0])
  assert.ok(options.length >= 6,
    `expected several <option> elements, found ${options.length} — the regex `
    + `has probably stopped matching the file's shape`)

  const NAMES  = /\b(policy_name|period_name)\b/
  const LABELS = /\b(policyLabel|periodLabel|coName|companyName\.get)\s*\(/

  const offenders = options.filter(o => NAMES.test(o) && !LABELS.test(o))
  assert.deepEqual(offenders, [],
    'an <option> shows a policy or period name without the company beside '
    + 'it. Three companies share every one of these names, so the dropdown '
    + 'offers choices nobody can tell apart.')

  // And prove the filter can fail: at least one option must have been
  // examined, or an empty list above would be meaningless.
  assert.ok(options.some(o => NAMES.test(o)),
    'no <option> mentions a policy or period name at all — if the dropdowns '
    + 'were restructured, rewrite this test rather than leaving it vacuous')
})
