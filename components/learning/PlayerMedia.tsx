'use client'
// components/learning/PlayerMedia.tsx — a video or audio lesson.
//
// The picture and controls are VideoPlayer. What this file adds is the reporting: every
// 15 seconds while playing, and on pause, end, leaving the lesson and hiding the page, it
// tells the server which seconds were played. The server caps what it believes by the wall
// clock (creditHeartbeat in lib/lms/core.ts), so progress on screen always comes from its
// reply and never from the element.
//
// Reporting must never get in the way of watching: a failed beat is swallowed, and because
// each beat repeats the whole set of ranges, the next one carries whatever the last lost.
import { useEffect, useRef, useState } from 'react'
import { lmsApi, lmsBeacon } from '@/lib/lms/client'
import { MAX_PLAYBACK_RATE, mergeRanges, rangesLength, type Range } from '@/lib/lms/core'
import { Bar, errorWords, type OpenedLesson, type PlayerLesson } from './shared'
import VideoPlayer, { type Caption } from './VideoPlayer'
import { GCheckCircle, GClock } from './glyphs'

const BEAT_MS = 15_000
/** Room past the furthest watched point: a small nudge on the scrubber is not skipping. */
const SKIP_LEEWAY_S = 2
/** Automatic reloads for a stale link or a dropped connection, before asking the learner. */
const MAX_RELOADS = 2
const MAX_RETRIES = 6

interface BeatBody { ranges: Range[]; position: number }
interface BeatReply { watched_s: number; content_done: boolean; refused_s: number }

/** Sends heartbeats one at a time, so a slow request cannot pile up behind the timer. */
class BeatSender {
  private busy = false
  private again = false
  private retries = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushedAt = 0
  private stopped = false

  constructor(private path: string, private lessonId: string, private read: () => BeatBody | null, private onReply: (r: BeatReply) => void) {}

  start() { this.stopped = false }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer) }

  async send() {
    if (this.stopped) return
    if (this.busy) { this.again = true; return }
    const body = this.read()
    if (!body) return
    this.busy = true
    let retryIn = 0
    try {
      const r = await lmsApi<BeatReply>(this.path, { event: 'beat', lesson_id: this.lessonId, ...body })
      this.onReply(r)
      // The clock refused part of this. Nothing else may come after the video ends, so ask again
      // once enough time has passed to cover it.
      if (!r.content_done && r.refused_s > 0.5) retryIn = Math.min(15, r.refused_s / MAX_PLAYBACK_RATE + 1)
      else this.retries = 0
    } catch { retryIn = 5 }
    this.busy = false
    if (this.again) { this.again = false; void this.send(); return }
    if (retryIn && this.retries < MAX_RETRIES) {
      this.retries++
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.send(), retryIn * 1000)
    }
  }

  /** For a page or lesson going away: survives the unload, and nothing waits on the answer. */
  flush() {
    const now = Date.now()
    if (now - this.flushedAt < 1000) return
    const body = this.read()
    if (!body) return
    this.flushedAt = now
    void lmsBeacon(this.path, { event: 'beat', lesson_id: this.lessonId, ...body })
  }
}

export default function MediaLesson({ lesson, opened, path, readOnly, onFinished, reopen, captions, autoPlay }: {
  lesson: PlayerLesson
  opened: OpenedLesson
  path: string
  readOnly: boolean
  /** The server has just said the content counts as done. */
  onFinished: () => void
  /** A fresh file URL. */
  reopen: () => Promise<OpenedLesson>
  /** .vtt files attached to the lesson, shown as subtitles. */
  captions?: Caption[]
  /** The learner pressed "Next" on a playing lesson: carry on playing. */
  autoPlay?: boolean
}) {
  const isVideo = lesson.kind === 'VIDEO'
  const duration = Number(opened.duration_s || 0)
  const [src, setSrc] = useState(opened.url)
  const [reloadTick, setReloadTick] = useState(0)
  const [watched, setWatched] = useState(() => Math.min(rangesLength(mergeRanges(opened.watched_ranges || [])), duration || Infinity))
  const [finished, setFinished] = useState(lesson.content_done)
  const [note, setNote] = useState('')
  const [fault, setFault] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [seen] = useState<[number, number][]>(() => mergeRanges(opened.watched_ranges || []))

  // Everything that changes many times a second lives here, so the element never re-renders.
  const track = useRef({
    node: null as HTMLMediaElement | null,
    ranges: [] as Range[],
    last: null as number | null,
    furthest: Math.max(0, ...(opened.watched_ranges || []).map(r => Number(r[1]) || 0)),
    pos: Number(opened.position_s) || 0,
    resumeAt: Number(opened.position_s) || 0,
    started: false, wasPlaying: false, quietPause: false, reloads: 0,
    free: lesson.allow_skip_ahead || lesson.content_done || readOnly,
    finished: lesson.content_done,
  })
  const onFinishedRef = useRef(onFinished)
  useEffect(() => { onFinishedRef.current = onFinished })

  const [beats] = useState(() => new BeatSender(path, lesson.id, () => {
    const t = track.current, m = t.node
    // Before anything has played there is nothing to report, and a beat at second 0 would
    // overwrite the position the learner is about to resume from.
    if (!m || !t.started) return null
    const played: Range[] = []
    for (let i = 0; i < m.played.length; i++) played.push([m.played.start(i), m.played.end(i)])
    return { ranges: mergeRanges([...played, ...t.ranges]).slice(-200), position: m.readyState > 0 ? m.currentTime : t.pos }
  }, r => {
    setWatched(r.watched_s)
    const t = track.current
    if (r.content_done && !t.finished) {
      t.finished = true; t.free = true
      setFinished(true)
      onFinishedRef.current()
    }
  }))

  useEffect(() => {
    if (readOnly) return
    const id = setInterval(() => {
      const m = track.current.node
      if (m && !m.paused && !m.ended) void beats.send()
    }, BEAT_MS)
    return () => clearInterval(id)
  }, [beats, readOnly])

  useEffect(() => {
    const leave = () => {
      const t = track.current
      if (t.node && !t.node.paused) { t.quietPause = true; t.node.pause() }
      if (!readOnly) beats.flush()
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') leave() }
    beats.start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', leave)
      if (!readOnly) beats.flush()
      beats.stop()
    }
  }, [beats, readOnly])

  // Directly on the element: when the reopened URL is the same string React writes nothing,
  // and the element would go on retrying whatever source just failed.
  useEffect(() => {
    const m = track.current.node
    if (reloadTick && m && src) { m.src = src; m.load() }
  }, [reloadTick, src])
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current) }, [])

  const flashNote = (m: string) => {
    setNote(m)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(''), 4000)
  }

  const reload = async () => {
    const t = track.current
    t.resumeAt = t.pos
    try {
      const o = await reopen()
      if (!o.url) { setFault('This file is not available right now. Please tell HR.'); return }
      setSrc(o.url)
      setReloadTick(n => n + 1)
    } catch (e) { setFault(errorWords(e)) }
  }

  const handlers = {
    onLoadedMetadata: () => {
      const t = track.current, m = t.node
      if (!m) return
      const d = m.duration
      // Close to the end means they finished it: start again rather than land on the last frame.
      if (t.resumeAt > 1 && (!Number.isFinite(d) || t.resumeAt < d - 3)) m.currentTime = t.resumeAt
      if (t.wasPlaying) m.play().catch(() => {})
    },
    onPlaying: () => {
      const t = track.current
      t.started = true; t.wasPlaying = true; t.reloads = 0
      if (t.node) t.last = t.node.currentTime
      setFault('')
    },
    onTimeUpdate: () => {
      const t = track.current, m = t.node
      if (!m) return
      const now = m.currentTime
      if (t.last != null && !m.seeking && !m.paused) {
        const step = now - t.last
        // A jump is a seek, not watching. The limit allows for a slow tick at top speed.
        if (step > 0 && step <= Math.max(2, m.playbackRate * 2)) {
          t.ranges = mergeRanges([...t.ranges, [t.last, now]])
          if (now > t.furthest) t.furthest = now
        }
      }
      t.last = m.seeking ? null : now
      // An element resetting after an error reports time 0, which is not where the learner was.
      if (m.readyState > 0) t.pos = now
    },
    onSeeking: () => {
      const t = track.current, m = t.node
      if (!m) return
      t.last = null
      if (!t.free && m.currentTime > t.furthest + SKIP_LEEWAY_S) {
        m.currentTime = t.furthest
        flashNote('You can skip ahead once you have watched this part.')
      }
    },
    onSeeked: () => { const t = track.current; if (t.node) { t.last = t.node.currentTime; t.pos = t.node.currentTime } },
    onPause: () => {
      const t = track.current
      if (t.quietPause) { t.quietPause = false; return }
      if (t.node && !t.node.ended) t.wasPlaying = false
      if (!readOnly) void beats.send()
    },
    onEnded: () => { track.current.wasPlaying = false; if (!readOnly) void beats.send() },
    onRateChange: () => {
      const m = track.current.node
      if (m && m.playbackRate > MAX_PLAYBACK_RATE) m.playbackRate = MAX_PLAYBACK_RATE
    },
    onError: () => {
      const t = track.current
      if (t.reloads >= MAX_RELOADS) {
        setFault(isVideo ? 'This video would not play. Check your connection and try again.' : 'This audio would not play. Check your connection and try again.')
        return
      }
      t.reloads++
      void reload()
    },
  }

  const attach = (n: HTMLMediaElement | null) => { if (n) track.current.node = n }
  const pct = duration ? Math.min(100, (watched / duration) * 100) : 0
  const showPct = Math.min(100, Math.round(pct))

  if (!src) return <div className="lx-gatecard"><p>This file is not available right now. Please tell HR.</p></div>

  return (
    <div>
      <VideoPlayer src={src} poster={opened.poster} kind={isVideo ? 'VIDEO' : 'AUDIO'} title={isVideo ? undefined : lesson.title} captions={captions}
        maxRate={MAX_PLAYBACK_RATE} skipLocked={!lesson.allow_skip_ahead && !finished && !readOnly} furthest={track.current.furthest} seen={seen}
        autoPlay={autoPlay} mediaRef={attach} handlers={handlers} fault={fault || null} note={note || undefined} globalKeys
        onRetry={() => { track.current.reloads = 0; setFault(''); void reload() }} />
      <div className="lx-media-meta" style={{ padding: '10px 16px', background: 'var(--lx-stage)', color: 'var(--lx-on-stage-soft)', borderTop: '1px solid var(--lx-on-stage-faint)' }}>
        {finished
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ez-positive)', fontWeight: 650 }}><GCheckCircle size={16} /> Watched. This part of the lesson is done.</span>
          : readOnly ? <span>Viewing only. Nothing is recorded.</span>
          : (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><GClock size={15} /> {duration ? `Watched ${showPct}%` : 'Your progress saves as you watch'}</span>
              {!!duration && <Bar pct={pct} label="Watched so far" />}
              {!!duration && <span>{lesson.media_pct}% needed to finish{lesson.allow_skip_ahead ? '' : ' · skip ahead after watching'}</span>}
            </>
          )}
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: .7 }} className="lx-hide-sm">Space play · J/L 10s · M mute · F full screen{captions?.length ? ' · C captions' : ''}</span>
      </div>
    </div>
  )
}
