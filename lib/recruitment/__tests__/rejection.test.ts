// lib/recruitment/__tests__/rejection.test.ts — a rejection needs a reason and
// a remark, and both are checked where the write happens.
//
// WHY THIS FILE EXISTS
//
// Rejecting a candidate used to be one column: stage = 'Rejected', with nothing
// recorded about why. The hiring manager's Reject button now demands a reason
// AND a remark — but a dialog that demands them is a courtesy, not a rule. The
// rule is validateRejection(), called by /api/recruitment/interview-invite
// before it writes, and a source-level assertion below pins that it is actually
// called there.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  REJECTION_REASONS, REJECTION_REASON_CODES,
  isRejectionReason, rejectionLabel, validateRejection, normaliseRemark,
} from '../rejection.ts'

describe('the reason list', () => {
  test('every reason has a stable code and a human label', () => {
    assert.ok(REJECTION_REASONS.length >= 5, 'a list this short is probably a parse accident')
    for (const r of REJECTION_REASONS) {
      assert.match(r.code, /^[A-Z][A-Z_]*$/, `${r.code} is not a stable upper-snake code`)
      assert.ok(r.label.length > 3, `${r.code} needs a readable label`)
    }
  })

  test('codes are unique — reports group on them', () => {
    assert.equal(new Set(REJECTION_REASON_CODES).size, REJECTION_REASON_CODES.length)
  })

  test('OTHER exists, so a reason never has to be forced into a wrong bucket', () => {
    assert.ok(REJECTION_REASON_CODES.includes('OTHER'))
  })

  test('isRejectionReason accepts only the listed codes', () => {
    for (const c of REJECTION_REASON_CODES) assert.equal(isRejectionReason(c), true)
    for (const junk of ['skills', 'Skills', 'MADE_UP', '', null, undefined, 7, {}, []]) {
      assert.equal(isRejectionReason(junk), false, `${String(junk)} must not pass as a reason`)
    }
  })

  test('a stored code reads back as its label, and an unknown one as itself', () => {
    assert.equal(rejectionLabel('SKILLS'), 'Skills / experience mismatch')
    // An old row whose code was retired must still render something, not blank.
    assert.equal(rejectionLabel('RETIRED_CODE'), 'RETIRED_CODE')
    assert.equal(rejectionLabel(null), '—')
    assert.equal(rejectionLabel(undefined), '—')
  })
})

describe('validateRejection', () => {
  test('a listed reason with a remark passes', () => {
    assert.deepEqual(validateRejection({ reason: 'SKILLS', remark: 'No payroll exposure at all.' }), { ok: true })
  })

  test('THE RULE: a missing or unknown reason is refused', () => {
    for (const r of [undefined, null, '', 'MADE_UP', 7]) {
      const g = validateRejection({ reason: r, remark: 'something' })
      assert.equal(g.ok, false, `${String(r)} must not be accepted as a reason`)
      assert.match(g.reason as string, /reason/i)
    }
  })

  test('THE RULE: a missing or blank remark is refused', () => {
    for (const m of [undefined, null, '', '   ', '\n\t ', 42]) {
      const g = validateRejection({ reason: 'SKILLS', remark: m })
      assert.equal(g.ok, false, `${JSON.stringify(m)} must not be accepted as a remark`)
      assert.match(g.reason as string, /remark/i)
    }
  })

  test('the reason is reported before the remark', () => {
    // Both are missing. The dropdown is the first thing to fix, so it is the
    // first thing the user is told.
    const g = validateRejection({})
    assert.match(g.reason as string, /reason/i)
  })

  test('a refusal always carries a usable message', () => {
    for (const input of [{}, { reason: 'SKILLS' }, { remark: 'x' }]) {
      const g = validateRejection(input)
      assert.equal(g.ok, false)
      assert.ok((g.reason || '').length > 10, `unhelpful refusal for ${JSON.stringify(input)}`)
    }
  })
})

describe('normaliseRemark', () => {
  test('trims, and turns blank into null rather than an empty string', () => {
    assert.equal(normaliseRemark('  spaced  '), 'spaced')
    assert.equal(normaliseRemark('   '), null)
    assert.equal(normaliseRemark(''), null)
    assert.equal(normaliseRemark(undefined), null)
    assert.equal(normaliseRemark(123), null)
  })
})

describe('the route is where the rule is enforced', () => {
  const ROUTE = readFileSync('app/api/recruitment/interview-invite/route.ts', 'utf8')
  const start = ROUTE.indexOf('async function rejectCandidate(')
  const body = ROUTE.slice(start, ROUTE.indexOf('\n// Final Shortlist', start))

  test('the reject action exists and its body was isolated', () => {
    assert.notEqual(start, -1, 'rejectCandidate was renamed — re-read what this test protects')
    assert.ok(body.length > 400 && body.length < 6_000, `slice looks wrong (${body.length} chars)`)
    assert.ok(/body\.action === 'reject'/.test(ROUTE), 'the action must be dispatched')
  })

  test('it validates BEFORE it writes', () => {
    assert.ok(/validateRejection\(/.test(body), 'the route must use the shared rule, not its own copy')
    const guard = body.indexOf('validateRejection(')
    const write = body.indexOf("update(patch)")
    assert.ok(guard !== -1 && write !== -1 && guard < write,
      'a refused rejection must not have already been written')
  })

  test('it stores the reason, the remark, who and when', () => {
    for (const col of ['rejection_reason', 'rejection_remark', 'rejected_at', 'rejected_by']) {
      assert.ok(body.includes(col), `${col} must be written, or the mandate records nothing`)
    }
  })

  test('it leaves an audit row carrying the reason', () => {
    assert.ok(/CANDIDATE_REJECTED/.test(body), 'a mandated reason with no audit trail is half a feature')
    assert.ok(/recruitment_audit_logs/.test(body))
  })

  test('it refuses to touch a candidate the offer flow owns', () => {
    // 'Offer Sent' / 'Joined' have their own backout path, which blacklists and
    // reopens the requisition. Rejecting them here would do none of that.
    assert.ok(/\['Offer Sent', 'Joined'\]\.includes\(stage\)/.test(body),
      'rejecting an offer-stage candidate must be refused and sent to the backout flow')
  })

  test('the actor id is taken from the SESSION, never from the body', () => {
    // rejected_by must not be settable by the caller.
    assert.ok(/rejected_by: actorEmployeeId/.test(body))
    assert.ok(!/body\.rejected_by|body\.actor/.test(body),
      'the client must not be able to state who rejected')
  })
})
