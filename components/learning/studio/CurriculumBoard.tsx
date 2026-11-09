'use client'
// components/learning/studio/CurriculumBoard.tsx — a course's modules and lessons, built by
// dragging. Modules are cards, lessons are rows inside them; drag a lesson by its handle to
// reorder it or move it to another module, drag a module by its handle to reorder modules.
// The up and down buttons stay, because a keyboard and a phone cannot drag.
//
// A drop shows its new order at once and saves through the builder's queue; the tree that
// comes back from the server then replaces the guess.
import { useRef, useState } from 'react'
import { IconChevronDown, IconClose, IconPlus } from '@/lib/ui'
import { ConfirmButton, EditNumber, LESSON_KIND, plural } from '../admin/shared'
import LessonEditor from '../admin/LessonEditor'
import type { BuilderApi } from '../admin/builder-api'
import { KindGlyph, durationWords } from '../shared'
import { GSparkle } from '../glyphs'
import { GEye, GGrip } from './icons'

const ADD: { kind: string; label: string; title: string }[] = [
  { kind: 'VIDEO', label: 'Video', title: 'New video' }, { kind: 'AUDIO', label: 'Audio', title: 'New audio' },
  { kind: 'DOCUMENT', label: 'PDF document', title: 'New document' }, { kind: 'SLIDES', label: 'Slides (PDF)', title: 'New slides' },
  { kind: 'ARTICLE', label: 'Article', title: 'New article' }, { kind: 'LINK', label: 'Link', title: 'New link' },
  { kind: 'ASSESSMENT', label: 'Assessment', title: 'Assessment' },
  { kind: 'SCORM', label: 'SCORM package', title: 'Interactive module' }, { kind: 'LIVE', label: 'Live session', title: 'Live session' },
]
const NEEDS_FILE = ['VIDEO', 'AUDIO', 'DOCUMENT', 'SLIDES', 'SCORM']

type Drag = { type: 'lesson'; id: string; from: string } | { type: 'module'; id: string } | null
type Drop = { module: string; index: number } | null
interface Order { tree: unknown; mods: string[]; les: Record<string, string[]> }

const move = <T,>(a: T[], from: number, to: number) => { const c = [...a]; const [x] = c.splice(from, 1); c.splice(to, 0, x); return c }

function ModuleTitle({ m, b }: { m: any; b: BuilderApi }) {
  const [v, setV] = useState(m.title || '')
  const save = () => { const t = v.trim() || 'Module'; if (t !== m.title) void b.op('module.update', { id: m.id, title: t }) }
  return (
    <input className="lx-st-inline" data-no-titlecase="" aria-label="Module title" value={v} disabled={b.readOnly}
      onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

function Mv({ label, onUp, onDown }: { label: string; onUp?: () => void; onDown?: () => void }) {
  return (
    <span className="lx-st-mv">
      <button type="button" aria-label={`Move ${label} up`} disabled={!onUp} onClick={e => { e.stopPropagation(); onUp?.() }}><span style={{ display: 'flex', transform: 'rotate(180deg)' }}><IconChevronDown size={13} /></span></button>
      <button type="button" aria-label={`Move ${label} down`} disabled={!onDown} onClick={e => { e.stopPropagation(); onDown?.() }}><IconChevronDown size={13} /></button>
    </span>
  )
}

function LessonRow({ l, quiz, on, b, drop, onSelect, onUp, onDown, onDragStart, onDragEnd, onOver, dragging }: {
  l: any; quiz: any; on: boolean; b: BuilderApi; drop: 'before' | 'after' | null; dragging: boolean
  onSelect: () => void; onUp?: () => void; onDown?: () => void
  onDragStart: () => void; onDragEnd: () => void; onOver: (after: boolean) => void
}) {
  const missing = NEEDS_FILE.includes(l.kind) && !l.asset
  return (
    <div className="lx-st-les" role="button" tabIndex={0} aria-current={on ? 'true' : undefined} data-drop={drop || undefined} data-dragging={dragging ? '1' : undefined}
      onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      onDragOver={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onOver(e.clientY > r.top + r.height / 2) }}>
      <span className="lx-st-grip" draggable={!b.readOnly} aria-hidden title={b.readOnly ? undefined : 'Drag to move'}
        onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); onDragStart() }} onDragEnd={onDragEnd}
        style={b.readOnly ? { visibility: 'hidden' } : undefined}><GGrip size={14} /></span>
      <span className="lx-kind" data-k={l.kind}><KindGlyph kind={l.kind} size={16} /></span>
      <span style={{ minWidth: 0 }}>
        <b>{l.title}</b>
        <small>
          <span>{LESSON_KIND[l.kind]}</span>
          {l.est_minutes ? <span>· {durationWords(l.est_minutes)}</span> : null}
          {quiz && <span className="lx-tag lx-tag--brand">{l.kind === 'ASSESSMENT' ? '' : 'Quiz · '}{plural(quiz.questions.length, 'question')}</span>}
          {!l.is_required && <span className="lx-tag">Optional</span>}
          {l.is_final && <span className="lx-tag lx-tag--brand">Final</span>}
          {l.is_preview && <span className="lx-tag lx-tag--info">Free preview</span>}
          {missing && <span className="lx-tag lx-tag--warning">No file yet</span>}
          {l.asset && l.asset.status !== 'READY' && <span className="lx-tag lx-tag--warning">{l.asset.status === 'FAILED' ? 'Upload failed' : 'Uploading'}</span>}
        </small>
      </span>
      {!b.readOnly && <Mv label={l.title} onUp={onUp} onDown={onDown} />}
    </div>
  )
}

function AddLesson({ onAdd }: { onAdd: (kind: string, title: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="lx-btn lx-btn--sm lx-btn--ghost" onClick={() => setOpen(true)}><IconPlus size={14} /> Add a lesson</button>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="lx-st-label" style={{ margin: 0 }}>What kind of lesson?</span>
        <button className="lx-btn lx-btn--sm lx-btn--ghost lx-btn--icon" aria-label="Close" onClick={() => setOpen(false)}><IconClose size={14} /></button>
      </div>
      <div className="lx-st-kinds">
        {ADD.map(a => (
          <button key={a.kind} type="button" className="lx-st-kind" data-k={a.kind} onClick={() => { setOpen(false); onAdd(a.kind, a.title) }}>
            <span><KindGlyph kind={a.kind} size={18} /></span>{a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function AddModule({ b }: { b: BuilderApi }) {
  const [title, setTitle] = useState('')
  const add = async () => {
    const r = await b.op('module.create', { version_id: b.tree.version.id, title: title.trim() || 'New module' })
    if (r !== false) setTitle('')
  }
  return (
    <div className="lx-st-addmod">
      <input className="lx-input" data-no-titlecase="" value={title} placeholder="Name of a new module, for example “Password security”" aria-label="Name of a new module"
        onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} />
      <button className="lx-btn lx-btn--primary" onClick={() => void add()}><IconPlus size={15} /> Add module</button>
    </div>
  )
}

export default function CurriculumBoard({ b, selected, onSelect, onPreview }: {
  b: BuilderApi; selected: string | null; onSelect: (id: string | null) => void; onPreview: (lessonId: string) => void
}) {
  const { tree } = b
  const [fresh, setFresh] = useState<string | null>(null)
  const [drag, setDragS] = useState<Drag>(null)
  const [drop, setDropS] = useState<Drop>(null)
  const [modDrop, setModDropS] = useState<number | null>(null)
  // The drop event can arrive before React has drawn the last dragover, so the handlers read
  // the drag from here; the state is only for drawing the markers.
  const live$ = useRef<{ drag: Drag; drop: Drop; modDrop: number | null }>({ drag: null, drop: null, modDrop: null })
  const setDrag = (d: Drag) => { live$.current.drag = d; setDragS(d) }
  const setDrop = (d: Drop) => { live$.current.drop = d; setDropS(d) }
  const setModDrop = (n: number | null) => { live$.current.modDrop = n; setModDropS(n) }
  const [ov, setOv] = useState<Order | null>(null)

  const byPos = (x: any, y: any) => x.position - y.position
  const live = ov && ov.tree === tree ? ov : null
  const modIds: string[] = live?.mods || [...tree.modules].sort(byPos).map(m => m.id)
  const lessonIds = (mid: string): string[] => live?.les[mid] || tree.lessons.filter(l => l.module_id === mid).sort(byPos).map(l => l.id)
  const mod = (id: string) => tree.modules.find(m => m.id === id)
  const lesson = (id: string) => tree.lessons.find(l => l.id === id)
  const current = tree.lessons.find(l => l.id === selected) || null
  const modules = modIds.map(mod).filter(Boolean) as any[]

  const snapshot = (): Order => ({ tree, mods: [...modIds], les: Object.fromEntries(modIds.map(id => [id, [...lessonIds(id)]])) })

  const reorderModules = (ids: string[]) => {
    setOv({ ...snapshot(), mods: ids })
    void b.op('module.reorder', { version_id: tree.version.id, ids })
  }
  const placeLesson = (id: string, from: string, to: string, index: number) => {
    const o = snapshot()
    const src = o.les[from].filter(x => x !== id)
    const dst = from === to ? src : [...o.les[to]]
    const at = Math.max(0, Math.min(index, dst.length))
    dst.splice(at, 0, id)
    o.les[from] = from === to ? dst : src
    o.les[to] = dst
    setOv(o)
    void b.op('lesson.reorder', { module_id: to, ids: dst })
  }
  const endDrag = () => { setDrag(null); setDrop(null); setModDrop(null) }
  const doDrop = () => {
    const { drag, drop, modDrop } = live$.current
    if (drag?.type === 'lesson' && drop) {
      const from = drag.from, ids = lessonIds(from)
      let index = drop.index
      if (from === drop.module && ids.indexOf(drag.id) < index) index -= 1
      if (!(from === drop.module && ids.indexOf(drag.id) === index)) placeLesson(drag.id, from, drop.module, index)
    } else if (drag?.type === 'module' && modDrop != null) {
      const at = modIds.indexOf(drag.id)
      let to = modDrop
      if (at < to) to -= 1
      if (at !== to) reorderModules(move(modIds, at, to))
    }
    endDrag()
  }

  const addLesson = async (moduleId: string, kind: string, title: string) => {
    const r = await b.op('lesson.create', { module_id: moduleId, kind, title })
    if (r && r.id) { setFresh(r.id); onSelect(r.id) }
  }

  const totalLessons = tree.lessons.length
  const videos = tree.lessons.filter(l => l.kind === 'VIDEO').length
  return (
    <div className="lx-st-board" data-solo={current ? '0' : '1'}>
      <div className="lx-st-tree" onDragEnd={endDrag}>
        {!b.readOnly && (
          <div className="lx-st-tip">
            <span><GSparkle size={16} /></span>
            <span>Each video, PDF or article is its own lesson, so a module can hold as many short videos as you like. Drag the <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}><GGrip size={13} /></span> handle to reorder lessons or move them to another module. To test people after a lesson, open it and choose <b>Add a quiz after this lesson</b>.</span>
          </div>
        )}
        <div className="lx-st-hint">{plural(modules.length, 'module')} · {plural(totalLessons, 'lesson')}{videos ? ` · ${plural(videos, 'video')}` : ''}</div>
        {modules.map((m, i) => {
          const ids = lessonIds(m.id)
          const isModDrop = drag?.type === 'module' && (modDrop === i)
          return (
            <section key={m.id} className="lx-st-mod" data-dragging={drag?.type === 'module' && drag.id === m.id ? '1' : undefined}
              data-drop={(drag?.type === 'lesson' && drop?.module === m.id) || isModDrop ? '1' : undefined}
              onDragOver={e => {
                if (!live$.current.drag) return
                e.preventDefault()
                const d = live$.current.drag
                if (d?.type === 'module') { const r = e.currentTarget.getBoundingClientRect(); setModDrop(e.clientY > r.top + r.height / 2 ? i + 1 : i) }
                else if (d && !ids.length) setDrop({ module: m.id, index: 0 })
              }}
              onDrop={e => { e.preventDefault(); doDrop() }}>
              <div className="lx-st-mod-head">
                {!b.readOnly && (
                  <span className="lx-st-grip" draggable aria-hidden title="Drag to reorder modules"
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); setDrag({ type: 'module', id: m.id }) }}><GGrip size={14} /></span>
                )}
                <span className="lx-st-mod-n">{i + 1}</span>
                <ModuleTitle key={`${m.id}:${m.title}`} m={m} b={b} />
                <span className="lx-st-hint lx-num" style={{ whiteSpace: 'nowrap' }}>{plural(ids.length, 'lesson')}</span>
                {!b.readOnly && <Mv label={m.title} onUp={i > 0 ? () => reorderModules(move(modIds, i, i - 1)) : undefined} onDown={i < modules.length - 1 ? () => reorderModules(move(modIds, i, i + 1)) : undefined} />}
              </div>
              <div className="lx-st-lessons">
                {ids.map((id, n) => {
                  const l = lesson(id)
                  if (!l) return null
                  const here = drag?.type === 'lesson' && drop?.module === m.id
                  const mark = here && drop!.index === n ? 'before' : here && drop!.index === n + 1 && n === ids.length - 1 ? 'after' : null
                  return (
                    <LessonRow key={id} l={l} quiz={tree.quizzes.find(q => q.id === l.quiz_id)} on={selected === id} b={b} drop={mark}
                      dragging={drag?.type === 'lesson' && drag.id === id}
                      onSelect={() => onSelect(id)}
                      onUp={n > 0 ? () => placeLesson(id, m.id, m.id, n - 1) : undefined}
                      onDown={n < ids.length - 1 ? () => placeLesson(id, m.id, m.id, n + 1) : undefined}
                      onDragStart={() => setDrag({ type: 'lesson', id, from: m.id })} onDragEnd={endDrag}
                      onOver={after => { if (live$.current.drag?.type === 'lesson') setDrop({ module: m.id, index: after ? n + 1 : n }) }} />
                  )
                })}
                {!ids.length && <div className="lx-st-empty-mod" data-drop={drag?.type === 'lesson' && drop?.module === m.id ? '1' : undefined}>{b.readOnly ? 'No lessons in this module.' : 'No lessons yet. Add one below, or drag a lesson here.'}</div>}
              </div>
              {!b.readOnly && (
                <div className="lx-st-add">
                  <AddLesson onAdd={(kind, title) => void addLesson(m.id, kind, title)} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
                    <label style={{ width: 170 }}>
                      <span className="lx-st-label">Opens after (days)</span>
                      <EditNumber value={m.unlock_after_days} min={0} placeholder="At once" disabled={b.readOnly} onSave={v => b.op('module.update', { id: m.id, unlock_after_days: v })} />
                    </label>
                    <ConfirmButton label="Delete module" question="Delete it and its lessons?" confirm="Delete" onConfirm={() => b.op('module.delete', { id: m.id })} />
                  </div>
                </div>
              )}
              {b.readOnly && m.unlock_after_days != null && <div className="lx-st-add lx-st-hint">Opens {m.unlock_after_days} days after the learner starts.</div>}
            </section>
          )
        })}
        {drag?.type === 'module' && (
          <div className="lx-st-empty-mod" data-drop={modDrop === modules.length ? '1' : undefined}
            onDragOver={e => { e.preventDefault(); setModDrop(modules.length) }} onDrop={e => { e.preventDefault(); doDrop() }}>Drop here to make it the last module</div>
        )}
        {!modules.length && (
          <div className="lx-empty" style={{ padding: '36px 20px' }}>
            <h3>{b.readOnly ? 'This version has no content' : 'Add the first module'}</h3>
            {!b.readOnly && <p>A course is a list of modules, and each module holds lessons: videos, slides, documents, articles, links and assessments.</p>}
          </div>
        )}
        {!b.readOnly && <AddModule b={b} />}
      </div>
      {current && (
        <aside className="lx-st-editor" aria-label="Lesson">
          <div className="lx-st-editor-head">
            <span className="lx-kind" data-k={current.kind} style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--ez-brand-tint)', color: 'var(--ez-brand)' }}><KindGlyph kind={current.kind} size={16} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="lx-st-label" style={{ margin: 0 }}>{mod(current.module_id)?.title || 'Module'}</div>
              <div style={{ fontWeight: 750, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.title}</div>
            </div>
            <button className="lx-btn lx-btn--sm" onClick={() => onPreview(current.id)}><GEye size={15} /> Preview</button>
            <button className="lx-btn lx-btn--sm lx-btn--ghost lx-btn--icon" aria-label="Close the lesson" onClick={() => onSelect(null)}><IconClose size={15} /></button>
          </div>
          <LessonEditor key={current.id} lesson={current} modules={modules} b={b} fresh={fresh === current.id} onDeleted={() => onSelect(null)} />
        </aside>
      )}
    </div>
  )
}
