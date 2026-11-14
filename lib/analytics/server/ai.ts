// lib/analytics/server/ai.ts — asking a model to write a piece, once, and remembering it.
//
// ── WHICH MODEL, WHICH KEY ────────────────────────────────────────────────────
//
// The keys the other AI features already use. Production holds GEMINI_API_KEY (resume
// screening reads it); the PMS and onboarding routes read GOOGLE_GENERATIVE_AI_API_KEY.
// Either works here. Gemini models are tried in order — the list app/api/pms/
// training-ai measured: one name retires, another is busy — and Claude answers if
// ANTHROPIC_API_KEY is set and every Gemini model failed. No key: the reader gets the
// template version of the same piece (lib/analytics/briefs.ts), which never needed one.
//
// ── WHAT IT COSTS, AND WHY IT IS NOT PAID FOR TWICE ───────────────────────────
//
// One call per page view would be wasteful: the figures barely move in an hour. So:
//   * the same facts (same fingerprint) are never sent twice — the answer is reused;
//   * a different fingerprint for the same scope reuses the last answer while it is
//     younger than the scope's TTL, marked "written at …" so nobody mistakes it for live;
//   * "Refresh" writes a new one, at most REFRESH_PER_HOUR times per person;
//   * no person can cause more than GEN_PER_HOUR fresh calls an hour, whatever they click.
// Answers live in memory and, when migration 231 has been run, in analytics_ai_brief,
// so every server instance shares them. Without the table everything still works.

import crypto from 'node:crypto'
import { sb } from './db.ts'
import type { AiResponse, AiAudience } from '../ai/types.ts'
import { TASK_VERSION, type Task, type TaskKind } from '../ai/tasks.ts'

const GEMINI_MODELS = [process.env.ANALYTICS_AI_MODEL, 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite']
  .filter((m, i, a): m is string => !!m && a.indexOf(m) === i)
const CLAUDE_MODEL = 'claude-opus-5-5'

/** One model attempt. A briefing is not worth a two-minute spinner. */
const ATTEMPT_MS = 25_000
/** Stop trying further models once this much time has gone. */
const TOTAL_MS = 40_000

/** How long a written piece is reused when the figures have moved a little. */
const TTL_MS: Record<TaskKind, number> = { briefing: 6 * 3600_000, explain: 6 * 3600_000, monday: 4 * 3600_000, summary: 12 * 3600_000 }
const REFRESH_PER_HOUR = 6
const GEN_PER_HOUR = 30

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || ''
export const aiConfigured = () => !!(geminiKey() || process.env.ANTHROPIC_API_KEY)

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

async function timed(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) } catch { return null } finally { clearTimeout(t) }
}

type Asked = { text: string; model: string; tokens: { in: number; out: number } } | { failed: 'NO_KEY' | 'UNAVAILABLE' }

/** Where Gemini is called. Overridable so the call can go through a gateway or a
 *  proxy (or, on a laptop, a local stand-in); unset in production. */
const GEMINI_BASE = (process.env.ANALYTICS_AI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')
/** A local stand-in model (testing on a laptop) answers into memory only — never into
 *  the shared table, where a real deployment would read it back as the model's words. */
const STAND_IN = !/googleapis\.com/.test(GEMINI_BASE)

async function gemini(model: string, key: string, system: string, user: string, thinking: boolean, ms: number) {
  return timed(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        // A little thinking helps connect facts across areas; "low" keeps it quick.
        ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
      },
    }),
  }, ms)
}

export async function askModel(system: string, user: string): Promise<Asked> {
  const started = Date.now()
  const left = () => Math.min(ATTEMPT_MS, TOTAL_MS - (Date.now() - started))
  let tried = false
  const key = geminiKey()
  for (const model of key ? GEMINI_MODELS : []) {
    if (left() < 5_000) break
    tried = true
    let r = await gemini(model, key, system, user, true, left())
    // An older model may not know thinkingLevel: ask once more without it.
    if (r && r.status === 400) r = await gemini(model, key, system, user, false, left())
    if (r?.ok) {
      const j = await r.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } } | null
      const text = (j?.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('')
      const u = j?.usageMetadata
      if (text.trim()) return { text, model, tokens: { in: u?.promptTokenCount ?? 0, out: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) } }
    } else {
      console.error(`[analytics-ai] ${model} unavailable:`, r ? `${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}` : 'timed out')
    }
  }

  const anthropic = process.env.ANTHROPIC_API_KEY
  if (anthropic && left() >= 5_000) {
    tried = true
    const r = await timed('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 4096, system,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: user }],
      }),
    }, left())
    if (r?.ok) {
      const j = await r.json().catch(() => null) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null
      const text = j?.stop_reason === 'refusal' ? '' : (j?.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
      if (text.trim()) return { text, model: CLAUDE_MODEL, tokens: { in: j?.usage?.input_tokens ?? 0, out: j?.usage?.output_tokens ?? 0 } }
    } else {
      console.error('[analytics-ai] claude unavailable:', r ? `${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}` : 'timed out')
    }
  }
  return { failed: tried ? 'UNAVAILABLE' : 'NO_KEY' }
}

// ── Remembering answers ───────────────────────────────────────────────────────

interface Stored { fingerprint: string; result: unknown; at: number }
const memory = new Map<string, Stored>()
const inflight = new Map<string, Promise<AiResponse<unknown>>>()
const usage = new Map<string, { gen: number[]; refresh: number[] }>()

/** True when the analytics_ai_brief table (migration 231) is missing — then we stop asking. */
let noTable = false

async function readStored(scope: string): Promise<Stored | null> {
  const m = memory.get(scope)
  if (m || noTable || STAND_IN) return m ?? null
  const { data, error } = await sb.from('analytics_ai_brief').select('fingerprint, brief, created_at').eq('scope_hash', scope).order('created_at', { ascending: false }).limit(1)
  if (error) { if (/does not exist|schema cache|relation/i.test(error.message)) noTable = true; return null }
  const row = (data || [])[0] as { fingerprint: string; brief: unknown; created_at: string } | undefined
  if (!row) return null
  const s = { fingerprint: row.fingerprint, result: row.brief, at: Date.parse(row.created_at) }
  memory.set(scope, s)
  return s
}

async function store(scope: string, audience: AiAudience, s: Stored, model: string, actor: string | null, tokens: { in: number; out: number }) {
  memory.set(scope, s)
  if (memory.size > 800) memory.delete(memory.keys().next().value as string)
  if (noTable || STAND_IN) return
  const { error } = await sb.from('analytics_ai_brief').insert({
    scope_hash: scope, audience, fingerprint: s.fingerprint, brief: s.result, model,
    input_tokens: tokens.in, output_tokens: tokens.out, created_by: actor,
  })
  if (error && /does not exist|schema cache|relation/i.test(error.message)) noTable = true
  else if (error) console.error('[analytics-ai] answer not stored:', error.message)
}

function allow(actor: string, refresh: boolean): boolean {
  const now = Date.now(), hour = 3600_000
  const u = usage.get(actor) ?? { gen: [], refresh: [] }
  u.gen = u.gen.filter(t => now - t < hour); u.refresh = u.refresh.filter(t => now - t < hour)
  usage.set(actor, u)
  if (u.gen.length >= GEN_PER_HOUR) return false
  if (refresh && u.refresh.length >= REFRESH_PER_HOUR) return false
  u.gen.push(now); if (refresh) u.refresh.push(now)
  return true
}

const MESSAGES = {
  off: 'AI is not switched on for this installation, so this was written from the figures by fixed rules. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) for the AI version.',
  busy: 'The AI service did not answer in time, so this was written from the figures by fixed rules. Try again in a minute.',
  empty: 'The AI answer did not pass the number check, so the rule-written version is shown.',
  limited: 'You have asked for fresh AI writing several times this hour. The latest version is shown.',
} as const

/**
 * A written piece: the AI version from memory when it can be, from the model when it
 * must, and the template `fallback` whenever there is no AI version to give. `actor`
 * is whoever is asking — for the throttle and the audit column. `cron` skips the
 * per-person throttle (a scheduled run writes one piece per recipient).
 */
export async function runTask<T>(task: Task<T>, fallback: T, opts: { actor: string | null; refresh?: boolean; cron?: boolean }): Promise<AiResponse<T>> {
  const audience = task.pack.audience
  if (!task.pack.facts.length) return { status: 'empty', result: fallback, cached: false, stale: false, message: 'There are no figures here yet.' }
  const scope = sha(`${TASK_VERSION}|${task.kind}|${task.pack.scopeKey}`)
  const fingerprint = sha([TASK_VERSION, task.kind, task.user.replace(/Today is [^.]*\./, '')].join('\n'))
  const prior = await readStored(scope)
  const old = (stale: boolean) => ({ result: (prior?.result as T) ?? fallback, cached: !!prior, stale: !!prior && stale })

  if (prior && !opts.refresh) {
    const same = prior.fingerprint === fingerprint
    if (same || Date.now() - prior.at < TTL_MS[task.kind]) return { status: 'ok', result: prior.result as T, cached: true, stale: !same }
  }
  if (!aiConfigured()) return { status: 'off', ...old(true), message: MESSAGES.off }
  if (!opts.cron && !allow(opts.actor || 'anonymous', !!opts.refresh)) return { status: prior ? 'ok' : 'limited', ...old(prior?.fingerprint !== fingerprint), message: MESSAGES.limited }

  // Two tabs asking for the same picture at once share one call.
  const key = `${scope}|${fingerprint}`
  const running = inflight.get(key)
  if (running) return running as Promise<AiResponse<T>>
  const job = (async (): Promise<AiResponse<T>> => {
    const asked = await askModel(task.system, task.user)
    if ('failed' in asked) return { status: asked.failed === 'NO_KEY' ? 'off' : 'busy', ...old(true), message: asked.failed === 'NO_KEY' ? MESSAGES.off : MESSAGES.busy }
    const result = task.parse(asked.text, asked.model)
    if (!result) {
      console.error(`[analytics-ai] ${task.kind} answer failed validation:`, asked.text.slice(0, 300))
      return { status: 'empty', ...old(true), message: MESSAGES.empty }
    }
    const dropped = (result as { dropped?: number }).dropped
    if (dropped) console.warn(`[analytics-ai] ${dropped} item(s) dropped by the number check (${task.kind})`)
    await store(scope, audience, { fingerprint, result, at: Date.now() }, asked.model, opts.actor, asked.tokens)
    return { status: 'ok', result, cached: false, stale: false }
  })()
  inflight.set(key, job as Promise<AiResponse<unknown>>)
  try { return await job } finally { inflight.delete(key) }
}
