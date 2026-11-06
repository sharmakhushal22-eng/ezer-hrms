// lib/lms/preview.ts — a lesson as its author sees it before anyone learns from it. Server only.
//
// The learner's route hands out file URLs only for an enrolment, and a draft has none. This
// is the author's way to the same files: it needs Learning Content, refuses a course outside
// the person's companies, and records nothing — no progress row, no attempt, no audit entry.
import { fileUrl, mediaUrl, notFound, sb } from './server'
import { inScope, type LmsActor } from './access'
import { issueScormToken } from './scorm'

export async function previewLesson(a: LmsActor, lessonId: string) {
  const { data: l } = await sb.from('lms_lessons').select('id, company_id, kind, title, summary, body, external_url, asset_id, quiz_id, min_seconds, require_ack, ack_text').eq('id', lessonId).maybeSingle()
  if (!l) throw notFound('That lesson')
  inScope(a, l.company_id, 'That lesson')

  let url: string | null = null, poster: string | null = null, mime: string | null = null, name: string | null = null, duration: number | null = null
  // A package previews read-only: it runs, and nothing it reports is kept.
  let scorm: { url: string; version: string; title: string } | null = null
  if (l.kind === 'SCORM' && l.asset_id) {
    const { data: p } = await sb.from('lms_assets').select('version:scorm->>version, launch:scorm->>launch, title:scorm->>title').eq('id', l.asset_id).maybeSingle()
    if (p?.launch) {
      const token = issueScormToken({ a: l.asset_id, c: l.company_id, e: null, l: null, u: a.employeeId || 'preview', n: a.label, r: 1 })
      const [file, query] = String(p.launch).split('?')
      scorm = { url: `/learn-scorm/${token}/${file.split('/').map(encodeURIComponent).join('/')}${query ? `?${query}` : ''}`, version: p.version, title: p.title }
    }
  } else if (l.asset_id) {
    const { data: x } = await sb.from('lms_assets').select('id, kind, storage_path, play_url, play_url_expires_at, poster_path, mime_type, original_name, duration_s').eq('id', l.asset_id).maybeSingle()
    if (x) {
      url = x.kind === 'VIDEO' || x.kind === 'AUDIO' ? await mediaUrl(x as any) : await fileUrl(x.storage_path)
      poster = await fileUrl(x.poster_path)
      mime = x.mime_type; name = x.original_name
      duration = x.duration_s != null ? Number(x.duration_s) : null
    }
  }
  const { data: res } = await sb.from('lms_lesson_resources').select('id, title, url, asset_id').eq('lesson_id', lessonId).order('position')
  const resources = await Promise.all((res || []).map(async (r: any) => {
    if (r.url) return { id: r.id, title: r.title, url: r.url, external: true, name: null as string | null }
    const { data: x } = await sb.from('lms_assets').select('storage_path, original_name').eq('id', r.asset_id).maybeSingle()
    return { id: r.id, title: r.title, url: await fileUrl(x?.storage_path), external: false, name: (x?.original_name as string) || null }
  }))
  let quiz: { title: string; pass_pct: number; questions: number } | null = null
  if (l.quiz_id) {
    const [{ data: q }, { count }] = await Promise.all([
      sb.from('lms_quizzes').select('title, pass_pct').eq('id', l.quiz_id).maybeSingle(),
      sb.from('lms_questions').select('id', { count: 'exact', head: true }).eq('quiz_id', l.quiz_id),
    ])
    if (q) quiz = { title: q.title, pass_pct: q.pass_pct, questions: count || 0 }
  }
  return {
    lesson_id: l.id, kind: l.kind, title: l.title, summary: l.summary, body: l.body, external_url: l.external_url,
    url, poster, mime, file_name: name, duration_s: duration, resources, quiz, scorm,
  }
}
