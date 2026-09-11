// lib/broadcast/channel.ts — the company broadcast channel.
//
// A channel, not a conversation. One person addresses everybody; nobody
// answers in public. The rules are here rather than inside the screens
// because two of them are the whole feature, and a screen that forgets one
// does not look broken — it just quietly becomes a group chat.
//
//   1. NO PUBLIC REPLIES. A broadcast has no thread. Not "replies hidden" —
//      there is nowhere for one to go, in the schema or here.
//   2. A RESPONSE IS PRIVATE TO THE PUBLISHER. An employee can still ask a
//      question; it reaches the person who published and nobody else, and
//      they are notified it arrived.
//   3. WHO MAY PUBLISH IS A CONFIGURED LIST, not a role. An admin maintains
//      it in the inbox setup screen.

export type Priority = 'NORMAL' | 'IMPORTANT' | 'URGENT'

export const PRIORITY_LABEL: Record<Priority, string> = {
  NORMAL: 'Notice', IMPORTANT: 'Important', URGENT: 'Urgent',
}

/** What each level is FOR. Without this every notice becomes urgent within a
 *  month, and then none of them are. */
export const PRIORITY_MEANING: Record<Priority, string> = {
  NORMAL:    'Read it when you get to it. Most things are this.',
  IMPORTANT: 'Read it today. It changes something you do.',
  URGENT:    'Read it now. Safety, a closure, or a deadline that is hours away.',
}

export interface Publisher {
  employeeId: string
  name: string
  isActive: boolean
  grantedBy?: string | null
  grantedAt?: string | null
  grantReason?: string | null
}

export interface Broadcast {
  id: string
  title: string
  body: string
  priority: Priority
  publishedBy: string
  publisherName?: string | null
  sourceDepartment?: string | null
  publishedAt: string
  isPinned: boolean
  isActive: boolean
}

// ── rule 3: who may publish ──────────────────────────────────────────────

export interface Verdict { allowed: boolean; because: string }

/**
 * Can this person publish to the channel?
 *
 * A list lookup, never a role check. Writing "HR may broadcast" into the code
 * means a deployment every time the communications lead changes, and it
 * silently excludes an MD who holds no HR role — who is exactly the person
 * most likely to need this at 9pm.
 */
export function canPublish(employeeId: string, publishers: Publisher[]): Verdict {
  const p = publishers.find(x => x.employeeId === employeeId)
  if (!p) {
    return { allowed: false, because:
      'You are not on the publisher list for this channel. An admin can add you in Inbox setup.' }
  }
  if (!p.isActive) {
    return { allowed: false, because:
      'Your publishing access was revoked. An admin can restore it in Inbox setup.' }
  }
  return { allowed: true, because: '' }
}

/**
 * Rule 1, stated once so no screen has to remember it.
 *
 * It has to carry BOTH halves. The first version said only that replies were
 * disabled, and it sat directly above a "Reply privately" button — two true
 * statements that read as a contradiction, which is how somebody ends up
 * assuming the button posts publicly and then finds out it did not.
 */
export const REPLIES_DISABLED =
  'Broadcasts cannot be replied to in public — everybody in the company sees ' +
  'these, and an announcement with a comment section under it stops being an ' +
  'announcement. If you need to answer one, reply privately to whoever sent ' +
  'it; only they will see it.'

/**
 * Rule 2 — an employee may respond, but privately.
 *
 * Deliberately allowed for EVERY recipient rather than a chosen few. The
 * point of the private channel is that somebody who spots an error in a
 * notice can say so without contradicting it in front of 400 people. Limiting
 * that to seniors would remove the one group most likely to notice the error.
 */
export function canRespond(employeeId: string, b: Broadcast): Verdict {
  if (!b.isActive) {
    return { allowed: false, because: 'This notice has been withdrawn.' }
  }
  if (employeeId === b.publishedBy) {
    return { allowed: false, because: 'You published this one.' }
  }
  return { allowed: true, because: '' }
}

/** Who can read a given private response. Two people, and that is the point. */
export function canReadResponse(
  employeeId: string, r: { authorId: string; recipientId: string },
): boolean {
  return employeeId === r.authorId || employeeId === r.recipientId
}

// ── ordering and unread ──────────────────────────────────────────────────

const RANK: Record<Priority, number> = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 }

/**
 * The order the channel reads in: pinned first, then by urgency, then newest.
 *
 * Urgency outranks recency on purpose. A safety notice from Tuesday matters
 * more than a canteen menu from this morning, and a strict reverse-chronology
 * feed buries it by lunchtime.
 */
export function ordered(list: Broadcast[]): Broadcast[] {
  return [...list].filter(b => b.isActive).sort((a, b) =>
    Number(b.isPinned) - Number(a.isPinned) ||
    RANK[a.priority] - RANK[b.priority] ||
    b.publishedAt.localeCompare(a.publishedAt))
}

export function unreadCount(list: Broadcast[], readIds: Set<string>): number {
  return ordered(list).filter(b => !readIds.has(b.id)).length
}

// ── composing ────────────────────────────────────────────────────────────

export interface Draft {
  title: string
  body: string
  priority: Priority
  sourceDepartmentId?: string | null
  isPinned?: boolean
}

export interface DraftCheck { ok: boolean; faults: string[]; warnings: string[] }

/** The shortest body worth sending to the whole company. */
const MIN_BODY = 40

/**
 * What a broadcast owes before it goes to everybody.
 *
 * Stricter than an ordinary message, and it should be: this cannot be
 * unsent, it interrupts several hundred people at once, and a notice that
 * says "Please note the below." with nothing below is how a channel loses
 * the attention it needs for the notice that matters.
 */
export function checkDraft(d: Draft, publishers: Publisher[], by: string): DraftCheck {
  const faults: string[] = [], warnings: string[] = []

  const may = canPublish(by, publishers)
  if (!may.allowed) faults.push(may.because)

  const title = d.title.trim(), body = d.body.trim()
  if (!title) faults.push('It needs a subject line — that is all most people will read.')
  else if (title.length < 8) faults.push('The subject is too short to say anything.')
  else if (title.length > 120) faults.push('Keep the subject under 120 characters so it is not cut off in a list.')

  if (!body) faults.push('There is no message.')
  else if (body.length < MIN_BODY) {
    faults.push(`The message is ${body.length} characters. Under ${MIN_BODY} it will raise more questions than it answers, and nobody can reply to ask.`)
  }

  // Warnings, not blocks — a judgement call that belongs to the person sending.
  if (d.priority === 'URGENT' && !d.isPinned) {
    warnings.push('Urgent but not pinned. It will slide down the channel as other notices arrive.')
  }
  if (/\b(asap|urgent(ly)?|immediately)\b/i.test(title) && d.priority === 'NORMAL') {
    warnings.push('The subject says it is urgent but the priority is set to Notice.')
  }
  if (title === title.toUpperCase() && title.length > 12) {
    warnings.push('An all-capitals subject reads as shouting, and screen readers spell it out letter by letter.')
  }

  return { ok: faults.length === 0, faults, warnings }
}

/** Line for the compose screen: exactly who this is about to interrupt. */
export function audienceLine(headcount: number | null): string {
  if (headcount === null) return 'This goes to everybody in the company.'
  return `This goes to all ${headcount} ${headcount === 1 ? 'person' : 'people'} in the company, and cannot be unsent.`
}
