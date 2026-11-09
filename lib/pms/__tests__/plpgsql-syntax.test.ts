// Two plpgsql syntax errors that no amount of token counting will find.
//
// Both of these shipped to the user in migrations 193 and 194, and both were
// missed by the structural checks I had been running — balanced $$, balanced
// BEGIN/END, balanced parentheses, reconciled IF/THEN against ELSIF and CASE
// WHEN. All of those passed. They had to: neither mistake unbalances
// anything. They are only visible if you know the two specific rules.
//
//   1. RAISE's format must be a STRING LITERAL. `RAISE EXCEPTION 'a' || 'b'`
//      is a syntax error, not a runtime one. (`RAISE NOTICE '%', a || b` is
//      fine — there the || is in an ARGUMENT, which is a different position
//      entirely, and the first version of this check could not tell them
//      apart and cried wolf on four good T&E scripts.)
//
//   2. plpgsql scans an IF condition up to the FIRST `THEN`, and a CASE
//      expression contains its own. So `IF CASE x WHEN 1 THEN ... END THEN`
//      ends the condition after `CASE x WHEN 1`, and the parser then runs off
//      the end of the function — reported as "syntax error at end of input"
//      pointing at a line that is perfectly correct.
//
// This covers EVERY migration and verify script, not just the PMS ones,
// because the mistake is a property of plpgsql rather than of this module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/** Comments cannot contain code, and they discuss these very patterns. */
function strip(sql: string): string {
  return sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
}

function sqlFiles(): { file: string; sql: string }[] {
  const out: { file: string; sql: string }[] = []
  for (const dir of ['supabase/migrations', 'supabase/verify']) {
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const n of names.filter(f => f.endsWith('.sql'))) {
      out.push({ file: `${dir}/${n}`, sql: strip(readFileSync(`${dir}/${n}`, 'utf8')) })
    }
  }
  return out
}

const FILES = sqlFiles()

test('there are migrations to check at all', () => {
  // Guards the guard: a wrong path would make every test below vacuously pass.
  assert.ok(FILES.length > 50, `only found ${FILES.length} sql files — wrong path?`)
})

test("RAISE's format is a literal, never built with ||", () => {
  // A quoted literal immediately followed by || in the FORMAT position.
  const re = /RAISE\s+(?:EXCEPTION|NOTICE|WARNING)\s+'(?:[^']|'')*'\s*\|\|/gi
  const hits: string[] = []
  for (const { file, sql } of FILES) {
    for (const m of sql.matchAll(re)) {
      hits.push(`${file}:${sql.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(hits, [],
    'RAISE format must be a string literal — build the sentence in a variable '
    + 'and pass it through a single %')
})

test('a CASE expression is never used directly as an IF condition', () => {
  const hits: string[] = []
  for (const { file, sql } of FILES) {
    for (const m of sql.matchAll(/\bIF\s+CASE\b/gi)) {
      hits.push(`${file}:${sql.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(hits, [],
    'plpgsql ends the IF condition at the first THEN, which the CASE owns — '
    + 'assign the CASE to a boolean and test that')
})

test("RAISE uses % as its placeholder, not %s", () => {
  // `%s` consumes the argument on the % and leaves a stray 's' in the sentence.
  // Not a syntax error, so nothing fails — it just reads as nonsense.
  const hits: string[] = []
  for (const { file, sql } of FILES) {
    for (const m of sql.matchAll(/RAISE\s+(?:EXCEPTION|NOTICE|WARNING)\s+'(?:[^']|'')*%s/gi)) {
      hits.push(`${file}:${sql.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(hits, [], "plpgsql's RAISE placeholder is %, not %s")
})

test('a function body that opens $$ closes it', () => {
  // The one structural check that did hold, kept because it is cheap and an
  // unclosed body swallows every statement after it.
  for (const { file, sql } of FILES) {
    const n = (sql.match(/\$\$/g) ?? []).length
    assert.equal(n % 2, 0, `${file} has ${n} $$ markers — one is unclosed`)
  }
})
