// lib/analytics/ai/validate.ts — nothing the model wrote is shown until it passes here.
//
// THE NUMBER CHECK. A language model is good at reading a table and bad at
// arithmetic, and a wrong figure in an HR briefing is worse than no briefing. So
// every number in a finding must be in the facts THAT FINDING CITES — exactly, or
// rounded (85.3% may be written 85%). Checking against the facts it cites, not the
// whole sheet, is what stops "attrition is 40%" passing because some other line
// happened to say "40 people". The headline and summary cite nothing, so they are
// held to the whole sheet. A sentence that fails is dropped, not corrected, and
// counted, so a bad day shows up in the response.
//
// Then: severities and areas from a closed list, lengths capped, markdown and stray
// fact ids stripped, each finding must cite at least one real fact, and finally the
// P1/P2 tokens are turned back into names — here, on the server, after the model.

import type { Severity } from '../types.ts'
import type { AiBrief, AiFinding, AiNote, Fact, FactPack } from './types.ts'

const SEVERITIES: Severity[] = ['critical', 'warning', 'info', 'positive']
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, positive: 3 }

const TOKEN = /\bP\d{1,3}\b/g
const NUM = /\d(?:[\d,]*\d)?(?:\.\d+)?/g

/** Counts written as words are checked like digits: "five probations" needs a 5 behind
 *  it. "one" is not on the list — it is far more often "one manager" or "no one". */
const WORDS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twice: 2, double: 2, triple: 3, thrice: 3,
}
const WORD = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi')

/** Every number written in a piece of text, digits and number words. Person tokens
 *  (P1, P2…) are not numbers. There are no free numbers: a "0" or a "2" needs a fact
 *  as much as an "85%" does — "0 goals set" passed for someone with 4 when 0 was free. */
export function numbersIn(text: string, words = true): number[] {
  const out: number[] = []
  const t = text.replace(TOKEN, ' ')
  for (const m of t.matchAll(NUM)) {
    const v = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(v)) out.push(v)
  }
  if (words) for (const m of t.matchAll(WORD)) out.push(WORDS[m[1].toLowerCase()])
  return out
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** The numbers a sentence may use: those in the given texts, and their roundings.
 *  Rounding to a whole number is allowed from 10 up (85.3% → 85%); below that a
 *  figure keeps its decimal, or "₹1.24 Cr" would license a bare "1". */
export function numbersFrom(texts: string[]): Set<number> {
  const ok = new Set<number>()
  for (const t of texts) {
    for (const v of numbersIn(t)) {
      ok.add(v); ok.add(r1(v))
      if (v >= 10) ok.add(Math.round(v))
    }
  }
  return ok
}

/** Every number on the sheet — what the headline and summary, which cite nothing, may use. */
export const allowedNumbers = (pack: Pick<FactPack, 'context' | 'facts' | 'signals'>) =>
  numbersFrom([pack.context, ...pack.facts.map(f => f.text), ...pack.signals.map(f => f.text)])

/** `words` is off for the next-step line, where "within two weeks" is advice, not data. */
export function grounded(text: string, ok: Set<number>, words = true): boolean {
  return numbersIn(text, words).every(v => ok.has(v))
}

/** Plain text: no markdown, no fact ids the model was told not to write. */
export function clean(s: unknown, max: number): string {
  if (typeof s !== 'string') return ''
  let t = s
    .replace(/\[(?:[a-z]+\.)[^\]]*\]/gi, '')          // [att.summary]
    .replace(/\((?:[a-z]+\.[\w.-]+)(?:,\s*[a-z]+\.[\w.-]+)*\)/gi, '') // (kpi.attrition, at.flow)
    .replace(/[*_`#]+/g, '')
    .replace(/^\s*[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
  if (t.length > max) {
    const cut = t.slice(0, max)
    t = cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:\s]+$/, '') + '…'
  }
  return t
}

/** The model's answer as an object, tolerating a code fence or a sentence around it. */
export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const s = raw.replace(/```(?:json)?/gi, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const v = JSON.parse(s.slice(a, b + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch { return null }
}

export function restore(text: string, aliases: Record<string, string>): string {
  return text.replace(TOKEN, t => aliases[t] ?? t)
}

function citedFacts(raw: unknown, byId: Map<string, Fact>): Fact[] {
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const out: Fact[] = []
  for (const id of ids) {
    const f = byId.get(id.replace(/^\[|\]$/g, '').trim())
    if (f && !out.includes(f)) out.push(f)
  }
  return out.slice(0, 4)
}

/** Turn the model's text into a brief that is safe to show, or null if nothing is. */
export function toBrief(raw: string, pack: FactPack, model: string, now = new Date()): AiBrief | null {
  const j = parseJsonLoose(raw)
  if (!j) return null
  const ok = allowedNumbers(pack)
  const byId = new Map([...pack.facts, ...pack.signals].map(f => [f.id, f]))
  const R = (t: string) => restore(t, pack.aliases)
  const evidence = (fs: Fact[]) => fs.map(f => R(f.text.replace(/^\[(critical|warning|info|positive)\]\s*/, '')))
  let dropped = 0

  const pass = (t: string) => { if (!t) return ''; if (grounded(t, ok)) return t; dropped++; return '' }
  const headline = pass(clean(j.headline, 160)) || null
  const summary = pass(clean(j.summary, 520)) || null

  const findings: AiFinding[] = []
  const seen = new Set<string>()
  for (const x of Array.isArray(j.findings) ? j.findings.slice(0, 8) : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const title = clean(o.title, 120), detail = clean(o.detail, 360), action = clean(o.action, 200)
    const facts = citedFacts(o.facts, byId)
    if (!title || !facts.length) { dropped++; continue }
    const own = numbersFrom([pack.context, ...facts.map(f => f.text)])
    if (!grounded(title, own) || !grounded(detail, own) || !grounded(action, own, false)) { dropped++; continue }
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const sev = String(o.severity || '').toLowerCase() as Severity
    const asked = String(o.area || '').toLowerCase()
    const area = pack.areas.includes(asked) ? asked : (facts.map(f => f.area).find(a => pack.areas.includes(a)) ?? null)
    if (!area) { dropped++; continue }
    findings.push({
      id: `ai-${findings.length + 1}`,
      severity: SEVERITIES.includes(sev) ? sev : 'info',
      area, title: R(title), detail: R(detail), action: action ? R(action) : null, evidence: evidence(facts),
    })
  }
  // Stable sort: severity first, the model's order within a severity.
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity])

  const notes: AiNote[] = []
  for (const x of Array.isArray(j.notes) ? j.notes : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const area = String(o.area || '').toLowerCase()
    if (!pack.noteAreas.includes(area) || notes.some(n => n.area === area)) continue
    const text = clean(o.text, 360)
    const facts = citedFacts(o.facts, byId)
    if (!text || !facts.length || !grounded(text, numbersFrom([pack.context, ...facts.map(f => f.text)]))) { dropped++; continue }
    notes.push({ area, text: R(text), evidence: evidence(facts) })
  }

  if (!findings.length && !headline && !summary) return null
  return {
    headline: headline && R(headline), summary: summary && R(summary), findings: findings.slice(0, 7), notes,
    model, generatedAt: now.toISOString(), dropped,
  }
}
