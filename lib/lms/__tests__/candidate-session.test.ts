// A candidate token is a key to the learning portal and to nothing else in the building.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { issueCandidateToken, verifyCandidateToken, isCandidateToken, otpHmac, newOtp, newLinkToken, hashLinkToken } from '../candidate-session.ts'
import { verifyEssToken, issueEssToken } from '../../ess-session.ts'

before(() => { process.env.ESS_SESSION_SECRET = 'test-secret' })

describe('candidate session', () => {
  it('round-trips', () => {
    const t = issueCandidateToken('learner-1', 3)!
    assert.ok(isCandidateToken(t))
    assert.deepEqual(verifyCandidateToken(t), { learnerId: 'learner-1', version: 3 })
  })
  it('is refused outright by the ESS verifier', () => {
    assert.equal(verifyEssToken(issueCandidateToken('learner-1', 1)), null)
  })
  it('stays refused if the prefix is stripped to look like an ESS token', () => {
    const [, body, sig] = issueCandidateToken('learner-1', 1)!.split('.')
    assert.equal(verifyEssToken(`${body}.${sig}`), null)
  })
  it('an ESS token is no use here', () => {
    assert.equal(verifyCandidateToken(issueEssToken('employee-1')), null)
    assert.equal(verifyCandidateToken(`lmsc.${issueEssToken('employee-1')}`), null)
  })
  it('expires', () => {
    const t = issueCandidateToken('l', 1, Date.now() - 9 * 3_600_000)
    assert.equal(verifyCandidateToken(t), null)
  })
  it('refuses a tampered body', () => {
    const [p, body, sig] = issueCandidateToken('l', 1)!.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', ver: 1, exp: Date.now() + 1e6 })).toString('base64url')
    assert.equal(verifyCandidateToken(`${p}.${forged}.${sig}`), null)
    assert.ok(body)
  })
  it('refuses rubbish without throwing', () => {
    for (const x of ['', null, undefined, 'lmsc.', 'lmsc.a', 'lmsc.a.b', 'a.b.c']) assert.equal(verifyCandidateToken(x as any), null)
  })
})

describe('link and code', () => {
  it('a code is six digits', () => {
    for (let i = 0; i < 50; i++) assert.match(newOtp(), /^\d{6}$/)
  })
  it('a stored code cannot be replayed against another learner', () => {
    assert.notEqual(otpHmac('a', '123456'), otpHmac('b', '123456'))
  })
  it('the link hash is what is stored, and it matches only its own link', () => {
    const { token, hash } = newLinkToken()
    assert.equal(hashLinkToken(token), hash)
    assert.notEqual(hash, token)
    assert.notEqual(hashLinkToken(`${token}x`), hash)
  })
})
