// 221 — how many KPIs a KRA may hold is policy, not a constant.
//
// The TypeScript half of this feature is tested in kpi.test.ts. This file is
// about the SQL half and the join between them, because that is where the
// two previous attempts at this kind of change went wrong:
//
//   220 dropped a unique key while three upserts still named it, so every
//   rating write failed the moment the migration was applied. The covering
//   test asserted the OLD key and passed happily.
//
//   218 documented two columns that do not exist, and the test compared the
//   code against the COMMENT the code was written from — two sources agreeing
//   is not evidence when one is a copy of the other.
//
// So the checks here are deliberately about things that can DISAGREE: the
// migration against 074's deployed function body, the TypeScript defaults
// against the SQL defaults, and the sentences against the limits they quote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DEFAULT_RULES } from '../cycle.ts'

const read = (p: string) => readFileSync(p, 'utf8')
const M221 = read('supabase/migrations/221_pms_kpi_count_is_policy.sql')
const M074 = read('supabase/migrations/074_pms_not_found_guards.sql')

/** A function body out of a migration, by name. */
function fnOf(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(i >= 0, `${name} not found`)
  const j = sql.indexOf('END $$;', i)
  assert.ok(j > i, `${name} has no end`)
  return sql.slice(i, j + 'END $$;'.length)
}

/** Code only: comments are not behaviour, and a migration that EXPLAINS a
 *  rule in prose must not be able to satisfy a test that checks for it. */
const codeOnly = (sql: string) =>
  sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

// ── the columns ──────────────────────────────────────────────────────────

test('both columns are added, NOT NULL, with the requested defaults', () => {
  const body = codeOnly(M221)
  assert.match(body, /ADD COLUMN IF NOT EXISTS min_kpi_per_kra\s+int NOT NULL DEFAULT 1/)
  assert.match(body, /ADD COLUMN IF NOT EXISTS max_kpi_per_kra\s+int NOT NULL DEFAULT 5/)
})

test('the SQL defaults and the TypeScript fallback are the same numbers', () => {
  // TWO SOURCES THAT CAN DRIFT. DEFAULT_RULES is what every screen renders
  // against before the policy loads; the column default is what a policy
  // created later gets. If they disagree, a brand-new policy behaves unlike
  // the screen that described it, and nothing errors.
  const body = codeOnly(M221)
  const min = /min_kpi_per_kra\s+int NOT NULL DEFAULT (\d+)/.exec(body)
  const max = /max_kpi_per_kra\s+int NOT NULL DEFAULT (\d+)/.exec(body)
  assert.ok(min && max, 'the column defaults could not be read')
  assert.equal(Number(min![1]), DEFAULT_RULES.minKpi)
  assert.equal(Number(max![1]), DEFAULT_RULES.maxKpi)
  // And the request was specifically 1 and 5.
  assert.equal(DEFAULT_RULES.minKpi, 1)
  assert.equal(DEFAULT_RULES.maxKpi, 5)
})

test('the range cannot be inverted', () => {
  // min_kra_count/max_kra_count learned this in 066. Without the pair CHECK
  // an admin can save min 5 / max 3, and every KRA is then both too small
  // and too large with no setting that satisfies both.
  const body = codeOnly(M221)
  assert.match(body, /CONSTRAINT pms_policies_kpi_range CHECK/)
  assert.match(body, /max_kpi_per_kra >= min_kpi_per_kra/)
  assert.match(body, /min_kpi_per_kra >= 1/,
    'a minimum of 0 would mean a KRA with nothing to rate')
})

test('the constraint is added idempotently', () => {
  // ADD CONSTRAINT has no IF NOT EXISTS. Re-running the file must be a no-op,
  // not a duplicate_object error — the header promises SAFE TO RUN TWICE.
  const body = codeOnly(M221)
  const i = body.indexOf('pms_policies_kpi_range')
  const guard = body.slice(Math.max(0, i - 400), i)
  assert.match(guard, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint/,
    'the constraint is added without a pg_constraint guard')
})

// ── the ceiling ──────────────────────────────────────────────────────────

test('the ceiling trigger fires on INSERT only', () => {
  // THE WHOLE POINT. An UPDATE trigger would mean that lowering the maximum
  // froze every KRA already holding more than the new limit — the setting
  // change would brick live data instead of refusing the next write.
  const body = codeOnly(M221)
  assert.match(body, /CREATE TRIGGER trg_pms_kpi_count\s*\n\s*BEFORE INSERT ON pms_goal_kpi/)
  assert.ok(!/BEFORE INSERT OR UPDATE ON pms_goal_kpi/.test(body),
    'the trigger fires on UPDATE, which freezes KPIs written under a looser limit')
  assert.match(body, /DROP TRIGGER IF EXISTS trg_pms_kpi_count/,
    're-running the file would fail on the existing trigger')
})

test('the trigger resolves the policy through the period, not the employee', () => {
  // pms_resolve_policy(employee) answers "what covers this person TODAY",
  // which would re-rule a KRA mid-period when somebody changes department.
  // pms_validate_kras reads the period's policy, and so must this.
  const fn = codeOnly(fnOf(M221, 'pms_kpi_count_within_policy'))
  assert.match(fn, /FROM pms_periods pe/)
  assert.match(fn, /JOIN pms_policies p ON p\.id = pe\.policy_id/)
  assert.ok(!/pms_resolve_policy/.test(fn),
    'the trigger resolves the policy by employee, so a transfer re-rules an '
    + 'open cycle')
})

test('no policy means no ceiling, rather than a refusal nobody can explain', () => {
  const fn = codeOnly(fnOf(M221, 'pms_kpi_count_within_policy'))
  assert.match(fn, /IF v_max IS NULL THEN RETURN NEW; END IF;/,
    'a period with no policy would refuse every KPI write with a message '
    + 'pointing at the wrong screen')
})

test('the refusal names the limit and the screen that owns it', () => {
  // "violates check constraint" sends the reader to a DBA. The person who
  // hits this can usually fix it themselves, if told where.
  const fn = fnOf(M221, 'pms_kpi_count_within_policy')
  assert.match(fn, /RAISE EXCEPTION/)
  assert.match(fn, /Setup and /)
  assert.match(fn, /Configuration/)
  assert.match(fn, /%/, 'the message does not interpolate the actual maximum')
})

// ── the floor ────────────────────────────────────────────────────────────

test('the floor is checked at submission, never per INSERT', () => {
  // A floor enforced per-INSERT refuses the FIRST KPI of every KRA, because
  // one is fewer than one until the row lands. It has to be checked when
  // somebody asserts the set is finished.
  const trig = codeOnly(fnOf(M221, 'pms_kpi_count_within_policy'))
  assert.ok(!/min_kpi_per_kra/.test(trig),
    'the trigger reads the minimum, which would refuse the first KPI of '
    + 'every KRA')
  const val = codeOnly(fnOf(M221, 'pms_validate_kpis'))
  assert.match(val, /min_kpi/, 'pms_validate_kpis does not check the floor')
  assert.match(val, /max_kpi/, 'pms_validate_kpis does not check the ceiling')
})

test('the validator reports an empty KRA before it reports arithmetic', () => {
  // A KRA with no KPIs also fails the weightage sum (0 <> 25). "Add a KPI"
  // is the sentence that leads somewhere; "its KPIs total 0%" tells somebody
  // to balance a set that does not exist yet.
  const val = codeOnly(fnOf(M221, 'pms_validate_kpis'))
  const empty = val.indexOf('kpi_count = 0')
  const sum = val.indexOf('kpi_total <> ')
  assert.ok(empty > 0 && sum > 0, 'both branches should exist')
  assert.ok(empty < sum, 'the weightage complaint comes before "has no KPI"')
})

test('the validator cannot silently pass for a period that does not exist', () => {
  // 074 exists because pms_validate_kras returned VALID when no policy was
  // found. The same shape was available here: reading the limits with
  // `FROM pms_periods JOIN pms_policies` yields no row for an unknown
  // period, the CROSS JOIN then matches nothing, and the function reports
  // zero faults — "no such period" reading as "every KRA is fine".
  const val = codeOnly(fnOf(M221, 'pms_validate_kpis'))
  const pol = val.slice(val.indexOf('WITH pol AS'), val.indexOf(', gk AS'))

  // Both limits must be COALESCEd SCALAR SUBQUERIES. That form yields a
  // value whatever the subquery finds, so the enclosing SELECT — which has
  // no FROM of its own — always produces exactly one row.
  assert.equal((pol.match(/COALESCE\(\(SELECT/g) ?? []).length, 2,
    'the limits are not both read as COALESCEd scalar subqueries, so pol '
    + 'may return no row')

  // And nothing after the last subquery may re-introduce a table at the
  // CTE's own level: a trailing `FROM pms_periods WHERE pe.id = …` there
  // would make pol empty again for an unknown period, which is the whole
  // bug. Checking the tail rather than the whole block, because the
  // subqueries legitimately contain FROM.
  const tail = pol.slice(pol.lastIndexOf('AS max_kpi'))
  assert.ok(!/\bFROM\b/.test(tail),
    'the pol CTE has a FROM of its own after the subqueries, so an unknown '
    + 'period yields no row and the CROSS JOIN empties the whole result')
})

test('the gate actually consults the validator', () => {
  // Until 221, pms_validate_kpis was called by nothing but the verify
  // script. A rule in a function nobody runs is not a rule.
  const lock = codeOnly(fnOf(M221, 'pms_lock_kras'))
  assert.match(lock, /FROM pms_validate_kpis\(p_employee_id, p_period_id\)/)
  assert.match(lock, /IF v_err IS NOT NULL THEN RETURN 'BLOCKED: ' \|\| v_err/)
})

// ── the reproduction ─────────────────────────────────────────────────────

test('221 reproduces 074\'s pms_lock_kras exactly, apart from the KPI check', () => {
  // THIS TEST EXISTS BECAUSE THE FIRST DRAFT FAILED IT.
  //
  // 221 has to restate pms_lock_kras in order to add three lines to it.
  // Retyping the rest from memory dropped `updated_at = now()` and the ENTIRE
  // `UPDATE pms_overall_rating SET workflow_status='KRA_LOCKED'` — so locking
  // a KRA set would have stopped moving the appraisal forward, and the cycle
  // would have stalled after the manager locked with nothing to say why.
  //
  // Diffed against 074 rather than eyeballed, because the dropped statement
  // was invisible in review: what was there looked complete.
  const strip = (t: string) => t.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--'))
    .map(l => l.trim()).join('\n')

  const old = strip(fnOf(M074, 'pms_lock_kras')).split('\n')
  const now = strip(fnOf(M221, 'pms_lock_kras')).split('\n')

  const added = now.filter(l => !old.includes(l))
  const removed = old.filter(l => !now.includes(l))

  assert.deepEqual(removed, [],
    '221 DROPPED these lines from the deployed pms_lock_kras:\n  '
    + removed.join('\n  '))
  assert.equal(added.length, 3,
    '221 added more than the three KPI lines it is allowed:\n  '
    + added.join('\n  '))
  assert.ok(added.every(l => /pms_validate_kpis|v_err|SELECT error_msg/.test(l)),
    'the added lines are not the KPI check:\n  ' + added.join('\n  '))
})

test('221 is the newest definition of pms_lock_kras', () => {
  // The last CREATE OR REPLACE wins. If a later migration redefines it from
  // the 074 text, the KPI check silently disappears again.
  const dir = 'supabase/migrations'
  const latest = readdirSync(dir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => read(`${dir}/${f}`).includes('CREATE OR REPLACE FUNCTION pms_lock_kras('))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop()
  assert.equal(latest, '221_pms_kpi_count_is_policy.sql',
    `${latest} redefines pms_lock_kras after 221, which would drop the KPI gate`)
})

// ── the admin screen ─────────────────────────────────────────────────────

test('the admin screen edits both columns, and the config tab shows them', () => {
  const editor = read('components/pms/AdminEditor.tsx')
  assert.match(editor, /Minimum KPIs per KRA/)
  assert.match(editor, /Maximum KPIs per KRA/)
  assert.match(editor, /set\('min_kpi_per_kra'/)
  assert.match(editor, /set\('max_kpi_per_kra'/)
  // The read-only Configuration tab has to agree with Setup & Controls, or
  // the two admin screens describe different rules.
  const tabs = read('components/pms/AdminTabs.tsx')
  assert.match(tabs, /KPIs per KRA/,
    'the PMS Configuration tab does not show the KPI range')
})

test('the KRA form reads the limits from the policy, not the defaults', () => {
  const form = read('components/pms/EmployeeTabs.tsx')
  // canAddKpi/canRemoveKpi own the limits; a hardcoded comparison is the bug.
  assert.match(form, /canAddKpi\(kpisOf\(k\), rules\)/)
  assert.match(form, /canRemoveKpi\(kpisOf\(k\), rules\)/)
  assert.ok(!/disabled=\{kpisOf\(k\)\.length <= 1\}/.test(form),
    'the remove button still hardcodes a floor of 1')
  // And the four KRA validators are passed rules too — they default to
  // DEFAULT_RULES, so omitting the argument silently restores 4/10/100/5.
  for (const call of ['checkKras(kras, rules)', 'meter(check, rules)',
                      'canAdd(kras, rules)', 'canDelete(kras, rules)']) {
    assert.ok(form.includes(call), `${call} — the policy is not being passed`)
  }
})

// ── reading a policy from a database that is behind the code ─────────────
//
// REPORTED, FROM THE BROWSER: `[pms] could not read the policy: [42703]
// column pms_policies.min_kpi_per_kra does not exist`.
//
// I knew this window existed and judged it acceptable because the screens
// "degrade gracefully to DEFAULT_RULES". That was wrong, and the error above
// is what wrong looks like: every one of these readers treats a policy READ
// ERROR as a policy ABSENCE, so one unknown column costs the custom chain,
// the one-to-one rule, the finaliser, carry-forward and the eligibility
// cut-off together — and the screen then renders confidently against the
// shipped defaults rather than showing anything is missing.

import { FRESH_POLICY_COLS, withoutFreshCols } from '../policy.ts'

test('stripping a young column leaves valid select syntax', () => {
  // First, middle, last, and embedded — the four positions these columns
  // actually occupy across the four readers.
  assert.equal(withoutFreshCols('min_kpi_per_kra,a,b'), 'a,b')
  assert.equal(withoutFreshCols('a,min_kpi_per_kra,b'), 'a,b')
  assert.equal(withoutFreshCols('a,b,min_kpi_per_kra'), 'a,b')
  assert.equal(withoutFreshCols('a, min_kpi_per_kra, b'), 'a, b')
  assert.equal(withoutFreshCols('id, min_kpi_per_kra, max_kpi_per_kra, one_to_one_mandatory'),
    'id, one_to_one_mandatory')
  // Embedded, as the cycle header reads them.
  assert.equal(
    withoutFreshCols('status, pms_policies(frequency, min_kpi_per_kra, max_kpi_per_kra)'),
    'status, pms_policies(frequency)')
  // A select with none of them is returned untouched.
  assert.equal(withoutFreshCols('a,b,c'), 'a,b,c')
  // No stray commas anywhere.
  for (const s of ['min_kpi_per_kra,a', 'a,max_kpi_per_kra', 'a,min_kpi_per_kra,b']) {
    const out = withoutFreshCols(s)
    assert.ok(!/,\s*,/.test(out) && !/^\s*,/.test(out) && !/,\s*$/.test(out),
      `stripping "${s}" produced invalid syntax: "${out}"`)
  }
})

test('a column name that merely contains another is not mangled', () => {
  // \b matters, and there are TWO regexes — one taking the comma after the
  // name, one taking the comma before it. A longer name can collide with
  // either, from either end, so both directions need a case.
  //
  // Found by mutation: dropping \b from the first regex survived a test that
  // only exercised a SUFFIX collision, because that case is caught by the
  // second regex. A test that passes for the wrong reason is not a test.
  assert.equal(withoutFreshCols('a,max_kpi_per_kra_override,b'),
    'a,max_kpi_per_kra_override,b', 'a longer name starting with the column')
  assert.equal(withoutFreshCols('a,custom_max_kpi_per_kra,b'),
    'a,custom_max_kpi_per_kra,b', 'a longer name ending with the column')
  assert.equal(withoutFreshCols('legacy_min_kpi_per_kra,a'),
    'legacy_min_kpi_per_kra,a', 'a longer name ending with the column, first')
  assert.equal(withoutFreshCols('a,min_kpi_per_kra_v2'),
    'a,min_kpi_per_kra_v2', 'a longer name starting with the column, last')
})

test('every policy reader retries without the young columns', () => {
  // THE FIX FOR THE REPORTED ERROR. All four readers react to a failed
  // policy read by treating the policy as absent, so all four need the
  // retry — not just the dashboard, which was the only one that had it.
  const READERS = [
    'app/dashboard/pms/page.tsx',
    'app/api/ess/pms/route.ts',
    'components/ess/Performance.tsx',
    'components/pms/CycleHeader.tsx',
  ]
  for (const f of READERS) {
    const src = read(f)
    assert.match(src, /withoutFreshCols\(/,
      `${f} selects the young columns but never retries without them — on a `
      + 'database behind the code it loses the WHOLE policy, not just those '
      + 'columns')
  }
})

test('the young-column list still covers 221', () => {
  assert.ok((FRESH_POLICY_COLS as readonly string[]).includes('min_kpi_per_kra'))
  assert.ok((FRESH_POLICY_COLS as readonly string[]).includes('max_kpi_per_kra'))
})
