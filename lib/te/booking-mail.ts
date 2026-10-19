// lib/te/booking-mail.ts — the mail the desk sends a traveller with their ticket.
//
// The subject and body are the company's, edited in Admin → Travel and Expense,
// because what a travel desk says to a traveller is a matter of house style and
// not something to hard-code: one company signs off "Safe travels", another
// lists a 24-hour number. Each of the three companies can word it differently.
//
// PLACEHOLDERS, NOT A TEMPLATE LANGUAGE. {{name}} and its friends, substituted
// literally. Anything resembling logic in a template is a second program that
// nobody can test and an administrator can break from a text box; if the mail
// ever needs a condition, it needs a developer.
//
// WHAT IS DELIBERATELY NOT HERE: sending. This file turns a booking into words.
// The route does the provider call, and keeps the decision about who the
// address belongs to in one place.

/** Everything the wording can refer to. All strings: a template substitutes
 *  text, and a half-formatted number is worse than none. */
export interface BookingMailFacts {
  name: string
  tripNo: string
  tripName: string
  /** 'Delhi airport T3 → Pune airport', or the hotel's city for a stay. */
  route: string
  /** 'Mon 15 Dec', or a range for a stay. */
  on: string
  vendor: string
  reference: string
  amount: string
  /** 'flight', 'train', 'hotel' — what was booked, in a word. */
  kind: string
  /** The company, for a sign-off. */
  company: string
  /** Who is sending it, so a reply has a name to go to. */
  from: string
}

export interface MailTemplate { subject: string; body: string }

/**
 * What a company gets before anybody edits it.
 *
 * Written to be sendable as it stands: a traveller who receives only this,
 * with the ticket attached, has everything they need — what was booked, when,
 * the reference to quote, and who to reply to.
 */
export const DEFAULT_TEMPLATE: MailTemplate = {
  subject: '{{kind}} booked for {{tripName}} — {{on}}',
  body: [
    'Hello {{name}},',
    '',
    'Your {{kind}} for {{tripName}} ({{tripNo}}) is booked and attached to this email.',
    '',
    '  {{route}}',
    '  {{on}}',
    '  {{vendor}} · {{reference}}',
    '',
    'Please keep the attachment with you for the journey. Reply to this email if anything needs changing and the travel desk will sort it out.',
    '',
    '{{from}}',
    'Travel Desk, {{company}}',
  ].join('\n'),
}

/** Every placeholder a template may use, for the admin screen to list. */
export const PLACEHOLDERS: (keyof BookingMailFacts)[] = [
  'name', 'tripNo', 'tripName', 'route', 'on', 'vendor', 'reference', 'amount', 'kind', 'company', 'from',
]

/**
 * Substitute the facts into one string.
 *
 * AN UNKNOWN PLACEHOLDER IS LEFT ALONE rather than blanked. A typo like
 * {{nme}} then shows up in the test send as itself, which tells the
 * administrator what they got wrong; silently swallowing it would send a
 * sentence with a hole in it and no clue why.
 *
 * A KNOWN PLACEHOLDER WITH NOTHING BEHIND IT becomes empty, because a trip
 * genuinely may have no project or no amount, and "{{amount}}" in a
 * traveller's inbox is worse than a gap.
 */
export function fill(text: string, facts: BookingMailFacts): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(facts, key) ? (facts[key as keyof BookingMailFacts] ?? '') : whole)
}

/** The subject and body, filled in. Falls back to the default per field, so a
 *  company that has cleared only its subject still gets a usable one. */
export function renderBookingMail(template: Partial<MailTemplate> | null | undefined, facts: BookingMailFacts): MailTemplate {
  const subject = (template?.subject ?? '').trim() || DEFAULT_TEMPLATE.subject
  const body = (template?.body ?? '').trim() || DEFAULT_TEMPLATE.body
  return { subject: fill(subject, facts).trim(), body: fill(body, facts) }
}

/**
 * Which address a booking should go to, and why.
 *
 * The work address first — this is company travel and the company's own
 * record of it. A personal address is a real fallback, not an error: on this
 * data most people have only that. Returns null when there is nowhere to send,
 * which the caller must refuse on rather than guess.
 */
export function addressFor(who: { office_email?: string | null; personal_email?: string | null }): { to: string; kind: 'work' | 'personal' } | null {
  const work = (who.office_email ?? '').trim()
  if (work) return { to: work, kind: 'work' }
  const personal = (who.personal_email ?? '').trim()
  if (personal) return { to: personal, kind: 'personal' }
  return null
}
