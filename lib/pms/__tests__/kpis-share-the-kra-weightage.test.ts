// 222 — a KPI has no weightage of its own; its KRA's is split equally.
//
// The TypeScript half is tested in kpi.test.ts. This file is about the SQL
// half and the join between them: that the two compute the SAME weight, that
// the gates actually refuse, and that restating two deployed functions did
// not quietly drop a line out of either.
//
// That last one is not hypothetical. 221 restated pms_lock_kras and the first
// draft lost the UPDATE that advances the workflow — the cycle would have
// stalled after the manager locked, with nothing to say why. 222 restates two
// functions, so it gets the same diff, twice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { shareOf, lines, type Kpi, type KraWithKpis } from '../kpi.ts'
import { score } from '../scoring.ts'

const read = (p: string) => readFileSync(p, 'utf8')
const DIR = 'supabase/migrations'
const M222 = read(`${DIR}/222_pms_kpis_share_the_kra_weightage.sql`)
const M197 = read(`${DIR}/197_pms_chain_approve_and_reject.sql`)

function fnOf(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(i >= 0, `${name} not found`)
  const j = sql.indexOf('END $$;', i)
  const k = sql.indexOf('$$;', i)
  const end = j > i ? j + 'END $$;'.length : k + '$$;'.length
  return sql.slice(i, end)
}

const codeOnly = (sql: string) =>
  sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

/** The newest migration that defines a function. The last one wins at apply
 *  time, so a later file silently restoring the old body is a real risk. */
function newestDefiner(name: string): string | undefined {
  return readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => read(`${DIR}/${f}`).includes(`CREATE OR REPLACE FUNCTION ${name}(`))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop()
}

// ── the column is retired, not read ──────────────────────────────────────

test('the weightage column is kept, and nothing drops it', () => {
  const body = codeOnly(M222)
  assert.ok(!/DROP COLUMN/i.test(body),
    '222 drops a column — the decision was to retire it and keep the data')
  assert.match(M222, /COMMENT ON COLUMN pms_goal_kpi\.weightage/)
  assert.match(M222, /RETIRED by 222/)
})

test('no function in 222 reads pms_goal_kpi.weightage', () => {
  // The whole point. A retired column that something still reads is worse
  // than one that was dropped, because the two halves disagree silently.
  for (const name of ['pms_score', 'pms_validate_kpis', 'pms_unrated_kpis']) {
    const fn = codeOnly(fnOf(M222, name))
    assert.ok(!/\bk\.weightage\b/.test(fn),
      `${name} reads k.weightage, which is retired`)
  }
})

// ── the score ────────────────────────────────────────────────────────────

test('222 is the newest definition of pms_score', () => {
  assert.equal(newestDefiner('pms_score'),
    '222_pms_kpis_share_the_kra_weightage.sql')
})

test('pms_score divides the KRA weightage by the KPI count', () => {
  const fn = codeOnly(fnOf(M222, 'pms_score'))
  assert.match(fn, /g\.weightage::numeric/)
  assert.match(fn, /COUNT\(\*\) OVER \(PARTITION BY k\.goal_id\)/)
  // EVERY KPI, not just the rated ones. Counting only the rated would let a
  // one-of-three-rated KRA carry its full weightage on a third of the
  // evidence — the join to pms_reviews must stay OUTSIDE the window.
  const cte = fn.slice(fn.indexOf('WITH shared'), fn.indexOf(')\n  SELECT'))
  assert.ok(!/pms_reviews/.test(cte),
    'the share is computed over rated KPIs only, so an unrated KPI inflates '
    + 'the others')
  // Division by zero gives null, not an error.
  assert.match(fn, /NULLIF\(COUNT/)
})

test('the SQL weight and the TypeScript weight are the same arithmetic', () => {
  // TWO IMPLEMENTATIONS OF ONE FORMULA, which is the shape that drifts.
  // shareOf is w/n; pms_score is g.weightage / COUNT(*). This checks they
  // agree on the property that matters — the KRA's total is preserved
  // however it is split — because the SQL cannot be run from here.
  for (const [w, n] of [[30, 3], [25, 2], [10, 3], [100, 7], [20, 1]] as const) {
    const share = shareOf(w, n)
    assert.ok(Math.abs(share * n - w) < 1e-9,
      `${n} shares of ${w} came to ${share * n}`)
  }
})

test('one KPI per KRA scores exactly as the KRA did — the neutrality claim', () => {
  // 222's header promises every appraisal on record is untouched, on the
  // grounds that 220 gave every existing KRA exactly one KPI. For n = 1,
  // w/1 = w, so the flat list is identical to the KRA list.
  const kpi = (seq: number): Kpi => ({ seq_no: seq, kpi_metric: `m${seq}`, target_value: 't' })
  const tree: KraWithKpis[] = [
    { seq_no: 1, kra_title: 'A', category: 'BUSINESS', weightage: 40, kpis: [kpi(1)] },
    { seq_no: 2, kra_title: 'B', category: 'BUSINESS', weightage: 35, kpis: [kpi(1)] },
    { seq_no: 3, kra_title: 'C', category: 'BUSINESS', weightage: 25, kpis: [kpi(1)] },
  ]
  const r = { 1: 4, 2: 3, 3: 5 } as Record<number, number>
  const split = lines(tree, (_k, g) => ({ final: r[g.seq_no] }))
  assert.deepEqual(split.map(l => l.weightage), [40, 35, 25])
  const whole = tree.map(g => ({
    goalId: String(g.seq_no), title: g.kra_title, category: 'BUSINESS' as const,
    weightage: g.weightage, final: r[g.seq_no],
  }))
  assert.equal(score(split, 'final'), score(whole, 'final'))
})

// ── the KPI rules lose the balance, keep the counts ──────────────────────

test('222 is the newest definition of pms_validate_kpis', () => {
  assert.equal(newestDefiner('pms_validate_kpis'),
    '222_pms_kpis_share_the_kra_weightage.sql')
})

test('the validator no longer checks a weightage balance', () => {
  const fn = codeOnly(fnOf(M222, 'pms_validate_kpis'))
  assert.ok(!/kpi_total <> /.test(fn),
    'the balance check survived — equal shares cannot fail to add up, so it '
    + 'can only ever fire on a rounding artefact')
  assert.ok(!/SUM\(k\.weightage\)/.test(fn), 'it still sums the retired column')
  // The counts, which ARE what "filling all the minimum kras and kpis" means.
  assert.match(fn, /kpi_count < pol\.min_kpi/)
  assert.match(fn, /kpi_count > pol\.max_kpi/)
  assert.match(fn, /kpi_count = 0/)
})

test('the validator keeps its signature, so existing callers still work', () => {
  // pms_lock_kras (221) and the verify scripts select named columns off this.
  // Dropping kpi_total would break them at run time, not at apply time.
  const fn = fnOf(M222, 'pms_validate_kpis')
  for (const col of ['goal_id', 'seq_no', 'kra_title', 'kra_weightage',
                     'kpi_total', 'kpi_count', 'error_msg']) {
    assert.ok(fn.includes(col), `the returned column ${col} is gone`)
  }
})

test('the validator still cannot silently pass an unknown period', () => {
  // 221's lesson, carried forward: pol must yield exactly one row.
  const fn = codeOnly(fnOf(M222, 'pms_validate_kpis'))
  const pol = fn.slice(fn.indexOf('WITH pol AS'), fn.indexOf(', gk AS'))
  assert.equal((pol.match(/COALESCE\(\(SELECT/g) ?? []).length, 2)
  const tail = pol.slice(pol.lastIndexOf('AS max_kpi'))
  assert.ok(!/\bFROM\b/.test(tail), 'the pol CTE grew a FROM of its own')
})

// ── every rung rates every KPI ───────────────────────────────────────────

test('pms_unrated_kpis counts only real, submitted ratings', () => {
  const fn = codeOnly(fnOf(M222, 'pms_unrated_kpis'))
  assert.match(fn, /r\.submitted = true/,
    'a draft counts as a rating, so a half-filled form can be submitted')
  assert.match(fn, /r\.rating IS NOT NULL/,
    'a row with a comment and no rating counts as rated')
  assert.match(fn, /g\.status <> 'SENT_BACK'/,
    'a sent-back KRA is counted, so nobody can ever satisfy the gate')
})

test('both gates consult it, and 222 is their newest definition', () => {
  for (const name of ['pms_chain_submit', 'pms_chain_approve']) {
    assert.equal(newestDefiner(name), '222_pms_kpis_share_the_kra_weightage.sql',
      `${name} is redefined after 222, which would drop the rating gate`)
    const fn = codeOnly(fnOf(M222, name))
    assert.match(fn, /pms_unrated_kpis\(/, `${name} does not consult the gate`)
    assert.match(fn, /v_left > 0/, `${name} reads the count but does not act`)
  }
})

test('the employee is gated on SELF, each manager on their own rung', () => {
  // A manager gated on 'SELF' would be blocked by the employee's omissions
  // and waved through on their own.
  assert.match(codeOnly(fnOf(M222, 'pms_chain_submit')),
    /pms_unrated_kpis\(p_employee_id, p_period_id, 'SELF'\)/)
  assert.match(codeOnly(fnOf(M222, 'pms_chain_approve')),
    /pms_unrated_kpis\(p_employee_id, p_period_id, v_stage\)/)
})

test('HR is exempt from the rating gate, and only HR', () => {
  // HR's move at that stage is publication and changes no rating, so there
  // is no HR rating that could be missing. The LAST REVIEWER is not exempt:
  // they are on a real rung when their approval calls pms_finalise.
  const fn = codeOnly(fnOf(M222, 'pms_chain_approve'))
  const gate = fn.slice(fn.indexOf('v_left := pms_unrated_kpis') - 200,
                        fn.indexOf('v_left := pms_unrated_kpis'))
  assert.match(gate, /IF v_stage <> 'HR' THEN/,
    'the gate is not scoped to non-HR rungs')
})

// ── the reproductions ────────────────────────────────────────────────────

test('222 reproduces 197\'s two functions exactly, apart from the gate', () => {
  // 221's near-miss, guarded twice. Retyping a deployed function from memory
  // dropped a whole UPDATE last time and what was left looked complete, so
  // these are diffed rather than read.
  const strip = (t: string) => t.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--'))
    .map(l => l.trim())

  for (const name of ['pms_chain_submit', 'pms_chain_approve']) {
    const old = strip(fnOf(M197, name))
    const now = strip(fnOf(M222, name))
    const removed = old.filter(l => !now.includes(l))
    assert.deepEqual(removed, [],
      `222 DROPPED these lines from the deployed ${name}:\n  ` + removed.join('\n  '))

    const added = now.filter(l => !old.includes(l))
    assert.ok(added.length <= 6,
      `222 added ${added.length} lines to ${name}, more than the gate needs:\n  `
      + added.join('\n  '))
    assert.ok(added.every(l => /v_left|pms_unrated_kpis|BLOCKED|rating|RETURN format/.test(l)),
      `an added line in ${name} is not part of the gate:\n  ` + added.join('\n  '))
  }
})

test('pms_chain_approve still locks the weightages and advances the stage', () => {
  // The two things the 221 near-miss would have silently removed, asserted
  // directly rather than relying on the diff alone.
  const fn = codeOnly(fnOf(M222, 'pms_chain_approve'))
  assert.match(fn, /pms_lock_kras\(p_employee_id, p_period_id, p_actor_id\)/)
  assert.match(fn, /PERFORM pms_refresh_workflow/)
  assert.match(fn, /SET chain_stage = COALESCE\(v_next, 'DONE'\)/)
  assert.match(fn, /RETURN 'APPROVED:'/)
})

test('pms_chain_submit still clears a previous rejection', () => {
  const fn = codeOnly(fnOf(M222, 'pms_chain_submit'))
  assert.match(fn, /sent_back_to = NULL/)
  assert.match(fn, /sent_back_reason = NULL/)
  assert.match(fn, /RETURN 'SUBMITTED:'/)
})

// ── the screen enforces the same three rules ─────────────────────────────

test('the KRA form gates on the whole rule, not just the weightage', () => {
  const form = read('components/pms/EmployeeTabs.tsx')
  assert.match(form, /submitGate\(/, 'the form does not use the gate')
  assert.ok(!/const canGo = check\.canSubmit/.test(form),
    'the button still reads checkKras alone, which cannot see KPI faults')
  // And the fault list shown is the one the button counts.
  assert.match(form, /gate\.faults\.map/,
    'the banner lists checkKras faults while the button refuses for more')
  assert.match(form, /gate\.faults\.length/)
})

test('the form no longer offers a per-KPI weightage input', () => {
  const form = read('components/pms/EmployeeTabs.tsx')
  assert.ok(!/setKpi\(i, j, \{ weightage:/.test(form),
    'the KPI weightage input survived — a KPI has none')
  assert.ok(!/suggestKpiSplit/.test(form), 'the Split evenly button survived')
  assert.match(form, /shareOf\(k\.weightage, kpisOf\(k\)\.length\)/,
    'the share is not computed from the KRA weightage')
})

// ── the manager's stepper ────────────────────────────────────────────────
//
// 222 made every rung rate every KPI. The manager panel was still built one
// row per KRA, and it was wrong in four separate places at once — each one
// invisible on a set where every KRA had a single measure, which is every set
// on record until somebody adds a second.

const MGR = read('components/pms/ManagerTabs.tsx')
const PERF = read('components/ess/Performance.tsx')

test('the panel builds its comparison from measures, not KRAs', () => {
  // cmp drives the progress bar, the chips, the "needs a reason" pill, the
  // unsaved-work guard AND the approval gate. Built per KRA, every one of
  // them said 2 while the rater was being asked for five answers.
  assert.match(MGR, /compareRatings\(measuresOf\(lines\)/,
    'the comparison is still built per KRA')
  assert.match(MGR, /weightage: kpi\.share/,
    'the comparison weights by the KRA, so a 3-measure KRA counts triple')
})

test('every count on the panel comes from the one comparison', () => {
  // THE BUG CLASS: three counters on one screen, each deriving its own
  // answer. The footer said "2 still unrated" while the bar said "5 to go".
  const footer = MGR.slice(MGR.indexOf('const allRated = total > 0'))
  assert.ok(!/\(lines \?\? \[\]\)\.filter\(l => l\.goalId && rate\?\.\[l\.goalId\]/.test(MGR),
    'the footer still counts KRAs with a goal-keyed rate lookup')
  assert.match(MGR, /const rated = cmp\.lines\.filter\(l => l\.mine != null\)/)
  assert.match(MGR, /const total = cmp\.total/)
  assert.ok(footer.length > 0)
})

test('the stepper is for rating, and the flat list stays for reading', () => {
  // Paginating a record away from somebody who opened the panel to look is
  // worse than a long page.
  assert.match(MGR, /\) : rating && onRate \? \(/,
    'the stepper is not gated on the viewer being a rater')
  assert.match(MGR, /<KraStepper lines=\{lines\}/)
})

test('the stepper does not own the step — the chips do', () => {
  // A control and the thing it controls cannot both hold the position, or
  // each can be right while the other is wrong. The first draft had a second
  // row of dots inside the stepper, beside the panel's existing chips.
  const fn = MGR.slice(MGR.indexOf('export function KraStepper'),
                       MGR.indexOf('export function KraStepper') + 2000)
  assert.ok(!/useState\(0\)/.test(fn), 'the stepper holds its own position')
  assert.match(fn, /at: number/)
  assert.match(fn, /onAt: \(n: number\) => void/)
  assert.ok(!/pms-step-dots/.test(MGR),
    'the duplicate dot row survived beside the panel chips')
})

test('the KRA rollup uses kraRating rather than a second mean', () => {
  // Two implementations of one formula is how the stepper and the saved
  // score start disagreeing about the same appraisal.
  assert.match(MGR, /kraRating\(/)
  const fn = MGR.slice(MGR.indexOf('const rollup = (l: KraLine)'),
                       MGR.indexOf('const rollup = (l: KraLine)') + 500)
  assert.ok(!/reduce\(/.test(fn), 'the rollup computes its own mean')
})

// ── the load and the save ────────────────────────────────────────────────

test('the self rating is read per measure, not collapsed onto the goal', () => {
  // A Map keyed on goal_id kept whichever row came back LAST, so a KRA with
  // three measures showed the manager one self score standing in for three —
  // and which one depended on row order, which Postgres does not promise.
  assert.match(PERF, /selfByKpi/)
  assert.match(PERF, /\.select\('goal_id,kpi_id,achievement_value,rating,comments'\)/,
    'the self ratings are selected without kpi_id')
})

test('the manager\'s own saved ratings are keyed on the measure', () => {
  assert.match(PERF, /\.select\('goal_id,kpi_id,rating,comments'\)/)
  assert.match(PERF, /String\(x\.kpi_id\),\n\s*\{ rating:/,
    'kraRate is still keyed on goal_id, so reopening collapses three answers')
})

test('the save writes one row per measure and resolves nothing', () => {
  // kpiOf() took a goal_id and went looking for the KRA's ONLY KPI, returning
  // null — and silently writing NOTHING — the moment a KRA had two. The whole
  // feature was unreachable through it.
  assert.ok(!/const kpiOf = \(goalId: string\)/.test(PERF),
    'the single-KPI resolver survived, so multi-measure KRAs write nothing')
  assert.match(PERF, /measures\.map\(\(\{ kra, kpi \}\) => \(\{/)
  assert.match(PERF, /kpi_id: kpi\.kpiId/)
  assert.match(PERF, /onConflict: 'period_id,employee_id,kpi_id,rater_role'/)
})

test('the approve gate counts measures, matching pms_chain_approve', () => {
  // Counting KRAs here would let the screen wave through a set the database
  // then refuses — the manager is told it went, and it did not.
  assert.match(PERF, /const measures = measuresOf\(lines\)/)
  assert.match(PERF, /missing = measures\.filter\(m => kraRate\[m\.kpi\.kpiId\]\?\.rating == null\)/)
})

test('the queries are named for what they hold', () => {
  // `const [g, rv, kp]` had rv bound to the KPI query and kp to the reviews
  // query — the opposite of what the names read as. setPanelKpis(kp.data)
  // therefore filled the KPI list with review rows, which carry no `id`, so
  // every kpi_id resolved to the string "undefined" and Postgres refused the
  // upsert. Manager ratings had not saved since 220.
  assert.match(PERF, /const \[goalsQ, kpisQ, selfQ\] = await Promise\.all/)
  assert.ok(!/const \[g, rv, kp\]/.test(PERF), 'the misleading names came back')
  assert.ok(!/panelKpis/.test(PERF),
    'panelKpis is still here — it is dead state now that the tree carries '
    + 'the measures, and a stale buffer is what caused the bug above')
})
