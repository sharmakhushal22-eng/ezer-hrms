// lib/recruitment/joining-followup.ts — the "connect with your candidate" cadence, as arithmetic.
//
// Between the offer going out and the joining date, the hiring manager is reminded to call
// the candidate and ask where things stand. How often depends on how close joining is:
//
//     joining more than 6 days away  → every 4 days
//     joining within 6 days          → every 2 days
//
// The first reminder is measured from the day the offer was sent; every later one from the
// previous reminder. Nothing is sent once the joining date has passed (the candidate has
// either joined — stage moves on — or is a no-show, which is a different conversation).
//
// Pure on purpose: no fetch, no Supabase, no `@/` imports, so the rule is unit-tested
// (node --test) and the cron that applies it has no arithmetic of its own.

export const FAR_CADENCE_DAYS = 4
export const NEAR_CADENCE_DAYS = 2
/** Joining this many days away or fewer is "near": reminders come every 2 days. */
export const NEAR_WINDOW_DAYS = 6

const DAY = 86_400_000
const IST_OFFSET = 5.5 * 3_600_000

/** How often to remind, given the number of days until joining. */
export const cadenceDays = (daysToJoin: number): number =>
  daysToJoin > NEAR_WINDOW_DAYS ? FAR_CADENCE_DAYS : NEAR_CADENCE_DAYS

/** A date-only string ("2026-10-20" or an ISO timestamp) → UTC midnight of that calendar day. */
export function dayUtc(d: string | null | undefined): number | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d))
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return Number.isNaN(t) ? null : t
}

/** Today's calendar day in India, as UTC midnight — joining dates are Indian calendar days. */
export const todayIst = (now: number): number => Math.floor((now + IST_OFFSET) / DAY) * DAY

/** Whole days from today (IST) to the joining date. Negative once it has passed. */
export function daysToJoin(doj: string, now: number): number | null {
  const d = dayUtc(doj)
  return d === null ? null : Math.round((d - todayIst(now)) / DAY)
}

/** The joining date to work from, most authoritative first. Any of them may be missing. */
export function joiningDate(src: {
  onboarding_date?: string | null; doj?: string | null; letter_doj?: string | null
  request_doj?: string | null; negotiation_doj?: string | null
}): string | null {
  return src.onboarding_date || src.doj || src.letter_doj || src.request_doj || src.negotiation_doj || null
}

export interface FollowupInput {
  /** Joining date (date-only or ISO). */
  doj: string | null
  /** When the previous reminder went out; null before the first. */
  lastAt: string | null
  /** When the offer was sent — the baseline for the first reminder. */
  offerSentAt: string | null
  now: number
}

export interface FollowupVerdict {
  due: boolean
  daysToJoin: number | null
  cadence: number | null
  /** Why not, when not due — for the cron's summary. */
  reason?: 'no-doj' | 'joined-or-passed' | 'too-soon'
}

/** Is a reminder due now? */
export function followupDue(i: FollowupInput): FollowupVerdict {
  if (!i.doj) return { due: false, daysToJoin: null, cadence: null, reason: 'no-doj' }
  const left = daysToJoin(i.doj, i.now)
  if (left === null) return { due: false, daysToJoin: null, cadence: null, reason: 'no-doj' }
  if (left < 0) return { due: false, daysToJoin: left, cadence: null, reason: 'joined-or-passed' }
  const cadence = cadenceDays(left)
  const baseline = Date.parse(i.lastAt || i.offerSentAt || '') || 0
  // Measured in calendar days (IST), not milliseconds: the cron fires once a day at a fixed
  // hour, and a reminder sent at 14:31 must not slip to the next day because today's run
  // came at 14:30.
  const elapsedDays = Math.round((todayIst(i.now) - todayIst(baseline)) / DAY)
  if (baseline && elapsedDays < cadence) return { due: false, daysToJoin: left, cadence, reason: 'too-soon' }
  return { due: true, daysToJoin: left, cadence }
}

/** The mail. Plain text; the cron turns newlines into <br> for the HTML part. */
export function followupMail(p: {
  managerName: string | null; candidate: string; role: string | null; mrfNumber: string | null
  doj: string; daysToJoin: number; cadence: number; candidatePhone: string | null; candidateEmail: string | null
}): { subject: string; text: string } {
  const when = new Date(dayUtc(p.doj)!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const inDays = p.daysToJoin === 0 ? 'today' : p.daysToJoin === 1 ? 'tomorrow' : `in ${p.daysToJoin} days`
  const who = `${p.candidate}${p.role ? ` (${p.role})` : ''}${p.mrfNumber ? ` · ${p.mrfNumber}` : ''}`
  const subject = `Connect with your candidate — ${p.candidate} joins ${inDays}`
  const text = `Hi${p.managerName ? ` ${p.managerName}` : ''},

Kindly connect with your candidate ${who} and ask for their status.

Joining date: ${when} (${inDays}).
${p.candidatePhone ? `Phone: ${p.candidatePhone}\n` : ''}${p.candidateEmail ? `Email: ${p.candidateEmail}\n` : ''}
A quick call now — are they still on track, is the notice period going to plan, is there anything they need from us — is what keeps a joining from turning into a no-show.

You will get this reminder every ${p.cadence} days until they join${p.daysToJoin > NEAR_WINDOW_DAYS ? ` (every ${NEAR_CADENCE_DAYS} days once joining is within ${NEAR_WINDOW_DAYS} days)` : ''}.

— EZER HRMS`
  return { subject, text }
}
