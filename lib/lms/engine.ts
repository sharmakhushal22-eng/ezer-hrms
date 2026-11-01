// lib/lms/engine.ts — taking a course: what the learner sees, what their actions earn, and
// what happens when they finish. Server only.
//
// The browser reports events; every decision is made here against the stored record. A
// lesson is opened only if it is unlocked, a video counts only as far as the wall clock
// allows, a quiz is graded from the stored key, and a certificate exists only because this
// file found the course complete.
import {
  addMonths, buildPaper, courseState, creditHeartbeat, gradePaper, isOverdue, lessonDone, lessonLocks, learnerPaper,
  mayShowAnswers, orderedLessons, pathLocks, pathProgress, passed as didPass, quizAvailability, watchedEnough,
  type Answer, type LessonLite, type PaperItem, type ProgressLite, type QuestionFull, type QuizLite, type Range, type VersionRules,
} from './core'
import { notFound, fileUrl, LmsError, mediaUrl, must, sb, settingsFor } from './server'
import { issueCertificate } from './certificate'
import { notifyPerson } from './notify'
import type { Learner } from './learner'

const LESSON_COLS = 'id, company_id, version_id, module_id, title, summary, kind, position, is_required, is_final, is_preview, est_minutes, asset_id, external_url, body, media_pct, allow_skip_ahead, min_seconds, require_ack, ack_text, quiz_id, quiz_required'
const PROGRESS_COLS = 'id, lesson_id, status, content_done, watched_ranges, watched_s, duration_s, position_s, last_beat_at, ack_at, quiz_passed, quiz_best_pct, attempts_used, extra_attempts, opened_at, completed_at'

/** Seconds a late submit is still accepted after the limit: the time the request takes. */
const SUBMIT_GRACE_S = 30

export interface VersionTree {
  rules: VersionRules & { id: string; version_no: number; course_id: string }
  modules: any[]
  lessons: any[]
  quizzes: (QuizLite & { title: string; instructions: string | null })[]
}

export async function loadTree(versionId: string): Promise<VersionTree> {
  const [v, modules, lessons, quizzes] = await Promise.all([
    sb.from('lms_course_versions').select('*').eq('id', versionId).single(),
    sb.from('lms_modules').select('id, title, summary, position, unlock_after_days').eq('version_id', versionId).order('position'),
    sb.from('lms_lessons').select(LESSON_COLS).eq('version_id', versionId).order('position'),
    sb.from('lms_quizzes').select('*').eq('version_id', versionId),
  ])
  return { rules: must(v) as any, modules: must(modules) as any[], lessons: must(lessons) as any[], quizzes: must(quizzes) as any[] }
}

async function loadProgress(enrollmentId: string): Promise<any[]> {
  return must(await sb.from('lms_lesson_progress').select(PROGRESS_COLS).eq('enrollment_id', enrollmentId)) as any[]
}

const progressMap = (rows: any[]) => new Map<string, ProgressLite>(rows.map(r => [r.lesson_id, r]))

/** An enrolment of THIS learner. Another person's id reads as not found. */
export async function myEnrollment(l: Learner, enrollmentId: string): Promise<any> {
  const { data } = await sb.from('lms_enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (!data || !l.allIds.includes(data.learner_id)) throw notFound('That course')
  return data
}

function assertOpen(e: any) {
  if (['CANCELLED', 'REJECTED', 'PENDING_APPROVAL', 'WAIVED', 'EXPIRED'].includes(e.status))
    throw new LmsError('This course is not open to you at the moment.', 409)
}

/** What holds a whole course shut: an unfinished prerequisite, or the previous course of a
 *  sequential learning path. Null when it is open. */
export async function courseGate(e: any, allIds: string[]): Promise<string | null> {
  const { data: prereqs } = await sb.from('lms_course_prerequisites').select('requires_course_id').eq('course_id', e.course_id)
  const ids = (prereqs || []).map((p: any) => p.requires_course_id)
  let path: any = null
  if (e.path_enrollment_id) {
    const { data: pe } = await sb.from('lms_path_enrollments').select('path_id').eq('id', e.path_enrollment_id).maybeSingle()
    if (pe) {
      const [{ data: p }, { data: items }] = await Promise.all([
        sb.from('lms_paths').select('order_mode, title').eq('id', pe.path_id).maybeSingle(),
        sb.from('lms_path_items').select('course_id, position, is_required').eq('path_id', pe.path_id),
      ])
      path = { ...p, items: items || [] }
    }
  }
  if (!ids.length && !path) return null

  const wanted = [...new Set([...ids, ...(path?.items || []).map((i: any) => i.course_id)])]
  const { data: done } = await sb.from('lms_enrollments').select('course_id')
    .in('learner_id', allIds).in('course_id', wanted).in('status', ['COMPLETED', 'WAIVED'])
  const completed = new Set((done || []).map((d: any) => d.course_id))

  const missing = ids.filter((id: string) => !completed.has(id))
  if (missing.length) {
    const { data: names } = await sb.from('lms_courses').select('title').in('id', missing)
    return `Finish ${(names || []).map((n: any) => n.title).join(', ')} first.`
  }
  if (path && pathLocks(path.order_mode, path.items, completed).get(e.course_id)) {
    return `The courses before this one in ${path.title} come first.`
  }
  return null
}

function lessonForClient(l: any, lock: { locked: boolean; reason?: string; unlocksAt?: string } | undefined, p: any, quiz: any, last: string | null, now: number) {
  const q = quiz ? quizAvailability(l, quiz, p, last, now) : null
  return {
    id: l.id, module_id: l.module_id, title: l.title, summary: l.summary, kind: l.kind, position: l.position,
    is_required: l.is_required, is_final: l.is_final, est_minutes: l.est_minutes, require_ack: l.require_ack, ack_text: l.ack_text,
    allow_skip_ahead: l.allow_skip_ahead, media_pct: l.media_pct, min_seconds: l.min_seconds,
    locked: !!lock?.locked, lock_reason: lock?.reason || null, unlocks_at: lock?.unlocksAt || null,
    done: lessonDone(l, p), content_done: !!p?.content_done, ack_at: p?.ack_at || null,
    watched_pct: p?.duration_s ? Math.min(100, Math.round((Number(p.watched_s) / Number(p.duration_s)) * 100)) : 0,
    position_s: Number(p?.position_s || 0),
    quiz: quiz ? {
      id: quiz.id, title: quiz.title, instructions: quiz.instructions, pass_pct: quiz.pass_pct, required: l.quiz_required,
      time_limit_minutes: quiz.time_limit_minutes, max_attempts: quiz.max_attempts, gate: q!.gate, attempts_left: q!.attemptsLeft,
      retry_at: q!.retryAt || null, best_pct: p?.quiz_best_pct ?? null, passed: !!p?.quiz_passed, on_exhausted: quiz.on_exhausted,
    } : null,
  }
}

/** Everything the course player draws. No answer key and no file URL: a URL is minted only
 *  when a lesson is actually opened. */
export async function playerView(l: Learner, enrollmentId: string, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  const [tree, progress, attempts, { data: course }, feedback] = await Promise.all([
    loadTree(e.version_id),
    loadProgress(e.id),
    sb.from('lms_quiz_attempts').select('lesson_id, submitted_at').eq('enrollment_id', e.id).neq('status', 'IN_PROGRESS').order('submitted_at', { ascending: false }),
    sb.from('lms_courses').select('id, code, title, summary, description, certificate_enabled').eq('id', e.course_id).single(),
    sb.from('lms_feedback').select('rating, comment').eq('enrollment_id', e.id).maybeSingle(),
  ])
  const pm = progressMap(progress)
  const ordered = orderedLessons(tree.modules, tree.lessons)
  const locks = lessonLocks(tree.rules, tree.modules, tree.lessons, pm, e.started_at || e.enrolled_at, now)
  const quizById = new Map(tree.quizzes.map(q => [q.id, q]))
  const lastByLesson = new Map<string, string>()
  for (const a of (attempts.data || []) as any[]) if (a.submitted_at && !lastByLesson.has(a.lesson_id)) lastByLesson.set(a.lesson_id, a.submitted_at)
  const lessons = ordered.map(x => lessonForClient(x, locks.get(x.id), pm.get(x.id), x.quiz_id ? quizById.get(x.quiz_id) : null, lastByLesson.get(x.id) || null, now))
  const state = courseState(tree.rules, tree.lessons, quizById, pm)
  const { data: cert } = await sb.from('lms_certificates').select('id, cert_no').eq('enrollment_id', e.id).maybeSingle()

  return {
    enrollment: {
      id: e.id, status: e.status, mandatory: e.mandatory, due_at: e.due_at, overdue: isOverdue(e, now), started_at: e.started_at,
      completed_at: e.completed_at, expires_at: e.expires_at, progress_pct: Number(e.progress_pct), score_pct: e.score_pct, cycle_no: e.cycle_no,
      last_lesson_id: e.last_lesson_id,
    },
    course,
    gate: await courseGate(e, l.allIds),
    rules: { order_mode: tree.rules.order_mode, completion_mode: tree.rules.completion_mode, completion_pct: tree.rules.completion_pct, require_final: tree.rules.require_final, min_overall_pct: tree.rules.min_overall_pct, version_no: tree.rules.version_no },
    modules: tree.modules.map(m => ({ id: m.id, title: m.title, summary: m.summary, position: m.position })),
    lessons,
    state: { progress_pct: state.progressPct, done: state.doneCount, total: state.totalCount, score_pct: state.scorePct },
    certificate: cert || null,
    feedback: feedback.data || null,
    read_only: l.readOnly,
  }
}

async function lessonOf(e: any, lessonId: string, tree: VersionTree) {
  const lesson = tree.lessons.find(x => x.id === lessonId)
  if (!lesson) throw notFound('That lesson')
  return lesson
}

/** Refuse anything the learner has not reached. A locked lesson's id is no way in. */
async function assertReachable(l: Learner, e: any, lessonId: string, tree: VersionTree, rows: any[], now: number) {
  const gate = await courseGate(e, l.allIds)
  if (gate) throw new LmsError(gate, 403)
  const lock = lessonLocks(tree.rules, tree.modules, tree.lessons, progressMap(rows), e.started_at || e.enrolled_at, now).get(lessonId)
  if (lock?.locked) throw new LmsError(lock.unlocksAt ? 'This lesson opens later.' : 'Finish the lessons before this one first.', 403)
}

async function touchEnrollment(e: any, lessonId: string, now: number) {
  const at = new Date(now).toISOString()
  const start = e.status === 'NOT_STARTED'
  await sb.from('lms_enrollments').update({
    last_lesson_id: lessonId, last_activity_at: at,
    ...(start ? { status: 'IN_PROGRESS', started_at: at } : {}),
  }).eq('id', e.id)
  if (start && e.path_enrollment_id) {
    await sb.from('lms_path_enrollments').update({ status: 'IN_PROGRESS' }).eq('id', e.path_enrollment_id).eq('status', 'NOT_STARTED')
  }
}

/** Open a lesson: the only place a file URL is handed out. */
export async function openLesson(l: Learner, enrollmentId: string, lessonId: string, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  assertOpen(e)
  const [tree, rows] = await Promise.all([loadTree(e.version_id), loadProgress(e.id)])
  const lesson = await lessonOf(e, lessonId, tree)
  // A finished course stays open for reference, whatever its lock order says.
  if (e.status !== 'COMPLETED') await assertReachable(l, e, lessonId, tree, rows, now)

  let row = rows.find(r => r.lesson_id === lessonId)
  // Someone viewing this portal sees the lesson and leaves no mark on the learner's record.
  if (!l.readOnly) {
    if (!row) {
      const made = await sb.from('lms_lesson_progress').upsert(
        { company_id: e.company_id, enrollment_id: e.id, lesson_id: lessonId, opened_at: new Date(now).toISOString() },
        { onConflict: 'enrollment_id,lesson_id', ignoreDuplicates: true },
      ).select(PROGRESS_COLS)
      row = (made.data || [])[0] || (await loadProgress(e.id)).find(r => r.lesson_id === lessonId)
    }
    await touchEnrollment(e, lessonId, now)
  }

  let url: string | null = null, poster: string | null = null, duration: number | null = null, mime: string | null = null, name: string | null = null
  if (lesson.asset_id) {
    const { data: a } = await sb.from('lms_assets').select('id, kind, storage_path, play_url, play_url_expires_at, poster_path, duration_s, mime_type, original_name, status').eq('id', lesson.asset_id).single()
    if (a) {
      url = a.kind === 'VIDEO' || a.kind === 'AUDIO' ? await mediaUrl(a as any, now) : await fileUrl(a.storage_path)
      poster = await fileUrl(a.poster_path)
      duration = a.duration_s != null ? Number(a.duration_s) : null
      mime = a.mime_type
      name = a.original_name
    }
  }
  const { data: res } = await sb.from('lms_lesson_resources').select('id, title, url, asset_id, position').eq('lesson_id', lessonId).order('position')
  const resources = await Promise.all((res || []).map(async (r: any) => {
    if (r.url) return { id: r.id, title: r.title, url: r.url, external: true }
    const { data: a } = await sb.from('lms_assets').select('storage_path, original_name').eq('id', r.asset_id).maybeSingle()
    return { id: r.id, title: r.title, url: await fileUrl(a?.storage_path, a?.original_name), external: false }
  }))

  return {
    lesson_id: lessonId, url, poster, duration_s: duration, mime, file_name: name,
    body: lesson.body, external_url: lesson.external_url, resources,
    position_s: Number(row?.position_s || 0),
    watched_ranges: (row?.watched_ranges || []) as Range[],
  }
}

/** A player heartbeat. Duration comes from the stored file and the budget from the server's
 *  clock, so nothing in this request can claim more than time has allowed. */
export async function heartbeat(l: Learner, enrollmentId: string, lessonId: string, body: { ranges?: unknown; position?: unknown }, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  assertOpen(e)
  const tree = await loadTree(e.version_id)
  const lesson = await lessonOf(e, lessonId, tree)
  if (lesson.kind !== 'VIDEO' && lesson.kind !== 'AUDIO') throw new LmsError('This lesson has no playback to record.')
  const { data: row } = await sb.from('lms_lesson_progress').select(PROGRESS_COLS).eq('enrollment_id', e.id).eq('lesson_id', lessonId).maybeSingle()
  if (!row) throw new LmsError('Open the lesson first.', 409)
  const { data: asset } = await sb.from('lms_assets').select('duration_s').eq('id', lesson.asset_id).maybeSingle()
  const durationS = Number(asset?.duration_s || 0)

  const claimed = Array.isArray(body.ranges) ? (body.ranges as Range[]).slice(0, 200).map(r => [Number(r?.[0]), Number(r?.[1])] as Range) : []
  const since = row.last_beat_at || row.opened_at
  const elapsedS = (now - new Date(since).getTime()) / 1000
  const credit = creditHeartbeat({ have: (row.watched_ranges || []) as Range[], claimed, durationS, elapsedS })

  const reached = watchedEnough(credit.watchedS, durationS, lesson.media_pct)
  const position = Math.max(0, Math.min(Number(body.position) || 0, durationS || 0))
  const justDone = reached && !row.content_done
  await sb.from('lms_lesson_progress').update({
    watched_ranges: credit.ranges, watched_s: credit.watchedS, duration_s: durationS, position_s: position,
    last_beat_at: new Date(now).toISOString(),
    // Never lowered: once earned it stays earned.
    ...(reached ? { content_done: true } : {}),
  }).eq('id', row.id)

  if (justDone) await recompute(e.id, now)
  else await sb.from('lms_enrollments').update({ last_activity_at: new Date(now).toISOString() }).eq('id', e.id)
  return { watched_s: credit.watchedS, content_done: !!row.content_done || reached, refused_s: credit.refusedS }
}

/** Finish a document, article or link, or give the attestation. The dwell time is measured
 *  from when the server opened the lesson, not from anything the browser says. */
export async function markLesson(l: Learner, enrollmentId: string, lessonId: string, body: { ack?: boolean; done?: boolean }, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  assertOpen(e)
  const [tree, rows] = await Promise.all([loadTree(e.version_id), loadProgress(e.id)])
  const lesson = await lessonOf(e, lessonId, tree)
  await assertReachable(l, e, lessonId, tree, rows, now)
  const row = rows.find(r => r.lesson_id === lessonId)
  if (!row) throw new LmsError('Open the lesson first.', 409)

  const patch: Record<string, unknown> = {}
  if (body.ack && lesson.require_ack && !row.ack_at) patch.ack_at = new Date(now).toISOString()
  if (body.done) {
    if (lesson.kind === 'VIDEO' || lesson.kind === 'AUDIO' || lesson.kind === 'ASSESSMENT')
      throw new LmsError('This lesson completes on its own.')
    const spent = (now - new Date(row.opened_at).getTime()) / 1000
    if (spent < lesson.min_seconds) throw new LmsError(`Spend a little longer on this first: ${Math.ceil(lesson.min_seconds - spent)} seconds to go.`, 409)
    patch.content_done = true
  }
  if (Object.keys(patch).length) must(await sb.from('lms_lesson_progress').update(patch).eq('id', row.id).select('id'))
  return recompute(e.id, now)
}

// ── Quizzes ─────────────────────────────────────────────────────────────────
async function questionsFor(quizId: string): Promise<QuestionFull[]> {
  const rows = must(await sb.from('lms_questions').select('id, kind, prompt, explanation, marks, position, options, accepted, partial_credit').eq('quiz_id', quizId).order('position')) as any[]
  return rows.map(q => ({ ...q, marks: Number(q.marks), options: q.options || [], accepted: q.accepted || [] }))
}

/** A timed attempt left past its limit ends where it stands: the time ran out on it. */
async function expireStale(enrollmentId: string, lessonId: string, now: number) {
  const { data } = await sb.from('lms_quiz_attempts').select('id, expires_at, paper').eq('enrollment_id', enrollmentId).eq('lesson_id', lessonId).eq('status', 'IN_PROGRESS').maybeSingle()
  if (!data?.expires_at) return null
  if (new Date(data.expires_at).getTime() + SUBMIT_GRACE_S * 1000 >= now) return data
  await sb.from('lms_quiz_attempts').update({ status: 'EXPIRED', submitted_at: new Date(now).toISOString(), score: 0, pct: 0, passed: false }).eq('id', data.id)
  // That may have been the last attempt, and HR's report should say so.
  await recompute(enrollmentId, now)
  return null
}

/** Daily: timed attempts somebody walked away from. */
export async function settleAbandonedAttempts(now = Date.now()) {
  const cutoff = new Date(now - SUBMIT_GRACE_S * 1000).toISOString()
  const { data } = await sb.from('lms_quiz_attempts').select('enrollment_id, lesson_id').eq('status', 'IN_PROGRESS').lt('expires_at', cutoff).limit(500)
  for (const a of data || []) await expireStale(a.enrollment_id, a.lesson_id, now)
  return (data || []).length
}

/** Start or resume an attempt. The attempt counts from here rather than from submission:
 *  otherwise a learner could open the paper, read it, abandon it, and retry for free. */
export async function startQuiz(l: Learner, enrollmentId: string, lessonId: string, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  assertOpen(e)
  if (e.status === 'COMPLETED') throw new LmsError('This course is complete.', 409)
  const [tree, rows] = await Promise.all([loadTree(e.version_id), loadProgress(e.id)])
  const lesson = await lessonOf(e, lessonId, tree)
  if (!lesson.quiz_id) throw new LmsError('This lesson has no quiz.')
  await assertReachable(l, e, lessonId, tree, rows, now)
  const quiz = tree.quizzes.find(q => q.id === lesson.quiz_id)!
  const questions = await questionsFor(quiz.id)

  await expireStale(e.id, lessonId, now)
  const { data: open } = await sb.from('lms_quiz_attempts').select('*').eq('enrollment_id', e.id).eq('lesson_id', lessonId).eq('status', 'IN_PROGRESS').maybeSingle()
  if (open) return paperResponse(open, quiz, questions, now)

  const { data: last } = await sb.from('lms_quiz_attempts').select('submitted_at, attempt_no').eq('enrollment_id', e.id).eq('lesson_id', lessonId)
    .order('attempt_no', { ascending: false }).limit(1).maybeSingle()
  let row = rows.find(r => r.lesson_id === lessonId)
  if (!row) {
    const made = await sb.from('lms_lesson_progress').upsert(
      { company_id: e.company_id, enrollment_id: e.id, lesson_id: lessonId, opened_at: new Date(now).toISOString() },
      { onConflict: 'enrollment_id,lesson_id' },
    ).select(PROGRESS_COLS).single()
    row = must(made)
  }
  const gate = quizAvailability(lesson, quiz, row, last?.submitted_at || null, now)
  if (gate.gate === 'WATCH_FIRST') throw new LmsError('Finish the lesson first: the quiz opens after it.', 409)
  if (gate.gate === 'PASSED') throw new LmsError('You have already passed this quiz.', 409)
  if (gate.gate === 'COOLDOWN') throw new LmsError(`You can try again after ${new Date(gate.retryAt!).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}.`, 409)
  if (gate.gate === 'LOCKED') throw new LmsError('No attempts left. HR can grant you another.', 409)

  const paper = buildPaper(quiz, questions)
  const inserted = await sb.from('lms_quiz_attempts').insert({
    company_id: e.company_id, enrollment_id: e.id, lesson_id: lessonId, quiz_id: quiz.id,
    attempt_no: (last?.attempt_no || 0) + 1, paper, started_at: new Date(now).toISOString(),
    expires_at: quiz.time_limit_minutes ? new Date(now + quiz.time_limit_minutes * 60_000).toISOString() : null,
  }).select('*').single()
  // Two tabs racing: the unique index lets one win, and the other resumes it.
  if (inserted.error) {
    const { data: raced } = await sb.from('lms_quiz_attempts').select('*').eq('enrollment_id', e.id).eq('lesson_id', lessonId).eq('status', 'IN_PROGRESS').maybeSingle()
    if (raced) return paperResponse(raced, quiz, questions, now)
    throw new Error(inserted.error.message)
  }
  await sb.from('lms_lesson_progress').update({ attempts_used: (row.attempts_used || 0) + 1 }).eq('id', row.id)
  await touchEnrollment(e, lessonId, now)
  return paperResponse(inserted.data, quiz, questions, now)
}

function paperResponse(a: any, quiz: any, questions: QuestionFull[], now: number) {
  return {
    attempt_id: a.id, attempt_no: a.attempt_no, title: quiz.title, instructions: quiz.instructions, pass_pct: quiz.pass_pct,
    seconds_left: a.expires_at ? Math.max(0, Math.round((new Date(a.expires_at).getTime() - now) / 1000)) : null,
    questions: learnerPaper(a.paper as PaperItem[], questions),
    answers: a.answers || {},
  }
}

export async function submitQuiz(l: Learner, enrollmentId: string, attemptId: string, answers: Record<string, Answer>, now = Date.now()) {
  const e = await myEnrollment(l, enrollmentId)
  assertOpen(e)
  const { data: a } = await sb.from('lms_quiz_attempts').select('*').eq('id', attemptId).eq('enrollment_id', e.id).maybeSingle()
  if (!a) throw notFound('That attempt')
  if (a.status !== 'IN_PROGRESS') throw new LmsError('This attempt has already been submitted.', 409)
  const [tree, questions] = await Promise.all([loadTree(e.version_id), questionsFor(a.quiz_id)])
  const quiz = tree.quizzes.find(q => q.id === a.quiz_id)!
  const lesson = await lessonOf(e, a.lesson_id, tree)

  const late = !!a.expires_at && new Date(a.expires_at).getTime() + SUBMIT_GRACE_S * 1000 < now
  const graded = late ? { score: 0, maxScore: 0, pct: 0, items: [] } : gradePaper(a.paper as PaperItem[], questions, answers || {})
  const ok = !late && didPass(graded.pct, quiz.pass_pct)

  // Conditional on still being open, so a double submit cannot grade twice.
  const upd = must(await sb.from('lms_quiz_attempts').update({
    status: late ? 'EXPIRED' : 'SUBMITTED', answers: answers || {}, score: graded.score, max_score: graded.maxScore,
    pct: graded.pct, passed: ok, submitted_at: new Date(now).toISOString(),
  }).eq('id', a.id).eq('status', 'IN_PROGRESS').select('id')) as any[]
  if (!upd.length) throw new LmsError('This attempt has already been submitted.', 409)

  const { data: row } = await sb.from('lms_lesson_progress').select(PROGRESS_COLS).eq('enrollment_id', e.id).eq('lesson_id', a.lesson_id).single()
  const best = Math.max(Number(row!.quiz_best_pct ?? -1), graded.pct)
  const patch: Record<string, unknown> = { quiz_best_pct: best, quiz_passed: !!row!.quiz_passed || ok }

  const used = row!.attempts_used, cap = quiz.max_attempts == null ? null : quiz.max_attempts + (row!.extra_attempts || 0)
  const exhausted = !ok && !row!.quiz_passed && cap != null && used >= cap
  // REWATCH: out of attempts, so back to the lesson, and watching it again earns them back.
  const sentBack = exhausted && quiz.on_exhausted === 'REWATCH' && lesson.kind !== 'ASSESSMENT'
  if (sentBack) Object.assign(patch, { content_done: false, watched_ranges: [], watched_s: 0, position_s: 0, attempts_used: 0, extra_attempts: 0, last_beat_at: null, opened_at: new Date(now).toISOString() })
  must(await sb.from('lms_lesson_progress').update(patch).eq('id', row!.id).select('id'))

  const after = await recompute(e.id, now)

  const showAnswers = mayShowAnswers(quiz.show_answers, ok)
  const review = showAnswers && !late ? (a.paper as PaperItem[]).flatMap(p => {
    const q = questions.find(x => x.id === p.q)
    if (!q) return []
    const item = graded.items.find(i => i.question_id === q.id)
    return [{
      question_id: q.id, prompt: q.prompt, kind: q.kind, explanation: q.explanation || null,
      correct: !!item?.correct, earned: item?.earned ?? 0, marks: q.marks, your_answer: answers?.[q.id] ?? null,
      options: p.o.flatMap(id => { const o = q.options.find(x => x.id === id); return o ? [{ id: o.id, text: o.text, correct: !!o.correct }] : [] }),
      accepted: q.kind === 'SHORT_TEXT' ? q.accepted : undefined,
    }]
  }) : null

  const left = cap == null ? null : sentBack ? quiz.max_attempts : Math.max(0, cap - used)
  return {
    pct: graded.pct, score: graded.score, max_score: graded.maxScore, passed: ok, late, pass_pct: quiz.pass_pct,
    attempts_left: left, sent_back: sentBack, locked: exhausted && !sentBack,
    cooldown_minutes: quiz.cooldown_minutes, review,
    course: after,
  }
}

// ── Recompute and complete ──────────────────────────────────────────────────
/** Bring one enrolment's stored figures into line with its lesson progress. Safe to run at
 *  any time and any number of times: this is the only writer of the enrolment's status. */
export async function recompute(enrollmentId: string, now = Date.now()) {
  const { data: e } = await sb.from('lms_enrollments').select('*').eq('id', enrollmentId).single()
  if (!e) throw notFound('That enrolment')
  const [tree, rows] = await Promise.all([loadTree(e.version_id), loadProgress(e.id)])
  const pm = progressMap(rows)
  const quizzes = new Map(tree.quizzes.map(q => [q.id, q]))
  const state = courseState(tree.rules, tree.lessons, quizzes, pm)

  const at = new Date(now).toISOString()
  const newly = tree.lessons.filter((x: LessonLite) => {
    const r = rows.find(p => p.lesson_id === x.id)
    return r && r.status !== 'COMPLETED' && lessonDone(x, r)
  }).map(x => x.id)
  if (newly.length) await sb.from('lms_lesson_progress').update({ status: 'COMPLETED', completed_at: at }).eq('enrollment_id', e.id).in('lesson_id', newly)

  const figures = { progress_pct: state.progressPct, score_pct: state.scorePct, last_activity_at: at }
  if (e.status === 'COMPLETED') return { status: 'COMPLETED', ...figures, completed_now: false, certificate: null }

  if (state.complete) {
    const done = await completeEnrollment(e, state, now)
    return { status: 'COMPLETED', ...figures, progress_pct: 100, completed_now: done.first, certificate: done.certificate }
  }
  const status = state.blocked ? 'FAILED' : e.status === 'FAILED' || e.status === 'NOT_STARTED' ? 'IN_PROGRESS' : e.status
  must(await sb.from('lms_enrollments').update({ ...figures, status }).eq('id', e.id).select('id'))
  if (status === 'FAILED' && e.status !== 'FAILED') await notifyFailure(e)
  return { status, ...figures, completed_now: false, certificate: null }
}

async function notifyFailure(e: any) {
  const { data: l } = await sb.from('lms_learners').select('employee_id').eq('id', e.learner_id).maybeSingle()
  const { data: c } = await sb.from('lms_courses').select('title').eq('id', e.course_id).maybeSingle()
  if (l?.employee_id) await notifyPerson(l.employee_id, 'LMS_FAILED', 'Assessment attempts used up', `${c?.title || 'A course'}: ask HR for another attempt.`)
}

async function completeEnrollment(e: any, state: ReturnType<typeof courseState>, now: number) {
  const { data: course } = await sb.from('lms_courses').select('id, title, validity_months, certificate_enabled, is_compliance').eq('id', e.course_id).single()
  const at = new Date(now).toISOString()
  const expires = course?.validity_months ? addMonths(at, course.validity_months) : null

  // Conditional, so two simultaneous events finish a course once.
  const won = must(await sb.from('lms_enrollments').update({
    status: 'COMPLETED', completed_at: at, expires_at: expires, progress_pct: 100, score_pct: state.scorePct, last_activity_at: at,
  }).eq('id', e.id).neq('status', 'COMPLETED').select('id')) as any[]
  if (!won.length) return { first: false, certificate: null }

  const { data: learner } = await sb.from('lms_learners').select('id, employee_id, full_name, company_id').eq('id', e.learner_id).single()
  const settings = await settingsFor(e.company_id)
  let certificate: any = null
  if (course?.certificate_enabled && settings.certificates_enabled) {
    certificate = await issueCertificate({
      companyId: e.company_id, learnerId: e.learner_id, enrollmentId: e.id, recipient: learner!.full_name,
      title: course.title, scorePct: state.scorePct, expiresAt: expires, now,
    }).catch(err => { console.error('[lms] certificate failed', e.id, err?.message); return null })
  }
  if (learner?.employee_id) {
    await syncToProfile(e, learner.employee_id, course, state.scorePct, at, certificate)
    await notifyPerson(learner.employee_id, 'LMS_COMPLETED', 'Course completed', `${course?.title}${certificate ? ': your certificate is ready.' : ''}`)
  }
  await refreshPaths(e.learner_id, e.company_id, now)
  return { first: true, certificate }
}

/** Profile 360 already shows employee_trainings and employee_certifications, so a
 *  completion lands there too rather than HR having a second place to look. */
async function syncToProfile(e: any, employeeId: string, course: any, score: number | null, at: string, cert: any) {
  const day = at.slice(0, 10)
  const a = await sb.from('employee_trainings').insert({
    company_id: e.company_id, employee_id: employeeId, training_name: course.title, category: course.is_compliance ? 'Compliance' : 'Learning',
    status: 'Completed', due_date: e.due_at ? e.due_at.slice(0, 10) : null, completed_on: day, score: score != null ? String(score) : null,
  })
  if (a.error) console.warn('[lms] employee_trainings sync failed', a.error.message)
  if (cert) {
    const b = await sb.from('employee_certifications').insert({
      company_id: e.company_id, employee_id: employeeId, cert_name: course.title, issuer: 'EZER Learn', issued_on: day,
      expires_on: cert.expires_at ? String(cert.expires_at).slice(0, 10) : null, credential_id: cert.cert_no,
    })
    if (b.error) console.warn('[lms] employee_certifications sync failed', b.error.message)
  }
}

/** Every open programme of this learner, brought up to date. */
export async function refreshPaths(learnerId: string, companyId: string, now = Date.now()) {
  const { data: open } = await sb.from('lms_path_enrollments').select('id, path_id, status').eq('learner_id', learnerId).in('status', ['NOT_STARTED', 'IN_PROGRESS'])
  for (const pe of open || []) {
    const [{ data: path }, { data: items }] = await Promise.all([
      sb.from('lms_paths').select('id, title, certificate_enabled').eq('id', pe.path_id).single(),
      sb.from('lms_path_items').select('course_id, position, is_required').eq('path_id', pe.path_id),
    ])
    const ids = (items || []).map((i: any) => i.course_id)
    const { data: done } = await sb.from('lms_enrollments').select('course_id').eq('learner_id', learnerId).in('course_id', ids).in('status', ['COMPLETED', 'WAIVED'])
    const { pct, complete } = pathProgress(items || [], new Set((done || []).map((d: any) => d.course_id)))
    const at = new Date(now).toISOString()
    must(await sb.from('lms_path_enrollments').update({
      progress_pct: pct, ...(complete ? { status: 'COMPLETED', completed_at: at } : pct > 0 ? { status: 'IN_PROGRESS' } : {}),
    }).eq('id', pe.id).select('id'))
    if (complete && path?.certificate_enabled) {
      const settings = await settingsFor(companyId)
      const { data: who } = await sb.from('lms_learners').select('full_name').eq('id', learnerId).single()
      if (settings.certificates_enabled) await issueCertificate({
        companyId, learnerId, pathEnrollmentId: pe.id, recipient: who!.full_name, title: path.title, scorePct: null, expiresAt: null, now,
      }).catch(err => console.error('[lms] path certificate failed', pe.id, err?.message))
    }
  }
}

export async function saveFeedback(l: Learner, enrollmentId: string, rating: number, comment: string | null) {
  const e = await myEnrollment(l, enrollmentId)
  if (e.status !== 'COMPLETED') throw new LmsError('You can rate a course once you have completed it.', 409)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new LmsError('Choose between 1 and 5 stars.')
  must(await sb.from('lms_feedback').upsert(
    { company_id: e.company_id, enrollment_id: e.id, course_id: e.course_id, rating, comment: comment?.trim().slice(0, 2000) || null },
    { onConflict: 'enrollment_id' },
  ).select('id'))
}
