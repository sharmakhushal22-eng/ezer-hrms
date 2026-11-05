// app/api/pms/training-ai/route.ts — the suggestion bin's one server call.
//
// Requested: while a rater is scoring somebody, an AI reads the ratings and
// the remarks and suggests training into a bin.
//
// ── WHAT LEAVES THIS SERVER ───────────────────────────────────────────────
//
// The anonymised context and nothing else. The client sends the appraisal
// as it has it — names included, because the browser already has them —
// and anonymise() strips the identifiers HERE, before a prompt exists. Done
// in the browser instead, a future caller could skip it; done here, there
// is one place to check and one place to get it wrong.
//
// The product's own login page claims data stays in Mumbai and DPDPA
// compliance. The owner chose anonymised context knowing the model is
// outside India. That decision is only worth anything if it is enforced
// where the request is actually made.
//
// ── WHICH MODEL ───────────────────────────────────────────────────────────
//
// Whichever key is present: Gemini first because GOOGLE_GENERATIVE_AI_API_KEY
// is set and already powers resume screening, then Claude, then an honest
// refusal. The owner picked this over naming one provider, so a rotated key
// degrades to "not configured" rather than to a dead feature nobody has
// diagnosed.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, actorFromRequest } from '@/lib/rms/server'
import { anonymise, worthAsking, rankCatalogue, catalogueSuggestions,
         buildPrompt, parseSuggestions,
         type RatingContext, type CatalogueRow, type Suggestion } from '@/lib/pms/trainingAi'

/**
 * A LIST, BECAUSE ONE NAME ROTS AND THE OTHER IS BUSY.
 *
 * Both failures were MEASURED against this key, not guessed:
 *
 *   gemini-2.5-flash  404 "no longer available to new users". The three
 *                     older routes in app/api/recruitment still name it
 *                     and will fail the same way.
 *   gemini-flash-latest, and the 3.8-flash the 404 message itself
 *                     recommended: 503 "experiencing high demand", and
 *                     3.8 is not even in this key's model list.
 *   gemini-3.5-flash  answered.
 *
 * So the route tries a short ordered list and takes the first that
 * answers. A pinned version breaks on retirement; a single alias breaks
 * on a busy afternoon. Ordered newest-known-good first, with a lite
 * model last because a smaller model suggesting something is better than
 * no suggestion at all.
 */
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest',
                       'gemini-3.1-flash-lite'] as const
const CLAUDE = 'claude-sonnet-4-20250514'

const bad = (error: string, message: string, status = 400) =>
  NextResponse.json({ error, message }, { status })

/**
 * Why nothing came back, when nothing came back.
 *
 * A TRANSIENT OUTAGE IS NOT A CONFIGURATION ERROR, and telling somebody to
 * set a key they have already set is how a five-minute wait turns into an
 * afternoon. Gemini answered 503 "experiencing high demand" during
 * testing; that has to read as "try again", not as "you have no key".
 */
export type AskFailure = 'NO_KEY' | 'UNAVAILABLE'

/**
 * HOW LONG A RATER WILL WAIT, and it is not five minutes.
 *
 * MEASURED: an overloaded Gemini held the connection for 300 seconds
 * before undici gave up. With no deadline of our own the button would
 * have spun for that long in the middle of somebody's appraisal, for a
 * suggestion they did not have to have. Twenty seconds is past the point
 * where a useful answer was coming.
 */
const DEADLINE_MS = 20_000

const withDeadline = async (url: string, init: RequestInit) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), DEADLINE_MS)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) }
  catch { return null }
  finally { clearTimeout(t) }
}

/** Ask whichever model is configured. Returns the text, or why not. */
async function ask(prompt: string):
  Promise<{ text: string; model: string } | { failed: AskFailure }> {
  let tried = false
  const google = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  for (const model of (google ? GEMINI_MODELS : [])) {
    tried = true
    const r = await withDeadline(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': google! },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Low, not zero: this is a suggestion list, and identical
            // phrasing every time reads as a template rather than a read
            // of the appraisal. Still far below anything inventive.
            temperature: 0.3,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }) })
    if (r?.ok) {
      const j = await r.json().catch(() => null) as
        { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
      if (text.trim()) return { text, model }
    } else {
      // Logged per model, so a retirement shows up as a 404 on one name
      // rather than as "the AI is down".
      console.error(`[pms] ${model} unavailable:`,
        r ? `${r.status} ${(await r.text()).slice(0, 200)}` : 'timed out')
    }
  }

  const anthropic = process.env.ANTHROPIC_API_KEY
  if (anthropic) {
    tried = true
    const r = await withDeadline('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic,
                 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE, max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }] }) })
    if (r?.ok) {
      const j = await r.json().catch(() => null) as
        { content?: { text?: string }[] } | null
      const text = (j?.content ?? []).map(c => c.text ?? '').join('')
      if (text.trim()) return { text, model: CLAUDE }
    } else {
      console.error('[pms] claude unavailable:',
        r ? `${r.status} ${(await r.text()).slice(0, 200)}` : 'timed out')
    }
  }
  return { failed: tried ? 'UNAVAILABLE' : 'NO_KEY' }
}

export async function POST(req: NextRequest) {
  const actor = await actorFromRequest(req)
  if (!actor.employeeId) {
    return bad('NO_ACTOR', 'A suggestion is recorded against the person who '
             + 'asked for it, and this session is not attached to an employee '
             + 'record. Sign in with your own account.', 403)
  }

  const body = await req.json().catch(() => ({})) as {
    periodId?: string; employeeId?: string; companyId?: string
    context?: RatingContext
  }
  const { periodId, employeeId, companyId } = body
  if (!periodId || !employeeId) return bad('BAD_REQUEST', 'Which appraisal?')

  // ── strip the person out, here, before anything else happens ───────────
  const safe = anonymise(body.context)
  if (!worthAsking(safe)) {
    return NextResponse.json({ suggestions: [], reason: 'NOT_ENOUGH',
      message: 'There is not enough in this appraisal yet. Rate a few '
             + 'objectives or write what you have seen, and ask again.' })
  }

  // ── retrieval: the catalogue this organisation actually owns ───────────
  const cat = await sb.from('pms_training_catalogue')
    .select('id, course_name, provider, skill, category, level, url, is_active')
    .or(companyId ? `company_id.is.null,company_id.eq.${companyId}` : 'company_id.is.null')
    .eq('is_active', true).limit(500)
  if (cat.error) console.error('[pms] catalogue unreadable:', cat.error)
  const catalogue = (cat.data ?? []) as unknown as CatalogueRow[]

  const ranked = rankCatalogue(safe, catalogue)
  const fromCatalogue = catalogueSuggestions(ranked)

  // ── the model fills the gaps ───────────────────────────────────────────
  const asked = await ask(buildPrompt(safe, fromCatalogue.map(s => s.trainingName)))
  const answer = 'text' in asked ? asked : null
  if (!answer && !fromCatalogue.length) {
    // The two are different problems with different fixes, and saying the
    // wrong one sends somebody to the wrong place.
    return 'failed' in asked && asked.failed === 'UNAVAILABLE'
      ? bad('MODEL_BUSY',
          'The AI is busy or unreachable just now, and the training '
          + 'catalogue is empty so there is nothing else to suggest from. '
          + 'Try again in a minute \u2014 your own suggestion works either way.', 503)
      : bad('NO_MODEL',
          'No AI key is configured, and the training catalogue is empty, so '
          + 'there is nothing to suggest from. Add courses to the catalogue, '
          + 'or set GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY.', 503)
  }
  const fromModel = answer ? parseSuggestions(answer.text) : []

  const all: Suggestion[] = [...fromCatalogue, ...fromModel]
  if (!all.length) {
    return NextResponse.json({ suggestions: [], reason: 'NOTHING',
      message: 'Nothing useful came back this time. Your own suggestion is '
             + 'as good as anything here.' })
  }

  /**
   * SAVED, so an interrupted appraisal comes back to the same bin and the
   * same call is not paid for twice — the owner's choice.
   *
   * Upserted on the bin's own unique key, and DISMISSED rows are left as
   * they are: somebody who threw a suggestion away should not have it
   * reappear because they pressed the button again.
   */
  const rows = all.map(s => ({
    company_id: companyId ?? null, period_id: periodId, employee_id: employeeId,
    generated_by: actor.employeeId, source: s.source,
    catalogue_id: s.catalogueId ?? null, training_name: s.trainingName,
    skill: s.skill ?? null, category: s.category, rationale: s.rationale ?? null,
    model: s.source === 'MODEL' ? (answer?.model ?? null) : null,
  }))
  const saved = await sb.from('pms_training_suggestion')
    .upsert(rows, { onConflict: 'period_id,employee_id,generated_by,training_name',
                    ignoreDuplicates: true })
  if (saved.error) {
    // NOT FATAL. The suggestions are useful right now even if the bin did
    // not persist; failing the whole call would turn a storage problem into
    // "the AI is broken".
    console.error('[pms] suggestion bin not saved:', saved.error)
  }

  const back = await sb.from('pms_training_suggestion')
    .select('id, source, catalogue_id, training_name, skill, category, rationale, status')
    .eq('period_id', periodId).eq('employee_id', employeeId)
    .eq('generated_by', actor.employeeId).neq('status', 'DISMISSED')
  return NextResponse.json({
    suggestions: back.error ? all : (back.data ?? []),
    persisted: !saved.error && !back.error,
    model: answer?.model ?? null,
    catalogueSize: catalogue.length,
  })
}
