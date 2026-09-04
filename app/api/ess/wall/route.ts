// app/api/ess/wall/route.ts
//
//   POST { action, ...args } -> the wall function's own return value
//
// WHY THIS ROUTE EXISTS
//
// Every wall function identifies its caller with wof_current_employee(), which
// reads the session setting app.current_employee_id. That setting cannot be
// established over PostgREST — set_config() is not exposed, and it is
// transaction-scoped while PostgREST runs one transaction per request. So the
// components, which called Supabase straight from the browser, got a null
// actor and the blunt 'No acting employee in session.' from 086.
//
// Migration 094 adds a *_as wrapper for each of these. The wrapper sets the
// setting for its own transaction and then calls the original, so the actor
// finally arrives. The wrappers take the actor as an ARGUMENT, which is only
// safe because they are revoked from anon and authenticated and granted to
// service_role alone — and because of the single rule this file exists to
// enforce:
//
//   THE ACTOR COMES FROM essRoute, NEVER FROM THE REQUEST.
//
// Nothing below reads an employee id from the body. p_actor is written last,
// after the caller's arguments, so a body carrying its own p_actor cannot
// overwrite it — that is the whole impersonation surface, closed in one line.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

/** action -> the 094 wrapper, and the arguments a client may supply.
 *  An allowlist rather than a pass-through: a client can reach these thirteen
 *  functions with these arguments and nothing else. */
const ACTIONS: Record<string, { fn: string; params: readonly string[]; write: boolean }> = {
  get_wall_inbox:         { fn: 'get_wall_inbox_as',         params: ['p_filter', 'p_limit', 'p_before'] , write: false },
  get_inbox_counts:       { fn: 'get_inbox_counts_as',       params: [] , write: false },
  get_company_feed:       { fn: 'get_company_feed_as',       params: ['p_scope', 'p_category', 'p_kind', 'p_limit', 'p_before'] , write: false },
  get_feed_stats:         { fn: 'get_feed_stats_as',         params: ['p_company'] , write: false },
  create_shoutout:        { fn: 'create_shoutout_as',        params: ['p_receivers', 'p_category', 'p_message', 'p_value_ids', 'p_visibility'] , write: true },
  add_comment:            { fn: 'add_comment_as',            params: ['p_recognition', 'p_body', 'p_parent', 'p_mentions'] , write: true },
  send_appreciation:      { fn: 'send_appreciation_as',      params: ['p_receivers', 'p_category', 'p_body', 'p_related', 'p_also_post', 'p_visibility'] , write: true },
  thank_for_appreciation: { fn: 'thank_for_appreciation_as', params: ['p_message', 'p_body'] , write: true },
  thank_back:             { fn: 'thank_back_as',             params: ['p_recognition'] , write: true },
  mark_inbox_read:        { fn: 'mark_inbox_read_as',        params: ['p_ids'] , write: true },
  request_share_to_feed:  { fn: 'request_share_to_feed_as',  params: ['p_message'] , write: true },
  approve_share_to_feed:  { fn: 'approve_share_to_feed_as',  params: ['p_message', 'p_visibility'] , write: true },
  set_recognition_marks:  { fn: 'set_recognition_marks_as',  params: ['p_recognition', 'p_badge_ref', 'p_tag_refs'] , write: true },
}

/** PostgREST's "no such function". Means 094 has not been run — a deployment
 *  state, not a bug in the caller, so it gets its own message rather than a
 *  generic 500 that would send somebody hunting through the UI code. */
const notInstalled = (e: { code?: string; message?: string } | null) =>
  e?.code === 'PGRST202' || /Could not find the function/i.test(e?.message ?? '')

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error

  // Reads are fine while viewing another portal — that is what viewing is
  // for. Writes are not: recognition is attributed, public and personal, so an
  // admin must not post a shoutout under somebody else's name. Approvals and
  // resignation already refuse on the same grounds.
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const action = String((body as Record<string, unknown>).action ?? '')
  const spec = ACTIONS[action]
  if (!spec) {
    return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 })
  }

  // Copy across only the parameters this action declares, dropping undefined
  // so the function's own defaults apply rather than a null overriding them.
  if (spec.write && ctx.caller.viewAs) {
    // Two different situations, and the earlier message described only one of
    // them. essCaller sets viewAs TRUE UNCONDITIONALLY for the legacy shared
    // dashboard login, because that session is not attached to an employee at
    // all — so somebody signed in that way was told they were "viewing
    // somebody else's portal" while looking at their own.
    //
    // actorEmployeeId separates them: null means the shared login, non-null
    // means a real person looking at a colleague's portal.
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'This session is the shared dashboard login, which is not attached to '
        + 'an employee record. Recognition is posted under a name, so sign in '
        + 'with your own ESS account to send it.'
      : 'Recognition is posted under your own name, so it cannot be sent while '
        + 'you are viewing somebody else\'s portal. Open your own portal to send it.')
  }

  const args: Record<string, unknown> = {}
  for (const p of spec.params) {
    const v = (body as Record<string, unknown>)[p]
    if (v !== undefined) args[p] = v
  }
  // Last, and deliberately so: this assignment wins over anything the body
  // supplied under the same key.
  args.p_actor = ctx.caller.employeeId

  const { data, error: dbError } = await sb.rpc(spec.fn, args)

  if (dbError) {
    if (notInstalled(dbError)) {
      return NextResponse.json({
        error: 'The Wall of Fame is not fully installed yet (migration 094). '
             + 'Ask your administrator to run it.',
        installed: false,
      }, { status: 503 })
    }
    // 42501 is the wall's own "you may not do this", and those messages are
    // written for the person reading them — pass it through rather than
    // replacing it with something vaguer.
    const status = dbError.code === '42501' ? 403 : 400
    return NextResponse.json({ error: dbError.message }, { status })
  }

  return NextResponse.json({ data: data ?? null })
}
