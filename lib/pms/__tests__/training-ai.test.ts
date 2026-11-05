// Suggesting training from what the chain wrote.
//
// Requested: an AI reads the ratings and remarks while a rater is scoring
// somebody, and suggests training into a bin they can drag from.
//
// ── THE THREE THINGS THAT MUST NOT SLIP ──────────────────────────────────
//
// 1. NOTHING IDENTIFIABLE LEAVES. The owner chose anonymised context, and
//    the product's own login page claims Mumbai residency and DPDPA
//    compliance. A name reaching a prompt is not a cosmetic bug.
//
// 2. THE MODEL MAY NOT NAME A COURSE. A catalogue suggestion names a real
//    course because a person put it there. A model suggestion is a skill
//    area — because "Advanced Power BI, Coursera, 14 hours" is a product
//    that may not exist, and once written into a recommendation nobody can
//    tell it from a real one.
//
// 3. A BAD RESPONSE IS NOT A CRASH. Prose around JSON, truncated JSON, an
//    apology — each ends as "nothing this time", never a broken panel in
//    the middle of somebody's appraisal.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anonymise, worthAsking, gaps, rankCatalogue, parseSuggestions,
         buildPrompt, catalogueSuggestions, IDENTIFYING_FIELDS,
         type RatingContext, type CatalogueRow } from '../trainingAi.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SQL = read('supabase/migrations/215_pms_training_catalogue_and_bin.sql')

const CTX: RatingContext = {
  employeeName: 'Priya Sharma',
  employeeCode: 'SRS9041',
  department: 'Retail Operations',
  overallRating: 2,
  scaleMax: 5,
  overallRemark: 'Stock accuracy slipped through the year.',
  kras: [
    { title: 'Stock accuracy', weightage: 40, rating: 2,
      comment: 'Cycle counts were late and the variance was not investigated.' },
    { title: 'Team engagement', weightage: 10, rating: 5, comment: 'Well liked.' },
    { title: 'Vendor onboarding', weightage: 30, rating: 3, comment: null },
    { title: 'Compliance filings', weightage: 20, rating: 4, comment: 'On time.' },
  ],
  pipReason: 'Sustained shortfall against the stock accuracy target.',
}

// ── nothing identifiable leaves ──────────────────────────────────────────

test('the person is stripped out of their own appraisal', () => {
  const safe = anonymise(CTX)
  const blob = JSON.stringify(safe)
  for (const v of ['Priya', 'Sharma', 'SRS9041', 'Retail Operations']) {
    assert.ok(!blob.includes(v), `${v} survived anonymisation`)
  }
  for (const f of IDENTIFYING_FIELDS) {
    assert.ok(!(f in (safe as unknown as Record<string, unknown>)), `${f} is still a field`)
  }
  // And the useful signal is intact.
  assert.equal(safe.kras.length, 4)
  assert.equal(safe.overallRating, 2)
  assert.match(safe.pipReason!, /stock accuracy/i)
})

test('the prompt cannot be built from un-anonymised context', () => {
  // The signature takes SafeContext, so passing the raw object is a type
  // error rather than a leak. Asserted in the source because types vanish
  // at runtime and this is the guarantee that matters.
  const src = read('lib/pms/trainingAi.ts')
  assert.match(src, /export function buildPrompt\(s: SafeContext/,
    'buildPrompt accepts an un-stripped context')
  assert.match(src, /export function anonymise\(ctx: RatingContext \| null \| undefined\): SafeContext/)
})

test('anonymise builds fresh rather than deleting from a copy', () => {
  // `delete ctx.employeeName` on a spread silently includes anything added
  // to RatingContext later. Naming what may travel means a new identifier
  // has to be let through deliberately.
  const src = read('lib/pms/trainingAi.ts')
  const fn = src.slice(src.indexOf('export function anonymise'),
                       src.indexOf('export function worthAsking'))
  assert.ok(!/\bdelete\b/.test(fn), 'anonymise deletes fields from a copy')
  assert.ok(!/\.\.\.c\b|\.\.\.ctx\b/.test(fn), 'anonymise spreads the raw context')
})

test('a name hidden in a remark is the manager’s business, not a leak to invent', () => {
  // Anonymise strips FIELDS. If a manager wrote a name in their own remark
  // that text is their evidence and removing it would change what they
  // said — the honest boundary is the structured identifiers.
  const safe = anonymise({ ...CTX, overallRemark: 'Priya needs support here.' })
  assert.match(safe.overallRemark!, /Priya/,
    'the remark was rewritten, which changes what the manager wrote')
})

test('an empty context does not explode', () => {
  for (const c of [null, undefined, {}, { kras: [] }]) {
    const s = anonymise(c as RatingContext)
    assert.deepEqual(s.kras, [])
    assert.equal(s.overallRemark, null)
  }
})

test('a KRA with no title is dropped, not sent as an empty line', () => {
  const s = anonymise({ kras: [{ title: '  ', rating: 2 }, { title: 'Real one' }] })
  assert.deepEqual(s.kras.map(k => k.title), ['Real one'])
})

// ── is it worth asking ───────────────────────────────────────────────────

test('a rating with no objectives and no words is not worth a call', () => {
  // "They were a 3" says nothing about WHAT to train.
  assert.equal(worthAsking(anonymise({ overallRating: 3 })), false)
  assert.equal(worthAsking(anonymise({ overallRating: 3, overallRemark: 'Fine.' })), false)
})

test('objectives, or enough written, make it worth asking', () => {
  assert.equal(worthAsking(anonymise({ kras: [{ title: 'Stock accuracy' }] })), true)
  assert.equal(worthAsking(anonymise({
    overallRemark: 'Cycle counts late all year and variances never investigated.' })), true)
})

// ── the gaps ─────────────────────────────────────────────────────────────

test('the weakest and heaviest objectives come first', () => {
  // A 2 on a 40% objective outranks a 3 on a 30% one; a 5 comes last.
  const g = gaps(anonymise(CTX))
  assert.equal(g[0].title, 'Stock accuracy')
  assert.equal(g[g.length - 1].title, 'Team engagement',
    'a strength is being treated as a training gap')
})

test('weightage breaks the tie between equal scores', () => {
  const g = gaps(anonymise({ scaleMax: 5, kras: [
    { title: 'Light', weightage: 5, rating: 3 },
    { title: 'Heavy', weightage: 60, rating: 3 },
  ] }))
  assert.equal(g[0].title, 'Heavy')
})

test('unrated objectives are still offered', () => {
  // Early in a cycle nothing is scored, and the titles alone are useful.
  const g = gaps(anonymise({ kras: [{ title: 'A' }, { title: 'B' }] }))
  assert.equal(g.length, 2)
})

// ── retrieval ────────────────────────────────────────────────────────────

const CATALOGUE: CatalogueRow[] = [
  { id: 'c1', course_name: 'Inventory Control Essentials', skill: 'stock accuracy cycle counting',
    provider: 'Internal L&D', category: 'DOMAIN' },
  { id: 'c2', course_name: 'Advanced Excel for Analysts', skill: 'spreadsheets pivot analysis',
    provider: 'Internal L&D', category: 'TECHNICAL' },
  { id: 'c3', course_name: 'Coaching Conversations', skill: 'feedback coaching engagement',
    category: 'BEHAVIOURAL' },
  { id: 'c4', course_name: 'Retired Course', skill: 'stock accuracy', is_active: false,
    category: 'DOMAIN' },
]

test('the catalogue is matched on what the rater actually wrote', () => {
  const hits = rankCatalogue(anonymise(CTX), CATALOGUE)
  assert.equal(hits[0].row.id, 'c1', 'the obvious match is not first')
  assert.ok(hits[0].matched.includes('stock'))
})

test('an inactive course is never suggested', () => {
  const hits = rankCatalogue(anonymise(CTX), CATALOGUE)
  assert.ok(!hits.some(h => h.row.id === 'c4'), 'a retired course was suggested')
})

test('the skill field outweighs the course title', () => {
  // "Advanced Excel" matches a spreadsheet KRA through its skill, not its
  // name, and a title-only match must not beat a skill match.
  //
  // The two must match the SAME NUMBER of words, or the count decides and
  // the weighting is never exercised — which is how an earlier version of
  // this test passed with skill and title weighted equally.
  const ctx = anonymise({ kras: [{ title: 'Pivot analysis of sales', rating: 2 }] })
  const hits = rankCatalogue(ctx, [
    // Two words, both in the TITLE.
    { id: 'x', course_name: 'Pivot analysis', skill: 'unrelated topic', category: 'OTHER' },
    // One word, in the SKILL. Worth more, so it must still win.
    { id: 'y', course_name: 'Unrelated', skill: 'pivot', category: 'TECHNICAL' },
  ])
  assert.equal(hits[0].row.id, 'y',
    'a title match is outranking a skill match')
})

test('nothing matching returns nothing, not the whole catalogue', () => {
  const ctx = anonymise({ kras: [{ title: 'Zzzzq wibble', rating: 2 }] })
  assert.deepEqual(rankCatalogue(ctx, CATALOGUE), [])
})

test('an empty catalogue is handled, which is the state it ships in', () => {
  assert.deepEqual(rankCatalogue(anonymise(CTX), []), [])
  assert.deepEqual(rankCatalogue(anonymise(CTX), null), [])
})

test('common words do not match everything', () => {
  // Without stopwords, "and"/"the" in a KRA would match every course.
  const ctx = anonymise({ kras: [{ title: 'The and for with', rating: 2 }] })
  assert.deepEqual(rankCatalogue(ctx, CATALOGUE), [])
})

test('a catalogue hit becomes a suggestion that names the real course', () => {
  const s = catalogueSuggestions(rankCatalogue(anonymise(CTX), CATALOGUE))
  assert.equal(s[0].source, 'CATALOGUE')
  assert.equal(s[0].trainingName, 'Inventory Control Essentials')
  assert.equal(s[0].catalogueId, 'c1')
  assert.match(s[0].rationale!, /Internal L&D/)
})

// ── what the model sends back ────────────────────────────────────────────

test('a clean response parses', () => {
  const s = parseSuggestions(`[
    {"skill":"Inventory forecasting","category":"DOMAIN","rationale":"Stock accuracy was rated 2."},
    {"skill":"Root cause analysis","category":"TECHNICAL","rationale":"Variances were not investigated."}
  ]`)
  assert.equal(s.length, 2)
  assert.equal(s[0].source, 'MODEL')
  assert.equal(s[0].trainingName, 'Inventory forecasting')
  assert.equal(s[0].category, 'DOMAIN')
})

test('prose around the JSON is tolerated', () => {
  const s = parseSuggestions('Sure! Here are my suggestions:\n```json\n'
    + '[{"skill":"Inventory forecasting","category":"DOMAIN"}]\n```\nHope that helps.')
  assert.equal(s.length, 1)
  assert.equal(s[0].trainingName, 'Inventory forecasting')
})

test('a broken or empty response yields nothing, never a throw', () => {
  // The malformed-but-BALANCED cases matter most: an unbalanced '[' returns
  // early without ever reaching JSON.parse, so a test made only of those
  // passes with the try/catch deleted.
  for (const bad of ['', null, undefined, 'I cannot help with that.',
                     '[{"skill":', '[', 'null', '{"skill":"not an array"}',
                     '[1,2,3]', '[{}]',
                     '[{bad json}]', "[{'skill': 'single quotes'}]",
                     '[{"skill":"trailing",}]', '[{"skill":"x"} {"skill":"y"}]']) {
    assert.deepEqual(parseSuggestions(bad as string), [],
      `${JSON.stringify(bad)} did not come back empty`)
  }
})

test('A NAMED COURSE FROM THE MODEL IS REJECTED, not cleaned up', () => {
  // The rule this whole design rests on. A half-stripped fabrication still
  // reads as a real course to the manager who recommends it.
  const bad = [
    '[{"skill":"Advanced Power BI on Coursera","category":"TECHNICAL"}]',
    '[{"skill":"Excel course at https://udemy.com/x","category":"TECHNICAL"}]',
    '[{"skill":"Forecasting (14 hours)","category":"DOMAIN"}]',
    '[{"skill":"Lean Six Sigma, www.example.com","category":"DOMAIN"}]',
    '[{"skill":"Analytics bootcamp ₹4999","category":"TECHNICAL"}]',
  ]
  for (const b of bad) {
    assert.deepEqual(parseSuggestions(b), [], `a named product got through: ${b}`)
  }
  // A rationale that smuggles one in is rejected too.
  assert.deepEqual(parseSuggestions(
    '[{"skill":"Forecasting","rationale":"Try https://udemy.com/forecasting"}]'), [])
})

test('a plain skill is accepted alongside the rejected ones', () => {
  const s = parseSuggestions('[{"skill":"Advanced Power BI on Coursera"},'
    + '{"skill":"Demand forecasting","category":"DOMAIN"}]')
  assert.deepEqual(s.map(x => x.trainingName), ['Demand forecasting'])
})

test('an unknown category falls back rather than being passed through', () => {
  const s = parseSuggestions('[{"skill":"Forecasting","category":"MADE_UP"}]')
  assert.equal(s[0].category, 'OTHER')
})

test('duplicates and absurd lengths are dropped', () => {
  const s = parseSuggestions(`[
    {"skill":"Forecasting"},{"skill":"forecasting"},{"skill":"ab"},
    {"skill":"${'x'.repeat(200)}"}
  ]`)
  assert.deepEqual(s.map(x => x.trainingName), ['Forecasting'])
})

test('the list is capped, so one response cannot flood the bin', () => {
  const many = JSON.stringify(Array.from({ length: 30 },
    (_, i) => ({ skill: `Skill number ${i}` })))
  assert.ok(parseSuggestions(many).length <= 6)
})

// ── the prompt ───────────────────────────────────────────────────────────

test('the prompt forbids naming a course, in words', () => {
  const p = buildPrompt(anonymise(CTX), [])
  assert.match(p, /Name a SKILL, never a course, product, provider or URL/)
  assert.match(p, /Do not invent durations, prices or links/)
})

test('the prompt carries the evidence and not the person', () => {
  const p = buildPrompt(anonymise(CTX), [])
  assert.match(p, /Stock accuracy/)
  assert.match(p, /rated 2\/5/)
  assert.match(p, /Cycle counts were late/)
  for (const v of ['Priya', 'SRS9041', 'Retail Operations']) {
    assert.ok(!p.includes(v), `${v} reached the prompt`)
  }
})

test('catalogue matches are listed so the model does not repeat them', () => {
  const p = buildPrompt(anonymise(CTX), ['Inventory Control Essentials'])
  assert.match(p, /do not repeat/i)
  assert.match(p, /Inventory Control Essentials/)
})

// ── 215 ──────────────────────────────────────────────────────────────────

test('215 creates the catalogue and the bin', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS pms_training_catalogue/)
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS pms_training_suggestion/)
  assert.match(SQL, /CHECK \(source IN \('CATALOGUE','MODEL'\)\)/,
    'a suggestion does not record where it came from')
})

test('the bin is per rater, not per employee', () => {
  // Two managers rating the same person form their own views; one
  // dismissing a suggestion must not remove it from the other's bin.
  assert.match(SQL, /generated_by\s+uuid NOT NULL REFERENCES employees\(id\)/)
  assert.match(SQL, /UNIQUE \(period_id, employee_id, generated_by, training_name\)/)
})

test('215 seeds no courses', () => {
  // Inventing a starter catalogue is the same fabrication one layer down,
  // and a seeded row is indistinguishable from one an L&D team chose.
  const body = SQL.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  assert.ok(!/\bINSERT\b/i.test(body), '215 seeds the catalogue')
  for (const f of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /^\s*UPDATE\s+\w/mi]) {
    assert.ok(!f.test(body), `215 matches ${f}`)
  }
})

test('both tables have RLS', () => {
  for (const t of ['pms_training_catalogue', 'pms_training_suggestion']) {
    assert.ok(SQL.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), `${t} has no RLS`)
  }
})

// ── the route ────────────────────────────────────────────────────────────

const ROUTE = read('app/api/pms/training-ai/route.ts')

test('the stripping happens on the SERVER, before a prompt exists', () => {
  // Done in the browser instead, a future caller could skip it. Done here,
  // there is one place to check and one place to get it wrong.
  assert.match(ROUTE, /const safe = anonymise\(body\.context\)/,
    'the route trusts the client to have anonymised the context')
  const i = ROUTE.indexOf('const safe = anonymise(body.context)')
  const j = ROUTE.indexOf('buildPrompt(safe')
  assert.ok(i > 0 && j > i, 'a prompt is built before the context is stripped')
  // And the raw body must never reach the model.
  assert.ok(!/buildPrompt\(body|prompt.*body\.context/.test(ROUTE),
    'the un-stripped context reaches the prompt')
})

test('it tries whichever key is present, and says so when neither is', () => {
  // Scoped to ask(). Searching the whole file matched the header comment
  // and the refusal message, both of which name the keys in that order
  // whatever the code does — so the assertion passed with them swapped.
  const fn = ROUTE.slice(ROUTE.indexOf('async function ask('),
                         ROUTE.indexOf('export async function POST'))
  assert.ok(fn.indexOf('GOOGLE_GENERATIVE_AI_API_KEY') < fn.indexOf('ANTHROPIC_API_KEY'),
    'the key that is actually configured is not tried first')
  assert.match(ROUTE, /NO_MODEL/)
  assert.match(ROUTE, /GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY/,
    'the refusal does not name the keys somebody would have to set')
})

test('an empty catalogue plus no key is a refusal, not a silent empty bin', () => {
  // The state this ships in, if nobody sets a key: the screen has to say
  // why rather than look broken.
  const fn = ROUTE.slice(ROUTE.indexOf('const answer = await ask('),
                         ROUTE.indexOf('const fromModel'))
  assert.match(fn, /!answer && !fromCatalogue\.length/,
    'no key and no catalogue returns an empty bin with no explanation')
})

test('the catalogue is retrieved before the model is asked', () => {
  // "Catalogue first, model fills the gaps" — the owner's choice. The
  // matched courses are also fed to the prompt so it does not repeat them.
  assert.ok(ROUTE.indexOf("from('pms_training_catalogue')") < ROUTE.indexOf('const answer = await ask('),
    'the model is asked before the catalogue is consulted')
  assert.match(ROUTE, /buildPrompt\(safe, fromCatalogue\.map\(s => s\.trainingName\)\)/)
})

test('only active courses, and only this company’s or the group’s', () => {
  const q = ROUTE.slice(ROUTE.indexOf("from('pms_training_catalogue')"),
                        ROUTE.indexOf('const ranked'))
  assert.match(q, /\.eq\('is_active', true\)/, 'retired courses are retrieved')
  assert.match(q, /company_id\.is\.null/, 'group-wide courses are excluded')
})

test('a failure to save the bin does not fail the call', () => {
  // The suggestions are useful right now even if the bin did not persist.
  // Failing the call would turn a storage problem into "the AI is broken".
  const fn = ROUTE.slice(ROUTE.indexOf('const saved = await sb'),
                         ROUTE.indexOf('const back = await sb'))
  assert.ok(!/return bad\(/.test(fn), 'a storage failure fails the whole call')
  assert.match(fn, /console\.error/)
})

test('a dismissed suggestion does not come back', () => {
  // Somebody who threw one away should not have it reappear because they
  // pressed the button again.
  assert.match(ROUTE, /ignoreDuplicates: true/,
    'regenerating overwrites what the rater already decided about')
  assert.match(ROUTE, /\.neq\('status', 'DISMISSED'\)/,
    'dismissed suggestions are returned to the bin')
})

test('the call is attributed to a real person', () => {
  assert.match(ROUTE, /if \(!actor\.employeeId\)/,
    'the shared dashboard login can generate suggestions anonymously')
  assert.match(ROUTE, /generated_by: actor\.employeeId/)
})
