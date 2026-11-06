'use client'
// components/learning/Live.tsx — the learner's live sessions (webinars): the next one with its
// countdown, everything coming up, and past sessions with their recordings.
import { useCallback, useEffect, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { EmptyState, Oops, Skel, errorWords, plural, type LiveSession } from './shared'
import { GLive } from './glyphs'
import { NextSession, NoSessions, RecordingModal, SessionCard } from './LiveCard'
import { cached, remember } from './app/cache'

interface Data { upcoming: LiveSession[]; past: LiveSession[]; cancelled: LiveSession[] }

export default function Live({ focusId }: { focusId?: string | null }) {
  const [d, setD] = useState<Data | null>(() => cached<Data>('live'))
  const [err, setErr] = useState('')
  const [watch, setWatch] = useState<LiveSession | null>(null)
  const load = useCallback(() => {
    setErr('')
    return lmsApi<Data>('/api/lms/me/sessions').then(x => setD(remember('live', x))).catch(e => setErr(errorWords(e)))
  }, [])
  useEffect(() => { void load() }, [load])
  // Join and check-in open on the clock: look again every minute while the page is open.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000); return () => clearInterval(t) }, [load])

  // A link from an email names one session: bring it into view once the list is here.
  useEffect(() => {
    if (!focusId || !d) return
    const s = [...d.upcoming, ...d.past].find(x => x.id === focusId)
    if (s?.phase === 'ended' && s.has_recording && s.me && !s.me.recording_done && !s.me.attended) setWatch(s)
    document.getElementById(`lv-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, d])

  if (err && !d) return <Oops message={err} onRetry={() => void load()} />
  if (!d) return <div style={{ display: 'grid', gap: 16 }}><Skel h={220} r={22} /><Skel h={130} r={16} /><Skel h={130} r={16} /></div>

  const next = d.upcoming[0] || null
  const rest = d.upcoming.slice(1)
  const nothing = !d.upcoming.length && !d.past.length && !d.cancelled.length
  const card = (s: LiveSession) => <div key={s.id} id={`lv-${s.id}`}><SessionCard s={s} onChanged={() => void load()} onWatch={setWatch} /></div>

  return (
    <div>
      <header className="lx-ph lx-in">
        <div className="lx-ph-row">
          <div>
            <h1>Live sessions</h1>
            <p>Webinars you are invited to or can join, with their recordings afterwards. Attending a session that is part of a course counts towards it.</p>
          </div>
        </div>
      </header>

      {nothing ? (
        <EmptyState title="No live sessions yet" icon={<GLive size={34} />}>When HR invites you to a webinar, or opens one to everyone, it appears here with a Join button and a calendar invitation.</EmptyState>
      ) : (
        <div className="lx-stack">
          {next ? <div id={`lv-${next.id}`}><NextSession s={next} onChanged={() => void load()} onWatch={setWatch} /></div> : <NoSessions>Nothing coming up. Past sessions and their recordings are below.</NoSessions>}
          {rest.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Coming up</h2><div className="lx-sec-sub lx-num">{plural(rest.length, 'more session')}</div></div></div>
              <div className="lx-lv-list">{rest.map(card)}</div>
            </section>
          )}
          {d.past.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Past sessions</h2><div className="lx-sec-sub">Recordings stay here; watching one counts the same as attending</div></div></div>
              <div className="lx-lv-list">{d.past.map(card)}</div>
            </section>
          )}
          {d.cancelled.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Cancelled</h2></div></div>
              <div className="lx-lv-list">{d.cancelled.map(card)}</div>
            </section>
          )}
        </div>
      )}
      {watch && <RecordingModal s={watch} onClose={changed => { setWatch(null); if (changed) void load() }} />}
    </div>
  )
}
