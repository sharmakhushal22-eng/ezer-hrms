// lib/lms/game.ts — a learner's points, streak and badges, and the company leaderboard. Server only.
//
// The rules live in ./game-core.ts and are pure; this file only reads the rows they need. Nothing
// is written: points are recomputed from the learning record on every request, so there is no
// ledger to keep in step and nothing anybody could award by hand.
//
// The company switches (lms_settings, migration 227) are read as "on" while the columns do not
// exist yet, so a company sees points the day this ships and can turn them off afterwards.
import { periodStart, rank, summarise, xpEvents, xpSince, type GameRecords } from './game-core'
import { allRows, sb, settingsFor } from './server'
import type { Learner } from './learner'

export type Period = 'week' | 'month' | 'all'
export type Scope = 'company' | 'department'

const PAGE = 1000
/** How many ids go into one `in (…)` filter, so the request address stays short. */
const CHUNK = 150

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

/** Rows whose `col` is one of `ids`, in id chunks, each chunk paged past the 1,000-row cap. */
async function rowsIn<T>(ids: string[], page: (part: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return []
  const parts = await mapLimit(chunks(uniq), 6, part => allRows<T>((from, to) => page(part, from, to)))
  return parts.flat()
}

/** A whole company's rows: the first page says how many there are, then the rest come in
 *  parallel rather than one after another. The query must be ordered for paging to be stable. */
async function fastRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any; count?: number | null }>, max = 200_000): Promise<T[]> {
  const first = await page(0, PAGE - 1)
  if (first.error) throw new Error(first.error.message || String(first.error))
  const out: T[] = [...(first.data || [])]
  const total = Math.min(first.count ?? out.length, max)
  if (out.length < PAGE || total <= PAGE) return out
  const starts: number[] = []
  for (let f = PAGE; f < total; f += PAGE) starts.push(f)
  const pages = await mapLimit(starts, 6, async f => {
    const r = await page(f, f + PAGE - 1)
    if (r.error) throw new Error(r.error.message || String(r.error))
    return r.data || []
  })
  for (const p of pages) out.push(...p)
  return out
}

/** Live sessions arrived with 211; a database without them simply has no attendance to count. */
async function optional<T>(p: PromiseLike<T[]>): Promise<T[]> {
  try { return await p } catch { return [] }
}

/** Everything one person's points come from, across every learner record they have in the group. */
async function learnerRecords(allIds: string[]): Promise<GameRecords> {
  // Two rounds. The first reads what is keyed on the learner; the second what is keyed on their
  // enrolments, and the categories of their courses.
  const [enrollments, paths, sessions] = await Promise.all([
    rowsIn<any>(allIds, (part, from, to) => sb.from('lms_enrollments').select('id, course_id, status, mandatory, due_at, completed_at').in('learner_id', part).order('id').range(from, to)),
    rowsIn<any>(allIds, (part, from, to) => sb.from('lms_path_enrollments').select('id, status, completed_at').in('learner_id', part).eq('status', 'COMPLETED').order('id').range(from, to)),
    optional(rowsIn<any>(allIds, (part, from, to) => sb.from('lms_session_attendees').select('session_id, attended, attended_at, recording_done, recording_last_beat_at').in('learner_id', part).order('id').range(from, to))),
  ])
  const ids = enrollments.map(e => e.id)
  const courseIds = [...new Set(enrollments.filter(e => e.status === 'COMPLETED').map(e => e.course_id))]
  const [lessons, attempts, feedback, courses] = await Promise.all([
    rowsIn<any>(ids, (part, from, to) => sb.from('lms_lesson_progress').select('enrollment_id, lesson_id, completed_at, last_beat_at').in('enrollment_id', part).order('id').range(from, to)),
    rowsIn<any>(ids, (part, from, to) => sb.from('lms_quiz_attempts').select('enrollment_id, lesson_id, pct, passed, submitted_at').in('enrollment_id', part).eq('status', 'SUBMITTED').order('id').range(from, to)),
    rowsIn<any>(ids, (part, from, to) => sb.from('lms_feedback').select('enrollment_id, created_at').in('enrollment_id', part).order('id').range(from, to)),
    rowsIn<any>(courseIds, (part, from, to) => sb.from('lms_courses').select('id, category_id').in('id', part).order('id').range(from, to)),
  ])
  const category = new Map(courses.map(c => [c.id, c.category_id]))
  return { enrollments: enrollments.map(e => ({ ...e, category_id: category.get(e.course_id) || null })), lessons, attempts, sessions, paths, feedback }
}

const gameOn = (s: { game_enabled?: boolean }) => s.game_enabled !== false
const boardOn = (s: { game_enabled?: boolean; leaderboard_enabled?: boolean }) => gameOn(s) && s.leaderboard_enabled !== false

/** The learner's own points. `lite` is the top bar's and the Home tile's: no badge list beyond
 *  the ones earned today, which the course-complete screen shows. */
export async function myGame(l: Learner, opts: { lite?: boolean } = {}, now = Date.now()) {
  const settings = await settingsFor(l.companyId)
  if (!gameOn(settings)) return { enabled: false as const }
  const s = summarise(await learnerRecords(l.allIds), now)
  const startOfToday = now - ((now + 330 * 60_000) % 86_400_000)
  const today = s.badges.filter(b => b.earned_at && new Date(b.earned_at).getTime() >= startOfToday).map(b => ({ id: b.id, name: b.name, icon: b.icon }))
  const earned = s.badges.filter(b => b.earned_at).length
  const leaderboard = boardOn(settings) && l.kind === 'EMPLOYEE'
  if (opts.lite) return { enabled: true as const, leaderboard, xp: s.xp, level: s.level, streak: s.streak, week: s.week, today_xp: s.today_xp, month_xp: s.month_xp, badges_earned: earned, badges_total: s.badges.length, badges_today: today }
  return { enabled: true as const, leaderboard, ...s, badges_earned: earned, badges_total: s.badges.length, badges_today: today }
}

// ── The leaderboard ─────────────────────────────────────────────────────────
interface BoardEntry { learner_id: string; name: string; department_id: string | null; xp: number }

/** A company's board changes slowly and every learner on Home would ask for it: kept for a
 *  minute per server instance (five for all-time, which reads the most). */
const boards = new Map<string, { at: number; rows: Promise<BoardEntry[]> }>()
const BOARD_TTL_MS = { week: 60_000, month: 60_000, all: 300_000 }

function companyBoard(company: string, period: Period, now: number): Promise<BoardEntry[]> {
  const key = `${company}:${period}`
  const hit = boards.get(key)
  if (hit && now - hit.at < BOARD_TTL_MS[period]) return hit.rows
  const rows = buildBoard(company, period, now)
  boards.set(key, { at: now, rows })
  rows.catch(() => boards.delete(key))
  return rows
}

async function buildBoard(company: string, period: Period, now: number): Promise<BoardEntry[]> {
  const since = periodStart(period, now)
  const iso = new Date(since).toISOString()
  // A period board only reads what happened in the period; all-time reads the lot. Each list is
  // one company's rows, paged in parallel.
  const dated = (q: any, col: string) => (since ? q.gte(col, iso) : q)
  const [learners, lessons, attempts, done, sessions, paths] = await Promise.all([
    allRows<any>((from, to) => sb.from('lms_learners').select('id, full_name, department_id').eq('company_id', company).eq('kind', 'EMPLOYEE').eq('status', 'ACTIVE').order('id').range(from, to)),
    fastRows<any>((from, to) => dated(sb.from('lms_lesson_progress').select('enrollment_id, lesson_id, completed_at', { count: 'exact' }).eq('company_id', company).not('completed_at', 'is', null), 'completed_at').order('id').range(from, to)),
    fastRows<any>((from, to) => dated(sb.from('lms_quiz_attempts').select('enrollment_id, lesson_id, pct, passed, submitted_at', { count: 'exact' }).eq('company_id', company).eq('status', 'SUBMITTED').eq('passed', true), 'submitted_at').order('id').range(from, to)),
    fastRows<any>((from, to) => dated(sb.from('lms_enrollments').select('id, learner_id, course_id, status, mandatory, due_at, completed_at', { count: 'exact' }).eq('company_id', company).eq('status', 'COMPLETED'), 'completed_at').order('id').range(from, to)),
    optional(fastRows<any>((from, to) => sb.from('lms_session_attendees').select('learner_id, session_id, attended, attended_at, recording_done, recording_last_beat_at', { count: 'exact' }).eq('company_id', company).or('attended.eq.true,recording_done.eq.true').order('id').range(from, to))),
    fastRows<any>((from, to) => dated(sb.from('lms_path_enrollments').select('id, learner_id, status, completed_at', { count: 'exact' }).eq('company_id', company).eq('status', 'COMPLETED'), 'completed_at').order('id').range(from, to)),
  ])

  // Whose enrolment each lesson and attempt belongs to. Completed enrolments are already known;
  // the rest are looked up by id, or read whole for the company when that is the shorter way.
  const owner = new Map<string, string>(done.map(e => [e.id, e.learner_id]))
  const missing = [...new Set([...lessons, ...attempts].map(x => x.enrollment_id).filter(id => !owner.has(id)))]
  const found = missing.length > 3000
    ? await fastRows<any>((from, to) => sb.from('lms_enrollments').select('id, learner_id', { count: 'exact' }).eq('company_id', company).order('id').range(from, to))
    : await rowsIn<any>(missing, (part, from, to) => sb.from('lms_enrollments').select('id, learner_id').in('id', part).order('id').range(from, to))
  for (const e of found) owner.set(e.id, e.learner_id)

  const per = new Map<string, GameRecords>()
  const recs = (id: string) => { let r = per.get(id); if (!r) per.set(id, r = { enrollments: [], lessons: [], attempts: [], sessions: [], paths: [], feedback: [] }); return r }
  for (const e of done) recs(e.learner_id).enrollments.push(e)
  for (const x of lessons) { const o = owner.get(x.enrollment_id); if (o) recs(o).lessons.push(x) }
  for (const x of attempts) { const o = owner.get(x.enrollment_id); if (o) recs(o).attempts.push(x) }
  for (const x of sessions) recs(x.learner_id).sessions.push(x)
  for (const x of paths) recs(x.learner_id).paths.push(x)

  return learners.map(l => {
    const r = per.get(l.id)
    return { learner_id: l.id, name: l.full_name || 'Learner', department_id: l.department_id || null, xp: r ? xpSince(xpEvents(r), since) : 0 }
  })
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase()

/** The top ten for a period, and where the viewer stands even when they are not in it. When the
 *  company hides names, everyone else appears as "A colleague in <department>". */
export async function leaderboard(l: Learner, period: Period, scope: Scope, now = Date.now()) {
  const settings = await settingsFor(l.companyId)
  if (!boardOn(settings) || l.kind !== 'EMPLOYEE') return { enabled: false as const }
  const names = settings.leaderboard_names !== false
  const all = await companyBoard(l.companyId, period, now)
  const dept = l.facts?.department_id || null
  const effective: Scope = scope === 'department' && dept ? 'department' : 'company'
  const people = effective === 'department' ? all.filter(r => r.department_id === dept) : all
  const ranked = rank(people)
  const deptIds = [...new Set(ranked.slice(0, 10).map(r => r.department_id).concat(dept).filter(Boolean))] as string[]
  const { data: deps } = deptIds.length ? await sb.from('departments').select('id, dept_name').in('id', deptIds) : { data: [] as any[] }
  const deptName = new Map(((deps || []) as any[]).map(d => [d.id, d.dept_name]))
  const mine = new Set(l.allIds)
  const show = (r: (typeof ranked)[number]) => {
    const me = mine.has(r.learner_id)
    const department = (r.department_id && deptName.get(r.department_id)) || null
    const name = me || names ? r.name : department ? `A colleague in ${department}` : 'A colleague'
    return { rank: r.rank, xp: r.xp, name, initials: me || names ? initialsOf(r.name) : '', department, me }
  }
  const meRow = ranked.find(r => mine.has(r.learner_id))
  return {
    enabled: true as const, period, scope: effective, names,
    department: dept ? deptName.get(dept) || null : null,
    rows: ranked.slice(0, 10).map(show),
    me: meRow ? show(meRow) : { rank: null, xp: 0, name: l.name, initials: initialsOf(l.name), department: dept ? deptName.get(dept) || null : null, me: true },
    ranked: ranked.length,
    people: people.length,
  }
}
