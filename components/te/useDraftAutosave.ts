'use client'
// components/te/useDraftAutosave.ts — "your work is saved", for any TE form.
//
// One hook so the planner, the expense form and a claim reply all behave the
// same way: they save quietly while you work, they tell you when they last
// saved, and they clear the draft the moment the real thing is submitted.
//
// WHAT IT WILL NOT DO:
//   · save a form nobody has touched — see worthSaving in lib/te/autosave.ts.
//     Opening a screen and closing it leaves nothing behind.
//   · write the same bytes twice. The timer fires on a schedule; the save only
//     happens when the form actually changed, so a tab left open all afternoon
//     does not keep bumping its draft to the top of the list.
//   · fail loudly. A draft is a safety net, not the work. If the network is
//     down the person keeps typing and the indicator says so; nothing blocks
//     and nothing is thrown at them. The real save has its own error handling
//     and that is the one that matters.
//
// The debounce is deliberately slower than the 350 ms used for live previews.
// A preview is feedback the person is waiting for; a draft is insurance, and
// writing one per keystroke would be a lot of round trips for a file nobody
// reads unless something goes wrong.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { te } from '@/lib/te/client'
import { stableStringify, worthSaving } from '@/lib/te/autosave'
import type { TeDraftKind, Uuid } from '@/lib/te/types'

const DEBOUNCE_MS = 1200

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface DraftAutosave {
  /** For the indicator beside the buttons. */
  state: SaveState
  /** Date.now() of the last successful save, for savedAgo(). */
  savedAt: number | null
  /** The draft's id once it exists, so a resumed form keeps updating one row. */
  draftId: Uuid | null
  /** Save immediately — the "Save as draft" button. Resolves when stored. */
  saveNow: () => Promise<void>
  /** Throw the draft away. Call this after the real record is saved. */
  discard: () => Promise<void>
}

export function useDraftAutosave(opts: {
  kind: TeDraftKind
  /** The form state to store. Must be JSON-safe. */
  body: Record<string, unknown>
  /** The form as it was opened. The draft is only written once these differ. */
  pristine: Record<string, unknown>
  /** What the Drafts list shows. null while the form cannot say yet. */
  title: string | null
  scope?: string | null
  step?: number
  tripId?: Uuid | null
  claimId?: Uuid | null
  /** The draft being resumed, so edits update it instead of making another. */
  resumingId?: Uuid | null
  /** Set false to suspend saving — while submitting, for instance. */
  enabled?: boolean
}): DraftAutosave {
  const { kind, body, pristine, title, scope, step, tripId, claimId, resumingId, enabled = true } = opts

  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [draftId, setDraftId] = useState<Uuid | null>(resumingId ?? null)

  // What was last written, so an unchanged form is not written again. A
  // resumed draft starts out already stored, which is why it is seeded from
  // the body rather than from nothing: reopening a draft and closing it must
  // not rewrite it.
  const savedBody = useRef<string | null>(resumingId ? stableStringify(body) : null)
  // Read inside the timer, so the save sends what the form says at that moment
  // rather than what it said when the timer was set.
  const latest = useRef(opts)
  latest.current = opts
  const idRef = useRef<Uuid | null>(resumingId ?? null)

  // Identity, not contents: `body` is a new object every render.
  const bodyKey = useMemo(() => stableStringify(body), [body])
  const pristineKey = useMemo(() => stableStringify(pristine), [pristine])

  const write = useCallback(async (): Promise<void> => {
    const o = latest.current
    const key = stableStringify(o.body)
    if (!worthSaving(o.body, o.pristine) || key === savedBody.current) return
    setState('saving')
    try {
      const r = await te.drafts.save({
        id: idRef.current,
        kind: o.kind,
        title: o.title,
        scope: o.scope ?? null,
        step: o.step ?? 0,
        body: o.body,
        trip_id: o.tripId ?? null,
        claim_id: o.claimId ?? null,
      })
      idRef.current = r.draft_id
      savedBody.current = key
      setDraftId(r.draft_id)
      setSavedAt(Date.now())
      setState('saved')
    } catch {
      // Deliberately quiet: the draft is insurance, and an error here must not
      // interrupt somebody mid-sentence. The indicator carries it.
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (bodyKey === pristineKey || bodyKey === savedBody.current) return
    let live = true
    const timer = setTimeout(() => { if (live) void write() }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [bodyKey, pristineKey, enabled, write])

  const discard = useCallback(async (): Promise<void> => {
    const id = idRef.current
    if (!id) return
    idRef.current = null
    savedBody.current = null
    setDraftId(null)
    setState('idle')
    setSavedAt(null)
    // A draft that will not delete is not worth telling anybody about: the
    // real record saved, which is what they were doing.
    try { await te.drafts.remove(id) } catch { /* leave it in the list */ }
  }, [])

  return { state, savedAt, draftId, saveNow: write, discard }
}
