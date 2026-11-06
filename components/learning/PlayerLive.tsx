'use client'
// components/learning/PlayerLive.tsx — a course's live-session lesson: the course's webinars,
// one of which the learner attends (or whose recording they watch) to finish the lesson.
import { useEffect, useRef, useState } from 'react'
import { IconCheck } from '@/lib/ui'
import { type LiveSession, type OpenedLesson } from './shared'
import { GLive } from './glyphs'
import { NoSessions, RecordingModal, SessionCard } from './LiveCard'
import './live.css'

export default function LiveLesson({ opened, done, reopen, onFinished }: {
  opened: OpenedLesson
  done: boolean
  /** Ask the server for this lesson again, after registering, joining or watching. */
  reopen: () => Promise<OpenedLesson>
  onFinished: () => void
}) {
  const [live, setLive] = useState(opened.live!)
  const [watch, setWatch] = useState<LiveSession | null>(null)
  const told = useRef(done)
  useEffect(() => {
    if (live.earned && !told.current) { told.current = true; onFinished() }
  }, [live.earned, onFinished])
  const refresh = () => { void reopen().then(o => o.live && setLive(o.live)).catch(() => {}) }

  return (
    <div style={{ padding: 'clamp(18px, 3vw, 32px)', display: 'grid', gap: 16, background: 'var(--ez-canvas)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="lx-empty-art" style={{ transform: 'none', width: 54, height: 54, flexShrink: 0 }}><GLive size={26} /></span>
        <div>
          <div style={{ fontWeight: 750, fontSize: 18, color: 'var(--ez-ink)' }}>{live.earned || done ? 'Done: you attended' : 'Attend one live session'}</div>
          <div style={{ color: 'var(--ez-muted)', fontSize: 14, lineHeight: 1.55 }}>
            {live.earned || done
              ? <><IconCheck size={13} /> This lesson is complete. The sessions stay here if you want to watch again.</>
              : `Join any one of the sessions below, or watch ${live.recording_pct}% of a recording, and this lesson completes on its own.`}
          </div>
        </div>
      </div>
      {live.sessions.length
        ? <div className="lx-lv-list">{live.sessions.map(s => <SessionCard key={s.id} s={s} showCourse={false} onChanged={refresh} onWatch={setWatch} />)}</div>
        : <NoSessions>No session has been scheduled for this course yet. HR will invite you when one is, and it will appear here.</NoSessions>}
      {watch && <RecordingModal s={watch} onClose={changed => { setWatch(null); if (changed) refresh() }} />}
    </div>
  )
}
