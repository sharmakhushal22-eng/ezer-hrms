// Points, levels, streaks and badges. Each test names what a learner would find unfair if it broke.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { XP, istDay, istHour, levelOf, periodStart, rank, streakOf, summarise, weekStartDay, xpEvents, xpSince, type GameRecords } from '../game-core.ts'

const empty = (): GameRecords => ({ enrollments: [], lessons: [], attempts: [], sessions: [], paths: [], feedback: [] })
/** An IST wall-clock time as an ISO instant. */
const ist = (s: string) => new Date(`${s}+05:30`).toISOString()
const at = (s: string) => new Date(`${s}+05:30`).getTime()

describe('points', () => {
  it('a lesson pays once, even when a retake finishes it again', () => {
    const r = empty()
    r.lessons = [
      { enrollment_id: 'e1', lesson_id: 'L1', completed_at: ist('2026-11-02T10:00:00') },
      { enrollment_id: 'e2', lesson_id: 'L1', completed_at: ist('2026-11-09T10:00:00') },
      { enrollment_id: 'e1', lesson_id: 'L2', completed_at: null },
    ]
    const ev = xpEvents(r)
    assert.equal(ev.length, 1)
    assert.equal(ev[0].xp, XP.lesson)
    assert.equal(ev[0].at, at('2026-11-02T10:00:00'))
  })

  it('a mandatory course finished by its due date earns the on-time bonus; a late one does not', () => {
    const r = empty()
    r.enrollments = [
      { id: 'a', course_id: 'c1', status: 'COMPLETED', mandatory: true, due_at: ist('2026-11-10T23:59:00'), completed_at: ist('2026-11-09T12:00:00') },
      { id: 'b', course_id: 'c2', status: 'COMPLETED', mandatory: true, due_at: ist('2026-11-01T23:59:00'), completed_at: ist('2026-11-03T12:00:00') },
      { id: 'c', course_id: 'c3', status: 'IN_PROGRESS', mandatory: true, due_at: null, completed_at: null },
    ]
    const ev = xpEvents(r)
    assert.equal(ev.filter(e => e.kind === 'course').length, 2)
    assert.equal(ev.filter(e => e.kind === 'ontime').length, 1)
    assert.equal(ev.reduce((a, e) => a + e.xp, 0), 2 * XP.course + XP.ontime)
  })

  it('a quiz pays for the first pass and the first perfect score, not for every attempt', () => {
    const r = empty()
    r.attempts = [
      { enrollment_id: 'e', lesson_id: 'Q', pct: 40, passed: false, submitted_at: ist('2026-11-02T09:00:00') },
      { enrollment_id: 'e', lesson_id: 'Q', pct: 80, passed: true, submitted_at: ist('2026-11-02T09:10:00') },
      { enrollment_id: 'e', lesson_id: 'Q', pct: 100, passed: true, submitted_at: ist('2026-11-02T09:20:00') },
      { enrollment_id: 'e', lesson_id: 'Q', pct: '100', passed: true, submitted_at: ist('2026-11-03T09:20:00') },
    ]
    const ev = xpEvents(r)
    assert.deepEqual(ev.map(e => e.kind).sort(), ['perfect', 'quiz'])
    assert.equal(ev.find(e => e.kind === 'quiz')!.at, at('2026-11-02T09:10:00'))
    assert.equal(ev.find(e => e.kind === 'perfect')!.at, at('2026-11-02T09:20:00'))
  })

  it('a session pays for attending, or for its recording when it was missed, never both', () => {
    const r = empty()
    r.sessions = [
      { session_id: 's1', attended: true, attended_at: ist('2026-11-02T11:00:00'), recording_done: true, recording_last_beat_at: ist('2026-11-03T11:00:00') },
      { session_id: 's2', attended: false, recording_done: true, recording_last_beat_at: ist('2026-11-04T11:00:00') },
      { session_id: 's3', attended: false, recording_done: false },
    ]
    assert.deepEqual(xpEvents(r).map(e => [e.kind, e.xp]), [['live', XP.live], ['recording', XP.recording]])
  })

  it('a completed path pays, and undated records count toward the total but not toward a week', () => {
    const r = empty()
    r.paths = [{ id: 'p', status: 'COMPLETED', completed_at: null }, { id: 'q', status: 'IN_PROGRESS', completed_at: null }]
    const ev = xpEvents(r)
    assert.equal(xpSince(ev, 0), XP.path)
    assert.equal(xpSince(ev, at('2026-11-09T00:00:00')), 0)
  })
})

describe('levels', () => {
  it('starts at Starter and climbs by a growing step', () => {
    assert.equal(levelOf(0).level, 1)
    assert.equal(levelOf(0).name, 'Starter')
    assert.equal(levelOf(99).level, 1)
    assert.equal(levelOf(100).level, 2)
    assert.equal(levelOf(299).level, 2)
    assert.equal(levelOf(300).level, 3)
    assert.equal(levelOf(1000).level, 5)
    const l = levelOf(350)
    assert.equal(l.floor, 300); assert.equal(l.next, 600); assert.equal(l.into, 50); assert.equal(l.need, 250); assert.equal(l.pct, 17)
  })

  it('every amount sits inside its own level, with no gaps or overlaps', () => {
    for (let x = 0; x < 20000; x += 37) {
      const l = levelOf(x)
      assert.ok(l.floor <= x && x < l.next, `xp ${x} lies in level ${l.level}`)
    }
    assert.equal(levelOf(1e7).name, 'Legend')
  })
})

describe('days and streaks (IST)', () => {
  it('11:30 pm and 12:30 am IST are two different days, and the hour is IST', () => {
    assert.equal(istDay(at('2026-11-10T00:30:00')) - istDay(at('2026-11-09T23:30:00')), 1)
    assert.equal(istHour(at('2026-11-09T23:30:00')), 23)
    assert.equal(istHour(at('2026-11-10T07:15:00')), 7)
  })

  it('weeks start on Monday and months on the 1st, in IST', () => {
    // 10 Nov 2026 is a Tuesday.
    const tue = istDay(at('2026-11-10T12:00:00'))
    assert.equal(weekStartDay(tue), istDay(at('2026-11-09T12:00:00')))
    assert.equal(periodStart('week', at('2026-11-10T12:00:00')), at('2026-11-09T00:00:00'))
    assert.equal(periodStart('month', at('2026-11-10T12:00:00')), at('2026-11-01T00:00:00'))
    assert.equal(periodStart('month', at('2026-12-01T00:10:00')), at('2026-12-01T00:00:00'))
    assert.equal(periodStart('all', Date.now()), 0)
  })

  it('a streak survives until a whole day is missed', () => {
    const t = ['2026-11-07T09:00:00', '2026-11-08T21:00:00', '2026-11-09T08:00:00'].map(at)
    const morning = streakOf(t, at('2026-11-10T07:00:00'))
    assert.equal(morning.current, 3); assert.equal(morning.today, false)
    const later = streakOf([...t, at('2026-11-10T19:00:00')], at('2026-11-10T20:00:00'))
    assert.equal(later.current, 4); assert.equal(later.today, true)
    const lost = streakOf(t, at('2026-11-11T09:00:00'))
    assert.equal(lost.current, 0); assert.equal(lost.best, 3)
  })
})

describe('badges and the summary', () => {
  it('earns first steps, early bird and a three-day streak from real activity, and shows progress on the rest', () => {
    const r = empty()
    r.lessons = [
      { enrollment_id: 'e', lesson_id: 'L1', completed_at: ist('2026-11-07T07:10:00') },
      { enrollment_id: 'e', lesson_id: 'L2', completed_at: ist('2026-11-08T13:00:00') },
      { enrollment_id: 'e', lesson_id: 'L3', completed_at: ist('2026-11-09T22:40:00') },
    ]
    r.enrollments = [{ id: 'e', course_id: 'c', status: 'COMPLETED', completed_at: ist('2026-11-09T22:45:00'), category_id: 'cat1' }]
    r.feedback = [{ enrollment_id: 'e', created_at: ist('2026-11-09T22:50:00') }]
    const s = summarise(r, at('2026-11-10T09:00:00'))
    const b = Object.fromEntries(s.badges.map(x => [x.id, x]))
    assert.ok(b.first_lesson.earned_at)
    assert.equal(b.first_lesson.earned_at, ist('2026-11-07T07:10:00'))
    assert.ok(b.early_bird.earned_at)
    assert.ok(b.night_owl.earned_at)
    assert.ok(b.streak_3.earned_at)
    assert.equal(b.streak_7.earned_at, null); assert.equal(b.streak_7.progress, 3)
    assert.equal(b.courses_5.progress, 1)
    assert.equal(b.explorer.progress, 1)
    assert.equal(b.reviewer.progress, 1)
    assert.equal(s.xp, 3 * XP.lesson + XP.course)
    assert.equal(s.streak.current, 3)
    // Monday 9 Nov is in this week, the weekend before it is not.
    assert.equal(s.week.xp, XP.lesson + XP.course)
    assert.deepEqual(s.week.days, [true, false, false, false, false, false, false])
    assert.equal(s.today_xp, 0)
    assert.equal(s.recent[0].kind, 'course')
    assert.deepEqual(s.breakdown.map(x => x.kind).sort(), ['course', 'lesson'])
  })

  it('a learner with nothing yet gets level 1, no streak and every badge unearned', () => {
    const s = summarise(empty(), Date.now())
    assert.equal(s.xp, 0); assert.equal(s.level.level, 1); assert.equal(s.streak.current, 0)
    assert.ok(s.badges.every(b => !b.earned_at && b.progress === 0))
  })
})

describe('the leaderboard', () => {
  it('equal points share a place, and nobody on zero is ranked', () => {
    const r = rank([
      { learner_id: 'a', xp: 300, name: 'Asha' }, { learner_id: 'b', xp: 500, name: 'Bala' },
      { learner_id: 'c', xp: 300, name: 'Chitra' }, { learner_id: 'd', xp: 0, name: 'Dev' }, { learner_id: 'e', xp: 100, name: 'Esha' },
    ])
    assert.deepEqual(r.map(x => [x.learner_id, x.rank]), [['b', 1], ['a', 2], ['c', 2], ['e', 4]])
  })
})
