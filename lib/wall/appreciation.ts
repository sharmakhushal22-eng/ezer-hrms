// lib/wall/appreciation.ts — the direct channel's rules, mirrored from
// send_appreciation().
//
// THIS IS NOT A CHAT, AND THE LIMITS ARE THE FEATURE.
//
// A note requires a category. The recipient may send exactly one thank-back
// and there is no path to a rolling thread. It is throttled, reportable and
// retained. That is deliberate: free-form person-to-person messaging inside
// an HRMS becomes a harassment vector and a records-retention problem, and HR
// ends up owning both.
//
// So nothing in this file may grow a reply chain, a conversation id, or a
// "continue this thread" affordance. If somebody asks for general chat, that
// is a different product with a different risk profile.
//
// HOW IT DIFFERS FROM A SHOUTOUT, and each difference is real:
//
//   visibility   a shoutout chooses an audience; a note goes to the person,
//                and may OPTIONALLY also be posted. Two different questions.
//   message      send_appreciation has no minimum length. A shoutout is
//                published to colleagues and needs to say something; "thank
//                you" sent privately to one person is already complete.
//   quota        its own counter, dm_daily_limit, defaulting to 10 — not the
//                shoutout's 5.

export interface DirectRules {
  enabled: boolean
  requireCategory: boolean
  maxReceivers: number
  dailyLimit: number
  allowShareToFeed: boolean
}

export const DEFAULT_DIRECT: DirectRules = {
  enabled: true, requireCategory: true, maxReceivers: 10,
  dailyLimit: 10, allowShareToFeed: true,
}

/** Where the note goes. Not a visibility scope — a different question. */
export type SendMode = 'private' | 'also_post'

export interface DirectDraft {
  receiverIds: string[]
  categoryCode: string | null
  body: string
  mode: SendMode
  /** Only meaningful when mode is 'also_post'. */
  visibility: string
}

export const EMPTY_DIRECT: DirectDraft = {
  receiverIds: [], categoryCode: null, body: '', mode: 'private', visibility: 'company',
}

export type DirectField = 'receivers' | 'category' | 'body' | 'quota' | 'mode'
export interface DirectProblem { field: DirectField; message: string }

export interface DirectContext {
  actorId: string
  sentToday?: number
  nameOf?: (id: string) => string
}

export function directProblems(
  d: DirectDraft, ctx: DirectContext, rules: DirectRules = DEFAULT_DIRECT,
): DirectProblem[] {
  const out: DirectProblem[] = []
  const ids = d.receiverIds ?? []

  if (!rules.enabled) {
    out.push({ field: 'mode', message: 'Direct appreciation is switched off for this company.' })
    return out          // nothing else is worth saying
  }

  if (ids.length === 0) out.push({ field: 'receivers', message: 'Pick at least one person.' })
  if (ids.includes(ctx.actorId)) {
    out.push({ field: 'receivers', message: 'You cannot send appreciation to yourself.' })
  }
  if (new Set(ids).size !== ids.length) {
    out.push({ field: 'receivers', message: 'Somebody is on the list twice.' })
  }
  if (ids.length > rules.maxReceivers) {
    out.push({ field: 'receivers',
      message: `You can appreciate up to ${rules.maxReceivers} people at once.` })
  }

  if (rules.requireCategory && !d.categoryCode) {
    out.push({ field: 'category', message: 'Pick what you are appreciating them for.' })
  }

  // No minimum length — see the note at the top. But an empty note is not a
  // note, and the database would store a blank row.
  if (!d.body.trim()) {
    out.push({ field: 'body', message: 'Say something, however short.' })
  }

  if (d.mode === 'also_post' && !rules.allowShareToFeed) {
    out.push({ field: 'mode',
      message: 'Your company does not allow appreciation notes to be posted to the feed.' })
  }

  if ((ctx.sentToday ?? 0) >= rules.dailyLimit) {
    out.push({ field: 'quota',
      message: `You have sent all ${rules.dailyLimit} appreciation notes for today.` })
  }
  return out
}

export function canSendDirect(
  d: DirectDraft, ctx: DirectContext, rules: DirectRules = DEFAULT_DIRECT,
): boolean {
  return directProblems(d, ctx, rules).length === 0
}

export function directProblemFor(f: DirectField, list: DirectProblem[]): string | null {
  return list.find(p => p.field === f)?.message ?? null
}

export function notesLeftToday(ctx: DirectContext, rules: DirectRules = DEFAULT_DIRECT): number {
  return Math.max(0, rules.dailyLimit - (ctx.sentToday ?? 0))
}

/** What each send mode actually does, said before the person commits to it. */
export function modeNote(mode: SendMode, allowShare: boolean): string {
  if (mode === 'private') {
    return 'Only they will see this. They can send one thank-you back, and that ends it.'
  }
  return allowShare
    ? 'They get the note, and it also appears on the company feed for others to see.'
    : 'Your company does not allow this.'
}

/**
 * The sentence that sets expectations about the reply.
 *
 * Somebody who sends a note and gets one reply should not be left wondering
 * why they cannot answer it. Saying so up front is kinder than a disabled
 * box later, and it is the honest description of a channel that is
 * deliberately not a conversation.
 */
export const REPLY_RULE =
  'They can reply once to say thanks. Notes are not a chat — there is no back-and-forth.'
