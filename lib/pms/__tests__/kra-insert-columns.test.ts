// lib/pms/__tests__/kra-insert-columns.test.ts — the KRA insert names every
// column the table insists on.
//
// WHY THIS EXISTS. pms_employee_goals held zero rows for the entire life of the
// module. The window was open across three companies, the form validated
// perfectly — four to ten rows, weightages totalling exactly 100, a running
// bar, a per-row error list — and pressing "Send to my manager" produced:
//
//     null value in column "company_id" of relation "pms_employee_goals"
//     violates not-null constraint
//
// company_id is NOT NULL with no default. The component resolved it one
// function earlier to pick the right period and then dropped it. Before that
// the same insert was missing period_id, so an earlier set saved and could
// never be read back, because every other query filters on the period.
//
// Twice is a pattern, and the pattern is that nothing connects the table's
// requirements to this one call site. A form that validates everything the
// SCREEN knows about still cannot know what the DATABASE knows. So this test
// derives the requirement from the migration rather than restating it: add a
// NOT NULL column to pms_employee_goals tomorrow and this fails until the
// insert carries it.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING, deliberately. The prose above names
// company_id and period_id; so does the comment at the call site. A test that
// searched raw source would find those words in its own explanation and pass
// while the code stayed broken — which is exactly the failure it is meant to
// catch, and a mistake made more than once in this repo already.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** `--` to end of line, and /* … *\/ blocks. Applied to SQL and to TS/TSX:
 *  both use `--`-free block syntax for the latter, and `--` only appears in SQL. */
const stripSql = (s: string) => s.split('\n').map(l => l.split('--')[0]).join('\n')
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

/** Columns the table will refuse an insert without: NOT NULL and no DEFAULT to
 *  fall back on. Read out of the migration so the list cannot go stale. */
function requiredColumns(): string[] {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/066_pms_module.sql'), 'utf8')
  const m = /CREATE TABLE IF NOT EXISTS pms_employee_goals \(([\s\S]*?)\n\);/.exec(sql)
  assert.ok(m, 'pms_employee_goals must still be declared in 066 for this test to mean anything')
  return stripSql(m[1]).split('\n')
    .map(l => l.trim().replace(/,$/, ''))
    .filter(l => /^[a-z_]+\s/.test(l))
    .filter(l => /NOT NULL/i.test(l) && !/DEFAULT/i.test(l))
    .map(l => l.split(/\s+/)[0])
}

/** The component source, comments removed — see the header. */
const performanceSource = () =>
  stripTs(readFileSync(join(ROOT, 'components/ess/Performance.tsx'), 'utf8'))

describe('the KRA insert satisfies pms_employee_goals', () => {
  it('derives a non-empty requirement from the migration', () => {
    const req = requiredColumns()
    assert.ok(req.length >= 5, `expected several required columns, got ${req.join(', ')}`)
    // The two that were actually missing, so a refactor of this parser that
    // silently stops finding columns fails here rather than passing vacuously.
    for (const c of ['company_id', 'period_id']) {
      assert.ok(req.includes(c), `${c} is NOT NULL with no default and must be in the derived list`)
    }
  })

  it('names every required column, in the insert or in the row it spreads', () => {
    const src = performanceSource()

    // The insert spreads a row built by blankKra, so a column may be satisfied
    // either at the call site or by that factory. Both are code, neither is a
    // comment, and that is the whole point of stripping first.
    const insert = /\.from\('pms_employee_goals'\)\s*\.insert\(([\s\S]*?)\n  \}/.exec(src)
    assert.ok(insert, 'the insert call must still be findable; update this test if it moved')
    const blank = /const blankKra[\s\S]*?\}\)/.exec(src)
    assert.ok(blank, 'blankKra must still be findable; update this test if it moved')
    const supplied = insert[1] + blank[0]

    const missing = requiredColumns().filter(c => !new RegExp(`\\b${c}\\b`).test(supplied))
    assert.deepEqual(missing, [],
      `\n  pms_employee_goals refuses an insert without these, and the KRA submit does not name them:\n`
      + `    ${missing.join(', ')}\n`
      + `  Add them in submitKras, or to blankKra if they belong to the row.\n`)
  })

  it('does not hand a database constraint message to the employee', () => {
    const src = performanceSource()
    const submit = /const submitKras = async[\s\S]*?\n  \}/.exec(src)
    assert.ok(submit, 'submitKras must still be findable; update this test if it moved')
    // error.message is the raw Postgres text. It names a relation and a
    // constraint, which tells the person who just filled in four KRAs nothing
    // they can act on.
    assert.ok(!/setMsg\([^)]*error\.message/.test(submit[0]),
      'submitKras must not put error.message in front of the employee; say what happened and what to do')
  })
})
