// lib/analytics/server/memo.ts — the same answer for the same question, for a minute.
//
// The organisation page asks for its figures, then for the AI read of those figures.
// Both need the full payload, which is seconds of database reads at 2,000 people.
// Keeping the promise for a short while means the second request (when it lands on the
// same server instance, which is usual) reuses the first instead of reading it all
// again. The key carries the caller, so nobody is ever served another person's scope.

const store = new Map<string, { at: number; p: Promise<unknown> }>()
const MAX = 50

export function memo<T>(key: string, ttlMs: number, make: () => Promise<T>, fresh = false): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (!fresh && hit && now - hit.at < ttlMs) return hit.p as Promise<T>
  const p = make()
  store.set(key, { at: now, p })
  // A failure is not remembered: the next request tries again.
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key) })
  for (const [k, v] of store) {
    if (store.size <= MAX) break
    if (now - v.at >= ttlMs || store.size > MAX) store.delete(k)
  }
  return p
}
