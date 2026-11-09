'use client'
// components/learning/admin/BuilderContent.tsx — the course outline on the left, the selected
// lesson on the right. Ordering uses plain up and down buttons; they work with a keyboard and
// on a phone, which a drag handle does not.
import { useState } from 'react'
import { Badge, Button, C, Card, Empty, F, Field, IconChevronDown, IconLearning, R, S, W } from '@/lib/ui'
import { ConfirmButton, EditNumber, EditText, Hint, LESSON_KIND, Panel, TextInput, plural, row, stack } from './shared'
import LessonEditor from './LessonEditor'
import type { BuilderApi } from './builder-api'

const ADD: { kind: string; label: string; title: string }[] = [
  { kind: 'VIDEO', label: 'Video', title: 'New video' }, { kind: 'AUDIO', label: 'Audio', title: 'New audio' },
  { kind: 'DOCUMENT', label: 'Document (PDF)', title: 'New document' }, { kind: 'SLIDES', label: 'Slides (PDF)', title: 'New slides' },
  { kind: 'ARTICLE', label: 'Article', title: 'New article' }, { kind: 'LINK', label: 'Link', title: 'New link' },
  { kind: 'ASSESSMENT', label: 'Assessment', title: 'Assessment' },
]

function MoveButtons({ onUp, onDown, label }: { onUp?: () => void; onDown?: () => void; label: string }) {
  const btn = { width: 26, height: 26, padding: 0, border: `1px solid ${C.line}`, background: C.surface, color: C.muted, display: 'grid', placeItems: 'center', cursor: 'pointer' } as const
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      <button type="button" aria-label={`Move ${label} up`} disabled={!onUp} onClick={e => { e.stopPropagation(); onUp?.() }} style={btn}><span style={{ display: 'flex', transform: 'rotate(180deg)' }}><IconChevronDown size={13} /></span></button>
      <button type="button" aria-label={`Move ${label} down`} disabled={!onDown} onClick={e => { e.stopPropagation(); onDown?.() }} style={btn}><IconChevronDown size={13} /></button>
    </span>
  )
}

const swap = (ids: string[], i: number, j: number) => { const a = [...ids]; [a[i], a[j]] = [a[j], a[i]]; return a }

function LessonRow({ l, on, quiz, b, onSelect, onUp, onDown }: { l: any; on: boolean; quiz: any; b: BuilderApi; onSelect: () => void; onUp?: () => void; onDown?: () => void }) {
  return (
    <div className="ez-row" style={{ display: 'flex', gap: S.sm, alignItems: 'center', padding: '2px 8px 2px 0', borderRadius: R.sm, background: on ? C.brandTint : 'transparent', border: `1px solid ${on ? C.brandEdge : 'transparent'}` }}>
      <button type="button" onClick={onSelect} aria-current={on ? 'true' : undefined}
        style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: 'none', background: 'transparent', color: C.ink, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ display: 'block', fontSize: F.small, fontWeight: on ? W.semi : W.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
        <span style={{ ...row(4), marginTop: 1 }}>
          <span style={{ fontSize: F.micro, color: C.muted }}>{LESSON_KIND[l.kind]}</span>
          {!l.is_required && <span style={{ fontSize: F.micro, color: C.muted }}>· optional</span>}
          {quiz && <span style={{ fontSize: F.micro, color: C.muted }}>· {l.kind === 'ASSESSMENT' ? '' : 'quiz, '}{plural(quiz.questions.length, 'question')}</span>}
          {l.is_final && <Badge t="brand" size="sm">Final</Badge>}
        </span>
      </button>
      {!b.readOnly && <MoveButtons label={l.title} onUp={onUp} onDown={onDown} />}
    </div>
  )
}

function AddLesson({ onAdd }: { onAdd: (kind: string, title: string) => void }) {
  return (
    <div style={{ marginTop: S.sm }}>
      <div style={{ fontSize: F.micro, color: C.muted, fontWeight: W.semi, marginBottom: 5 }}>Add a lesson</div>
      <div style={row(5)}>
        {ADD.map(a => <Button key={a.kind} size="sm" onClick={() => onAdd(a.kind, a.title)} style={{ height: 26, padding: '0 8px', fontWeight: 500 }}>{a.label}</Button>)}
      </div>
    </div>
  )
}

function ModuleBlock({ m, index, count, lessons, quizzes, selected, b, onSelect, onMove, onAdd }: {
  m: any; index: number; count: number; lessons: any[]; quizzes: any[]; selected: string | null; b: BuilderApi
  onSelect: (id: string) => void; onMove: (dir: -1 | 1) => void; onAdd: (kind: string, title: string) => void
}) {
  const ids = lessons.map(l => l.id)
  const move = (i: number, j: number) => b.op('lesson.reorder', { module_id: m.id, ids: swap(ids, i, j) })
  return (
    <Card elevation="flat" pad={S.md} style={{ marginBottom: S.md }}>
      <div style={stack(S.sm)}>
        <div style={{ display: 'flex', gap: S.sm, alignItems: 'center' }}>
          <span style={{ fontSize: F.micro, color: C.muted, fontWeight: W.bold, flexShrink: 0 }}>{index + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditText label="Module title" value={m.title} disabled={b.readOnly} onSave={v => b.op('module.update', { id: m.id, title: v || 'Module' })} />
          </div>
          {!b.readOnly && <MoveButtons label={m.title} onUp={index > 0 ? () => onMove(-1) : undefined} onDown={index < count - 1 ? () => onMove(1) : undefined} />}
        </div>
        <div style={stack(2)}>
          {lessons.map((l, i) => (
            <LessonRow key={l.id} l={l} on={selected === l.id} quiz={quizzes.find(q => q.id === l.quiz_id)} b={b} onSelect={() => onSelect(l.id)}
              onUp={i > 0 ? () => move(i, i - 1) : undefined} onDown={i < lessons.length - 1 ? () => move(i, i + 1) : undefined} />
          ))}
          {!lessons.length && <Hint style={{ padding: '4px 8px' }}>No lessons in this module yet.</Hint>}
        </div>
        {!b.readOnly && <AddLesson onAdd={onAdd} />}
        <div style={{ display: 'flex', gap: S.md, alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: S.sm, borderTop: `1px solid ${C.line}` }}>
          <div style={{ width: 170 }}>
            <Field label="Opens after (days)"><EditNumber value={m.unlock_after_days} min={0} placeholder="At once" disabled={b.readOnly} onSave={v => b.op('module.update', { id: m.id, unlock_after_days: v })} /></Field>
          </div>
          {!b.readOnly && <ConfirmButton label="Delete module" question="Delete it and its lessons?" confirm="Delete" onConfirm={() => b.op('module.delete', { id: m.id })} />}
        </div>
      </div>
    </Card>
  )
}

function AddModule({ b }: { b: BuilderApi }) {
  const [title, setTitle] = useState('')
  const add = async () => {
    const r = await b.op('module.create', { version_id: b.tree.version.id, title: title.trim() || 'New module' })
    if (r !== false) setTitle('')
  }
  return (
    <div style={{ display: 'flex', gap: S.sm }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextInput value={title} placeholder="Name of a new module" aria-label="Name of a new module" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      </div>
      <Button onClick={add}>Add module</Button>
    </div>
  )
}

export default function BuilderContent({ b, selected, onSelect }: { b: BuilderApi; selected: string | null; onSelect: (id: string | null) => void }) {
  const { tree } = b
  const [fresh, setFresh] = useState<string | null>(null)
  const modules = [...tree.modules].sort((x, y) => x.position - y.position)
  const lessonsOf = (id: string) => tree.lessons.filter(l => l.module_id === id).sort((x, y) => x.position - y.position)
  const current = tree.lessons.find(l => l.id === selected) || null
  const moveModule = (i: number, dir: -1 | 1) => b.op('module.reorder', { version_id: tree.version.id, ids: swap(modules.map(m => m.id), i, i + dir) })
  const addLesson = async (moduleId: string, kind: string, title: string) => {
    const r = await b.op('lesson.create', { module_id: moduleId, kind, title })
    if (r && r.id) { setFresh(r.id); onSelect(r.id) }
  }
  return (
    <div style={{ display: 'flex', gap: S.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 340px', maxWidth: 440, minWidth: 0 }}>
        <div style={{ fontSize: F.small, color: C.muted, marginBottom: S.sm }}>Modules and lessons</div>
        {modules.map((m, i) => (
          <ModuleBlock key={m.id} m={m} index={i} count={modules.length} lessons={lessonsOf(m.id)} quizzes={tree.quizzes} selected={selected} b={b}
            onSelect={onSelect} onMove={dir => moveModule(i, dir)} onAdd={(kind, title) => addLesson(m.id, kind, title)} />
        ))}
        {!modules.length && <Panel><Hint>{b.readOnly ? 'This version has no content.' : 'A course is a list of modules, and each module holds lessons. Add the first module to begin.'}</Hint></Panel>}
        {!b.readOnly && <AddModule b={b} />}
      </div>
      <div style={{ flex: '2 1 460px', minWidth: 0 }}>
        {current
          ? <LessonEditor key={current.id} lesson={current} modules={modules} b={b} fresh={fresh === current.id} onDeleted={() => onSelect(null)} />
          : <Card elevation="flat"><Empty icon={<IconLearning size={22} />} title="Select a lesson" hint={modules.length ? 'Pick a lesson on the left to see and change it.' : 'Lessons you add will open here.'} /></Card>}
      </div>
    </div>
  )
}
