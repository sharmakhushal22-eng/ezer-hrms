// Two bugs in the bulk publish, found by reading the feature as SRS9047
// (Kiran Reddy, HR Head).
//
// Both have the same shape: a screen that says a result is ready to go out
// when something else will refuse it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { publishFaults } from '../publishGate.ts'
import { split as bulkSplit, type BulkRow } from '../bulkPublish.ts'

const read = (p: string) => readFileSync(p, 'utf8')

// ── 1. the preview applied four of the five gate rules ───────────────────
//
// BulkPublish built every BulkRow with `improvementRequired: false`, under a
// comment claiming "the band's own rule travels with the row". It does not:
// PublishRow carries no such field. So somebody on a band that mandates
// improvement feedback, with none written, was listed under "Ready to
// publish" and counted on the confirm button — and publishMany, which
// computes the rule properly from bandList, then refused them. The outcome
// banner reported that refusal among the SERVER's, which it was not.

const row = (o: Partial<BulkRow>): BulkRow => ({
  employeeId: 'e1', code: 'SRS0001', name: 'A Person',
  finalRating: 2, appreciation: 'well done', improvement: '',
  // The real HrFinalRow column names — 211 reads these off pms_overall_rating.
  signedOff: true,
  hrFinal: { hr_final_confirmed_at: '2026-11-04T00:00:00Z', hr_management_discussed: true },
  ...o,
} as BulkRow)

test('the gate blocks a mandatory-improvement row with nothing written', () => {
  // The rule itself, so the rest of this file is about whether the screen
  // asks it rather than whether it works.
  assert.deepEqual(publishFaults({ ...row({}), improvementRequired: false }), [])
  const faults = publishFaults({ ...row({}), improvementRequired: true })
  assert.equal(faults.length, 1)
  assert.match(faults[0], /Improvement feedback is mandatory/)
})

test('a row needing improvement feedback is blocked, not listed as ready', () => {
  const s = bulkSplit([row({ improvementRequired: true } as Partial<BulkRow>)])
  assert.equal(s.ready.length, 0, 'the preview counts it as ready to publish')
  assert.equal(s.blocked.length, 1)
  assert.match(s.blocked[0].faults[0], /Improvement feedback is mandatory/)
})

test('the bulk preview computes the band rule instead of hardcoding false', () => {
  const ui = read('components/pms/AdminTabs.tsx')
  const at = ui.indexOf('function BulkPublish')
  const body = ui.slice(at, at + 3000)
  assert.ok(!/improvementRequired: false/.test(body),
    'BulkPublish still hardcodes improvementRequired, so its preview applies '
    + 'four of the five gate rules and over-reports readiness')
  assert.match(body,
    /improvementRequired: !!bands\.find\(b => b\.value === r\.finalRating\)\?\.improvementMandatory/,
    'the band rule is not computed the way the single card computes it')
  // The band list has to actually reach the component.
  assert.match(body, /bands\?: \{ value: number; label: string; improvementMandatory\?: boolean \}\[\]/)
  assert.match(ui, /<BulkPublish[\s\S]{0,220}bands=\{bands\}/,
    'PublishTab renders BulkPublish without passing bands')
})

test('the card and bulk now ask the band the same question', () => {
  // The whole reason publishGate.ts exists is that the two paths must not
  // drift. This pins the one input that had drifted.
  const ui = read('components/pms/AdminTabs.tsx')
  const card = /const improvementRequired = !!band\?\.improvementMandatory/.test(ui)
  assert.ok(card, 'the single card no longer derives the rule from the band')
  const at = ui.indexOf('function BulkPublish')
  assert.match(ui.slice(at, at + 3000), /\?\.improvementMandatory/)
})

// ── 2. a regression I shipped, and the guard that now catches it ────────
//
// I read 193's allowlist, saw chain_stage missing, and wrote 225 to add it.
// 193 was not the deployed version. The chain is:
//
//     193  narrowed the lock so a finalised result could be delivered
//     195  stopped it comparing GENERATED columns Postgres has not computed
//     197  added chain_stage to the allowlist, onward to HR or DONE
//     225  rebuilt from 193 — dropping 195 and 197
//
// So the column was already allowed, and 225 reintroduced the bug 195 exists
// to fix. Applied, it refused immediately:
//
//     Record is read-only (employee exited and rating finalised).
//     Cannot change: is_readonly, self_vs_final_gap
//
// My covering test said "225 reproduces 193 exactly, apart from chain_stage"
// and it was true. It compared against the base I had chosen, so it
// certified the mistake instead of catching it.
//
// 226 restores 197's function verbatim. The tests below compute the previous
// definer from the directory rather than naming one, so a migration built on
// the wrong base fails whatever base its author believed in.

const DIR = 'supabase/migrations'

function fnOf(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(i >= 0, `${name} not found`)
  return sql.slice(i, sql.indexOf('END $$;', i) + 'END $$;'.length)
}
const codeOnly = (sql: string) =>
  sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

/** Every migration defining a function, oldest first. */
function definers(name: string): string[] {
  return readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => read(`${DIR}/${f}`).includes(`CREATE OR REPLACE FUNCTION ${name}(`))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

test('the read-only guard is restored to what was actually deployed', () => {
  const chain = definers('pms_block_readonly')
  assert.equal(chain[chain.length - 1], '226_pms_restore_readonly_guard.sql')
  // 226 IS 197's function, copied. Not retyped, not improved.
  assert.equal(fnOf(read(`${DIR}/226_pms_restore_readonly_guard.sql`), 'pms_block_readonly'),
               fnOf(read(`${DIR}/197_pms_chain_approve_and_reject.sql`), 'pms_block_readonly'),
               '226 is not byte-identical to 197 — it is a restore, nothing else')
})

test('195\'s generated-column fix is in the deployed guard', () => {
  // THE REGRESSION ITSELF. self_vs_final_gap is GENERATED ALWAYS, and
  // Postgres fills generated columns AFTER every BEFORE trigger — so NEW
  // holds NULL while OLD holds the stored value, the diff sees a change on
  // every update, and a default-deny check refuses. Without this exclusion
  // no locked record can be published at all.
  const chain = definers('pms_block_readonly')
  const live = codeOnly(fnOf(read(`${DIR}/${chain[chain.length - 1]}`), 'pms_block_readonly'))
  assert.match(live, /is_generated = 'ALWAYS'/,
    'the guard compares generated columns again — every publish of a locked '
    + 'record will be refused naming self_vs_final_gap')
  assert.match(live, /to_jsonb\(OLD\) - v_allowed - v_generated/)
  assert.match(live, /to_jsonb\(NEW\) - v_allowed - v_generated/)
})

test('197\'s chain_stage allowance is in the deployed guard', () => {
  // The thing 225 was written to add, which had been there since 197 —
  // and wider: the chain hands a settled record to HR before publication
  // moves it to DONE, so narrowing it to DONE alone breaks that handover.
  const chain = definers('pms_block_readonly')
  const live = codeOnly(fnOf(read(`${DIR}/${chain[chain.length - 1]}`), 'pms_block_readonly'))
  assert.match(live, /'chain_stage'\]/, 'chain_stage is not in the allowlist')
  assert.match(live, /NEW\.chain_stage NOT IN \('HR','DONE'\)/,
    'the onward rule is narrower than 197 had it')
})

test('every column the publish writes is one the live guard allows', () => {
  // Derived from the write rather than listed, so adding a column to the
  // publish without allowing it fails here instead of in production.
  const page = read('app/dashboard/pms/page.tsx')
  const upd = page.slice(page.indexOf("workflow_status: 'PUBLISHED'"))
  const written = [...upd.slice(0, 220).matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1])
  assert.ok(written.includes('workflow_status') && written.includes('chain_stage'),
    `could not read the publish write: ${written.join(', ')}`)
  const chain = definers('pms_block_readonly')
  const live = codeOnly(fnOf(read(`${DIR}/${chain[chain.length - 1]}`), 'pms_block_readonly'))
  const allow = live.slice(live.indexOf('v_allowed'), live.indexOf('v_generated'))
  for (const col of written) {
    assert.ok(allow.includes(`'${col}'`),
      `publishing writes ${col}, which the read-only lock does not allow`)
  }
})

test('a restated function is generated from the version actually deployed', () => {
  // THE RULE THAT WOULD HAVE CAUGHT 225.
  //
  // A migration that restates a function is generated FROM some earlier copy
  // of it, and it inherits that copy's lines. So the version it most closely
  // resembles is the version it was built from — and that has to be the one
  // immediately before it, the one actually deployed.
  //
  //   225  most resembled 193, but 197 was deployed   -> wrong base
  //   224  most resembles 223, which was deployed     -> fine, even though
  //                                                      it rewrote a message
  //   226  identical to 197                           -> a declared revert
  //
  // A revert is the one legitimate way to resemble something older, and it is
  // recognisable: the body matches that older version exactly.
  for (const name of ['pms_block_readonly', 'pms_commit_rating_upload']) {
    const chain = definers(name)
    assert.ok(chain.length >= 2, `${name} has no history to check`)
    const latest = chain[chain.length - 1]
    const prev = chain[chain.length - 2]
    const body = (f: string) => fnOf(read(`${DIR}/${f}`), name)
    const strip = (t: string) => codeOnly(t).split('\n').map(l => l.trim()).filter(Boolean)
    const live = strip(body(latest))

    // An exact revert to any earlier version is allowed and self-evident.
    if (chain.slice(0, -1).some(f => body(f) === body(latest))) continue

    // SYMMETRIC difference. Counting only what the candidate has and the new
    // file lacks is backwards: an ancestor several steps back is fully
    // contained in its descendants, so it always scores zero. What marks the
    // base is that the two are alike in BOTH directions.
    const distance = (f: string) => {
      const c = strip(body(f))
      return c.filter(l => !live.includes(l)).length
           + live.filter(l => !c.includes(l)).length
    }
    const nearest = chain.slice(0, -1)
      .map(f => ({ f, d: distance(f) }))
      .sort((a, b) => a.d - b.d)[0]

    assert.equal(nearest.f, prev,
      `${latest} resembles ${nearest.f} (${nearest.d} lines dropped) more than `
      + `${prev} (${distance(prev)} dropped), but ${prev} is the version actually `
      + 'deployed. It was generated from the wrong base — which is exactly how '
      + '225 silently reverted 195 and 197.')
  }
})

test('225 is the shape that rule rejects, and 226 is the shape it allows', () => {
  // Pinning both cases, so the rule above cannot be loosened into one that
  // would have let 225 through.
  const name = 'pms_block_readonly'
  const chain = definers(name)
  const body = (f: string) => fnOf(read(`${DIR}/${f}`), name)
  const strip = (t: string) => codeOnly(t).split('\n').map(l => l.trim()).filter(Boolean)

  const m225 = chain.find(f => f.startsWith('225_'))
  assert.ok(m225, '225 is gone — this test is about why it was wrong')
  const before225 = chain.slice(0, chain.indexOf(m225!))
  assert.ok(!before225.some(f => body(f) === body(m225!)),
    '225 matches an earlier version exactly, so it would read as a revert')
  const live225 = strip(body(m225!))
  const dist225 = (f: string) => {
    const c = strip(body(f))
    return c.filter(l => !live225.includes(l)).length
         + live225.filter(l => !c.includes(l)).length
  }
  const near225 = before225.map(f => ({ f, d: dist225(f) })).sort((a, b) => a.d - b.d)[0]
  assert.match(near225.f, /^193_/,
    'the point of 225 was that it was built from 193 while 197 was deployed')
  assert.match(before225[before225.length - 1], /^197_/)

  // 226 is the revert arm.
  const m226 = chain[chain.length - 1]
  assert.ok(chain.slice(0, -1).some(f => body(f) === body(m226)),
    '226 is not identical to any earlier version, so it is not a revert')
})

test('the verify script exercises the two things 225 deleted', () => {
  // A script that only re-read prosrc would have passed under 225 as easily
  // as now. These are the behavioural checks: a frozen row with a REAL
  // generated value, moved onward both ways and refused backwards.
  const v = read('supabase/verify/226_pms_readonly_guard_verify.sql')
  assert.match(v, /^BEGIN;/m, 'the verify script is not transactional')
  assert.match(v, /^ROLLBACK;/m, 'the verify script does not roll back')
  // 195: the fixture must have BOTH scores, or the generated column is null
  // on both sides and the comparison passes vacuously — 195's own header
  // records six consecutive false ALLOWEDs from exactly that mistake.
  assert.match(v, /o\.self_score IS NOT NULL/)
  assert.match(v, /o\.final_score IS NOT NULL/)
  assert.match(v, /is_generated = ''ALWAYS''/,
    'nothing checks that generated columns are still excluded')
  // 197: both allowed destinations, and one that is not.
  assert.match(v, /SET chain_stage = 'DONE'/)
  assert.match(v, /SET chain_stage = 'HR'/,
    'the HR handover 225 narrowed away is not exercised')
  assert.match(v, /SET chain_stage = 'RM_L1'/,
    'nothing checks the column is still refused going backwards')
  assert.match(v, /SET final_rating = 1/, 'nothing checks the lock still locks')
  // And it must not transition workflow_status, or an earlier trigger answers
  // and the reading is about that trigger instead.
  const fn = v.slice(v.indexOf('verify_readonly_guard'), v.indexOf('$fn$;'))
  assert.ok(!/SET workflow_status = 'PUBLISHED'/.test(fn),
    'the script transitions workflow_status, so the publish triggers answer '
    + 'and the read-only guard is never reached')
})
