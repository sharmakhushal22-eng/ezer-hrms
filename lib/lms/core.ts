// lib/lms/core.ts — the rules of EZER Learn, as pure functions.
//
// No database, no React, no clock of its own: everything is passed in, so each rule can be
// unit-tested and the admin preview, the player and the API all answer the same way.
//
// Rules a person experiences live here: what unlocks, what counts as watched, what a quiz
// scores, when a course is complete. Work across thousands of rows lives in SQL
// (migration 207), and the two meet only at the tables.

// ── Shapes ──────────────────────────────────────────────────────────────────
export type LessonKind = 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'SLIDES' | 'ARTICLE' | 'LINK' | 'ASSESSMENT' | 'SCORM' | 'LIVE'
export type QuestionKind = 'SINGLE' | 'MULTI' | 'TRUE_FALSE' | 'SHORT_TEXT'
export type OrderMode = 'SEQUENTIAL' | 'MODULE_SEQUENTIAL' | 'FREE'
export type CompletionMode = 'ALL_REQUIRED' | 'PERCENT' | 'FINAL_ONLY'
export type Range = [number, number]

export interface VersionRules {
  order_mode: OrderMode
  completion_mode: CompletionMode
  completion_pct: number
  require_all_quizzes: boolean
  require_final: boolean
  min_overall_pct: number | null
}

export interface ModuleLite { id: string; position: number; unlock_after_days: number | null }

export interface LessonLite {
  id: string
  module_id: string
  kind: LessonKind
  position: number
  is_required: boolean
  is_final: boolean
  quiz_id: string | null
  quiz_required: boolean
  media_pct: number
  min_seconds: number
  require_ack: boolean
}

export interface ProgressLite {
  lesson_id: string
  status?: string
  content_done: boolean
  quiz_passed: boolean
  quiz_best_pct: number | null
  ack_at: string | null
  attempts_used: number
  extra_attempts: number
}

export interface QuizLite {
  id: string
  pass_pct: number
  max_attempts: number | null
  cooldown_minutes: number
  time_limit_minutes: number | null
  shuffle_questions: boolean
  shuffle_options: boolean
  draw_count: number | null
  show_answers: 'NEVER' | 'AFTER_SUBMIT' | 'AFTER_PASS'
  on_exhausted: 'LOCK' | 'REWATCH'
}

export interface QuestionOption { id: string; text: string; correct?: boolean }

export interface QuestionFull {
  id: string
  kind: QuestionKind
  prompt: string
  explanation?: string | null
  marks: number
  position: number
  options: QuestionOption[]
  accepted: string[]
  partial_credit: boolean
}

// ── Lesson order ────────────────────────────────────────────────────────────
/** Lessons in the order a learner meets them: by module position, then lesson position. */
export function orderedLessons<L extends LessonLite>(modules: ModuleLite[], lessons: L[]): L[] {
  const rank = new Map([...modules].sort((a, b) => a.position - b.position).map((m, i) => [m.id, i]))
  return [...lessons].sort((a, b) =>
    (rank.get(a.module_id) ?? 1e9) - (rank.get(b.module_id) ?? 1e9) || a.position - b.position)
}

// ── Watch credit ────────────────────────────────────────────────────────────
// The browser reports which seconds it played; the server decides what to believe. The
// credit is capped by wall-clock time, so a forged heartbeat gains nothing on the honest
// route: finishing a ten-minute video at the 2× cap always takes at least five minutes.
// Parallel tabs share the one budget because it hangs off the single progress row.

export const MAX_PLAYBACK_RATE = 2
/** Free allowance per beat, for timer jitter. */
export const HEARTBEAT_SLACK_S = 5

/** Sorted, non-overlapping ranges. Gaps under a second close: seek rounding, not a skip. */
export function mergeRanges(ranges: Range[]): Range[] {
  const clean = ranges
    .filter(r => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
    .map(r => [Math.max(0, r[0]), r[1]] as Range)
    .sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of clean) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export const rangesLength = (ranges: Range[]): number =>
  ranges.reduce((a, [s, e]) => a + (e - s), 0)

/** The parts of `claimed` that `have` does not already cover. */
export function newSegments(have: Range[], claimed: Range[]): Range[] {
  const out: Range[] = []
  for (const [start, end] of mergeRanges(claimed)) {
    let cursor = start
    for (const [s, e] of have) {
      if (e <= cursor) continue
      if (s >= end) break
      if (s > cursor) out.push([cursor, s])
      cursor = Math.max(cursor, e)
    }
    if (cursor < end) out.push([cursor, end])
  }
  return out
}

export interface CreditInput {
  have: Range[]
  claimed: Range[]
  durationS: number
  /** Seconds since the previous beat was accepted, on the server's clock. */
  elapsedS: number
  maxRate?: number
  slackS?: number
}

/** What a heartbeat earns. New seconds are credited earliest first, up to the budget. */
export function creditHeartbeat(i: CreditInput): { ranges: Range[]; watchedS: number; creditedS: number; refusedS: number } {
  const maxRate = i.maxRate ?? MAX_PLAYBACK_RATE
  const slack = i.slackS ?? HEARTBEAT_SLACK_S
  const have = mergeRanges(i.have)
  const dur = Math.max(0, i.durationS)
  const inBounds = i.claimed
    .map(r => [Math.min(r[0], dur), Math.min(r[1], dur)] as Range)
    .filter(r => r[1] > r[0])

  let budget = Math.max(0, i.elapsedS) * maxRate + slack
  const granted: Range[] = []
  let claimedNew = 0
  for (const [s, e] of newSegments(have, inBounds)) {
    const len = e - s
    claimedNew += len
    if (budget <= 0) continue
    const take = Math.min(len, budget)
    granted.push([s, s + take])
    budget -= take
  }
  const ranges = mergeRanges([...have, ...granted])
  const creditedS = rangesLength(granted)
  return { ranges, watchedS: Math.min(rangesLength(ranges), dur), creditedS, refusedS: Math.max(0, claimedNew - creditedS) }
}

export const watchedEnough = (watchedS: number, durationS: number | null | undefined, pct: number): boolean =>
  !!durationS && durationS > 0 && (watchedS / durationS) * 100 >= pct

// ── Is a lesson done? ───────────────────────────────────────────────────────
const blank = (lessonId: string): ProgressLite =>
  ({ lesson_id: lessonId, content_done: false, quiz_passed: false, quiz_best_pct: null, ack_at: null, attempts_used: 0, extra_attempts: 0 })

export function lessonDone(l: LessonLite, p: ProgressLite | undefined): boolean {
  const q = p || blank(l.id)
  if (l.kind !== 'ASSESSMENT' && !q.content_done) return false
  if (l.require_ack && !q.ack_at) return false
  if (l.quiz_id) {
    if (l.quiz_required && !q.quiz_passed) return false
    // An optional assessment still has to be sat: it is the whole lesson.
    if (!l.quiz_required && l.kind === 'ASSESSMENT' && q.attempts_used < 1) return false
  }
  return true
}

// ── Locks ───────────────────────────────────────────────────────────────────
export type LockReason = 'PREVIOUS_LESSON' | 'PREVIOUS_MODULE' | 'DRIP' | 'FINAL_LAST'
export interface LessonLock { locked: boolean; reason?: LockReason; unlocksAt?: string }

const DAY_MS = 86_400_000

/**
 * What a learner may open now. Drip applies in every mode. The final assessment waits for
 * everything else in every mode except FINAL_ONLY, where testing out is the point.
 */
export function lessonLocks(
  rules: Pick<VersionRules, 'order_mode' | 'completion_mode'>,
  modules: ModuleLite[],
  lessons: LessonLite[],
  progress: Map<string, ProgressLite>,
  startedAt: string | null,
  now: number,
): Map<string, LessonLock> {
  const ordered = orderedLessons(modules, lessons)
  const out = new Map<string, LessonLock>()
  const modRank = new Map([...modules].sort((a, b) => a.position - b.position).map((m, i) => [m.id, i]))
  const modById = new Map(modules.map(m => [m.id, m]))
  const done = (l: LessonLite) => lessonDone(l, progress.get(l.id))
  const others = ordered.filter(l => !l.is_final && l.is_required)

  ordered.forEach((l, i) => {
    const drip = modById.get(l.module_id)?.unlock_after_days
    if (drip && drip > 0) {
      const base = startedAt ? new Date(startedAt).getTime() : now
      const opens = base + drip * DAY_MS
      if (now < opens) { out.set(l.id, { locked: true, reason: 'DRIP', unlocksAt: new Date(opens).toISOString() }); return }
    }
    if (l.is_final && rules.completion_mode !== 'FINAL_ONLY' && others.some(o => !done(o))) {
      out.set(l.id, { locked: true, reason: 'FINAL_LAST' })
      return
    }
    if (rules.order_mode === 'SEQUENTIAL' && ordered.slice(0, i).some(p => p.is_required && !done(p))) {
      out.set(l.id, { locked: true, reason: 'PREVIOUS_LESSON' })
      return
    }
    if (rules.order_mode === 'MODULE_SEQUENTIAL') {
      const rank = modRank.get(l.module_id) ?? 0
      if (ordered.some(p => (modRank.get(p.module_id) ?? 0) < rank && p.is_required && !done(p))) {
        out.set(l.id, { locked: true, reason: 'PREVIOUS_MODULE' })
        return
      }
    }
    out.set(l.id, { locked: false })
  })
  return out
}

// ── Quiz availability ───────────────────────────────────────────────────────
export type QuizGate = 'READY' | 'WATCH_FIRST' | 'PASSED' | 'COOLDOWN' | 'LOCKED'
export interface QuizAvailability { gate: QuizGate; attemptsLeft: number | null; retryAt?: string }

export function quizAvailability(
  lesson: Pick<LessonLite, 'kind'>,
  quiz: Pick<QuizLite, 'max_attempts' | 'cooldown_minutes'>,
  p: ProgressLite | undefined,
  lastSubmittedAt: string | null,
  now: number,
): QuizAvailability {
  const q = p || blank('')
  const left = quiz.max_attempts == null ? null : Math.max(0, quiz.max_attempts + q.extra_attempts - q.attempts_used)
  if (q.quiz_passed) return { gate: 'PASSED', attemptsLeft: left }
  if (lesson.kind !== 'ASSESSMENT' && !q.content_done) return { gate: 'WATCH_FIRST', attemptsLeft: left }
  if (left === 0) return { gate: 'LOCKED', attemptsLeft: 0 }
  if (quiz.cooldown_minutes > 0 && lastSubmittedAt) {
    const until = new Date(lastSubmittedAt).getTime() + quiz.cooldown_minutes * 60_000
    if (now < until) return { gate: 'COOLDOWN', attemptsLeft: left, retryAt: new Date(until).toISOString() }
  }
  return { gate: 'READY', attemptsLeft: left }
}

// ── Grading ─────────────────────────────────────────────────────────────────
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export type Answer = string | string[] | null | undefined

/** Marks earned on one question. Everything is decided here, on the server, from the
 *  stored key; nothing the client sends about correctness is ever read. */
export function gradeQuestion(q: QuestionFull, answer: Answer): number {
  const correct = q.options.filter(o => o.correct).map(o => o.id)
  switch (q.kind) {
    case 'SINGLE':
    case 'TRUE_FALSE':
      return typeof answer === 'string' && correct.length === 1 && correct[0] === answer ? q.marks : 0
    case 'MULTI': {
      const chosen = new Set(Array.isArray(answer) ? answer.map(String) : [])
      if (!correct.length || !chosen.size) return 0
      const right = correct.filter(c => chosen.has(c)).length
      const wrong = [...chosen].filter(c => !correct.includes(c)).length
      if (q.partial_credit) return Math.max(0, ((right - wrong) / correct.length) * q.marks)
      return right === correct.length && wrong === 0 ? q.marks : 0
    }
    case 'SHORT_TEXT':
      return typeof answer === 'string' && answer.trim() !== '' && q.accepted.some(a => norm(a) === norm(answer)) ? q.marks : 0
    default:
      return 0
  }
}

/** One question as drawn for one learner. */
export interface PaperItem { q: string; o: string[] }

export function shuffled<T>(items: T[], rand: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Draw and order a paper. A draw from a larger pool is always random, or everybody would
 *  get the same first N and the pool would be pointless. */
export function buildPaper(
  quiz: Pick<QuizLite, 'shuffle_questions' | 'shuffle_options' | 'draw_count'>,
  questions: QuestionFull[],
  rand: () => number = Math.random,
): PaperItem[] {
  const base = [...questions].sort((a, b) => a.position - b.position)
  const drawing = !!quiz.draw_count && quiz.draw_count < base.length
  let picked = drawing ? shuffled(base, rand).slice(0, quiz.draw_count!) : base
  if (quiz.shuffle_questions) picked = shuffled(picked, rand)
  else if (drawing) picked = [...picked].sort((a, b) => a.position - b.position)
  return picked.map(q => ({
    q: q.id,
    // True / False reads wrong the other way round.
    o: quiz.shuffle_options && q.kind !== 'TRUE_FALSE'
      ? shuffled(q.options.map(o => o.id), rand)
      : q.options.map(o => o.id),
  }))
}

export interface LearnerQuestion {
  id: string
  kind: QuestionKind
  prompt: string
  marks: number
  options: { id: string; text: string }[]
}

/** The paper as the browser receives it. Built field by field rather than by deleting
 *  `correct`, so a column added later cannot leak by default. */
export function learnerPaper(paper: PaperItem[], questions: QuestionFull[]): LearnerQuestion[] {
  const byId = new Map(questions.map(q => [q.id, q]))
  return paper.flatMap(item => {
    const q = byId.get(item.q)
    if (!q) return []
    const opts = new Map(q.options.map(o => [o.id, o]))
    return [{
      id: q.id, kind: q.kind, prompt: q.prompt, marks: q.marks,
      options: item.o.flatMap(id => { const o = opts.get(id); return o ? [{ id: o.id, text: o.text }] : [] }),
    }]
  })
}

export interface GradedItem { question_id: string; marks: number; earned: number; correct: boolean }
export interface GradeResult { score: number; maxScore: number; pct: number; items: GradedItem[] }

/** Only the questions on this paper count, and an answer to anything else is ignored. */
export function gradePaper(paper: PaperItem[], questions: QuestionFull[], answers: Record<string, Answer>): GradeResult {
  const byId = new Map(questions.map(q => [q.id, q]))
  const items: GradedItem[] = []
  let score = 0, maxScore = 0
  for (const { q: id } of paper) {
    const q = byId.get(id)
    if (!q) continue
    const earned = gradeQuestion(q, answers?.[id])
    score += earned
    maxScore += q.marks
    items.push({ question_id: id, marks: q.marks, earned, correct: earned >= q.marks })
  }
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0
  return { score, maxScore, pct, items }
}

export const passed = (pct: number, passPct: number) => pct >= passPct

export const mayShowAnswers = (show: QuizLite['show_answers'], didPass: boolean) =>
  show === 'AFTER_SUBMIT' || (show === 'AFTER_PASS' && didPass)

// ── Course progress and completion ──────────────────────────────────────────
export interface CourseState {
  /** 0–100, of the required lessons done (of all lessons if none are required). */
  progressPct: number
  doneCount: number
  totalCount: number
  complete: boolean
  /** A required quiz has no attempts left and the course cannot complete without it. */
  blocked: boolean
  /** The final assessment's best score if there is one, else the mean of the quizzes. */
  scorePct: number | null
}

export function courseState(
  rules: VersionRules,
  lessons: LessonLite[],
  quizzes: Map<string, Pick<QuizLite, 'max_attempts' | 'on_exhausted'>>,
  progress: Map<string, ProgressLite>,
): CourseState {
  const required = lessons.filter(l => l.is_required)
  const counted = required.length ? required : lessons
  const done = (l: LessonLite) => lessonDone(l, progress.get(l.id))
  const doneCount = counted.filter(done).length
  const progressPct = counted.length ? Math.round((doneCount / counted.length) * 1000) / 10 : 0

  const finals = lessons.filter(l => l.is_final)
  const withQuiz = lessons.filter(l => l.quiz_id)
  // Number(): Postgres numerics are not guaranteed to arrive as JSON numbers, and adding
  // two strings would quietly print a score of 7080%.
  const best = (l: LessonLite) => {
    const v = progress.get(l.id)?.quiz_best_pct
    return v == null ? null : Number(v)
  }
  const scored = (list: LessonLite[]) => list.map(best).filter((n): n is number => n != null)

  const finalScores = scored(finals)
  const quizScores = scored(withQuiz)
  const pool = finalScores.length ? finalScores : quizScores
  const scorePct = pool.length ? Math.round((pool.reduce((a, b) => a + b, 0) / pool.length) * 10) / 10 : null

  let base: boolean
  if (rules.completion_mode === 'ALL_REQUIRED') base = counted.length > 0 && doneCount === counted.length
  else if (rules.completion_mode === 'PERCENT') base = counted.length > 0 && (doneCount / counted.length) * 100 >= rules.completion_pct
  else base = finals.length > 0 && finals.every(done)

  const gatedQuizzes = required.filter(l => l.quiz_id && l.quiz_required)
  const quizzesOk = !rules.require_all_quizzes
    || rules.completion_mode === 'FINAL_ONLY'
    || gatedQuizzes.every(l => !!progress.get(l.id)?.quiz_passed)
  const finalOk = !rules.require_final || (finals.length > 0 && finals.every(done))
  const overallOk = rules.min_overall_pct == null || (quizScores.length > 0
    ? (quizScores.reduce((a, b) => a + b, 0) / quizScores.length) >= rules.min_overall_pct
    : true)

  // Which lessons can no longer be passed, and does the course depend on them?
  const needed = (l: LessonLite) =>
    rules.completion_mode === 'FINAL_ONLY' ? l.is_final
      : rules.require_all_quizzes || rules.completion_mode === 'ALL_REQUIRED' || (rules.require_final && l.is_final)
  const blocked = gatedQuizzes.some(l => {
    const q = l.quiz_id ? quizzes.get(l.quiz_id) : undefined
    const p = progress.get(l.id)
    if (!q || p?.quiz_passed || q.max_attempts == null || q.on_exhausted !== 'LOCK') return false
    return needed(l) && (p?.attempts_used ?? 0) >= q.max_attempts + (p?.extra_attempts ?? 0)
  })

  return {
    progressPct, doneCount, totalCount: counted.length,
    complete: base && quizzesOk && finalOk && overallOk,
    blocked, scorePct,
  }
}

// ── Learning paths ──────────────────────────────────────────────────────────
export interface PathItemLite { course_id: string; position: number; is_required: boolean }

/** Which courses of a path are still locked. Flexible paths lock nothing. */
export function pathLocks(orderMode: 'SEQUENTIAL' | 'FLEXIBLE', items: PathItemLite[], completed: Set<string>): Map<string, boolean> {
  const out = new Map<string, boolean>()
  let open = true
  for (const it of [...items].sort((a, b) => a.position - b.position)) {
    out.set(it.course_id, orderMode === 'SEQUENTIAL' && !open)
    if (it.is_required && !completed.has(it.course_id)) open = false
  }
  return out
}

export function pathProgress(items: PathItemLite[], completed: Set<string>): { pct: number; complete: boolean } {
  const req = items.filter(i => i.is_required)
  const counted = req.length ? req : items
  const done = counted.filter(i => completed.has(i.course_id)).length
  return {
    pct: counted.length ? Math.round((done / counted.length) * 1000) / 10 : 0,
    complete: counted.length > 0 && done === counted.length,
  }
}

// ── Who can see a course ────────────────────────────────────────────────────
export interface AudienceFacts {
  department_id: string | null
  designation: string | null
  location_id: string | null
  grade: string | null
  employment_type: string | null
  employee_category: string | null
  team_name: string | null
}
export interface AudienceRow { kind: string; value: string }

const FIELD: Record<string, keyof AudienceFacts> = {
  DEPARTMENT: 'department_id', DESIGNATION: 'designation', LOCATION: 'location_id', GRADE: 'grade',
  EMPLOYMENT_TYPE: 'employment_type', EMPLOYEE_CATEGORY: 'employee_category', TEAM: 'team_name',
}

/** Same reading as the assignment audience: same kind ORs, different kinds AND. */
export function matchesAudience(rows: AudienceRow[], who: AudienceFacts): boolean {
  if (!rows.length) return false
  const byKind = new Map<string, string[]>()
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) || []), r.value])
  for (const [kind, values] of byKind) {
    const field = FIELD[kind]
    if (!field) return false
    const mine = who[field]
    if (mine == null || !values.some(v => norm(v) === norm(mine))) return false
  }
  return true
}

export function canSeeCourse(c: { status: string; visibility: string }, audience: AudienceRow[], who: AudienceFacts): boolean {
  if (c.status !== 'PUBLISHED') return false
  if (c.visibility === 'EVERYONE') return true
  if (c.visibility === 'RESTRICTED') return matchesAudience(audience, who)
  return false
}

// ── Display status ──────────────────────────────────────────────────────────
export const OPEN_STATUSES = ['NOT_STARTED', 'IN_PROGRESS']

export function isOverdue(e: { status: string; due_at: string | null }, now: number): boolean {
  return OPEN_STATUSES.includes(e.status) && !!e.due_at && new Date(e.due_at).getTime() < now
}

/** Whole days until a due date: negative once past it. Calendar days in IST, not 24-hour
 *  blocks, so "due tomorrow" means what a person reads it as. */
export function daysUntil(dueAt: string, now: number): number {
  const ist = (t: number) => Math.floor((t + 5.5 * 3_600_000) / DAY_MS)
  return ist(new Date(dueAt).getTime()) - ist(now)
}

/** Add calendar months, clamped so 31 Jan + 1 month is 28 Feb rather than 3 Mar. */
export function addMonths(from: string | Date, months: number): string {
  const d = new Date(from)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString()
}

// ── Publish checks ──────────────────────────────────────────────────────────
export interface PublishLesson extends LessonLite {
  title: string
  asset_id: string | null
  asset_ready?: boolean
  external_url: string | null
  body: string | null
}
export interface PublishQuiz extends QuizLite { title: string; questions: QuestionFull[] }

export function questionProblem(q: QuestionFull): string | null {
  if (!q.prompt?.trim()) return 'has no question text'
  if (q.kind === 'SHORT_TEXT') return q.accepted.filter(a => a.trim()).length ? null : 'has no accepted answer'
  if (q.options.length < 2) return 'needs at least two options'
  if (q.options.some(o => !o.text?.trim())) return 'has an empty option'
  const right = q.options.filter(o => o.correct).length
  if (q.kind === 'MULTI') return right >= 1 ? null : 'has no correct option'
  return right === 1 ? null : 'needs exactly one correct option'
}

/** Why this version cannot go live, in words an author can act on. Empty = it can. */
export function publishProblems(
  rules: VersionRules,
  modules: (ModuleLite & { title: string })[],
  lessons: PublishLesson[],
  quizzes: PublishQuiz[],
): string[] {
  const out: string[] = []
  if (!lessons.length) out.push('Add at least one lesson.')
  for (const m of modules) {
    if (!lessons.some(l => l.module_id === m.id)) out.push(`Module "${m.title}" has no lessons.`)
  }
  const quizById = new Map(quizzes.map(q => [q.id, q]))
  for (const l of lessons) {
    const t = `Lesson "${l.title}"`
    if ((l.kind === 'VIDEO' || l.kind === 'AUDIO' || l.kind === 'DOCUMENT' || l.kind === 'SLIDES' || l.kind === 'SCORM')) {
      if (!l.asset_id) out.push(l.kind === 'SCORM' ? `${t} has no SCORM package.` : `${t} has no file.`)
      else if (l.asset_ready === false) out.push(`${t}: its file has not finished uploading.`)
    }
    if (l.kind === 'ARTICLE' && !l.body?.trim()) out.push(`${t} has no text.`)
    if (l.kind === 'LINK') {
      if (!l.external_url?.trim()) out.push(`${t} has no link.`)
      else if (!/^https:\/\//i.test(l.external_url.trim())) out.push(`${t}: the link must start with https://.`)
    }
    if (l.kind === 'ASSESSMENT' && !l.quiz_id) out.push(`${t} is an assessment with no quiz.`)
    if (l.quiz_id && !quizById.has(l.quiz_id)) out.push(`${t} points at a quiz that no longer exists.`)
  }
  for (const q of quizzes) {
    const t = `Quiz "${q.title}"`
    if (!q.questions.length) { out.push(`${t} has no questions.`); continue }
    if (q.draw_count && q.draw_count > q.questions.length) out.push(`${t} draws ${q.draw_count} questions but has only ${q.questions.length}.`)
    for (const [i, qn] of [...q.questions].sort((a, b) => a.position - b.position).entries()) {
      const p = questionProblem(qn)
      if (p) out.push(`${t}, question ${i + 1} ${p}.`)
    }
  }
  const finals = lessons.filter(l => l.is_final)
  if (rules.require_final && !finals.length) out.push('The course requires a final assessment, but no lesson is marked as final.')
  if (rules.completion_mode === 'FINAL_ONLY' && !finals.length) out.push('Completion is on the final assessment alone, but no lesson is marked as final.')
  for (const l of finals) {
    if (!l.quiz_id) out.push(`Lesson "${l.title}" is marked final but has no quiz.`)
  }
  return out
}
