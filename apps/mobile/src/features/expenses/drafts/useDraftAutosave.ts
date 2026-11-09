// src/features/expenses/drafts/useDraftAutosave.ts — "your work is saved", for any T&E form.
//
// PORT OF components/te/useDraftAutosave.ts, unchanged in behaviour: saves quietly
// 1.2 s after the form stops changing, never saves an untouched form
// (worthSaving), never writes the same bytes twice, never fails loudly — the
// indicator carries the state. The decisions live in lib/te/autosave.ts (shared).
//
// One addition for the phone: after each save the Drafts lists are refetched
// (['te','drafts'] — the web's draftTick), so a plan saved from a sheet shows up
// on Home behind it.
import * as React from 'react'
import { stableStringify, worthSaving } from '@web/te/autosave'
import type { TeDraftKind, Uuid } from '@web/te/types'
import { queryClient } from '@/core/query'
import { te } from '../api'

const DEBOUNCE_MS = 1200

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface DraftAutosave {
  state: SaveState
  savedAt: number | null
  draftId: Uuid | null
  /** Save immediately — the "Save as draft" button. */
  saveNow: () => Promise<void>
  /** Throw the draft away. Call after the real record is saved. */
  discard: () => Promise<void>
}

export interface DraftAutosaveOptions {
  kind: TeDraftKind
  body: Record<string, unknown>
  pristine: Record<string, unknown>
  title: string | null
  scope?: string | null
  step?: number
  tripId?: Uuid | null
  claimId?: Uuid | null
  resumingId?: Uuid | null
  enabled?: boolean
}

/** Only the drafts lists — not the snapshot, which would refetch every 1.2 s while typing. */
const refreshLists = () => { void queryClient.invalidateQueries({ queryKey: ['te', 'drafts'] }) }

export function useDraftAutosave(opts: DraftAutosaveOptions): DraftAutosave {
  const { body, pristine, resumingId, enabled = true } = opts
  const [state, setState] = React.useState<SaveState>('idle')
  const [savedAt, setSavedAt] = React.useState<number | null>(null)
  const [draftId, setDraftId] = React.useState<Uuid | null>(resumingId ?? null)

  // A resumed draft starts out already stored: reopening and closing it must not rewrite it.
  const savedBody = React.useRef<string | null>(resumingId ? stableStringify(body) : null)
  const latest = React.useRef(opts)
  React.useEffect(() => { latest.current = opts })
  const idRef = React.useRef<Uuid | null>(resumingId ?? null)

  const bodyKey = React.useMemo(() => stableStringify(body), [body])
  const pristineKey = React.useMemo(() => stableStringify(pristine), [pristine])

  const write = React.useCallback(async (): Promise<void> => {
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
      refreshLists()
    } catch {
      setState('error')
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) return
    if (bodyKey === pristineKey || bodyKey === savedBody.current) return
    let live = true
    const timer = setTimeout(() => { if (live) void write() }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [bodyKey, pristineKey, enabled, write])

  const discard = React.useCallback(async (): Promise<void> => {
    const id = idRef.current
    if (!id) return
    idRef.current = null
    savedBody.current = null
    setDraftId(null)
    setState('idle')
    setSavedAt(null)
    try { await te.drafts.remove(id) } catch { /* leave it in the list */ }
    refreshLists()
  }, [])

  return { state, savedAt, draftId, saveNow: write, discard }
}
