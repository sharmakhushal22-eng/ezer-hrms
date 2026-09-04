// lib/wall/shoutout.ts — the composer's rules, mirrored from create_shoutout().
//
// THE DATABASE IS THE AUTHORITY. Every rule below is enforced again in
// migration 086, and this file cannot weaken any of them — a caller who
// bypasses the UI still hits the same eight checks and gets the same refusal.
//
// So why mirror them at all? Because a rule that only fires on submit teaches
// nothing. Somebody who writes four words, picks six colleagues and presses
// send deserves to have been told about the fifteen-character minimum while
// they were typing, not after. The wording here is deliberately the same as
// the database's, so the message does not change depending on which layer
// caught it.
//
// WHAT THIS FILE MUST NEVER DO
// Recognition never touches pay. There is no points-to-money conversion here,
// no rate, no total. wall_config.payout_linkage is pinned false by a CHECK
// and nothing in this module may work around it.

/** Mirrors wall_config, with the defaults 084 and 086 actually ship. */
export interface WallRules {
  requireCategory: boolean
  requireValue: boolean
  allowGroup: boolean
  maxReceivers: number
  minMessageLength: number
  dailyLimit: number
  cooldownHours: number
}

export const DEFAULT_RULES: WallRules = {
  requireCategory: true,
  requireValue: false,
  allowGroup: true,
  maxReceivers: 10,
  minMessageLength: 15,
  dailyLimit: 5,
  cooldownHours: 24,
}

export interface Draft {
  receiverIds: string[]
  categoryCode: string | null
  /** True when the chosen category demands a company value. */
  categoryRequiresValue?: boolean
  valueIds: string[]
  /** The badge and tags from the recognition catalogue (089). Optional — a
   *  shoutout is still a shoutout without one, and forcing a badge onto every
   *  thank-you would devalue the badges. */
  badgeRef?: string | null
  tagRefs?: string[]
  message: string
  visibility: string
}

export const EMPTY_DRAFT: Draft = {
  receiverIds: [], categoryCode: null, valueIds: [], message: '', visibility: 'company',
  badgeRef: null,
  tagRefs: [],
}

/** Which field a problem belongs to, so the composer can point at it. */
export type Field = 'receivers' | 'category' | 'value' | 'message' | 'quota'

export interface Problem { field: Field; message: string }

export interface Context {
  /** The person composing. They may not recognise themselves. */
  actorId: string
  /** Shoutouts already sent today, from the same counter the database uses. */
  sentToday?: number
  /** Receiver ids this person recognised inside the cooldown window. */
  recentlyRecognised?: string[]
  /** Display names, only so a message can say who rather than a uuid. */
  nameOf?: (id: string) => string
}

/** Characters that count. Leading and trailing space is not a contribution,
 *  and the database measures the trimmed length too. */
export function messageLength(message: string): number {
  return message.trim().length
}

/**
 * Every reason this draft cannot be sent, in the order a person fills the
 * form in — so the first problem reported is the first one they can fix.
 *
 * Returns [] when it is sendable. Never throws: a half-filled draft is the
 * normal state of a form, not an error.
 */
export function problems(
  draft: Draft, ctx: Context, rules: WallRules = DEFAULT_RULES,
): Problem[] {
  const out: Problem[] = []
  const ids = draft.receiverIds ?? []
  const name = (id: string) => ctx.nameOf?.(id) ?? 'that person'

  // ── who ──
  if (ids.length === 0) {
    out.push({ field: 'receivers', message: 'Pick at least one person.' })
  }
  if (ids.includes(ctx.actorId)) {
    out.push({ field: 'receivers', message: 'You cannot recognise yourself.' })
  }
  if (ids.length > 1 && !rules.allowGroup) {
    out.push({ field: 'receivers', message: 'Group shoutouts are switched off for this company.' })
  }
  if (ids.length > rules.maxReceivers) {
    out.push({ field: 'receivers',
      message: `You can recognise up to ${rules.maxReceivers} people at once.` })
  }
  // Duplicates would silently become one row and make the count on screen a lie.
  if (new Set(ids).size !== ids.length) {
    out.push({ field: 'receivers', message: 'Somebody is on the list twice.' })
  }
  const repeat = ids.filter(i => (ctx.recentlyRecognised ?? []).includes(i))
  if (repeat.length) {
    out.push({ field: 'receivers',
      message: repeat.length === 1
        ? `You already recognised ${name(repeat[0])} in the last ${rules.cooldownHours} hours.`
        : `You already recognised ${repeat.length} of these people in the last ${rules.cooldownHours} hours.` })
  }

  // ── what for ──
  if (rules.requireCategory && !draft.categoryCode) {
    out.push({ field: 'category', message: 'Pick what the shoutout is for.' })
  }
  const needsValue = rules.requireValue || Boolean(draft.categoryRequiresValue)
  if (needsValue && (draft.valueIds ?? []).length === 0) {
    out.push({ field: 'value', message: 'This shoutout needs a company value attached.' })
  }

  // ── the words ──
  const len = messageLength(draft.message ?? '')
  if (len < rules.minMessageLength) {
    out.push({ field: 'message',
      message: len === 0
        ? `Say why. At least ${rules.minMessageLength} characters.`
        : `Say a little more — at least ${rules.minMessageLength} characters.` })
  }

  // ── quota ──
  // Reported last because it is the one thing editing the form cannot fix.
  if ((ctx.sentToday ?? 0) >= rules.dailyLimit) {
    out.push({ field: 'quota',
      message: `You have used all ${rules.dailyLimit} shoutouts for today. They reset at midnight.` })
  }
  return out
}

export function canSend(draft: Draft, ctx: Context, rules: WallRules = DEFAULT_RULES): boolean {
  return problems(draft, ctx, rules).length === 0
}

/** The first problem for a given field, for inline display. */
export function problemFor(field: Field, list: Problem[]): string | null {
  return list.find(p => p.field === field)?.message ?? null
}

/**
 * How many shoutouts remain today. Shown before somebody starts writing
 * rather than after they press send.
 */
export function remainingToday(ctx: Context, rules: WallRules = DEFAULT_RULES): number {
  return Math.max(0, rules.dailyLimit - (ctx.sentToday ?? 0))
}

/** Plain-language note for the visibility choice, so the writer knows how far
 *  the note travels before they send it rather than after. */
export function visibilityNote(v: string): string {
  switch (v) {
    case 'company':    return 'Everyone in the company will see this.'
    case 'branch':     return 'People at the same location will see this.'
    case 'department': return 'Their department will see this.'
    case 'team':       return 'Only their immediate team will see this.'
    default:           return 'Your HR team decides who sees this.'
  }
}

export const VISIBILITIES = ['company', 'branch', 'department', 'team'] as const
