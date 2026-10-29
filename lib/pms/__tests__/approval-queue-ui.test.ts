// The approval queue and the rating flow, as things a person uses.
//
// WHY A TEST FILE FOR LAYOUT AT ALL.
//
// Most of what is asserted here is not taste — it is information that was
// present in the data and absent from the screen, which is a defect of the
// same kind as a wrong number, and it regresses the same way: silently, in a
// refactor, with nothing failing.
//
// Three concrete things were missing before this, each observed on the
// running app rather than reasoned about:
//
//   * the chain. The module's entire subject is an approval chain and no
//     manager screen drew one, so "who gets this when I approve" was
//     answerable only by knowing the policy by heart.
//   * the band names. They existed solely in a title attribute — invisible
//     on touch, and on a desktop only to somebody who already suspected
//     there was something to hover. A manager choosing between 3 and 4 is
//     choosing between two words, not two digits.
//   * progress. The only signal of how much of a set was rated was the
//     blocker banner at the very bottom, below the thing it described.
//
// And one that was present eight times over: the identical sentence "No KRAs
// written yet. They cannot be rated at all until there are." on every row of
// a queue of eight.
//
// WHAT IS NOT ASSERTED: colours, radii, spacing, or anything else a designer
// should be free to change without a test arguing back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STAGE_SHORT, STAGES, rungs, type Stage } from '../chain.ts'
import { initials } from '../team.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MGR = read('components/pms/ManagerTabs.tsx')
const CSS = read('components/pms/pms.css')

/** The body of one component, from its declaration to the next one. */
function body(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`)
  assert.ok(i > 0, `${name} is gone — this test needs updating`)
  const next = src.indexOf('\nfunction ', i + 10)
  const nextExport = src.indexOf('\nexport function ', i + 10)
  const ends = [next, nextExport].filter(x => x > 0)
  return src.slice(i, ends.length ? Math.min(...ends) : src.length)
}

// ── the chain, drawn ──────────────────────────────────────────────────────

test('every stage has a short name', () => {
  // A missing entry renders `undefined` in the track rather than failing.
  for (const s of STAGES) {
    assert.ok(STAGE_SHORT[s], `no short name for ${s}`)
    assert.ok(STAGE_SHORT[s].length <= 8, `${s} is too long for a track node`)
  }
})

test('the short names do not collide', () => {
  const seen = new Set(Object.values(STAGE_SHORT))
  assert.equal(seen.size, STAGES.length,
    'two stages share a short name, so the track cannot tell them apart')
})

test('the track is built from the rungs somebody OCCUPIES', () => {
  // On a collapsed reporting line RM L2 is empty for 190 of 395 enrolments.
  // Drawing the policy's rungs without asking who fills them tells an
  // approver their set goes somewhere it will not.
  const t = body(MGR, 'ChainTrack')
  assert.match(t, /rungs\(chain\)\.filter\(held\)/,
    'the track draws rungs nobody occupies')
})

test('the track starts at the employee', () => {
  // The employee is not a rung — they do not approve their own appraisal —
  // but they are where it started, and a track that begins at RM L1 hides
  // the fact that a rejection can reach them.
  assert.match(body(MGR, 'ChainTrack'), /'EMPLOYEE', \.\.\.rungs\(chain\)/)
})

test('the viewer is marked on the track as themselves', () => {
  assert.match(body(MGR, 'ChainTrack'), /· you/,
    'the track does not say which rung is the viewer')
})

test('the card says where approving sends it', () => {
  // "Approve" means two different things one rung apart — passing it up, or
  // settling the rating for good — and only one of them is reversible.
  const c = body(MGR, 'ChainApprovals')
  assert.match(c, /Approving sends it to/, 'the card does not name the next rung')
  assert.match(c, /nextRung\(chain, myStage, held\)/,
    'the next rung is not computed from the holders')
  assert.match(c, /approving settles the rating/,
    'the finalising rung is not told that its approval is final')
})

// ── the readiness checks ──────────────────────────────────────────────────

test('each readiness mark says what it is, not just that it is green', () => {
  // A row of bare ticks makes somebody hover every one to find the single
  // one that is wrong.
  const c = body(MGR, 'ReadyChecks')
  for (const word of ['KRA', 'Weightage', 'Self rating', 'One-to-one']) {
    assert.ok(c.includes(word), `the checks do not name "${word}"`)
  }
})

test('the checks read the policy rules, not 100 and 4', () => {
  // A policy with total_weightage 80 would otherwise render a correct set as
  // wrong — the same bug the weightage cell had.
  const c = body(MGR, 'ReadyChecks')
  assert.match(c, /rules\.totalWeightage/, 'the weightage check is hardcoded')
  assert.match(c, /rules\.minKra[\s\S]{0,60}rules\.maxKra/,
    'the KRA count check is hardcoded')
})

test('a wrong count and a missing self rating look different', () => {
  // Both block, but one is the employee's fault and one is nobody's — and a
  // manager can act on the first and only wait on the second.
  const c = body(MGR, 'ReadyChecks')
  assert.match(c, /'bad'/, 'an invalid set is not marked differently')
  assert.match(c, /'off'/, 'a not-yet state is not marked differently')
})

// ── initials ──────────────────────────────────────────────────────────────

test('initials take the first and last word', () => {
  // Indian names in this database run to four words; first-two would make
  // half a department share initials.
  assert.equal(initials('Anil Verma'), 'AV')
  assert.equal(initials('Ishaan Gupta'), 'IG')
  assert.equal(initials('Nisha Verma'), 'NV')
  assert.equal(initials('Kavya Sri Lakshmi Narayanan'), 'KN',
    'a four-word name must not collapse to its first two initials')
})

test('a one-word name still gets a letter', () => {
  // An empty circle beside a name reads as a loading state that never ends.
  assert.equal(initials('Madonna'), 'M')
})

test('a missing name does not render an empty circle', () => {
  for (const bad of ['', '   ', '\n']) {
    assert.equal(initials(bad), '—', `"${bad}" produced no placeholder`)
  }
})

test('initials are upper case whatever the name is', () => {
  // Names arrive from a CSV import; "anil verma" is an ordinary row.
  assert.equal(initials('anil verma'), 'AV')
})

test('extra spaces between names do not become initials', () => {
  assert.equal(initials('Anil   Verma'), 'AV')
})

// ── grouping ──────────────────────────────────────────────────────────────

test('rows stuck on the same thing are grouped', () => {
  const g = body(MGR, 'GroupedQueue')
  assert.match(g, /groups\.find\(x => x\.key === r\.next\)/,
    'the queue does not group on what is owed')
})

test('the group heading comes from team.ts, not a second copy of the words', () => {
  // Restating the sentence here is how a screen and its data drift apart.
  const g = body(MGR, 'GroupedQueue')
  assert.ok(!/No KRAs written yet/.test(g),
    'the group heading hardcodes a sentence that team.ts owns')
})

test('grouping preserves the queue order', () => {
  // teamQueue sorts by whose deadline cannot move. Re-sorting by group size
  // would put the biggest pile first and the leaver last.
  const g = body(MGR, 'GroupedQueue')
  assert.ok(!/\.sort\(/.test(g), 'the grouped queue re-sorts the rows')
})

test('a grouped table drops the repeated column but keeps the deadline', () => {
  const q = body(MGR, 'QueueTable')
  assert.match(q, /\{!grouped && <th>What is owed<\/th>\}/,
    'the repeated column is still rendered when grouped')
  assert.match(q, /grouped && r\.priorityNote/,
    'the last-working-day note is lost in grouped mode')
})

test('the empty state survives grouping', () => {
  // An empty queue has no groups to render, so it must fall through to the
  // table that knows how to say "nobody here yet".
  const g = body(MGR, 'GroupedQueue')
  assert.match(g, /if \(!rows\.length\)/, 'an empty grouped queue renders nothing')
})

test('the colSpan follows the dropped column', () => {
  // Off by one and the empty-state cell stops short of the table edge.
  assert.match(body(MGR, 'QueueTable'),
    /colSpan=\{\(extraHead \? 10 : 9\) - \(grouped \? 1 : 0\)\}/)
})

// ── the rating flow ───────────────────────────────────────────────────────

test('the band name is shown, not only hovered', () => {
  assert.match(MGR, /bandFor\(mine, bands\)\?\.label/,
    'the chosen rating is still a bare digit')
  assert.match(CSS, /\.bandname/, 'the band name has no styling')
})

test('an unselected chip is not coloured', () => {
  // Painting all five turns the control into a traffic light and pulls the
  // eye to the green one, which is a thumb on the scale.
  assert.match(MGR, /on \? 'chip sel ramp' : 'chip'/,
    'the ramp class is applied to unselected chips too')
  // The colour itself rides on custom properties, so it is doubly gated:
  // an unselected chip carries neither the class nor the variables.
  assert.match(MGR, /style=\{on \? toneVars\(ratingTone\(bd\.value, bands\)\) : undefined\}/,
    'the ramp variables are set on unselected chips')
  assert.match(CSS, /\.chip\.sel\.ramp \{/, 'the selected chip has no colour')
})

test('the chip colour is not five hardcoded classes', () => {
  // It was .b1 red .b2 amber .b3 BLUE .b4 blue .b5 green — neither the
  // requested ramp nor survivable: .b7 on a ten-point policy scale matched
  // no rule at all and the chip rendered looking unselected.
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(!new RegExp(`\\.chip\\.sel\\.b${n}\\b`).test(CSS),
      `.chip.sel.b${n} is still a fixed class, so the scale is hardcoded`)
  }
})

test('progress through the set is shown while rating, not after', () => {
  assert.match(MGR, /className="ratebar"/, 'there is no progress indicator')
  assert.match(MGR, /cmp\.rated\} of \{cmp\.total\} rated/,
    'the progress indicator does not say how many are done')
  // The window is generous because the rule carries a comment explaining
  // why it has no z-index; what matters is that sticky belongs to .ratebar
  // and not to something further down the file.
  assert.match(CSS, /\.ratebar \{[^}]*position: sticky/,
    'the progress indicator scrolls away from the thing it describes')
})

test('progress is only shown to somebody who can make it', () => {
  // A read-only viewer has no progress to make, and a bar at 0 of 4 would
  // read as something they had failed to do.
  assert.match(MGR, /const rating = myRung && onApprove/,
    'the rating gate is no longer derived from the rung and the handler')
  assert.match(MGR, /\{rating && cmp\.total > 0 && \(/,
    'the progress bar renders for read-only viewers')
})

test('the card border is the score, and nothing else touches it', () => {
  // REPORTED TWICE. A blocking marker was put on the frame and it
  // contradicted the score both times: --ez-warning read as a red box
  // around an outstanding rating, then --ez-info read as a blue one. The
  // frame is what a person reads as "the colour of this KRA".
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = (sel: string) =>
    bare.slice(bare.indexOf(sel + ' {'), bare.indexOf('}', bare.indexOf(sel + ' {')))

  assert.match(rule('.pms .kcard.scored'), /border-color: var\(--kra-tone\)/,
    'the score colours only one edge, so the frame says something else')

  // NOTHING else may set a border or a ring on the card.
  for (const sel of ['.pms .kcard.needs']) {
    const r = rule(sel)
    assert.ok(!/border-color|border-top-color|border-right-color|border-bottom-color|box-shadow/.test(r),
      `${sel} marks the card's frame, which belongs to the score: ${r.trim()}`)
  }
})

test('a blocked KRA is still marked — on the field that is empty', () => {
  // The rule did not go away, it moved somewhere more useful: the reviewer
  // is pointed at the box they have to type in rather than at the card.
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')
  assert.match(bare, /\.kcard\.needs textarea\.why \{[^}]*border-color: var\(--ez-info\)/,
    'nothing marks the reason box that still has to be filled')
  assert.match(bare, /\.kcard\.needs \.khead \.fold \{[^}]*color: var\(--ez-info\)/,
    'the words "needs a reason" are still muted grey')
})

test('each queue heading says how many', () => {
  // A heading that says "Waiting on your approval" and nothing else makes
  // the count a thing you work out by scrolling.
  for (const h of ['Waiting on your approval', 'Waiting on the discussion']) {
    assert.ok(MGR.includes(`${h} · $\{`), `"${h}" does not carry a count`)
  }
})

// ── what a stage name must never be ───────────────────────────────────────

test('the track short names match the real rungs', () => {
  // A chain whose rungs() returns a stage with no short name renders an
  // empty node. Checked against a real chain rather than the type.
  for (const s of rungs('SELF_RM1_RM2_HOD') as Stage[]) {
    assert.ok(STAGE_SHORT[s], `rung ${s} has no short name`)
  }
})
