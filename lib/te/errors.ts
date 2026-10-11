// lib/te/errors.ts — one place that decides what a failure looks like to the browser.
//
// PURE: no Next.js, no Supabase, no '@/…' import, so the unit tests can load it
// under plain Node (lib/te/__tests__/errors.test.ts). lib/te/server.ts turns the
// result into a NextResponse.
//
// THE CONTRACT WITH THE DATABASE (supabase/migrations/145, header)
//   A business rule that says no is raised through te_fail(code, message):
//   SQLSTATE P0001, the sentence the user reads as the message, and the code
//   (TE_FORBIDDEN, TE_TRIP, TE_CLAIM, TE_NOT_WAITING …) in HINT. The service
//   layer raises its own refusals the same way, as TeError { message, code, extra }.
//   Both become the same JSON here: { error, code, ...extra }.
//
//   status   when
//   400      the request itself is wrong (bad JSON, unknown action, a value a CHECK constraint refuses)
//   401      nobody is signed in
//   403      signed in, but not allowed: TE_FORBIDDEN, or a missing role permission
//   409      every other TE_ refusal: the request was understood and the rules say no
//   503      the deployment is not ready: a migration has not run, or an env var is missing
//   500      anything else. The cause is logged on the server and NOT sent to the browser,
//            because a raw Postgres message can carry table names and row values.

/** A failure the route itself decided on (not the database, not the engine). */
export class TeHttpError extends Error {
  status: number
  code: string
  extra: Record<string, unknown> | null
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'TeHttpError'
    this.status = status
    this.code = code
    this.extra = extra ?? null
  }
}

/** The server is missing something it cannot work without (an env var, a provider). */
export class TeConfigError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.name = 'TeConfigError'
    this.code = 'TE_NOT_CONFIGURED'
  }
}

export interface TeErrorBody {
  error: string
  code: string | null
  field?: string
  flags?: unknown[]
  issues?: unknown[]
  detail?: string
}
export interface TeErrorResponse {
  status: number
  body: TeErrorBody
  /** true = the cause is unexpected and must be written to the server log. */
  log: boolean
}

const GENERIC = 'Something went wrong on our side. Nothing was saved. Try again; if it keeps happening, tell your admin the time it happened.'
const NOT_INSTALLED = 'Travel and Expenses is not installed on this database yet. Run migrations 144 to 149, then reload the API schema.'
const NO_SERVICE_KEY = 'The server cannot reach the Travel and Expenses data. Check that SUPABASE_SERVICE_ROLE_KEY is the service-role key of this project.'

/** PostgREST / Postgres codes that mean "the schema is not there". */
const MISSING_SCHEMA = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])
/** Postgres codes for "this value is not allowed": a CHECK, NOT NULL, foreign key or unique
 *  constraint, or text that is not a number / date / uuid. */
const BAD_VALUE = new Set(['23514', '23502', '23503', '23505', '22P02', '22007', '22008', '22003', '22001'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bag = (e: unknown): Record<string, unknown> => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {})

/** The TE_ code of a refusal, wherever it travels: TeError.code, or the HINT of a database error. */
export function refusalCode(e: unknown): string | null {
  const o = bag(e)
  const hint = str(o.hint)
  if (hint.startsWith('TE_')) return hint
  const code = str(o.code)
  if (code.startsWith('TE_')) return code
  return null
}

/**
 * Turn a PostgREST error object into a thrown Error that looks exactly like the
 * one engine/tests/support/db.js throws, so te-service behaves the same in the
 * app and in the tests: message = the user's sentence, hint = the TE_ code,
 * code = the SQLSTATE, details = Postgres DETAIL.
 */
export function rpcError(pg: { message?: string | null; hint?: string | null; code?: string | null; details?: string | null }, fn?: string): Error {
  const err = new Error(pg.message || (fn ? `Database call ${fn} failed.` : 'Database call failed.'))
  return Object.assign(err, { code: pg.code ?? null, hint: pg.hint ?? null, details: pg.details ?? null, fn: fn ?? null })
}

/** What to send back for anything a route can throw. */
export function mapTeError(e: unknown): TeErrorResponse {
  const o = bag(e)
  const message = str(o.message)

  if (e instanceof TeHttpError) {
    return { status: e.status, body: { error: e.message, code: e.code, ...pickExtra(e.extra) }, log: false }
  }
  if (e instanceof TeConfigError) {
    return { status: 503, body: { error: e.message, code: e.code }, log: true }
  }

  const refusal = refusalCode(e)
  if (refusal) {
    return {
      status: refusal === 'TE_FORBIDDEN' ? 403 : 409,
      body: { error: message || 'This is not allowed.', code: refusal, ...pickExtra(o.extra) },
      log: false,
    }
  }

  const code = str(o.code)
  if (MISSING_SCHEMA.has(code)) {
    return { status: 503, body: { error: NOT_INSTALLED, code: 'MIGRATION_PENDING' }, log: true }
  }
  // 42501 = insufficient_privilege. After 151_te_lockdown.sql only the service role may
  // call te_ functions, so this means the server is running on the browser key.
  if (code === '42501') {
    return { status: 503, body: { error: NO_SERVICE_KEY, code: 'TE_SERVICE_KEY' }, log: true }
  }
  if (BAD_VALUE.has(code)) {
    return { status: 400, body: { error: 'One of the values is not allowed, or is already in use. Check the form and try again.', code: 'TE_INVALID' }, log: true }
  }
  // A plain RAISE EXCEPTION from a trigger this module does not own (for example
  // travel_periods' own guard on reopening a month). The text was written for a person.
  if (code === 'P0001' && message) {
    return { status: 409, body: { error: message, code: 'TE_REFUSED' }, log: false }
  }
  return { status: 500, body: { error: GENERIC, code: 'TE_INTERNAL' }, log: true }
}

/** Only the three things a screen acts on leave the server; anything else in `extra` stays here. */
function pickExtra(extra: unknown): Pick<TeErrorBody, 'field' | 'flags' | 'issues'> {
  const x = bag(extra)
  const out: Pick<TeErrorBody, 'field' | 'flags' | 'issues'> = {}
  if (typeof x.field === 'string' && x.field) out.field = x.field
  if (Array.isArray(x.flags)) out.flags = x.flags
  if (Array.isArray(x.issues)) out.issues = x.issues
  return out
}

// ── small validators the routes share ───────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** A path or body id that is not a uuid would reach Postgres as a 22P02 cast error;
 *  refusing it here gives the caller a sentence instead. */
export function needUuid(v: unknown, what: string): string {
  if (!isUuid(v)) throw new TeHttpError(400, 'TE_BAD_REQUEST', `${what} is missing or is not a valid id.`)
  return v
}
export function needText(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new TeHttpError(400, 'TE_BAD_REQUEST', `${what} is required.`)
  return v.trim()
}
export function needOneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new TeHttpError(400, 'TE_BAD_REQUEST', `${what} must be one of: ${allowed.join(', ')}.`)
  }
  return v as T
}
export const optText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
