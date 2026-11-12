// lib/lms/room-core.ts — the rules of the webinar room, with no server in them: which stream
// addresses the room can show and how they are embedded, when time in the room counts, how much
// of it makes someone an attendee, and what a chat line, question or poll may contain. Pure, so
// the tests read like the rules.
//
// It imports nothing, so the unit tests can load it directly. The two windows below are the Join
// button's (live-core.ts); the tests check they stay the same.

/** Time in the room starts counting this long before the start, as Join opens. */
export const ROOM_OPENS_MIN = 15
/** And keeps counting this long after the planned end, as Join stays open. */
export const ROOM_CLOSES_AFTER_MIN = 30

export interface SessionTimes { starts_at: string; duration_min: number; status: string }
const endsAt = (s: SessionTimes) => new Date(s.starts_at).getTime() + s.duration_min * 60_000

export type StreamKind = 'MEETING' | 'YOUTUBE' | 'VIMEO' | 'HLS'
export const STREAM_KINDS: StreamKind[] = ['MEETING', 'YOUTUBE', 'VIMEO', 'HLS']

/** A heartbeat may add at most this much time: a tab that slept for an hour earns a minute. */
export const BEAT_CREDIT_MAX_S = 60
/** The browser beats this often while the room is open. */
export const BEAT_EVERY_S = 45
/** Someone who beat within this long is counted as watching now. */
export const PRESENT_WINDOW_S = 90

export const CHAT_MAX = 500
export const QUESTION_MAX = 500
export const ANSWER_MAX = 1000
export const CHAT_GAP_MS = 2000
export const QUESTION_GAP_MS = 10_000
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 6

/** The reactions the room offers. Anything else arriving over the channel is ignored. */
export const REACTIONS = ['👏', '❤️', '😂', '🎉', '👍', '🤯'] as const

export interface Stage { kind: 'YOUTUBE' | 'VIMEO' | 'HLS'; src: string }

const YT_ID = /^[A-Za-z0-9_-]{11}$/

function parse(u: string): URL | null {
  try { const x = new URL(u.trim()); return x.protocol === 'https:' ? x : null } catch { return null }
}

/** The YouTube video id in any of its addresses: watch?v=, live/, youtu.be/, embed/, shorts/. */
export function youtubeId(u: string): string | null {
  const x = parse(u)
  if (!x) return null
  const host = x.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = x.pathname.split('/')[1] || null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = x.pathname.split('/')
    if (first === 'watch') id = x.searchParams.get('v')
    else if (['live', 'embed', 'shorts', 'v'].includes(first)) id = second || null
  }
  return id && YT_ID.test(id) ? id : null
}

/** A Vimeo video or live event, as its player address. An unlisted video's hash is kept. */
export function vimeoPlayer(u: string): string | null {
  const x = parse(u)
  if (!x) return null
  const host = x.hostname.replace(/^www\./, '')
  const parts = x.pathname.split('/').filter(Boolean)
  if (host === 'player.vimeo.com') {
    if (parts[0] === 'video' && /^\d+$/.test(parts[1] || '')) return `https://player.vimeo.com/video/${parts[1]}${x.searchParams.get('h') ? `?h=${encodeURIComponent(x.searchParams.get('h')!)}` : ''}`
    return null
  }
  if (host !== 'vimeo.com') return null
  if (parts[0] === 'event' && /^\d+$/.test(parts[1] || '')) return `https://vimeo.com/event/${parts[1]}/embed`
  if (/^\d+$/.test(parts[0] || '')) {
    const hash = parts[1] && /^[0-9a-f]{6,}$/i.test(parts[1]) ? parts[1] : x.searchParams.get('h')
    return `https://player.vimeo.com/video/${parts[0]}${hash ? `?h=${encodeURIComponent(hash)}` : ''}`
  }
  return null
}

/** An HLS playlist: an https address whose path ends in .m3u8. */
export function hlsUrl(u: string): string | null {
  const x = parse(u)
  return x && /\.m3u8$/i.test(x.pathname) ? x.toString() : null
}

/** What the stage shows for this kind and address, or why the address will not do. MEETING has
 *  no stage of its own: the call happens in Zoom, Meet or Teams and the room sits beside it. */
export function stageFor(kind: string | null | undefined, url: string | null | undefined): { stage: Stage | null; problem: string | null } {
  const k = (kind || 'MEETING') as StreamKind
  if (k === 'MEETING') return { stage: null, problem: null }
  const u = String(url || '').trim()
  if (!u) return { stage: null, problem: 'Add the address of the stream.' }
  if (k === 'YOUTUBE') {
    const id = youtubeId(u)
    // nocookie: YouTube sets no tracking cookie until the person presses play.
    return id ? { stage: { kind: k, src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1` }, problem: null }
      : { stage: null, problem: 'That is not a YouTube video or live address (youtube.com/watch?v=…, youtube.com/live/… or youtu.be/…).' }
  }
  if (k === 'VIMEO') {
    const src = vimeoPlayer(u)
    return src ? { stage: { kind: k, src: `${src}${src.includes('?') ? '&' : '?'}autoplay=1&muted=1&playsinline=1` }, problem: null }
      : { stage: null, problem: 'That is not a Vimeo video or event address (vimeo.com/123456789 or vimeo.com/event/…).' }
  }
  if (k === 'HLS') {
    const src = hlsUrl(u)
    return src ? { stage: { kind: k, src }, problem: null } : { stage: null, problem: 'An HLS stream address is an https:// link ending in .m3u8.' }
  }
  return { stage: null, problem: 'Choose how the session is streamed.' }
}

export interface RoomTimes extends SessionTimes {
  live_started_at?: string | null
  live_ended_at?: string | null
}

const ms = (iso: string) => new Date(iso).getTime()

export type RoomPhase = 'cancelled' | 'before' | 'live' | 'ended'

/** Where the room is. The host's "Go live" starts it early and "End" closes it; without either,
 *  the planned times decide, with the same quarter hour of warm-up and half hour of overrun as
 *  the Join button. */
export function roomPhase(s: RoomTimes, now = Date.now()): RoomPhase {
  if (s.status === 'CANCELLED') return 'cancelled'
  if (s.live_ended_at && ms(s.live_ended_at) <= now) return 'ended'
  if (s.live_started_at && ms(s.live_started_at) <= now) return 'live'
  if (s.status === 'COMPLETED') return 'ended'
  if (now < ms(s.starts_at)) return 'before'
  return now <= endsAt(s) + ROOM_CLOSES_AFTER_MIN * 60_000 ? 'live' : 'ended'
}

/** Is time spent in the room counted right now? From the warm-up quarter hour to half an hour
 *  after the end, or for as long as the host has it live. */
export function creditOpen(s: RoomTimes, now = Date.now()): boolean {
  if (s.status === 'CANCELLED') return false
  if (s.live_ended_at && ms(s.live_ended_at) <= now) return false
  if (s.live_started_at && ms(s.live_started_at) <= now) return true
  return now >= ms(s.starts_at) - ROOM_OPENS_MIN * 60_000 && now <= endsAt(s) + ROOM_CLOSES_AFTER_MIN * 60_000
}

/** What one heartbeat adds. The first beat only starts the clock; after that the server's own
 *  clock decides, capped so a laptop that slept does not earn the hours it was closed. */
export function creditBeat(o: { lastBeatAt: string | null | undefined; now: number; open: boolean }): number {
  if (!o.open || !o.lastBeatAt) return 0
  const gap = (o.now - ms(o.lastBeatAt)) / 1000
  return gap > 0 ? Math.min(gap, BEAT_CREDIT_MAX_S) : 0
}

/** Seconds in the room that count as attending: the session's share of its planned length. */
export const attendNeedS = (durationMin: number, pct: number | null | undefined) =>
  Math.round(durationMin * 60 * Math.max(10, Math.min(100, Number(pct) || 50)) / 100)

/** One message or question: trimmed, not empty, not longer than allowed. Null when it will not do. */
export function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s && s.length <= max ? s : null
}

/** A poll's question and options, or why they will not do. */
export function cleanPoll(question: unknown, options: unknown): { question: string; options: string[] } | { problem: string } {
  const q = cleanText(question, 300)
  if (!q) return { problem: 'Write the question (up to 300 characters).' }
  const opts = (Array.isArray(options) ? options : []).map(o => cleanText(o, 120)).filter((o): o is string => !!o)
  const uniq = [...new Set(opts)]
  if (uniq.length < POLL_MIN_OPTIONS || uniq.length > POLL_MAX_OPTIONS) return { problem: `Give between ${POLL_MIN_OPTIONS} and ${POLL_MAX_OPTIONS} different answers.` }
  return { question: q, options: uniq }
}

/** Has enough time passed since this person's last post? */
export const mayPost = (lastAt: string | null | undefined, now: number, gapMs: number) => !lastAt || now - ms(lastAt) >= gapMs

/** Votes per option, from the answer rows. */
export function tally(options: number, votes: { option_idx: number }[]): number[] {
  const out = Array.from({ length: options }, () => 0)
  for (const v of votes) if (v.option_idx >= 0 && v.option_idx < options) out[v.option_idx]++
  return out
}
