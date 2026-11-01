// lib/lms/authoring.ts — building, reviewing and publishing courses. Server only.
//
// A live version never changes (a trigger in 206 refuses it), so every structural edit
// lands on a draft. Metadata such as the title lives on the course and may change at any
// time; what a learner studies and is assessed on lives on the version.
import { publishProblems, questionProblem, type PublishLesson, type PublishQuiz, type QuestionFull, type VersionRules } from './core'
import { audit, BUCKET, fileUrls, LmsError, must, notFound, sb, settingsFor, tusEndpoint } from './server'
import { inScope, type LmsActor } from './access'
import { notifyPerson } from './notify'

const KINDS = ['VIDEO', 'AUDIO', 'DOCUMENT', 'SLIDES', 'ARTICLE', 'LINK', 'ASSESSMENT']
const pick = <T extends object>(o: any, keys: (keyof T & string)[]) =>
  Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]])) as Partial<T>

const COURSE_FIELDS = ['title', 'summary', 'description', 'category_id', 'thumbnail_asset_id', 'language', 'difficulty', 'est_minutes', 'tags', 'skills', 'is_featured', 'renew_before_days', 'certificate_enabled'] as const
/** A published course changing who sees it, or its obligations, is a publishing decision. */
const GOVERNED_FIELDS = ['visibility', 'enrolment_mode', 'is_compliance', 'validity_months', 'retire_at'] as const
const RULE_FIELDS = ['order_mode', 'completion_mode', 'completion_pct', 'require_all_quizzes', 'require_final', 'min_overall_pct', 'change_note'] as const

async function nextCode(company: string, table: 'lms_courses' | 'lms_paths', prefix: string): Promise<string> {
  const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('company_id', company)
  return `${prefix}-${String((count || 0) + 1).padStart(4, '0')}`
}

export async function courseOf(a: LmsActor, id: string) {
  const { data } = await sb.from('lms_courses').select('*').eq('id', id).maybeSingle()
  if (!data) throw notFound('That course')
  inScope(a, data.company_id, 'That course')
  return data
}

async function versionOf(a: LmsActor, id: string) {
  const { data } = await sb.from('lms_course_versions').select('*').eq('id', id).maybeSingle()
  if (!data) throw notFound('That version')
  inScope(a, data.company_id, 'That version')
  return data
}

function assertDraft(v: any) {
  if (v.status === 'IN_REVIEW') throw new LmsError('This version is out for review. Withdraw it to make changes.', 409)
  if (v.status !== 'DRAFT') throw new LmsError('A published version cannot change. Start a new version.', 409)
}

export async function listCourses(companies: string[]) {
  const rows = must(await sb.from('lms_courses')
    .select('id, company_id, code, title, summary, category_id, status, visibility, enrolment_mode, is_compliance, is_featured, difficulty, est_minutes, tags, published_version_id, publish_at, retire_at, thumbnail_asset_id, created_by_name, updated_at')
    .in('company_id', companies).order('updated_at', { ascending: false }).limit(1000)) as any[]
  const ids = rows.map(r => r.id)
  const [versions, cats, enrols, thumbs] = await Promise.all([
    ids.length ? sb.from('lms_course_versions').select('id, course_id, version_no, status').in('course_id', ids).in('status', ['DRAFT', 'IN_REVIEW', 'PUBLISHED']) : { data: [] },
    sb.from('lms_categories').select('id, name').in('company_id', companies),
    sb.rpc('lms_course_counts', { p_companies: companies }),
    thumbnails(rows.map(r => r.thumbnail_asset_id)),
  ])
  const cat = new Map(((cats as any).data || []).map((c: any) => [c.id, c.name]))
  const counts = ((enrols as any).data || {}) as Record<string, { enrolled: number; completed: number; overdue: number }>
  return rows.map(r => {
    const vs = ((versions as any).data || []).filter((v: any) => v.course_id === r.id)
    const stats = counts[r.id]
    return {
      ...r, category: cat.get(r.category_id) || null, thumbnail: thumbs.get(r.thumbnail_asset_id) || null,
      draft: vs.find((v: any) => v.status !== 'PUBLISHED') || null, live: vs.find((v: any) => v.status === 'PUBLISHED') || null,
      enrolled: stats?.enrolled || 0, completed: stats?.completed || 0, overdue: stats?.overdue || 0,
    }
  })
}

export async function thumbnails(assetIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(assetIds.filter(Boolean))] as string[]
  const out = new Map<string, string>()
  if (!ids.length) return out
  const { data } = await sb.from('lms_assets').select('id, storage_path').in('id', ids)
  const urls = await fileUrls((data || []).map((a: any) => a.storage_path))
  for (const a of (data || []) as any[]) { const u = urls.get(a.storage_path); if (u) out.set(a.id, u) }
  return out
}

export async function createCourse(a: LmsActor, company: string, body: any) {
  const title = String(body?.title || '').trim()
  if (!title) throw new LmsError('Give the course a title.')
  const s = await settingsFor(company)
  for (let tries = 0; ; tries++) {
    const code = await nextCode(company, 'lms_courses', 'CRS')
    const { data, error } = await sb.from('lms_courses').insert({
      company_id: company, code: tries ? `${code}-${tries}` : code, title,
      ...pick<any>(body, [...COURSE_FIELDS, ...GOVERNED_FIELDS].filter(k => k !== 'title') as any),
      created_by_id: a.employeeId, created_by_name: a.label,
    }).select('*').single()
    if (error?.code === '23505' && tries < 5) continue
    if (error) throw new Error(error.message)
    const version = must(await sb.from('lms_course_versions').insert({ company_id: company, course_id: data.id, version_no: 1 }).select('*').single()) as any
    await audit({ companyId: company, actorId: a.employeeId, actorLabel: a.label, action: 'COURSE_CREATED', entity: 'course', entityId: data.id, detail: { title, code: data.code } })
    return { course: data, version, defaults: { pass_pct: s.default_pass_pct, media_pct: s.default_media_pct, max_attempts: s.default_max_attempts } }
  }
}

/** Everything the builder shows, with quiz keys: this is for authors, behind viewContent. */
export async function courseDetail(a: LmsActor, id: string, versionId?: string | null) {
  const course = await courseOf(a, id)
  const versions = must(await sb.from('lms_course_versions').select('*').eq('course_id', id).order('version_no', { ascending: false })) as any[]
  const working = versions.find(v => v.id === versionId) || versions.find(v => v.status === 'DRAFT' || v.status === 'IN_REVIEW') || versions[0]
  const [modules, lessons, quizzes, audience, prereqs, settings] = await Promise.all([
    sb.from('lms_modules').select('*').eq('version_id', working.id).order('position'),
    sb.from('lms_lessons').select('*').eq('version_id', working.id).order('position'),
    sb.from('lms_quizzes').select('*').eq('version_id', working.id),
    sb.from('lms_course_audience').select('kind, value, label').eq('course_id', id),
    sb.from('lms_course_prerequisites').select('requires_course_id').eq('course_id', id),
    settingsFor(course.company_id),
  ])
  const quizRows = must(quizzes) as any[]
  const quizIds = quizRows.map(q => q.id)
  const lessonRows = must(lessons) as any[]
  const lessonIds = lessonRows.map(l => l.id)
  const [questions, resources] = await Promise.all([
    quizIds.length ? sb.from('lms_questions').select('*').in('quiz_id', quizIds).order('position') : { data: [] },
    lessonIds.length ? sb.from('lms_lesson_resources').select('*').in('lesson_id', lessonIds).order('position') : { data: [] },
  ])
  const assetIds = [...new Set([...lessonRows.map(l => l.asset_id), ...((resources as any).data || []).map((r: any) => r.asset_id), course.thumbnail_asset_id].filter(Boolean))]
  const { data: assets } = assetIds.length
    ? await sb.from('lms_assets').select('id, kind, original_name, mime_type, size_bytes, duration_s, status, poster_path').in('id', assetIds)
    : { data: [] as any[] }
  const assetById = new Map((assets || []).map((x: any) => [x.id, x]))
  const thumbs = await thumbnails([course.thumbnail_asset_id])
  const tree = {
    version: working, modules: must(modules) as any[],
    lessons: lessonRows.map(l => ({ ...l, asset: assetById.get(l.asset_id) || null, resources: ((resources as any).data || []).filter((r: any) => r.lesson_id === l.id).map((r: any) => ({ ...r, asset: assetById.get(r.asset_id) || null })) })),
    quizzes: quizRows.map(q => ({ ...q, questions: ((questions as any).data || []).filter((x: any) => x.quiz_id === q.id) })),
  }
  return {
    course: { ...course, thumbnail: thumbs.get(course.thumbnail_asset_id) || null },
    versions: versions.map(v => ({ id: v.id, version_no: v.version_no, status: v.status, published_at: v.published_at, published_by_name: v.published_by_name, change_note: v.change_note, review_note: v.review_note, submitted_by_name: v.submitted_by_name })),
    tree, audience: must(audience), prerequisites: (must(prereqs) as any[]).map(p => p.requires_course_id),
    problems: await problemsFor(tree),
    settings: { publish_requires_review: settings.publish_requires_review, default_pass_pct: settings.default_pass_pct, default_media_pct: settings.default_media_pct, default_max_attempts: settings.default_max_attempts },
  }
}

async function problemsFor(tree: { version: any; modules: any[]; lessons: any[]; quizzes: any[] }) {
  const lessons: PublishLesson[] = tree.lessons.map(l => ({ ...l, asset_ready: l.asset ? l.asset.status === 'READY' : undefined }))
  const quizzes: PublishQuiz[] = tree.quizzes.map(q => ({ ...q, questions: (q.questions || []).map((x: any) => ({ ...x, marks: Number(x.marks) })) as QuestionFull[] }))
  return publishProblems(tree.version as VersionRules, tree.modules, lessons, quizzes)
}

export async function updateCourse(a: LmsActor, id: string, body: any) {
  const c = await courseOf(a, id)
  const patch: Record<string, unknown> = pick<any>(body, COURSE_FIELDS as any)
  if (patch.title !== undefined && !String(patch.title).trim()) throw new LmsError('A course needs a title.')
  const governed = pick<any>(body, GOVERNED_FIELDS as any)
  if (Object.keys(governed).length) {
    if (c.status === 'PUBLISHED' && !a.caps.publish) throw new LmsError('Changing who a published course reaches needs publish rights.', 403)
    Object.assign(patch, governed)
  }
  if (Object.keys(patch).length) must(await sb.from('lms_courses').update(patch).eq('id', id).select('id'))
  if (Array.isArray(body?.audience)) {
    if (c.status === 'PUBLISHED' && !a.caps.publish) throw new LmsError('Changing who a published course reaches needs publish rights.', 403)
    must(await sb.from('lms_course_audience').delete().eq('course_id', id).select('id'))
    const rows = body.audience.filter((r: any) => r?.kind && r?.value).map((r: any) => ({ company_id: c.company_id, course_id: id, kind: r.kind, value: String(r.value), label: r.label || null }))
    if (rows.length) must(await sb.from('lms_course_audience').insert(rows).select('id'))
  }
  if (Array.isArray(body?.prerequisites)) {
    const ids: string[] = [...new Set<string>(body.prerequisites.map(String))].filter(x => x !== id)
    if (ids.length) {
      const { data: back } = await sb.from('lms_course_prerequisites').select('course_id').eq('requires_course_id', id).in('course_id', ids)
      if (back?.length) throw new LmsError('Those two courses would each require the other.')
    }
    must(await sb.from('lms_course_prerequisites').delete().eq('course_id', id).select('course_id'))
    if (ids.length) must(await sb.from('lms_course_prerequisites').insert(ids.map(r => ({ company_id: c.company_id, course_id: id, requires_course_id: r }))).select('course_id'))
  }
  await audit({ companyId: c.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'COURSE_UPDATED', entity: 'course', entityId: id, detail: { fields: Object.keys(patch) } })
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
async function workingVersion(courseId: string) {
  const { data } = await sb.from('lms_course_versions').select('*').eq('course_id', courseId).in('status', ['DRAFT', 'IN_REVIEW']).maybeSingle()
  return data
}

async function assertPublishable(a: LmsActor, c: any, v: any) {
  const d = await courseDetail(a, c.id, v.id)
  if (d.problems.length) throw Object.assign(new LmsError(`This version cannot go live yet: ${d.problems[0]}`, 422), { problems: d.problems })
}

/** The four-eyes rule, when the company has switched it on. */
async function assertReviewed(a: LmsActor, c: any, v: any) {
  const s = await settingsFor(c.company_id)
  if (!s.publish_requires_review) return
  if (v.status !== 'IN_REVIEW') throw new LmsError('Your company requires a review first. Submit this version for review.', 409)
  if (v.submitted_by_id && a.employeeId && v.submitted_by_id === a.employeeId) throw new LmsError('Someone other than the person who submitted it must publish it.', 403)
}

export async function courseAction(a: LmsActor, id: string, action: string, body: any) {
  const c = await courseOf(a, id)
  const log = (act: string, detail: Record<string, unknown> = {}) =>
    audit({ companyId: c.company_id, actorId: a.employeeId, actorLabel: a.label, action: act, entity: 'course', entityId: id, detail })
  const need = async () => {
    const v = await workingVersion(id)
    if (!v) throw new LmsError('There is no draft to act on.', 409)
    return v
  }

  switch (action) {
    case 'submit_review': {
      const v = await need()
      if (v.status !== 'DRAFT') throw new LmsError('This version is already out for review.', 409)
      await assertPublishable(a, c, v)
      must(await sb.from('lms_course_versions').update({ status: 'IN_REVIEW', submitted_by_id: a.employeeId, submitted_by_name: a.label, submitted_at: new Date().toISOString(), change_note: body?.note ?? v.change_note, review_note: null }).eq('id', v.id).select('id'))
      await log('COURSE_SUBMITTED', { version: v.version_no })
      return { ok: true }
    }
    case 'withdraw_review': {
      const v = await need()
      must(await sb.from('lms_course_versions').update({ status: 'DRAFT' }).eq('id', v.id).select('id'))
      await log('COURSE_WITHDRAWN', { version: v.version_no })
      return { ok: true }
    }
    case 'reject': {
      if (!a.caps.publish) throw new LmsError('Reviewing needs publish rights.', 403)
      const v = await need()
      if (v.status !== 'IN_REVIEW') throw new LmsError('This version is not out for review.', 409)
      const note = String(body?.note || '').trim()
      if (!note) throw new LmsError('Say what needs to change.')
      must(await sb.from('lms_course_versions').update({ status: 'DRAFT', review_note: note, reviewed_by_name: a.label, reviewed_at: new Date().toISOString() }).eq('id', v.id).select('id'))
      if (v.submitted_by_id) await notifyPerson(v.submitted_by_id, 'LMS_COMPLETED', 'Course sent back', `${c.title}: ${note}`, '/dashboard/learning').catch(() => {})
      await log('COURSE_SENT_BACK', { version: v.version_no, note })
      return { ok: true }
    }
    case 'publish': {
      if (!a.caps.publish) throw new LmsError('Publishing needs publish rights.', 403)
      if (c.status === 'ARCHIVED') throw new LmsError('Restore this course before publishing it.', 409)
      const v = await need()
      await assertReviewed(a, c, v)
      await assertPublishable(a, c, v)
      const when = body?.publish_at ? new Date(body.publish_at) : null
      if (when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
        must(await sb.from('lms_courses').update({ publish_at: when.toISOString() }).eq('id', id).select('id'))
        await log('COURSE_SCHEDULED', { version: v.version_no, publish_at: when.toISOString() })
        return { ok: true, scheduled: when.toISOString() }
      }
      const moved = must(await sb.rpc('lms_publish_version', { p_version: v.id, p_by: a.label }))
      let carried = 0
      if (body?.move_in_progress) carried = await moveInProgress(id)
      await log('COURSE_PUBLISHED', { version: v.version_no, not_started_moved: moved, in_progress_moved: carried })
      return { ok: true, moved, carried, version_no: v.version_no }
    }
    case 'unschedule':
      if (!a.caps.publish) throw new LmsError('Publishing needs publish rights.', 403)
      must(await sb.from('lms_courses').update({ publish_at: null }).eq('id', id).select('id'))
      await log('COURSE_UNSCHEDULED')
      return { ok: true }
    case 'new_version': {
      if (await workingVersion(id)) throw new LmsError('A draft already exists. Finish or discard it first.', 409)
      if (!c.published_version_id) throw new LmsError('Publish the course first.', 409)
      const nv = must(await sb.rpc('lms_clone_version', { p_source: c.published_version_id, p_course: id }))
      await log('VERSION_STARTED', { version_id: nv })
      return { ok: true, version_id: nv }
    }
    case 'discard_draft': {
      const v = await need()
      if (!c.published_version_id) throw new LmsError('This is the only version. Archive the course instead.', 409)
      await sb.from('lms_lessons').update({ quiz_id: null }).eq('version_id', v.id)
      must(await sb.from('lms_course_versions').delete().eq('id', v.id).select('id'))
      await log('VERSION_DISCARDED', { version: v.version_no })
      return { ok: true }
    }
    case 'archive': {
      if (!a.caps.publish) throw new LmsError('Archiving needs publish rights.', 403)
      must(await sb.from('lms_courses').update({ status: 'ARCHIVED', archived_at: new Date().toISOString(), publish_at: null }).eq('id', id).select('id'))
      await log('COURSE_ARCHIVED')
      return { ok: true }
    }
    case 'restore': {
      if (!a.caps.publish) throw new LmsError('Restoring needs publish rights.', 403)
      must(await sb.from('lms_courses').update({ status: c.published_version_id ? 'PUBLISHED' : 'DRAFT', archived_at: null, retire_at: null }).eq('id', id).select('id'))
      await log('COURSE_RESTORED')
      return { ok: true }
    }
    case 'move_in_progress': {
      if (!a.caps.publish) throw new LmsError('Moving learners needs publish rights.', 403)
      const n = await moveInProgress(id)
      await log('LEARNERS_MOVED', { count: n })
      return { ok: true, moved: n }
    }
    case 'duplicate':
    case 'copy_to': {
      const target = action === 'copy_to' ? String(body?.company_id || '') : c.company_id
      if (!target) throw new LmsError('Choose the company to copy to.')
      inScope(a, target, 'That company')
      const source = (await workingVersion(id))?.id || c.published_version_id
      if (!source) throw new LmsError('This course has nothing to copy.', 409)
      const made = await createCourse(a, target, { title: `${c.title}${action === 'duplicate' ? ' (copy)' : ''}`, summary: c.summary, description: c.description, language: c.language, difficulty: c.difficulty, est_minutes: c.est_minutes, tags: c.tags, skills: c.skills })
      must(await sb.from('lms_course_versions').delete().eq('id', made.version.id).select('id'))
      const nv = must(await sb.rpc('lms_clone_version', { p_source: source, p_course: made.course.id }))
      await sb.from('lms_course_versions').update({ version_no: 1 }).eq('id', nv as any)
      await log('COURSE_COPIED', { to_company: target, new_course: made.course.id })
      return { ok: true, course_id: made.course.id }
    }
    default:
      throw new LmsError('Unknown action.')
  }
}

async function moveInProgress(courseId: string): Promise<number> {
  const moved = must(await sb.rpc('lms_move_in_progress', { p_course: courseId })) as any[]
  const { recompute } = await import('./engine')
  for (const id of moved || []) await recompute(typeof id === 'string' ? id : Object.values(id)[0] as string).catch(() => {})
  return (moved || []).length
}

export async function saveRules(a: LmsActor, versionId: string, body: any) {
  const v = await versionOf(a, versionId)
  assertDraft(v)
  must(await sb.from('lms_course_versions').update(pick<any>(body, RULE_FIELDS as any)).eq('id', versionId).select('id'))
}

// ── Builder ─────────────────────────────────────────────────────────────────
function normaliseQuestion(body: any) {
  const kind = String(body?.kind || 'SINGLE')
  if (!['SINGLE', 'MULTI', 'TRUE_FALSE', 'SHORT_TEXT'].includes(kind)) throw new LmsError('Unknown question type.')
  let options = Array.isArray(body?.options) ? body.options : []
  if (kind === 'TRUE_FALSE') {
    const truth = options.find((o: any) => o?.correct)?.id === 'false' ? 'false' : 'true'
    options = [{ id: 'true', text: 'True', correct: truth === 'true' }, { id: 'false', text: 'False', correct: truth === 'false' }]
  } else if (kind === 'SHORT_TEXT') {
    options = []
  } else {
    options = options.map((o: any, i: number) => ({ id: String(o?.id || `o${i + 1}`), text: String(o?.text ?? ''), correct: !!o?.correct }))
  }
  const accepted = kind === 'SHORT_TEXT' ? (Array.isArray(body?.accepted) ? body.accepted : []).map((s: any) => String(s)).filter((s: string) => s.trim()) : []
  const marks = Number(body?.marks ?? 1)
  if (!(marks > 0)) throw new LmsError('Marks must be more than zero.')
  return { kind, prompt: String(body?.prompt ?? ''), explanation: body?.explanation || null, marks, options, accepted, partial_credit: kind === 'MULTI' && !!body?.partial_credit }
}

async function nextPosition(table: string, col: string, id: string): Promise<number> {
  const { data } = await sb.from(table).select('position').eq(col, id).order('position', { ascending: false }).limit(1)
  return ((data || [])[0]?.position ?? -1) + 1
}

const LESSON_FIELDS = ['title', 'summary', 'is_required', 'is_final', 'is_preview', 'est_minutes', 'asset_id', 'external_url', 'body', 'media_pct', 'allow_skip_ahead', 'min_seconds', 'require_ack', 'ack_text', 'quiz_required'] as const
const QUIZ_FIELDS = ['title', 'instructions', 'pass_pct', 'max_attempts', 'cooldown_minutes', 'time_limit_minutes', 'shuffle_questions', 'shuffle_options', 'draw_count', 'show_answers', 'on_exhausted'] as const

/** One dispatcher for every small edit the builder makes. Each op finds its version from
 *  the row it touches rather than trusting one sent by the client. */
export async function builderOp(a: LmsActor, op: string, b: any): Promise<any> {
  const version = async (id: string) => { const v = await versionOf(a, id); assertDraft(v); return v }
  const viaModule = async (id: string) => { const { data: m } = await sb.from('lms_modules').select('*').eq('id', id).maybeSingle(); if (!m) throw notFound('That module'); return { m, v: await version(m.version_id) } }
  const viaLesson = async (id: string) => { const { data: l } = await sb.from('lms_lessons').select('*').eq('id', id).maybeSingle(); if (!l) throw notFound('That lesson'); return { l, v: await version(l.version_id) } }
  const viaQuiz = async (id: string) => { const { data: q } = await sb.from('lms_quizzes').select('*').eq('id', id).maybeSingle(); if (!q) throw notFound('That quiz'); return { q, v: await version(q.version_id) } }

  switch (op) {
    case 'module.create': {
      const v = await version(b.version_id)
      return must(await sb.from('lms_modules').insert({ company_id: v.company_id, version_id: v.id, title: String(b.title || 'New module'), summary: b.summary || null, unlock_after_days: b.unlock_after_days ?? null, position: await nextPosition('lms_modules', 'version_id', v.id) }).select('*').single())
    }
    case 'module.update': {
      await viaModule(b.id)
      return must(await sb.from('lms_modules').update(pick<any>(b, ['title', 'summary', 'unlock_after_days'] as any)).eq('id', b.id).select('*').single())
    }
    case 'module.delete': {
      await viaModule(b.id)
      must(await sb.from('lms_modules').delete().eq('id', b.id).select('id'))
      return { ok: true }
    }
    case 'module.reorder': {
      const v = await version(b.version_id)
      await Promise.all((b.ids as string[]).map((id, i) => sb.from('lms_modules').update({ position: i }).eq('id', id).eq('version_id', v.id)))
      return { ok: true }
    }
    case 'lesson.create': {
      const { m, v } = await viaModule(b.module_id)
      if (!KINDS.includes(b.kind)) throw new LmsError('Unknown lesson type.')
      const s = await settingsFor(v.company_id)
      const lesson = must(await sb.from('lms_lessons').insert({
        company_id: v.company_id, version_id: v.id, module_id: m.id, kind: b.kind, title: String(b.title || 'New lesson'),
        media_pct: s.default_media_pct, position: await nextPosition('lms_lessons', 'module_id', m.id),
        ...pick<any>(b, LESSON_FIELDS.filter(k => k !== 'title') as any),
      }).select('*').single()) as any
      if (b.kind === 'ASSESSMENT') return builderOp(a, 'quiz.attach', { lesson_id: lesson.id, title: lesson.title })
      return lesson
    }
    case 'lesson.update': {
      const { l } = await viaLesson(b.id)
      const patch = pick<any>(b, LESSON_FIELDS as any)
      if (patch.is_final && !l.quiz_id) throw new LmsError('Only a lesson with a quiz can be the final assessment.')
      return must(await sb.from('lms_lessons').update(patch).eq('id', b.id).select('*').single())
    }
    case 'lesson.delete': {
      const { l } = await viaLesson(b.id)
      must(await sb.from('lms_lessons').delete().eq('id', b.id).select('id'))
      if (l.quiz_id) await sb.from('lms_quizzes').delete().eq('id', l.quiz_id)
      return { ok: true }
    }
    case 'lesson.reorder': {
      const { v } = await viaModule(b.module_id)
      await Promise.all((b.ids as string[]).map((id, i) => sb.from('lms_lessons').update({ position: i, module_id: b.module_id }).eq('id', id).eq('version_id', v.id)))
      return { ok: true }
    }
    case 'quiz.attach': {
      const { l, v } = await viaLesson(b.lesson_id)
      if (l.quiz_id) return (await sb.from('lms_lessons').select('*').eq('id', l.id).single()).data
      const s = await settingsFor(v.company_id)
      const quiz = must(await sb.from('lms_quizzes').insert({ company_id: v.company_id, version_id: v.id, title: String(b.title || `${l.title}: quiz`), pass_pct: s.default_pass_pct, max_attempts: s.default_max_attempts }).select('*').single()) as any
      return must(await sb.from('lms_lessons').update({ quiz_id: quiz.id }).eq('id', l.id).select('*').single())
    }
    case 'quiz.update': {
      await viaQuiz(b.id)
      return must(await sb.from('lms_quizzes').update(pick<any>(b, QUIZ_FIELDS as any)).eq('id', b.id).select('*').single())
    }
    case 'quiz.detach': {
      const { l } = await viaLesson(b.lesson_id)
      if (l.kind === 'ASSESSMENT') throw new LmsError('An assessment lesson needs its quiz. Delete the lesson instead.')
      await sb.from('lms_lessons').update({ quiz_id: null, is_final: false }).eq('id', l.id)
      if (l.quiz_id) must(await sb.from('lms_quizzes').delete().eq('id', l.quiz_id).select('id'))
      return { ok: true }
    }
    case 'question.create': {
      const { q } = await viaQuiz(b.quiz_id)
      return must(await sb.from('lms_questions').insert({ company_id: q.company_id, quiz_id: q.id, position: await nextPosition('lms_questions', 'quiz_id', q.id), ...normaliseQuestion(b) }).select('*').single())
    }
    case 'question.update': {
      const { data: x } = await sb.from('lms_questions').select('quiz_id').eq('id', b.id).maybeSingle()
      if (!x) throw notFound('That question')
      await viaQuiz(x.quiz_id)
      return must(await sb.from('lms_questions').update(normaliseQuestion(b)).eq('id', b.id).select('*').single())
    }
    case 'question.delete': {
      const { data: x } = await sb.from('lms_questions').select('quiz_id').eq('id', b.id).maybeSingle()
      if (!x) throw notFound('That question')
      await viaQuiz(x.quiz_id)
      must(await sb.from('lms_questions').delete().eq('id', b.id).select('id'))
      return { ok: true }
    }
    case 'question.reorder': {
      const { q } = await viaQuiz(b.quiz_id)
      await Promise.all((b.ids as string[]).map((id, i) => sb.from('lms_questions').update({ position: i }).eq('id', id).eq('quiz_id', q.id)))
      return { ok: true }
    }
    case 'question.import': {
      const { q } = await viaQuiz(b.quiz_id)
      const rows = Array.isArray(b.rows) ? b.rows : []
      if (!rows.length || rows.length > 500) throw new LmsError('Import between 1 and 500 questions at a time.')
      let pos = await nextPosition('lms_questions', 'quiz_id', q.id)
      const clean = rows.map((r: any, i: number) => {
        const n = normaliseQuestion(r)
        const p = questionProblem({ ...n, id: 'x', position: 0 } as QuestionFull)
        if (p) throw new LmsError(`Row ${i + 2}: this question ${p}.`)
        return { company_id: q.company_id, quiz_id: q.id, position: pos++, ...n }
      })
      must(await sb.from('lms_questions').insert(clean).select('id'))
      return { ok: true, imported: clean.length }
    }
    case 'resource.add': {
      const { l } = await viaLesson(b.lesson_id)
      if (!!b.asset_id === !!b.url) throw new LmsError('Attach either a file or a link.')
      if (b.url && !/^https:\/\//i.test(String(b.url))) throw new LmsError('The link must start with https://.')
      return must(await sb.from('lms_lesson_resources').insert({ company_id: l.company_id, lesson_id: l.id, title: String(b.title || 'Resource'), asset_id: b.asset_id || null, url: b.url || null, position: await nextPosition('lms_lesson_resources', 'lesson_id', l.id) }).select('*').single())
    }
    case 'resource.remove': {
      const { data: r } = await sb.from('lms_lesson_resources').select('lesson_id').eq('id', b.id).maybeSingle()
      if (!r) throw notFound('That resource')
      await viaLesson(r.lesson_id)
      must(await sb.from('lms_lesson_resources').delete().eq('id', b.id).select('id'))
      return { ok: true }
    }
    default:
      throw new LmsError('Unknown builder operation.')
  }
}

// ── Files ───────────────────────────────────────────────────────────────────
const LIMITS: Record<string, { mimes: RegExp; maxBytes: number }> = {
  VIDEO:    { mimes: /^video\/mp4$/, maxBytes: 2 * 1024 ** 3 },
  AUDIO:    { mimes: /^audio\/(mpeg|mp4|wav|x-wav|webm)$/, maxBytes: 300 * 1024 ** 2 },
  DOCUMENT: { mimes: /^(application\/pdf|application\/vnd\.|application\/msword|application\/zip|text\/(csv|plain))/, maxBytes: 100 * 1024 ** 2 },
  IMAGE:    { mimes: /^image\/(jpeg|png|webp)$/, maxBytes: 5 * 1024 ** 2 },
}
const safeName = (s: string) => s.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file'

/** Start an upload. The browser sends the file straight to storage: a video could never fit
 *  through a serverless request, whose body is capped at 4.5 MB. */
export async function beginUpload(a: LmsActor, company: string, body: any) {
  const kind = String(body?.kind || '')
  const rule = LIMITS[kind]
  if (!rule) throw new LmsError('Unknown file type.')
  const mime = String(body?.mime || ''), size = Number(body?.size || 0), name = String(body?.name || 'file')
  if (!rule.mimes.test(mime)) throw new LmsError(kind === 'VIDEO' ? 'Videos must be MP4 (H.264 video, AAC audio).' : `That file type is not accepted here (${mime || 'unknown'}).`)
  if (!(size > 0) || size > rule.maxBytes) throw new LmsError(`That file is too large. The limit is ${Math.round(rule.maxBytes / 1024 ** 2)} MB.`)

  const id = crypto.randomUUID()
  const path = `${company}/${id}/${safeName(name)}`
  must(await sb.from('lms_assets').insert({ id, company_id: company, kind, storage_path: path, original_name: name.slice(0, 200), mime_type: mime, size_bytes: size, duration_s: body?.duration_s ?? null, created_by_id: a.employeeId, created_by_name: a.label }).select('id'))
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new Error(error?.message || 'Could not start the upload')
  let poster: { path: string; token: string } | null = null
  if (kind === 'VIDEO') {
    const pp = `${company}/${id}/poster.jpg`
    const up = await sb.storage.from(BUCKET).createSignedUploadUrl(pp)
    if (up.data) poster = { path: pp, token: up.data.token }
  }
  return { asset_id: id, bucket: BUCKET, path, token: data.token, tus_endpoint: tusEndpoint(), poster }
}

/** The browser says it finished, and this checks: the object must really be there. */
export async function finishUpload(a: LmsActor, assetId: string, body: any) {
  const { data: x } = await sb.from('lms_assets').select('*').eq('id', assetId).maybeSingle()
  if (!x) throw notFound('That file')
  inScope(a, x.company_id, 'That file')
  if (body?.failed) {
    must(await sb.from('lms_assets').update({ status: 'FAILED' }).eq('id', assetId).select('id'))
    return { status: 'FAILED' }
  }
  const dir = String(x.storage_path).split('/').slice(0, -1).join('/')
  const name = String(x.storage_path).split('/').pop()!
  const { data: files } = await sb.storage.from(BUCKET).list(dir)
  if (!(files || []).some((f: any) => f.name === name)) throw new LmsError('The upload has not arrived in storage yet.', 409)
  const patch: Record<string, unknown> = { status: 'READY' }
  if (body?.duration_s != null && Number(body.duration_s) > 0) patch.duration_s = Number(body.duration_s)
  if (body?.poster_path && String(body.poster_path).startsWith(`${dir}/`)) patch.poster_path = body.poster_path
  return must(await sb.from('lms_assets').update(patch).eq('id', assetId).select('id, kind, original_name, mime_type, size_bytes, duration_s, status').single())
}

export async function listAssets(companies: string[], kind?: string | null) {
  let q = sb.from('lms_assets').select('id, company_id, kind, original_name, mime_type, size_bytes, duration_s, status, created_by_name, created_at').in('company_id', companies).eq('status', 'READY').order('created_at', { ascending: false }).limit(300)
  if (kind) q = q.eq('kind', kind)
  return must(await q)
}

// ── Categories ──────────────────────────────────────────────────────────────
export async function listCategories(companies: string[]) {
  return must(await sb.from('lms_categories').select('*').in('company_id', companies).order('position').order('name'))
}

export async function saveCategory(a: LmsActor, company: string, b: any) {
  const name = String(b?.name || '').trim()
  if (!name) throw new LmsError('Name the category.')
  if (b?.id) {
    const { data } = await sb.from('lms_categories').select('company_id').eq('id', b.id).maybeSingle()
    if (!data) throw notFound('That category')
    inScope(a, data.company_id, 'That category')
    return must(await sb.from('lms_categories').update({ name, description: b.description ?? null, is_active: b.is_active ?? true }).eq('id', b.id).select('*').single())
  }
  const r = await sb.from('lms_categories').insert({ company_id: company, name, description: b.description ?? null }).select('*').single()
  if (r.error?.code === '23505') throw new LmsError('A category with that name already exists.', 409)
  return must(r)
}

// ── Learning paths ──────────────────────────────────────────────────────────
export async function listPaths(companies: string[]) {
  const paths = must(await sb.from('lms_paths').select('*').in('company_id', companies).order('updated_at', { ascending: false })) as any[]
  const ids = paths.map(p => p.id)
  const { data: items } = ids.length
    ? await sb.from('lms_path_items').select('path_id, course_id, position, is_required').in('path_id', ids).order('position')
    : { data: [] as any[] }
  const courseIds = [...new Set((items || []).map((i: any) => i.course_id))]
  const { data: courses } = courseIds.length ? await sb.from('lms_courses').select('id, title, status').in('id', courseIds) : { data: [] as any[] }
  const by = new Map((courses || []).map((c: any) => [c.id, c]))
  return paths.map(p => ({ ...p, items: (items || []).filter((i: any) => i.path_id === p.id).map((i: any) => ({ ...i, title: (by.get(i.course_id) as any)?.title, course_status: (by.get(i.course_id) as any)?.status })) }))
}

export async function savePath(a: LmsActor, company: string, b: any) {
  const title = String(b?.title || '').trim()
  if (!title) throw new LmsError('Give the path a title.')
  const fields = { title, summary: b?.summary ?? null, category_id: b?.category_id || null, order_mode: b?.order_mode || 'SEQUENTIAL', visibility: b?.visibility || 'EVERYONE', enrolment_mode: b?.enrolment_mode || 'ASSIGN_ONLY', certificate_enabled: b?.certificate_enabled ?? true }
  let id = b?.id as string | undefined
  let co = company
  if (id) {
    const { data } = await sb.from('lms_paths').select('company_id').eq('id', id).maybeSingle()
    if (!data) throw notFound('That path')
    inScope(a, data.company_id, 'That path')
    co = data.company_id
    must(await sb.from('lms_paths').update(fields).eq('id', id).select('id'))
  } else {
    const code = await nextCode(company, 'lms_paths', 'PTH')
    const made = must(await sb.from('lms_paths').insert({ company_id: company, code, created_by_name: a.label, ...fields }).select('id').single()) as any
    id = made.id
  }
  if (Array.isArray(b?.items)) {
    must(await sb.from('lms_path_items').delete().eq('path_id', id!).select('id'))
    const rows = b.items.map((it: any, i: number) => ({ company_id: co, path_id: id, course_id: it.course_id, position: i, is_required: it.is_required ?? true }))
    if (rows.length) must(await sb.from('lms_path_items').insert(rows).select('id'))
  }
  await audit({ companyId: co, actorId: a.employeeId, actorLabel: a.label, action: b?.id ? 'PATH_UPDATED' : 'PATH_CREATED', entity: 'path', entityId: id! })
  return { id }
}

export async function pathAction(a: LmsActor, id: string, action: string) {
  const { data: p } = await sb.from('lms_paths').select('*').eq('id', id).maybeSingle()
  if (!p) throw notFound('That path')
  inScope(a, p.company_id, 'That path')
  if (action === 'publish') {
    const { data: items } = await sb.from('lms_path_items').select('course_id').eq('path_id', id)
    if (!items?.length) throw new LmsError('Add at least one course.')
    const { data: cs } = await sb.from('lms_courses').select('title, status').in('id', items.map((i: any) => i.course_id))
    const off = (cs || []).filter((c: any) => c.status !== 'PUBLISHED')
    if (off.length) throw new LmsError(`Publish these first: ${off.map((c: any) => c.title).join(', ')}.`, 409)
  } else if (action !== 'archive') throw new LmsError('Unknown action.')
  must(await sb.from('lms_paths').update({ status: action === 'publish' ? 'PUBLISHED' : 'ARCHIVED' }).eq('id', id).select('id'))
  await audit({ companyId: p.company_id, actorId: a.employeeId, actorLabel: a.label, action: action === 'publish' ? 'PATH_PUBLISHED' : 'PATH_ARCHIVED', entity: 'path', entityId: id })
  return { ok: true }
}
