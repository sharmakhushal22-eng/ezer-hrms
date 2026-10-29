// Do the status strings the app filters on actually exist in the schema?
//
// This is the only test here that reads the migration. It exists because a
// wrong status string is SILENT: PostgREST answers 200 with zero rows, the
// screen renders its empty state, and nothing anywhere says "that value is
// not in the CHECK constraint". Three of these were wrong on the first pass
// and none of them would have thrown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  PERIOD_STATUS, PERIOD_OPEN, GOAL_STATUS, GOAL_SENT, GOAL_AWAITING_RM,
  WORKFLOW, WORKFLOW_ORDER, reached, FILL, FILL_MEANING,
} from '../status.ts'

const SQL = readFileSync('supabase/migrations/066_pms_module.sql', 'utf8')

/**
 * The migration that most recently defines `object`, found by number rather
 * than by name.
 *
 * Naming a file is how the equivalent T&E test broke: it matched the literal
 * '156_te_journey_wording' and a renumber to 162_ turned a real assertion
 * into a silent pass. A view can also be redefined by a later migration, and
 * the one that matters is the last one.
 */
function latestDefining(object: string): { file: string; sql: string } {
  const dir = 'supabase/migrations'
  const hits = readdirSync(dir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => readFileSync(`${dir}/${f}`, 'utf8').includes(object))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  assert.ok(hits.length, `nothing defines ${object}`)
  const file = hits[hits.length - 1]
  return { file, sql: readFileSync(`${dir}/${file}`, 'utf8') }
}

/** The values a column's CHECK (col IN (...)) actually permits.
 *
 *  The character class must include DIGITS. Written as [A-Z_]+ it silently
 *  skips RM_L1_DONE and RM_L2_DONE — the quote-delimited match fails at the
 *  digit — and the test then reports a legal value as forbidden, which is a
 *  false failure pointing at correct code. */
function allowed(column: string): string[] {
  // No /s flag: the project targets below es2018, and [^)] already crosses
  // newlines, so it was decorative anyway.
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`)
  const m = re.exec(SQL)
  assert.ok(m, `no CHECK found for ${column} — did the migration change?`)
  return [...m![1].matchAll(/'([A-Z0-9_]+)'/g)].map(x => x[1])
}

test('the migration still constrains all three columns', () => {
  // If any of these disappears the tests below would vacuously pass.
  for (const c of ['status', 'workflow_status']) {
    assert.ok(new RegExp(`CHECK\\s*\\(\\s*${c}\\s+IN`).test(SQL), `${c} is unconstrained`)
  }
})

test('every period status the app knows is one the schema allows', () => {
  const ok = allowed('status')
  for (const v of Object.values(PERIOD_STATUS)) {
    assert.ok(ok.includes(v), `${v} is not a permitted period status`)
  }
})

test('ACTIVE is NOT a period status — the bug this file exists for', () => {
  const ok = allowed('status')
  assert.equal(ok.includes('ACTIVE'), false)
  assert.equal((PERIOD_OPEN as string[]).includes('ACTIVE'), false)
  assert.ok(PERIOD_OPEN.length > 0)
  for (const v of PERIOD_OPEN) assert.ok(ok.includes(v), `${v} not permitted`)
})

test('goal statuses are real, and SUBMITTED/APPROVED are not among them', () => {
  const ok = allowed('status')   // first CHECK(status IN ...) in the file
  const goals = [...SQL.matchAll(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/g)]
    .map(m => [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map(x => x[1]))
    .find(list => list.includes('DRAFT'))
  assert.ok(goals, 'goal status CHECK not found')
  for (const v of Object.values(GOAL_STATUS)) {
    assert.ok(goals!.includes(v), `${v} is not a permitted goal status`)
  }
  assert.equal(goals!.includes('SUBMITTED'), false, 'SUBMITTED was guessed and does not exist')
  assert.equal(goals!.includes('APPROVED'), false, 'APPROVED was guessed and does not exist')
  for (const v of [...GOAL_SENT, ...GOAL_AWAITING_RM]) {
    assert.ok(goals!.includes(v), `${v} not permitted`)
  }
  assert.ok(ok.length > 0)
})

test('every workflow value the app knows is one the schema allows', () => {
  const ok = allowed('workflow_status')
  for (const v of Object.values(WORKFLOW)) {
    assert.ok(ok.includes(v), `${v} is not a permitted workflow status`)
  }
  // and the ladder covers the whole vocabulary, so `reached` can never be
  // handed a legal value it does not understand
  for (const v of ok) assert.ok(WORKFLOW_ORDER.includes(v), `${v} missing from WORKFLOW_ORDER`)
})

test('reached() walks the ladder and refuses to guess', () => {
  assert.equal(reached(WORKFLOW.PUBLISHED, WORKFLOW.SELF_SUBMITTED), true)
  assert.equal(reached(WORKFLOW.SELF_SUBMITTED, WORKFLOW.SELF_SUBMITTED), true)
  assert.equal(reached(WORKFLOW.KRA_LOCKED, WORKFLOW.SELF_SUBMITTED), false)
  // An unknown status must never read as further along than it is.
  assert.equal(reached('WHATEVER', WORKFLOW.NOT_STARTED), false)
  assert.equal(reached(null, WORKFLOW.NOT_STARTED), false)
  assert.equal(reached(undefined, WORKFLOW.KRA_DRAFT), false)
})

test('every workflow value the roll-up can see maps to a fill status', () => {
  // KRA_LOCKED matched no branch in vw_pms_fill_status and fell through to
  // ELSE 'NOT_STARTED'. Observed live: four LOCKED KRAs at 100%, the KRA
  // one-to-one acknowledged both ways, self rating genuinely owed — reported
  // as NOT_STARTED, the same answer the view gives for somebody who never
  // opened the screen, and the state an admin escalates.
  //
  // Asserted against the SQL because the mapping lives there, not here. The
  // first branch keys on kra_count rather than the status, so it is excluded:
  // NOT_STARTED needs no mention by name.
  const { sql, file } = latestDefining('CREATE OR REPLACE VIEW vw_pms_fill_status')
  const view = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW vw_pms_fill_status'))
  const cases = view.slice(0, view.indexOf('AS fill_status'))
  for (const v of Object.values(WORKFLOW)) {
    if (v === WORKFLOW.NOT_STARTED) continue
    assert.ok(cases.includes(`'${v}'`),
      `${v} appears in no branch of vw_pms_fill_status (${file}), so a row in `
      + `that state falls through to ELSE and reports NOT_STARTED`)
  }
})

test('DRAFT_SAVED describes both states it now covers — in BOTH copies', () => {
  // 191 folded KRA_LOCKED in here. The sentence used to say "started writing,
  // nothing sent", which is plainly false about a set that is agreed and
  // frozen — and this string is what an HR admin reads to decide who to
  // chase, so a wrong one sends them after the wrong person.
  const m = FILL_MEANING[FILL.DRAFT_SAVED]
  assert.doesNotMatch(m, /started writing, nothing sent/i,
    'reworded in 191: it has to cover the locked case too')
  assert.match(m, /locked/i, 'must mention the locked case')
  assert.match(m, /nudge/i, 'the operational advice is the point of the sentence')

  // THE SECOND COPY. AdminTabs keeps FILL_MEANING_SHORT, trimmed to fit a
  // table cell — a deliberate variant, not a duplicate to delete. But the
  // first version of this test pinned only the long copy, so when 191
  // reworded that one, the tracker went on telling admins "Started, nothing
  // sent" about four LOCKED KRAs. A test that covers one of two copies of a
  // rule is how the rule drifts.
  //
  // Read from source because the file is .tsx and Node cannot load it.
  const tsx = readFileSync('components/pms/AdminTabs.tsx', 'utf8')
  const block = /const FILL_MEANING_SHORT[^{]*\{([^}]*)\}/.exec(tsx)
  assert.ok(block, 'FILL_MEANING_SHORT not found — renamed? point this test at it')
  const short = /DRAFT_SAVED:\s*'([^']*)'/.exec(block![1])
  assert.ok(short, 'no DRAFT_SAVED entry in FILL_MEANING_SHORT')
  assert.doesNotMatch(short![1], /nothing sent/i,
    'the short copy still claims nothing was sent, which is false once locked')
  assert.match(short![1], /nudge/i, 'the short copy keeps the operational advice')
})

test('§3.5: being rated is not being published', () => {
  // "Result publish hone se pehle rating, comments — kuch bhi visible nahi."
  // The employee's result screen decided this with
  // `visible_to_employee || final_rating != null`, so the second a HOD
  // finalised, the rating, the weighted score and every rater's row appeared
  // — before anybody chose to publish. Observed live on Shreya Singh's screen
  // while her workflow_status was still FINALISED.
  //
  // Finalising and publishing are adjacent rungs and that is the whole point:
  // the gap between them is where a manager holds the conversation.
  assert.equal(reached(WORKFLOW.FINALISED, WORKFLOW.PUBLISHED), false)
  assert.equal(reached(WORKFLOW.RM_L2_DONE, WORKFLOW.PUBLISHED), false)
  assert.equal(reached(WORKFLOW.PUBLISHED, WORKFLOW.PUBLISHED), true)
  // ACKNOWLEDGED is published plus the employee's own tick, so it still shows.
  assert.equal(reached(WORKFLOW.ACKNOWLEDGED, WORKFLOW.PUBLISHED), true)
})
