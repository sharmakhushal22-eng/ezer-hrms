// GET    /api/te/drafts?kind=trip   — the caller's own unfinished work
// POST   /api/te/drafts              — save one: { id?, kind, title?, scope?, step?, body, trip_id?, claim_id? }
// DELETE /api/te/drafts              — discard several: { ids: [...] }
//
// The bulk discard is on the COLLECTION, while discarding one stays on
// /drafts/[id]. Deleting several is an operation on the set, and folding it
// into the single-id route would have meant inventing a magic id.
//
// NO MODULE PERMISSION IS CHECKED, deliberately, and this is the same reasoning
// as /api/te/bookings/request: every other travel route needs Travel Claims
// because somebody is acting on another person's trip, while a draft is the
// caller acting on their own half-finished form. The only question is "is this
// yours", and te_draft_save and te_draft_list answer it by filtering on the
// actor — the employee id is never taken from the request.
//
// A draft is also not a trip. Nothing here validates the body: planTrip and
// prepareExpense refuse incomplete work, which is exactly what a draft is
// allowed to be. The body is stored verbatim and read back verbatim.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needOneOf, needUuid, TeHttpError } from '@/lib/te/errors'
import { draftDeleteMany, draftList, draftSave } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KINDS = ['trip', 'expense', 'claim'] as const

/** As many drafts as one person could plausibly have left behind, matching the
 *  cap in te_draft_delete_many. Refused here too so the caller gets a sentence
 *  rather than a database error. */
const MAX_IDS = 200

/** Matches the CHECK on te_drafts.body. Refused here too so the caller gets a
 *  sentence instead of a constraint violation, and so a runaway autosave is
 *  stopped before it reaches the database. */
const MAX_BODY = 64 * 1024

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    const asked = req.nextUrl.searchParams.get('kind')
    const kind = asked ? needOneOf(asked, KINDS, 'kind') : null
    return { drafts: await draftList(await t.ctx(), kind) }
  })
}

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{
      id?: string; kind?: string; title?: string; scope?: string
      step?: number; body?: unknown; trip_id?: string; claim_id?: string
    }>()
    const kind = needOneOf(body.kind, KINDS, 'kind')
    if (body.body === null || typeof body.body !== 'object' || Array.isArray(body.body)) {
      throw new TeHttpError(400, 'TE_BAD_REQUEST', 'A draft body must be an object.')
    }
    const size = JSON.stringify(body.body).length
    if (size > MAX_BODY) {
      throw new TeHttpError(413, 'TE_BAD_REQUEST', `That draft is ${Math.round(size / 1024)} KB. A draft has to stay under 64 KB — attach files to the form rather than keeping them in it.`)
    }
    // A title is for the person's own list, so it is trimmed to something a
    // row can show rather than refused for being long.
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : undefined
    const step = Number.isFinite(body.step) ? Math.max(0, Math.min(99, Math.trunc(body.step as number))) : 0

    return draftSave(await t.ctx(), {
      id: body.id || null,
      kind,
      title: title || null,
      scope: typeof body.scope === 'string' ? body.scope.trim().slice(0, 40) : null,
      step,
      // Checked just above: an object, and not an array. Stored verbatim.
      body: body.body as Record<string, unknown>,
      trip_id: body.trip_id || null,
      claim_id: body.claim_id || null,
    })
  })
}

export async function DELETE(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body<{ ids?: unknown }>()
    const ids = Array.isArray(body.ids) ? body.ids : null
    if (!ids) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'ids must be a list of draft ids.')
    if (ids.length > MAX_IDS) {
      throw new TeHttpError(400, 'TE_BAD_REQUEST', `Too many drafts at once. Discard up to ${MAX_IDS}.`)
    }
    // Every id is checked here so one malformed entry is a sentence naming the
    // problem, not a cast error from inside Postgres. Ownership is still the
    // filter in SQL: an id that is not the caller's matches nothing.
    return draftDeleteMany(await t.ctx(), ids.map((id, i) => needUuid(String(id), `Draft ${i + 1}`)))
  })
}
