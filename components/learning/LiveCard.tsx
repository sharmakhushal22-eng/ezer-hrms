'use client'
// components/learning/LiveCard.tsx — one live session (webinar) as a learner sees it, and the
// recording viewer. Used by the Live sessions page and by a course's live-session lesson.
//
// Every button is a server call: Join asks for the link (it is handed out only while the room is
// open), the attendance code is checked there, and the recording's progress is credited there
// against the server's clock (lib/lms/live.ts). The screen only shows what came back.
//
// A session with a room in EZER Learn (migration 227) also offers "Enter the room": the stream
// or the meeting's companion, with chat, questions and polls (components/learning/room).
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCheck } from '@/lib/ui'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { errorWords, plural, type LiveSession } from './shared'
import { GCalendar, GClock, GExit, GLayers, GLive, GPlay, GUsers } from './glyphs'
import VideoPlayer from './VideoPlayer'
import { linkProps, to } from './app/router'
import './live.css'

const IST = 'Asia/Kolkata'
const dayParts = (iso: string) => {
  const d = new Date(iso)
  return {
    wd: d.toLocaleDateString('en-GB', { timeZone: IST, weekday: 'short' }),
    day: d.toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric' }),
    mon: d.toLocaleDateString('en-GB', { timeZone: IST, month: 'short' }),
  }
}
export const clockWords = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
export const sessionApi = (id: string) => `/api/lms/me/sessions/${id}`

/** What 227 adds to a session (lib/lms/live.ts, forLearner): absent on an older database. */
type WithRoom = LiveSession & { room_enabled?: boolean; stream?: string }
const roomOf = (s: LiveSession) => s as WithRoom
/** Streamed inside EZER Learn rather than held in a meeting app. */
const streamsHere = (s: LiveSession) => !!roomOf(s).room_enabled && !!roomOf(s).stream && roomOf(s).stream !== 'MEETING'

/** Ticks once every `ms`, for anything that counts down. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export function untilWords(iso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d >= 1) return `in ${plural(d, 'day')}${h ? ` ${h} hr` : ''}`
  if (h >= 1) return `in ${h} hr ${m} min`
  return m >= 1 ? `in ${plural(m, 'minute')}` : 'in under a minute'
}

function StatusTag({ s }: { s: LiveSession }) {
  if (s.phase === 'cancelled') return <span className="lx-tag lx-tag--critical">Cancelled</span>
  const done = s.me?.attended ? <span className="lx-tag lx-tag--positive"><IconCheck size={12} /> Attended</span> : null
  if (s.phase === 'live') return <><span className="lx-tag lx-tag--critical"><span className="lx-live-dot" /> Live now</span>{done}</>
  if (s.phase === 'joinable') return <><span className="lx-tag lx-tag--warning"><span className="lx-live-dot" /> Starting soon</span>{done}</>
  if (s.me?.attended) return <span className="lx-tag lx-tag--positive"><IconCheck size={12} /> Attended</span>
  if (s.me?.recording_done) return <span className="lx-tag lx-tag--positive"><IconCheck size={12} /> Recording watched</span>
  if (s.phase === 'ended') return <span className="lx-tag">{s.has_recording ? 'Recording available' : 'Ended'}</span>
  if (s.me?.registered) return <span className="lx-tag lx-tag--positive">Registered</span>
  if (s.me?.invited && s.me.status === 'DECLINED') return <span className="lx-tag">Not going</span>
  if (s.me?.invited) return <span className="lx-tag lx-tag--brand">Invited</span>
  return <span className="lx-tag">Open to all</span>
}

/** The buttons and the attendance code. Shared by the card and the large "next up" panel. */
export function SessionActions({ s, onChanged, onWatch, big }: { s: LiveSession; onChanged: () => void; onWatch: (s: LiveSession) => void; big?: boolean }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr('')
    try { await fn(); onChanged() } catch (e) { setErr(errorWords(e)) } finally { setBusy('') }
  }
  const join = () => act('join', async () => {
    // Opened before the request so the browser treats it as the click's own window.
    const w = window.open('', '_blank')
    try {
      const r = await lmsApi<{ url: string }>(sessionApi(s.id), { event: 'join' })
      if (w) { w.opener = null; w.location.href = r.url } else window.location.href = r.url
    } catch (e) { w?.close(); throw e }
  })
  const sm = big ? '' : ' lx-btn--sm'
  const upcoming = s.phase === 'upcoming' || s.phase === 'joinable'
  const on = s.phase === 'joinable' || s.phase === 'live'
  // The room: the main button while the session is on; for a stream, also beforehand (countdown and chat).
  const room = !!roomOf(s).room_enabled && (on || (streamsHere(s) && s.phase === 'upcoming'))
  return (
    <div className="lx-lv-actions" data-big={big ? '1' : '0'}>
      <div className="lx-lv-acts">
        {room && <a className={`lx-btn${on ? ' lx-btn--primary' : ''}${sm}`} {...linkProps(to.room(s.id))}><GLive size={15} /> {on ? 'Enter the room' : 'Open the room'}</a>}
        {s.can_join && <button className={`lx-btn${room && on ? '' : ' lx-btn--primary'}${sm}`} disabled={!!busy} onClick={join}><GExit size={15} /> {busy === 'join' ? 'Opening…' : 'Join now'}</button>}
        {upcoming && !s.me?.registered && <button className={`lx-btn${s.can_join || (room && on) ? '' : ' lx-btn--primary'}${sm}`} disabled={!!busy || s.seats_left === 0}
          onClick={() => act('reg', () => lmsApi(sessionApi(s.id), { event: 'register' }))}>{busy === 'reg' ? 'Saving…' : s.seats_left === 0 ? 'Full' : s.me?.invited ? 'Accept' : 'Register'}</button>}
        {upcoming && s.me && <button className={`lx-btn${sm}`} disabled={!!busy}
          onClick={() => act('ics', () => lmsDownload(`${sessionApi(s.id)}?ics=1`, `${s.title.replace(/[^\w-]+/g, '-').slice(0, 60)}.ics`))}><GCalendar size={15} /> Add to calendar</button>}
        {upcoming && s.me && (s.me.registered || (s.me.invited && s.me.status !== 'DECLINED')) && <button className={`lx-btn lx-btn--quiet${sm}`} disabled={!!busy}
          onClick={() => act('unreg', () => lmsApi(sessionApi(s.id), { event: 'unregister' }))}>{busy === 'unreg' ? 'Saving…' : 'Can’t make it'}</button>}
        {s.has_recording && s.phase === 'ended' && <button className={`lx-btn${s.me?.recording_done || s.me?.attended ? '' : ' lx-btn--primary'}${sm}`} onClick={() => onWatch(s)}><GPlay size={14} /> {s.me?.recording_pct ? 'Continue the recording' : 'Watch the recording'}</button>}
      </div>
      {s.has_recording && s.phase === 'ended' && !!s.me?.recording_pct && !s.me.recording_done && (
        <div className="lx-lv-watched"><span className="lx-lv-bar"><i style={{ width: `${s.me.recording_pct}%` }} /></span><span className="lx-num">{s.me.recording_pct}% watched</span></div>
      )}
      {s.can_check_in && (
        <form className="lx-lv-code" onSubmit={e => { e.preventDefault(); if (code.trim()) void act('code', () => lmsApi(sessionApi(s.id), { event: 'checkin', code })) }}>
          <label htmlFor={`code-${s.id}${big ? '-b' : ''}`}>Attendance code<small>The host reads it out during the session</small></label>
          <div>
            <input id={`code-${s.id}${big ? '-b' : ''}`} placeholder="CODE" maxLength={9} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
            <button className={`lx-btn${sm}`} disabled={!!busy || !code.trim()}>{busy === 'code' ? 'Checking…' : 'Record attendance'}</button>
          </div>
        </form>
      )}
      {err && <div className="lx-lv-err" role="alert">{err}</div>}
    </div>
  )
}

/** Which course a session counts for, on a line of its own so a long title cannot push the
 *  card wider than its column. */
function CourseLine({ title }: { title: string }) {
  return <div className="lx-lv-course"><GLayers size={14} /><span className="lx-clamp1">Part of <b>{title}</b></span></div>
}

export function SessionCard({ s, onChanged, onWatch, showCourse = true }: { s: LiveSession; onChanged: () => void; onWatch: (s: LiveSession) => void; showCourse?: boolean }) {
  const now = useNow()
  const p = dayParts(s.starts_at)
  return (
    <article className="lx-lv lx-in" data-phase={s.phase}>
      <div className="lx-lv-date" aria-hidden><b>{p.wd}</b><span>{p.day}</span><i>{p.mon}</i></div>
      <div className="lx-lv-body">
        <div className="lx-lv-tags">
          <StatusTag s={s} />
          {s.seats_left != null && s.phase !== 'ended' && s.phase !== 'cancelled' && <span className="lx-tag lx-num">{s.seats_left ? `${plural(s.seats_left, 'seat')} left` : 'No seats left'}</span>}
        </div>
        <h3 className="lx-lv-title">{s.title}</h3>
        <div className="lx-lv-meta">
          <span><GClock size={14} /> {clockWords(s.starts_at)} – {clockWords(s.ends_at)} IST</span>
          {s.phase === 'upcoming' && <span className="lx-lv-count">{untilWords(s.starts_at, now)}</span>}
          {s.host_name && <span><GUsers size={14} /> {s.host_name}</span>}
          {s.location && <span>{s.location}</span>}
          {streamsHere(s) ? <span><GLive size={14} /> Streams in EZER Learn</span> : !s.has_link && !s.location && <span>Link to follow</span>}
        </div>
        {showCourse && s.course_title && <CourseLine title={s.course_title} />}
        {s.phase === 'cancelled' && s.cancel_reason && <p className="lx-lv-desc">{s.cancel_reason}</p>}
        {s.description && s.phase !== 'cancelled' && <p className="lx-lv-desc lx-clamp2" title={s.description}>{s.description}</p>}
      </div>
      {s.phase !== 'cancelled' && <div className="lx-lv-side"><SessionActions s={s} onChanged={onChanged} onWatch={onWatch} /></div>}
    </article>
  )
}

/** The next session, large: what it is and the buttons on the left, the countdown (or "live
 *  now") on the right. */
export function NextSession({ s, onChanged, onWatch }: { s: LiveSession; onChanged: () => void; onWatch: (s: LiveSession) => void }) {
  const now = useNow(1000)
  const left = Math.max(0, new Date(s.starts_at).getTime() - now)
  const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), sec = Math.floor((left % 60_000) / 1000)
  const on = s.phase === 'live' || s.phase === 'joinable'
  const p = dayParts(s.starts_at)
  return (
    <section className="lx-lv-next lx-in" data-on={on ? '1' : '0'} aria-label="Your next live session">
      <div className="lx-lv-next-main">
        <span className="lx-lv-kicker">{on ? <><span className="lx-live-dot" /> {s.phase === 'live' ? 'Live now' : 'Starting soon'}</> : <><GLive size={15} /> Your next live session</>}</span>
        <h2>{s.title}</h2>
        <div className="lx-lv-meta">
          <span><GCalendar size={14} /> {p.wd} {p.day} {p.mon}</span>
          <span><GClock size={14} /> {clockWords(s.starts_at)} – {clockWords(s.ends_at)} IST · {s.duration_min} min</span>
          {s.host_name && <span><GUsers size={14} /> {s.host_name}</span>}
          {s.location && <span>{s.location}</span>}
        </div>
        {s.course_title && <CourseLine title={s.course_title} />}
        {s.description && <p className="lx-lv-desc lx-clamp2" title={s.description}>{s.description}</p>}
        <SessionActions s={s} onChanged={onChanged} onWatch={onWatch} big />
      </div>
      <div className="lx-lv-next-aside">
        {on ? (
          <div className="lx-lv-now" role="status">
            <span className="lx-live-dot" />
            <b>{s.phase === 'live' ? 'Happening now' : `Starts ${untilWords(s.starts_at, now)}`}</b>
            <span>{s.phase === 'live' ? `Ends at ${clockWords(s.ends_at)} IST` : 'The room is open: you can join now'}</span>
            {s.me?.attended && <span className="lx-tag lx-tag--positive"><IconCheck size={12} /> Attendance recorded</span>}
          </div>
        ) : (
          <div className="lx-lv-clock" role="timer" aria-label={`Starts ${untilWords(s.starts_at, now)}`}>
            {d > 0 && <div><b>{d}</b><span>{d === 1 ? 'day' : 'days'}</span></div>}
            <div><b>{String(h).padStart(2, '0')}</b><span>hours</span></div>
            <div><b>{String(m).padStart(2, '0')}</b><span>min</span></div>
            {d === 0 && <div><b>{String(sec).padStart(2, '0')}</b><span>sec</span></div>}
          </div>
        )}
      </div>
    </section>
  )
}

/** The recording, with its progress reported every 15 seconds of play. Played time is counted
 *  from the video's own clock, so a seek is not "watching"; the server caps it again. */
export function RecordingModal({ s, onClose }: { s: LiveSession; onClose: (changed: boolean) => void }) {
  const [rec, setRec] = useState<{ url: string; duration_s: number; position_s: number; done: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [pct, setPct] = useState(s.me?.recording_pct || 0)
  const [done, setDone] = useState(!!s.me?.recording_done)
  const played = useRef(0), last = useRef<number | null>(null), el = useRef<HTMLMediaElement | null>(null)

  const load = useCallback(() => {
    setErr('')
    lmsApi<{ url: string; duration_s: number; position_s: number; done: boolean }>(sessionApi(s.id), { event: 'recording' }).then(setRec).catch(e => setErr(errorWords(e)))
  }, [s.id])
  useEffect(() => { load() }, [load])

  const send = useCallback(async (keepalive = false) => {
    const add = Math.round(played.current)
    if (!add && !keepalive) return
    played.current = 0
    const body = { event: 'beat', played_s: add, position: el.current?.currentTime || 0 }
    try {
      if (keepalive) { void lmsApi(sessionApi(s.id), body).catch(() => {}); return }
      const r = await lmsApi<{ pct: number; done: boolean }>(sessionApi(s.id), body)
      setPct(r.pct); if (r.done) setDone(true)
    } catch { played.current += add }
  }, [s.id])

  useEffect(() => {
    const t = setInterval(() => void send(), 15_000)
    return () => { clearInterval(t); void send(true) }
  }, [send])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(true) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <div className="lx-modal" role="dialog" aria-modal="true" aria-label={`Recording: ${s.title}`} onClick={() => onClose(true)}>
      <div className="lx-modal-box" onClick={e => e.stopPropagation()}>
        <div className="lx-modal-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--lx-on-stage-soft)' }}>{done ? 'Watched: this counts as attending.' : `${pct}% watched · ${s.me?.attended ? 'you attended live' : 'watch most of it to count as attending'}`}</div>
          </div>
          <button className="lx-btn lx-btn--sm" style={{ background: 'var(--lx-on-stage-faint)', color: 'var(--lx-on-stage)', borderColor: 'transparent' }} onClick={() => onClose(true)}>Close</button>
        </div>
        {err ? <div style={{ padding: 24, color: 'var(--lx-on-stage)' }}>{err} <button className="lx-btn lx-btn--sm" onClick={load}>Try again</button></div>
          : !rec ? <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} /></div>
          : <VideoPlayer src={rec.url} title={s.title} autoPlay globalKeys
              mediaRef={m => { el.current = m; if (m && rec.position_s > 5 && !m.dataset.resumed) { m.dataset.resumed = '1'; m.addEventListener('loadedmetadata', () => { if (rec.position_s < (m.duration || 0) - 5) m.currentTime = rec.position_s }, { once: true }) } }}
              handlers={{
                onTimeUpdate: e => {
                  const t = (e.currentTarget as HTMLMediaElement).currentTime
                  const p = last.current
                  // Only steady forward play counts; a jump is a seek.
                  if (p != null && t > p && t - p < 1.6 * Math.max(1, (e.currentTarget as HTMLMediaElement).playbackRate)) played.current += t - p
                  last.current = t
                },
                onSeeking: () => { last.current = null },
                onPause: () => { last.current = null; void send() },
                onEnded: () => { last.current = null; void send() },
              }} />}
      </div>
    </div>
  )
}

/** Shown where a person can do nothing more about a session list yet. */
export function NoSessions({ children }: { children: React.ReactNode }) {
  return <div className="lx-panel" style={{ padding: 22, color: 'var(--ez-muted)', display: 'flex', gap: 12, alignItems: 'center' }}><GLive size={20} /> <span>{children}</span></div>
}

