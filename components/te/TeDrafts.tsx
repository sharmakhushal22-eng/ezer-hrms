'use client'
// components/te/TeDrafts.tsx — unfinished work, waiting to be picked up.
//
// A trip plan is not a quick form. Choosing a route, dates, how each leg is
// travelled and who books it takes real thought, and before this the only way
// out of the drawer was to finish or to lose it. The same went for an expense
// typed up without the bill to hand.
//
// WHY IT SHOWS NOTHING WHEN THERE IS NOTHING. An empty "Drafts (0)" card on
// every screen is a permanent reminder of a feature instead of a place to
// finish work. The card appears when there is something in it and is invisible
// otherwise.
//
// WHY DISCARD ASKS. It is the one irreversible button here — the draft is the
// only copy of that work — so it is a two-tap confirm rather than a single
// click next to Resume.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import { errorText } from '@/lib/te/format'
import { savedAgo } from '@/lib/te/autosave'
import type { TeDraft } from '@/lib/te/types'
import TeIcon from './TeIcon'

/** What kind of thing this draft is, in the words the rest of the screen uses. */
function kindLabel(d: TeDraft): string {
  if (d.kind === 'trip') {
    const scope = d.scope === 'local' ? 'Local' : d.scope === 'international' ? 'International' : 'Domestic'
    return `${scope} trip`
  }
  return d.kind === 'expense' ? 'Expense' : 'Reply'
}

export default function TeDrafts({ reloadKey, onResume }: {
  /** Bump to refetch — a draft saved elsewhere on this screen. */
  reloadKey?: number
  onResume: (d: TeDraft) => void
}) {
  const [drafts, setDrafts] = useState<TeDraft[]>([])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    te.drafts.list()
      .then(r => { if (current) { setDrafts(r.drafts ?? []); setError('') } })
      // Unfinished work that will not list is worth saying out loud: somebody
      // may be looking for a plan they know they left here.
      .catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [reloadKey, tick])

  const discard = useCallback(async (d: TeDraft) => {
    setBusy(d.id)
    try {
      await te.drafts.remove(d.id)
      setConfirming(null)
      setTick(t => t + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }, [])

  if (!drafts.length && !error) return null

  return (
    <div className="card">
      <div className="ch">
        <h3><TeIcon name="file" size="sm" />Unfinished</h3>
        <span className="small muted">Only you can see these</span>
      </div>
      {error ? <p className="small warn">{error}</p> : null}
      {drafts.map(d => (
        <div key={d.id} className="draftrow">
          <span className="ico"><TeIcon name={d.kind === 'trip' ? 'route' : d.kind === 'expense' ? 'receipt' : 'claims'} /></span>
          <div className="grow">
            {d.title
              ? <div className="dt">{d.title}</div>
              // A plan abandoned on its first screen genuinely has no name.
              // Saying so beats inventing "Untitled (2)".
              : <div className="dt none">Not named yet</div>}
            <div className="small muted">
              {kindLabel(d)} · {savedAgo(new Date(d.updated_at).getTime(), Date.now())}
            </div>
            {confirming === d.id ? (
              <div className="form">
                <div className="flag crit">
                  <TeIcon name="alert" size="sm" />
                  <span>This is the only copy of this work. Throwing it away cannot be undone.</span>
                </div>
                <div className="row tight">
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>Keep it</button>
                  <button type="button" className="btn dan" disabled={busy === d.id} onClick={() => discard(d)}>
                    {busy === d.id ? 'Discarding…' : 'Throw it away'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {confirming !== d.id ? (
            <div className="row tight">
              <button type="button" className="btn sm" onClick={() => setConfirming(d.id)}>Discard</button>
              <button type="button" className="btn sm pri" onClick={() => onResume(d)}>Resume</button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
