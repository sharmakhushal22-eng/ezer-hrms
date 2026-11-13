// lib/analytics/ai/types.ts — what the AI read of an analytics page looks like.
//
// The AI never sees the database. It sees a FACT SHEET: short labelled lines the
// server writes from figures it has already computed (the same figures the page
// draws). It answers with findings that cite those facts by id, and the server
// throws away any sentence carrying a number that is not on the sheet.

import type { Severity } from '../types.ts'

export type AiAudience = 'org' | 'team' | 'me'

/** One line of the fact sheet. `text` is what the model reads and what the reader
 *  sees under "Based on". People are written as tokens (P1, P2…), never names. */
export interface Fact { id: string; area: string; text: string }

export interface FactPack {
  audience: AiAudience
  /** Identifies whose picture this is (scope + filters), hashed before storage. */
  scopeKey: string
  /** One-line context the model reads first: scope, period, today. */
  context: string
  facts: Fact[]
  /** The rule checks the system already ran, as hints — they cite like facts. */
  signals: Fact[]
  /** Areas a finding may be filed under (decides where a click goes). */
  areas: string[]
  /** Areas that get a short "AI read" paragraph of their own (org tabs). */
  noteAreas: string[]
  /** Token → real name, applied to the answer on the server, after the model call. */
  aliases: Record<string, string>
}

export interface AiFinding {
  id: string
  severity: Severity
  area: string
  title: string
  detail: string
  action: string | null
  /** The fact lines this finding rests on, names restored. */
  evidence: string[]
}

export interface AiNote { area: string; text: string; evidence: string[] }

export interface AiBrief {
  headline: string | null
  summary: string | null
  findings: AiFinding[]
  notes: AiNote[]
  model: string
  generatedAt: string
  /** Sentences the model wrote that failed the number check and were not shown. */
  dropped: number
}

export type AiStatus = 'ok' | 'off' | 'busy' | 'empty' | 'limited'

export interface AiBriefResponse {
  status: AiStatus
  brief: AiBrief | null
  /** Served from the cache rather than written for this request. */
  cached: boolean
  /** Written on earlier figures — the page may have moved since. */
  stale: boolean
  message?: string
}
