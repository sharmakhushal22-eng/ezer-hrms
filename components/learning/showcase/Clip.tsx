'use client'
// components/learning/showcase/Clip.tsx — a preview clip drawn over a course's artwork. It
// borrows the warm <video> from the pool (preview.ts), so whatever was buffered while the
// pointer rested on the card plays at once, and fades in only when frames are actually moving:
// until then the artwork stays, so nothing ever flashes black.
import { useEffect, useRef, useState } from 'react'
import { isMuted, own, setMuted, take, usePreviewPrefs, type Preview } from './preview'

export type ClipState = 'idle' | 'loading' | 'playing'

export function Clip({ p, play, owned, onState, progress = true }: {
  p: Preview
  /** Play now. False pauses and keeps the frame. */
  play: boolean
  /** Use an element of its own rather than the shared pool (the billboard). */
  owned?: boolean
  onState?: (s: ClipState) => void
  /** The thin line along the bottom showing how far through the clip it is. */
  progress?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<ClipState>('idle')
  const report = useRef(onState)
  useEffect(() => { report.current = onState }, [onState])
  // The mute button anywhere applies here too, including to an element outside the pool.
  const { muted } = usePreviewPrefs()
  useEffect(() => { if (video.current) video.current.muted = muted }, [muted, ready])

  // Adopt the element for as long as this clip is on screen.
  useEffect(() => {
    const v = owned ? own(p) : take(p)
    const box = host.current
    if (!v || !box) return
    box.appendChild(v)
    video.current = v
    setReady(true)
    const set = (s: ClipState) => { setState(s); report.current?.(s) }
    const playing = () => set('playing')
    const waiting = () => set('loading')
    const tick = () => {
      const s = Number(v.dataset.start), e = Number(v.dataset.end)
      if (bar.current && e > s) bar.current.style.transform = `scaleX(${Math.max(0, Math.min(1, (v.currentTime - s) / (e - s)))})`
    }
    v.addEventListener('playing', playing)
    v.addEventListener('waiting', waiting)
    v.addEventListener('timeupdate', tick)
    return () => {
      v.removeEventListener('playing', playing)
      v.removeEventListener('waiting', waiting)
      v.removeEventListener('timeupdate', tick)
      v.pause()
      v.remove()
      if (owned) { v.removeAttribute('src'); v.load() }
      video.current = null
      setReady(false)
    }
  }, [p, owned])

  useEffect(() => {
    const v = video.current
    if (!ready || !v) return
    if (!play) { v.pause(); return }
    v.muted = isMuted()
    report.current?.('loading')
    v.play().catch(err => {
      // Sound without a click is refused; muted is always allowed.
      if (err?.name === 'NotAllowedError' && !v.muted) { setMuted(true); v.muted = true; void v.play().catch(() => {}) }
    })
  }, [ready, play])

  return (
    <div className="lx-pv" data-on={state === 'playing' && play ? '1' : '0'}>
      <div ref={host} className="lx-pv-host" />
      {progress && <div className="lx-pv-line" aria-hidden><i ref={bar} /></div>}
    </div>
  )
}
