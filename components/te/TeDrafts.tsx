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
//
// CLEARING SEVERAL AT ONCE. Abandoned plans accumulate: open the planner, think
// better of it, and a draft is left behind. Discarding eleven of them one at a
// time, each with its own confirm, is eleven decisions to make the same choice.
// "Select" turns the rows into checkboxes, with select-all, and the confirm is
// asked once for the lot — but it is still asked, and it still names the number,
// because the warning is the same warning.
//
// SELECTION IS OFF UNTIL ASKED FOR. Checkboxes on every row by default would
// make the common case — resume the one I came back for — read like a list to
// be processed.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import { errorText } from '@/lib/te/format'
import { savedAgo } from '@/lib/te/autosave'
import type { TeDraft, TeDraftKind } from '@/lib/te/types'
import TeIcon from './TeIcon'

/** What kind of thing this draft is, in the words the rest of the screen uses. */
function kindLabel(d: TeDraft): string {
  if (d.kind === 'trip') {
    const scope = d.scope === 'local' ? 'Local' : d.scope === 'international' ? 'International' : 'Domestic'
    return `${scope} trip`
  }
  return d.kind === 'expense' ? 'Expense' : 'Reply'
}

export default function TeDrafts({ kind, title, reloadKey, onResume }: {
  /** Which drafts this card is for. The card is named after them, so it has to
   *  be told: a list headed "Trip drafts" that quietly also holds a half-typed
   *  expense is a label that lies. Left out, it shows everything. */
  kind?: TeDraftKind
  /** What to call the card. */
  title?: string
  /** Bump to refetch — a draft saved elsewhere on this screen. */
  reloadKey?: number
  onResume: (d: TeDraft) => void
}) {
  const [drafts, setDrafts] = useState<TeDraft[]>([])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)
  /** Selection mode, and what is ticked. Off until asked for. */
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmingMany, setConfirmingMany] = useState(false)
  /** What just happened, kept APART from `error`.
   *
   *  The refetch below clears `error` on every successful list — which is right
   *  for "the drafts would not load", and wrong for "3 of 4 were discarded":
   *  discarding triggers that very refetch, so the message was being wiped a
   *  moment after it was set. Caught in the browser; nothing here could have
   *  caught it, because both halves are correct on their own. */
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    te.drafts.list(kind)
      .then(r => { if (current) { setDrafts(r.drafts ?? []); setError('') } })
      // Unfinished work that will not list is worth saying out loud: somebody
      // may be looking for a plan they know they left here.
      .catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [reloadKey, tick, kind])

  /** Leaving selection mode forgets what was ticked, rather than keeping a
   *  hidden set that a later "Select" would silently restore. */
  const stopPicking = useCallback(() => {
    setPicking(false); setPicked(new Set()); setConfirmingMany(false)
  }, [])

  const toggle = useCallback((id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setConfirmingMany(false)
  }, [])

  const discardMany = useCallback(async (ids: string[]) => {
    setBusy('many')
    try {
      const r = await te.drafts.removeMany(ids)
      stopPicking()
      // The true number, not the number asked for: one may have gone already in
      // another tab, and saying "4 discarded" when 3 went would be a lie the
      // reader cannot check. Set BEFORE the refetch and in its own state, so the
      // refetch's own clearing of `error` cannot take it away.
      setNotice(r.deleted < r.asked
        ? `${r.deleted} of ${r.asked} drafts were discarded. The rest had already gone.`
        : '')
      setTick(t => t + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }, [stopPicking])

  const discard = useCallback(async (d: TeDraft) => {
    setBusy(d.id); setNotice('')
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

  // Derived, not stored: a second copy of "are they all ticked" is a second
  // thing that can be wrong. Guarded on length so an empty list does not read
  // as "all selected".
  const allPicked = drafts.length > 0 && picked.size === drafts.length
  const somePicked = picked.size > 0

  // Nothing left, nothing wrong and nothing to report: the card goes away, as
  // it always has. But it stays for a notice — discarding the last draft is
  // exactly when there are none left and exactly when the count matters.
  if (!drafts.length && !error && !notice) return null

  return (
    <div className="card">
      <div className="ch">
        <h3><TeIcon name="file" size="sm" />{title ?? 'Drafts'}</h3>
        {picking ? (
          <div className="row tight">
            <label className="check small">
              <input
                type="checkbox"
                checked={allPicked}
                // Half-ticked when some but not all are: the box says what the
                // next tap will do rather than guessing.
                ref={el => { if (el) el.indeterminate = somePicked && !allPicked }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(drafts.map(d => d.id)))}
              />
              <span>{allPicked ? 'Clear all' : 'Select all'}</span>
            </label>
            <span className="small muted">{picked.size} of {drafts.length}</span>
            <button type="button" className="btn sm" onClick={stopPicking}>Done</button>
          </div>
        ) : (
          <div className="row tight">
            <span className="small muted">Only you can see these</span>
            {/* Not offered for a single draft: its own Discard is one tap away
                and already asks. */}
            {drafts.length > 1 ? (
              <button type="button" className="btn sm" onClick={() => { setPicking(true); setConfirming(null) }}>
                Select
              </button>
            ) : null}
          </div>
        )}
      </div>
      {error ? <p className="ferr"><TeIcon name="warn" size="sm" />{error}</p> : null}
      {notice ? (
        <div className="note">
          <TeIcon name="info" size="sm" />
          <span>{notice}</span>
          <button type="button" className="btn sm" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      ) : null}
      {/* ASKED ONCE, FOR THE LOT, and it still names the number — the warning
          is the same warning, and "Discard 9 drafts" is a different decision
          from "Discard". */}
      {picking && somePicked ? (
        confirmingMany ? (
          <div className="form">
            <div className="flag crit">
              <TeIcon name="alert" size="sm" />
              <span>
                {picked.size === 1
                  ? 'This is the only copy of that work. Discarding it cannot be undone.'
                  : `These are the only copies of that work. Discarding ${picked.size} drafts cannot be undone.`}
              </span>
            </div>
            <div className="row tight">
              <button type="button" className="btn ok glow" onClick={() => setConfirmingMany(false)}>Keep them</button>
              <button type="button" className="btn dan glow" disabled={busy === 'many'}
                onClick={() => void discardMany([...picked])}>
                <TeIcon name="bin" size="sm" />
                {busy === 'many' ? 'Discarding…' : `Discard ${picked.size}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="row tight">
            <button type="button" className="btn dan" onClick={() => setConfirmingMany(true)}>
              <TeIcon name="bin" size="sm" />
              Discard {picked.size} {picked.size === 1 ? 'draft' : 'drafts'}
            </button>
          </div>
        )
      ) : null}

      {drafts.map(d => (
        <div key={d.id} className={`draftrow${picking && picked.has(d.id) ? ' picked' : ''}`} data-kind={d.kind}>
          {picking ? (
            <label className="check">
              <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
              <span className="vh">Select {d.title || 'this draft'}</span>
            </label>
          ) : null}
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
                  <span>This is the only copy of this work. Discarding it cannot be undone.</span>
                </div>
                <div className="row tight">
                  <button type="button" className="btn ok glow" onClick={() => setConfirming(null)}>Keep it</button>
                  {/* The verb names itself on the button that does it, and the
                      glow is there because this is the one control on the screen
                      that destroys the only copy of somebody's work. */}
                  <button type="button" className="btn dan glow" disabled={busy === d.id} onClick={() => discard(d)}>
                    <TeIcon name="bin" size="sm" />
                    {busy === d.id ? 'Discarding…' : 'Discard'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {/* While selecting, the per-row buttons go away: two ways to discard
              the same row, one of them a single tap, is how somebody loses work
              they meant to keep. */}
          {!picking && confirming !== d.id ? (
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
