'use client'
// components/learning/shared.tsx — what every EZER Learn screen shares: words for dates and
// statuses, the small visual pieces, and the one stylesheet.
//
// Styling is inline tokens like the rest of the product. LearnStyles exists only for what
// inline styles cannot say (media queries, :hover), and everything in it is a var(--ez-*).
import type { CSSProperties, ReactNode } from 'react'
import { C, F, W, S, R, E, tone, numeric, Badge, Button, Card, IconAlert, IconLearning, IconLetters, type IconProps, type Tone } from '@/lib/ui'
import { daysUntil } from '@/lib/lms/core'
import { LmsApiError } from '@/lib/lms/client'

// ── Shapes the API sends ────────────────────────────────────────────────────
export interface CourseCardData {
  id: string; code?: string; title: string; summary?: string | null; category_id?: string | null
  difficulty?: string | null; est_minutes?: number | null; language?: string | null
  tags?: string[] | null; skills?: string[] | null; is_compliance?: boolean; thumbnail?: string | null
}
export interface LearnItem {
  id: string; course_id: string; status: string; mandatory: boolean; priority?: string; due_at: string | null
  progress_pct: number; score_pct: number | null; source?: string; cycle_no?: number; started_at?: string | null
  completed_at: string | null; expires_at: string | null; last_activity_at?: string | null
  course: CourseCardData | null; overdue: boolean; days_left: number | null
}
export interface LearnPath { id: string; path_id: string; status: string; due_at: string | null; progress_pct: number; title: string; order_mode?: string }
export interface Dashboard {
  enabled: boolean; name?: string; kind?: 'EMPLOYEE' | 'CANDIDATE'
  counts?: { assigned: number; mandatory: number; overdue: number; in_progress: number; completed: number }
  mandatory?: LearnItem[]; optional?: LearnItem[]; continue?: LearnItem[]; upcoming?: LearnItem[]
  overdue?: LearnItem[]; completed?: LearnItem[]; pending?: LearnItem[]; paths?: LearnPath[]
}

/** One lesson as the player sees it (lessonForClient in lib/lms/engine.ts). */
export interface PlayerQuiz {
  id: string; title: string; instructions: string | null; pass_pct: number; required: boolean; time_limit_minutes: number | null
  max_attempts: number | null; gate: 'READY' | 'WATCH_FIRST' | 'PASSED' | 'COOLDOWN' | 'LOCKED'; attempts_left: number | null
  retry_at: string | null; best_pct: number | null; passed: boolean; on_exhausted: string; open_attempt: boolean
}
export interface PlayerLesson {
  id: string; module_id: string; title: string; summary: string | null; kind: string; position: number; is_required: boolean; is_final: boolean
  est_minutes: number | null; require_ack: boolean; ack_text: string | null; allow_skip_ahead: boolean; media_pct: number; min_seconds: number
  locked: boolean; lock_reason: string | null; unlocks_at: string | null; done: boolean; content_done: boolean; ack_at: string | null
  watched_pct: number; position_s: number; quiz: PlayerQuiz | null
}
export interface PlayerView {
  enrollment: { id: string; status: string; mandatory: boolean; due_at: string | null; overdue: boolean; started_at: string | null; completed_at: string | null; expires_at: string | null; progress_pct: number; score_pct: number | null; cycle_no: number; last_lesson_id: string | null }
  course: { id: string; code: string; title: string; summary: string | null; description: string | null; certificate_enabled: boolean }
  gate: string | null
  rules: { order_mode: string; completion_mode: string; completion_pct: number; require_final: boolean; min_overall_pct: number | null; version_no: number }
  modules: { id: string; title: string; summary: string | null; position: number }[]
  lessons: PlayerLesson[]
  state: { progress_pct: number; done: number; total: number; score_pct: number | null }
  certificate: { id: string; cert_no: string } | null
  feedback: { rating: number; comment: string | null } | null
  read_only: boolean
}
export interface OpenedLesson {
  lesson_id: string; url: string | null; poster: string | null; duration_s: number | null; mime: string | null; file_name: string | null
  body: string | null; external_url: string | null; resources: { id: string; title: string; url: string | null; external: boolean }[]
  position_s: number; watched_ranges: [number, number][]; dwell_left_s?: number
}
export interface QuizPaper {
  attempt_id: string; attempt_no: number; title: string; instructions: string | null; pass_pct: number; seconds_left: number | null
  questions: { id: string; kind: 'SINGLE' | 'MULTI' | 'TRUE_FALSE' | 'SHORT_TEXT'; prompt: string; marks: number; options: { id: string; text: string }[] }[]
  answers: Record<string, string | string[]>
}
export interface QuizOutcome {
  pct: number; score: number; max_score: number; passed: boolean; late: boolean; pass_pct: number; attempts_left: number | null
  sent_back: boolean; locked: boolean; cooldown_minutes: number; course: { status: string; progress_pct: number; score_pct: number | null } | null
  review: { question_id: string; prompt: string; kind: string; explanation: string | null; correct: boolean; earned: number; marks: number; your_answer: string | string[] | null; options: { id: string; text: string; correct: boolean }[]; accepted?: string[] }[] | null
}

// ── Words ───────────────────────────────────────────────────────────────────
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const firstName = (s?: string | null) => String(s || '').trim().split(/\s+/)[0] || ''

const IST = 'Asia/Kolkata'
export const dayWords = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }) : ''
export const shortDay = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short' }) : ''
export const timeWords = (s?: string | null) =>
  s ? new Date(s).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' }) : ''

export const durationWords = (min?: number | null) => {
  if (!min || min <= 0) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** "Due in 3 days", "2 days overdue". Calendar days in IST, the same reading as the server. */
export function dueWords(dueAt: string | null | undefined, now = Date.now()): { text: string; t: Tone } | null {
  if (!dueAt) return null
  const d = daysUntil(dueAt, now)
  if (new Date(dueAt).getTime() < now) return { text: d === 0 ? 'Was due today' : `${plural(-d, 'day')} overdue`, t: 'critical' }
  if (d === 0) return { text: 'Due today', t: 'warning' }
  if (d === 1) return { text: 'Due tomorrow', t: 'warning' }
  return { text: `Due in ${d} days`, t: d <= 3 ? 'warning' : 'neutral' }
}

export const LEVEL: Record<string, string> = { BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced' }

export const STATUS: Record<string, { label: string; t: Tone }> = {
  NOT_STARTED: { label: 'Not started', t: 'neutral' },
  IN_PROGRESS: { label: 'In progress', t: 'brand' },
  FAILED: { label: 'Attempts used up', t: 'critical' },
  COMPLETED: { label: 'Completed', t: 'positive' },
  EXPIRED: { label: 'Expired', t: 'warning' },
  WAIVED: { label: 'Waived', t: 'neutral' },
  PENDING_APPROVAL: { label: 'Waiting for approval', t: 'warning' },
  REJECTED: { label: 'Declined', t: 'neutral' },
  CANCELLED: { label: 'Cancelled', t: 'neutral' },
}

export const KIND_WORD: Record<string, string> = {
  VIDEO: 'Video', AUDIO: 'Audio', DOCUMENT: 'Document', SLIDES: 'Slides', ARTICLE: 'Reading', LINK: 'Link', ASSESSMENT: 'Assessment',
}

/** API messages are written for people already, so they are shown as they are. */
export const errorWords = (e: unknown) => {
  if (e instanceof LmsApiError) return e.message
  return 'We could not reach the server. Check your connection and try again.'
}

/** Only a web address becomes a link: never javascript: or anything else a field may hold. */
export const webUrl = (s?: string | null) => (s && /^https?:\/\//i.test(s.trim()) ? s.trim() : null)

// ── Stylesheet ──────────────────────────────────────────────────────────────
const CSS = `
.ezl{font-family:"DM Sans","Segoe UI",system-ui,sans-serif;font-size:14px;color:var(--ez-ink);min-width:0;overflow-wrap:anywhere;--ezl-top:12px}
.ezl-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ezl-hover{transition:border-color .14s ease,background .14s ease}
.ezl-hover:hover{border-color:var(--ez-line-strong)}
.ezl-opt:hover{background:var(--ez-sunken)}
.ezl-opt:has(input:checked){background:var(--ez-brand-tint);border-color:var(--ez-brand-edge)}
.ezl-linkbtn{display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--ez-brand);cursor:pointer;text-decoration:none}
.ezl-linkbtn:hover{text-decoration:underline}

.ezl-dash{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:${S.xl}px;align-items:start}
.ezl-dash[data-side="0"]{grid-template-columns:minmax(0,1fr)}
.ezl-col{display:grid;gap:${S.xl}px;min-width:0}
.ezl-row{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:${S.md}px ${S.lg}px;align-items:center}
.ezl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:${S.md}px}
.ezl-filters{display:grid;grid-template-columns:minmax(200px,1.6fr) repeat(4,minmax(0,1fr));gap:${S.sm}px}
.ezl-counts{display:flex;gap:${S.xl}px}
.ezl-info{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:${S.xl}px;align-items:start}
.ezl-info-side{position:sticky;top:var(--ezl-top)}
.ezl-team-row{display:grid;grid-template-columns:minmax(0,1fr) auto 24px;gap:${S.md}px;align-items:center}
.ezl-metrics{display:grid;grid-template-columns:repeat(5,64px);gap:2px;text-align:center}
.ezl-two{display:grid;grid-template-columns:1fr 1fr;gap:${S.md}px}

.ezl-player{display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"head head" "main nav";gap:${S.lg}px ${S.xl}px;align-items:start}
.ezl-player-head{grid-area:head;min-width:0}
.ezl-player-main{grid-area:main;min-width:0;display:grid;gap:${S.lg}px}
.ezl-player-main>*{min-width:0}
.ezl-player-nav{grid-area:nav;position:sticky;top:var(--ezl-top);max-height:calc(100vh - var(--ezl-top) - 16px);overflow:auto;min-width:0}
.ezl-navtoggle{display:none}
.ezl-navlist{display:grid;gap:${S.sm}px;padding:${S.sm}px}
.ezl-navrow{transition:background .14s ease}
.ezl-navrow:hover:not(:disabled){background:var(--ez-sunken)}
.ezl-pdf{max-height:72vh;overflow:auto}
.ezl-quizbar{position:sticky;top:var(--ezl-top);z-index:2}

@media (max-width:980px){
  .ezl-dash{display:flex;flex-direction:column;align-items:stretch}
  .ezl-col{display:contents}
  .ezl-info{grid-template-columns:minmax(0,1fr)}
  .ezl-info-side{position:static;order:-1}
  .ezl-player{grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "nav" "main"}
  .ezl-player-nav{position:static;max-height:none;overflow:visible}
  .ezl-navtoggle{display:flex}
  .ezl-navlist[data-open="0"]{display:none}
}
@media (max-width:720px){
  .ezl button,.ezl select,.ezl textarea,.ezl input:not([type="checkbox"]):not([type="radio"]),.ezl a.ezl-tap{min-height:42px}
  .ezl .ess-seg button{height:42px;padding:0 11px}
  .ezl-linkbtn{min-height:42px}
  .ezl-row{grid-template-columns:56px minmax(0,1fr)}
  .ezl-row-action{grid-column:1 / -1}
  .ezl-row-action>button{width:100%}
  .ezl-filters{grid-template-columns:1fr 1fr}
  .ezl-filters>:first-child{grid-column:1 / -1}
  .ezl-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:${S.sm}px;width:100%}
  .ezl-grid{grid-template-columns:minmax(0,1fr)}
  .ezl-two{grid-template-columns:minmax(0,1fr)}
  .ezl-team-row{grid-template-columns:minmax(0,1fr) 24px}
  .ezl-metrics{grid-column:1 / -1;grid-row:2;grid-template-columns:repeat(5,minmax(0,1fr))}
  .ezl-pdf{max-height:none}
}
`
export function LearnStyles() { return <style>{CSS}</style> }

// ── Pieces ──────────────────────────────────────────────────────────────────
export function ProgressBar({ pct, height = 6, t, label }: { pct: number; height?: number; t?: Tone; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  const fill = t ? tone(t).fg : v >= 100 ? C.positive : C.brand
  return (
    <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Progress'}
      style={{ height, borderRadius: R.pill, background: C.sunken, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ width: `${v}%`, height: '100%', background: fill, borderRadius: R.pill, transition: 'width .3s ease' }} />
    </div>
  )
}

/** A course's picture, or a plain tile when HR did not give it one. */
export function CourseTile({ src, ratio = '4 / 3', radius = R.md, size = 22 }: { src?: string | null; ratio?: string; radius?: number; size?: number }) {
  const frame: CSSProperties = { width: '100%', aspectRatio: ratio, borderRadius: radius, display: 'block', flexShrink: 0 }
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" loading="lazy" style={{ ...frame, objectFit: 'cover', background: C.sunken }} />
  return <div aria-hidden style={{ ...frame, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center' }}><IconLearning size={size} /></div>
}

export function DueBadge({ dueAt, overdue, status }: { dueAt: string | null | undefined; overdue?: boolean; status?: string }) {
  if (status && ['COMPLETED', 'EXPIRED', 'WAIVED'].includes(status)) return null
  const d = dueWords(dueAt)
  if (!d) return null
  return <Badge t={overdue ? 'critical' : d.t}>{d.text}</Badge>
}

export function SectionHead({ title, count, hint, t, action }: { title: string; count?: number; hint?: string; t?: Tone; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.md, marginBottom: S.sm, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: F.lead, fontWeight: W.semi, color: t ? tone(t).fg : C.ink, letterSpacing: '-.01em' }}>
        {title}{count != null && <span style={{ marginLeft: 6, fontSize: F.small, fontWeight: W.medium, color: t ? tone(t).fg : C.muted, ...numeric }}>{count}</span>}
      </h2>
      {hint && <span style={{ fontSize: F.tiny, color: C.muted }}>{hint}</span>}
      {action}
    </div>
  )
}

/** A quiet full-card message: setup, switched off, or nothing to show. Never reads as a crash. */
export function CalmMessage({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Card style={{ textAlign: 'center', padding: `${S.huge}px ${S.xl}px` }}>
      <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: R.lg, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center' }}>{icon || <IconLearning size={22} />}</div>
      <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink }}>{title}</div>
      {children && <div style={{ margin: '6px auto 0', maxWidth: 420, fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>{children}</div>}
      {action && <div style={{ marginTop: S.lg }}>{action}</div>}
    </Card>
  )
}

export function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ display: 'flex', gap: S.md, alignItems: 'center', flexWrap: 'wrap', background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: `${S.md}px ${S.lg}px`, fontSize: F.small, color: C.inkSoft }}>
      <span style={{ color: C.critical, flexShrink: 0 }}><IconAlert size={16} /></span>
      <span style={{ flex: 1, minWidth: 180 }}>{message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/** The product's mark on the two pages that have no shell of their own. */
export function LearnMark({ sub }: { sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: R.md, background: C.brand, color: C.onAccent, display: 'grid', placeItems: 'center', boxShadow: E.flat }}><IconLearning size={18} /></div>
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontWeight: W.bold, fontSize: F.lead, color: C.ink, letterSpacing: '-.01em' }}>EZER <span style={{ color: C.brand }}>Learn</span></div>
        {sub && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Icons the shared set does not have. Same construction: 20x20, stroke 1.6, round. ─────
function Glyph({ size = 16, children }: { size?: number; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>{children}</svg>
}
export const IconPlay = (p: IconProps) => <Glyph size={p.size}><path d="M6 4.2v11.6L15.5 10 6 4.2Z" /></Glyph>
export const IconAudio = (p: IconProps) => <Glyph size={p.size}><path d="M3.5 11.5V10a6.5 6.5 0 0 1 13 0v1.5" /><rect x="2.5" y="11" width="3.5" height="5.5" rx="1.2" /><rect x="14" y="11" width="3.5" height="5.5" rx="1.2" /></Glyph>
export const IconSlides = (p: IconProps) => <Glyph size={p.size}><rect x="2.5" y="3.5" width="15" height="10.5" rx="1.5" /><path d="M10 14v2.5M7 16.5h6" /></Glyph>
export const IconExternal = (p: IconProps) => <Glyph size={p.size}><path d="M11 3.5h5.5V9M16.5 3.5 9 11" /><path d="M14.5 12v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H8" /></Glyph>
export const IconQuiz = (p: IconProps) => <Glyph size={p.size}><rect x="3.5" y="2.5" width="13" height="15" rx="2" /><path d="m6.5 8 1.3 1.3L10.2 7M12.5 8.5H14M6.8 13h6.7" /></Glyph>
export const IconBack = (p: IconProps) => <Glyph size={p.size}><path d="M12 15.5 6.5 10 12 4.5" /></Glyph>
export const IconForward = (p: IconProps) => <Glyph size={p.size}><path d="M8 4.5 13.5 10 8 15.5" /></Glyph>

export function IconStar({ size = 14, filled }: { size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}><path d="m10 2.6 2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.4l-4.6 2.5.9-5.2L2.5 8.1l5.2-.7L10 2.6Z" /></svg>
}

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = { VIDEO: IconPlay, AUDIO: IconAudio, DOCUMENT: IconLetters, SLIDES: IconSlides, ARTICLE: IconLetters, LINK: IconExternal, ASSESSMENT: IconQuiz }[kind] || IconLetters
  return <Icon size={size} />
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span role="img" aria-label={`${value} out of 5`} style={{ display: 'inline-flex', gap: 1, color: C.warning }}>
      {[1, 2, 3, 4, 5].map(n => <IconStar key={n} size={size} filled={n <= Math.round(value)} />)}
    </span>
  )
}
