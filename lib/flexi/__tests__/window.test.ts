// lib/flexi/__tests__/window.test.ts — the flexi claim window: the 1st–20th of every month on
// its own, the uploader always on screen, and a bill refused only by the date or a ₹0 balance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { claimWindowFor, windowOpenAt, windowDaysLeft, nextOpening, closingDay } from '../window.ts'

const at = (iso: string) => new Date(iso)
const src = (p: string) => readFileSync(p, 'utf8')

test('open from the 1st to the 20th, IST, every month', () => {
  assert.equal(windowOpenAt(at('2026-11-01T00:10:00+05:30')), true, '1st just after midnight')
  assert.equal(windowOpenAt(at('2026-11-20T23:59:00+05:30')), true, '20th late evening')
  assert.equal(windowOpenAt(at('2026-11-21T00:00:30+05:30')), false, '21st')
  assert.equal(windowOpenAt(at('2026-11-30T12:00:00+05:30')), false, 'month end')
  assert.equal(windowOpenAt(at('2026-10-31T19:00:00Z')), true, '00:30 IST on 1 Nov is open although UTC still says 31 Oct')
  assert.equal(windowDaysLeft(at('2026-11-05T10:00:00+05:30')), 16)
  assert.equal(windowDaysLeft(at('2026-11-20T10:00:00+05:30')), 1)
  assert.equal(windowDaysLeft(at('2026-11-25T10:00:00+05:30')), 0)
  assert.equal(nextOpening(at('2026-11-25T10:00:00+05:30')), '2026-12-01')
  assert.equal(nextOpening(at('2026-12-25T10:00:00+05:30')), '2027-01-01')
  assert.equal(closingDay(at('2026-11-05T10:00:00+05:30')), '2026-11-20')
})

test('the month row spans the 1st–20th, OPEN, in the right financial year', () => {
  const w = claimWindowFor(at('2026-11-05T10:00:00+05:30'))
  assert.deepEqual([w.year, w.month, w.fy, w.open_day, w.close_day, w.status], [2026, 11, '2026-27', 1, 20, 'OPEN'])
  assert.equal(w.opens_at, '2026-10-31T18:30:00.000Z')
  assert.equal(w.closes_at, '2026-11-20T18:29:59.000Z')
  assert.equal(claimWindowFor(at('2027-02-10T10:00:00+05:30')).fy, '2026-27', 'Feb belongs to the FY that started in April')
})

test('both submit doors enforce the window and the balance, not a hand-opened row', () => {
  for (const p of ['app/api/flexi/claims/route.ts', 'app/api/ess/flexi/route.ts']) {
    const s = src(p)
    assert.ok(/resolveFlexi\(/.test(s) && /if \(!f\.windowOpen\)/.test(s), `${p} checks the 1st–20th`)
  }
  const legacy = src('app/api/flexi/claims/route.ts')
  assert.ok(/head\.available <= 0/.test(legacy) && /Number\(claim_amount\) > head\.available/.test(legacy), 'the web door enforces the balance too')
  assert.ok(!/\.eq\('id', window_id\)\.single\(\)/.test(legacy), 'no longer trusts the caller’s window_id')
  assert.ok(/action === 'TOGGLE_WINDOW'[\s\S]{0,300}status: 410/.test(legacy), 'nobody closes it by hand')
  const server = src('lib/flexi/resolve-server.ts')
  assert.ok(/currentClaimWindow\(sb, companyId\)/.test(server) && /windowOpenAt\(new Date\(\)\)/.test(server))
})

test('the ESS uploader is always on screen, locked after the 20th or at a ₹0 balance', () => {
  const s = src('components/ess/FlexiClaims.tsx')
  assert.ok(!/isOpen && billTypeOptions\.length > 0 &&/.test(s), 'no longer hidden')
  assert.ok(/const canSubmit = windowOpen && hasBalance/.test(s))
  assert.ok(/<fieldset disabled=\{!canSubmit\}/.test(s), 'locked, not removed')
  assert.ok(!/status === 'nopolicy'\) return/.test(s), 'shown even before any component has a limit')
})
