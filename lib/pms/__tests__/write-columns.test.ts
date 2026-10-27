// lib/pms/__tests__/write-columns.test.ts — every PMS write names the columns
// its table insists on, and the roster counts from rows rather than counters.
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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** `--` to end of line, and /* … *\/ blocks. Applied to SQL and to TS/TSX:
 *  both use `--`-free block syntax for the latter, and `--` only appears in SQL. */
const stripSql = (s: string) => s.split('\n').map(l => l.split('--')[0]).join('\n')
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

/** Columns the table will refuse an insert without: NOT NULL and no DEFAULT to
 *  fall back on. Read out of the migration so the list cannot go stale. */
function requiredColumns(table: string): string[] {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/066_pms_module.sql'), 'utf8')
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)
  assert.ok(m, `${table} must still be declared in 066 for this test to mean anything`)
  return stripSql(m![1]).split('\n')
    .map(l => l.trim().replace(/,$/, ''))
    .filter(l => /^[a-z_]+\s/.test(l))
    .filter(l => /NOT NULL/i.test(l) && !/DEFAULT/i.test(l))
    .map(l => l.split(/\s+/)[0])
}

/** Every write the employee portal makes, and the table it has to satisfy.
 *
 *  ALL THREE WERE BROKEN THE SAME WAY, which is why this is a list and not a
 *  single case. company_id is NOT NULL on every pms_* table and none of the
 *  three supplied it; pms_one_to_one also wanted manager_id, which was never
 *  even fetched. Adding a fourth write to this component means adding a line
 *  here, and the test will say what the table wants. */
const WRITES: { handler: string; table: string; extra?: RegExp }[] = [
  // The KRA rows are spread from a factory, so that counts as naming them.
  { handler: 'submitKras', table: 'pms_employee_goals', extra: /const blankKra[\s\S]*?\}\)/ },
  { handler: 'submitSelf', table: 'pms_reviews' },
  { handler: 'logDiscussion', table: 'pms_one_to_one' },
]

/** The body of one handler, comments already stripped. */
function handlerBody(src: string, name: string): string {
  const m = new RegExp(`const ${name} = async[\\s\\S]*?\\n  \\}`).exec(src)
  assert.ok(m, `${name} must still be findable in Performance.tsx; update this test if it moved`)
  return m![0]
}

/** The component source, comments removed — see the header. */
const performanceSource = () =>
  stripTs(readFileSync(join(ROOT, 'components/ess/Performance.tsx'), 'utf8'))

describe('every PMS write satisfies its table', () => {
  it('derives a non-empty requirement from the migration', () => {
    const req = requiredColumns('pms_employee_goals')
    assert.ok(req.length >= 5, `expected several required columns, got ${req.join(', ')}`)
    // The two that were actually missing, so a refactor of this parser that
    // silently stops finding columns fails here rather than passing vacuously.
    for (const c of ['company_id', 'period_id']) {
      assert.ok(req.includes(c), `${c} is NOT NULL with no default and must be in the derived list`)
    }
    // And the column that made fixing company_id alone insufficient.
    assert.ok(requiredColumns('pms_one_to_one').includes('manager_id'),
      'pms_one_to_one requires manager_id; a one-to-one names both people')
  })

  for (const { handler, table, extra } of WRITES) {
    it(`${handler} names every column ${table} insists on`, () => {
      const src = performanceSource()
      let supplied = handlerBody(src, handler)
      if (extra) {
        const m = extra.exec(src)
        assert.ok(m, `the spread source for ${handler} must still be findable`)
        supplied += m![0]
      }
      const missing = requiredColumns(table).filter(c => !new RegExp(`\\b${c}\\b`).test(supplied))
      assert.deepEqual(missing, [],
        `\n  ${table} refuses a write without these, and ${handler} does not name them:\n`
        + `    ${missing.join(', ')}\n`)
    })

    it(`${handler} does not hand a database constraint message to the person`, () => {
      const body = handlerBody(performanceSource(), handler)
      // error.message is the raw Postgres text. It names a relation and a
      // constraint, which tells the person who just filled in four KRAs
      // nothing they can act on.
      assert.ok(!/setMsg\(\s*error\.message\s*\)/.test(body),
        `${handler} must not put error.message in front of the employee; say what happened and what to do`)
    })
  }
})

describe('the roster counts from the rows, not from counters nobody writes', () => {
  /** Columns that exist on pms_overall_rating but that no migration ever
   *  assigns. Derived, so the day somebody adds a trigger this test stops
   *  objecting on its own. */
  function neverWritten(cols: string[]): string[] {
    const dir = join(ROOT, 'supabase/migrations')
    const sql = readdirSync(dir).filter(f => f.endsWith('.sql'))
      .map(f => stripSql(readFileSync(join(dir, f), 'utf8'))).join('\n')
    // An assignment looks like `col =` or names the column in an INSERT list
    // that also carries VALUES. Reading it (SELECT ... col) does not count.
    return cols.filter(c => !new RegExp(`\\b${c}\\s*=`, 'i').test(sql))
  }

  it('kra_count and total_weightage are still written by nothing', () => {
    // If this fails, something now maintains them and the roster could read
    // them again — which would be fine, and this test should then be deleted
    // rather than worked around.
    assert.deepEqual(neverWritten(['kra_count', 'total_weightage']).sort(),
      ['kra_count', 'total_weightage'],
      'a migration now assigns one of these; re-check whether useRoster should trust it')
  })

  it('useRoster does not select them', () => {
    const src = performanceSource()
    const m = /function useRoster[\s\S]*?\n\}/.exec(src)
    assert.ok(m, 'useRoster must still be findable; update this test if it moved')
    for (const c of ['kra_count', 'total_weightage']) {
      assert.ok(!new RegExp(`['"\`][^'"\`]*\\b${c}\\b`).test(m![0]),
        `useRoster selects ${c}, which no migration ever writes. It read 0 for every`
        + ' employee, so a manager was told "No KRAs written yet" about somebody'
        + ' whose own screen showed four. Count from pms_employee_goals instead.')
    }
  })

  it('whether the one-to-one happened is read from pms_one_to_one', () => {
    const src = performanceSource()
    const m = /function useRoster[\s\S]*?\n\}/.exec(src)
    assert.ok(/pms_one_to_one/.test(m![0]),
      'oneToOneDone must come from pms_one_to_one and both acknowledgements —'
      + ' it was inferred from a weightage total, which is not what a one-to-one is'
      + ' and rested on a counter nothing writes, so it was false for everybody.')
  })
})
