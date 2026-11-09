// lib/te/__tests__/finance-gate.test.ts — one rule guards the Finance desk.
//
// WHAT WENT WRONG, AND WHY A TEST. The rule "who may open the Finance desk"
// was written down once, inline in app/api/te/finance/overview/route.ts, with
// a paragraph explaining that the Finance VIEW role must not be enough — on
// this data it lets somebody with no finance_team row read the whole company's
// money. Every OTHER Finance route then asked for exactly that grant:
// permitDesk(..., 'Finance', 'VIEW').
//
// So the strict gate guarded a read-only summary and the loose one guarded the
// rooms that move money. Measured against the live database:
//
//   Finance VIEW, no desk row — 6 roles, 7 active holders, three of them real
//   people (SRS9066, SSM-0001, SRS9047) — were refused /finance/overview and
//   got 200 from GET /payouts, which returns every batch with its items:
//   claim, employee, amount, bank reference. That route reads the table
//   directly, so unlike the writes there is no te_assert_finance underneath to
//   catch it.
//
//   Travel Claims FULL, no desk row — the mirror image: allowed to read the
//   whole desk through the overview and refused by every room in it.
//
// Neither spelling looks wrong on its own, which is the whole problem: both
// compile, both lint, both return a plausible status, and the two routes are
// 200 lines apart in different files. A reviewer sees one of them.
//
// This reads the routes as text. The test runner cannot load them (they import
// next/server), and the question is only which gate each one calls.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname
const API = `${ROOT}app/api/te`

/** Every route.ts under app/api/te. */
function routes(dir = API, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) routes(p, found)
    else if (name === 'route.ts') found.push(p)
  }
  return found
}

/** Source with its prose removed — a comment that QUOTES the old spelling must
 *  not read as a use of it. The first version of the sibling test for the ESS
 *  tab failed exactly that way, against correct code. */
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trimStart().startsWith('//'))
  .join('\n')

const short = (p: string) => p.slice(API.length + 1)

describe('the Finance desk has one gate', () => {
  it('no route asks for the Finance VIEW grant any more', () => {
    // This is the grant the overview's own comment rejects. A route that still
    // asks for it is a route that trusts less than the rest of the module.
    const offenders = routes()
      .filter(p => /permitDesk\(\s*'finance'/.test(code(p)))
      .map(short)
    assert.deepEqual(offenders, [],
      'these still use permitDesk(\'finance\', …) instead of permitFinanceDesk()')
  })

  it('every Finance route calls permitFinanceDesk', () => {
    // The seven that moved, plus the overview. Named explicitly so that adding
    // a Finance route without a gate shows up as a failure here rather than as
    // an open door.
    const expected = [
      'finance/overview/route.ts',
      'payouts/route.ts',
      'payouts/[id]/route.ts',
      'adjustments/route.ts',
      'adjustments/[id]/route.ts',
      'advances/[id]/route.ts',
      'periods/route.ts',
    ]
    for (const f of expected) {
      const src = code(`${API}/${f}`)
      assert.match(src, /t\.permitFinanceDesk\(\)/, `${f} should gate on permitFinanceDesk()`)
    }
  })

  it('the overview no longer carries its own copy of the rule', () => {
    const src = code(`${API}/finance/overview/route.ts`)
    assert.doesNotMatch(src, /t\.permit\('Finance'/,
      'the inline Finance permit should be gone; the shared gate owns that decision')
    assert.doesNotMatch(src, /onDesk\('finance'\)/,
      'the inline desk check should be gone too')
  })

  it('the gate itself accepts a desk place or full admin, and not Finance VIEW', () => {
    const src = readFileSync(`${ROOT}lib/te/server.ts`, 'utf8')
    const start = src.indexOf('async permitFinanceDesk()')
    assert.notEqual(start, -1, 'permitFinanceDesk should exist on the request helper')
    const body = src.slice(start, src.indexOf('},', start))
    assert.match(body, /onDesk\('finance'\)/, 'a place on the desk lets you in')
    assert.match(body, /holds\('Travel Claims',\s*'FULL'\)/, 'so does full admin of the module')
    assert.match(body, /holds\('Finance',\s*'FULL'\)/, 'so does the Finance role at FULL')
    assert.doesNotMatch(body, /'VIEW'/, 'VIEW must not be enough — that is the hole this closed')
    assert.match(body, /TeHttpError\(403/, 'and anybody else is refused')
  })

  it('the writes still have their own floor in SQL, which is what kept this to a read', () => {
    // The gate is the early, legible refusal. te_assert_finance is the one that
    // actually protects the money, and it is why a VIEW holder could list
    // batches but never create one.
    const migrations = `${ROOT}supabase/migrations`
    const sql = readdirSync(migrations)
      .filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(`${migrations}/${f}`, 'utf8'))
      .join('\n')
    for (const fn of ['te_payout_create', 'te_adjustment_add', 'te_advance_act', 'te_period_act']) {
      const at = sql.indexOf(`create or replace function ${fn}`)
      assert.notEqual(at, -1, `${fn} should exist`)
      const body = sql.slice(at, at + 2000)
      assert.match(body, /te_assert_finance\(/, `${fn} must assert finance membership itself`)
    }
  })
})
