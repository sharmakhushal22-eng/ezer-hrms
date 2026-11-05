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
  const fn = ROUTE.slice(ROUTE.indexOf('const asked = await ask('),
                         ROUTE.indexOf('const fromModel'))
  assert.ok(fn.length > 50, 'the ask branch moved')
  assert.match(fn, /!answer && !fromCatalogue\.length/,
    'no key and no catalogue returns an empty bin with no explanation')
})

test('the catalogue is retrieved before the model is asked', () => {
  // "Catalogue first, model fills the gaps" — the owner's choice. The
  // matched courses are also fed to the prompt so it does not repeat them.
  assert.ok(ROUTE.indexOf("from('pms_training_catalogue')") < ROUTE.indexOf('const asked = await ask('),
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

// ── the bin on the rating panel ──────────────────────────────────────────

const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')

test('drag is the shortcut, never the only way', () => {
  // Drag-only makes the feature unreachable on a trackpad, a touchscreen,
  // or with a screen reader — which between them is most people. The
  // button is how it works; the drag is a nicety on top.
  const bin = MGR.slice(MGR.indexOf('function SuggestionBin'),
                        MGR.indexOf('function TrainingBlock'))
  assert.ok(bin.length > 400, 'the bin is gone')
  assert.match(bin, /Add to my list/, 'there is no way to take a suggestion without dragging')
  assert.match(bin, /onClick=\{\(\) => onTake\?\.\(s\)\}/)
  assert.match(bin, /draggable=\{!!onTake\}/)
  // Both paths end in the same function, or they will drift.
  const block = MGR.slice(MGR.indexOf('function TrainingBlock'),
                          MGR.indexOf('WHAT THE SCORE INVITES'))
  assert.match(block, /onTake=\{take\}/)
  assert.match(block, /take\(JSON\.parse\(raw\) as AiSuggestion\)/,
    'the drop path does not reuse the same take()')
})

test('a catalogue suggestion and a skill area do not look alike', () => {
  // The badge is load-bearing: the second must not borrow the authority of
  // the first. One is a course somebody chose; the other is a direction.
  const bin = MGR.slice(MGR.indexOf('function SuggestionBin'),
                        MGR.indexOf('function TrainingBlock'))
  assert.match(bin, /in your catalogue/)
  assert.match(bin, /skill area/)
  assert.match(bin, /s\.source === 'CATALOGUE' \? 'cat' : 'skill'/,
    'both sources render with the same badge')
  const css = read('components/pms/pms.css')
  assert.match(css, /\.aibadge\.cat/)
  assert.match(css, /\.aibadge\.skill/)
})

test('taking a suggestion fills a blank row rather than appending one', () => {
  // Appending unconditionally leaves an empty row above the thing just
  // added, every first time.
  const block = MGR.slice(MGR.indexOf('function TrainingBlock'),
                          MGR.indexOf('WHAT THE SCORE INVITES'))
  assert.match(block, /const blank = rows\.findIndex/)
  assert.match(block, /blank >= 0\s*\n?\s*\? rows\.map/)
  // And the same thing twice is not added twice.
  assert.match(block, /if \(rows\.some\(r => \(r\.trainingName \?\? ''\)\.trim\(\)\.toLowerCase\(\)/,
    'the same suggestion can be added twice')
})

test('the rationale becomes an editable starting point, not a verdict', () => {
  // It lands in the rater's own details field, which they edit or delete.
  // A machine's sentence reaching HR unread is the thing to avoid.
  const block = MGR.slice(MGR.indexOf('function TrainingBlock'),
                          MGR.indexOf('WHAT THE SCORE INVITES'))
  assert.match(block, /details: s\.rationale \?\? ''/)
})

test('the panel sends what is on screen, and the server strips it', () => {
  const fn = PERF.slice(PERF.indexOf('const askForTraining'),
                        PERF.indexOf('const dismissSuggestion'))
  assert.ok(fn.length > 400, 'askForTraining is gone')
  assert.match(fn, /kras: \(kraLines \?\? \[\]\)\.map/, 'the KRAs are not sent')
  assert.match(fn, /comment: l\.goalId \? kraRate\[l\.goalId\]\?\.comment/,
    'this rater\'s own comments are not sent')
  assert.match(fn, /overallRemark: overall/)
  // The score must come from the SAME function the approval path uses.
  assert.match(fn, /compareRatings\(/,
    'the score shown and the score sent are computed differently')
})

test('a dismissal sticks in the database, not just the screen', () => {
  // Somebody who rejected a suggestion made a decision. Pressing Suggest
  // again must not hand it back.
  const fn = PERF.slice(PERF.indexOf('const dismissSuggestion'),
                        PERF.indexOf('const rateAndApprove'))
  assert.match(fn, /status: 'DISMISSED'/)
  assert.match(fn, /\.eq\('id', sug\.id\)/, 'the dismissal is not pinned to one row')
})

test('the bin is held per employee', () => {
  // Switching between reportees must not show one person's suggestions
  // under another's name.
  assert.match(PERF, /const \[aiBin, setAiBin\] = useState<Record<string, AiSuggestion\[\]>>/)
  assert.match(PERF, /suggestions: aiBin\[m\.employeeId\] \?\? null/)
})

test('no key, no bin — and the block still works', () => {
  // The suggestion is an accelerator, never a dependency. A missing key
  // must not take the training block with it.
  const block = MGR.slice(MGR.indexOf('function TrainingBlock'),
                          MGR.indexOf('WHAT THE SCORE INVITES'))
  assert.match(block, /\{ai && \(/, 'the bin renders unconditionally')
  assert.match(block, /ai\?: \{/, 'the ai prop is required rather than optional')
  // And the route's own sentence is what the rater sees.
  const fn = PERF.slice(PERF.indexOf('const askForTraining'),
                        PERF.indexOf('const dismissSuggestion'))
  assert.match(fn, /setAiNote\(j\?\.message \?\?/,
    'the route\'s explanation is replaced with a vaguer one')
})

// ── what live testing against the real model taught ─────────────────────

test('the model name is the one the API will still answer', () => {
  // gemini-2.5-flash returns 404 for a new key: "no longer available to
  // new users ... use models/gemini-3.8-flash". Found by calling it.
  // A LIST, not a name. Both failure modes were measured against the real
  // key: 2.5-flash is retired (404) and flash-latest was busy (503), so a
  // single pinned name or a single alias each break on a different day.
  const m = ROUTE.match(/const GEMINI_MODELS = \[([^\]]*)\]/)
  assert.ok(m, 'the model list is gone')
  const models = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])
  assert.ok(models.length >= 2, 'one model name is one retirement from broken')
  assert.equal(models[0], 'gemini-3.5-flash',
    'the model that actually answered is not tried first')
  assert.ok(!models.includes('gemini-3.8-flash'),
    'the route names a model that is not in this key\'s list')
  // COMMENTS STRIPPED. The comment above the constant explains the 404 by
  // naming the dead model, which is the point of it — and tripped this
  // assertion when it searched the whole file.
  const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  assert.ok(!/gemini-2\.5-flash/.test(code), 'the retired model is still called')
})

test('a busy model is not reported as a missing key', () => {
  // Telling somebody to set a key they have already set is how a
  // five-minute wait becomes an afternoon. Gemini answered 503
  // "experiencing high demand" during testing.
  assert.match(ROUTE, /MODEL_BUSY/)
  assert.match(ROUTE, /asked\.failed === 'UNAVAILABLE'/,
    'the two failures share one message')
  assert.match(ROUTE, /tried \? 'UNAVAILABLE' : 'NO_KEY'/,
    'a key that was tried and failed reads as absent')
  // And the busy message must not tell them to configure anything.
  const busy = ROUTE.slice(ROUTE.indexOf("bad('MODEL_BUSY'"), ROUTE.indexOf("bad('NO_MODEL'"))
  assert.ok(!/API_KEY/.test(busy), 'the busy message sends them to the env file')
})

test('the call has a deadline, so the button cannot spin for ever', () => {
  // MEASURED: an overloaded Gemini held the connection 300 seconds before
  // undici gave up. The rater does not have to have this suggestion.
  assert.match(ROUTE, /const DEADLINE_MS = 20_000/)
  assert.match(ROUTE, /new AbortController\(\)/)
  assert.match(ROUTE, /signal: ctrl\.signal/)
  // AND THE TIMER IS ARMED. A controller that is never aborted is a
  // controller that does nothing — a mutation deleting just the
  // setTimeout left all three assertions above passing.
  assert.match(ROUTE, /setTimeout\(\(\) => ctrl\.abort\(\), DEADLINE_MS\)/,
    'the abort is never scheduled, so the deadline never fires')
  assert.match(ROUTE, /clearTimeout\(t\)/, 'the timer leaks on a fast response')
  // Both providers go through it.
  assert.equal([...ROUTE.matchAll(/await withDeadline\(/g)].length, 2,
    'one of the providers can still hang')
  // Every model in the list goes through the same deadline, so a busy one
  // cannot eat the budget meant for the next.
  assert.match(ROUTE, /for \(const model of \(google \? GEMINI_MODELS : \[\]\)\)/,
    'the models are not tried in turn')
  // withDeadline itself must call fetch — the rule is that NOTHING ELSE
  // does, so the count is one rather than zero.
  assert.equal([...ROUTE.matchAll(/await fetch\(/g)].length, 1,
    'a raw fetch with no deadline remains')
})

test('the route answers in ONE shape, whichever path produced it', () => {
  // THE BUG THE CARDS SHOWED. Stored rows are snake_case and freshly built
  // ones are not, so returning back.data raw meant the screen read
  // trainingName off a row that only had training_name — every card
  // rendered with a blank title, badge and rationale intact, looking for
  // all the world like a styling problem.
  //
  // And it only happened on the path that WORKS: a failed re-read fell
  // back to `all`, which was already the right shape, so the bug hid
  // exactly when persistence broke.
  assert.match(ROUTE, /const fromRows = \(back\.data \?\? \[\]\)\.map/,
    'the stored rows are returned without being mapped')
  assert.match(ROUTE, /trainingName: String\(row\.training_name \?\? ''\)/)
  assert.match(ROUTE, /suggestions: back\.error \? all : fromRows/,
    'the two paths still return different shapes')
  // No snake_case key may escape in the payload.
  const ret = ROUTE.slice(ROUTE.indexOf('const fromRows'), ROUTE.length)
  for (const k of ['training_name:', 'catalogue_id:']) {
    assert.ok(!ret.includes(k), `${k} is returned to the screen`)
  }
})

// ── 216: a dismissal has an author ──────────────────────────────────────

test('a dismissal records who and when', () => {
  // THE GAP THAT BIT. Ten suggestions were in the table during testing;
  // five read DISMISSED and only one had been dismissed by hand. Nothing
  // on the row could say what did the rest — the column held a verdict
  // with no author and no clock. The cause is still unexplained, which is
  // precisely the argument for recording it.
  const SQL216 = read('supabase/migrations/216_pms_a_dismissal_has_an_author.sql')
  assert.match(SQL216, /ADD COLUMN IF NOT EXISTS status_by uuid REFERENCES employees\(id\)/)
  assert.match(SQL216, /ADD COLUMN IF NOT EXISTS status_at timestamptz/)
  const body = SQL216.replace(/^\s*--.*$/gm, ' ').replace(/'[^']*'/g, "''")
  for (const f of [/^\s*UPDATE\s+\w/mi, /\bDELETE\s+FROM\b/i, /\bDROP\b/i]) {
    assert.ok(!f.test(body), `216 matches ${f}`)
  }
})

test('the dismissal survives 216 not having run', () => {
  // The dismissal matters more than its attribution: a missing column
  // must not lose the decision itself.
  const fn = PERF.slice(PERF.indexOf('const dismissSuggestion'),
                        PERF.indexOf('const rateAndApprove'))
  assert.match(fn, /status_by: employeeId/)
  assert.match(fn, /status_at: new Date\(\)\.toISOString\(\)/)
  assert.match(fn, /stamped\.error\s*\n?\s*\? await supabase/,
    'there is no fallback for a database without 216')
  // The fallback must still write the status.
  const fb = fn.slice(fn.indexOf('stamped.error'))
  assert.match(fb, /status: 'DISMISSED'/)
})
