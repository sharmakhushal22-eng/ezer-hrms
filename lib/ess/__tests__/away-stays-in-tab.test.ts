// lib/ess/__tests__/away-stays-in-tab.test.ts — Travel & Expenses opens full
// screen, in the tab it was clicked in.
//
// WHY A TEST FOR THIS. The module is a page of its own on purpose: inside the
// portal it was a tab in a tab, with the rail and the Payroll header eating the
// viewport it needs. But "its own page" had been built as "its own BROWSER
// TAB" — target="_blank" on the rail link and window.open(away, '_blank') in
// go() — so opening it left the person holding two tabs of the same portal and
// having to keep track of which was which. Full screen and a new browser tab
// are different things; only the first was ever wanted.
//
// Nothing else can catch a regression here. Both spellings typecheck, both
// lint, both render, and both "work" — the difference is only visible to
// somebody watching their own tab bar. So this reads the portal as text and
// asserts the two shapes stay gone.
//
// It reads the component rather than importing it for the same reason
// te/icon-names does: the test runner cannot load .tsx, and the question is
// only which literals appear in it.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname
const PORTAL = `${ROOT}components/ess/EmployeePortal.tsx`
const src = () => readFileSync(PORTAL, 'utf8')

/**
 * The file with its prose removed.
 *
 * This matters more than it looks. The first version of this test failed
 * against correct code, because the comments explaining the fix say the words
 * `window.open(away, '_blank')` and `target="_blank"` out loud — describing
 * what the code used to do. A test that reads a comment as if it were code is
 * worse than no test: it fails on a file that is right, and would pass on one
 * that is wrong as long as somebody deleted the comment.
 *
 * Only whole-line `//` comments and block comments are stripped, so a `//`
 * inside a string (there are wa.me links in this file) is left alone.
 */
const code = () => src()
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trimStart().startsWith('//'))
  .join('\n')


/**
 * The body of one top-level declaration, by the code that opens it and the code
 * that opens the next one.
 *
 * Asserted at both ends on purpose. The first version of this sliced on block
 * comments as end markers — which code() has already stripped — so indexOf
 * returned -1, slice(start, -1) swallowed the rest of the file, and one
 * assertion passed only because the text it was looking for happened not to
 * appear further down. A slice whose markers are missing must fail loudly.
 */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from)
  const b = text.indexOf(to, a + 1)
  assert.notEqual(a, -1, `could not find the start of ${from}`)
  assert.notEqual(b, -1, `could not find ${to}, which should follow ${from}`)
  assert.ok(b > a, `${to} should come after ${from}`)
  return text.slice(a, b)
}

describe('the Travel & Expenses page opens in the existing tab', () => {
  it('the portal still knows the module is a page of its own', () => {
    // If this fails the premise has changed and the rest of this file is moot:
    // somebody has put the module back inside the portal, or moved its address.
    assert.match(code(), /items:\s*\[\{\s*k:\s*'expenses'[^}]*href:\s*'\/ess\/travel'/,
      'the expenses nav item should still be a page at /ess/travel')
  })

  it('never calls window.open for an away page', () => {
    // The old line was:
    //   const opened = window.open(away, '_blank', 'noopener,noreferrer')
    const go = between(code(), 'const go = (k: string', 'const goAdmin')
    assert.doesNotMatch(go, /window\.open/,
      'go() must navigate this tab, not open another one')
    assert.match(go, /window\.location\.(assign|replace)\(away\)/,
      'go() should send THIS tab to the away page')
  })

  it('leaves the portal in history for a click, so Back returns to it', () => {
    const go = between(code(), 'const go = (k: string', 'const goAdmin')
    assert.match(go, /window\.location\.assign\(away\)/,
      'a click should assign, keeping the portal in history')
  })

  it('replaces instead for an arrival nobody clicked, so Back is not trapped', () => {
    // The deep-link effect calls go() on load. With a history entry there,
    // Back lands on the address that redirects and bounces straight forward
    // again — the person cannot get out.
    const text = code()
    assert.match(text, /go\(loc\.view,\s*\{\s*replace:\s*true\s*\}\)/,
      'the deep-link effect should ask go() to replace')
    const go = between(text, 'const go = (k: string', 'const goAdmin')
    assert.match(go, /opts\?\.replace/,
      'go() should honour a replace request')
  })

  it('the rail link carries no target, so a plain click stays in the tab', () => {
    const btn = between(code(), 'function SectionButton', 'function AdminEntry')
    assert.match(btn, /<a href=\{href\}/, 'a section that is a page should still be a real link')
    assert.doesNotMatch(btn, /target=/,
      'the section link must not name a target: no target means this tab')
  })

  it('and does not promise a new tab in its tooltip', () => {
    // The TITLE the person reads, not the comments explaining the change.
    assert.doesNotMatch(code(), /opens in a new tab/,
      'nothing should tell the person it opens in a new tab any more')
  })

  it('the belt-and-braces redirect still REPLACES, which is what stops a loop', () => {
    // GoneToItsOwnPage renders when `view` somehow became 'expenses'. It must
    // replace: assign there would put the redirecting address in history and
    // Back would return to it, redirect again, and trap the person.
    const fn = between(code(), 'function GoneToItsOwnPage', 'function FeatureGrid')
    assert.match(fn, /window\.location\.replace\(href\)/,
      'the fallback redirect must replace, not assign')
  })
})
