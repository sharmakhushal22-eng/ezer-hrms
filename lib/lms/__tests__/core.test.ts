// The rules a learner lives under. Each test names what would go wrong for a person.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonths, buildPaper, canSeeCourse, courseState, creditHeartbeat, daysUntil, gradePaper, gradeQuestion,
  isOverdue, learnerPaper, lessonDone, lessonLocks, matchesAudience, mayShowAnswers, mergeRanges, newSegments,
  orderedLessons, pathLocks, pathProgress, publishProblems, questionProblem, quizAvailability, rangesLength,
  shuffled, watchedEnough,
  type LessonLite, type ModuleLite, type ProgressLite, type PublishLesson, type QuestionFull, type VersionRules,
} from '../core.ts'

const rules = (o: Partial<VersionRules> = {}): VersionRules => ({
  order_mode: 'SEQUENTIAL', completion_mode: 'ALL_REQUIRED', completion_pct: 100,
  require_all_quizzes: true, require_final: false, min_overall_pct: null, ...o,
})
const mod = (id: string, position: number, drip: number | null = null): ModuleLite => ({ id, position, unlock_after_days: drip })
const lesson = (id: string, module_id: string, position: number, o: Partial<LessonLite> = {}): LessonLite => ({
  id, module_id, position, kind: 'VIDEO', is_required: true, is_final: false, quiz_id: null, quiz_required: true,
  media_pct: 90, min_seconds: 0, require_ack: false, ...o,
})
const prog = (lesson_id: string, o: Partial<ProgressLite> = {}): ProgressLite => ({
  lesson_id, content_done: true, quiz_passed: false, quiz_best_pct: null, ack_at: null, attempts_used: 0, extra_attempts: 0, ...o,
})
const map = (...p: ProgressLite[]) => new Map(p.map(x => [x.lesson_id, x]))
const NOW = Date.UTC(2026, 10, 1, 6)

const single = (id: string, position = 0, marks = 1): QuestionFull => ({
  id, kind: 'SINGLE', prompt: `Q ${id}`, marks, position, accepted: [], partial_credit: false,
  options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
})
const multi = (partial = false): QuestionFull => ({
  id: 'm', kind: 'MULTI', prompt: 'Pick', marks: 4, position: 0, accepted: [], partial_credit: partial,
  options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: true }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }],
})

describe('watch ranges', () => {
  it('merges overlaps and closes sub-second seek gaps', () => {
    assert.deepEqual(mergeRanges([[10, 20], [0, 5], [5.5, 9], [18, 25]]), [[0, 25]])
    assert.deepEqual(mergeRanges([[0, 5], [8, 9]]), [[0, 5], [8, 9]])
  })
  it('drops nonsense a tampered client could send', () => {
    assert.deepEqual(mergeRanges([[5, 2], [NaN, 3], [-10, 4]]), [[0, 4]])
  })
  it('finds only the seconds not yet covered', () => {
    assert.deepEqual(newSegments([[0, 10], [20, 30]], [[5, 25]]), [[10, 20]])
  })
})

describe('heartbeat credit', () => {
  const base = { have: [] as [number, number][], durationS: 600 }

  it('credits honest playback in full', () => {
    const r = creditHeartbeat({ ...base, claimed: [[0, 15]], elapsedS: 15 })
    assert.equal(r.creditedS, 15)
    assert.equal(r.refusedS, 0)
  })

  it('refuses a forged claim of the whole video in one beat', () => {
    const r = creditHeartbeat({ ...base, claimed: [[0, 600]], elapsedS: 10 })
    assert.equal(r.creditedS, 25)            // 10s × 2 + 5s slack
    assert.equal(r.refusedS, 575)
    assert.equal(r.watchedS, 25)
  })

  it('cannot exceed the video length, even with a claim past the end', () => {
    const r = creditHeartbeat({ have: [[0, 595]], durationS: 600, claimed: [[590, 9000]], elapsedS: 1000 })
    assert.equal(r.watchedS, 600)
  })

  it('rewatching earns nothing new and is not a refusal', () => {
    const r = creditHeartbeat({ have: [[0, 100]], durationS: 600, claimed: [[0, 100]], elapsedS: 1 })
    assert.equal(r.creditedS, 0)
    assert.equal(r.refusedS, 0)
  })

  it('a ten-minute video at the cap still takes five minutes of real time', () => {
    let have: [number, number][] = []
    let beats = 0
    while (rangesLength(have) < 600 && beats < 1000) {
      const end = rangesLength(have)
      have = creditHeartbeat({ have, durationS: 600, claimed: [[end, 600]], elapsedS: 15, slackS: 0 }).ranges
      beats++
    }
    assert.ok(beats * 15 >= 300, `took ${beats * 15}s`)
  })

  it('a clock running backwards grants nothing but the slack', () => {
    assert.equal(creditHeartbeat({ ...base, claimed: [[0, 100]], elapsedS: -500 }).creditedS, 5)
  })

  it('counts the threshold on coverage, not position', () => {
    assert.equal(watchedEnough(539, 600, 90), false)
    assert.equal(watchedEnough(540, 600, 90), true)
    assert.equal(watchedEnough(100, 0, 90), false)
    assert.equal(watchedEnough(100, null, 90), false)
  })
})

describe('a lesson being done', () => {
  it('needs its content', () => {
    assert.equal(lessonDone(lesson('l', 'm', 0), undefined), false)
    assert.equal(lessonDone(lesson('l', 'm', 0), prog('l')), true)
  })
  it('needs the quiz passed when it is required', () => {
    const l = lesson('l', 'm', 0, { quiz_id: 'q' })
    assert.equal(lessonDone(l, prog('l')), false)
    assert.equal(lessonDone(l, prog('l', { quiz_passed: true })), true)
  })
  it('an optional knowledge check does not hold the lesson back', () => {
    assert.equal(lessonDone(lesson('l', 'm', 0, { quiz_id: 'q', quiz_required: false }), prog('l')), true)
  })
  it('an attestation must be given', () => {
    const l = lesson('l', 'm', 0, { require_ack: true })
    assert.equal(lessonDone(l, prog('l')), false)
    assert.equal(lessonDone(l, prog('l', { ack_at: '2026-11-01' })), true)
  })
  it('an assessment has no content to finish', () => {
    const l = lesson('l', 'm', 0, { kind: 'ASSESSMENT', quiz_id: 'q' })
    assert.equal(lessonDone(l, prog('l', { content_done: false, quiz_passed: true })), true)
  })
  it('an optional assessment still has to be sat', () => {
    const l = lesson('l', 'm', 0, { kind: 'ASSESSMENT', quiz_id: 'q', quiz_required: false })
    assert.equal(lessonDone(l, prog('l', { content_done: false })), false)
    assert.equal(lessonDone(l, prog('l', { content_done: false, attempts_used: 1 })), true)
  })
})

describe('locks', () => {
  const mods = [mod('m1', 0), mod('m2', 1)]
  const ls = [lesson('a', 'm1', 0), lesson('b', 'm1', 1), lesson('c', 'm2', 0)]

  it('sequential opens one lesson at a time', () => {
    const l = lessonLocks(rules(), mods, ls, new Map(), null, NOW)
    assert.equal(l.get('a')!.locked, false)
    assert.equal(l.get('b')!.reason, 'PREVIOUS_LESSON')
    assert.equal(l.get('c')!.locked, true)
  })
  it('a finished lesson opens the next', () => {
    assert.equal(lessonLocks(rules(), mods, ls, map(prog('a')), null, NOW).get('b')!.locked, false)
  })
  it('an optional lesson does not block the one after it', () => {
    const list = [lesson('a', 'm1', 0, { is_required: false }), lesson('b', 'm1', 1)]
    assert.equal(lessonLocks(rules(), mods, list, new Map(), null, NOW).get('b')!.locked, false)
  })
  it('free order opens everything', () => {
    const l = lessonLocks(rules({ order_mode: 'FREE' }), mods, ls, new Map(), null, NOW)
    assert.ok([...l.values()].every(x => !x.locked))
  })
  it('module order opens a module at once and holds the next', () => {
    const l = lessonLocks(rules({ order_mode: 'MODULE_SEQUENTIAL' }), mods, ls, new Map(), null, NOW)
    assert.equal(l.get('b')!.locked, false)
    assert.equal(l.get('c')!.reason, 'PREVIOUS_MODULE')
  })
  it('drip holds a module until its day, in any order mode', () => {
    const dripMods = [mod('m1', 0), mod('m2', 1, 7)]
    const started = new Date(NOW - 3 * 86_400_000).toISOString()
    const l = lessonLocks(rules({ order_mode: 'FREE' }), dripMods, ls, new Map(), started, NOW)
    assert.equal(l.get('c')!.reason, 'DRIP')
    assert.ok(l.get('c')!.unlocksAt)
    const later = lessonLocks(rules({ order_mode: 'FREE' }), dripMods, ls, new Map(), new Date(NOW - 8 * 86_400_000).toISOString(), NOW)
    assert.equal(later.get('c')!.locked, false)
  })
  it('the final waits for everything else, even in free order', () => {
    const list = [lesson('a', 'm1', 0), lesson('f', 'm2', 0, { kind: 'ASSESSMENT', quiz_id: 'q', is_final: true })]
    const l = lessonLocks(rules({ order_mode: 'FREE' }), mods, list, new Map(), null, NOW)
    assert.equal(l.get('f')!.reason, 'FINAL_LAST')
  })
  it('final-only lets a learner test out straight away', () => {
    const list = [lesson('a', 'm1', 0), lesson('f', 'm2', 0, { kind: 'ASSESSMENT', quiz_id: 'q', is_final: true })]
    const l = lessonLocks(rules({ order_mode: 'FREE', completion_mode: 'FINAL_ONLY' }), mods, list, new Map(), null, NOW)
    assert.equal(l.get('f')!.locked, false)
  })
  it('orders across modules, not by raw lesson position', () => {
    const out = orderedLessons([mod('m2', 1), mod('m1', 0)], [lesson('x', 'm2', 0), lesson('y', 'm1', 5)])
    assert.deepEqual(out.map(l => l.id), ['y', 'x'])
  })
})

describe('quiz availability', () => {
  const quiz = { max_attempts: 3, cooldown_minutes: 0 }
  it('stays shut until the video is watched', () => {
    assert.equal(quizAvailability({ kind: 'VIDEO' }, quiz, prog('l', { content_done: false }), null, NOW).gate, 'WATCH_FIRST')
  })
  it('an assessment is open straight away', () => {
    assert.equal(quizAvailability({ kind: 'ASSESSMENT' }, quiz, undefined, null, NOW).gate, 'READY')
  })
  it('counts attempts down and locks at zero', () => {
    assert.equal(quizAvailability({ kind: 'VIDEO' }, quiz, prog('l', { attempts_used: 2 }), null, NOW).attemptsLeft, 1)
    assert.equal(quizAvailability({ kind: 'VIDEO' }, quiz, prog('l', { attempts_used: 3 }), null, NOW).gate, 'LOCKED')
  })
  it('extra attempts from HR reopen it', () => {
    assert.equal(quizAvailability({ kind: 'VIDEO' }, quiz, prog('l', { attempts_used: 3, extra_attempts: 1 }), null, NOW).gate, 'READY')
  })
  it('unlimited attempts never lock', () => {
    const a = quizAvailability({ kind: 'VIDEO' }, { max_attempts: null, cooldown_minutes: 0 }, prog('l', { attempts_used: 99 }), null, NOW)
    assert.equal(a.gate, 'READY')
    assert.equal(a.attemptsLeft, null)
  })
  it('makes a learner wait out the cooldown', () => {
    const q = { max_attempts: 3, cooldown_minutes: 30 }
    const last = new Date(NOW - 10 * 60_000).toISOString()
    const a = quizAvailability({ kind: 'VIDEO' }, q, prog('l', { attempts_used: 1 }), last, NOW)
    assert.equal(a.gate, 'COOLDOWN')
    assert.equal(a.retryAt, new Date(NOW + 20 * 60_000).toISOString())
  })
  it('a pass stays a pass', () => {
    assert.equal(quizAvailability({ kind: 'VIDEO' }, quiz, prog('l', { quiz_passed: true, attempts_used: 3 }), null, NOW).gate, 'PASSED')
  })
})

describe('grading', () => {
  it('single choice', () => {
    assert.equal(gradeQuestion(single('q'), 'a'), 1)
    assert.equal(gradeQuestion(single('q'), 'b'), 0)
    assert.equal(gradeQuestion(single('q'), null), 0)
    assert.equal(gradeQuestion(single('q'), ['a'] as any), 0)
  })
  it('multi-select is all or nothing by default', () => {
    assert.equal(gradeQuestion(multi(), ['a', 'b']), 4)
    assert.equal(gradeQuestion(multi(), ['a']), 0)
    assert.equal(gradeQuestion(multi(), ['a', 'b', 'c']), 0)
  })
  it('ticking everything cannot beat partial credit', () => {
    assert.equal(gradeQuestion(multi(true), ['a']), 2)
    assert.equal(gradeQuestion(multi(true), ['a', 'b', 'c']), 2)
    assert.equal(gradeQuestion(multi(true), ['a', 'b', 'c', 'd']), 0)
    assert.equal(gradeQuestion(multi(true), ['c', 'd']), 0)
  })
  it('short text ignores case and spacing but nothing else', () => {
    const q: QuestionFull = { ...single('t'), kind: 'SHORT_TEXT', accepted: ['Two Factor', '2FA'], options: [] }
    assert.equal(gradeQuestion(q, '  two   FACTOR '), 1)
    assert.equal(gradeQuestion(q, '2fa'), 1)
    assert.equal(gradeQuestion(q, 'three factor'), 0)
    assert.equal(gradeQuestion(q, ''), 0)
  })
  it('a blank short answer never matches a blank accepted entry', () => {
    assert.equal(gradeQuestion({ ...single('t'), kind: 'SHORT_TEXT', accepted: [''], options: [] }, '   '), 0)
  })
  it('scores by marks, not by question count', () => {
    const r = gradePaper([{ q: 'a', o: [] }, { q: 'b', o: [] }], [single('a', 0, 1), single('b', 1, 3)], { a: 'b', b: 'a' })
    assert.equal(r.score, 3)
    assert.equal(r.pct, 75)
  })
  it('an answer to a question not on this paper earns nothing', () => {
    const r = gradePaper([{ q: 'a', o: [] }], [single('a'), single('b')], { b: 'a' })
    assert.equal(r.score, 0)
    assert.equal(r.maxScore, 1)
  })
})

describe('papers', () => {
  const pool = [0, 1, 2, 3, 4].map(i => single(`q${i}`, i))
  const quiz = { shuffle_questions: false, shuffle_options: false, draw_count: null }
  let seed = 1
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647

  it('keeps authoring order when nothing is shuffled', () => {
    assert.deepEqual(buildPaper(quiz, pool).map(p => p.q), ['q0', 'q1', 'q2', 'q3', 'q4'])
  })
  it('draws N of the pool without repeats', () => {
    const p = buildPaper({ ...quiz, draw_count: 3 }, pool, rand)
    assert.equal(p.length, 3)
    assert.equal(new Set(p.map(x => x.q)).size, 3)
  })
  it('a draw reaches the whole pool, not just the first questions', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 80; i++) buildPaper({ ...quiz, draw_count: 2 }, pool, rand).forEach(p => seen.add(p.q))
    assert.equal(seen.size, 5)
  })
  it('never reorders True and False', () => {
    const tf: QuestionFull = { ...single('t'), kind: 'TRUE_FALSE', options: [{ id: 'true', text: 'True', correct: true }, { id: 'false', text: 'False' }] }
    for (let i = 0; i < 20; i++) assert.deepEqual(buildPaper({ ...quiz, shuffle_options: true }, [tf], rand)[0].o, ['true', 'false'])
  })
  it('sends the browser no answer key', () => {
    const q = { ...single('q'), accepted: ['secret'], explanation: 'because' }
    const wire = JSON.stringify(learnerPaper(buildPaper(quiz, [q]), [q]))
    assert.ok(!wire.includes('correct'))
    assert.ok(!wire.includes('secret'))
    assert.ok(!wire.includes('because'))
  })
  it('keeps every element when shuffling', () => {
    assert.deepEqual(shuffled([1, 2, 3, 4], rand).sort(), [1, 2, 3, 4])
  })
  it('gates the answers on the quiz setting', () => {
    assert.equal(mayShowAnswers('NEVER', true), false)
    assert.equal(mayShowAnswers('AFTER_PASS', false), false)
    assert.equal(mayShowAnswers('AFTER_PASS', true), true)
    assert.equal(mayShowAnswers('AFTER_SUBMIT', false), true)
  })
})

describe('course completion', () => {
  const quizzes = new Map([['q1', { max_attempts: 2, on_exhausted: 'LOCK' as const }], ['qf', { max_attempts: 2, on_exhausted: 'LOCK' as const }]])
  const ls = [lesson('a', 'm', 0), lesson('b', 'm', 1, { quiz_id: 'q1' }), lesson('opt', 'm', 2, { is_required: false })]

  it('all required lessons, ignoring optional ones', () => {
    const s = courseState(rules(), ls, quizzes, map(prog('a'), prog('b', { quiz_passed: true, quiz_best_pct: 80 })))
    assert.equal(s.complete, true)
    assert.equal(s.progressPct, 100)
    assert.equal(s.scorePct, 80)
  })
  it('a watched video with an unpassed quiz is not complete', () => {
    const s = courseState(rules(), ls, quizzes, map(prog('a'), prog('b')))
    assert.equal(s.complete, false)
    assert.equal(s.progressPct, 50)
  })
  it('a percentage of the content', () => {
    const list = [lesson('a', 'm', 0), lesson('b', 'm', 1), lesson('c', 'm', 2), lesson('d', 'm', 3)]
    const r = rules({ completion_mode: 'PERCENT', completion_pct: 75 })
    assert.equal(courseState(r, list, quizzes, map(prog('a'), prog('b'))).complete, false)
    assert.equal(courseState(r, list, quizzes, map(prog('a'), prog('b'), prog('c'))).complete, true)
  })
  it('passing the final alone, when that is the rule', () => {
    const list = [lesson('a', 'm', 0), lesson('f', 'm', 1, { kind: 'ASSESSMENT', quiz_id: 'qf', is_final: true })]
    const r = rules({ completion_mode: 'FINAL_ONLY' })
    assert.equal(courseState(r, list, quizzes, map(prog('f', { content_done: false, quiz_passed: true, quiz_best_pct: 90 }))).complete, true)
  })
  it('requires the final when configured', () => {
    const list = [lesson('a', 'm', 0), lesson('f', 'm', 1, { kind: 'ASSESSMENT', quiz_id: 'qf', is_final: true, is_required: false })]
    assert.equal(courseState(rules({ require_final: true }), list, quizzes, map(prog('a'))).complete, false)
  })
  it('an overall score floor', () => {
    const list = [lesson('a', 'm', 0, { quiz_id: 'q1' }), lesson('b', 'm', 1, { quiz_id: 'qf' })]
    const r = rules({ min_overall_pct: 80 })
    const low = map(prog('a', { quiz_passed: true, quiz_best_pct: 70 }), prog('b', { quiz_passed: true, quiz_best_pct: 75 }))
    const high = map(prog('a', { quiz_passed: true, quiz_best_pct: 90 }), prog('b', { quiz_passed: true, quiz_best_pct: 75 }))
    assert.equal(courseState(r, list, quizzes, low).complete, false)
    assert.equal(courseState(r, list, quizzes, high).complete, true)
  })
  it('the final score wins over the lesson quizzes', () => {
    const list = [lesson('a', 'm', 0, { quiz_id: 'q1' }), lesson('f', 'm', 1, { kind: 'ASSESSMENT', quiz_id: 'qf', is_final: true })]
    const s = courseState(rules(), list, quizzes, map(prog('a', { quiz_passed: true, quiz_best_pct: 60 }), prog('f', { quiz_passed: true, quiz_best_pct: 90 })))
    assert.equal(s.scorePct, 90)
  })
  it('an empty course never completes', () => {
    assert.equal(courseState(rules(), [], quizzes, new Map()).complete, false)
  })
  it('is blocked when a required quiz runs out of attempts', () => {
    assert.equal(courseState(rules(), ls, quizzes, map(prog('a'), prog('b', { attempts_used: 2 }))).blocked, true)
  })
  it('is not blocked once HR grants another attempt', () => {
    assert.equal(courseState(rules(), ls, quizzes, map(prog('a'), prog('b', { attempts_used: 2, extra_attempts: 1 }))).blocked, false)
  })
  it('a rewatch policy never blocks', () => {
    const q = new Map([['q1', { max_attempts: 2, on_exhausted: 'REWATCH' as const }]])
    assert.equal(courseState(rules(), ls, q, map(prog('b', { attempts_used: 2 }))).blocked, false)
  })
})

describe('paths', () => {
  const items = [{ course_id: 'a', position: 0, is_required: true }, { course_id: 'b', position: 1, is_required: true }, { course_id: 'c', position: 2, is_required: true }]
  it('sequential holds later courses', () => {
    const l = pathLocks('SEQUENTIAL', items, new Set(['a']))
    assert.deepEqual([l.get('a'), l.get('b'), l.get('c')], [false, false, true])
  })
  it('flexible holds nothing', () => {
    assert.ok([...pathLocks('FLEXIBLE', items, new Set()).values()].every(v => v === false))
  })
  it('an optional course does not hold the next', () => {
    const l = pathLocks('SEQUENTIAL', [{ course_id: 'a', position: 0, is_required: false }, { course_id: 'b', position: 1, is_required: true }], new Set())
    assert.equal(l.get('b'), false)
  })
  it('counts progress on required courses', () => {
    assert.deepEqual(pathProgress(items, new Set(['a', 'b', 'c'])), { pct: 100, complete: true })
    assert.equal(pathProgress(items, new Set(['a'])).complete, false)
    assert.equal(pathProgress([], new Set()).complete, false)
  })
})

describe('catalogue visibility', () => {
  const who = { department_id: 'eng', designation: 'Engineer', location_id: 'pune', grade: 'E1', employment_type: 'Employee', employee_category: null, team_name: null }
  it('same kind ORs, different kinds AND', () => {
    assert.equal(matchesAudience([{ kind: 'DEPARTMENT', value: 'eng' }, { kind: 'DEPARTMENT', value: 'sales' }, { kind: 'LOCATION', value: 'pune' }], who), true)
    assert.equal(matchesAudience([{ kind: 'DEPARTMENT', value: 'eng' }, { kind: 'LOCATION', value: 'delhi' }], who), false)
  })
  it('an empty audience shows to nobody, not to everybody', () => {
    assert.equal(matchesAudience([], who), false)
  })
  it('a missing value on the employee does not match', () => {
    assert.equal(matchesAudience([{ kind: 'TEAM', value: 'Core' }], who), false)
  })
  it('an unknown kind fails closed', () => {
    assert.equal(matchesAudience([{ kind: 'WHATEVER', value: 'x' }], who), false)
  })
  it('compares designation without regard to case', () => {
    assert.equal(matchesAudience([{ kind: 'DESIGNATION', value: 'engineer' }], who), true)
  })
  it('published alone is not visible when hidden or restricted', () => {
    assert.equal(canSeeCourse({ status: 'PUBLISHED', visibility: 'EVERYONE' }, [], who), true)
    assert.equal(canSeeCourse({ status: 'PUBLISHED', visibility: 'HIDDEN' }, [], who), false)
    assert.equal(canSeeCourse({ status: 'DRAFT', visibility: 'EVERYONE' }, [], who), false)
    assert.equal(canSeeCourse({ status: 'PUBLISHED', visibility: 'RESTRICTED' }, [{ kind: 'DEPARTMENT', value: 'sales' }], who), false)
  })
})

describe('dates', () => {
  it('overdue means still open past the date', () => {
    assert.equal(isOverdue({ status: 'IN_PROGRESS', due_at: '2026-10-01T00:00:00Z' }, NOW), true)
    assert.equal(isOverdue({ status: 'COMPLETED', due_at: '2026-10-01T00:00:00Z' }, NOW), false)
    assert.equal(isOverdue({ status: 'IN_PROGRESS', due_at: null }, NOW), false)
  })
  it('counts days on the Indian calendar', () => {
    // 20:00 UTC on the 1st is already 01:30 on the 2nd in India.
    assert.equal(daysUntil('2026-11-02T20:00:00Z', Date.UTC(2026, 10, 1, 20)), 1)
    assert.equal(daysUntil('2026-11-01T18:29:59Z', Date.UTC(2026, 10, 1, 6)), 0)
    assert.equal(daysUntil('2026-10-30T06:00:00Z', NOW), -2)
  })
  it('adds months without overflowing short ones', () => {
    assert.equal(addMonths('2026-01-31T10:00:00.000Z', 1).slice(0, 10), '2026-02-28')
    assert.equal(addMonths('2024-01-31T10:00:00.000Z', 1).slice(0, 10), '2024-02-29')
    assert.equal(addMonths('2026-03-15T10:00:00.000Z', 12).slice(0, 10), '2027-03-15')
  })
})

describe('publish checks', () => {
  const pl = (o: Partial<PublishLesson>): PublishLesson => ({
    ...lesson('l', 'm', 0), title: 'One', asset_id: 'a1', asset_ready: true, external_url: null, body: null, ...o,
  })
  const modules = [{ ...mod('m', 0), title: 'Intro' }]

  it('passes a sound course', () => {
    assert.deepEqual(publishProblems(rules(), modules, [pl({})], []), [])
  })
  it('refuses an empty course', () => {
    assert.ok(publishProblems(rules(), [], [], []).some(p => p.includes('at least one lesson')))
  })
  it('refuses a video still uploading', () => {
    assert.ok(publishProblems(rules(), modules, [pl({ asset_ready: false })], [])[0].includes('finished uploading'))
  })
  it('refuses a plain http link', () => {
    assert.ok(publishProblems(rules(), modules, [pl({ kind: 'LINK', asset_id: null, external_url: 'http://x.test' })], [])[0].includes('https://'))
  })
  it('refuses a final-only course with no final', () => {
    assert.ok(publishProblems(rules({ completion_mode: 'FINAL_ONLY' }), modules, [pl({})], []).some(p => p.includes('final')))
  })
  it('refuses a draw larger than the pool', () => {
    const quiz = { id: 'q', title: 'Q', pass_pct: 70, max_attempts: 3, cooldown_minutes: 0, time_limit_minutes: null, shuffle_questions: false, shuffle_options: false, draw_count: 5, show_answers: 'NEVER' as const, on_exhausted: 'LOCK' as const, questions: [single('a')] }
    assert.ok(publishProblems(rules(), modules, [pl({ quiz_id: 'q' })], [quiz]).some(p => p.includes('draws 5')))
  })
  it('catches a question with no right answer', () => {
    assert.equal(questionProblem({ ...single('q'), options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }), 'needs exactly one correct option')
    assert.equal(questionProblem({ ...single('q'), kind: 'MULTI', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }), 'has no correct option')
    assert.equal(questionProblem({ ...single('q'), kind: 'SHORT_TEXT', accepted: [' '] }), 'has no accepted answer')
  })
})
