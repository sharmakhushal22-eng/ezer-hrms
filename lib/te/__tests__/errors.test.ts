// What the browser is told when something is refused or fails.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { TeHttpError, TeConfigError, mapTeError, refusalCode, rpcError, isUuid, needUuid, needOneOf, needText, optText } from '../errors.ts'
import { TeError, legEnd, tripDecide, type TeCtx } from '../engine/te-service.js'

describe('a refusal from the database', () => {
  // exactly what PostgREST returns for te_fail('TE_NOT_WAITING', '…')
  const pg = { code: 'P0001', message: 'This claim is not waiting for you.', hint: 'TE_NOT_WAITING', details: null }

  test('becomes a thrown Error that carries message, hint, code and details', () => {
    const e = rpcError(pg, 'te_claim_decide') as Error & { hint: string; code: string; details: null; fn: string }
    assert.ok(e instanceof Error)
    assert.equal(e.message, 'This claim is not waiting for you.')
    assert.equal(e.hint, 'TE_NOT_WAITING')
    assert.equal(e.code, 'P0001')
    assert.equal(e.details, null)
    assert.equal(e.fn, 'te_claim_decide')
  })

  test('is a 409 with the sentence and the TE_ code', () => {
    const m = mapTeError(rpcError(pg))
    assert.equal(m.status, 409)
    assert.deepEqual(m.body, { error: 'This claim is not waiting for you.', code: 'TE_NOT_WAITING' })
    assert.equal(m.log, false)
  })

  test('TE_FORBIDDEN is a 403', () => {
    const m = mapTeError(rpcError({ code: 'P0001', message: 'Nobody approves their own claim.', hint: 'TE_FORBIDDEN' }))
    assert.equal(m.status, 403)
    assert.equal(m.body.code, 'TE_FORBIDDEN')
  })

  test('a plain supabase-js error object (not an Error) maps the same way', () => {
    assert.equal(mapTeError(pg).status, 409)
    assert.equal(refusalCode(pg), 'TE_NOT_WAITING')
  })

  test('travels through the real service layer unchanged', async () => {
    const ctx: TeCtx = { actor: 'e0000000-0000-0000-0000-000000000210', db: { rpc: async () => { throw rpcError(pg, 'te_trip_decide') } } }
    await assert.rejects(tripDecide(ctx, 'd0000000-0000-0000-0000-000000000001', 'approve'), (e: unknown) => {
      assert.equal(mapTeError(e).status, 409)
      assert.equal(mapTeError(e).body.code, 'TE_NOT_WAITING')
      return true
    })
  })
})

describe('a refusal from the service layer (TeError)', () => {
  test('keeps field, flags and issues, and drops anything else in extra', () => {
    const e = new TeError('Give the trip a name.', 'TE_TRIP', { field: 'name', issues: [{ block: true, t: 'Give the trip a name.', k: 'name' }], secret: 'x' })
    const m = mapTeError(e)
    assert.equal(m.status, 409)
    assert.deepEqual(m.body, { error: 'Give the trip a name.', code: 'TE_TRIP', field: 'name', issues: [{ block: true, t: 'Give the trip a name.', k: 'name' }] })
  })

  test('the real service refuses to end a leg without a location, before touching the database', async () => {
    let called = false
    const ctx: TeCtx = { actor: 'e0000000-0000-0000-0000-000000000512', db: { rpc: async () => { called = true; return null as never } } }
    await assert.rejects(legEnd(ctx, 'a0000000-0000-0000-0000-000000000001', null as never), (e: unknown) => {
      const m = mapTeError(e)
      assert.equal(m.status, 409)
      assert.equal(m.body.code, 'TE_GPS')
      assert.equal(m.body.error, 'Your location is needed to end the leg.')
      return true
    })
    assert.equal(called, false)
  })

  test('TeError with TE_FORBIDDEN is a 403', () => {
    assert.equal(mapTeError(new TeError('No.', 'TE_FORBIDDEN')).status, 403)
  })
})

describe('everything else', () => {
  test('an unexpected database error is a 500 that does not leak SQL', () => {
    const m = mapTeError(rpcError({ code: '42601', message: 'syntax error at or near "selectt" in te_claims' }))
    assert.equal(m.status, 500)
    assert.equal(m.body.code, 'TE_INTERNAL')
    assert.ok(!/selectt|te_claims/.test(m.body.error))
    assert.equal(m.log, true)
  })

  test('a thrown string, null or undefined is a 500 too', () => {
    for (const v of ['boom', null, undefined, 42]) assert.equal(mapTeError(v).status, 500)
  })

  test('a missing function or table says the migrations have not run (503)', () => {
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) {
      const m = mapTeError({ code, message: 'Could not find the function public.te_snapshot in the schema cache' })
      assert.equal(m.status, 503)
      assert.equal(m.body.code, 'MIGRATION_PENDING')
      assert.ok(!/schema cache/.test(m.body.error))
    }
  })

  test('permission denied after the lock-down points at the service-role key (503)', () => {
    const m = mapTeError({ code: '42501', message: 'permission denied for function te_snapshot' })
    assert.equal(m.status, 503)
    assert.equal(m.body.code, 'TE_SERVICE_KEY')
  })

  test('a value a constraint refuses is a 400 without the constraint text', () => {
    const m = mapTeError({ code: '23514', message: 'new row for relation "te_modes" violates check constraint "te_modes_flight_never_local"' })
    assert.equal(m.status, 400)
    assert.equal(m.body.code, 'TE_INVALID')
    assert.ok(!/te_modes/.test(m.body.error))
  })

  test('a RAISE from a trigger of another module keeps its sentence (409)', () => {
    const m = mapTeError({ code: 'P0001', message: 'Reopening needs a reason of at least 10 characters.', hint: null })
    assert.equal(m.status, 409)
    assert.equal(m.body.code, 'TE_REFUSED')
  })

  test('route errors keep their status; a missing env var is a 503', () => {
    assert.deepEqual(mapTeError(new TeHttpError(401, 'TE_SIGN_IN', 'Sign in to continue.')), { status: 401, body: { error: 'Sign in to continue.', code: 'TE_SIGN_IN' }, log: false })
    const c = mapTeError(new TeConfigError('SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.'))
    assert.equal(c.status, 503)
    assert.equal(c.body.code, 'TE_NOT_CONFIGURED')
  })
})

describe('request validators', () => {
  test('ids', () => {
    assert.ok(isUuid('e0000000-0000-0000-0000-000000000512'))
    assert.ok(!isUuid('SRS0512'))
    assert.ok(!isUuid("e0000000-0000-0000-0000-000000000512' or 1=1"))
    assert.throws(() => needUuid('abc', 'Claim'), (e: unknown) => e instanceof TeHttpError && e.status === 400 && e.message === 'Claim is missing or is not a valid id.')
  })
  test('text and choices', () => {
    assert.equal(needText('  hi ', 'reason'), 'hi')
    assert.throws(() => needText('   ', 'reason'), TeHttpError)
    assert.equal(needOneOf('approve', ['approve', 'reject'] as const, 'action'), 'approve')
    assert.throws(() => needOneOf('delete', ['approve', 'reject'] as const, 'action'), (e: unknown) => e instanceof TeHttpError && /approve, reject/.test(e.message))
    assert.equal(optText(''), null)
    assert.equal(optText(' x '), 'x')
  })
})
