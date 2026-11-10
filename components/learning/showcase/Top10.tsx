'use client'
// components/learning/showcase/Top10.tsx — "Top 10 in your company": the courses people started
// most in the last 30 days, each beside its rank in a large outlined numeral, like a streaming
// service's chart row. Hovering one grows it into the same hover card as any course.
//
// The cover keeps its own 16:9 shape (a course cover has its title drawn into it, so cropping it
// to a poster would cut the words off), and the full title is written underneath.
import { useEffect, useRef } from 'react'
import { linkProps, to } from '../app/router'
import { keys, paths, prefetch } from '../app/cache'
import { CourseArt } from '../shared'
import type { CatCourse } from '../CourseCard'
import { Scroller } from '../motion/Scroller'
import { hover, watchInView } from './preview'
import './showcase.css'

function Item({ c, n, category }: { c: CatCourse; n: number; category?: string | null }) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => (card.current ? watchInView(card.current, c.preview) : undefined), [c.preview])
  return (
    <a className="lx-t10" {...linkProps(to.course(c.id), () => hover.close())} aria-label={`Number ${n}: ${c.title}`}
      onPointerEnter={e => {
        prefetch(keys.course(c.id), paths.course(c.id))
        if (e.pointerType === 'mouse' && card.current) hover.enter(c, card.current, { category, rank: n })
      }}
      onPointerLeave={() => { if (card.current) hover.leave(card.current) }}
      onFocus={() => prefetch(keys.course(c.id), paths.course(c.id))}>
      <span className="lx-t10-n lx-num" aria-hidden>{n}</span>
      <div ref={card} className="lx-t10-card">
        <CourseArt src={c.thumbnail} id={c.id} title={c.title} kind={(c.kinds || [])[0]} />
      </div>
      <span className="lx-t10-title lx-clamp2" title={c.title}>{c.title}</span>
      {category && <span className="lx-t10-kicker">{category}</span>}
    </a>
  )
}

export default function Top10({ courses, top, catName, title }: { courses: CatCourse[]; top: string[]; catName: Map<string, string>; title: string }) {
  const byId = new Map(courses.map(c => [c.id, c]))
  const list = top.map(id => byId.get(id)).filter(Boolean) as CatCourse[]
  if (list.length < 3) return null
  return (
    <section className="lx-row">
      <div className="lx-sec-head"><div><h2 className="lx-sec-title">{title}</h2><div className="lx-sec-sub">The courses colleagues started most in the last 30 days</div></div></div>
      <Scroller className="lx-rail lx-top10" n={list.length} progress label={title}>
        {list.map((c, i) => <Item key={c.id} c={c} n={i + 1} category={catName.get(c.category_id || '')} />)}
      </Scroller>
    </section>
  )
}
