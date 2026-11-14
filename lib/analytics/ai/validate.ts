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
// Then: lengths capped, markdown and stray fact ids stripped, each item must cite at
// least one real fact, and finally the P1/P2 tokens are turned back into names — here,
// on the server, after the model. The task parsers (./tasks.ts) apply these.

import type { Fact, FactPack } from './types.ts'

const TOKEN = /\bP\d{1,3}\b/g
const NUM = /\d(?:[\d,]*\d)?(?:\.\d+)?/g

/** Counts written as words are checked like digits: "five probations" needs a 5 behind
 *  it. "one" is not on the list — it is far more often "one manager" or "no one". */
const WORDS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twice: 2, double: 2, doubled: 2, triple: 3, tripled: 3, thrice: 3, quadrupled: 4,
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

export function citedFacts(raw: unknown, byId: Map<string, Fact>): Fact[] {
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const out: Fact[] = []
  for (const id of ids) {
    const f = byId.get(id.replace(/^\[|\]$/g, '').trim())
    if (f && !out.includes(f)) out.push(f)
  }
  return out.slice(0, 4)
}
