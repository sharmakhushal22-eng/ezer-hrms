import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lessonWindow, pickPreview, topCourses, trailerWindow, type PreviewAsset, type PreviewLesson } from '../showcase-core.ts'

const asset = (id: string, duration: number | null, extra: Partial<PreviewAsset> = {}): PreviewAsset => ({ id, kind: 'VIDEO', status: 'READY', duration_s: duration, ...extra })
const lesson = (id: string, asset_id: string | null, extra: Partial<PreviewLesson> = {}): PreviewLesson => ({ id, kind: 'VIDEO', asset_id, is_preview: false, position: 0, module_position: 0, ...extra })
const map = (...a: PreviewAsset[]) => new Map(a.map(x => [x.id, x]))

test('a short lesson plays from the start, a long one skips its opening', () => {
  assert.deepEqual(lessonWindow(12), { start: 0, end: 12 })
  assert.deepEqual(lessonWindow(40), { start: 0, end: 20 })
  assert.deepEqual(lessonWindow(300), { start: 30, end: 50 })
  assert.deepEqual(lessonWindow(3600), { start: 45, end: 65 })
  assert.equal(lessonWindow(2), null)
  assert.deepEqual(lessonWindow(null), { start: 0, end: 20 })
})

test('the trailer window stays inside the file', () => {
  assert.deepEqual(trailerWindow(60, 10, 15), { start: 10, end: 25 })
  assert.deepEqual(trailerWindow(20, 10, 30), { start: 10, end: 20 })
  // HR's start is past the end of a replaced, shorter file: play from the beginning.
  assert.deepEqual(trailerWindow(12, 30, 20), { start: 0, end: 12 })
  // Lengths are held between 3 and 90 seconds.
  assert.deepEqual(trailerWindow(500, 0, 400), { start: 0, end: 90 })
  assert.deepEqual(trailerWindow(500, 0, 1), { start: 0, end: 3 })
})

test('an uploaded trailer wins over every lesson', () => {
  const p = pickPreview({ enrolment_mode: 'SELF', trailer_asset_id: 't', trailer_start_s: 5, trailer_len_s: 10 },
    [lesson('l1', 'a1', { is_preview: true })], map(asset('t', 30), asset('a1', 100)), { enrolled: false })
  assert.deepEqual(p, { asset_id: 't', start: 5, end: 15, source: 'TRAILER' })
})

test('a trailer that is not a ready video is ignored', () => {
  const p = pickPreview({ enrolment_mode: 'SELF', trailer_asset_id: 't' }, [lesson('l1', 'a1')],
    map(asset('t', 30, { status: 'UPLOADING' }), asset('a1', 50)), { enrolled: false })
  assert.equal(p?.source, 'LESSON')
  const q = pickPreview({ enrolment_mode: 'SELF', trailer_asset_id: 't' }, [], map(asset('t', 30, { kind: 'IMAGE' })), { enrolled: false })
  assert.equal(q, null)
})

test('a free-preview lesson is used even when the course needs approval', () => {
  const p = pickPreview({ enrolment_mode: 'APPROVAL' }, [lesson('l1', 'a1'), lesson('l2', 'a2', { is_preview: true, position: 3 })],
    map(asset('a1', 50), asset('a2', 50)), { enrolled: false })
  assert.equal(p?.asset_id, 'a2')
  assert.equal(p?.source, 'PREVIEW_LESSON')
})

test('an ordinary lesson is shown only to someone who could open it anyway', () => {
  const lessons = [lesson('l2', 'a2', { position: 1 }), lesson('l1', 'a1', { position: 0 })]
  const assets = map(asset('a1', 50), asset('a2', 50))
  assert.equal(pickPreview({ enrolment_mode: 'APPROVAL' }, lessons, assets, { enrolled: false }), null)
  assert.equal(pickPreview({ enrolment_mode: 'ASSIGN_ONLY' }, lessons, assets, { enrolled: false }), null)
  assert.equal(pickPreview({ enrolment_mode: 'ASSIGN_ONLY' }, lessons, assets, { enrolled: true })?.asset_id, 'a1')
  assert.equal(pickPreview({ enrolment_mode: 'SELF' }, lessons, assets, { enrolled: false })?.asset_id, 'a1')
})

test('lessons are taken in module order, then lesson order', () => {
  const p = pickPreview({ enrolment_mode: 'SELF' }, [lesson('late', 'a1', { module_position: 2, position: 0 }), lesson('early', 'a2', { module_position: 1, position: 5 })],
    map(asset('a1', 50), asset('a2', 50)), { enrolled: false })
  assert.equal(p?.asset_id, 'a2')
})

test('documents and quizzes are never previews', () => {
  const p = pickPreview({ enrolment_mode: 'SELF' }, [lesson('d', 'a1', { kind: 'DOCUMENT', is_preview: true })], map(asset('a1', 50)), { enrolled: false })
  assert.equal(p, null)
})

test('the top ten counts recent starts of visible courses only', () => {
  const now = Date.parse('2026-11-10T00:00:00Z')
  const day = (d: number) => new Date(now - d * 86_400_000).toISOString()
  const rows = [
    { course_id: 'a', enrolled_at: day(1) }, { course_id: 'a', enrolled_at: day(2) },
    { course_id: 'b', enrolled_at: day(3) },
    { course_id: 'c', enrolled_at: day(40) }, { course_id: 'c', enrolled_at: day(41) }, { course_id: 'c', enrolled_at: day(42) },
    { course_id: 'hidden', enrolled_at: day(1) }, { course_id: 'hidden', enrolled_at: day(1) }, { course_id: 'hidden', enrolled_at: day(1) },
    { course_id: 'b', enrolled_at: null },
  ]
  assert.deepEqual(topCourses(rows, new Set(['a', 'b', 'c']), now), ['a', 'b'])
  assert.deepEqual(topCourses(rows, new Set(['a', 'b', 'c']), now, 30, 1), ['a'])
})
