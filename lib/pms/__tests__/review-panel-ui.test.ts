// The review panel — "Review & send on" — as a thing somebody works through.
//
// WHAT WAS WRONG, MEASURED IN THE BROWSER BEFORE ANY OF IT WAS CHANGED:
//
//   panel height          1900px
//   viewport               722px
//   KRAs in that panel         4   (the policy allows ten)
//   distance to the button  1900px
//
// Two and a half screens for four KRAs, and roughly five for a full set —
// with the only control, and every word explaining why it was disabled, at
// the bottom of all of it. Three things made it long and none was content:
// five stacked labels per KRA repeated down the page, the two numbers being
// compared sitting ~100px apart with prose between them, and no way to put
// anything away once it was done.
//
// After: 1723px, and 994px once the finished KRAs are folded — one click.
//
// THE ONE RULE HERE THAT IS NOT COSMETIC is the definition of "done".
// Folding hides a card. If "done" meant merely "rated", the fold button
// would hide a KRA whose unexplained difference is blocking the approval,
// and the reviewer would be left looking at a disabled button with the
// reason for it folded out of sight. It must mean rated AND explained —
// the same two conditions the approval gate checks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareRatings } from '../scoring.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MGR = read('components/pms/ManagerTabs.tsx')
const CSS = read('components/pms/pms.css')

const PANEL = MGR.slice(MGR.indexOf('export function KraDetail'),
                        MGR.indexOf('// ── §4.3 Rate My Team'))


/**
 * One CSS rule's body, comments stripped.
 *
 * Slicing a fixed number of characters after the selector kept breaking as
 * explanatory comments were added inside the rule — the declaration was
 * still there, the window just stopped reaching it. This reads to the
 * closing brace instead.
 */
function cssRule(sel: string): string {
  // COMMENTS COME OUT FIRST, and that is not tidiness. The .xclose rule's
  // own comment contains the text `button { border-radius: 10px !important
  // }` — the global rule it exists to explain — so brace-matching on the
  // raw file ended the rule inside its own explanation and the test failed
  // against correct CSS.
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const i = bare.indexOf(sel + ' {')
  assert.ok(i >= 0, `no rule for ${sel}`)
  return bare.slice(i + sel.length + 2, bare.indexOf('}', i))
}

/** The body of one component, from its declaration to the next one. */
function body(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`)
  assert.ok(i > 0, `${name} is gone — this test needs updating`)
  const ends = [src.indexOf('\nfunction ', i + 10), src.indexOf('\nexport ', i + 10)]
    .filter(x => x > 0)
  return src.slice(i, ends.length ? Math.min(...ends) : src.length)
}

// ── "done", the rule folding depends on ──────────────────────────────────

test('done means rated AND explained, not merely rated', () => {
  const m = PANEL.match(/const doneIds = [\s\S]{0,260}?\.map\(l => l\.goalId\)/)
  assert.ok(m, 'the done set moved; this test needs updating')
  assert.match(m![0], /l\.mine != null/, 'a KRA with no rating can count as done')
  assert.match(m![0], /!\(l\.needsReason && !l\.hasReason\)/,
    'an unexplained difference can count as done, so folding would hide a blocker')
})

test('the fold set and the approval gate agree about what is outstanding', () => {
  // Proved against the real comparison rather than the source: anything the
  // gate still objects to must not be foldable.
  const rows = [
    { goalId: 'a', title: '1. a', weightage: 25, self: 5, mine: 5, comment: '' },
    { goalId: 'b', title: '2. b', weightage: 25, self: 5, mine: 3, comment: '' },
    { goalId: 'c', title: '3. c', weightage: 25, self: 5, mine: 3, comment: 'slipped' },
    { goalId: 'd', title: '4. d', weightage: 25, self: 5, mine: null, comment: '' },
  ]
  const s = compareRatings(rows)
  // The same expression the panel uses.
  const done = s.lines.filter(l => l.mine != null && !(l.needsReason && !l.hasReason))
                      .map(l => l.goalId)
  assert.deepEqual(done, ['a', 'c'],
    'the foldable set includes a KRA the approval gate is still blocking on')
  for (const blocked of s.missingReasons.map(l => l.goalId)) {
    assert.ok(!done.includes(blocked),
      `${blocked} needs a reason and would be folded out of sight`)
  }
})

test('nothing folds itself', () => {
  // Folding on completion sounds helpful and is not: the completing
  // keystroke is the last character of the reason, so the card would
  // collapse under the cursor mid-sentence.
  // The panel DOES have an effect now — Escape-to-close — so the rule is
  // not "no effects", it is that no effect touches the fold state.
  for (const m of PANEL.matchAll(/useEffect\(/g)) {
    const eff = PANEL.slice(m.index!, m.index! + 900)
    assert.ok(!/setFolded|[^.\w]fold\(/.test(eff),
      `an effect folds cards: …${eff.slice(0, 120)}`)
  }
  // Every fold goes through one of two places, and both are click handlers.
  const calls = [...PANEL.matchAll(/setFolded\(/g)].map(m => m.index!)
  assert.ok(calls.length > 0, 'nothing can fold at all')
  for (const i of calls) {
    const before = PANEL.slice(Math.max(0, i - 220), i)
    assert.ok(/onClick|const fold = /.test(before),
      `a fold at offset ${i} is not behind a click: …${before.slice(-90)}`)
  }
  // And `fold` itself, the per-card setter, is only ever called from a
  // click handler or from jump() — never from render.
  const foldCalls = [...PANEL.matchAll(/[^.\w]fold\(/g)].map(m => m.index!)
  for (const i of foldCalls) {
    const before = PANEL.slice(Math.max(0, i - 160), i)
    assert.ok(/onClick|const jump|const fold = /.test(before),
      `fold() at offset ${i} is called outside a handler: …${before.slice(-90)}`)
  }
})

test('the fold button says how many it will fold', () => {
  // "Collapse all" on a screen where some cards are still owed is a button
  // whose effect you discover by pressing it.
  assert.match(PANEL, /Hide the \{foldableLeft\} done/,
    'the fold control does not name its own effect')
  assert.match(PANEL, /foldableLeft > 0 &&/,
    'the fold control shows even when there is nothing to fold')
})

test('a folded card still carries the judgement', () => {
  // Folding may lose the evidence. It must not lose the decision, or the
  // reviewer cannot check their own work without unfolding everything.
  const f = PANEL.slice(PANEL.indexOf('className="kfold"'), PANEL.indexOf('className="kfold"') + 900)
  assert.match(f, /They said/, 'the folded row does not show their rating')
  assert.match(f, /You said/, 'the folded row does not show yours')
  assert.match(f, /c\?\.delta != null && c\.delta !== 0/,
    'the folded row does not show the difference')
})

// ── the two numbers, adjacent ────────────────────────────────────────────

test('their rating and yours are in one row', () => {
  // They used to sit ~100px apart with the achievement text between them,
  // when comparing them IS the task.
  assert.match(PANEL, /className="vs2"/, 'the comparison row is gone')
  const row = PANEL.slice(PANEL.indexOf('className="vs2"'),
                          PANEL.indexOf('className="vs2"') + 3000)
  assert.ok(row.indexOf('They rated themselves') < row.indexOf('Your rating'),
    'their rating does not lead the comparison row')
  assert.match(row, /<RatingChips/,
    'the rating control is not in the comparison row')
})

test('their band is named too, not only yours', () => {
  // A 5 means nothing without "Outstanding" beside it, in either column.
  assert.match(PANEL, /const bl = l\.selfRating == null \? null : bandFor\(l\.selfRating, bands\)/,
    'the employee\'s own rating is shown as a bare digit')
})

// ── the header ───────────────────────────────────────────────────────────

test('the panel opens by saying who, which rung, and how the scores stand', () => {
  const h = PANEL.slice(PANEL.indexOf('className="phead"'),
                        PANEL.indexOf('className="phead"') + 2200)
  assert.match(h, /initials\(member\.name\)/, 'no person on the header')
  assert.match(h, /You are <b>\{STAGE_SHORT\[myRung\]\}<\/b> on this/,
    'the header does not say which rung the viewer holds')
  assert.match(h, /They said/, 'the header does not carry their score')
  assert.match(h, /You say/, 'the header does not carry yours')
})

test('the finalising rung is told so before it starts, not after', () => {
  const h = PANEL.slice(PANEL.indexOf('className="phead"'),
                        PANEL.indexOf('className="phead"') + 2200)
  assert.match(h, /Yours is the last review/,
    'the header does not warn the rung that settles the rating')
})

test('the three totals are not shown twice on one screen', () => {
  // They moved to the header, where they are visible BEFORE the first KRA
  // rather than after the last. Leaving them in the summary card as well
  // made the panel longer and told the reader nothing new.
  const sum = MGR.slice(MGR.indexOf('function RatingSummary'),
                        MGR.indexOf('export interface KraLine'))
  assert.ok(!/<Stat label="They rated themselves"/.test(sum),
    'the summary card repeats the totals the header already shows')
  // The line-by-line table is the reason that card still exists.
  assert.match(sum, /<th>KRA<\/th>/, 'the summary card lost its table')
})

// ── navigation ───────────────────────────────────────────────────────────

test('there is one jump chip per KRA, coloured by state', () => {
  const n = PANEL.slice(PANEL.indexOf('className="ksteps"'),
                        PANEL.indexOf('className="ksteps"') + 1200)
  assert.match(n, /cmp\.lines\.map/, 'the chips are not one per KRA')
  assert.match(n, /kstep\$\{done \? ' done' : needs \? ' needs' : ''\}/,
    'the chips do not show which KRAs still need work')
  assert.match(n, /onClick=\{\(\) => jump\(l\.goalId\)\}/, 'the chips do not navigate')
})

test('jumping to a folded KRA unfolds it first', () => {
  // Otherwise the scroll lands on a collapsed row and the reviewer is told
  // to fix something they cannot see.
  const j = PANEL.slice(PANEL.indexOf('const jump = '), PANEL.indexOf('const jump = ') + 700)
  assert.match(j, /fold\(goalId, false\)/, 'jumping does not unfold the target')
  assert.match(j, /block: 'center'/,
    'the target is scrolled to the viewport edge rather than into view')
})

// ── the action bar ───────────────────────────────────────────────────────

test('the action is pinned, not buried', () => {
  assert.match(CSS, /\.actionbar \{[^}]*position: sticky[^}]*bottom: 0/,
    'the action bar does not stay on screen')
  assert.match(PANEL, /className="actionbar"/, 'there is no action bar')
})

test('the bar says why it is refusing, beside the button it refuses on', () => {
  // "Not ready to send on" with the explanation 1900px up is a refusal
  // without a reason.
  const b = PANEL.slice(PANEL.indexOf('className="blockers"'),
                        PANEL.indexOf('className="blockers"') + 900)
  assert.match(b, /still unrated/)
  assert.match(b, /need\{cmp\.missingReasons\.length === 1 \? 's' : ''\} a reason/,
    'the reason blocker does not agree in number — "1 need a reason"')
  assert.match(b, /Confirm the one-to-one/)
  assert.match(b, /Final rating missing/)
})

test('the blockers are shown only when there are some', () => {
  assert.match(PANEL, /\{!ready && \(\s*\n\s*<div className="blockers">/,
    'the blocker strip renders even when nothing is blocking')
})

test('the final rating still sits with the act that uses it', () => {
  // pms_finalise takes it explicitly and refuses without it, so it belongs
  // next to the button, not in a queue cell.
  assert.match(PANEL, /\{finalises && \(\s*\n\s*<div className="fld"/,
    'the final rating field moved away from the finalising action')
  assert.match(PANEL, /<select id="pf-final"/)
})

// ── length ───────────────────────────────────────────────────────────────

test('the evidence is rows, not five stacked label blocks', () => {
  // Twenty label rows for four KRAs was most of the panel's height and none
  // of its information.
  assert.match(PANEL, /className="ev"/, 'the evidence block is gone')
  assert.match(CSS, /\.ev \.row \{[^}]*grid-template-columns: 116px 1fr/,
    'the evidence is not laid out as label-and-value rows')
  assert.match(CSS, /max-width: 560px\)[\s\S]{0,120}\.ev \.row \{ grid-template-columns: 1fr/,
    'the evidence rows do not stack on a narrow screen')
})

// ── the way out ──────────────────────────────────────────────────────────

test('there is a close control in the corner, not only at the bottom', () => {
  // The action bar's Close is pinned, but people look for a × in the top
  // right of a panel, and this one is 1900px tall unfolded.
  assert.match(PANEL, /className="xclose"/, 'there is no corner close')
  assert.match(cssRule('.pms .xclose'), /position: absolute; top: 12px; right: 12px/,
    'the close control is not in the corner')
})

test('the close control is red and glows', () => {
  // It is the only control on this panel that throws work away.
  assert.match(cssRule('.pms .xclose'), /color: var\(--ez-critical\)/,
    'the close control is not red')
  // ROUND, and it has to say so with !important: UIKeyframes injects
  // `button { border-radius: 10px !important }` at runtime, which outranks
  // anything in this stylesheet. MEASURED in the browser — without this the
  // requested round button renders as a rounded square and nothing fails.
  assert.match(cssRule('.pms .xclose'), /border-radius: 50% !important/,
    'the close control is not round — the global button radius wins')
  assert.match(CSS, /\.xclose:hover \{[^}]*box-shadow: 0 0 0 4px var\(--ez-critical-tint\),\s*\n?\s*0 0 14px 2px var\(--ez-critical\)/,
    'the close control does not glow on hover')
  // Keyboard users get the glow too, or the affordance is mouse-only.
  assert.match(CSS, /\.xclose:focus-visible \{[^}]*box-shadow/,
    'the glow is not shown on keyboard focus')
})

test('the glow uses the token scale, not a raw z-index', () => {
  assert.match(cssRule('.pms .xclose'), /z-index: var\(--ez-z-local-1\)/,
    'the close control uses a raw z-index')
  assert.match(cssRule('.pms .closeask'), /z-index: var\(--ez-z-local-2\)/,
    'the confirmation uses a raw z-index')
})

test('closing asks first, but only when there is work to lose', () => {
  // A confirmation on an untouched panel is a dialog that teaches people to
  // dismiss dialogs.
  assert.match(PANEL, /const unsaved = cmp\.lines\.filter\(l => l\.mine != null \|\| l\.hasReason\)\.length/,
    'the panel does not know how much work closing would lose')
  assert.match(PANEL, /const tryClose = \(\) => \(unsaved > 0 && rating \? setAsking\(true\) : close\(\)\)/,
    'closing either always asks or never asks')
})

test('both ways out go through the same guard', () => {
  // Two exits that behave differently about losing work is worse than one.
  const bar = PANEL.slice(PANEL.indexOf('className="actionbar"'),
                          PANEL.indexOf('className="actionbar"') + 2200)
  assert.match(bar, /onClick=\{tryClose\}/,
    'the action bar close skips the unsaved-work guard')
  assert.match(PANEL, /className="xclose" onClick=\{tryClose\}/,
    'the corner close skips the unsaved-work guard')
})

test('Escape closes it, through the guard', () => {
  assert.match(PANEL, /e\.key !== 'Escape'/, 'Escape does not close the panel')
  const eff = PANEL.slice(PANEL.indexOf("e.key !== 'Escape'") - 400,
                          PANEL.indexOf("e.key !== 'Escape'") + 400)
  assert.match(eff, /if \(asking\) setAsking\(false\)\s*\n?\s*else tryClose\(\)/,
    'Escape can discard work directly instead of going through the guard')
})

test('the confirmation is inline, not a browser dialog', () => {
  // confirm() blocks the page, cannot be styled, and speaks in the
  // browser's language about an appraisal somebody just spent five minutes
  // on. It is also untestable and unstyleable in dark mode.
  assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(PANEL),
    'the panel uses a browser confirm dialog')
  assert.match(PANEL, /className="closeask" role="alertdialog"/,
    'the confirmation is not announced as a dialog')
  assert.match(PANEL, /Keep editing/, 'there is no way to back out of closing')
})

test('the safe choice is the one that has focus', () => {
  // Enter on an alertdialog should not be able to destroy work.
  const ask = PANEL.slice(PANEL.indexOf('className="closeask"'),
                          PANEL.indexOf('className="closeask"') + 1400)
  const discard = ask.indexOf('>\n              Discard')
  const keep = ask.indexOf('autoFocus')
  assert.ok(keep > 0, 'nothing is focused when the question appears')
  assert.ok(keep > discard, 'autoFocus is on Discard rather than Keep editing')
})

// ── the keyboard ─────────────────────────────────────────────────────────

test('the rating group is one tab stop, not five', () => {
  // Five tab stops per KRA is twenty to cross a set of four before you
  // reach the first reason box — and role="radiogroup" promises otherwise.
  const c = body(MGR, 'RatingChips')
  assert.match(c, /tabIndex=\{i === stop \? 0 : -1\}/,
    'every chip is its own tab stop')
  assert.match(c, /const stop = idx < 0 \? 0 : idx/,
    'an unrated group has no way in from the keyboard')
})

test('the arrows move and select, as native radios do', () => {
  const c = body(MGR, 'RatingChips')
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) {
    assert.ok(c.includes(k), `the rating group ignores ${k}`)
  }
  assert.match(c, /onPick\(bands\[i\]\.value\)/,
    'moving through the group does not change the value')
})

test('arrowing off either end stays in the group', () => {
  // Clamped, not wrapped: wrapping from "Outstanding" to "Unsatisfactory"
  // on one keypress is a rating nobody meant to give.
  assert.match(body(MGR, 'RatingChips'),
    /Math\.max\(0, Math\.min\(bands\.length - 1, to\)\)/,
    'the arrows wrap around or run off the end of the scale')
})

test('the scale comes from the policy, not from 1..5', () => {
  const c = body(MGR, 'RatingChips')
  assert.match(c, /bands\.map/, 'the chips are not built from the policy bands')
  assert.ok(!/\[1, 2, 3, 4, 5\]/.test(c), 'the scale is hardcoded')
})

// ── reading back what you wrote ──────────────────────────────────────────

test('the reason wraps instead of scrolling sideways', () => {
  // It was an <input>: one line, so a two-sentence reason could be typed
  // and then only ever seen sixty characters at a time.
  assert.match(PANEL, /<textarea className="why"/,
    'the reason is still a single-line input')
  assert.match(CSS, /textarea\.why \{[^}]*min-height: 38px/,
    'the reason box has no compact height')
  assert.match(CSS, /textarea\.why \{[^}]*resize: vertical/,
    'the reason box cannot be grown by the person writing in it')
})

// ── the one-to-one, as a step ────────────────────────────────────────────

test('the one-to-one tick reads as a step, not a footnote', () => {
  assert.match(PANEL, /className=\{`step1on1\$\{alreadyConfirmed \|\| confirmed \? ' on' : ''\}`\}/,
    'the one-to-one tick has no state of its own')
  assert.match(CSS, /\.step1on1\.on \{[^}]*var\(--ez-positive-tint\)/,
    'a ticked one-to-one does not look different from an unticked one')
})

test('an already-recorded confirmation says so', () => {
  // The box is ticked and disabled; without a word it reads as broken.
  assert.match(PANEL, /Already on record — you confirmed this earlier\./,
    'a confirmation that cannot be changed is not explained')
})
