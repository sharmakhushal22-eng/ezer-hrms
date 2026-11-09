// ezerlms.com serves Learning and nothing else: no HRMS page, no HRMS API, no cron.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { lmsSiteRoute } from '../site.ts'
import { issueHandoff, verifyHandoff, HANDOFF_TTL_MS } from '../sso.ts'
import { verifyEssToken, issueEssToken } from '../../ess-session.ts'
import { verifyCandidateToken } from '../candidate-session.ts'

describe('LMS site routes', () => {
  it('serves Learning screens from the root', () => {
    assert.deepEqual(lmsSiteRoute('/'), { do: 'rewrite', to: '/learning' })
    assert.deepEqual(lmsSiteRoute('/catalog'), { do: 'rewrite', to: '/learning/catalog' })
    assert.deepEqual(lmsSiteRoute('/studio/courses/abc'), { do: 'rewrite', to: '/learning/studio/courses/abc' })
  })
  it('redirects old /learning addresses to the root', () => {
    assert.deepEqual(lmsSiteRoute('/learning'), { do: 'redirect', to: '/' })
    assert.deepEqual(lmsSiteRoute('/learning/live/42'), { do: 'redirect', to: '/live/42' })
  })
  it('never shows an HRMS page', () => {
    for (const p of ['/dashboard', '/dashboard/payroll', '/ess', '/ess/leave', '/ess-login', '/joining/x', '/salary-view/x', '/onboarding/abc'])
      assert.deepEqual(lmsSiteRoute(p), { do: 'rewrite', to: `/learning${p}` }, p)
  })
  it('answers only the APIs Learning needs', () => {
    for (const p of ['/api/lms/me/dashboard', '/api/lms/sso/redeem', '/api/ess-auth/login', '/api/version'])
      assert.deepEqual(lmsSiteRoute(p), { do: 'pass' }, p)
    for (const p of ['/api/cron/lms-daily', '/api/cron/offer-followup', '/api/payroll/run', '/api/db-export', '/api/versions', '/api/lmsx'])
      assert.deepEqual(lmsSiteRoute(p), { do: 'refuse' }, p)
  })
  it('keeps the public Learning links and static files working', () => {
    for (const p of ['/learn/abc', '/learn/verify/XYZ', '/learn-scorm/t/index.html', '/_next/data/x.json', '/pdf.worker.min.mjs', '/icon.png'])
      assert.deepEqual(lmsSiteRoute(p), { do: 'pass' }, p)
    assert.deepEqual(lmsSiteRoute('/learnx'), { do: 'rewrite', to: '/learning/learnx' })
  })
})

describe('HRMS → LMS hand-off code', () => {
  before(() => { process.env.ESS_SESSION_SECRET = 'test-secret' })

  it('round-trips both kinds of sign-in', () => {
    assert.deepEqual(verifyHandoff(issueHandoff({ kind: 'ess', employeeId: 'emp-1' })), { kind: 'ess', employeeId: 'emp-1' })
    assert.deepEqual(verifyHandoff(issueHandoff({ kind: 'legacy', userId: 'u-1', email: 'a@b.c' })), { kind: 'legacy', userId: 'u-1', email: 'a@b.c' })
  })
  it('dies after a minute', () => {
    const t0 = Date.now()
    const code = issueHandoff({ kind: 'ess', employeeId: 'emp-1' }, t0)
    assert.ok(verifyHandoff(code, t0 + HANDOFF_TTL_MS - 1))
    assert.equal(verifyHandoff(code, t0 + HANDOFF_TTL_MS + 1), null)
  })
  it('is never mistaken for another token, either way round', () => {
    const code = issueHandoff({ kind: 'ess', employeeId: 'emp-1' })!
    assert.equal(verifyEssToken(code), null)
    assert.equal(verifyCandidateToken(code), null)
    assert.equal(verifyHandoff(issueEssToken('emp-1')), null)
  })
  it('refuses a tampered or foreign code', () => {
    const code = issueHandoff({ kind: 'ess', employeeId: 'emp-1' })!
    const [p, body, sig] = code.split('.')
    const forged = Buffer.from(JSON.stringify({ k: 'ess', e: 'emp-2', exp: Date.now() + 60_000 })).toString('base64url')
    assert.equal(verifyHandoff(`${p}.${forged}.${sig}`), null)
    assert.equal(verifyHandoff(`${p}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`), null)
    process.env.ESS_SESSION_SECRET = 'another-deployment'
    assert.equal(verifyHandoff(code), null)
    process.env.ESS_SESSION_SECRET = 'test-secret'
  })
  it('does not answer to empty input', () => {
    for (const v of [null, undefined, '', 'lmsh', 'lmsh..', 'garbage']) assert.equal(verifyHandoff(v as string), null)
  })
})
