// The policy's KPI range refuses in plain words, on both sides.
//
// ── WHAT WENT WRONG ──────────────────────────────────────────────────────
//
// Saving minimum 6 against maximum 5 from Setup & Controls put this in front
// of an administrator, verbatim:
//
//   new row for relation "pms_policies" violates check constraint
//   "pms_policies_kpi_range"
//
// The write was correctly refused — 221's CHECK did its job — but the
// message names no field, no value and nothing to do about it. The form had
// offered no objection either: the two inputs carry min/max attributes, and
// on a number input those drive the spinners and :invalid styling only, so a
// typed 6 went straight to the database.
//
// ── WHY NOT JUST MAP THE CONSTRAINT NAME TO A SENTENCE ───────────────────
//
// Because ONE constraint covers THREE mistakes:
//
//   min_kpi_per_kra >= 1
//   AND max_kpi_per_kra >= min_kpi_per_kra
//   AND max_kpi_per_kra <= 20
//
// so any single translation of the name would have misreported two of them.
// policyKpiRangeFault judges the pair and says which. The tests below hold
// the three messages APART, because a refusal that does not distinguish them
// is the bug this fixed, only politer.
//
// SQL still decides. These tests assert the TypeScript agrees with the
// CHECK, never that it replaces it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { policyKpiRangeFault, KPI_PER_KRA_CEILING } from '../kpi.ts'

// ── the pair, judged ─────────────────────────────────────────────────────

test('a workable range has no fault', () => {
  assert.equal(policyKpiRangeFault(1, 5), null)   // the defaults
  assert.equal(policyKpiRangeFault(1, 1), null)   // max may equal min
  assert.equal(policyKpiRangeFault(3, 3), null)
  assert.equal(policyKpiRangeFault(1, 20), null)  // the ceiling itself
})

test('each of the three clauses gets its own message', () => {
  const below  = policyKpiRangeFault(0, 5)    // min < 1
  const cross  = policyKpiRangeFault(6, 5)    // max < min
  const over   = policyKpiRangeFault(1, 21)   // max > ceiling

  for (const [what, msg] of [['min<1', below], ['max<min', cross],
                             ['max>ceiling', over]] as const) {
    assert.ok(msg, `${what} should be refused`)
    assert.ok(!/check constraint|pms_policies|relation/i.test(msg!),
      `${what} leaks the database's wording: ${msg}`)
  }

  // The point of the whole exercise: three distinct explanations.
  assert.equal(new Set([below, cross, over]).size, 3,
    'two clauses share a message, so the refusal cannot say which rule was '
    + 'broken — which is what the raw constraint already failed to do')
})

test('the crossed-pair message quotes both numbers', () => {
  // "The maximum cannot be below the minimum" alone sends somebody to look
  // at a screen whose inputs may both have been clamped on display.
  const msg = policyKpiRangeFault(6, 5)!
  assert.match(msg, /\b6\b/)
  assert.match(msg, /\b5\b/)
})

test('the ceiling message names the ceiling', () => {
  const msg = policyKpiRangeFault(1, 50)!
  assert.match(msg, new RegExp(`\\b${KPI_PER_KRA_CEILING}\\b`))
  assert.match(msg, /\b50\b/)
})

test('counts have to be whole numbers, and numbers at all', () => {
  assert.ok(policyKpiRangeFault(1.5, 5), 'a fractional minimum is not a count')
  assert.ok(policyKpiRangeFault(1, 4.5), 'a fractional maximum is not a count')
  assert.ok(policyKpiRangeFault(null, 5))
  assert.ok(policyKpiRangeFault(1, undefined))
  assert.ok(policyKpiRangeFault(NaN, 5))
  // A string that is a clean integer is what an <input type=number> yields
  // through Number(), so it must pass rather than be called "not a number".
  assert.equal(policyKpiRangeFault('2' as unknown as number,
                                   '4' as unknown as number), null)
})

// ── the TypeScript agrees with the CHECK ─────────────────────────────────

test('the three clauses match 221 exactly', () => {
  const sql = readFileSync(join(process.cwd(),
    'supabase/migrations/221_pms_kpi_count_is_policy.sql'), 'utf8')
  const m = sql.match(/ADD CONSTRAINT pms_policies_kpi_range CHECK \(([\s\S]*?)\);/)
  assert.ok(m, 'the constraint is no longer in 221 in the shape this reads')
  const check = m![1].replace(/\s+/g, ' ')

  assert.match(check, /min_kpi_per_kra >= 1/)
  assert.match(check, /max_kpi_per_kra >= min_kpi_per_kra/)
  assert.match(check, new RegExp(`max_kpi_per_kra <= ${KPI_PER_KRA_CEILING}`),
    `the SQL ceiling and KPI_PER_KRA_CEILING have drifted apart; the form `
    + `would then promise something the database refuses`)

  // And the boundaries the SQL draws are the ones the function draws. If a
  // migration moved the ceiling, the line above fails first and names why.
  assert.equal(policyKpiRangeFault(1, KPI_PER_KRA_CEILING), null)
  assert.ok(policyKpiRangeFault(1, KPI_PER_KRA_CEILING + 1))
})

// ── both sides use it ────────────────────────────────────────────────────

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

test('the route refuses with it, after reading the stored row', () => {
  const route = code(readFileSync(join(process.cwd(),
    'app/api/pms/admin/route.ts'), 'utf8'))
  const i = route.indexOf("case 'policy_update'")
  assert.ok(i > 0, 'policy_update has moved')
  const body = route.slice(i, route.indexOf("case '", i + 10))

  assert.ok(/policyKpiRangeFault\(/.test(body),
    'policy_update does not consult policyKpiRangeFault, so a posted body '
    + 'that never reached the browser gets the raw constraint again')

  // The merge is the subtle half: a PATCH sending only the maximum still has
  // to hold against the stored minimum. Judging only what was sent would
  // pass writes the database then rejects.
  assert.ok(/from\('pms_policies'\)[\s\S]*?select\(/.test(body),
    'policy_update never reads the current row, so a partial update is '
    + 'judged on half the pair')
  assert.ok(/\?\?\s*cur\.data\.min_kpi_per_kra/.test(body)
         && /\?\?\s*cur\.data\.max_kpi_per_kra/.test(body),
    'the posted fields are not merged over the stored ones')
})

test('the browser explains it and will not let the save run', () => {
  const ui = code(readFileSync(join(process.cwd(),
    'components/pms/AdminEditor.tsx'), 'utf8'))
  assert.ok(/const kpiFault = policyKpiRangeFault\(/.test(ui),
    'PolicyPanel does not compute the fault')
  assert.ok(/disabled=\{!!kpiFault\}/.test(ui),
    'the save button is not disabled while the pair is impossible, so the '
    + 'form still posts a write the database will refuse')
  assert.ok(/\{kpiFault\s*$|\{kpiFault\s*\?/m.test(ui),
    'the fault is computed but never rendered, so the button goes dead with '
    + 'nothing on screen to say why — worse than the raw error it replaced')
})
