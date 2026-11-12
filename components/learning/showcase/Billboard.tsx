'use client'
// components/learning/showcase/Billboard.tsx — the large spotlight at the top of Home: a few
// courses HR wants seen, each playing its trailer muted behind its title, the way a streaming
// service opens. It moves on by itself (motion/Carousel: it holds still under the pointer, off
// screen and for anyone who asked for less motion) and its clip pauses whenever a hover card
// is open, so only one thing ever plays at a time.
import { useRef, useState } from 'react'
import { navigate, linkProps, to } from '../app/router'
import { CourseArt, IconStar, LEVEL, durationWords, plural } from '../shared'
import { GClock, GLayers, GMute, GPlay, GSparkle, GUsers, GVolume } from '../glyphs'
import type { CatCourse } from '../CourseCard'
import { Carousel } from '../motion/Carousel'
import { useInView, usePageVisible } from '../motion/useInView'
import { Clip } from './Clip'
import { SCheck, SInfo, SPlus } from './icons'
import { isSaved, setMuted, toggleSaved, useHover, usePreviewPrefs } from './preview'
import './showcase.css'

const going = (c: CatCourse) => !!c.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED'].includes(c.mine.status)

function Slide({ c, active, category, rank, held }: { c: CatCourse; active: boolean; category?: string | null; rank?: number | null; held: boolean }) {
  const { muted, blocked } = usePreviewPrefs()
  const [err, setErr] = useState('')
  const pct = Math.round(Number(c.mine?.progress_pct) || 0)
  const verb = going(c) ? (pct > 0 ? 'Resume' : 'Start') : c.mine?.status === 'COMPLETED' ? 'Review' : 'View course'
  const play = () => navigate(going(c) || c.mine?.status === 'COMPLETED' ? to.play(c.mine!.id) : to.course(c.id))
  const saved = isSaved(c)
  return (
    <section className="lx-bb" aria-label={c.title}>
      <div className="lx-bb-art">
        <CourseArt src={c.thumbnail} id={c.id} title={c.title} word={false} />
        {c.preview && active && !blocked && <Clip p={c.preview} play={!held} owned progress={false} />}
      </div>
      <div className="lx-bb-shade" />
      <div className="lx-bb-body">
        <div className="lx-bb-kicker">
          {rank != null ? <span className="lx-tag lx-hv-top"><b>TOP</b>{rank}</span> : <span><GSparkle size={13} /> {c.is_featured ? 'Featured' : 'Picked for you'}</span>}
          {category && <span>· {category}</span>}
        </div>
        <h2 className="lx-bb-title">{c.title}</h2>
        <div className="lx-bb-meta lx-num">
          {c.rating != null && <span><IconStar size={14} filled />{c.rating.toFixed(1)}</span>}
          {!!c.est_minutes && <span><GClock size={14} />{durationWords(c.est_minutes)}</span>}
          {!!c.lesson_count && <span><GLayers size={14} />{plural(c.lesson_count, 'lesson')}</span>}
          {!!c.learners && <span><GUsers size={14} />{plural(c.learners, 'learner')}</span>}
          {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
          {going(c) && <span>{pct}% done</span>}
        </div>
        {c.summary && <p className="lx-bb-sum lx-clamp3">{c.summary}</p>}
        <div className="lx-bb-ctas">
          <button type="button" className="lx-bb-btn lx-bb-btn--play" onClick={play}><GPlay size={16} /> {verb}</button>
          <a className="lx-bb-btn lx-bb-btn--ghost" {...linkProps(to.course(c.id))}><SInfo size={18} /> More info</a>
          <button type="button" className="lx-bb-btn lx-bb-btn--ghost" aria-pressed={saved} onClick={async () => { setErr(''); const e = await toggleSaved(c); if (e) setErr(e) }}>
            {saved ? <SCheck size={18} /> : <SPlus size={18} />} My list
          </button>
        </div>
        {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--ez-on-dark)' }}>{err}</div>}
      </div>
      {c.preview && !blocked && (
        <div className="lx-bb-ctl">
          <button type="button" className="lx-hv-mini" style={{ width: 38, height: 38 }} onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn the sound on' : 'Mute'}>
            {muted ? <GMute size={17} /> : <GVolume size={17} />}
          </button>
        </div>
      )}
    </section>
  )
}

export default function Billboard({ items, catName, top }: { items: CatCourse[]; catName: Map<string, string>; top: string[] }) {
  const root = useRef<HTMLDivElement>(null)
  const seen = useInView(root, { threshold: 0.35 })
  const visible = usePageVisible()
  const hovering = !!useHover()
  if (!items.length) return null
  const rank = (c: CatCourse) => { const i = top.indexOf(c.id); return i >= 0 ? i + 1 : null }
  const held = !seen || !visible || hovering
  return (
    <div ref={root} className="lx-bb-wrap">
      <Carousel items={items} label="Spotlight" slideLabel={c => c.title} variant="below" interval={14000} className="lx-car--billboard"
        render={(c, active) => <Slide c={c} active={active} held={held} category={catName.get(c.category_id || '')} rank={rank(c)} />} />
    </div>
  )
}
