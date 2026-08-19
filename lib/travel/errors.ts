// lib/travel/errors.ts — turn a thrown value into a response that says what happened.
//
// A supabase-js error is a plain object ({ message, code, details, hint }), not an
// Error instance. Every route here was written as
//
//     e instanceof Error ? e.message : 'Could not load X'
//
// which is false for exactly those errors, so the real cause was replaced by a
// generic sentence. "Could not load the finance queue" was in fact
// "Could not find the table 'public.finance_work_items' in the schema cache" —
// a migration that had not been run, reported as a mystery.
import { NextResponse } from 'next/server'

/** PostgREST: the table or view is not in the schema cache — usually an unrun migration. */
const MISSING_TABLE = 'PGRST205'
/** PostgREST: the column does not exist — usually a partially applied migration. */
const MISSING_COLUMN = '42703'
/** Postgres: the function does not exist. */
const MISSING_FUNCTION = '42883'

export interface ThrownDetail {
  message: string
  code: string | null
  /** true when the cause is schema that has not been migrated yet */
  missingSchema: boolean
}

export function describeError(e: unknown, fallback: string): ThrownDetail {
  if (e instanceof Error) return { message: e.message, code: null, missingSchema: false }

  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const message = typeof o.message === 'string' && o.message ? o.message : fallback
    const code = typeof o.code === 'string' ? o.code : null
    const missingSchema =
      code === MISSING_TABLE || code === MISSING_COLUMN || code === MISSING_FUNCTION
    return { message, code, missingSchema }
  }

  return { message: fallback, code: null, missingSchema: false }
}

/**
 * A JSON error response that keeps the cause.
 *
 * @param migrationHint what to say when the cause is unrun schema — far more
 *   useful than the raw PostgREST sentence, which names a table the reader has
 *   no reason to recognise.
 */
export function errorResponse(e: unknown, fallback: string, migrationHint?: string): NextResponse {
  const d = describeError(e, fallback)
  if (d.missingSchema && migrationHint) {
    return NextResponse.json(
      { error: migrationHint, code: 'MIGRATION_PENDING', detail: d.message },
      { status: 503 },
    )
  }
  return NextResponse.json(
    { error: d.message, code: d.code, ...(d.missingSchema ? { code: 'MIGRATION_PENDING' } : {}) },
    { status: d.missingSchema ? 503 : 500 },
  )
}
