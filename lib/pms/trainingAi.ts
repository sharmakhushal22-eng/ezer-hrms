// lib/pms/trainingAi.ts — suggesting training from what the chain wrote.
//
// Requested: while a rater is scoring somebody, an AI should read the
// ratings and the remarks and suggest training, into a bin the rater can
// drag from.
//
// ── THE THREE RULES THIS FILE HOLDS ──────────────────────────────────────
//
// 1. NOTHING IDENTIFIABLE LEAVES. The owner chose anonymised context, and
//    the product's own login page claims data stays in Mumbai and DPDPA
//    compliance. Names, employee codes and departments are stripped before
//    a prompt is built — not redacted in the prompt text, REMOVED from the
//    object, so there is no path by which a later edit reintroduces them.
//
// 2. THE MODEL MAY NOT NAME A COURSE. Catalogue suggestions name real
//    courses because a person put them in the catalogue. Model suggestions
//    are skill areas. A model that returns "Advanced Power BI, Coursera,
//    14 hours" has invented a product, and once that is written into a
//    recommendation nobody downstream can tell it from a real one.
//
// 3. A BAD RESPONSE IS NOT A CRASH. Models return prose around JSON, or
//    truncated JSON, or an apology. Every one of those must end as "no
//    suggestions this time", never as a broken screen in the middle of
//    somebody's appraisal.

import { TRAINING_CATEGORIES, type TrainingCategory } from './training.ts'

/** What the rating panel knows, before anything is stripped. */
export interface RatingContext {
  employeeName?: string | null
  employeeCode?: string | null
  department?: string | null
  /** The band this rater landed on, and the scale it sits in. */
  overallRating?: number | null
  scaleMax?: number | null
  overallRemark?: string | null
  kras?: {
    title?: string | null
    weightage?: number | null
    rating?: number | null
    comment?: string | null
  }[]
  /** The recognition or PIP note, which says a lot about the gap. */
  recognitionNote?: string | null
  pipReason?: string | null
}

/** The same thing with every identifier gone. */
export interface SafeContext {
  overallRating?: number | null
  scaleMax?: number | null
  overallRemark?: string | null
  kras: { title: string; weightage?: number | null
          rating?: number | null; comment?: string | null }[]
  recognitionNote?: string | null
  pipReason?: string | null
}

/** Fields that must never reach a prompt. Named so a test can check them. */
export const IDENTIFYING_FIELDS = [
  'employeeName', 'employeeCode', 'department',
] as const

/**
 * Strip the person out of their appraisal.
 *
 * BUILT FRESH, never deleted from a copy. `delete ctx.employeeName` on a
 * spread leaves anything added later silently included; naming the fields
 * that may travel means a new identifier has to be added deliberately.
 *
 * The recommendation does not suffer: it depends on which KRAs were weak
 * and what the manager said about them, and none of that is the person's
 * name.
 */
export function anonymise(ctx: RatingContext | null | undefined): SafeContext {
  const c = ctx ?? {}
  const t = (s: string | null | undefined) => {
    const v = (s ?? '').trim()
    return v ? v : null
  }
  return {
    overallRating: c.overallRating ?? null,
    scaleMax: c.scaleMax ?? null,
    overallRemark: t(c.overallRemark),
    kras: (c.kras ?? [])
      .map(k => ({
        title: (k.title ?? '').trim(),
        weightage: k.weightage ?? null,
        rating: k.rating ?? null,
        comment: t(k.comment),
      }))
      .filter(k => k.title),
    recognitionNote: t(c.recognitionNote),
    pipReason: t(c.pipReason),
  }
}

/** Is there enough here to ask a model anything useful? */
export function worthAsking(s: SafeContext): boolean {
  // A rating alone says "they were a 3" and nothing about WHAT to train.
  // The signal is in the KRAs and the words written about them.
  const words = [s.overallRemark, s.recognitionNote, s.pipReason,
                 ...s.kras.map(k => k.comment)].filter(Boolean).join(' ')
  return s.kras.length > 0 || words.length >= 20
}

// ── retrieval ────────────────────────────────────────────────────────────

export interface CatalogueRow {
  id: string
  course_name: string
  provider?: string | null
  skill: string
  category?: string | null
  level?: string | null
  url?: string | null
  is_active?: boolean | null
}

/**
 * The weakest KRAs first — the ones training would actually help.
 *
 * A rater who scored somebody 2 on stock accuracy and 5 on teamwork does
 * not need a course on teamwork. Weighted by the KRA's own weightage so a
 * low score on a 40% objective outranks a low score on a 5% one.
 */
export function gaps(s: SafeContext, take = 4): typeof s.kras {
  const scored = s.kras.filter(k => k.rating !== null && k.rating !== undefined)
  if (!scored.length) return s.kras.slice(0, take)
  const max = s.scaleMax && s.scaleMax > 0 ? s.scaleMax : 5
  return [...scored]
    .sort((a, b) => {
      // Distance below the top of the scale, weighted. Higher is worse.
      const pain = (k: typeof a) =>
        (max - Number(k.rating)) * ((Number(k.weightage) || 1) / 100 + 0.01)
      return pain(b) - pain(a)
    })
    .slice(0, take)
}

const WORDS = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'per',
  'all', 'any', 'new', 'via', 'our', 'their', 'this', 'that', 'was', 'were'])

/**
 * Match the catalogue against what the rater wrote.
 *
 * A keyword overlap, not an embedding: there is no pgvector here, and a
 * scoring function somebody can read and correct beats a similarity number
 * nobody can argue with. The skill field is weighted above the course name
 * because "Advanced Excel" matches a KRA about spreadsheets through its
 * skill, not its title.
 */
export function rankCatalogue(
  s: SafeContext,
  catalogue: CatalogueRow[] | null | undefined,
  take = 5,
): { row: CatalogueRow; score: number; matched: string[] }[] {
  const text = [
    ...gaps(s, 99).map(k => `${k.title} ${k.comment ?? ''}`),
    s.overallRemark ?? '', s.pipReason ?? '',
  ].join(' ')
  const want = new Set(WORDS(text).filter(w => !STOP.has(w)))
  if (!want.size) return []

  const out: { row: CatalogueRow; score: number; matched: string[] }[] = []
  for (const row of catalogue ?? []) {
    if (row.is_active === false) continue
    const skill = new Set(WORDS(row.skill ?? ''))
    const name = new Set(WORDS(row.course_name ?? ''))
    const matched: string[] = []
    let score = 0
    for (const w of want) {
      if (skill.has(w)) { score += 3; matched.push(w) }
      else if (name.has(w)) { score += 1; matched.push(w) }
    }
    if (score > 0) out.push({ row, score, matched: [...new Set(matched)] })
  }
  return out
    .sort((a, b) => b.score - a.score || a.row.course_name.localeCompare(b.row.course_name))
    .slice(0, take)
}

// ── what comes back ──────────────────────────────────────────────────────

export interface Suggestion {
  source: 'CATALOGUE' | 'MODEL'
  catalogueId?: string | null
  trainingName: string
  skill?: string | null
  category: TrainingCategory
  rationale?: string | null
}

const isCategory = (v: unknown): v is TrainingCategory =>
  typeof v === 'string' && (TRAINING_CATEGORIES as readonly string[]).includes(v)

/** A URL, a provider, a price — anything that dresses a skill as a product. */
const LOOKS_LIKE_A_COURSE =
  /https?:\/\/|www\.|\bcoursera\b|\budemy\b|\blinkedin learning\b|\bedx\b|\bnptel\b|\bskillsoft\b|₹|\$\d|\b\d+\s*(hours?|hrs?|weeks?|days?)\b/i

/**
 * Read what the model sent back, defensively.
 *
 * Models wrap JSON in prose, fence it, truncate it, or apologise instead.
 * All of those end as an empty list — a rater mid-appraisal gets "nothing
 * this time", never a broken panel.
 *
 * AND THE MODEL'S SUGGESTIONS ARE SCRUBBED. Anything that looks like a
 * named product — a URL, a provider, a duration, a price — is rejected
 * rather than cleaned, because a half-stripped fabrication still reads as
 * a real course to the person who then recommends it.
 */
export function parseSuggestions(raw: string | null | undefined): Suggestion[] {
  const text = (raw ?? '').trim()
  if (!text) return []
  // The first balanced array in the response, fenced or not.
  const start = text.indexOf('[')
  if (start < 0) return []
  let depth = 0, end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') { depth--; if (!depth) { end = i; break } }
  }
  if (end < 0) return []

  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(parsed)) return []

  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = String(o.skill ?? o.trainingName ?? o.name ?? '').trim()
    if (!name || name.length < 3 || name.length > 120) continue
    if (LOOKS_LIKE_A_COURSE.test(name)) continue
    const rationale = String(o.rationale ?? o.why ?? '').trim()
    if (LOOKS_LIKE_A_COURSE.test(rationale)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source: 'MODEL',
      trainingName: name,
      skill: name,
      category: isCategory(o.category) ? o.category : 'OTHER',
      rationale: rationale || null,
    })
    if (out.length >= 6) break
  }
  return out
}

/**
 * The prompt.
 *
 * Built from the SAFE context only — the signature takes SafeContext, not
 * RatingContext, so there is no way to pass the un-stripped object by
 * mistake. That is the whole reason the two types are separate.
 */
export function buildPrompt(s: SafeContext, catalogueMatched: string[]): string {
  const scale = s.scaleMax ?? 5
  const lines: string[] = [
    'You are helping a manager decide what training would help one of their',
    'team members. You are given that person’s objectives for the period,',
    'the rating each received, and what the manager wrote about them.',
    '',
    'Suggest up to 4 SKILL AREAS to develop. Rules you must follow:',
    '- Name a SKILL, never a course, product, provider or URL.',
    '  Good: "Inventory forecasting". Bad: "Inventory Forecasting on Udemy".',
    '- Do not invent durations, prices or links.',
    '- Base every suggestion on the objectives and comments below.',
    '- Skip anything already covered by the matched catalogue entries.',
    '',
    'Reply with ONLY a JSON array, each item:',
    '{"skill": "...", "category": "TECHNICAL|BEHAVIOURAL|LEADERSHIP|DOMAIN|COMPLIANCE|OTHER",',
    ' "rationale": "one sentence, referring to the evidence below"}',
    '',
    `Overall rating: ${s.overallRating ?? 'not given'} out of ${scale}`,
  ]
  if (s.overallRemark) lines.push(`Manager’s overall remark: ${s.overallRemark}`)
  if (s.pipReason) lines.push(`Concern raised: ${s.pipReason}`)
  if (s.recognitionNote) lines.push(`Strength noted: ${s.recognitionNote}`)
  lines.push('', 'Objectives:')
  for (const k of gaps(s, 8)) {
    lines.push(`- ${k.title}`
      + (k.weightage ? ` (${k.weightage}% of the appraisal)` : '')
      + (k.rating !== null && k.rating !== undefined ? ` — rated ${k.rating}/${scale}` : '')
      + (k.comment ? `. Manager wrote: ${k.comment}` : ''))
  }
  if (catalogueMatched.length) {
    lines.push('', 'Already matched from the internal catalogue (do not repeat):')
    for (const c of catalogueMatched) lines.push(`- ${c}`)
  }
  return lines.join('\n')
}

/** The catalogue hits, as suggestions. */
export function catalogueSuggestions(
  ranked: ReturnType<typeof rankCatalogue>,
): Suggestion[] {
  return ranked.map(r => ({
    source: 'CATALOGUE' as const,
    catalogueId: r.row.id,
    trainingName: r.row.course_name,
    skill: r.row.skill,
    category: isCategory(r.row.category) ? r.row.category : 'OTHER',
    rationale: `Matches ${r.matched.slice(0, 3).join(', ')} in this appraisal`
             + (r.row.provider ? ` · ${r.row.provider}` : ''),
  }))
}

/**
 * A suggestion as the BIN holds it: the engine's shape plus the row's own
 * id and status, which only exist once it has been stored.
 */
export interface BinSuggestion extends Suggestion {
  id?: string
  status?: 'BIN' | 'TAKEN' | 'DISMISSED'
}
