// lib/ess/asked.ts — whose portal is this request about?
//
// Typed against the shape it needs rather than against NextRequest, for two
// reasons: this is a security-relevant parser and deserves tests of its own,
// and a test that has to boot Next's module graph to check a string is a test
// nobody runs.
//
// THE BUG THIS EXISTS TO PREVENT COMING BACK
//
// The line in session.ts used to be
//
//     searchParams.get('employee_id') || (req.method !== 'GET' ? null : null)
//
// — a ternary whose branches both return null, left as a placeholder for
// reading the body and never finished. Reads carry the employee id in the
// query string; writes carry it in the body. So `asked` was always null on a
// write, every caller on the legacy dashboard login hit "employee_id is
// required", and the entire ESS product was readable but unwritable. Nobody
// holds an ESS credential yet, so that was every user: messages could not be
// sent, claims could not be filed, nothing could be saved, and every screen
// looked perfectly healthy.

/** Only what this needs. Satisfied by NextRequest, and by a plain Request. */
export interface AskedFrom {
  method: string
  /** The parsed URL. NextRequest calls it nextUrl; a plain Request has .url. */
  nextUrl?: { searchParams: { get(k: string): string | null } }
  url?: string
  clone(): { json(): Promise<unknown> }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function askedEmployeeId(req: AskedFrom): Promise<string | null> {
  const params = req.nextUrl?.searchParams
    ?? (req.url ? new URL(req.url).searchParams : null)
  const fromQuery = params?.get('employee_id')
  if (fromQuery && fromQuery.trim()) return fromQuery.trim()

  if (READ_METHODS.has(req.method.toUpperCase())) return null

  try {
    // Cloned, not read. The route handler calls req.json() itself afterwards
    // and a request body can only be consumed once — reading it here would
    // trade one breakage for another.
    const body = await req.clone().json()
    const v = (body as { employee_id?: unknown } | null)?.employee_id
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    // Not JSON, or no body at all. Not an error — plenty of posts carry
    // neither, and they simply name nobody.
    return null
  }
}
