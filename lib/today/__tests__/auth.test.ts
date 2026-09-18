import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// Every /api/ess/* route resolves the caller from the Authorization header that
// lib/auth-headers.ts builds. A bare fetch() gets 401 and the screen reports
// itself broken — which is how the Today tab shipped, and, per the comment at
// the top of auth-headers.ts, how the ESS inbox shipped before it.
const FILES = [
  ...readdirSync('components/ess/today').filter(f => f.endsWith('.tsx')).map(f => `components/ess/today/${f}`),
  ...readdirSync('lib/today').filter(f => f.endsWith('.ts')).map(f => `lib/today/${f}`),
]

test('the file list is real', () => {
  assert.ok(FILES.length > 10, `only ${FILES.length} files — the scan broke`)
})

test('no call to our API goes out without an Authorization header', () => {
  const offenders: string[] = []
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/fetch\(\s*['"`]\/api\//g)) {
      // Read to the fetch's OWN closing paren. Stopping at the first ')' would
      // stop inside authHeaders() and report every fixed call as broken.
      let i = src.indexOf('(', m.index!), depth = 0, end = i
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++
        else if (src[end] === ')' && --depth === 0) break
      }
      const call = src.slice(i, end + 1)
      // A GET with no init at all is as unauthenticated as one with bare headers.
      if (!/authHeaders\(\)/.test(call))
        offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(offenders, [], `unauthenticated fetches:\n  ${offenders.join('\n  ')}`)
})

test('the scan can still tell a bad call from a good one', () => {
  // Guards the paren-matching above: if it silently matched nothing, the test
  // over the real files would pass no matter what those files contained.
  const bad = `fetch('/api/ess/today')`
  const good = `fetch('/api/ess/today', { headers: await authHeaders() })`
  assert.ok(!/authHeaders\(\)/.test(bad))
  assert.ok(/authHeaders\(\)/.test(good))
  assert.ok(/fetch\(\s*['"`]\/api\//.test(bad))
})
