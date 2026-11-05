'use client'
// components/learning/admin/CourseBuilder.tsx — one course, from first draft to published.
//
// A course has two kinds of data. What a learner studies and is assessed on belongs to a
// version, which freezes when it goes live. How the course is described and who can find it
// belongs to the course, and can change at any time. So a published course shows its content
// read-only here while its details stay editable.
import { useCallback, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Badge, Button, C, F, Notice, S, Skeleton, Tabs, W, numeric } from '@/lib/ui'
import { COURSE_STATUS, LoadError, StatusBadge, VERSION_STATUS, row, useLoad, type Ctx } from './shared'
import { builderOp, useSaver, type BuilderApi, type SaveState } from './builder-api'
import BuilderDetails from './BuilderDetails'
import BuilderContent from './BuilderContent'
import BuilderRules from './BuilderRules'
import BuilderReach from './BuilderReach'
import BuilderPublish from './BuilderPublish'

type Section = 'details' | 'content' | 'rules' | 'reach' | 'publish'

function SaveLabel({ state }: { state: SaveState }) {
  const text = { idle: '', saving: 'Saving…', saved: 'All changes saved', error: 'Not saved' }[state]
  if (!text) return null
  return <span role="status" style={{ fontSize: F.tiny, fontWeight: W.medium, color: state === 'error' ? C.critical : C.muted }}>{text}</span>
}

export function ReadOnlyNote({ version, canEdit, working, onGo }: { version: any; canEdit: boolean; working: any; onGo: () => void }) {
  if (version.status === 'IN_REVIEW') {
    return <Notice t="warning" title="This version is out for review">{canEdit ? 'Withdraw it from the Publish section to make changes.' : 'It cannot change while it is being reviewed.'}</Notice>
  }
  if (version.status === 'PUBLISHED' && !working) {
    return (
      <Notice t="info" title={`Version ${version.version_no} is live and cannot change`}
        action={canEdit ? <Button size="sm" onClick={onGo}>Go to Publish</Button> : undefined}>
        People are learning from it, so its content and rules stay as they are. Start a new version to make changes. The title, description and who can find it can still be edited.
      </Notice>
    )
  }
  if (version.status === 'SUPERSEDED') return <Notice t="info" title={`Version ${version.version_no} has been replaced`}>This is a past version, shown for reference. Anyone who completed it keeps their record.</Notice>
  return null
}

export default function CourseBuilder({ ctx, courseId, onBack, onOpen }: { ctx: Ctx; courseId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('details')
  const [lesson, setLesson] = useState<string | null>(null)
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

  if (!d || !api) {
    return (
      <>
        <div style={{ marginBottom: S.md }}><Button size="sm" onClick={onBack}>Back to courses</Button></div>
        {load.error ? <LoadError error={load.error} setup={load.setup} /> : <div style={{ display: 'grid', gap: S.md }}><Skeleton h={60} /><Skeleton h={300} /></div>}
      </>
    )
  }

  const v = d.tree.version
  const working = d.versions.find((x: any) => x.status === 'DRAFT' || x.status === 'IN_REVIEW')
  const problems: string[] = d.problems || []
  const tabs: { key: Section; label: string; count?: number }[] = [
    { key: 'details', label: 'Details' },
    { key: 'content', label: 'Content', count: d.tree.lessons.length },
    { key: 'rules', label: 'Completion rules' },
    { key: 'reach', label: 'Who can find it' },
    { key: 'publish', label: 'Publish', count: v.status === 'DRAFT' && problems.length ? problems.length : undefined },
  ]

  return (
    <>
      <div className="ez-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.lg, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ marginBottom: S.sm }}><Button size="sm" onClick={async () => { await flush(); onBack() }}>Back to courses</Button></div>
          <h1 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, color: C.ink, letterSpacing: '-.02em' }}>{d.course.title}</h1>
          <div style={{ ...row(), marginTop: 6, fontSize: F.small, color: C.muted, ...numeric }}>
            <span>{d.course.code}</span>
            <StatusBadge map={COURSE_STATUS} value={d.course.status} />
            <Badge t={VERSION_STATUS[v.status]?.t || 'neutral'} size="sm">Viewing v{v.version_no}: {VERSION_STATUS[v.status]?.label || v.status}</Badge>
            {d.course.publish_at && <Badge t="info" size="sm">Scheduled</Badge>}
            {version && <button type="button" onClick={() => viewVersion(null)} style={{ border: 'none', background: 'none', padding: 0, color: C.brand, fontSize: F.tiny, fontWeight: W.semi, fontFamily: 'inherit', cursor: 'pointer' }}>Back to the current version</button>}
          </div>
        </div>
        <SaveLabel state={saver.state} />
      </div>

      {saver.state === 'error' && saver.error && <Notice title="That change was not saved">{saver.error}</Notice>}
      {d.tree.version.review_note && v.status === 'DRAFT' && <Notice t="warning" title="Sent back by the reviewer">{d.tree.version.review_note}</Notice>}
      <ReadOnlyNote version={v} canEdit={api.canEdit} working={working} onGo={() => setSection('publish')} />

      <Tabs tabs={tabs} value={section} onChange={setSection} />
      {section === 'details' && <BuilderDetails b={api} />}
      {section === 'content' && <BuilderContent b={api} selected={lesson} onSelect={setLesson} />}
      {section === 'rules' && <BuilderRules b={api} onPublish={() => setSection('publish')} />}
      {section === 'reach' && <BuilderReach b={api} audience={d.audience} prerequisites={d.prerequisites} />}
      {section === 'publish' && (
        <BuilderPublish b={api} versions={d.versions} problems={problems} settings={d.settings} viewing={version}
          reload={reload} onView={viewVersion} onOpen={onOpen} />
      )}
    </>
  )
}
