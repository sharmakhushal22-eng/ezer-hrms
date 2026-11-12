// lib/lms/server.ts — EZER Learn's shared server plumbing. Server only.
//
// Everything runs with the service-role key: the lms_* tables have RLS on and no policy
// (migration 206), so this file and the /api/lms routes are the only way in.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resilientFetch } from '@/lib/resilient-fetch'

export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  // Reads give up on a dead connection after a few seconds and try once more (lib/resilient-fetch).
  // These RPCs only read, so they may be repeated too.
  { auth: { persistSession: false }, global: { fetch: resilientFetch(['lms_audience_preview', 'lms_course_counts', 'lms_overview', 'lms_quiz_stats', 'lms_report_rows', 'lms_reports_of']) } },
)
export const BUCKET = 'lms-content'

/** A refusal or a bad request, carried up to the route. Anything else is a real fault. */
export class LmsError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
export const notFound = (what = 'That') => new LmsError(`${what} was not found.`, 404)

/** The friendly form of "the migration has not been run yet". */
export function setupHint(e: unknown): string | null {
  const m = String((e as any)?.message || e || '')
  // Trailers, My list, points and the webinar room came with 227. Checked before 211, whose
  // pattern would also match the new lms_session_* tables.
  if (/(lms_saved|trailer_|lms_session_(messages|votes|polls|poll_votes)|room_|stream_kind|stream_url|live_started_at|live_ended_at|pinned_message_id|game_enabled|leaderboard_)/i.test(m) && /(does not exist|schema cache|relation|Could not find|violates check)/i.test(m))
    return 'This needs one more database step: run supabase/migrations/227_lms_showcase_game_room.sql in the Supabase SQL editor.'
  // Webinars and SCORM came later (211): say so rather than send someone back to 206.
  if (/(lms_session|lms_sessions|lms_session_attendees|'scorm'|\.scorm|scorm column|lms_(lessons|assets)_kind_check)/i.test(m) && /(does not exist|schema cache|relation|Could not find|violates check)/i.test(m))
    return 'Webinars and SCORM need one more database step: run supabase/migrations/211_lms_live_and_scorm.sql in the Supabase SQL editor.'
  if (/lms_[a-z_]+/.test(m) && /(does not exist|schema cache|relation|Could not find)/i.test(m))
    return 'Learning is not set up yet: run supabase/migrations/206, 207 and 208 in the Supabase SQL editor.'
  if (/Bucket not found/i.test(m)) return 'The storage bucket "lms-content" is missing: run supabase/migrations/206_lms_schema.sql.'
  return null
}

/** One route's error handling: an LmsError says what it says, a missing migration says how
 *  to fix it, and anything else is logged and stays out of the response. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof LmsError) return NextResponse.json({ error: e.message }, { status: e.status })
  const setup = setupHint(e)
  if (setup) return NextResponse.json({ error: setup, setup: true }, { status: 503 })
  console.error('[lms]', e)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

/** Throw on a Supabase error, return its data. */
export function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message || String(r.error))
  return r.data
}

export const clientIp = (req: NextRequest | null | undefined) =>
  req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

export interface AuditEntry {
  companyId: string | null
  actorId?: string | null
  actorLabel?: string | null
  action: string
  entity: string
  entityId?: string | null
  detail?: Record<string, unknown>
  req?: NextRequest | null
}

/** Never the reason an action fails: the action has happened, and a failed audit write is
 *  logged where operations will see it. */
export async function audit(a: AuditEntry): Promise<void> {
  const { error } = await sb.from('lms_audit_log').insert({
    company_id: a.companyId, actor_employee_id: a.actorId || null, actor_label: a.actorLabel || null,
    action: a.action, entity: a.entity, entity_id: a.entityId || null, detail: a.detail || {}, ip: clientIp(a.req),
  })
  if (error) console.error('[lms] audit write failed', a.action, error.message)
}

export interface LmsSettings {
  company_id: string
  enabled: boolean
  default_pass_pct: number
  default_media_pct: number
  default_max_attempts: number | null
  default_due_days: number
  publish_requires_review: boolean
  managers_can_assign: boolean
  managers_see_scores: boolean
  reminder_days_before: number[]
  overdue_every_days: number
  escalate_after_days: number
  email_enabled: boolean
  certificates_enabled: boolean
  cert_title: string
  cert_signatory_name: string | null
  cert_signatory_title: string | null
  preboarding_enabled: boolean
  preboarding_link_days: number
  // Migration 227. Undefined until it is run, and read as on.
  game_enabled?: boolean
  leaderboard_enabled?: boolean
  leaderboard_names?: boolean
}

/** A company's settings, the row being created the first time anyone asks. */
export async function settingsFor(companyId: string): Promise<LmsSettings> {
  const { data, error } = await sb.from('lms_settings').select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw error
  if (data) return data as LmsSettings
  const made = await sb.from('lms_settings').upsert({ company_id: companyId }, { onConflict: 'company_id' }).select('*').single()
  return must(made) as LmsSettings
}

// ── Files ───────────────────────────────────────────────────────────────────
const VIDEO_URL_TTL_S = 24 * 3600
/** A URL is reissued with this much life left, so a long video cannot expire mid-play. */
const VIDEO_URL_MIN_LEFT_S = 6 * 3600
const FILE_URL_TTL_S = 15 * 60

interface AssetRow {
  id: string
  kind: string
  storage_path: string | null
  play_url: string | null
  play_url_expires_at: string | null
}

/** A playable URL for a video or audio file.
 *
 *  One shared URL per file for a day at a time, not one per viewer: the CDN keys on the full
 *  URL, so per-viewer tokens would never hit cache and all playback would bill as uncached
 *  egress. The cost is that a copied URL works for up to a day. Only someone entitled is
 *  ever handed it, and docs/lms/ARCHITECTURE.md records the trade-off. */
export async function mediaUrl(a: AssetRow, now = Date.now()): Promise<string | null> {
  if (!a.storage_path) return null
  const left = a.play_url_expires_at ? (new Date(a.play_url_expires_at).getTime() - now) / 1000 : 0
  if (a.play_url && left > VIDEO_URL_MIN_LEFT_S) return a.play_url
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.storage_path, VIDEO_URL_TTL_S)
  if (error || !data?.signedUrl) return null
  await sb.from('lms_assets').update({
    play_url: data.signedUrl,
    play_url_expires_at: new Date(now + VIDEO_URL_TTL_S * 1000).toISOString(),
  }).eq('id', a.id)
  return data.signedUrl
}

/** A short-lived URL for a document or a download. Documents are small enough that CDN
 *  caching does not matter, so these stay per-request. */
export async function fileUrl(path: string | null | undefined, download?: string | null, seconds = FILE_URL_TTL_S): Promise<string | null> {
  if (!path) return null
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined)
  return data?.signedUrl || null
}

/** Many thumbnails in one request, for a catalogue page. */
export async function fileUrls(paths: string[], seconds = 3600): Promise<Map<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))]
  const out = new Map<string, string>()
  if (!uniq.length) return out
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(uniq, seconds)
  for (const r of data || []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl)
  return out
}

/** TUS must go to the storage hostname for large files, and needs the project's ref. */
export function tusEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const m = base.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)
  return m ? `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable/sign`
           : `${base}/storage/v1/upload/resumable/sign`
}

// ── Paging ──────────────────────────────────────────────────────────────────
/** Every row of a query PostgREST would otherwise cap at 1,000. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, size = 1000, max = 100_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < size) break
  }
  return out
}
