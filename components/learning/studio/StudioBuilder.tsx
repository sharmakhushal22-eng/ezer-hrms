'use client'
// components/learning/studio/StudioBuilder.tsx — one course, from first draft to published,
// inside the Studio.
//
// The same data and saving rules as admin/CourseBuilder: what a learner studies belongs to a
// version, which freezes when it goes live, and how the course is described belongs to the
// course and can change at any time. This adds the cover, the steps, the drag-and-drop
// curriculum and the learner's-eye preview around the existing sections.
import { useCallback, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { uploadLmsFile } from '@/lib/lms/upload-client'
import { Notice } from '@/lib/ui'
import { COURSE_STATUS, LoadError, VERSION_STATUS, useLoad, type Ctx } from '../admin/shared'
import { builderOp, useSaver, type BuilderApi, type SaveState } from '../admin/builder-api'
import { ReadOnlyNote } from '../admin/CourseBuilder'
import BuilderDetails from '../admin/BuilderDetails'
import BuilderRules from '../admin/BuilderRules'
import BuilderReach from '../admin/BuilderReach'
import BuilderPublish from '../admin/BuilderPublish'
import { CourseArt, Skel, plural } from '../shared'
import { GArrowLeft } from '../glyphs'
import { GEye, GImage, GRocket } from './icons'
import CurriculumBoard from './CurriculumBoard'
import CoursePreview from './CoursePreview'

type Step = 'details' | 'content' | 'rules' | 'reach' | 'publish'

const ORDER_WORD: Record<string, string> = { SEQUENTIAL: 'One lesson after another', MODULE_SEQUENTIAL: 'Module by module', FREE: 'Any order' }
const REACH_WORD: Record<string, string> = { EVERYONE: 'Everyone can find it', RESTRICTED: 'Some people', HIDDEN: 'Assigned only' }
const ENROL_WORD: Record<string, string> = { SELF: 'self-enrol', APPROVAL: 'with approval', ASSIGN_ONLY: 'assigned by HR' }

function SaveDot({ state }: { state: SaveState }) {
  const text = { idle: 'Saved as you type', saving: 'Saving…', saved: 'All changes saved', error: 'Not saved' }[state]
  return <span className="lx-st-save" data-s={state} role="status"><i />{text}</span>
}

function Cover({ b }: { b: BuilderApi }) {
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const c = b.course
  const pick = async (file?: File | null) => {
    if (!file) return
    setErr(''); setPct(0)
    try {
      const asset = await uploadLmsFile(file, { kind: 'IMAGE', companyId: c.company_id, onProgress: setPct })
      await b.patchCourse({ thumbnail_asset_id: asset.id })
    } catch (e: any) { setErr(e?.message || 'That image could not be uploaded.') }
    finally { setPct(null) }
  }
  return (
    <div>
      <div className="lx-st-cover">
        <CourseArt src={c.thumbnail} id={c.id} title={c.title} />
        {b.canEdit && (
          <label>
            <GImage size={22} />{c.thumbnail ? 'Change cover' : 'Add a cover image'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={pct != null} onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        )}
        {pct != null && <div className="lx-st-cover-pct"><i style={{ width: `${pct}%` }} /></div>}
      </div>
      {err && <div style={{ fontSize: 12, marginTop: 6, color: 'var(--ez-critical-tint)' }}>{err}</div>}
    </div>
  )
}

function Steps({ steps, value, onChange }: { steps: { key: Step; label: string; sub: string; warn?: boolean }[]; value: Step; onChange: (s: Step) => void }) {
  return (
    <nav className="lx-st-steps" aria-label="Course steps">
      {steps.map((s, i) => (
        <button key={s.key} className="lx-st-step" aria-current={s.key === value ? 'step' : undefined} onClick={() => onChange(s.key)}>
          <em>{i + 1}</em>
          <span style={{ minWidth: 0 }}><b>{s.label}</b><small data-t={s.warn ? 'warning' : undefined}>{s.sub}</small></span>
        </button>
      ))}
    </nav>
  )
}

export default function StudioBuilder({ ctx, courseId, onBack, onOpen }: { ctx: Ctx; courseId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('content')
  const [lesson, setLesson] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ start: string | null } | null>(null)
  const load = useLoad<any>(() => lmsApi(`/api/lms/admin/courses/${courseId}${version ? `?version=${version}` : ''}`), [courseId, version])
  const { reload } = load
  const saver = useSaver(reload)
  const { run, flush } = saver

  const d = load.data
  const api: BuilderApi | null = useMemo(() => {
    if (!d) return null
    const canEdit = ctx.caps.editContent
    return {
      ctx, course: d.course, tree: d.tree, canEdit,
      readOnly: !canEdit || d.tree.version.status !== 'DRAFT',
      op: (name, body) => run(() => builderOp(name, body)),
      patchCourse: fields => run(() => lmsApi(`/api/lms/admin/courses/${courseId}`, fields, 'PATCH')),
      patchRules: fields => run(() => lmsApi(`/api/lms/admin/courses/${courseId}`, { version_id: d.tree.version.id, rules: fields }, 'PATCH')),
      run, flush,
    }
  }, [d, ctx, courseId, run, flush])

  const viewVersion = useCallback((id: string | null) => { setLesson(null); setVersion(id) }, [])
  const back = async () => { await flush(); onBack() }

  if (!d || !api) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div><button className="lx-btn lx-btn--sm" onClick={onBack}><GArrowLeft size={15} /> All courses</button></div>
        {load.error ? <LoadError error={load.error} setup={load.setup} /> : <><Skel h={190} r={22} /><Skel h={64} r={16} /><Skel h={360} r={18} /></>}
      </div>
    )
  }

  const v = d.tree.version
  const c = d.course
  const working = d.versions.find((x: any) => x.status === 'DRAFT' || x.status === 'IN_REVIEW')
  const problems: string[] = d.problems || []
  const modules = d.tree.modules.length, lessons = d.tree.lessons.length
  const quizzes = d.tree.lessons.filter((l: any) => l.quiz_id).length
  const steps: { key: Step; label: string; sub: string; warn?: boolean }[] = [
    { key: 'details', label: 'Details', sub: c.summary ? 'Title, cover and skills' : 'Add a summary' , warn: !c.summary },
    { key: 'content', label: 'Content', sub: `${plural(modules, 'module')} · ${plural(lessons, 'lesson')}${quizzes ? ` · ${plural(quizzes, 'quiz', 'quizzes')}` : ''}` },
    { key: 'rules', label: 'Completion rules', sub: ORDER_WORD[v.order_mode] || 'How it is finished' },
    { key: 'reach', label: 'Who can find it', sub: `${REACH_WORD[c.visibility] || ''}${c.enrolment_mode ? `, ${ENROL_WORD[c.enrolment_mode] || ''}` : ''}` },
    { key: 'publish', label: 'Publish', sub: v.status === 'DRAFT' && problems.length ? `${plural(problems.length, 'thing')} to fix` : VERSION_STATUS[v.status]?.label || v.status, warn: v.status === 'DRAFT' && problems.length > 0 },
  ]

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="lx-btn lx-btn--sm" onClick={() => void back()}><GArrowLeft size={15} /> All courses</button>
        {version && <button className="lx-btn lx-btn--sm lx-btn--ghost" onClick={() => viewVersion(null)}>Back to the current version</button>}
      </div>

      <header className="lx-st-bhead lx-in">
        {c.thumbnail && <div className="lx-st-bhead-bg" style={{ backgroundImage: `url("${c.thumbnail}")` }} />}
        <Cover b={api} />
        <div style={{ minWidth: 0 }}>
          <div className="lx-st-kicker">{c.code} · Course</div>
          <h1 style={{ marginTop: 4 }}>{c.title}</h1>
          <div className="lx-st-bhead-meta">
            <span className={`lx-tag ${c.status === 'PUBLISHED' ? 'lx-tag--positive' : c.status === 'ARCHIVED' ? 'lx-tag--warning' : 'lx-tag--glass'}`}>{COURSE_STATUS[c.status]?.label || c.status}</span>
            <span className={`lx-tag ${v.status === 'IN_REVIEW' ? 'lx-tag--warning' : 'lx-tag--glass'}`}>Viewing v{v.version_no}: {VERSION_STATUS[v.status]?.label || v.status}</span>
            {c.publish_at && <span className="lx-tag lx-tag--info">Scheduled</span>}
            {c.is_compliance && <span className="lx-tag lx-tag--info">Compliance</span>}
            <SaveDot state={saver.state} />
          </div>
          <div className="lx-st-bhead-actions">
            <button className="lx-btn lx-btn--light" disabled={!lessons} onClick={() => setPreview({ start: lesson })}><GEye size={16} /> Preview as learner</button>
            {ctx.caps.editContent && <button className="lx-btn lx-btn--white" onClick={() => { void flush(); setStep('publish') }}><GRocket size={16} /> {v.status === 'DRAFT' ? (problems.length ? 'Review and publish' : 'Ready to publish') : 'Versions and publishing'}</button>}
          </div>
        </div>
      </header>

      {saver.state === 'error' && saver.error && <Notice title="That change was not saved">{saver.error}</Notice>}
      {d.tree.version.review_note && v.status === 'DRAFT' && <Notice t="warning" title="Sent back by the reviewer">{d.tree.version.review_note}</Notice>}
      <ReadOnlyNote version={v} canEdit={api.canEdit} working={working} onGo={() => setStep('publish')} />

      <Steps steps={steps} value={step} onChange={s => { void flush(); setStep(s) }} />
      <div className="lx-st-section lx-in" key={step}>
        {step === 'details' && <div className="lx-st-host"><BuilderDetails b={api} /></div>}
        {step === 'content' && <CurriculumBoard b={api} selected={lesson} onSelect={setLesson} onPreview={id => setPreview({ start: id })} />}
        {step === 'rules' && <div className="lx-st-host"><BuilderRules b={api} onPublish={() => setStep('publish')} /></div>}
        {step === 'reach' && (
          <div className="lx-st-host">
            <div className="lx-note" style={{ marginBottom: 16 }}>Self-enrolment is set here, per course: <b>Everyone</b> lets people find it in Explore courses, and the enrolment setting decides whether they can start it themselves, ask their manager, or only get it when HR assigns it.</div>
            <BuilderReach b={api} audience={d.audience} prerequisites={d.prerequisites} />
          </div>
        )}
        {step === 'publish' && (
          <div className="lx-st-host">
            <BuilderPublish b={api} versions={d.versions} problems={problems} settings={d.settings} viewing={version} reload={reload} onView={viewVersion} onOpen={onOpen} />
          </div>
        )}
      </div>

      {preview && <CoursePreview b={{ course: c, tree: d.tree }} startId={preview.start} onClose={() => setPreview(null)} />}
    </>
  )
}
