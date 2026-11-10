// lib/lms/showcase-core.ts — which clip a course card plays when the pointer rests on it, and
// which courses make the "Top 10" row. Pure, so the rules are unit-tested
// (lib/lms/__tests__/showcase-core.test.ts) and the server only gathers the rows.
//
// A preview is a window into one video file, played muted and looped by the browser: the
// address carries the file's shared signed URL and the window travels beside it, so no clip is
// ever cut or stored twice. Where the window comes from, in order:
//
//   1. the course's trailer (lms_courses.trailer_asset_id): a short video uploaded for the
//      course, or one of its own lesson files that HR chose, with the start and length HR set;
//   2. a free-preview video lesson: anyone who can see the course may already watch it;
//   3. the first video lesson, but only where the person could open it anyway: the course is
//      open to self-enrolment, or they are already enrolled. A course that needs approval or
//      HR's assignment never shows a lesson before then.
//
// The file behind a signed URL can be downloaded whole, so rule 3's limit is the security
// boundary, not the window.

export interface PreviewCourse {
  enrolment_mode: string
  trailer_asset_id?: string | null
  trailer_start_s?: number | string | null
  trailer_len_s?: number | null
}
export interface PreviewLesson { id: string; kind: string; asset_id: string | null; is_preview: boolean; position: number; module_position: number }
export interface PreviewAsset { id: string; kind: string; status: string; duration_s: number | string | null }
export interface PreviewPick { asset_id: string; start: number; end: number; source: 'TRAILER' | 'PREVIEW_LESSON' | 'LESSON' }

/** The default window into a lesson: skip the opening titles of a long video, never run past the end. */
export const DEFAULT_CLIP_S = 20
const MIN_CLIP_S = 3

export function lessonWindow(duration: number | null, len = DEFAULT_CLIP_S): { start: number; end: number } | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return { start: 0, end: len }
  if (duration < MIN_CLIP_S) return null
  const start = duration > 60 ? Math.round(Math.min(duration * 0.1, 45)) : 0
  return { start, end: Math.min(duration, start + len) }
}

/** HR's window into the trailer, kept inside the file. */
export function trailerWindow(duration: number | null, start: number, len: number): { start: number; end: number } | null {
  const s = Math.max(0, Number(start) || 0)
  const l = Math.max(MIN_CLIP_S, Math.min(90, Number(len) || DEFAULT_CLIP_S))
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return { start: s, end: s + l }
  if (duration < MIN_CLIP_S) return null
  // A start past the end (the file was replaced by a shorter one) falls back to the beginning.
  const from = s < duration - MIN_CLIP_S ? s : 0
  return { start: from, end: Math.min(duration, from + l) }
}

export function pickPreview(c: PreviewCourse, lessons: PreviewLesson[], assets: Map<string, PreviewAsset>, opts: { enrolled: boolean }): PreviewPick | null {
  const usable = (id: string | null | undefined): PreviewAsset | null => {
    const a = id ? assets.get(id) : undefined
    return a && a.kind === 'VIDEO' && a.status === 'READY' ? a : null
  }
  const len = (a: PreviewAsset) => (a.duration_s == null ? null : Number(a.duration_s))

  const t = usable(c.trailer_asset_id)
  if (t) {
    const w = trailerWindow(len(t), Number(c.trailer_start_s) || 0, c.trailer_len_s ?? DEFAULT_CLIP_S)
    if (w) return { asset_id: t.id, ...w, source: 'TRAILER' }
  }
  const ordered = [...lessons].filter(x => x.kind === 'VIDEO').sort((a, b) => a.module_position - b.module_position || a.position - b.position)
  const free = ordered.find(x => x.is_preview && usable(x.asset_id))
  if (free) {
    const w = lessonWindow(len(usable(free.asset_id)!))
    if (w) return { asset_id: free.asset_id!, ...w, source: 'PREVIEW_LESSON' }
  }
  if (c.enrolment_mode === 'SELF' || opts.enrolled) {
    const first = ordered.find(x => usable(x.asset_id))
    if (first) {
      const w = lessonWindow(len(usable(first.asset_id)!))
      if (w) return { asset_id: first.asset_id!, ...w, source: 'LESSON' }
    }
  }
  return null
}

/** The ten courses people started most in the last `days`, most first. A course nobody started
 *  in that time does not rank, so a quiet catalogue shows a short list rather than a padded one. */
export function topCourses(enrolments: { course_id: string; enrolled_at: string | null }[], visible: Set<string>, now = Date.now(), days = 30, n = 10): string[] {
  const since = now - days * 86_400_000
  const count = new Map<string, number>()
  for (const e of enrolments) {
    if (!visible.has(e.course_id) || !e.enrolled_at || new Date(e.enrolled_at).getTime() < since) continue
    count.set(e.course_id, (count.get(e.course_id) || 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([id]) => id)
}
