'use client'
// components/learning/admin/builder-api.ts — how the builder's sections save.
//
// Edits run one at a time, in the order they were made. A field saves on blur, and the click
// that caused the blur may be "Publish": queued, the publish cannot overtake the save.
// The tree is refetched after the queue empties rather than after every edit, so a burst of
// changes costs one refresh.
import { useCallback, useRef, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import type { Ctx } from './shared'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface BuilderApi {
  ctx: Ctx
  course: any
  tree: { version: any; modules: any[]; lessons: any[]; quizzes: any[] }
  /** Structure and rules cannot change: not a draft, or this person cannot edit. */
  readOnly: boolean
  canEdit: boolean
  /** One builder operation. Resolves to the result, or false if it failed (shown in the header). */
  op: (name: string, body: Record<string, unknown>) => Promise<any>
  patchCourse: (fields: Record<string, unknown>) => Promise<any>
  patchRules: (fields: Record<string, unknown>) => Promise<any>
  run: <T>(fn: () => Promise<T>) => Promise<T | false>
  flush: () => Promise<void>
}

export function useSaver(refresh: () => Promise<unknown>) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState('')
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)

  const run = useCallback(<T,>(fn: () => Promise<T>): Promise<T | false> => {
    pending.current++
    setState('saving')
    const job = queue.current.then(fn)
    queue.current = job.catch(() => {})
    return job.then(
      async r => {
        pending.current--
        if (!pending.current) { await refresh(); setState('saved'); setError('') }
        return r
      },
      async (e: any) => {
        pending.current--
        setError(e?.message || 'That could not be saved.')
        setState('error')
        if (!pending.current) await refresh()
        return false as const
      },
    )
  }, [refresh])

  const flush = useCallback(() => queue.current.then(() => {}), [])
  return { state, error, run, flush }
}

export const builderOp = (name: string, body: Record<string, unknown>) =>
  lmsApi('/api/lms/admin/builder', { op: name, ...body }).then(r => r.result)
