// src/features/expenses/plan/usePreview.ts — the planner's live preview, the only validator
// (TePlanner / TeStartNow): POST /api/te/trips/preview 350 ms after the draft
// last changed; an answer that arrives after the draft moved on is dropped (the
// `current` flag cleared in the effect's cleanup, which also clears the timer).
// Success → preview, failed=false. Failure → preview null, failed=true.
//
// The payload is compared by value, so a re-render with an equal draft does not
// ask again (the website re-asks on step / open-line changes too; the answer is
// the same, so nothing visible differs).
import * as React from 'react'
import type { TripDraft, TripPreview } from '@web/te/types'
import { te } from '../api'
import { useSignedIn } from '../data'

export function useTripPreview(payload: TripDraft): { preview: TripPreview | null; failed: boolean } {
  const signedIn = useSignedIn()
  const [state, setState] = React.useState<{ preview: TripPreview | null; failed: boolean }>({ preview: null, failed: false })
  const key = JSON.stringify(payload)
  React.useEffect(() => {
    if (!signedIn) return
    let current = true
    const body = JSON.parse(key) as TripDraft
    const timer = setTimeout(() => {
      te.tripPreview(body)
        .then(p => { if (current) setState({ preview: p, failed: false }) })
        .catch(() => { if (current) setState({ preview: null, failed: true }) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [key, signedIn])
  return state
}
