// The chain builder is on screen and wired, not merely implemented.
//
// ── WHY THESE READ SOURCE ────────────────────────────────────────────────
//
// Node cannot load .tsx, so the alternative to source-matching is not a
// better test — it is no test. And the bug class this guards is exactly the
// one this module has already shipped once: the Config tab offered a
// frequency dropdown whose onChange only set React state, so the screen
// looked editable and saved nothing. chainBuilder.ts can be perfect and the
// feature still absent if no panel calls it.
//
// THE LIMIT, PLAINLY. A regex proves a call exists. It cannot prove the call
// runs, or that the result reaches the screen. Where that gap matters it is
// named against the assertion rather than glossed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RUNG_CHOICES } from '../chainBuilder.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** Comments and string bodies gone — six tests in this module have tripped
 *  over their own prose, and this file explains itself at length. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^\s*\/\/.*$/gm, ' ')
            .replace(/([^:])\/\/.*$/gm, '$1')
}

const RAW = read('components/pms/AdminEditor.tsx')
const EDITOR = code(RAW)
const CSS = read('components/pms/pms.css')
const CLIENT = code(read('lib/pms/adminClient.ts'))

/**
 * A named function component's body, brace-matched.
 *
 * The parameter list is skipped by PAREN depth first, which is the whole
 * subtlety: every component here destructures its props, so the first `{`
 * after the name opens `{ chains, policies, … }` and closes inside the
 * signature. Brace-matching from there returns the parameter list and nothing
 * else — which is how a first version of this file "passed" nine assertions
 * against a string containing no component body at all.
 */
function fn(name: string): string {
  const i = EDITOR.indexOf(`function ${name}(`)
  assert.notEqual(i, -1, `${name} is not in AdminEditor`)

  let paren = 0, body = -1
  for (let j = EDITOR.indexOf('(', i); j < EDITOR.length; j++) {
    if (EDITOR[j] === '(') paren++
    else if (EDITOR[j] === ')' && --paren === 0) { body = EDITOR.indexOf('{', j); break }
  }
  assert.notEqual(body, -1, `${name}'s parameter list never closes`)

  let depth = 0
  for (let j = body; j < EDITOR.length; j++) {
    if (EDITOR[j] === '{') depth++
    else if (EDITOR[j] === '}' && --depth === 0) {
      const out = EDITOR.slice(i, j + 1)
      // A body that is only the signature means the scan went wrong again.
      assert.ok(out.includes('return'), `${name}'s body did not come back`)
      return out
    }
  }
  assert.fail(`${name} never closes`)
}

// ── the tab exists and is reachable ──────────────────────────────────────

test('Approval chains is a tab in Setup & Controls', () => {
  // Requested there specifically: "all this can be controlled from admin
  // side", in the tab the HR Head authority settings already live in.
  assert.match(EDITOR, /\['chains',\s*'Approval chains'\]/,
    'the tab is not in the TABS list, so nothing can select it')
  assert.match(EDITOR, /section === 'chains'\s*&&\s*<ChainPanel/,
    'the tab exists and renders nothing')
  // And the state type admits it, or TypeScript would never allow the click.
  assert.match(EDITOR, /useState<'policy'[^>]*\|\s*'chains'/,
    "'chains' is not an allowed section")
})

test('the panel is given everything it needs to be honest', () => {
  const m = EDITOR.match(/<ChainPanel([\s\S]*?)\/>/)
  assert.ok(m, 'ChainPanel is not rendered')
  for (const prop of ['chains', 'policies', 'coverage', 'companyId', 'reload']) {
    assert.ok(m[1].includes(`${prop}=`), `ChainPanel is not given ${prop}`)
  }
})

test('the snapshot type carries the chains and the coverage', () => {
  // A field absent from the type is one the panel cannot read without a cast,
  // and a cast here would hide exactly the drift this asserts.
  assert.match(CLIENT, /chains: Record<string, unknown>\[\]/)
  assert.match(CLIENT, /coverage: Record<string, \{ have: number; of: number \}> \| null/,
    'coverage cannot express "unknown", so a failed count reads as zero')
})

// ── a policy can actually point at a chain ───────────────────────────────

test('the policy editor offers the built chains', () => {
  // WITHOUT THIS THE WHOLE FEATURE IS INERT: a chain nothing can select
  // changes nobody's appraisal. This is the Config-tab bug's exact shape.
  const p = fn('PolicyPanel')
  assert.match(p, /set\('chain_id', e\.target\.value \|\| null\)/,
    'selecting a chain does not set chain_id — or sets "" instead of null, '
    + 'which is not a valid uuid and would fail the write')
  assert.match(p, /chains\.filter\(/, 'the dropdown is not built from the chains')
  assert.match(p, /<option value="">Use the preset above<\/option>/,
    'there is no way back to a preset once a chain is chosen')
})

test('a retired chain stays visible while a policy still uses it', () => {
  // Otherwise the dropdown silently shows "Use the preset above" for a policy
  // that is in fact running a retired chain — the screen contradicting the
  // database about how people are being appraised.
  const p = fn('PolicyPanel')
  assert.match(p, /c\.is_active \|\| s\(c\.id\) === s\(draft\.chain_id\)/,
    'a retired chain in use vanishes from the policy editor')
})

test('the preset control is disabled, not hidden, while a chain is set', () => {
  // Two live controls where only one decides is the trap. Hiding it is the
  // other trap: the preset is what the policy falls back to if the chain is
  // cleared, so it has to stay readable.
  const p = fn('PolicyPanel')
  assert.match(p, /disabled=\{!!s\(draft\.chain_id\)\}/,
    'the preset dropdown still looks like it decides')
  assert.match(p, /A built chain is selected below, and that is what runs\./,
    'nothing on screen says which of the two controls wins')
})

// ── the rungs on screen are the rungs that exist ─────────────────────────

test('the menu of rungs comes from RUNG_CHOICES', () => {
  const c = fn('ChainPanel')
  assert.match(c, /RUNG_CHOICES\.filter\(c => !draft\.includes\(c\.stage\)\)/,
    'the add-a-rung list is not derived from the single menu')
  // A rung hardcoded here could offer something the database refuses.
  for (const ch of RUNG_CHOICES) {
    assert.ok(!c.includes(`'${ch.stage}'`),
      `${ch.stage} is hardcoded in the panel as well as on the menu`)
  }
})

test('the panel validates with the same function the route refuses with', () => {
  // Two validators would disagree, and the one on screen is the one that
  // shapes what somebody builds. The route still refuses independently.
  const c = fn('ChainPanel')
  assert.match(c, /chainFault\(\{ name: s\(editing\.name\), rungs: draft \}\)/)
  assert.match(c, /disabled=\{!!fault/, 'a chain with a fault can still be saved')
  assert.match(c, /\{fault && <Note tone="warn">\{fault\}<\/Note>\}/,
    'the button is disabled and nothing says why')
})

test('coverage is shown against the choice, not in a footnote', () => {
  // The number IS the warning: regional_head_id is set for nobody, and a
  // chain naming it works while doing nothing. Buried, it gets missed.
  const c = fn('ChainPanel')
  assert.match(c, /chainWarnings\(draft, coverage\)/)
  assert.match(c, /warnings\.map\(/, 'the warnings are computed and not rendered')
  assert.match(c, /cov\.have\} of \{cov\.of\} have one/,
    'the add-a-rung buttons do not carry their coverage')
})

test('an unoccupied rung is labelled on the rung itself', () => {
  const r = fn('RungRow')
  assert.match(r, /cover\.of > 0 && cover\.have === 0/,
    'a rung nobody occupies looks identical to one everybody has')
  assert.match(r, /skipped for everybody/)
  // And "of > 0" is what keeps an unknown count from reading as empty.
  assert.match(r, /cover && cover\.of > 0 && cover\.have > 0 && cover\.have < cover\.of/)
})

// ── the two fixed ends ───────────────────────────────────────────────────

test('the self rating and HR are drawn but not removable', () => {
  const c = fn('ChainPanel')
  const fixed = [...c.matchAll(/className="rung fixed"/g)]
  assert.equal(fixed.length, 2, 'the two fixed ends are not both drawn')
  assert.match(c, /always first/)
  assert.match(c, /always last/)
  // .rung.fixed must not be draggable or offer a Remove — it is drawn inline
  // rather than through RungRow, which is what makes that true.
  assert.ok(!/className="rung fixed"[\s\S]{0,400}?draggable/.test(c),
    'a fixed end is draggable')
})

test('editing a chain strips the fixed ends from the editable list', () => {
  // They are stored in rungs[] and drawn separately, so leaving them in the
  // draft would show "The employee rates themselves" twice and let somebody
  // drag HR into the middle.
  const c = fn('ChainPanel')
  assert.match(c, /\.filter\(r => r !== 'EMPLOYEE' && r !== 'HR'\)/,
    'the editable list includes the two ends')
})

// ── reordering works without a mouse ─────────────────────────────────────

test('reordering has a keyboard path, not only a drag', () => {
  // Ordering is the ONLY thing this screen is for. Behind a drag handle
  // alone it is reachable by exactly one input method.
  const r = fn('RungRow')
  assert.match(r, /onClick=\{\(\) => onMove\(idx, idx - 1\)\}/, 'no move-up button')
  assert.match(r, /onClick=\{\(\) => onMove\(idx, idx \+ 1\)\}/, 'no move-down button')
  assert.match(r, /disabled=\{idx === 0\}/, 'move-up is live on the first rung')
  assert.match(r, /disabled=\{idx === count - 1\}/, 'move-down is live on the last')
  // An arrow glyph alone is unreadable to a screen reader.
  assert.match(r, /aria-label=\{`Move \$\{choice\?\.label \?\? rung\} earlier`\}/)
  assert.match(r, /aria-label=\{`Move \$\{choice\?\.label \?\? rung\} later`\}/)
  assert.match(r, /aria-label=\{`Remove \$\{choice\?\.label \?\? rung\}`\}/)
})

test('a drag that lands on itself or nowhere does nothing', () => {
  const r = fn('RungRow')
  assert.match(r, /Number\.isInteger\(from\) && from !== idx/,
    'an empty or self drop reorders the list anyway')
  // BOTH ENDS, named separately. Asserting the key appears once passed a
  // mutation that changed setData to text/plain and left getData alone —
  // which breaks every drag while the string is still in the file.
  assert.match(r, /setData\('application\/x-pms-rung',/,
    'the drag writes an untyped payload, so any dragged text would reorder')
  assert.match(r, /getData\('application\/x-pms-rung'\)/,
    'the drop reads a different key than the drag writes')
})

test('move clamps rather than dropping a rung off either end', () => {
  // splice with a negative index inserts from the right, so an unclamped
  // move-up on the first rung silently sends it to the bottom.
  const c = fn('ChainPanel')
  assert.match(c, /next\.splice\(Math\.max\(0, Math\.min\(next\.length, to\)\), 0, r\)/,
    'a move past either end reorders unpredictably')
})

// ── the consequences are stated where the action is ──────────────────────

test('the screen says an edit does not reach appraisals already running', () => {
  // chain_shape freezes the chain per appraisal at submission. The opposite
  // is the natural assumption, and acting on it means "fixing" a live cycle.
  const c = fn('ChainPanel')
  assert.match(c, /keep the chain they\s*\n?\s*started on/,
    'nothing tells an administrator what an edit does to work in flight')
  // THE GUARD, not merely the call. Matching usedBy(...) alone passed a
  // mutation that replaced the whole condition with `false` — the call was
  // still there, inside JSX that could never render.
  assert.match(c, /\{editing\.id && usedBy\(s\(editing\.id\), policies as never\)\.length > 0 && \(/,
    'the warning does not name the policies affected, or never shows')
})

test('the list says what each chain runs as and who uses it', () => {
  const c = fn('ChainPanel')
  assert.match(c, /chainSummary\(c\.rungs as string\[\] \| null\)/,
    'a chain is listed by name alone, so its order is invisible')
  assert.match(c, /users\.length \? users\.join\(', '\) : 'no policy yet'/,
    'a chain that nothing uses looks the same as one running the company')
})

test('a chain is retired through the route, never deleted here', () => {
  const c = fn('ChainPanel')
  assert.match(c, /pmsAdmin\('chain_set_active',/)
  assert.ok(!/chain_delete|\.delete\(/.test(c), 'the panel can delete a chain')
})

test('an empty library explains that nothing has changed yet', () => {
  // Applying 218 changes no behaviour. Without saying so, an administrator
  // who opens this tab cannot tell whether it is live.
  const c = fn('ChainPanel')
  assert.match(c, /!chains\.length && \(/)
  assert.match(c, /Nothing changes until you build a chain/)
})

// ── the track is styled with tokens ──────────────────────────────────────

/**
 * A rule for exactly this selector.
 *
 * `CSS.includes('.pms .rung-no')` is true of `.pms .rung-noX` as well, so
 * renaming a selector left two of these assertions passing while the class
 * the component uses had no rule at all. The selector has to END here — at
 * whitespace, a brace, a comma or a pseudo-class.
 */
function hasRule(selector: string): boolean {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${esc}(?![\\w-])\\s*[{,:]`).test(CSS)
}

test('the track has styles, and none of them are a hex colour', () => {
  // A hex literal is white at midnight too. CLAUDE.md enforces this across
  // app/ and components/ by count; the rule applies here on its own terms.
  assert.ok(hasRule('.pms .chaintrack'),
    'the chain track has no styles, so it renders as a stack')
  for (const cls of ['.pms .rung', '.pms .rung.over', '.pms .rung.fixed',
                     '.pms .rung-no', '.pms .rung-name', '.pms .rung-grip']) {
    assert.ok(hasRule(cls), `${cls} is unstyled`)
  }
  const block = CSS.slice(CSS.indexOf('.pms .chaintrack'))
  const hex = block.match(/#[0-9a-fA-F]{3,8}\b/g)
  assert.equal(hex, null, `hardcoded colours in the chain styles: ${hex}`)
  assert.match(block, /var\(--ez-/, 'the track does not use the theme tokens')
})

test('the track survives a phone', () => {
  const block = CSS.slice(CSS.indexOf('.pms .chaintrack'))
  assert.match(block, /@media \(max-width: 560px\)/,
    'the rung controls squeeze the label off a narrow screen')
})
