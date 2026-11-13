// lib/analytics/server/ai.ts — asking a model for the AI read, once, and remembering it.
//
// ── WHICH MODEL, WHICH KEY ────────────────────────────────────────────────────
//
// The keys the other AI features already use. Production holds GEMINI_API_KEY (resume
// screening reads it); the PMS and onboarding routes read GOOGLE_GENERATIVE_AI_API_KEY.
// Either works here. Gemini models are tried in order — the list app/api/pms/
// training-ai measured: one name retires, another is busy — and Claude answers if
// ANTHROPIC_API_KEY is set and every Gemini model failed. No key: the page says so and
// shows the rule checks, which never needed a model.
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
import type { AiBrief, AiBriefResponse, FactPack } from '../ai/types.ts'
import { PROMPT_VERSION, systemPrompt, userPrompt } from '../ai/prompt.ts'
import { toBrief } from '../ai/validate.ts'

const GEMINI_MODELS = [process.env.ANALYTICS_AI_MODEL, 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite']
  .filter((m, i, a): m is string => !!m && a.indexOf(m) === i)
const CLAUDE_MODEL = 'claude-opus-5-5'

/** One model attempt. A briefing is not worth a two-minute spinner. */
const ATTEMPT_MS = 25_000
/** Stop trying further models once this much time has gone. */
const TOTAL_MS = 40_000

const TTL_MS: Record<FactPack['audience'], number> = { org: 6 * 3600_000, team: 4 * 3600_000, me: 12 * 3600_000 }
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

interface Stored { fingerprint: string; brief: AiBrief; at: number }
const memory = new Map<string, Stored>()
const inflight = new Map<string, Promise<AiBriefResponse>>()
const usage = new Map<string, { gen: number[]; refresh: number[] }>()

/** True when the analytics_ai_brief table is missing — then we stop asking for it. */
let noTable = false

async function readStored(scope: string): Promise<Stored | null> {
  const m = memory.get(scope)
  if (m || noTable) return m ?? null
  const { data, error } = await sb.from('analytics_ai_brief').select('fingerprint, brief, created_at').eq('scope_hash', scope).order('created_at', { ascending: false }).limit(1)
  if (error) { if (/does not exist|schema cache|relation/i.test(error.message)) noTable = true; return null }
  const row = (data || [])[0] as { fingerprint: string; brief: AiBrief; created_at: string } | undefined
  if (!row) return null
  const s = { fingerprint: row.fingerprint, brief: row.brief, at: Date.parse(row.created_at) }
  memory.set(scope, s)
  return s
}

async function store(scope: string, audience: string, s: Stored, actor: string | null, tokens: { in: number; out: number }) {
  memory.set(scope, s)
  if (memory.size > 500) memory.delete(memory.keys().next().value as string)
  if (noTable) return
  const { error } = await sb.from('analytics_ai_brief').insert({
    scope_hash: scope, audience, fingerprint: s.fingerprint, brief: s.brief, model: s.brief.model,
    input_tokens: tokens.in, output_tokens: tokens.out, created_by: actor,
  })
  if (error && /does not exist|schema cache|relation/i.test(error.message)) noTable = true
  else if (error) console.error('[analytics-ai] brief not stored:', error.message)
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
  off: 'AI is not switched on for this installation. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to the server environment. The checks below are rule-based and always available.',
  busy: 'The AI service did not answer in time. The rule-based checks are shown instead — try Refresh in a minute.',
  empty: 'The AI answer did not pass the number check, so it is not shown. The rule-based checks are below.',
  limited: 'You have refreshed the AI read several times this hour. The latest one is shown; try again later.',
} as const

/**
 * The AI read for a fact sheet: from memory when it can be, from the model when it must.
 * `actor` is whoever is asking — for the throttle and the audit column.
 */
export async function aiBrief(pack: FactPack, opts: { actor: string | null; refresh?: boolean }): Promise<AiBriefResponse> {
  if (!pack.facts.length) return { status: 'empty', brief: null, cached: false, stale: false, message: 'There are no figures here yet for the AI to read.' }
  const scope = sha(`${PROMPT_VERSION}|${pack.scopeKey}`)
  const fingerprint = sha([PROMPT_VERSION, pack.context.replace(/Today is [^.]*\./, ''), ...pack.facts.map(f => `${f.id}=${f.text}`), ...pack.signals.map(f => f.text)].join('\n'))
  const prior = await readStored(scope)

  if (prior && !opts.refresh) {
    const same = prior.fingerprint === fingerprint
    if (same || Date.now() - prior.at < TTL_MS[pack.audience]) return { status: 'ok', brief: prior.brief, cached: true, stale: !same }
  }
  if (!aiConfigured()) return { status: 'off', brief: prior?.brief ?? null, cached: !!prior, stale: !!prior, message: MESSAGES.off }
  if (!allow(opts.actor || 'anonymous', !!opts.refresh)) {
    return { status: prior ? 'ok' : 'limited', brief: prior?.brief ?? null, cached: !!prior, stale: !!prior && prior.fingerprint !== fingerprint, message: MESSAGES.limited }
  }

  // Two tabs asking for the same picture at once share one call.
  const key = `${scope}|${fingerprint}`
  const running = inflight.get(key)
  if (running) return running
  const job = (async (): Promise<AiBriefResponse> => {
    const asked = await askModel(systemPrompt(pack), userPrompt(pack))
    if ('failed' in asked) {
      return { status: asked.failed === 'NO_KEY' ? 'off' : 'busy', brief: prior?.brief ?? null, cached: !!prior, stale: !!prior, message: asked.failed === 'NO_KEY' ? MESSAGES.off : MESSAGES.busy }
    }
    const brief = toBrief(asked.text, pack, asked.model)
    if (!brief) {
      console.error('[analytics-ai] answer failed validation:', asked.text.slice(0, 300))
      return { status: 'empty', brief: prior?.brief ?? null, cached: !!prior, stale: !!prior, message: MESSAGES.empty }
    }
    if (brief.dropped) console.warn(`[analytics-ai] ${brief.dropped} sentence(s) dropped by the number check (${pack.audience})`)
    await store(scope, pack.audience, { fingerprint, brief, at: Date.now() }, opts.actor, asked.tokens)
    return { status: 'ok', brief, cached: false, stale: false }
  })()
  inflight.set(key, job)
  try { return await job } finally { inflight.delete(key) }
}
