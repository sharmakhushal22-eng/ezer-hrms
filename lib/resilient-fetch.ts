// lib/resilient-fetch.ts — a fetch for server-side Supabase clients that does not wait a minute
// on a dead connection.
//
// WHY. Now and then a call to Supabase sits for close to a minute and then fails (seen from the
// office network on 4 Nov 2026: a 57 s request that came back empty). That is the signature of a
// reused keep-alive connection some router on the way dropped without a word: the request goes
// down a socket nobody is listening on, and only the TCP timeout ends it. One such call holds up
// the whole screen.
//
// WHAT. A read that has not answered in a few seconds is abandoned, which also throws that socket
// away, and asked once more on a fresh one. Only reads: GET and HEAD, and the read-only RPCs a
// caller names. A write is never repeated, because the first one may have landed; it keeps the
// platform's own behaviour.
const READ_TRIES_MS = [8_000, 15_000]

export function resilientFetch(readOnlyRpcs: string[] = []): typeof fetch {
  const rpcs = new Set(readOnlyRpcs)
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = String(input instanceof Request ? input.url : input)
    const rpc = /\/rest\/v1\/rpc\/([^?/]+)/.exec(url)?.[1]
    const isRead = method === 'GET' || method === 'HEAD' || (method === 'POST' && !!rpc && rpcs.has(rpc))
    if (!isRead || init?.signal) return fetch(input, init)
    let last: unknown
    for (const ms of READ_TRIES_MS) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(new Error(`No answer from the database in ${ms / 1000} s`)), ms)
      try {
        return await fetch(input, { ...init, signal: ctl.signal })
      } catch (e) {
        last = e   // timed out or the connection failed: once more, on a new connection
      } finally {
        clearTimeout(timer)
      }
    }
    throw last
  }) as typeof fetch
}
