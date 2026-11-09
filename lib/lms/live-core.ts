// lib/lms/live-core.ts — the rules of a live session (webinar), with no server in them: when
// Join and check-in open, what a recording's progress report may claim, and the calendar
// invitation. Pure, so the tests read like the rules.

/** Join opens a quarter of an hour early, like a meeting room. */
export const JOIN_OPENS_MIN = 15
/** And stays open for latecomers until half an hour after the planned end. */
export const JOIN_CLOSES_AFTER_MIN = 30
/** The attendance code is accepted until an hour after the planned end. */
export const CHECKIN_CLOSES_AFTER_MIN = 60
/** Share of a recording to watch for it to count instead of attending. */
export const RECORDING_DONE_PCT = 90

export interface SessionTimes { starts_at: string; duration_min: number; status: string }

const ms = (iso: string) => new Date(iso).getTime()
export const endsAt = (s: SessionTimes) => ms(s.starts_at) + s.duration_min * 60_000

export type Phase = 'cancelled' | 'upcoming' | 'joinable' | 'live' | 'ended'

/** Where a session is, as the learner sees it. 'joinable' is the warm-up quarter hour. */
export function phaseOf(s: SessionTimes, now = Date.now()): Phase {
  if (s.status === 'CANCELLED') return 'cancelled'
  if (s.status === 'COMPLETED') return 'ended'
  const start = ms(s.starts_at), end = endsAt(s)
  if (now < start - JOIN_OPENS_MIN * 60_000) return 'upcoming'
  if (now < start) return 'joinable'
  if (now <= end) return 'live'
  return now <= end + JOIN_CLOSES_AFTER_MIN * 60_000 ? 'live' : 'ended'
}

export const canJoin = (s: SessionTimes, now = Date.now()) => ['joinable', 'live'].includes(phaseOf(s, now))

export function canCheckIn(s: SessionTimes, now = Date.now()) {
  if (s.status === 'CANCELLED') return false
  return now >= ms(s.starts_at) - JOIN_OPENS_MIN * 60_000 && now <= endsAt(s) + CHECKIN_CLOSES_AFTER_MIN * 60_000
}

/** A code people can read out and type: no 0/O or 1/I to argue over. */
export function newCheckinCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(random() * alphabet.length)]
  return out
}

export const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/[\s-]/g, '').toUpperCase() === b.replace(/[\s-]/g, '').toUpperCase()

/** Seconds of a recording a progress report may add. The browser says how much it played since
 *  the last report; the server's clock says how long it has been, and at up to double speed a
 *  person cannot have watched more than twice that (plus a little for the request itself). */
export function creditRecording(o: { watchedS: number; claimedS: number; elapsedS: number; durationS: number }) {
  const room = Math.max(0, o.elapsedS) * 2 + 3
  const add = Math.max(0, Math.min(Number(o.claimedS) || 0, room))
  const watched = o.durationS > 0 ? Math.min(o.durationS, o.watchedS + add) : o.watchedS + add
  return { watchedS: Math.round(watched * 10) / 10, refusedS: Math.max(0, (Number(o.claimedS) || 0) - add), done: o.durationS > 0 && watched >= o.durationS * RECORDING_DONE_PCT / 100 }
}

// ── The calendar invitation (RFC 5545) ──────────────────────────────────────
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets are folded onto continuation lines that start with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = '', size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch; size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

export interface IcsInput {
  id: string
  sequence: number
  title: string
  description: string | null
  starts_at: string
  duration_min: number
  join_url: string | null
  location: string | null
  organizer: { name: string; email: string } | null
  attendee: { name: string; email: string } | null
  cancelled?: boolean
  /** The page in EZER Learn, put in the description. */
  page?: string | null
}

export function buildIcs(s: IcsInput, now = Date.now()): string {
  const start = ms(s.starts_at)
  const where = s.join_url || s.location || ''
  const desc = [s.description || '', s.join_url ? `Join: ${s.join_url}` : '', s.location ? `Where: ${s.location}` : '', s.page ? `In EZER Learn: ${s.page}` : ''].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//EZER HRMS//EZER Learn//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', `METHOD:${s.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${s.id}@ezer-learn`, `SEQUENCE:${s.sequence}`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + s.duration_min * 60_000)}`,
    `SUMMARY:${text(s.title)}`,
    ...(desc ? [`DESCRIPTION:${text(desc)}`] : []),
    ...(where ? [`LOCATION:${text(where)}`] : []),
    ...(s.join_url ? [`URL:${s.join_url}`] : []),
    ...(s.organizer ? [`ORGANIZER;CN=${text(s.organizer.name)}:mailto:${s.organizer.email}`] : []),
    ...(s.attendee ? [`ATTENDEE;CN=${text(s.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${s.attendee.email}`] : []),
    `STATUS:${s.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(s.cancelled ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${text(s.title)} starts in 15 minutes`, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** "Thu 6 Nov, 4:00 pm IST" — sessions are read in India time, wherever the server runs. */
export function whenWords(iso: string, durationMin?: number): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${day}, ${time} IST${durationMin ? ` (${durationMin} min)` : ''}`
}
