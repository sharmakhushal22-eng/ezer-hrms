'use client'
// components/learning/showcase/HoverLayer.tsx — the larger card that grows out of a course card
// when the pointer rests on it: the clip playing muted, the one action that matters (start,
// resume or open), My list, more info, and the facts a card has no room for.
//
// It is drawn once for the whole app, fixed above everything, so a row's sideways scrolling
// never clips it. It grows from the card's own position and size, sideways towards the middle
// at the screen's edges, and closes when the pointer leaves both, on any scroll, on Escape, and
// when the screen changes. It is an extra for a mouse: every action in it is also on the card
// or on the course page, which is where a keyboard or a finger goes.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { linkProps, navigate, to } from '../app/router'
import { keys, paths, prefetch } from '../app/cache'
import { CourseArt, IconStar, LEVEL, STATUS, durationWords, plural } from '../shared'
import { GClock, GLayers, GMute, GPlay, GUsers, GVolume } from '../glyphs'
import { isNew, type CatCourse } from '../CourseCard'
import { Clip } from './Clip'
import { SCheck, SDown, SNoAuto, SPlus } from './icons'
import { hover, isSaved, setAutoplay, setMuted, toggleSaved, useHover, usePreviewPrefs } from './preview'
import './showcase.css'

const GROW = 1.5
const MIN_W = 330, MAX_W = 450, EDGE = 14

function place(r: DOMRect) {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, r.width * GROW), vw - EDGE * 2))
  const artH = r.width * 9 / 16, mediaH = w * 9 / 16
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), vw - w - EDGE)
  // Centre the clip on the card's artwork, then keep the whole card on screen (it is about
  // the clip's height again below it).
  const est = mediaH + 230
  const top = Math.max(EDGE, Math.min(r.top + artH / 2 - mediaH / 2, vh - est - EDGE))
  return {
    left, top, w,
    // It starts the exact size and place of the card, then grows from there.
    origin: `${r.left + r.width / 2 - left}px ${r.top + artH / 2 - top}px`,
    from: r.width / w,
  }
}

const going = (c: CatCourse) => !!c.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED'].includes(c.mine.status)

function Card({ h }: { h: NonNullable<ReturnType<typeof useHover>> }) {
  const { c, rect, category, rank } = h
  const { muted, blocked } = usePreviewPrefs()
  const [pos] = useState(() => place(rect))
  const [asked, setAsked] = useState(false)          // "Play preview" pressed where autoplay is off
  const [clip, setClip] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const saved = isSaved(c)
  const p = c.preview || null
  const playing = !!p && (!blocked || asked)
  const pct = Math.round(Number(c.mine?.progress_pct) || 0)
  const st = c.mine ? STATUS[c.mine.status] : null

  useEffect(() => { prefetch(keys.course(c.id), paths.course(c.id)) }, [c.id])

  const openCourse = () => { hover.close(); navigate(to.course(c.id)) }
  // Someone already taking it goes straight to where they were; anyone else to the course page,
  // where enrolling, requesting or the free preview live.
  const primary = () => { hover.close(); navigate(going(c) || c.mine?.status === 'COMPLETED' ? to.play(c.mine!.id) : to.course(c.id)) }
  const verb = going(c) ? (pct > 0 ? 'Resume' : 'Start') : c.mine?.status === 'COMPLETED' ? 'Review' : c.mine?.status === 'PENDING_APPROVAL' ? 'Requested' : 'View course'
  const save = async () => { setErr(''); const e = await toggleSaved(c); if (e) setErr(e) }

  const style = { left: pos.left, top: pos.top, width: pos.w, transformOrigin: pos.origin, '--lx-hv-from': pos.from } as CSSProperties
  const facts = [category, ...(c.skills || []), ...(c.tags || [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4) as string[]
  return (
    <div ref={box} className="lx-hv" style={style} role="dialog" aria-label={c.title}
      onPointerEnter={() => hover.hold()} onPointerLeave={() => hover.leave()}>
      <div className="lx-hv-media" onClick={openCourse}>
        <CourseArt src={c.thumbnail} id={c.id} title={c.title} kind={(c.kinds || [])[0]} />
        {p && <Clip p={p} play={playing} onState={setClip} />}
        <div className="lx-hv-badges">
          {rank != null && <span className="lx-tag lx-hv-top"><b>TOP</b>{rank}</span>}
          {c.is_featured && <span className="lx-tag lx-tag--gold">★ Featured</span>}
          {isNew(c) && !c.mine && <span className="lx-tag lx-tag--glass">New</span>}
          {c.is_compliance && <span className="lx-tag lx-tag--glass">Compliance</span>}
        </div>
        {p && (
          <div className="lx-hv-ctl" onClick={e => e.stopPropagation()}>
            {blocked && !asked
              ? <button type="button" className="lx-hv-mini lx-hv-mini--wide" onClick={() => setAsked(true)}><GPlay size={13} /> Play preview</button>
              : <>
                  {clip === 'loading' && <span className="lx-hv-spin" aria-label="Loading the preview" />}
                  <button type="button" className="lx-hv-mini" onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn the sound on' : 'Mute'} title={muted ? 'Sound on' : 'Mute'}>
                    {muted ? <GMute size={15} /> : <GVolume size={15} />}
                  </button>
                </>}
            <button type="button" className="lx-hv-mini" aria-pressed={blocked === 'off'} onClick={() => { setAutoplay(blocked === 'off'); setAsked(false) }}
              aria-label={blocked === 'off' ? 'Play previews automatically' : 'Stop playing previews automatically'} title={blocked === 'off' ? 'Autoplay previews' : 'Stop autoplaying previews'}>
              {blocked === 'off' ? <GPlay size={13} /> : <SNoAuto size={15} />}
            </button>
          </div>
        )}
        {p && <span className="lx-hv-src">{p.source === 'TRAILER' ? 'Trailer' : 'Preview'}</span>}
      </div>

      <div className="lx-hv-body">
        <div className="lx-hv-actions">
          <button type="button" className="lx-hv-round lx-hv-round--primary" onClick={primary} aria-label={`${verb}: ${c.title}`} title={verb} disabled={c.mine?.status === 'PENDING_APPROVAL'}>
            <GPlay size={18} />
          </button>
          <span className="lx-hv-verb">{verb}</span>
          <button type="button" className="lx-hv-round" aria-pressed={saved} onClick={save} aria-label={saved ? 'Remove from My list' : 'Add to My list'} title={saved ? 'Remove from My list' : 'Add to My list'}>
            {saved ? <SCheck size={18} /> : <SPlus size={18} />}
          </button>
          <a className="lx-hv-round lx-hv-more" {...linkProps(to.course(c.id), () => hover.close())} aria-label={`More about ${c.title}`} title="More info"><SDown size={18} /></a>
        </div>
        {err && <div className="lx-hv-err" role="alert">{err}</div>}

        <div className="lx-hv-title lx-clamp2">{c.title}</div>
        <div className="lx-hv-meta lx-num">
          {c.rating != null && <span className="lx-rating"><IconStar size={13} filled />{c.rating.toFixed(1)}<i>({c.ratings})</i></span>}
          {c.difficulty && <span className="lx-hv-box">{LEVEL[c.difficulty]}</span>}
          {!!c.est_minutes && <span><GClock size={13} />{durationWords(c.est_minutes)}</span>}
          {!!c.lesson_count && <span><GLayers size={13} />{plural(c.lesson_count, 'lesson')}</span>}
          {!!c.quiz_count && <span className="lx-hv-box">{plural(c.quiz_count, 'quiz', 'quizzes')}</span>}
          {!!c.learners && <span><GUsers size={13} />{c.learners}</span>}
        </div>
        {c.mine && (
          <div className="lx-hv-prog">
            {going(c) || c.mine.status === 'COMPLETED'
              ? <><span className="lx-bar" data-done={c.mine.status === 'COMPLETED' ? '1' : '0'}><i style={{ width: `${c.mine.status === 'COMPLETED' ? 100 : pct}%` }} /></span><b className="lx-num">{c.mine.status === 'COMPLETED' ? 'Completed' : `${pct}%`}</b></>
              : <b>{st?.label || c.mine.status}</b>}
          </div>
        )}
        {c.summary && <p className="lx-hv-sum lx-clamp3">{c.summary}</p>}
        {facts.length > 0 && <div className="lx-hv-facts">{facts.map(f => <span key={f}>{f}</span>)}</div>}
      </div>
    </div>
  )
}

/** Mounted once, inside the app's root, so the card picks up EZER Learn's styles and theme. */
export default function HoverLayer() {
  const h = useHover()
  // Anything that moves the page closes the card rather than leaving it floating in the wrong place.
  useEffect(() => {
    if (!h) return
    const close = () => hover.close()
    // Only a scroll that moves this card's row or the page: the other rows keep gliding on their own.
    const scrolled = (e: Event) => {
      const t = e.target
      if (t === document || t === window || (t instanceof Node && t.contains(h.el))) close()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', scrolled, { capture: true, passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key)
    window.addEventListener('ezl:navigate', close)
    window.addEventListener('popstate', close)
    return () => {
      window.removeEventListener('scroll', scrolled, { capture: true })
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('ezl:navigate', close)
      window.removeEventListener('popstate', close)
    }
  }, [h])
  if (!h) return null
  // A fresh card for each card hovered, so its grow-in starts from that card's own place.
  return <Card key={h.id} h={h} />
}
