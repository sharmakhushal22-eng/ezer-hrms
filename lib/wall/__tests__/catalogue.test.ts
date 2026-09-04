// The recognition catalogue, and the guard that keeps its two copies honest.
//
// Seventy-four items live in TypeScript for the UI and in SQL for the
// database. Maintained by hand in both places they would disagree within a
// month, and the disagreement shows up as a badge that exists on one screen
// and not another. So the TS is canonical, the SQL is generated, and the last
// test here re-parses the migration and fails if they have drifted.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BADGES, TAGS, ALL_ITEMS, CATEGORIES, badgeByRef, tagByRef, byCategory,
  search, checkSelection, describe, MAX_TAGS, EMPTY_SELECTION,
} from '../catalogue.ts'

// ── the document, transcribed ────────────────────────────────────────────

test('the counts match the source document', () => {
  assert.equal(BADGES.length, 30, 'B001-B030')
  assert.equal(TAGS.length, 44, 'T001-T044')
  assert.equal(ALL_ITEMS.length, 74)
})

test('references are contiguous, so nothing was dropped in transcription', () => {
  for (const [prefix, list] of [['B', BADGES], ['T', TAGS]] as const) {
    const nums = list.map(i => Number(i.ref.slice(1))).sort((a, b) => a - b)
    assert.deepEqual(nums, Array.from({ length: list.length }, (_, i) => i + 1),
      `${prefix} references have a gap or a duplicate`)
  }
})

test('every item is complete — no blank name, category or description', () => {
  for (const i of ALL_ITEMS) {
    assert.match(i.name, /\S/, `${i.ref} has no name`)
    assert.match(i.description, /\S/, `${i.ref} has no description`)
    assert.match(i.glyph, /\S/, `${i.ref} has no glyph`)
    assert.ok((CATEGORIES as readonly string[]).includes(i.category),
      `${i.ref} has category "${i.category}", which is not in the list`)
  }
})

test('all eleven categories from the document are used', () => {
  assert.equal(CATEGORIES.length, 11)
  const used = new Set(ALL_ITEMS.map(i => i.category))
  for (const c of CATEGORIES) {
    assert.ok(used.has(c), `${c} is declared but nothing uses it`)
  }
})

test('names are unique WITHIN a kind', () => {
  for (const [kind, list] of [['badge', BADGES], ['tag', TAGS]] as const) {
    const names = list.map(i => i.name.toLowerCase())
    assert.equal(new Set(names).size, names.length, `two ${kind}s share a name`)
  }
})

test('the five names shared BETWEEN badge and tag are deliberate', () => {
  // From the source document. As a tag it describes this week's work; as a
  // badge it is an award for having done it consistently. Pinned here so a
  // future de-duplication has to be a decision rather than an accident.
  const shared = BADGES.map(b => b.name).filter(n => TAGS.some(t => t.name === n)).sort()
  assert.deepEqual(shared, [
    'Culture Champion', 'Decision Maker', 'Positive Energy',
    'Problem Solver', 'Team Player',
  ])
})

// ── lookups ──────────────────────────────────────────────────────────────

test('a ref resolves only within its own kind', () => {
  assert.equal(badgeByRef('B001')?.name, 'Best Performer')
  assert.equal(tagByRef('T001')?.name, 'High Performer')
  assert.equal(badgeByRef('T001'), null, 'a tag ref must not resolve as a badge')
  assert.equal(tagByRef('B001'), null, 'a badge ref must not resolve as a tag')
  assert.equal(badgeByRef('nonsense'), null)
})

test('grouping keeps the declared category order and drops empty groups', () => {
  const groups = byCategory(BADGES)
  const order = groups.map(g => g.category)
  assert.deepEqual(order, CATEGORIES.filter(c => order.includes(c)))
  for (const g of groups) assert.ok(g.items.length > 0)
})

test('search covers descriptions, not only names', () => {
  // Somebody thinking "helps others" should not have to know the word
  // "Supportive" to find it.
  const hits = search(TAGS, 'supports').map(t => t.name)
  assert.ok(hits.includes('Supportive'), `expected Supportive, got ${hits}`)
  assert.ok(search(BADGES, 'teamwork').some(b => b.name === 'Team Player'))
  assert.ok(search(TAGS, 'leadership').length > 1, 'category should match too')
})

test('an empty search returns everything rather than nothing', () => {
  assert.equal(search(TAGS, '   ').length, TAGS.length)
})

// ── what a recognition may carry ─────────────────────────────────────────

test('an empty selection is valid — a shoutout need not carry a badge', () => {
  assert.equal(checkSelection(EMPTY_SELECTION).ok, true)
})

test('a good selection passes', () => {
  assert.equal(checkSelection({ badgeRef: 'B001', tagRefs: ['T001', 'T007'] }).ok, true)
})

test('a ref from the wrong list is refused, and named', () => {
  const bad = checkSelection({ badgeRef: 'T001', tagRefs: [] })
  assert.equal(bad.ok, false)
  assert.match(bad.faults[0], /T001 is not a badge/)
  const bad2 = checkSelection({ badgeRef: null, tagRefs: ['B001'] })
  assert.match(bad2.faults[0], /B001 is not a tag/)
})

test('the same tag twice is refused', () => {
  const c = checkSelection({ badgeRef: null, tagRefs: ['T001', 'T001'] })
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /twice/i.test(f)))
})

test(`more than ${MAX_TAGS} tags is refused, with the reason`, () => {
  const many = TAGS.slice(0, MAX_TAGS + 1).map(t => t.ref)
  const c = checkSelection({ badgeRef: null, tagRefs: many })
  assert.equal(c.ok, false)
  assert.ok(c.faults.some(f => /at most 5/i.test(f)))
  // and exactly the limit is fine
  assert.equal(checkSelection({ badgeRef: null,
    tagRefs: TAGS.slice(0, MAX_TAGS).map(t => t.ref) }).ok, true)
})

test('describe reads as a sentence in every combination', () => {
  assert.equal(describe({ badgeRef: 'B001', tagRefs: [] }), 'Best Performer')
  assert.equal(describe({ badgeRef: null, tagRefs: ['T001'] }), 'High Performer')
  assert.equal(describe({ badgeRef: 'B001', tagRefs: ['T001'] }),
               'Best Performer — High Performer')
  assert.equal(describe(EMPTY_SELECTION), '')
})

// ── the drift guard ──────────────────────────────────────────────────────

test('THE MIGRATION MATCHES THIS FILE, item for item', () => {
  // scripts/gen-catalogue.py writes the SQL from this module. If somebody
  // edits either by hand, this is what catches it — before a badge exists on
  // one screen and not another.
  const sql = readFileSync(
    new URL('../../../supabase/migrations/089_recognition_catalogue.sql', import.meta.url),
    'utf8')

  const rows = [...sql.matchAll(
    /\(\s*'([BT]\d{3})',\s*'(BADGE|TAG)',\s*'((?:[^']|'')*)',\s*'([^']*)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+)\)/g)]
  assert.equal(rows.length, 74, `the migration seeds ${rows.length} rows, not 74`)

  const un = (s: string) => s.replace(/''/g, "'")
  for (const [, ref, kind, name, category, glyph, description] of rows) {
    const item = kind === 'BADGE' ? badgeByRef(ref) : tagByRef(ref)
    assert.ok(item, `${ref} is seeded in SQL but missing from the catalogue`)
    assert.equal(un(name), item!.name, `${ref}: name differs`)
    assert.equal(category, item!.category, `${ref}: category differs`)
    assert.equal(glyph, item!.glyph, `${ref}: glyph differs`)
    assert.equal(un(description), item!.description, `${ref}: description differs`)
  }
  // and nothing in the catalogue is missing from the SQL
  const seeded = new Set(rows.map(r => r[1]))
  for (const i of ALL_ITEMS) {
    assert.ok(seeded.has(i.ref), `${i.ref} (${i.name}) is not seeded — regenerate the SQL`)
  }
})

test('the migration enforces the tag limit in the database too', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/089_recognition_catalogue.sql', import.meta.url),
    'utf8')
  // Read the number out of the SQL and compare it to MAX_TAGS, rather than
  // matching a literal. `<= 5` also matches `<= 50`, which let a sabotage
  // raising the database limit to fifty sail straight through this check.
  const limit = sql.match(/array_length\(tag_refs, 1\), 0\)\s*<=\s*(\d+)/)
  assert.ok(limit, 'the migration must cap tag_refs')
  assert.equal(Number(limit![1]), MAX_TAGS,
    `the database caps tags at ${limit![1]} but the module says ${MAX_TAGS} — ` +
    'the UI limit means nothing if the database accepts more')
  assert.match(sql, /is not an active badge/, 'a tag ref filed as a badge must be refused')
})

test('the composer does not add arguments to create_shoutout', () => {
  // Postgres matches a function by its argument list. Passing p_badge_ref to
  // the five-argument create_shoutout returns PGRST202 and breaks shoutouts
  // outright — which is what the first version of this wiring did. The marks
  // go on through their own function afterwards.
  const src = readFileSync(
    new URL('../../../components/wall/ShoutoutComposer.tsx', import.meta.url), 'utf8')
  const call = src.slice(src.indexOf("rpc('create_shoutout'"),
                         src.indexOf("rpc('create_shoutout'") + 400)
  assert.doesNotMatch(call, /p_badge_ref|p_tag_refs/,
    'create_shoutout takes five arguments; the marks belong in set_recognition_marks')
  assert.match(src, /rpc\('set_recognition_marks'/,
    'the badge and tags have to be attached somehow')
})

test('only the giver may set the marks, and the database says so', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/089_recognition_catalogue.sql', import.meta.url),
    'utf8')
  assert.match(sql, /giver_employee_id is distinct from v_actor/,
    'without this check anybody could badge somebody else\'s recognition')
  assert.match(sql, /security definer/i)
})
