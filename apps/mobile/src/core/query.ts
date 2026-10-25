// src/core/query.ts — caching and refresh rules (TanStack Query).
//
// The website re-reads on every navigation (`cache: 'no-store'`). On a phone that
// would be slow and wasteful, so screens cache — but never trust the cache for
// long:
//   · data is "stale" after 30 seconds, so opening a screen again refetches it;
//   · coming back to the app from the background refetches every screen that is
//     on display (focusManager ← AppState) — this is what makes an approval HR
//     made on the website appear when the employee reopens the app;
//   · every mutation invalidates the queries it affects (see invalidate()).
//   · pull-to-refresh on any screen refetches on demand.
import { AppState, Platform } from 'react-native'
import { focusManager, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

focusManager.setEventListener(handleFocus => {
  if (Platform.OS === 'web') return undefined
  const sub = AppState.addEventListener('change', s => handleFocus(s === 'active'))
  return () => sub.remove()
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Never retry a refusal — "you cannot open this" does not get better on a second try.
      retry: (count, err) => !(err instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(err.status)) && count < 2,
    },
    mutations: { retry: false },
  },
})

/** Invalidate every query whose key starts with one of these prefixes. */
export function invalidate(...prefixes: string[]) {
  return Promise.all(prefixes.map(p => queryClient.invalidateQueries({ queryKey: [p] })))
}
