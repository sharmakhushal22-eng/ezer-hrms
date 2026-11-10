// lib/lms/me.ts — what a learner sees outside the player. Server only.
import { canSeeCourse, daysUntil, isOverdue, pathLocks, pathProgress } from './core'
import { courseGate } from './engine'
import { thumbnails } from './authoring'
import { LmsError, fileUrl, mediaUrl, must, notFound, sb, settingsFor } from './server'
import { notifyPerson } from './notify'
import { pickPreview, topCourses, type PreviewAsset } from './showcase-core'
import type { Learner } from './learner'

const OPEN = ['NOT_STARTED', 'IN_PROGRESS', 'FAILED']

async function courseCards(ids: string[]) {
  if (!ids.length) return new Map<string, any>()
  const { data: rows } = await sb.from('lms_courses').select('id, code, title, summary, category_id, difficulty, est_minutes, language, tags, skills, is_compliance, thumbnail_asset_id, status').in('id', [...new Set(ids)])
  const thumbs = await thumbnails((rows || []).map((r: any) => r.thumbnail_asset_id))
  return new Map((rows || []).map((r: any) => [r.id, { ...r, thumbnail: thumbs.get(r.thumbnail_asset_id) || null }]))
}

export async function dashboard(l: Learner, now = Date.now()) {
  // Two rounds: the settings, enrolments and paths together, then the course cards and path names.
  const [settings, rowsRes, { data: pes }] = await Promise.all([
    settingsFor(l.companyId),
    sb.from('lms_enrollments').select('id, course_id, status, mandatory, priority, due_at, progress_pct, score_pct, source, cycle_no, started_at, completed_at, expires_at, last_activity_at, path_enrollment_id, enrolled_at').in('learner_id', l.allIds).order('enrolled_at', { ascending: false }).limit(500),
    sb.from('lms_path_enrollments').select('id, path_id, status, due_at, progress_pct').in('learner_id', l.allIds).in('status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
  ])
  if (!settings.enabled) return { enabled: false }
  const rows = must(rowsRes) as any[]
  const pathIds = [...new Set((pes || []).map((p: any) => p.path_id))]
  const [cards, { data: pathRows }] = await Promise.all([
    courseCards(rows.map(r => r.course_id)),
    pathIds.length ? sb.from('lms_paths').select('id, title, summary, order_mode').in('id', pathIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const items = rows.filter(r => !['CANCELLED', 'REJECTED'].includes(r.status)).map(r => ({
    ...r, course: cards.get(r.course_id) || null, overdue: isOverdue(r, now), days_left: r.due_at ? daysUntil(r.due_at, now) : null,
  }))
  const open = items.filter(i => OPEN.includes(i.status))
  const byDue = (a: any, b: any) => (a.due_at ? new Date(a.due_at).getTime() : 9e15) - (b.due_at ? new Date(b.due_at).getTime() : 9e15)
  return {
    enabled: true,
    name: l.name, kind: l.kind,
    counts: {
      assigned: open.length, mandatory: open.filter(i => i.mandatory).length, overdue: open.filter(i => i.overdue).length,
      in_progress: open.filter(i => i.status === 'IN_PROGRESS').length, completed: items.filter(i => i.status === 'COMPLETED').length,
    },
    mandatory: open.filter(i => i.mandatory).sort(byDue),
    optional: open.filter(i => !i.mandatory).sort(byDue),
    continue: open.filter(i => i.status === 'IN_PROGRESS').sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at))).slice(0, 4),
    upcoming: open.filter(i => i.due_at && !i.overdue && (i.days_left ?? 99) <= 14).sort(byDue),
    overdue: open.filter(i => i.overdue).sort(byDue),
    completed: items.filter(i => ['COMPLETED', 'EXPIRED', 'WAIVED'].includes(i.status)),
    pending: items.filter(i => i.status === 'PENDING_APPROVAL'),
    paths: (pes || []).map((p: any) => ({ ...p, title: (pathRows || []).find((x: any) => x.id === p.path_id)?.title || 'Path', order_mode: (pathRows || []).find((x: any) => x.id === p.path_id)?.order_mode })),
  }
}

/** The catalogue. Candidates have none: they see what they were given. */
export async function catalogue(l: Learner) {
  if (l.kind === 'CANDIDATE' || !l.facts) return { courses: [], paths: [], categories: [] }
  // Three rounds at most. The first reads what everything else keys on: the published courses,
  // the categories and the paths. The second reads everything about them at once, for every
  // published course; what this person may not see is dropped afterwards, before anything is
  // returned. The third is only for a path naming a course outside that list, which is rare.
  const [rowsRes, cats, paths] = await Promise.all([
    sb.from('lms_courses').select('id, code, title, summary, category_id, difficulty, est_minutes, language, tags, skills, status, visibility, enrolment_mode, is_compliance, is_featured, thumbnail_asset_id, published_version_id, created_at, updated_at').eq('company_id', l.companyId).eq('status', 'PUBLISHED').neq('visibility', 'HIDDEN').limit(1000),
    sb.from('lms_categories').select('id, name').eq('company_id', l.companyId).eq('is_active', true).order('position'),
    sb.from('lms_paths').select('id, title, summary, order_mode, enrolment_mode, visibility').eq('company_id', l.companyId).eq('status', 'PUBLISHED').eq('visibility', 'EVERYONE'),
  ])
  const rows = must(rowsRes) as any[]
  const all = rows.map(r => r.id)
  const restricted = rows.filter(r => r.visibility === 'RESTRICTED').map(r => r.id)
  const versions = rows.map(r => r.published_version_id).filter(Boolean)
  const pathRows = ((paths as any).data || []) as any[]
  const pathIds = pathRows.map(p => p.id)
  const none = Promise.resolve({ data: [] as any[] })
  const [{ data: aud }, thumbs, enrols, ratings, peers, { data: lessonRows }, { data: takers }, { data: versionRows }, { data: pathItems }, { data: minePaths }, { data: moduleRows }, trailerRes, savedRes] = await Promise.all([
    restricted.length ? sb.from('lms_course_audience').select('course_id, kind, value').in('course_id', restricted) : none,
    thumbnails(rows.map(r => r.thumbnail_asset_id)),
    all.length ? sb.from('lms_enrollments').select('id, course_id, status, progress_pct, completed_at, expires_at').in('learner_id', l.allIds).in('course_id', all).order('enrolled_at', { ascending: false }) : none,
    all.length ? sb.from('lms_feedback').select('course_id, rating').in('course_id', all) : none,
    l.facts.department_id && all.length ? peerCounts(l.companyId, l.facts.department_id, all) : Promise.resolve(new Map<string, number>()),
    // What is inside each course and how many have taken it, for the cards: lesson count, the
    // kinds of content, quizzes, and learners. Counts only, never who.
    versions.length ? sb.from('lms_lessons').select('id, version_id, module_id, kind, quiz_id, position, is_preview, asset_id').in('version_id', versions).limit(10000) : none,
    all.length ? sb.from('lms_enrollments').select('course_id, enrolled_at').in('course_id', all).not('status', 'in', '(CANCELLED,REJECTED,PENDING_APPROVAL)').limit(20000) : none,
    versions.length ? sb.from('lms_course_versions').select('id, published_at').in('id', versions) : none,
    pathIds.length ? sb.from('lms_path_items').select('path_id, course_id, position, is_required').in('path_id', pathIds).order('position') : none,
    pathIds.length ? sb.from('lms_path_enrollments').select('path_id, status, progress_pct').in('learner_id', l.allIds).in('path_id', pathIds).in('status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']) : none,
    versions.length ? sb.from('lms_modules').select('id, position').in('version_id', versions).limit(5000) : none,
    // Trailers and My list arrived with migration 227. Until it is run these two reads fail on
    // the missing column or table, and the catalogue simply has no trailers and an empty list.
    all.length ? sb.from('lms_courses').select('id, trailer_asset_id, trailer_start_s, trailer_len_s').in('id', all) : none,
    sb.from('lms_saved').select('course_id, created_at').in('learner_id', l.allIds),
  ])
  const visible = rows.filter(r => canSeeCourse(r, (aud || []).filter((x: any) => x.course_id === r.id), l.facts!))
  const inside = new Map<string, { lessons: number; quizzes: number; kinds: Set<string> }>()
  for (const x of (lessonRows || []) as any[]) {
    const s = inside.get(x.version_id) || { lessons: 0, quizzes: 0, kinds: new Set<string>() }
    s.lessons++; if (x.quiz_id) s.quizzes++; s.kinds.add(x.kind)
    inside.set(x.version_id, s)
  }
  const learners = new Map<string, number>()
  for (const x of (takers || []) as any[]) learners.set(x.course_id, (learners.get(x.course_id) || 0) + 1)
  const publishedAt = new Map(((versionRows || []) as any[]).map(v => [v.id, v.published_at]))

  const titles = new Map(rows.map(r => [r.id, r.title]))
  const outside = [...new Set((pathItems || []).map((i: any) => i.course_id))].filter(id => !titles.has(id as string))
  const mine = new Map<string, any>()
  for (const e of ((enrols as any).data || []) as any[]) if (!['CANCELLED', 'REJECTED'].includes(e.status) && !mine.has(e.course_id)) mine.set(e.course_id, e)

  // What each card plays on hover (lib/lms/showcase-core.ts). The files it might use are read in
  // the same round as the titles a path borrows from outside the catalogue.
  const trailers = new Map((((trailerRes as any).error ? [] : trailerRes.data) || []).map((t: any) => [t.id, t]))
  const modulePos = new Map(((moduleRows || []) as any[]).map(m => [m.id, m.position]))
  const lessonsOf = new Map<string, any[]>()
  for (const x of (lessonRows || []) as any[]) {
    if (x.kind !== 'VIDEO' || !x.asset_id) continue
    const list = lessonsOf.get(x.version_id) || []
    list.push({ ...x, module_position: modulePos.get(x.module_id) ?? 0 })
    lessonsOf.set(x.version_id, list)
  }
  const candidateAssets = [...new Set([
    ...visible.map(r => trailers.get(r.id)?.trailer_asset_id).filter(Boolean),
    ...visible.flatMap(r => (lessonsOf.get(r.published_version_id) || []).map(x => x.asset_id)),
  ])] as string[]
  const [assetRes, outsideRes] = await Promise.all([
    candidateAssets.length ? sb.from('lms_assets').select('id, kind, status, duration_s, storage_path, play_url, play_url_expires_at').in('id', candidateAssets) : none,
    outside.length ? sb.from('lms_courses').select('id, title').in('id', outside) : none,
  ])
  for (const c of (outsideRes.data || []) as any[]) titles.set(c.id, c.title)
  const assetRows = new Map(((assetRes.data || []) as any[]).map(a => [a.id, a]))
  const picks = new Map<string, ReturnType<typeof pickPreview>>()
  for (const r of visible) {
    const t = trailers.get(r.id)
    picks.set(r.id, pickPreview({ enrolment_mode: r.enrolment_mode, ...(t || {}) }, lessonsOf.get(r.published_version_id) || [], assetRows as Map<string, PreviewAsset>, { enrolled: mine.has(r.id) }))
  }
  // One shared, daily-rotated URL per file (mediaUrl), so every learner's preview is the same
  // address and the CDN and the browser cache serve the second view.
  const usedAssets = [...new Set([...picks.values()].filter(Boolean).map(p => p!.asset_id))]
  const urls = new Map(await Promise.all(usedAssets.map(async id => [id, await mediaUrl(assetRows.get(id)!).catch(() => null)] as const)))
  const saved = new Map((((savedRes as any).error ? [] : savedRes.data) || []).map((x: any) => [x.course_id, x.created_at]))
  const doneSkills = new Set(rows.filter(r => mine.get(r.id)?.status === 'COMPLETED').flatMap(r => r.skills || []))
  const doneCats = new Set(rows.filter(r => mine.get(r.id)?.status === 'COMPLETED').map(r => r.category_id))
  const courses = visible.map(r => {
    const rs = ((ratings as any).data || []).filter((x: any) => x.course_id === r.id).map((x: any) => x.rating)
    // Plain signals rather than a black box: HR's pick, what your department takes, and more of what you finished.
    const score = (r.is_featured ? 3 : 0) + Math.min(3, (peers as Map<string, number>).get(r.id) || 0) + (doneCats.has(r.category_id) && r.category_id ? 1 : 0) + ((r.skills || []).some((s: string) => doneSkills.has(s)) ? 1 : 0)
    const s = inside.get(r.published_version_id)
    return {
      ...r, thumbnail: thumbs.get(r.thumbnail_asset_id) || null, rating: rs.length ? Math.round((rs.reduce((a: number, b: number) => a + b, 0) / rs.length) * 10) / 10 : null, ratings: rs.length, mine: mine.get(r.id) || null, recommended_score: mine.has(r.id) ? 0 : score,
      lesson_count: s?.lessons || 0, quiz_count: s?.quizzes || 0, kinds: s ? [...s.kinds] : [], learners: learners.get(r.id) || 0,
      published_at: publishedAt.get(r.published_version_id) || r.updated_at,
      preview: preview(picks.get(r.id), urls),
      saved_at: saved.get(r.id) || null,
    }
  })
  const top = topCourses((takers || []) as any[], new Set(visible.map(r => r.id)))
  return { courses, top, categories: cats.data || [], recommended: [...courses].filter(c => c.recommended_score > 0).sort((a, b) => b.recommended_score - a.recommended_score).slice(0, 6), paths: pathRows.map(p => ({
    ...p,
    mine: (minePaths || []).find((m: any) => m.path_id === p.id) || null,
    courses: (pathItems || []).filter((i: any) => i.path_id === p.id).map((i: any) => ({ id: i.course_id, title: titles.get(i.course_id) || 'Course', is_required: i.is_required })),
  })) }
}

function preview(p: ReturnType<typeof pickPreview> | undefined, urls: Map<string, string | null>) {
  const src = p ? urls.get(p.asset_id) : null
  return p && src ? { src, start: p.start, end: p.end, source: p.source } : null
}

/** Put a course on My list, or take it off. */
export async function setSaved(l: Learner, courseId: string, on: boolean) {
  if (l.kind === 'CANDIDATE') throw new LmsError('My list is for employees.', 403)
  if (on) {
    await visibleCourse(l, courseId)
    const { error } = await sb.from('lms_saved').upsert({ company_id: l.companyId, learner_id: l.id, course_id: courseId }, { onConflict: 'learner_id,course_id', ignoreDuplicates: true })
    if (error) throw error
  } else {
    const { error } = await sb.from('lms_saved').delete().in('learner_id', l.allIds).eq('course_id', courseId)
    if (error) throw error
  }
  return { saved: on }
}

async function peerCounts(company: string, department: string, courseIds: string[]) {
  const { data: learners } = await sb.from('lms_learners').select('id').eq('company_id', company).eq('department_id', department).limit(1000)
  const ids = (learners || []).map((x: any) => x.id)
  const out = new Map<string, number>()
  if (!ids.length) return out
  const { data } = await sb.from('lms_enrollments').select('course_id').in('learner_id', ids).in('course_id', courseIds).limit(5000)
  for (const r of (data || []) as any[]) out.set(r.course_id, (out.get(r.course_id) || 0) + 1)
  return out
}

async function visibleCourse(l: Learner, id: string) {
  // All three at once: the audience and the learner's own enrolment do not depend on the course
  // row, and nothing is returned until all of them say this person may see it.
  const [{ data: c }, { data: aud }, { data: mine }] = await Promise.all([
    sb.from('lms_courses').select('*').eq('id', id).eq('company_id', l.companyId).maybeSingle(),
    sb.from('lms_course_audience').select('kind, value').eq('course_id', id),
    sb.from('lms_enrollments').select('id, status').in('learner_id', l.allIds).eq('course_id', id).not('status', 'in', '(CANCELLED,REJECTED)').order('enrolled_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!c || !l.facts) throw notFound('That course')
  const seen = l.kind === 'EMPLOYEE' && canSeeCourse(c, aud || [], l.facts)
  if (!seen && !mine) throw notFound('That course')
  return { c, mine, seen }
}

export async function courseInfo(l: Learner, id: string) {
  const { c, mine } = await visibleCourse(l, id)
  const version = c.published_version_id
  // Two rounds after the check above. Quizzes are read by version, so they need not wait for
  // the lessons; only question counts and file lengths need the first round's ids.
  const [{ data: modules }, { data: lessons }, { data: fb }, { data: prereq }, { data: rules }, { data: allRatings }, { count: learners }, { data: cat }, { data: quizzes }, thumbs] = await Promise.all([
    sb.from('lms_modules').select('id, title, position').eq('version_id', version).order('position'),
    sb.from('lms_lessons').select('id, module_id, title, kind, position, est_minutes, is_preview, is_required, is_final, quiz_id, quiz_required, require_ack, asset_id').eq('version_id', version).order('position'),
    sb.from('lms_feedback').select('rating, comment, created_at').eq('course_id', id).not('comment', 'is', null).order('created_at', { ascending: false }).limit(5),
    sb.from('lms_course_prerequisites').select('requires_course_id').eq('course_id', id),
    sb.from('lms_course_versions').select('order_mode, completion_mode, completion_pct, require_all_quizzes, require_final, min_overall_pct, published_at').eq('id', version).maybeSingle(),
    sb.from('lms_feedback').select('rating').eq('course_id', id).limit(5000),
    sb.from('lms_enrollments').select('id', { count: 'exact', head: true }).eq('course_id', id).not('status', 'in', '(CANCELLED,REJECTED,PENDING_APPROVAL)'),
    c.category_id ? sb.from('lms_categories').select('name').eq('id', c.category_id).maybeSingle() : Promise.resolve({ data: null as any }),
    sb.from('lms_quizzes').select('id, pass_pct, max_attempts, time_limit_minutes').eq('version_id', version),
    thumbnails([c.thumbnail_asset_id]),
  ])
  const quizIds = ((quizzes || []) as any[]).map(q => q.id)
  const assetIds = [...new Set((lessons || []).map((x: any) => x.asset_id).filter(Boolean))]
  const pre = (prereq || []).map((p: any) => p.requires_course_id)
  const [{ data: qcount }, { data: assets }, { data: names }] = await Promise.all([
    quizIds.length ? sb.from('lms_questions').select('quiz_id').in('quiz_id', quizIds).limit(5000) : Promise.resolve({ data: [] as any[] }),
    assetIds.length ? sb.from('lms_assets').select('id, duration_s').in('id', assetIds) : Promise.resolve({ data: [] as any[] }),
    pre.length ? sb.from('lms_courses').select('id, title').in('id', pre) : Promise.resolve({ data: [] as any[] }),
  ])
  const quizOf = new Map(((quizzes || []) as any[]).map(q => [q.id, { ...q, questions: ((qcount || []) as any[]).filter(x => x.quiz_id === q.id).length }]))
  const lengthOf = new Map(((assets || []) as any[]).map(a => [a.id, a.duration_s != null ? Number(a.duration_s) : null]))
  const rs = ((allRatings || []) as any[]).map(x => Number(x.rating)).filter(Boolean)
  return {
    course: {
      id: c.id, code: c.code, title: c.title, summary: c.summary, description: c.description, difficulty: c.difficulty, est_minutes: c.est_minutes, language: c.language,
      tags: c.tags, skills: c.skills, enrolment_mode: c.enrolment_mode, is_compliance: c.is_compliance, validity_months: c.validity_months, certificate_enabled: c.certificate_enabled, thumbnail: thumbs.get(c.thumbnail_asset_id) || null,
      category: cat?.name || null, learners: learners || 0, published_at: rules?.published_at || c.updated_at,
      rating: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10 : null, ratings: rs.length,
    },
    rules: rules ? { order_mode: rules.order_mode, completion_mode: rules.completion_mode, completion_pct: rules.completion_pct, require_all_quizzes: rules.require_all_quizzes, require_final: rules.require_final, min_overall_pct: rules.min_overall_pct } : null,
    outline: (modules || []).map((m: any) => ({ ...m, lessons: (lessons || []).filter((x: any) => x.module_id === m.id).map((x: any) => {
      const q = x.quiz_id ? quizOf.get(x.quiz_id) : null
      return {
        id: x.id, title: x.title, kind: x.kind, est_minutes: x.est_minutes, has_quiz: !!x.quiz_id, is_preview: !!x.is_preview && x.kind !== 'ASSESSMENT',
        is_required: x.is_required, is_final: x.is_final, require_ack: x.require_ack, duration_s: x.asset_id ? lengthOf.get(x.asset_id) ?? null : null,
        quiz: q ? { pass_pct: q.pass_pct, max_attempts: q.max_attempts, time_limit_minutes: q.time_limit_minutes, questions: q.questions, required: x.quiz_required } : null,
      }
    }) })),
    prerequisites: names || [], reviews: fb || [], mine: mine || null,
  }
}

/** A lesson HR marked as a free preview, opened from the course page before enrolling. Only a
 *  published preview lesson of a course this person may see; nothing is recorded. */
export async function previewLesson(l: Learner, courseId: string, lessonId: string, now = Date.now()) {
  const { c, seen, mine } = await visibleCourse(l, courseId)
  if (!seen && !mine) throw notFound('That course')
  const { data: x } = await sb.from('lms_lessons').select('id, title, summary, kind, is_preview, asset_id, body, external_url').eq('id', lessonId).eq('version_id', c.published_version_id).maybeSingle()
  if (!x || !x.is_preview || x.kind === 'ASSESSMENT') throw notFound('That preview')
  let url: string | null = null, poster: string | null = null, mime: string | null = null, name: string | null = null
  if (x.asset_id) {
    const { data: a } = await sb.from('lms_assets').select('id, kind, storage_path, play_url, play_url_expires_at, poster_path, mime_type, original_name').eq('id', x.asset_id).maybeSingle()
    if (a) {
      url = a.kind === 'VIDEO' || a.kind === 'AUDIO' ? await mediaUrl(a as any, now) : await fileUrl(a.storage_path)
      poster = await fileUrl(a.poster_path)
      mime = a.mime_type; name = a.original_name
    }
  }
  return { id: x.id, title: x.title, summary: x.summary, kind: x.kind, url, poster, mime, file_name: name, body: x.body, external_url: x.external_url }
}

/** Self-enrol, ask for approval, or retake. Being refused says why. */
export async function enrol(l: Learner, courseId: string, now = Date.now()) {
  if (l.kind === 'CANDIDATE') throw new LmsError('Your learning is set by HR for now.', 403)
  const { c, seen } = await visibleCourse(l, courseId)
  if (!seen) throw notFound('That course')
  if (c.enrolment_mode === 'ASSIGN_ONLY') throw new LmsError('This course is assigned by HR.', 403)
  const { data: past } = await sb.from('lms_enrollments').select('id, status, cycle_no, expires_at').eq('learner_id', l.id).eq('course_id', courseId).order('cycle_no', { ascending: false })
  const live = (past || []).find((e: any) => ['PENDING_APPROVAL', 'NOT_STARTED', 'IN_PROGRESS'].includes(e.status))
  if (live) return { id: live.id, status: live.status, already: true }
  const retake = (past || []).length > 0
  const status = c.enrolment_mode === 'APPROVAL' ? 'PENDING_APPROVAL' : 'NOT_STARTED'
  const r = await sb.from('lms_enrollments').insert({
    company_id: l.companyId, learner_id: l.id, course_id: courseId, version_id: c.published_version_id, source: retake ? 'RETAKE' : 'SELF', status,
    cycle_no: ((past || [])[0]?.cycle_no || 0) + 1, notified_at: new Date(now).toISOString(),
  }).select('id, status').single()
  if (r.error?.code === '23505') {
    const { data: e } = await sb.from('lms_enrollments').select('id, status').eq('learner_id', l.id).eq('course_id', courseId).in('status', ['PENDING_APPROVAL', 'NOT_STARTED', 'IN_PROGRESS']).maybeSingle()
    return { id: e?.id, status: e?.status, already: true }
  }
  const made = must(r) as any
  if (status === 'PENDING_APPROVAL' && l.employeeId) {
    const { data: me } = await sb.from('employees').select('l1_manager_id, full_name').eq('id', l.employeeId).maybeSingle()
    if (me?.l1_manager_id) await notifyPerson(me.l1_manager_id, 'LMS_ENROL_REQUEST', 'Course request to approve', `${me.full_name} asked to take ${c.title}.`, '/learning/team').catch(() => {})
  }
  return made
}

export async function enrolPath(l: Learner, pathId: string) {
  if (l.kind === 'CANDIDATE') throw new LmsError('Your learning is set by HR for now.', 403)
  const { data: p } = await sb.from('lms_paths').select('*').eq('id', pathId).eq('company_id', l.companyId).maybeSingle()
  if (!p || p.status !== 'PUBLISHED' || p.visibility !== 'EVERYONE') throw notFound('That path')
  if (p.enrolment_mode !== 'SELF') throw new LmsError('This path is assigned by HR.', 403)
  const r = await sb.from('lms_path_enrollments').insert({ company_id: l.companyId, learner_id: l.id, path_id: pathId }).select('id').single()
  const pe = r.error?.code === '23505'
    ? (await sb.from('lms_path_enrollments').select('id').eq('learner_id', l.id).eq('path_id', pathId).in('status', ['NOT_STARTED', 'IN_PROGRESS']).single()).data
    : must(r) as any
  const { data: items } = await sb.from('lms_path_items').select('course_id').eq('path_id', pathId).order('position')
  for (const it of items || []) {
    const { data: c } = await sb.from('lms_courses').select('published_version_id').eq('id', it.course_id).single()
    if (!c?.published_version_id) continue
    const { data: past } = await sb.from('lms_enrollments').select('status, cycle_no').eq('learner_id', l.id).eq('course_id', it.course_id).order('cycle_no', { ascending: false })
    if ((past || []).some((e: any) => ['PENDING_APPROVAL', 'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'].includes(e.status))) continue
    await sb.from('lms_enrollments').insert({ company_id: l.companyId, learner_id: l.id, course_id: it.course_id, version_id: c.published_version_id, path_enrollment_id: pe!.id, source: 'SELF', cycle_no: ((past || [])[0]?.cycle_no || 0) + 1, notified_at: new Date().toISOString() })
  }
  return { id: pe!.id }
}

export async function achievements(l: Learner) {
  const [{ data: certs }, { data: rows }, { data: attempts }] = await Promise.all([
    sb.from('lms_certificates').select('id, cert_no, verify_code, title, score_pct, issued_at, expires_at, revoked_at, enrollment_id, path_enrollment_id').in('learner_id', l.allIds).order('issued_at', { ascending: false }),
    sb.from('lms_enrollments').select('id, course_id, status, score_pct, completed_at, expires_at, cycle_no, source, mandatory').in('learner_id', l.allIds).in('status', ['COMPLETED', 'EXPIRED', 'FAILED', 'WAIVED']).order('completed_at', { ascending: false, nullsFirst: false }).limit(500),
    sb.from('lms_quiz_attempts').select('id, quiz_id, enrollment_id, attempt_no, pct, passed, submitted_at').in('enrollment_id', (await sb.from('lms_enrollments').select('id').in('learner_id', l.allIds)).data?.map((e: any) => e.id) || ['00000000-0000-0000-0000-000000000000']).neq('status', 'IN_PROGRESS').order('submitted_at', { ascending: false }).limit(200),
  ])
  const cards = await courseCards((rows || []).map((r: any) => r.course_id))
  const qIds = [...new Set((attempts || []).map((a: any) => a.quiz_id))]
  const { data: quizzes } = qIds.length ? await sb.from('lms_quizzes').select('id, title, pass_pct').in('id', qIds) : { data: [] as any[] }
  return {
    certificates: certs || [],
    history: (rows || []).map((r: any) => ({ ...r, title: cards.get(r.course_id)?.title || 'Course', skills: cards.get(r.course_id)?.skills || [] })),
    results: (attempts || []).map((a: any) => ({ ...a, title: (quizzes || []).find((q: any) => q.id === a.quiz_id)?.title || 'Quiz', pass_pct: (quizzes || []).find((q: any) => q.id === a.quiz_id)?.pass_pct })),
    skills: [...new Set((rows || []).filter((r: any) => r.status === 'COMPLETED').flatMap((r: any) => cards.get(r.course_id)?.skills || []))],
  }
}

export { courseGate, pathLocks, pathProgress }
