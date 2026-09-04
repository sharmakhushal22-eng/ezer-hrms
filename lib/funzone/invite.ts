// lib/funzone/invite.ts — asking a colleague to play, and the state it moves
// through.
//
// An invite is a small thing that can still go wrong in ways people notice:
// two invites to the same person for the same game, an invite accepted an
// hour after it was sent when nobody is at their desk, an invite to somebody
// who has left. Each of those is a rule here rather than a thing the screen
// happens to prevent.
//
// WHY IT EXPIRES. A game invite is an offer to do something NOW. An accept
// twenty minutes later starts a game against an empty chair, and the person
// who accepted sits waiting for a move that will not come. Fifteen minutes is
// long enough to come back from a tea break and short enough not to strand
// anybody.

export const INVITE_TTL_MINUTES = 15

export type InviteStatus =
  | 'PENDING'    // sent, not answered
  | 'ACCEPTED'   // a session exists
  | 'DECLINED'
  | 'CANCELLED'  // withdrawn by the sender
  | 'EXPIRED'

export const STATUS_LABEL: Record<InviteStatus, string> = {
  PENDING: 'waiting for an answer',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'withdrawn',
  EXPIRED: 'expired',
}

export interface Invite {
  id: string
  gameCode: string
  fromId: string
  fromName?: string | null
  toId: string
  toName?: string | null
  status: InviteStatus
  /** ISO. Compared against a `now` that is always passed in — reading the
   *  clock inside these functions would make every rule untestable. */
  createdAt: string
  message?: string | null
}

export interface Verdict { ok: boolean; because: string }

function minutesBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 60000
}

/** Has it timed out? Independent of `status`, because nothing sweeps the
 *  table — a PENDING row simply stops being actionable once it is old. */
export function isExpired(inv: Invite, now: string): boolean {
  const mins = minutesBetween(inv.createdAt, now)
  return Number.isFinite(mins) && mins >= INVITE_TTL_MINUTES
}

/** The status to SHOW, which is not always the one stored. */
export function effectiveStatus(inv: Invite, now: string): InviteStatus {
  if (inv.status === 'PENDING' && isExpired(inv, now)) return 'EXPIRED'
  return inv.status
}

export function minutesLeft(inv: Invite, now: string): number {
  return Math.max(0, Math.ceil(INVITE_TTL_MINUTES - minutesBetween(inv.createdAt, now)))
}

/**
 * May this person invite that person to this game?
 *
 * `existing` is the sender's outstanding invites, so a second invite to the
 * same person for the same game is refused. Without that, an impatient
 * sender clicking twice puts two invites in somebody's inbox and starts two
 * sessions when both are accepted.
 */
export function canInvite(
  fromId: string, toId: string, gameCode: string,
  { liveGames, existing, now, toIsActive = true }: {
    liveGames: string[]
    existing: Invite[]
    now: string
    toIsActive?: boolean
  },
): Verdict {
  if (fromId === toId) {
    return { ok: false, because: 'You cannot invite yourself.' }
  }
  if (!liveGames.includes(gameCode)) {
    return { ok: false, because: 'That game has no two-player mode.' }
  }
  if (!toIsActive) {
    return { ok: false, because: 'That person has left the company.' }
  }
  const open = existing.find(i =>
    i.toId === toId && i.gameCode === gameCode &&
    effectiveStatus(i, now) === 'PENDING')
  if (open) {
    return { ok: false, because:
      `You already have an invite waiting with them — ${minutesLeft(open, now)} minutes left on it.` }
  }
  return { ok: true, because: '' }
}

/** May the recipient accept? Only the recipient, only while it is live. */
export function canAccept(inv: Invite, who: string, now: string): Verdict {
  const st = effectiveStatus(inv, now)
  if (inv.toId !== who) {
    return { ok: false, because: 'This invite was not sent to you.' }
  }
  if (st === 'EXPIRED') {
    return { ok: false, because:
      `This invite has expired. Invites last ${INVITE_TTL_MINUTES} minutes, because a game is an offer to play now.` }
  }
  if (st !== 'PENDING') {
    return { ok: false, because: `This invite was already ${STATUS_LABEL[st]}.` }
  }
  return { ok: true, because: '' }
}

/** The sender may withdraw; the recipient may decline. Neither may do the
 *  other's, which is the whole reason this is two functions. */
export function canCancel(inv: Invite, who: string, now: string): Verdict {
  if (inv.fromId !== who) {
    return { ok: false, because: 'Only the person who sent it can withdraw it.' }
  }
  if (effectiveStatus(inv, now) !== 'PENDING') {
    return { ok: false, because: 'It is no longer waiting for an answer.' }
  }
  return { ok: true, because: '' }
}

export function canDecline(inv: Invite, who: string, now: string): Verdict {
  if (inv.toId !== who) {
    return { ok: false, because: 'This invite was not sent to you.' }
  }
  if (effectiveStatus(inv, now) !== 'PENDING') {
    return { ok: false, because: 'It is no longer waiting for an answer.' }
  }
  return { ok: true, because: '' }
}

/** Inbox ordering: things needing an answer first, then newest. */
export function inboxOrder(list: Invite[], me: string, now: string): Invite[] {
  const rank = (i: Invite) => {
    const st = effectiveStatus(i, now)
    if (st === 'PENDING' && i.toId === me) return 0   // waiting on you
    if (st === 'PENDING') return 1                     // waiting on them
    return 2
  }
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt))
}

export function pendingForMe(list: Invite[], me: string, now: string): Invite[] {
  return list.filter(i => i.toId === me && effectiveStatus(i, now) === 'PENDING')
}

/** What the invite says in the inbox. Written here so the notification, the
 *  inbox row and the Fun Zone card cannot word it three different ways. */
export function inviteLine(inv: Invite, gameName: string): string {
  return `${inv.fromName ?? 'A colleague'} wants to play ${gameName} with you`
}
