'use client'
// components/learning/admin/LessonEditor.tsx — one lesson: its content by kind, what the
// learner must do with it, its downloads, and its quiz.
import { useState } from 'react'
import { formatBytes, uploadLmsFile, type AssetKind } from '@/lib/lms/upload-client'
import { Badge, Button, C, F, Field, Notice, S, W } from '@/lib/ui'
import {
  Bar, ConfirmButton, EditNumber, EditText, FilePick, Hint, LESSON_KIND, Panel, SaveSelect, TextInput, Toggle, grid, row, stack,
} from './shared'
import QuizEditor from './QuizEditor'
import { linkProps, to } from '../app/router'
import type { BuilderApi } from './builder-api'

const VIDEO_HINT = 'MP4 only, with H.264 video and AAC audio, up to 2 GB. An iPhone usually records HEVC, which many office PCs cannot play, so it will be refused. Export it through HandBrake (the "Fast 720p" preset with "Web Optimized" ticked), or set Settings, Camera, Formats, Most Compatible on the iPhone before recording.'
const FILE_RULES: Record<string, { kind: AssetKind; accept: string; hint: string }> = {
  VIDEO: { kind: 'VIDEO', accept: 'video/mp4,.mp4', hint: VIDEO_HINT },
  AUDIO: { kind: 'AUDIO', accept: 'audio/mpeg,audio/mp4,audio/wav,audio/webm,.mp3,.m4a,.wav', hint: 'MP3, M4A or WAV, up to 300 MB.' },
  DOCUMENT: { kind: 'DOCUMENT', accept: 'application/pdf,.pdf', hint: 'A PDF, up to 100 MB. Word files need saving as PDF first.' },
  SLIDES: { kind: 'DOCUMENT', accept: 'application/pdf,.pdf', hint: 'Slides saved as a PDF, up to 100 MB. In PowerPoint, use Save As, PDF.' },
  SCORM: { kind: 'SCORM', accept: '.zip,application/zip,application/x-zip-compressed', hint: 'The .zip your authoring tool exports as SCORM 1.2 or SCORM 2004 (Articulate Storyline or Rise, Adobe Captivate, iSpring, Elucidat and others), up to 1 GB. It must have imsmanifest.xml inside. The package runs as it was built and reports completion and score itself.' },
}
const minutes = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} sec`)

function FileError({ text }: { text: string }) {
  return text ? <div role="alert" style={{ fontSize: F.tiny, color: C.critical, lineHeight: 1.5 }}>{text}</div> : null
}

/** Speed and time left, from the bytes sent since the upload began. */
function pace(pct: number, size: number, since: number) {
  const secs = (Date.now() - since) / 1000
  if (pct <= 0 || pct >= 100 || secs < 1.5) return ''
  const rate = (size * pct / 100) / secs
  const left = (size * (100 - pct) / 100) / rate
  return ` · ${formatBytes(rate)}/s · about ${left >= 90 ? `${Math.round(left / 60)} min` : `${Math.max(1, Math.round(left))} s`} left`
}

function Uploading({ pct, hasBytes, size, since }: { pct: number; hasBytes: boolean; size: number; since: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
      <Bar pct={pct} width={240} />
      <span style={{ fontSize: F.tiny, color: C.muted }}>{hasBytes ? `Uploading ${pct}%${pace(pct, size, since)}` : 'Checking the file…'}</span>
    </div>
  )
}

function LessonFile({ l, b }: { l: any; b: BuilderApi }) {
  const rule = FILE_RULES[l.kind]
  const [pct, setPct] = useState(0)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [sending, setSending] = useState({ size: 0, since: 0 })
  const [err, setErr] = useState('')
  const [pkg, setPkg] = useState<{ version: string; title: string; launch: string; files: string } | null>(null)
  const pick = async (file: File) => {
    setErr(''); setPct(0); setStarted(false); setSending({ size: file.size, since: Date.now() }); setPkg(null)
    if (rule.kind === 'SCORM' && !file.name.toLowerCase().endsWith('.zip')) {
      setErr('A SCORM package is a .zip file. Export the course from your authoring tool as SCORM.')
      return
    }
    if (rule.kind === 'DOCUMENT' && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErr('A lesson shows a PDF. Save the file as PDF first, or attach it below as a download.')
      return
    }
    setBusy(true)
    try {
      const asset = await uploadLmsFile(file, { kind: rule.kind, companyId: b.course.company_id, onProgress: p => { setStarted(true); setPct(p) } })
      await b.op('lesson.update', { id: l.id, asset_id: asset.id })
      if ((asset as any).scorm) setPkg((asset as any).scorm)
    } catch (e: any) { setErr(e?.message || 'That file could not be uploaded.') }
    finally { setBusy(false) }
  }
  const a = l.asset
  return (
    <div style={stack(S.sm)}>
      {a ? (
        <div style={{ ...row(), fontSize: F.small, color: C.ink }}>
          <span style={{ fontWeight: W.medium, wordBreak: 'break-word' }}>{a.original_name}</span>
          <span style={{ fontSize: F.tiny, color: C.muted }}>{[a.size_bytes && formatBytes(Number(a.size_bytes)), a.duration_s && minutes(Number(a.duration_s))].filter(Boolean).join(' · ')}</span>
          {a.status !== 'READY' && <Badge t="warning" size="sm">{a.status === 'FAILED' ? 'Upload failed' : 'Still uploading'}</Badge>}
        </div>
      ) : <Hint>No file yet.</Hint>}
      {busy && <Uploading pct={pct} hasBytes={started} size={sending.size} since={sending.since} />}
      {busy && rule.kind === 'SCORM' && pct >= 100 && <Hint>Reading the package’s manifest…</Hint>}
      {pkg && <Notice t="positive">SCORM {pkg.version} package “{pkg.title}”, {pkg.files} files. It opens at {pkg.launch.split('?')[0]}. Use Preview to try it before publishing.</Notice>}
      {!b.readOnly && <div><FilePick accept={rule.accept} label={a ? 'Replace file' : 'Choose file'} disabled={busy} onFile={pick} /></div>}
      {!b.readOnly && <Hint>{rule.hint}</Hint>}
      <FileError text={err} />
    </div>
  )
}

function ResourceRow({ r, b }: { r: any; b: BuilderApi }) {
  return (
    <div style={{ ...row(), justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: F.small, fontWeight: W.medium, color: C.ink, wordBreak: 'break-word' }}>{r.title}</div>
        <div style={{ fontSize: F.tiny, color: C.muted, wordBreak: 'break-all' }}>{r.url || `${r.asset?.original_name || 'File'}${r.asset?.size_bytes ? ` · ${formatBytes(Number(r.asset.size_bytes))}` : ''}`}</div>
      </div>
      {!b.readOnly && <Button size="sm" variant="ghost" onClick={() => b.op('resource.remove', { id: r.id })}>Remove</Button>}
    </div>
  )
}

function Resources({ l, b }: { l: any; b: BuilderApi }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const addLink = async () => {
    setErr('')
    if (!/^https:\/\//i.test(url.trim())) { setErr('The link must start with https://.'); return }
    const r = await b.op('resource.add', { lesson_id: l.id, title: title.trim() || url.trim(), url: url.trim() })
    if (r !== false) { setTitle(''); setUrl('') }
  }
  const addFile = async (file: File) => {
    setErr(''); setBusy(true)
    try {
      const asset = await uploadLmsFile(file, { kind: 'DOCUMENT', companyId: b.course.company_id })
      await b.op('resource.add', { lesson_id: l.id, title: title.trim() || file.name, asset_id: asset.id })
      setTitle('')
    } catch (e: any) { setErr(e?.message || 'That file could not be uploaded.') }
    finally { setBusy(false) }
  }
  const list: any[] = l.resources || []
  return (
    <Panel title="Downloads" hint="Handouts and links people can keep. They do not count towards completion. Add a .vtt file to give the video captions.">
      <div style={stack(S.sm)}>
        {list.map(r => <ResourceRow key={r.id} r={r} b={b} />)}
        {!list.length && <Hint>Nothing attached.</Hint>}
        {!b.readOnly && (
          <div style={{ ...stack(S.sm), marginTop: S.xs }}>
            <div style={grid(200)}>
              <Field label="Name"><TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Shown to learners" /></Field>
              <Field label="Link"><TextInput value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></Field>
            </div>
            <div style={row()}>
              <Button size="sm" disabled={!url.trim()} onClick={addLink}>Add link</Button>
              <FilePick accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.vtt,text/vtt" label={busy ? 'Uploading…' : 'Add file'} disabled={busy} onFile={addFile} />
            </div>
            <FileError text={err} />
          </div>
        )}
      </div>
    </Panel>
  )
}

function KindBody({ l, b }: { l: any; b: BuilderApi }) {
  const off = b.readOnly
  const media = l.kind === 'VIDEO' || l.kind === 'AUDIO'
  const timed = ['DOCUMENT', 'SLIDES', 'ARTICLE', 'LINK'].includes(l.kind)
  if (l.kind === 'ASSESSMENT') return null
  if (l.kind === 'LIVE') {
    return (
      <Panel title="Content">
        <div style={stack(S.sm)}>
          <Notice t="info">A live-session lesson completes when the learner attends any webinar linked to this course, or watches 90% of its recording. Schedule the sessions under Live sessions in the Studio and choose this course on each one.</Notice>
          <div><a className="lx-btn lx-btn--sm" {...linkProps(`${to.studio('live')}?course=${encodeURIComponent(b.course.id)}`)}>Open Live sessions</a></div>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title="Content">
      <div style={stack()}>
        {FILE_RULES[l.kind] && <LessonFile l={l} b={b} />}
        {l.kind === 'ARTICLE' && (
          <Field label="Text" hint="Plain text. Line breaks are kept.">
            <EditText multiline rows={12} value={l.body} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, body: v })} />
          </Field>
        )}
        {l.kind === 'LINK' && (
          <Field label="Link" required hint="Must start with https://.">
            <EditText value={l.external_url} disabled={off} placeholder="https://" onSave={v => b.op('lesson.update', { id: l.id, external_url: v.trim() || null })} />
          </Field>
        )}
        {media && (
          <div style={grid(220)}>
            <Field label="Share that must be watched (%)" hint={l.kind === 'AUDIO' ? 'How much must be heard for the lesson to count.' : 'How much must be watched for the lesson to count.'}>
              <EditNumber value={l.media_pct} min={10} max={100} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, media_pct: v ?? 90 })} />
            </Field>
          </div>
        )}
        {media && <Toggle label="Allow skipping ahead" hint="Off means people cannot jump past what they have already watched." checked={l.allow_skip_ahead} disabled={off} onChange={v => b.op('lesson.update', { id: l.id, allow_skip_ahead: v })} />}
        {timed && (
          <div style={{ maxWidth: 260 }}>
            <Field label="Least time to spend (seconds)" hint="Stops someone clicking straight through. 0 means none.">
              <EditNumber value={l.min_seconds} min={0} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, min_seconds: v ?? 0 })} />
            </Field>
          </div>
        )}
      </div>
    </Panel>
  )
}

function Attestation({ l, b }: { l: any; b: BuilderApi }) {
  const off = b.readOnly
  return (
    <div style={stack(S.sm)}>
      <Toggle label="Ask people to confirm they have read this" hint="They tick a statement before the lesson counts as done. The date is kept on record." checked={l.require_ack} disabled={off} onChange={v => b.op('lesson.update', { id: l.id, require_ack: v })} />
      {l.require_ack && (
        <Field label="Statement">
          <EditText multiline rows={2} value={l.ack_text} disabled={off} placeholder="I have read and understood this policy." onSave={v => b.op('lesson.update', { id: l.id, ack_text: v || null })} />
        </Field>
      )}
    </div>
  )
}

function MoveToModule({ l, modules, b }: { l: any; modules: any[]; b: BuilderApi }) {
  if (modules.length < 2 || b.readOnly) return null
  const move = (id: string) => {
    if (id === l.module_id) return undefined
    const ids = b.tree.lessons.filter(x => x.module_id === id).sort((x, y) => x.position - y.position).map(x => x.id)
    return b.op('lesson.reorder', { module_id: id, ids: [...ids, l.id] })
  }
  return (
    <Field label="Module">
      <SaveSelect value={l.module_id} onSave={move}>
        {modules.map((m, i) => <option key={m.id} value={m.id}>{i + 1}. {m.title}</option>)}
      </SaveSelect>
    </Field>
  )
}

export default function LessonEditor({ lesson: l, modules, b, fresh, onDeleted }: { lesson: any; modules: any[]; b: BuilderApi; fresh: boolean; onDeleted: () => void }) {
  const off = b.readOnly
  const quiz = b.tree.quizzes.find(q => q.id === l.quiz_id)
  const del = async () => { if (await b.op('lesson.delete', { id: l.id }) !== false) onDeleted() }
  return (
    <div>
      <Panel title={LESSON_KIND[l.kind]} actions={!off ? <ConfirmButton label="Delete lesson" question="Delete this lesson?" confirm="Delete" onConfirm={del} /> : undefined}>
        <div style={stack()}>
          <Field label="Title" required><EditText autoFocus={fresh} value={l.title} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, title: v || 'Lesson' })} /></Field>
          <Field label="Summary" hint="A line on what this lesson covers."><EditText multiline rows={2} value={l.summary} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, summary: v || null })} /></Field>
          <div style={grid(200)}>
            <Field label="Estimated minutes"><EditNumber value={l.est_minutes} min={1} disabled={off} onSave={v => b.op('lesson.update', { id: l.id, est_minutes: v })} /></Field>
            <MoveToModule l={l} modules={modules} b={b} />
          </div>
          <Toggle label="Required" hint="Required lessons count towards completing the course." checked={l.is_required} disabled={off} onChange={v => b.op('lesson.update', { id: l.id, is_required: v })} />
          {l.kind !== 'ASSESSMENT' && <Toggle label="Free preview" hint="Anyone can open this lesson from the catalogue before enrolling." checked={l.is_preview} disabled={off} onChange={v => b.op('lesson.update', { id: l.id, is_preview: v })} />}
          <Attestation l={l} b={b} />
        </div>
      </Panel>
      <KindBody l={l} b={b} />
      {quiz ? <QuizEditor lesson={l} quiz={quiz} b={b} /> : l.kind === 'ASSESSMENT'
        ? <Notice t="warning">This assessment has lost its quiz. Delete the lesson and add it again.</Notice>
        : (
          <Panel title="Quiz" hint="An optional test on this lesson.">
            {off ? <Hint>No quiz on this lesson.</Hint> : <Button onClick={() => b.op('quiz.attach', { lesson_id: l.id })}>Add a quiz after this lesson</Button>}
          </Panel>
        )}
      {l.kind !== 'ASSESSMENT' && <Resources l={l} b={b} />}
    </div>
  )
}
