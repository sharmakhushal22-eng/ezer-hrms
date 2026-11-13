// lib/lms/game-core.ts — points, levels, streaks and badges, worked out from the learning record.
// Pure: no database, no clock of its own. lib/lms/game.ts reads the rows and hands them here.
//
// Nothing is awarded by hand and nothing is stored. Every figure is recomputed from what the
// learner actually did (lessons finished, quizzes passed, courses completed, sessions attended),
// so points cannot drift from the record, a fix to a rule applies to history too, and someone
// who finished courses before points existed has them from the first day.
//
// Days are Indian calendar days (IST, no daylight saving): a lesson at 11 pm and another at
// 1 am the next night are two days of a streak, the way the learner would count them.

export type XpKind = 'lesson' | 'course' | 'ontime' | 'quiz' | 'perfect' | 'live' | 'recording' | 'path'

/** How many points each thing is worth. */
export const XP: Record<XpKind, number> = {
  lesson: 10,       // a lesson finished (once per lesson, however often it is retaken)
  course: 100,      // a course completed
  ontime: 50,       // a mandatory course completed by its due date, on top of the 100
  quiz: 20,         // a quiz passed (once per quiz)
  perfect: 20,      // a quiz scored 100%, on top of passing it (once per quiz)
  live: 40,         // a live session attended
  recording: 20,    // a session's recording watched, when the session itself was missed
  path: 200,        // a learning path completed
}

export const XP_WORDS: Record<XpKind, string> = {
  lesson: 'Lessons finished', course: 'Courses completed', ontime: 'Mandatory courses on time', quiz: 'Quizzes passed',
  perfect: 'Perfect quiz scores', live: 'Live sessions attended', recording: 'Recordings watched', path: 'Learning paths completed',
}

/** Points to aim for each week (Monday to Sunday, IST): about a course, or a few lessons a day. */
export const WEEKLY_GOAL = 150

export interface GameRecords {
  enrollments: { id: string; course_id: string; status: string; mandatory?: boolean | null; due_at?: string | null; completed_at?: string | null; category_id?: string | null }[]
  /** lms_lesson_progress rows. A finished lesson has completed_at. */
  lessons: { enrollment_id: string; lesson_id: string; completed_at?: string | null; last_beat_at?: string | null }[]
  /** Submitted quiz attempts. */
  attempts: { enrollment_id: string; lesson_id: string; pct?: number | string | null; passed?: boolean | null; submitted_at?: string | null }[]
  sessions: { session_id: string; attended?: boolean | null; attended_at?: string | null; recording_done?: boolean | null; recording_last_beat_at?: string | null }[]
  paths: { id: string; status: string; completed_at?: string | null }[]
  feedback: { enrollment_id: string; created_at?: string | null }[]
}

export interface XpEvent { at: number; xp: number; kind: XpKind }

/** Keep the earliest known moment per key; an undated record (0) gives way to any dated one. */
function earliest(m: Map<string, number>, k: string, t: number) {
  const w = m.get(k)
  if (w == null || (t > 0 && (w === 0 || t < w))) m.set(k, t)
}

const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000
const ms = (s?: string | null) => { const t = s ? new Date(s).getTime() : NaN; return Number.isFinite(t) ? t : 0 }
/** The IST calendar day a moment falls on, as a day number. */
export const istDay = (t: number) => Math.floor((t + IST_MS) / DAY_MS)
/** The hour of the day in IST, 0 to 23. */
export const istHour = (t: number) => Math.floor((((t + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000)
/** The moment an IST day number begins. */
export const dayStart = (day: number) => day * DAY_MS - IST_MS
/** Monday of the IST week a day number falls in. Day 0 (1 Jan 1970) was a Thursday. */
export const weekStartDay = (day: number) => day - ((day + 3) % 7)

/** When a leaderboard period starts. */
export function periodStart(period: 'week' | 'month' | 'all', now: number): number {
  if (period === 'all') return 0
  const today = istDay(now)
  if (period === 'week') return dayStart(weekStartDay(today))
  const d = new Date(now + IST_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST_MS
}

/** Every point the record earns, each with the moment it was earned (0 when the record has no
 *  date, which still counts toward the total but never toward a week or a month). */
export function xpEvents(r: GameRecords): XpEvent[] {
  const out: XpEvent[] = []
  const add = (kind: XpKind, at: number) => out.push({ at, xp: XP[kind], kind })

  // A lesson counts once, at its first finish: retaking a course does not pay twice.
  const firstFinish = new Map<string, number>()
  for (const p of r.lessons) if (p.completed_at) earliest(firstFinish, p.lesson_id, ms(p.completed_at))
  for (const t of firstFinish.values()) add('lesson', t)

  for (const e of r.enrollments) {
    if (e.status !== 'COMPLETED') continue
    const t = ms(e.completed_at)
    add('course', t)
    if (e.mandatory && e.due_at && e.completed_at && t <= ms(e.due_at)) add('ontime', t)
  }

  // A quiz counts once: the first pass, and the first perfect score, whichever attempts they were.
  const passAt = new Map<string, number>(), perfectAt = new Map<string, number>()
  for (const a of r.attempts) {
    const t = ms(a.submitted_at)
    if (a.passed) earliest(passAt, a.lesson_id, t)
    if (a.passed && Number(a.pct) >= 100) earliest(perfectAt, a.lesson_id, t)
  }
  for (const t of passAt.values()) add('quiz', t)
  for (const t of perfectAt.values()) add('perfect', t)

  for (const s of r.sessions) {
    if (s.attended) add('live', ms(s.attended_at) || ms(s.recording_last_beat_at))
    else if (s.recording_done) add('recording', ms(s.recording_last_beat_at))
  }
  for (const p of r.paths) if (p.status === 'COMPLETED') add('path', ms(p.completed_at))
  return out.sort((a, b) => a.at - b.at)
}

/** Moments the learner was actually learning, for streaks and the early-bird and night-owl badges. */
export function activityTimes(r: GameRecords): number[] {
  const t: number[] = []
  for (const p of r.lessons) { t.push(ms(p.completed_at)); t.push(ms(p.last_beat_at)) }
  for (const a of r.attempts) t.push(ms(a.submitted_at))
  for (const e of r.enrollments) if (e.status === 'COMPLETED') t.push(ms(e.completed_at))
  for (const s of r.sessions) { if (s.attended) t.push(ms(s.attended_at)); t.push(ms(s.recording_last_beat_at)) }
  return t.filter(x => x > 0).sort((a, b) => a - b)
}

// ── Levels ──────────────────────────────────────────────────────────────────
const LEVEL_NAMES = ['Starter', 'Explorer', 'Learner', 'Achiever', 'Specialist', 'Expert', 'Master', 'Mentor', 'Champion', 'Legend']
/** The points at which a level begins: 0, 100, 300, 600, 1000, 1500… each step 100 more than the last. */
export const levelFloor = (n: number) => 50 * n * (n - 1)

export interface LevelInfo { level: number; name: string; floor: number; next: number; into: number; need: number; pct: number }
export function levelOf(xp: number): LevelInfo {
  const x = Math.max(0, Math.floor(xp))
  let n = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * x) / 50)) / 2))
  while (levelFloor(n + 1) <= x) n++
  while (n > 1 && levelFloor(n) > x) n--
  const floor = levelFloor(n), next = levelFloor(n + 1)
  return { level: n, name: LEVEL_NAMES[Math.min(n, LEVEL_NAMES.length) - 1], floor, next, into: x - floor, need: next - x, pct: Math.round(((x - floor) / (next - floor)) * 100) }
}

// ── Streaks ─────────────────────────────────────────────────────────────────
export interface StreakInfo { current: number; best: number; today: boolean; days: number[] }
/** Consecutive IST days with any learning. A streak is still alive until a whole day passes
 *  without any: someone who learned yesterday has not lost it before they open the app today. */
export function streakOf(times: number[], now: number): StreakInfo {
  const days = [...new Set(times.map(istDay))].sort((a, b) => a - b)
  const has = new Set(days)
  const today = istDay(now)
  let current = 0
  for (let d = has.has(today) ? today : today - 1; has.has(d); d--) current++
  return { current, best: longestRun(days), today: has.has(today), days }
}

/** The day a run of consecutive days first reached n, or null. */
function streakReached(days: number[], n: number): number | null {
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i && days[i] === days[i - 1] + 1 ? run + 1 : 1
    if (run >= n) return days[i]
  }
  return null
}

// ── Badges ──────────────────────────────────────────────────────────────────
export interface Badge { id: string; name: string; description: string; icon: string; target: number; progress: number; earned_at: string | null }

interface BadgeRule { id: string; name: string; description: string; icon: string; target: number; times: (x: Facts) => number[] }
interface Facts { events: XpEvent[]; activity: number[]; streakDays: number[]; categoryTimes: number[]; feedbackTimes: number[] }

const of = (kind: XpKind) => (x: Facts) => x.events.filter(e => e.kind === kind).map(e => e.at)
/** A streak badge counts the longest run so far; once a run reaches n it is earned on that day. */
const streakTimes = (n: number) => (x: Facts) => {
  const d = streakReached(x.streakDays, n)
  return d == null ? new Array(Math.min(n - 1, longestRun(x.streakDays))).fill(0) : new Array(n).fill(dayStart(d) + DAY_MS / 2)
}
function longestRun(days: number[]) {
  let best = 0, run = 0
  for (let i = 0; i < days.length; i++) { run = i && days[i] === days[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run) }
  return best
}

/** The badges, in the order they are shown. `times` lists the moments that count toward each;
 *  the badge is earned at the target-th of them. */
export const BADGES: BadgeRule[] = [
  { id: 'first_lesson', name: 'First steps', description: 'Finish your first lesson', icon: 'step', target: 1, times: of('lesson') },
  { id: 'first_course', name: 'First course', description: 'Complete a course', icon: 'cap', target: 1, times: of('course') },
  { id: 'courses_5', name: 'Five courses', description: 'Complete five courses', icon: 'five', target: 5, times: of('course') },
  { id: 'courses_10', name: 'Ten courses', description: 'Complete ten courses', icon: 'ten', target: 10, times: of('course') },
  { id: 'courses_25', name: 'Twenty-five courses', description: 'Complete twenty-five courses', icon: 'crown', target: 25, times: of('course') },
  { id: 'perfect', name: 'Perfect score', description: 'Score 100% on a quiz', icon: 'target', target: 1, times: of('perfect') },
  { id: 'quiz_ace', name: 'Quiz ace', description: 'Score 100% on three quizzes', icon: 'bolt', target: 3, times: of('perfect') },
  { id: 'on_time', name: 'Always on time', description: 'Finish five mandatory courses by their due date', icon: 'clock', target: 5, times: of('ontime') },
  { id: 'streak_3', name: 'On a roll', description: 'Learn three days in a row', icon: 'flame', target: 3, times: streakTimes(3) },
  { id: 'streak_7', name: 'Week streak', description: 'Learn seven days in a row', icon: 'flame', target: 7, times: streakTimes(7) },
  { id: 'streak_30', name: 'Unstoppable', description: 'Learn thirty days in a row', icon: 'flame', target: 30, times: streakTimes(30) },
  { id: 'early_bird', name: 'Early bird', description: 'Learn before 8 in the morning', icon: 'sun', target: 1, times: x => x.activity.filter(t => { const h = istHour(t); return h >= 4 && h < 8 }) },
  { id: 'night_owl', name: 'Night owl', description: 'Learn after 10 at night', icon: 'moon', target: 1, times: x => x.activity.filter(t => { const h = istHour(t); return h >= 22 || h < 4 }) },
  { id: 'live_learner', name: 'Live learner', description: 'Attend three live sessions', icon: 'live', target: 3, times: of('live') },
  { id: 'path_finisher', name: 'Path finisher', description: 'Complete a learning path', icon: 'path', target: 1, times: of('path') },
  { id: 'explorer', name: 'Explorer', description: 'Complete courses in three different categories', icon: 'compass', target: 3, times: x => x.categoryTimes },
  { id: 'reviewer', name: 'Reviewer', description: 'Rate three courses you finished', icon: 'star', target: 3, times: x => x.feedbackTimes },
]

/** When each new category was first completed, in order: the explorer badge counts these. */
function categoryTimes(r: GameRecords): number[] {
  const first = new Map<string, number>()
  for (const e of r.enrollments) {
    if (e.status !== 'COMPLETED' || !e.category_id) continue
    earliest(first, e.category_id, ms(e.completed_at))
  }
  return [...first.values()].sort((a, b) => a - b)
}

export function badgesOf(r: GameRecords, events: XpEvent[], activity: number[], streakDays: number[]): Badge[] {
  const facts: Facts = { events, activity, streakDays, categoryTimes: categoryTimes(r), feedbackTimes: r.feedback.map(f => ms(f.created_at)).sort((a, b) => a - b) }
  return BADGES.map(b => {
    const times = b.times(facts)
    const earned = times.length >= b.target
    const at = earned ? [...times].sort((p, q) => p - q)[b.target - 1] : 0
    return { id: b.id, name: b.name, description: b.description, icon: b.icon, target: b.target, progress: Math.min(times.length, b.target), earned_at: earned ? new Date(at || 0).toISOString() : null }
  })
}

// ── Everything together ─────────────────────────────────────────────────────
export interface GameSummary {
  xp: number
  level: LevelInfo
  streak: { current: number; best: number; today: boolean }
  /** This IST week, Monday first: the points, the goal, and which days had any learning. */
  week: { xp: number; goal: number; days: boolean[] }
  month_xp: number
  today_xp: number
  breakdown: { kind: XpKind; label: string; count: number; xp: number }[]
  badges: Badge[]
  /** The latest points, newest first. */
  recent: { at: string; kind: XpKind; xp: number }[]
}

export function summarise(r: GameRecords, now: number): GameSummary {
  const events = xpEvents(r)
  const activity = activityTimes(r)
  const st = streakOf(activity, now)
  const xp = events.reduce((a, e) => a + e.xp, 0)
  const since = (t: number) => events.filter(e => e.at >= t).reduce((a, e) => a + e.xp, 0)
  const today = istDay(now), monday = weekStartDay(today)
  const active = new Set(st.days)
  const breakdown = (Object.keys(XP) as XpKind[]).map(kind => {
    const list = events.filter(e => e.kind === kind)
    return { kind, label: XP_WORDS[kind], count: list.length, xp: list.reduce((a, e) => a + e.xp, 0) }
  }).filter(b => b.count > 0)
  return {
    xp,
    level: levelOf(xp),
    streak: { current: st.current, best: st.best, today: st.today },
    week: { xp: since(dayStart(monday)), goal: WEEKLY_GOAL, days: Array.from({ length: 7 }, (_, i) => active.has(monday + i)) },
    month_xp: since(periodStart('month', now)),
    today_xp: since(dayStart(today)),
    breakdown,
    badges: badgesOf(r, events, activity, st.days),
    recent: events.filter(e => e.at > 0).slice(-8).reverse().map(e => ({ at: new Date(e.at).toISOString(), kind: e.kind, xp: e.xp })),
  }
}

/** Points earned from `from` on. */
export const xpSince = (events: XpEvent[], from: number) => events.reduce((a, e) => (e.at >= from ? a + e.xp : a), 0)

export interface BoardRow { learner_id: string; xp: number; name: string }
/** Standard competition ranking (1, 2, 2, 4): equal points share a place. Nobody on zero is ranked. */
export function rank<T extends BoardRow>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.filter(r => r.xp > 0).sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name))
  let place = 0
  return sorted.map((r, i) => {
    if (i === 0 || r.xp !== sorted[i - 1].xp) place = i + 1
    return { ...r, rank: place }
  })
}
