// lib/lms/me.ts — what a learner sees outside the player. Server only.
import { canSeeCourse, daysUntil, isOverdue, pathLocks, pathProgress } from './core'
import { courseGate } from './engine'
import { thumbnails } from './authoring'
import { LmsError, must, notFound, sb, settingsFor } from './server'
import { notifyPerson } from './notify'
import type { Learner } from './learner'

const OPEN = ['NOT_STARTED', 'IN_PROGRESS', 'FAILED']

async function courseCards(ids: string[]) {
  if (!ids.length) return new Map<string, any>()
  const { data: rows } = await sb.from('lms_courses').select('id, code, title, summary, category_id, difficulty, est_minutes, language, tags, skills, is_compliance, thumbnail_asset_id, status').in('id', [...new Set(ids)])
  const thumbs = await thumbnails((rows || []).map((r: any) => r.thumbnail_asset_id))
  return new Map((rows || []).map((r: any) => [r.id, { ...r, thumbnail: thumbs.get(r.thumbnail_asset_id) || null }]))
}

export async function dashboard(l: Learner, now = Date.now()) {
  const settings = await settingsFor(l.companyId)
  if (!settings.enabled) return { enabled: false }
  const rows = must(await sb.from('lms_enrollments').select('id, course_id, status, mandatory, priority, due_at, progress_pct, score_pct, source, cycle_no, started_at, completed_at, expires_at, last_activity_at, path_enrollment_id, enrolled_at').in('learner_id', l.allIds).order('enrolled_at', { ascending: false }).limit(500)) as any[]
  const cards = await courseCards(rows.map(r => r.course_id))
  const items = rows.filter(r => !['CANCELLED', 'REJECTED'].includes(r.status)).map(r => ({
    ...r, course: cards.get(r.course_id) || null, overdue: isOverdue(r, now), days_left: r.due_at ? daysUntil(r.due_at, now) : null,
  }))
  const open = items.filter(i => OPEN.includes(i.status))
  const byDue = (a: any, b: any) => (a.due_at ? new Date(a.due_at).getTime() : 9e15) - (b.due_at ? new Date(b.due_at).getTime() : 9e15)
  const { data: pes } = await sb.from('lms_path_enrollments').select('id, path_id, status, due_at, progress_pct').in('learner_id', l.allIds).in('status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
  const pathIds = [...new Set((pes || []).map((p: any) => p.path_id))]
  const { data: pathRows } = pathIds.length ? await sb.from('lms_paths').select('id, title, summary, order_mode').in('id', pathIds) : { data: [] as any[] }
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
  const rows = must(await sb.from('lms_courses').select('id, code, title, summary, category_id, difficulty, est_minutes, language, tags, skills, status, visibility, enrolment_mode, is_compliance, is_featured, thumbnail_asset_id').eq('company_id', l.companyId).eq('status', 'PUBLISHED').neq('visibility', 'HIDDEN').limit(1000)) as any[]
  const restricted = rows.filter(r => r.visibility === 'RESTRICTED').map(r => r.id)
  const { data: aud } = restricted.length ? await sb.from('lms_course_audience').select('course_id, kind, value').in('course_id', restricted) : { data: [] as any[] }
  const visible = rows.filter(r => canSeeCourse(r, (aud || []).filter((x: any) => x.course_id === r.id), l.facts!))
  const ids = visible.map(r => r.id)
  const [thumbs, enrols, cats, ratings, peers, paths] = await Promise.all([
    thumbnails(visible.map(r => r.thumbnail_asset_id)),
    ids.length ? sb.from('lms_enrollments').select('id, course_id, status, progress_pct, completed_at, expires_at').in('learner_id', l.allIds).in('course_id', ids).order('enrolled_at', { ascending: false }) : { data: [] },
    sb.from('lms_categories').select('id, name').eq('company_id', l.companyId).eq('is_active', true).order('position'),
    ids.length ? sb.from('lms_feedback').select('course_id, rating').in('course_id', ids) : { data: [] },
    l.facts.department_id && ids.length ? peerCounts(l.companyId, l.facts.department_id, ids) : new Map<string, number>(),
    sb.from('lms_paths').select('id, title, summary, order_mode, enrolment_mode, visibility').eq('company_id', l.companyId).eq('status', 'PUBLISHED').eq('visibility', 'EVERYONE'),
  ])
  const mine = new Map<string, any>()
  for (const e of ((enrols as any).data || []) as any[]) if (!['CANCELLED', 'REJECTED'].includes(e.status) && !mine.has(e.course_id)) mine.set(e.course_id, e)
  const doneSkills = new Set(rows.filter(r => mine.get(r.id)?.status === 'COMPLETED').flatMap(r => r.skills || []))
  const doneCats = new Set(rows.filter(r => mine.get(r.id)?.status === 'COMPLETED').map(r => r.category_id))
  const courses = visible.map(r => {
    const rs = ((ratings as any).data || []).filter((x: any) => x.course_id === r.id).map((x: any) => x.rating)
    // Plain signals rather than a black box: HR's pick, what your department takes, and more of what you finished.
    const score = (r.is_featured ? 3 : 0) + Math.min(3, (peers as Map<string, number>).get(r.id) || 0) + (doneCats.has(r.category_id) && r.category_id ? 1 : 0) + ((r.skills || []).some((s: string) => doneSkills.has(s)) ? 1 : 0)
    return { ...r, thumbnail: thumbs.get(r.thumbnail_asset_id) || null, rating: rs.length ? Math.round((rs.reduce((a: number, b: number) => a + b, 0) / rs.length) * 10) / 10 : null, ratings: rs.length, mine: mine.get(r.id) || null, recommended_score: mine.has(r.id) ? 0 : score }
  })
  return { courses, categories: (cats as any).data || [], recommended: [...courses].filter(c => c.recommended_score > 0).sort((a, b) => b.recommended_score - a.recommended_score).slice(0, 6), paths: (paths as any).data || [] }
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
  const { data: c } = await sb.from('lms_courses').select('*').eq('id', id).eq('company_id', l.companyId).maybeSingle()
  if (!c || !l.facts) throw notFound('That course')
  const { data: aud } = await sb.from('lms_course_audience').select('kind, value').eq('course_id', id)
  const seen = l.kind === 'EMPLOYEE' && canSeeCourse(c, aud || [], l.facts)
  const { data: mine } = await sb.from('lms_enrollments').select('id, status').in('learner_id', l.allIds).eq('course_id', id).not('status', 'in', '(CANCELLED,REJECTED)').order('enrolled_at', { ascending: false }).limit(1).maybeSingle()
  if (!seen && !mine) throw notFound('That course')
  return { c, mine, seen }
}

export async function courseInfo(l: Learner, id: string) {
  const { c, mine } = await visibleCourse(l, id)
  const version = c.published_version_id
  const [{ data: modules }, { data: lessons }, { data: fb }, { data: prereq }] = await Promise.all([
    sb.from('lms_modules').select('id, title, position').eq('version_id', version).order('position'),
    sb.from('lms_lessons').select('id, module_id, title, kind, position, est_minutes, is_preview, quiz_id').eq('version_id', version).order('position'),
    sb.from('lms_feedback').select('rating, comment, created_at').eq('course_id', id).not('comment', 'is', null).order('created_at', { ascending: false }).limit(5),
    sb.from('lms_course_prerequisites').select('requires_course_id').eq('course_id', id),
  ])
  const pre = (prereq || []).map((p: any) => p.requires_course_id)
  const { data: names } = pre.length ? await sb.from('lms_courses').select('id, title').in('id', pre) : { data: [] as any[] }
  const thumbs = await thumbnails([c.thumbnail_asset_id])
  return {
    course: {
      id: c.id, code: c.code, title: c.title, summary: c.summary, description: c.description, difficulty: c.difficulty, est_minutes: c.est_minutes, language: c.language,
      tags: c.tags, skills: c.skills, enrolment_mode: c.enrolment_mode, is_compliance: c.is_compliance, validity_months: c.validity_months, certificate_enabled: c.certificate_enabled, thumbnail: thumbs.get(c.thumbnail_asset_id) || null,
    },
    outline: (modules || []).map((m: any) => ({ ...m, lessons: (lessons || []).filter((x: any) => x.module_id === m.id).map((x: any) => ({ id: x.id, title: x.title, kind: x.kind, est_minutes: x.est_minutes, has_quiz: !!x.quiz_id })) })),
    prerequisites: names || [], reviews: fb || [], mine: mine || null,
  }
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
    if (me?.l1_manager_id) await notifyPerson(me.l1_manager_id, 'LMS_ENROL_REQUEST', 'Course request to approve', `${me.full_name} asked to take ${c.title}.`).catch(() => {})
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
