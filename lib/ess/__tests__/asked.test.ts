// Whose portal is a request about?
//
// This parser decides that, and when it returned null on every write the
// whole ESS product went read-only: reads carry the employee id in the query
// string, writes carry it in the body, and only the query was ever read.
// Nobody could send a message, file a claim or save a form — while every
// screen loaded perfectly, which is why it went unnoticed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askedEmployeeId, type AskedFrom } from '../asked.ts'

const EMP = '9ba45761-0301-4b20-8db8-c0023237938a'

/** A plain Request satisfies AskedFrom, which is the point of typing it
 *  structurally — no Next module graph needed to check a string. */
const req = (url: string, init?: RequestInit): AskedFrom =>
  new Request(url, init) as unknown as AskedFrom

const post = (body: unknown, url = 'http://x/api/ess/inbox'): AskedFrom =>
  req(url, { method: 'POST', headers: { 'content-type': 'application/json' },
             body: JSON.stringify(body) })

test('a GET reads the query string', async () => {
  assert.equal(await askedEmployeeId(req(`http://x/a?employee_id=${EMP}`)), EMP)
})

test('a GET with no query names nobody', async () => {
  assert.equal(await askedEmployeeId(req('http://x/a')), null)
})

test('THE REGRESSION: a POST reads the body', async () => {
  assert.equal(await askedEmployeeId(post({ action: 'start', employee_id: EMP })), EMP)
})

test('the query wins when both are present', async () => {
  // Not arbitrary. An admin opening somebody else's portal puts the target in
  // the URL, which is the more explicit statement of intent, and it is the
  // path that then gets checked for admin access.
  const r = post({ employee_id: 'someone-else' }, `http://x/a?employee_id=${EMP}`)
  assert.equal(await askedEmployeeId(r), EMP)
})

test('a POST with no id names nobody, rather than guessing', async () => {
  assert.equal(await askedEmployeeId(post({ action: 'start' })), null)
})

test('a malformed body is not an error — plenty of posts carry none', async () => {
  assert.equal(await askedEmployeeId(
    req('http://x/a', { method: 'POST', body: 'not json at all' })), null)
})

test('an empty body does not throw', async () => {
  assert.equal(await askedEmployeeId(req('http://x/a', { method: 'POST' })), null)
})

test('a non-string id is refused rather than coerced', async () => {
  // A number or an object would otherwise sail into a uuid comparison and
  // fail somewhere far less obvious than here.
  for (const bad of [42, null, {}, [], true]) {
    assert.equal(await askedEmployeeId(post({ employee_id: bad })), null,
      `${JSON.stringify(bad)} must not be accepted as an employee id`)
  }
})

test('whitespace is trimmed, and a blank id is nobody', async () => {
  assert.equal(await askedEmployeeId(post({ employee_id: `  ${EMP}  ` })), EMP)
  assert.equal(await askedEmployeeId(post({ employee_id: '   ' })), null)
  assert.equal(await askedEmployeeId(req('http://x/a?employee_id=%20%20')), null)
})

test('THE BODY SURVIVES — the route handler still gets its JSON', async () => {
  // The parser clones rather than reads. If it consumed the stream, every
  // handler's own req.json() would throw, trading one breakage for another.
  const r = post({ action: 'start', employee_id: EMP, to: ['x'] })
  await askedEmployeeId(r)
  const body = await (r as unknown as Request).json()
  assert.equal(body.action, 'start')
  assert.deepEqual(body.to, ['x'])
})

test('PUT, PATCH and DELETE read the body too', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const r = req('http://x/a', {
      method, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employee_id: EMP }),
    })
    assert.equal(await askedEmployeeId(r), EMP, `${method} must work like POST`)
  }
})

test('HEAD and OPTIONS are reads, like GET', async () => {
  for (const method of ['HEAD', 'OPTIONS']) {
    assert.equal(await askedEmployeeId(req('http://x/a', { method })), null)
  }
})

test('the method comparison is not case-sensitive', async () => {
  assert.equal(await askedEmployeeId(req('http://x/a', { method: 'get' })), null)
})

// ── the guard, at source level ───────────────────────────────────────────

test('session.ts uses the parser, and the dead ternary has not come back', async () => {
  // The bug was not a wrong value — it was a placeholder that type-checked,
  // read plausibly, and silently returned null. Nothing but reading the
  // source catches its return.
  const fs = await import('node:fs/promises')
  const src = await fs.readFile(new URL('../session.ts', import.meta.url), 'utf8')

  assert.match(src, /askedEmployeeId\(req\)/,
    'essCaller must resolve the employee through the parser')
  assert.doesNotMatch(src, /\?\s*null\s*:\s*null/,
    'a ternary with null on both branches is the exact shape of the original bug')
  assert.doesNotMatch(src, /searchParams\.get\('employee_id'\)/,
    'reading the query directly here bypasses the body and breaks every write')
})
