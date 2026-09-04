// lib/inbox/errors.ts — is this error "the migration has not been run"?
//
// Its own module, with no server imports, for one reason: it is the piece
// that decides whether the employee sees "not switched on yet" or a raw
// database string, it got that wrong in a way nothing caught, and it cannot
// be unit-tested while it lives beside a file that needs the service-role
// client and the environment.

/**
 * True when 080 has not been applied yet, so the UI can say "not switched on"
 * instead of showing a database error.
 *
 * This was `String(err?.message || err?.code)` — which reads the message when
 * there is one and therefore NEVER looked at the code. PostgREST returns
 * both: code 'PGRST205' and message "Could not find the table
 * 'public.inbox_conversations' in the schema cache". The message contains
 * none of the needles, the code was never reached, so the detector said
 * "installed", the route returned a 500, and the inbox showed the raw
 * PostgREST string to the employee.
 *
 * Every field is searched now, and the actual wording is matched as well as
 * the codes — a detector that depends on one field being absent is a
 * detector that works until it does not.
 */
export function notInstalled(err: any): boolean {
  if (!err) return false
  const hay = [err.code, err.message, err.details, err.hint, typeof err === 'string' ? err : '']
    .filter(Boolean).join(' ').toLowerCase()
  return (
    hay.includes('pgrst205') ||          // PostgREST: table not in the schema cache
    hay.includes('42p01') ||             // Postgres: undefined_table
    hay.includes('could not find the table') ||
    hay.includes('does not exist')
  )
}
