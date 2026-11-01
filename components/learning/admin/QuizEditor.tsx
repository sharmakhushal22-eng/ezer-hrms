'use client'
// components/learning/admin/QuizEditor.tsx — a lesson's quiz: settings, questions, and import.
//
// A question is edited as one draft and saved when focus leaves its card, or when a choice
// that decides the answer changes. Half-finished questions are allowed to save: the publish
// checks are what refuse an unfinished quiz, so nobody loses a draft to validation.
import { useEffect, useRef, useState } from 'react'
import { questionProblem, type QuestionFull, type QuestionKind } from '@/lib/lms/core'
import { Badge, Button, C, F, Field, IconCheck, Notice, R, S, Select, TableWrap, Td, Th, W, numeric } from '@/lib/ui'
import {
  ConfirmButton, EditNumber, EditText, FilePick, Hint, Panel, RadioList, SaveSelect, TextArea, TextInput, Toggle, downloadSheets, grid, plural, readSheet, row, stack,
} from './shared'
import type { BuilderApi } from './builder-api'

const KIND_NAME: Record<string, string> = { SINGLE: 'One right answer', MULTI: 'Several right answers', TRUE_FALSE: 'True or false', SHORT_TEXT: 'Typed answer' }

interface Draft {
  kind: QuestionKind; prompt: string; explanation: string; marks: string; partial_credit: boolean
  options: { id: string; text: string; correct: boolean }[]; accepted: string
}

const toDraft = (q: any): Draft => ({
  kind: q.kind, prompt: q.prompt || '', explanation: q.explanation || '', marks: String(Number(q.marks ?? 1)), partial_credit: !!q.partial_credit,
  options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text || '', correct: !!o.correct })), accepted: (q.accepted || []).join('\n'),
})
const toBody = (d: Draft) => ({
  kind: d.kind, prompt: d.prompt, explanation: d.explanation || null, marks: Number(d.marks), partial_credit: d.partial_credit,
  options: d.options, accepted: d.accepted.split('\n').map(s => s.trim()).filter(Boolean),
})
const nextId = (o: { id: string }[]) => {
  const top = Math.max(0, ...o.map(x => Number(/^o(\d+)$/.exec(x.id)?.[1] || 0)), o.length)
  return `o${top + 1}`
}

function changeKind(d: Draft, kind: QuestionKind): Draft {
  if (kind === 'TRUE_FALSE') return { ...d, kind, options: [{ id: 'true', text: 'True', correct: true }, { id: 'false', text: 'False', correct: false }] }
  if (kind === 'SHORT_TEXT') return { ...d, kind, options: [] }
  let options = d.kind === 'TRUE_FALSE' || !d.options.length ? [{ id: 'o1', text: '', correct: false }, { id: 'o2', text: '', correct: false }] : d.options
  if (kind === 'SINGLE') { const first = options.findIndex(o => o.correct); options = options.map((o, i) => ({ ...o, correct: i === first })) }
  return { ...d, kind, options }
}

function OptionRow({ o, kind, name, canRemove, onCorrect, onText, onRemove }: {
  o: Draft['options'][number]; kind: QuestionKind; name: string; canRemove: boolean; onCorrect: (v: boolean) => void; onText: (v: string) => void; onRemove: () => void
}) {
  const fixed = kind === 'TRUE_FALSE'
  return (
    <div style={{ display: 'flex', gap: S.sm, alignItems: 'center' }}>
      <label title="Mark as correct" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: o.correct ? C.positive : C.muted, fontWeight: W.semi, flexShrink: 0, cursor: 'pointer', width: 72 }}>
        <input type={kind === 'MULTI' ? 'checkbox' : 'radio'} name={name} checked={o.correct} onChange={e => onCorrect(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.positive }} />
        {o.correct ? 'Correct' : 'Wrong'}
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextInput value={o.text} disabled={fixed} placeholder="Option text" aria-label="Option text" onChange={e => onText(e.target.value)} />
      </div>
      {!fixed && canRemove && <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>}
    </div>
  )
}

function QuestionView({ q, index, onOpen, ro }: { q: any; index: number; onOpen: () => void; ro: boolean }) {
  const problem = questionProblem({ ...q, marks: Number(q.marks), accepted: q.accepted || [], options: q.options || [] } as QuestionFull)
  return (
    <div role={ro ? undefined : 'button'} tabIndex={ro ? undefined : 0} onClick={ro ? undefined : onOpen} onKeyDown={ro ? undefined : e => { if (e.key === 'Enter') onOpen() }} style={{ cursor: ro ? 'default' : 'pointer', minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: F.small, fontWeight: W.medium, color: q.prompt ? C.ink : C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{index + 1}. {q.prompt || 'No question text yet'}</div>
      <div style={{ ...row(S.sm), marginTop: 4 }}>
        <span style={{ fontSize: F.tiny, color: C.muted }}>{KIND_NAME[q.kind]} · {plural(Number(q.marks), 'mark')}{q.partial_credit ? ' · part marks' : ''}</span>
      </div>
      {(q.options || []).length > 0 && (
        <div style={{ ...stack(2), marginTop: 6 }}>
          {q.options.map((o: any) => (
            <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: F.tiny, color: o.correct ? C.positive : C.inkSoft }}>
              <span style={{ width: 13, display: 'flex', flexShrink: 0 }}>{o.correct && <IconCheck size={13} />}</span>{o.text || '(empty option)'}
            </div>
          ))}
        </div>
      )}
      {q.kind === 'SHORT_TEXT' && (q.accepted || []).length > 0 && <div style={{ fontSize: F.tiny, color: C.positive, marginTop: 6 }}>Accepted: {q.accepted.join(', ')}</div>}
      {problem && <div style={{ fontSize: F.tiny, color: C.warning, marginTop: 6 }}>This question {problem}.</div>}
    </div>
  )
}

function QuestionForm({ q, onSave, onClose }: { q: any; onSave: (body: ReturnType<typeof toBody>) => Promise<any>; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(q))
  const [dirty, setDirty] = useState(false)
  const rev = useRef(0)
  const latest = useRef(d)
  const unsaved = useRef(false)

  useEffect(() => {
    if (unsaved.current) return
    const next = toDraft(q)
    latest.current = next
    setD(next)
  }, [q])

  const save = async (next: Draft = latest.current) => {
    if (!unsaved.current) return true
    const at = rev.current
    const r = await onSave(toBody(next))
    if (r === false) return false
    if (at === rev.current) { unsaved.current = false; setDirty(false) }
    return true
  }
  const edit = (next: Draft, now = false) => {
    rev.current++
    unsaved.current = true
    latest.current = next
    setD(next); setDirty(true)
    if (now) save(next)
  }
  const setOption = (id: string, patch: Partial<Draft['options'][number]>) =>
    d.options.map(o => (o.id === id ? { ...o, ...patch } : o))
  const pickCorrect = (id: string, on: boolean) => {
    const options = d.kind === 'MULTI' ? setOption(id, { correct: on }) : d.options.map(o => ({ ...o, correct: o.id === id }))
    edit({ ...d, options }, true)
  }
  const choice = d.kind === 'SINGLE' || d.kind === 'MULTI' || d.kind === 'TRUE_FALSE'
  return (
    <div style={{ ...stack(), flex: 1, minWidth: 0 }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save() }}>
      <div style={grid(200)}>
        <Field label="Type">
          <Select value={d.kind} onChange={e => edit(changeKind(d, e.target.value as QuestionKind), true)}>
            {Object.entries(KIND_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Marks"><TextInput type="number" min={0.5} step={0.5} value={d.marks} onChange={e => edit({ ...d, marks: e.target.value })} /></Field>
      </div>
      <Field label="Question"><TextArea rows={2} autoFocus={!q.prompt} value={d.prompt} onChange={e => edit({ ...d, prompt: e.target.value })} /></Field>
      {choice && (
        <div style={stack(S.sm)}>
          <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>Options</div>
          {d.options.map(o => (
            <OptionRow key={o.id} o={o} kind={d.kind} name={`q-${q.id}`} canRemove={d.options.length > 2}
              onCorrect={v => pickCorrect(o.id, v)} onText={v => edit({ ...d, options: setOption(o.id, { text: v }) })}
              onRemove={() => edit({ ...d, options: d.options.filter(x => x.id !== o.id) }, true)} />
          ))}
          {d.kind !== 'TRUE_FALSE' && <div><Button size="sm" onClick={() => edit({ ...d, options: [...d.options, { id: nextId(d.options), text: '', correct: false }] })}>Add option</Button></div>}
        </div>
      )}
      {d.kind === 'MULTI' && <Toggle label="Give part marks" hint="Marks are shared across the right options, and a wrong pick takes one share away. Off means all or nothing." checked={d.partial_credit} onChange={v => edit({ ...d, partial_credit: v }, true)} />}
      {d.kind === 'SHORT_TEXT' && (
        <Field label="Accepted answers" hint="One per line. Capitals and extra spaces do not matter, but spelling does.">
          <TextArea rows={3} value={d.accepted} onChange={e => edit({ ...d, accepted: e.target.value })} />
        </Field>
      )}
      <Field label="Explanation" hint="Shown with the answers, if this quiz shows them."><TextArea rows={2} value={d.explanation} onChange={e => edit({ ...d, explanation: e.target.value })} /></Field>
      <div style={row()}>
        <Button size="sm" variant="primary" onClick={async () => { if (await save()) onClose() }}>{dirty ? 'Save and close' : 'Close'}</Button>
        {dirty && <Hint>Saves when you leave this question.</Hint>}
      </div>
    </div>
  )
}

function QuestionCard({ q, index, count, open, ro, ids, quizId, b, onOpen, onClose }: {
  q: any; index: number; count: number; open: boolean; ro: boolean; ids: string[]; quizId: string; b: BuilderApi; onOpen: () => void; onClose: () => void
}) {
  const move = (dir: -1 | 1) => { const a = [...ids]; [a[index], a[index + dir]] = [a[index + dir], a[index]]; b.op('question.reorder', { quiz_id: quizId, ids: a }) }
  return (
    <div style={{ padding: S.md, border: `1px solid ${open ? C.brandEdge : C.line}`, borderRadius: R.md, background: C.surface }}>
      <div style={{ display: 'flex', gap: S.md, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {open
          ? <QuestionForm q={q} onClose={onClose} onSave={body => b.op('question.update', { id: q.id, ...body })} />
          : <QuestionView q={q} index={index} ro={ro} onOpen={onOpen} />}
        {!ro && !open && (
          <div style={{ ...row(4), flexShrink: 0 }}>
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(-1)}>Up</Button>
            <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => move(1)}>Down</Button>
            <Button size="sm" onClick={onOpen}>Edit</Button>
            <ConfirmButton label="Delete" question="Delete this question?" confirm="Delete" onConfirm={() => b.op('question.delete', { id: q.id })} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Excel import ────────────────────────────────────────────────────────────
const IMPORT_HEAD = ['kind', 'prompt', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'marks', 'explanation', 'accepted']
const KIND_WORDS: Record<string, QuestionKind> = {
  single: 'SINGLE', one: 'SINGLE', multi: 'MULTI', multiple: 'MULTI', several: 'MULTI',
  true_false: 'TRUE_FALSE', truefalse: 'TRUE_FALSE', 'true/false': 'TRUE_FALSE', tf: 'TRUE_FALSE',
  short_text: 'SHORT_TEXT', short: 'SHORT_TEXT', text: 'SHORT_TEXT', typed: 'SHORT_TEXT',
}

function parseQuestion(r: Record<string, string>): { body?: any; error?: string } {
  const kind = KIND_WORDS[(r.kind || 'single').trim().toLowerCase()]
  if (!kind) return { error: `Type "${r.kind}" is not known. Use single, multi, true_false or short_text.` }
  const marks = r.marks ? Number(r.marks) : 1
  if (!(marks > 0)) return { error: 'Marks must be more than zero.' }
  const picks = (r.correct || '').toLowerCase().split(/[,\s;]+/).filter(Boolean)
  let options: { id: string; text: string; correct: boolean }[] = []
  let accepted: string[] = []
  if (kind === 'TRUE_FALSE') {
    const v = picks[0]
    if (!['true', 'false', 't', 'f', 'a', 'b'].includes(v)) return { error: 'For true or false, put true or false in the correct column.' }
    const yes = v === 'true' || v === 't' || v === 'a'
    options = [{ id: 'true', text: 'True', correct: yes }, { id: 'false', text: 'False', correct: !yes }]
  } else if (kind === 'SHORT_TEXT') {
    accepted = (r.accepted || '').split(/[|;\n]/).map(s => s.trim()).filter(Boolean)
  } else {
    options = ['a', 'b', 'c', 'd'].filter(l => r[`option_${l}`]).map(l => ({ id: l, text: r[`option_${l}`], correct: picks.includes(l) }))
    const missing = picks.find(p => !options.some(o => o.id === p))
    if (missing) return { error: `The correct column says ${missing}, but that option is empty.` }
  }
  const body = { kind, prompt: r.prompt || '', explanation: r.explanation || null, marks, options, accepted, partial_credit: false }
  const p = questionProblem({ ...body, id: 'x', position: 0 } as QuestionFull)
  return p ? { error: `This question ${p}.` } : { body }
}

function ImportPanel({ quizId, b, onClose }: { quizId: string; b: BuilderApi; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([])
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const read = async (file: File) => {
    setErr(''); setDone(''); setRows(null); setErrors([])
    try {
      const raw = await readSheet(file)
      if (!raw.length) throw new Error('The file has no rows.')
      if (raw.length > 500) throw new Error('Import at most 500 questions at a time.')
      const good: any[] = [], bad: { row: number; error: string }[] = []
      raw.forEach((r, i) => { const p = parseQuestion(r); if (p.body) good.push(p.body); else bad.push({ row: i + 2, error: p.error! }) })
      setRows(good); setErrors(bad)
    } catch (e: any) { setErr(e?.message || 'That file could not be read.') }
  }
  const template = () => downloadSheets('quiz-questions-template.xlsx', [{ name: 'Questions', rows: [
    IMPORT_HEAD,
    ['single', 'Which of these is a strong password?', 'password123', 'Tr7!mQ9#xL', 'Your name', 'Your birthday', 'b', 1, 'Long and mixed is hardest to guess.', ''],
    ['multi', 'Which of these should you report?', 'A suspicious e-mail', 'A lost laptop', 'A colleague\'s birthday', '', 'a,b', 2, '', ''],
    ['true_false', 'You may share your password with your manager.', '', '', '', '', 'false', 1, '', ''],
    ['short_text', 'What does MFA stand for?', '', '', '', '', '', 1, '', 'multi factor authentication | multi-factor authentication'],
  ] }])
  const go = async () => {
    const r = await b.op('question.import', { quiz_id: quizId, rows })
    if (r !== false) { setDone(`${plural(r.imported, 'question')} added to this quiz.`); setRows(null) }
  }
  return (
    <div style={{ ...stack(S.sm), padding: S.md, borderRadius: R.md, background: C.sunken }}>
      <div style={{ ...row(), justifyContent: 'space-between' }}>
        <span style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>Import questions from Excel</span>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <Hint>Download the template, replace the sample rows, and upload it. Questions are added to the end of this quiz. In the correct column use a letter such as a, or a,c for several. Separate accepted answers with a | sign.</Hint>
      <div style={row()}>
        <Button size="sm" onClick={template}>Download template</Button>
        <FilePick accept=".xlsx,.xls,.csv" label="Upload file" onFile={read} />
      </div>
      {err && <Notice>{err}</Notice>}
      {done && <Notice t="positive">{done}</Notice>}
      {errors.length > 0 && (
        <Notice title={`${plural(errors.length, 'row')} need fixing before anything can be imported`}>
          <TableWrap stagger={false} style={{ boxShadow: 'none', maxHeight: 220, overflowY: 'auto' }}>
            <thead><tr><Th width={70}>Row</Th><Th>What is wrong</Th></tr></thead>
            <tbody>{errors.map(e => <tr key={e.row}><Td mono>{e.row}</Td><Td>{e.error}</Td></tr>)}</tbody>
          </TableWrap>
        </Notice>
      )}
      {rows && !errors.length && (
        <div style={row()}>
          <span style={{ fontSize: F.small, color: C.ink, ...numeric }}>{plural(rows.length, 'question')} ready.</span>
          <Button size="sm" variant="primary" onClick={go}>Add to this quiz</Button>
        </div>
      )}
    </div>
  )
}

// ── The quiz ────────────────────────────────────────────────────────────────
function QuizSettings({ quiz: q, b }: { quiz: any; b: BuilderApi }) {
  const off = b.readOnly
  const up = (patch: Record<string, unknown>) => b.op('quiz.update', { id: q.id, ...patch })
  return (
    <div style={stack()}>
      <div style={grid(200)}>
        <Field label="Quiz title"><EditText value={q.title} disabled={off} onSave={v => up({ title: v || 'Quiz' })} /></Field>
        <Field label="Pass mark (%)"><EditNumber value={q.pass_pct} min={0} max={100} disabled={off} onSave={v => up({ pass_pct: v ?? 70 })} /></Field>
        <Field label="Attempts allowed" hint="Blank means unlimited."><EditNumber value={q.max_attempts} min={1} placeholder="Unlimited" disabled={off} onSave={v => up({ max_attempts: v })} /></Field>
        <Field label="Wait between attempts (minutes)"><EditNumber value={q.cooldown_minutes} min={0} disabled={off} onSave={v => up({ cooldown_minutes: v ?? 0 })} /></Field>
        <Field label="Time limit (minutes)" hint="Blank means no limit."><EditNumber value={q.time_limit_minutes} min={1} placeholder="No limit" disabled={off} onSave={v => up({ time_limit_minutes: v })} /></Field>
        <Field label="Ask this many at random" hint="Blank asks all of them."><EditNumber value={q.draw_count} min={1} placeholder="All" disabled={off} onSave={v => up({ draw_count: v })} /></Field>
      </div>
      <Field label="Instructions" hint="Shown before someone starts."><EditText multiline rows={2} value={q.instructions} disabled={off} onSave={v => up({ instructions: v || null })} /></Field>
      <div style={grid(240)}>
        <Toggle label="Shuffle the questions" checked={q.shuffle_questions} disabled={off} onChange={v => up({ shuffle_questions: v })} />
        <Toggle label="Shuffle the options" hint="True or false stays in that order." checked={q.shuffle_options} disabled={off} onChange={v => up({ shuffle_options: v })} />
      </div>
      <div style={grid(240)}>
        <Field label="Show the right answers">
          <SaveSelect value={q.show_answers} disabled={off} onSave={v => up({ show_answers: v })}>
            <option value="AFTER_PASS">After passing</option><option value="AFTER_SUBMIT">After every attempt</option><option value="NEVER">Never</option>
          </SaveSelect>
        </Field>
        <Field label="When attempts run out">
          <SaveSelect value={q.on_exhausted} disabled={off} onSave={v => up({ on_exhausted: v })}>
            <option value="LOCK">Lock it until HR gives more</option><option value="REWATCH">Reset after watching the lesson again</option>
          </SaveSelect>
        </Field>
      </div>
    </div>
  )
}

export default function QuizEditor({ lesson: l, quiz: q, b }: { lesson: any; quiz: any; b: BuilderApi }) {
  const off = b.readOnly
  const [open, setOpen] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const questions = [...(q.questions || [])].sort((x, y) => x.position - y.position)
  const ids = questions.map(x => x.id)
  const add = async (kind: QuestionKind) => {
    const options = kind === 'SINGLE' || kind === 'MULTI' ? [{ id: 'o1', text: '', correct: false }, { id: 'o2', text: '', correct: false }] : []
    const r = await b.op('question.create', { quiz_id: q.id, kind, prompt: '', marks: 1, options })
    if (r && r.id) setOpen(r.id)
  }
  return (
    <>
      <Panel title={l.kind === 'ASSESSMENT' ? 'Assessment settings' : 'Quiz after this lesson'}
        actions={!off && l.kind !== 'ASSESSMENT' ? <ConfirmButton label="Remove quiz" question="Remove it and its questions?" confirm="Remove" onConfirm={() => b.op('quiz.detach', { lesson_id: l.id })} /> : undefined}>
        <div style={stack()}>
          <RadioList name={`quiz-required-${l.id}`} value={l.quiz_required ? 'yes' : 'no'} disabled={off}
            onChange={v => b.op('lesson.update', { id: l.id, quiz_required: v === 'yes' })}
            options={[
              { value: 'yes', label: 'Required', hint: 'It must be passed for this lesson to count.' },
              { value: 'no', label: 'Optional', hint: l.kind === 'ASSESSMENT' ? 'It must still be attempted, but the score does not hold anyone back.' : 'A knowledge check. Failing it holds nobody back.' },
            ]} />
          <Toggle label="Make this the final assessment" hint="It stays locked until the other required lessons are done, and its score becomes the course score." checked={l.is_final} disabled={off} onChange={v => b.op('lesson.update', { id: l.id, is_final: v })} />
          <QuizSettings quiz={q} b={b} />
        </div>
      </Panel>
      <Panel title={`Questions${questions.length ? ` (${questions.length})` : ''}`}
        hint={q.draw_count ? `Each person gets ${q.draw_count} of these at random.` : undefined}
        actions={!off ? <Button size="sm" onClick={() => setImporting(v => !v)}>Import from Excel</Button> : undefined}>
        <div style={stack(S.sm)}>
          {importing && !off && <ImportPanel quizId={q.id} b={b} onClose={() => setImporting(false)} />}
          {questions.map((x, i) => (
            <QuestionCard key={x.id} q={x} index={i} count={questions.length} open={open === x.id} ro={off} ids={ids} quizId={q.id} b={b}
              onOpen={() => setOpen(x.id)} onClose={() => setOpen(null)} />
          ))}
          {!questions.length && <Hint>{off ? 'This quiz has no questions.' : 'No questions yet. Add one below, or import them from Excel.'}</Hint>}
          {!off && (
            <div style={{ ...row(6), marginTop: S.xs }}>
              <span style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.semi }}>Add a question:</span>
              {(Object.keys(KIND_NAME) as QuestionKind[]).map(k => <Button key={k} size="sm" onClick={() => add(k)}>{KIND_NAME[k]}</Button>)}
            </div>
          )}
          {questions.length > 0 && q.draw_count > questions.length && <Badge t="warning" size="sm">This asks for more questions than the quiz has.</Badge>}
        </div>
      </Panel>
    </>
  )
}
