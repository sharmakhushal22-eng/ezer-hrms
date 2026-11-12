'use client'
// components/learning/room/Stage.tsx — the left half of the webinar room: what people watch.
//
//   before     a countdown to the start (the host can go live early)
//   live       the YouTube, Vimeo or HLS stream; or, for a session held in Zoom, Meet or Teams,
//              the Join button, with the room's chat and questions beside it
//   ended      a note, and the recording when there is one
//
// The stream starts muted, because browsers only allow sound after a click; every player shows
// its own unmute button.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { linkProps, to } from '../app/router'
import { errorWords } from '../shared'
import { GExit, GLive, GPlay } from '../glyphs'
import type { RoomData } from './types'

/** A stream address ending in .m3u8. Safari plays it as it is; elsewhere hls.js is fetched,
 *  only here and only when a session streams this way. A stream that has not started yet
 *  answers with errors for a while: the player keeps trying, then says so. */
function HlsVideo({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    setErr('')
    let hls: { destroy: () => void } | null = null
    let gone = false
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src
      const fail = () => setErr('The stream is not available yet. It starts when the host begins broadcasting.')
      v.addEventListener('error', fail)
      return () => { gone = true; v.removeEventListener('error', fail); v.removeAttribute('src'); v.load() }
    }
    import('hls.js').then(({ default: Hls }) => {
      if (gone) return
      if (!Hls.isSupported()) { setErr('This browser cannot play the stream. Try Chrome, Edge, Firefox or Safari.'); return }
      const h = new Hls({ lowLatencyMode: true })
      let retries = 0
      h.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); return }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 4) { setTimeout(() => { if (!gone) h.startLoad() }, 3000); return }
        setErr('The stream is not available yet. It starts when the host begins broadcasting.')
        h.destroy()
      })
      h.loadSource(src)
      h.attachMedia(v)
      hls = h
    }).catch(() => setErr('The player could not load. Check your connection and try again.'))
    return () => { gone = true; hls?.destroy() }
  }, [src, attempt])
  return (
    <>
      <video ref={ref} controls playsInline autoPlay muted aria-label={title} />
      {err && (
        <div className="lx-stage-card" role="status">
          <span className="lx-stage-kicker"><GLive size={15} /> Waiting for the stream</span>
          <p>{err}</p>
          <div className="lx-stage-acts"><button className="lx-btn lx-btn--sm" onClick={() => setAttempt(a => a + 1)}>Try again</button></div>
        </div>
      )}
    </>
  )
}

function Countdown({ at, now }: { at: string; now: number }) {
  const left = Math.max(0, new Date(at).getTime() - now)
  const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), s = Math.floor((left % 60_000) / 1000)
  const cells = d > 0 ? [[d, d === 1 ? 'day' : 'days'], [h, 'hours'], [m, 'min']] : [[h, 'hours'], [m, 'min'], [s, 'sec']]
  return (
    <div className="lx-stage-clock" role="timer" aria-label={`Starts in ${d ? `${d} days ` : ''}${h} hours ${m} minutes`}>
      {cells.map(([n, l]) => <div key={l as string}><b>{String(n).padStart(2, '0')}</b><span>{l}</span></div>)}
    </div>
  )
}

/** Join for a session held in Zoom, Meet or Teams. A learner asks the server for the link, which
 *  is handed out only while the session is open; the host has it already. */
function MeetingJoin({ data }: { data: RoomData }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const s = data.session
  if (data.me.host && data.host_join_url) return <a className="lx-btn lx-btn--primary" href={data.host_join_url} target="_blank" rel="noopener noreferrer"><GExit size={15} /> Open the meeting</a>
  if (!s.has_link || !data.me.learner) return s.location ? <p>Held in person: {s.location}</p> : null
  const join = async () => {
    setBusy(true); setErr('')
    // Opened before the request so the browser treats it as the click's own window.
    const w = window.open('', '_blank')
    try {
      const r = await lmsApi<{ url: string }>(`/api/lms/me/sessions/${s.id}`, { event: 'join' })
      if (w) { w.opener = null; w.location.href = r.url } else window.location.href = r.url
    } catch (e) { w?.close(); setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <button className="lx-btn lx-btn--primary" disabled={busy} onClick={join}><GExit size={15} /> {busy ? 'Opening…' : 'Join the meeting'}</button>
      {err && <div className="lx-stage-err" role="alert">{err}</div>}
    </>
  )
}

export default function Stage({ data, now, onGoLive, busy, children }: {
  data: RoomData; now: number; onGoLive: () => void; busy: boolean
  /** The reactions layer, drawn over whatever is on the stage. */
  children?: ReactNode
}) {
  const s = data.session
  const host = data.me.host
  let body: ReactNode
  if (s.phase === 'cancelled') {
    body = <div className="lx-stage-card"><span className="lx-stage-kicker">Cancelled</span><h2>{s.title}</h2><p>This session will not take place.</p></div>
  } else if (s.phase === 'ended') {
    body = (
      <div className="lx-stage-card">
        <span className="lx-stage-kicker">The session has ended</span>
        <h2>{s.title}</h2>
        <p>{s.has_recording ? 'The recording is ready. Watching most of it counts the same as attending.' : 'Thank you for joining. If the host shares a recording, it appears under Live sessions.'}</p>
        {s.has_recording && data.me.learner && <div className="lx-stage-acts"><a className="lx-btn lx-btn--primary" {...linkProps(to.live(s.id))}><GPlay size={14} /> Watch the recording</a></div>}
      </div>
    )
  } else if (s.phase === 'before') {
    const soon = new Date(s.starts_at).getTime() - now <= 15 * 60_000
    body = (
      <div className="lx-stage-card">
        <span className="lx-stage-kicker"><GLive size={15} /> {soon ? 'Starting soon' : 'Coming up'}</span>
        <h2>{s.title}</h2>
        <Countdown at={s.starts_at} now={now} />
        <p>{s.stream_kind === 'MEETING' ? 'The meeting link opens 15 minutes before the start. Chat and questions are open now.' : 'The stream appears here when the session starts. Say hello in the chat, or ask a question now.'}</p>
        <div className="lx-stage-acts">
          {s.stream_kind === 'MEETING' && soon && <MeetingJoin data={data} />}
          {host && <button className="lx-btn lx-btn--primary" disabled={busy} onClick={onGoLive}><GLive size={15} /> Go live now</button>}
        </div>
      </div>
    )
  } else if (data.stage) {
    body = data.stage.kind === 'HLS'
      ? <HlsVideo src={data.stage.src} title={s.title} />
      : <iframe src={data.stage.src} title={`${s.title}: live stream`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  } else {
    body = (
      <div className="lx-stage-card">
        <span className="lx-stage-kicker"><span className="lx-live-dot" /> Live now</span>
        <h2>{s.title}</h2>
        <p>{s.stream_kind === 'MEETING' ? 'This session runs in your company’s meeting app. Join it there and keep this room open for questions, polls and your attendance.' : 'The stream address is missing. The host can add it in the Studio.'}</p>
        <div className="lx-stage-acts">{s.stream_kind === 'MEETING' && <MeetingJoin data={data} />}</div>
      </div>
    )
  }
  return (
    <div className="lx-stage">
      {body}
      {s.phase === 'live' && data.stage && <span className="lx-stage-live" aria-hidden><span className="lx-live-dot" /> Live</span>}
      {children}
    </div>
  )
}
