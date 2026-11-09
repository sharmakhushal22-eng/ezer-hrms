'use client'
// components/learning/VideoPlayer.tsx — the player EZER Learn draws around a video or audio file.
//
// The browser's own controls differ in every browser and cannot show what this product needs:
// where the learner has already watched, where skipping ahead is not allowed yet, and captions
// that come from a file HR attached. So the element is drawn bare and the controls are ours.
//
// SOUND. Nothing here ever mutes. The element starts with sound at the volume the person last
// chose (kept in this browser only), and playback only ever starts from a click or a key, which
// is what lets browsers play sound at all.
//
// The caller keeps the reporting (components/learning/PlayerMedia.tsx): it receives the element
// through mediaRef and the media events through `handlers`. This file only plays.
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import {
  GBack10, GCaptions, GFull, GFullExit, GFwd10, GGear, GHeadphones, GMute, GPause, GPip, GPlay, GVolume, GVolumeLow,
} from './glyphs'

export interface Caption { label: string; src: string; lang?: string }
type MediaHandler = (e: SyntheticEvent<HTMLMediaElement>) => void
export interface MediaHandlers {
  onLoadedMetadata: MediaHandler; onPlaying: MediaHandler; onTimeUpdate: MediaHandler; onSeeking: MediaHandler; onSeeked: MediaHandler
  onPause: MediaHandler; onEnded: MediaHandler; onError: MediaHandler; onRateChange: MediaHandler
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const VOL_KEY = 'ezl-volume'
const IDLE_MS = 2600

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

function savedVolume(): number {
  try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1 } catch { return 1 }
}

/** Captions files are fetched and handed to the element as same-origin blobs, so the video
 *  itself never needs crossorigin (which would change how the storage server must answer). */
function useCaptionUrls(caps: Caption[] | undefined) {
  const [urls, setUrls] = useState<Caption[]>([])
  const key = (caps || []).map(c => c.src).join('|')
  useEffect(() => {
    let live = true
    const made: string[] = []
    Promise.all((caps || []).map(async c => {
      try {
        const r = await fetch(c.src)
        if (!r.ok) return null
        const text = await r.text()
        if (!/^﻿?WEBVTT/.test(text.trim())) return null
        const u = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
        made.push(u)
        return { ...c, src: u }
      } catch { return null }
    })).then(list => { if (live) setUrls(list.filter(Boolean) as Caption[]) })
    return () => { live = false; made.forEach(u => URL.revokeObjectURL(u)) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return urls
}

function Scrubber({ current, duration, buffered, seen, lockFrom, onSeek, onDrag }: {
  current: number; duration: number; buffered: number; seen: [number, number][]; lockFrom: number | null
  onSeek: (t: number) => void; onDrag: (on: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (duration || 0)
  }
  const pct = (t: number) => `${duration ? Math.min(100, (t / duration) * 100) : 0}%`
  const down = (e: React.PointerEvent) => {
    if (!duration) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag(true); onDrag(true); onSeek(at(e.clientX))
  }
  const move = (e: React.PointerEvent) => {
    if (!duration) return
    const t = at(e.clientX)
    setHover(t)
    if (drag) onSeek(t)
  }
  const up = () => { if (drag) { setDrag(false); onDrag(false) } }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onSeek(Math.max(0, current - 5)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(Math.min(duration, current + 5)) }
  }
  return (
    <div ref={ref} className="lx-vp-scrub" data-drag={drag ? '1' : '0'} role="slider" tabIndex={0} aria-label="Seek"
      aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(current)} aria-valuetext={`${clock(current)} of ${clock(duration)}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => { if (!drag) setHover(null) }} onKeyDown={key}>
      <div className="lx-vp-track">
        {seen.map(([a, b], i) => <i key={i} className="lx-vp-seen" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />)}
        <i className="lx-vp-buf" style={{ width: pct(buffered) }} />
        {lockFrom != null && duration > 0 && lockFrom < duration - 1 && <i className="lx-vp-lockzone" style={{ left: pct(lockFrom) }} title="Watch up to here before skipping ahead" />}
        <i className="lx-vp-fill" style={{ width: pct(current) }} />
        <span className="lx-vp-knob" style={{ left: pct(current) }} />
      </div>
      {hover != null && <span className="lx-vp-tip" style={{ left: pct(hover) }}>{clock(hover)}</span>}
    </div>
  )
}

export default function VideoPlayer({
  src, poster, kind = 'VIDEO', title, captions, maxRate = 2, skipLocked = false, furthest = 0, seen = [], autoPlay = false,
  mediaRef, handlers, fault, onRetry, note, globalKeys = false,
}: {
  src: string
  poster?: string | null
  kind?: 'VIDEO' | 'AUDIO'
  title?: string
  captions?: Caption[]
  maxRate?: number
  /** Skipping past what has been watched is refused (the caller enforces it; this draws it). */
  skipLocked?: boolean
  /** Furthest second already watched, when the lesson opened. */
  furthest?: number
  /** Watched ranges to shade on the timeline. */
  seen?: [number, number][]
  /** Start playing as soon as it can: only after the person has clicked something on the page. */
  autoPlay?: boolean
  mediaRef?: (el: HTMLMediaElement | null) => void
  handlers?: Partial<MediaHandlers>
  fault?: string | null
  onRetry?: () => void
  /** A passing message over the picture, for example why a seek was refused. */
  note?: string
  /** Answer the keyboard anywhere on the page, not only when the player has focus. */
  globalKeys?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const el = useRef<HTMLMediaElement | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [menu, setMenu] = useState<'speed' | 'captions' | null>(null)
  const [cc, setCc] = useState(-1)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const [flash, setFlash] = useState<{ n: number; icon: React.ReactNode; text?: string } | null>(null)
  const [top, setTop] = useState(furthest)
  const tracks = useCaptionUrls(captions)
  const video = kind === 'VIDEO'
  const rates = RATES.filter(r => r <= maxRate)

  // Sound on, at the person's own level, from the very first frame.
  useEffect(() => { const v = savedVolume(); setVolume(v) }, [])
  useEffect(() => { const m = el.current; if (m) { m.volume = volume; m.muted = muted } }, [volume, muted])
  useEffect(() => { const m = el.current; if (m) m.playbackRate = rate }, [rate])
  useEffect(() => {
    const m = el.current as HTMLVideoElement | null
    if (!m?.textTracks) return
    for (let i = 0; i < m.textTracks.length; i++) m.textTracks[i].mode = i === cc ? 'showing' : 'hidden'
  }, [cc, tracks])
  // Captions on by default when there is exactly one file: most people who attach one want it seen.
  useEffect(() => { if (tracks.length && cc < 0) setCc(0) }, [tracks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const poke = useCallback(() => {
    setIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => { if (el.current && !el.current.paused) setIdle(true) }, IDLE_MS)
  }, [])
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current) }, [])

  const show = (icon: React.ReactNode, text?: string) => setFlash(f => ({ n: (f?.n || 0) + 1, icon, text }))

  const toggle = useCallback(() => {
    const m = el.current
    if (!m) return
    if (m.paused || m.ended) {
      m.muted = muted
      m.play().catch(() => { /* a refused play leaves the big button showing */ })
      show(<GPlay size={26} />)
    } else { m.pause(); show(<GPause size={26} />) }
    poke()
  }, [muted, poke])

  const seek = useCallback((t: number) => {
    const m = el.current
    if (!m || !Number.isFinite(t)) return
    m.currentTime = Math.max(0, Math.min(t, (m.duration || t)))
    setCurrent(m.currentTime)
    poke()
  }, [poke])
  const jump = useCallback((d: number) => {
    const m = el.current
    if (!m) return
    seek(m.currentTime + d)
    show(d < 0 ? <GBack10 size={24} /> : <GFwd10 size={24} />)
  }, [seek])

  const setVol = (v: number) => {
    const x = Math.max(0, Math.min(1, v))
    setVolume(x); setMuted(x === 0)
    try { if (x > 0) localStorage.setItem(VOL_KEY, String(x)) } catch { /* private mode */ }
  }
  const toggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m
      if (!next && volume === 0) setVolume(savedVolume() || 1)
      show(next ? <GMute size={24} /> : <GVolume size={24} />, next ? 'Muted' : undefined)
      return next
    })
  }, [volume])

  const fullscreen = useCallback(async () => {
    const b = box.current, m = el.current as any
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (b?.requestFullscreen) await b.requestFullscreen()
      else if (m?.webkitEnterFullscreen) m.webkitEnterFullscreen()   // iPhone Safari
    } catch { /* refused: nothing to undo */ }
  }, [])
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const pip = async () => {
    const m = el.current as HTMLVideoElement | null
    try {
      if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture()
      else await m?.requestPictureInPicture()
    } catch { /* not allowed here */ }
  }
  const pipOk = video && typeof document !== 'undefined' && !!(document as any).pictureInPictureEnabled

  const changeRate = useCallback((dir: 1 | -1) => {
    setRate(r => {
      const i = rates.indexOf(r)
      const n = rates[Math.max(0, Math.min(rates.length - 1, (i < 0 ? rates.indexOf(1) : i) + dir))]
      show(<GGear size={22} />, `${n}x`)
      return n
    })
  }, [rates])

  const onKey = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) ) return
    const k = e.key
    if (k === ' ' || k === 'k') { if (t?.tagName === 'BUTTON' && k === ' ') return; e.preventDefault(); toggle() }
    else if (k === 'ArrowLeft' || k === 'j') { e.preventDefault(); jump(k === 'j' ? -10 : -5) }
    else if (k === 'ArrowRight' || k === 'l') { e.preventDefault(); jump(k === 'l' ? 10 : 5) }
    else if (k === 'ArrowUp') { e.preventDefault(); setVol(volume + 0.1); setMuted(false); show(<GVolume size={24} />, `${Math.round(Math.min(1, volume + 0.1) * 100)}%`) }
    else if (k === 'ArrowDown') { e.preventDefault(); setVol(volume - 0.1); show(<GVolumeLow size={24} />, `${Math.round(Math.max(0, volume - 0.1) * 100)}%`) }
    else if (k === 'm') toggleMute()
    else if (k === 'f' && video) fullscreen()
    else if (k === 'c' && tracks.length) setCc(c => (c >= 0 ? -1 : 0))
    else if (k === '>' ) changeRate(1)
    else if (k === '<') changeRate(-1)
    else return
    poke()
  }, [toggle, jump, volume, toggleMute, fullscreen, video, tracks.length, changeRate, poke]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!globalKeys) return
    // onKey already leaves typing alone, and a space on a focused button presses that button.
    const k = (e: KeyboardEvent) => { if (!e.defaultPrevented) onKey(e) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [globalKeys, onKey])

  const attach = (n: HTMLMediaElement | null) => {
    el.current = n
    if (n) { n.muted = false; n.volume = savedVolume() }
    mediaRef?.(n)
  }

  const h = handlers || {}
  const events = {
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => {
      const m = e.currentTarget
      setDuration(Number.isFinite(m.duration) ? m.duration : 0)
      m.playbackRate = rate
      h.onLoadedMetadata?.(e)
      setCurrent(m.currentTime)
      if (autoPlay) m.play().catch(() => {})
    },
    onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d) },
    onPlay: () => { setPlaying(true); setStarted(true); poke() },
    onPlaying: (e: SyntheticEvent<HTMLMediaElement>) => { setWaiting(false); setPlaying(true); setStarted(true); h.onPlaying?.(e) },
    onWaiting: () => setWaiting(true),
    onCanPlay: () => setWaiting(false),
    onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => {
      const m = e.currentTarget
      setCurrent(m.currentTime)
      if (!m.seeking && !m.paused && m.currentTime > top) setTop(m.currentTime)
      h.onTimeUpdate?.(e)
    },
    onProgress: (e: SyntheticEvent<HTMLMediaElement>) => {
      const m = e.currentTarget, b = m.buffered
      for (let i = 0; i < b.length; i++) if (b.start(i) <= m.currentTime + 0.5) setBuffered(b.end(i))
    },
    onSeeking: (e: SyntheticEvent<HTMLMediaElement>) => { h.onSeeking?.(e); setCurrent(e.currentTarget.currentTime) },
    onSeeked: (e: SyntheticEvent<HTMLMediaElement>) => { h.onSeeked?.(e); setCurrent(e.currentTarget.currentTime) },
    onPause: (e: SyntheticEvent<HTMLMediaElement>) => { setPlaying(false); setIdle(false); h.onPause?.(e) },
    onEnded: (e: SyntheticEvent<HTMLMediaElement>) => { setPlaying(false); setIdle(false); h.onEnded?.(e) },
    onError: (e: SyntheticEvent<HTMLMediaElement>) => { setWaiting(false); h.onError?.(e) },
    onRateChange: (e: SyntheticEvent<HTMLMediaElement>) => { h.onRateChange?.(e); setRate(e.currentTarget.playbackRate) },
    onVolumeChange: (e: SyntheticEvent<HTMLMediaElement>) => { const m = e.currentTarget; setMuted(m.muted) },
  }

  const volIcon = muted || volume === 0 ? <GMute size={20} /> : volume < 0.5 ? <GVolumeLow size={20} /> : <GVolume size={20} />

  const controls = (
    <div className="lx-vp-bar" onClick={e => e.stopPropagation()}>
      <Scrubber current={current} duration={duration} buffered={buffered} seen={seen} lockFrom={skipLocked ? Math.max(furthest, top) : null} onSeek={seek} onDrag={() => poke()} />
      <div className="lx-vp-row">
        <button className="lx-vp-btn" onClick={toggle} aria-label={playing ? 'Pause (k)' : 'Play (k)'} title={playing ? 'Pause (k)' : 'Play (k)'}>{playing ? <GPause size={20} /> : <GPlay size={20} />}</button>
        <button className="lx-vp-btn" onClick={() => jump(-10)} aria-label="Back 10 seconds (j)" title="Back 10 seconds (j)"><GBack10 size={21} /></button>
        <button className="lx-vp-btn" onClick={() => jump(10)} aria-label="Forward 10 seconds (l)" title="Forward 10 seconds (l)"><GFwd10 size={21} /></button>
        <div className="lx-vp-vol">
          <button className="lx-vp-btn" onClick={toggleMute} aria-label={muted ? 'Unmute (m)' : 'Mute (m)'} title={muted ? 'Unmute (m)' : 'Mute (m)'}>{volIcon}</button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume" onChange={e => { setVol(Number(e.target.value)); setMuted(Number(e.target.value) === 0) }} />
        </div>
        <span className="lx-vp-time">{clock(current)} <span style={{ opacity: .6 }}>/ {clock(duration)}</span></span>
        <span className="lx-vp-sp" />
        {tracks.length > 0 && (
          <button className="lx-vp-btn" aria-pressed={cc >= 0} onClick={() => setMenu(m => m === 'captions' ? null : 'captions')} aria-label="Captions (c)" title="Captions (c)"><GCaptions size={21} /></button>
        )}
        <button className="lx-vp-btn" onClick={() => setMenu(m => m === 'speed' ? null : 'speed')} aria-label={`Playback speed, ${rate}x`} title="Playback speed" style={{ width: 'auto', padding: '0 10px', fontWeight: 750, fontSize: 13 }}>
          {rate === 1 ? <GGear size={20} /> : `${rate}x`}
        </button>
        {pipOk && <button className="lx-vp-btn" onClick={pip} aria-label="Picture in picture" title="Picture in picture"><GPip size={20} /></button>}
        {video && <button className="lx-vp-btn" onClick={fullscreen} aria-label={full ? 'Exit full screen (f)' : 'Full screen (f)'} title={full ? 'Exit full screen (f)' : 'Full screen (f)'}>{full ? <GFullExit size={20} /> : <GFull size={20} />}</button>}
      </div>
      {menu === 'speed' && (
        <div className="lx-vp-menu" role="menu">
          <h4>Playback speed</h4>
          {rates.map(r => <button key={r} role="menuitemradio" aria-checked={r === rate} onClick={() => { setRate(r); setMenu(null) }}>{r === 1 ? 'Normal' : `${r}x`}{r === rate && <span>●</span>}</button>)}
        </div>
      )}
      {menu === 'captions' && (
        <div className="lx-vp-menu" role="menu">
          <h4>Captions</h4>
          <button role="menuitemradio" aria-checked={cc < 0} onClick={() => { setCc(-1); setMenu(null) }}>Off{cc < 0 && <span>●</span>}</button>
          {tracks.map((t, i) => <button key={t.src} role="menuitemradio" aria-checked={cc === i} onClick={() => { setCc(i); setMenu(null) }}>{t.label}{cc === i && <span>●</span>}</button>)}
        </div>
      )}
    </div>
  )

  if (!video) {
    return (
      <div className="lx-audio">
        <div className="lx-audio-disc" data-on={playing ? '1' : '0'}><GHeadphones size={44} /></div>
        <div ref={box} className="lx-vp" tabIndex={0} onKeyDown={onKey} style={{ minWidth: 0 }}>
          {title && <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{title}</div>}
          <audio ref={attach} src={src} preload="metadata" {...events} />
          {controls}
          {fault && <div className="lx-note" data-t="warning" role="alert" style={{ marginTop: 12, color: 'var(--ez-ink)' }}>{fault}{onRetry && <button className="lx-btn lx-btn--sm" onClick={onRetry} style={{ marginLeft: 'auto' }}>Try again</button>}</div>}
          {note && <div className="lx-vp-note" role="status" style={{ position: 'static', transform: 'none', marginTop: 10, display: 'inline-block' }}>{note}</div>}
        </div>
      </div>
    )
  }

  return (
    <div ref={box} className="lx-vp" data-idle={idle && playing && !menu ? '1' : '0'} tabIndex={0} aria-label={title ? `Video: ${title}` : 'Video'}
      onKeyDown={globalKeys ? undefined : onKey} onMouseMove={poke} onTouchStart={poke} onClick={() => { if (menu) setMenu(null); else toggle() }} onDoubleClick={fullscreen}>
      <video ref={attach} src={src} poster={poster || undefined} playsInline preload="metadata" controlsList="nodownload" {...events}>
        {tracks.map((t, i) => <track key={t.src} kind="subtitles" src={t.src} label={t.label} srcLang={t.lang || 'en'} default={i === 0} />)}
      </video>
      {!started && poster && <div className="lx-vp-poster" style={{ backgroundImage: `url("${poster}")` }} aria-hidden />}
      <div className="lx-vp-shade" />
      {title && <div className="lx-vp-topline"><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span></div>}
      {!playing && !waiting && !fault && (
        <button className="lx-vp-big" onClick={e => { e.stopPropagation(); toggle() }} aria-label={started ? 'Resume' : 'Play'}><GPlay size={34} /></button>
      )}
      {waiting && playing && <div className="lx-vp-spin" aria-label="Loading" />}
      {flash && <div key={flash.n} className="lx-vp-flash" aria-hidden>{flash.icon}{flash.text && <span>{flash.text}</span>}</div>}
      {note && <div className="lx-vp-note" role="status">{note}</div>}
      {controls}
      {fault && (
        <div className="lx-vp-fault" role="alert" onClick={e => e.stopPropagation()}>
          <div style={{ display: 'grid', gap: 14, justifyItems: 'center', maxWidth: 420 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{fault}</div>
            {onRetry && <button className="lx-btn lx-btn--white" onClick={onRetry}>Try again</button>}
          </div>
        </div>
      )}
    </div>
  )
}
