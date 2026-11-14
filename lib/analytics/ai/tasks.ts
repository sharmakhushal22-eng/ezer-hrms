// lib/analytics/ai/tasks.ts — what the model is asked to write, and what is kept.
//
// Four pieces (lib/analytics/briefs.ts has their shapes and their no-AI versions):
// the executive briefing, "Why?" on a figure, a manager's Monday note, an employee's
// summary. Each is a TASK: a fact sheet (the only thing the model sees), instructions,
// and a parser that keeps a sentence only if every number in it is on the facts it
// cites (lib/analytics/ai/validate.ts). What fails is dropped and counted; if too little
// survives, the reader gets the template version instead.
//
// The fact sheets are aggregates. A manager's people are tokens (P1, P2…) and their
// names go back in on the server, after the answer. Bump TASK_VERSION when the wording
// changes — it is part of the cache key.

import type { Area, Mover, MoverSet, OrgAnalytics, TeamAnalytics, MyAnalytics } from '../types.ts'
import type { Fact, FactPack } from './types.ts'
import type { Briefing, BriefAction, BriefCause, BriefChange, Explanation, MondayNote, MySummary, Reason } from '../briefs.ts'
import { changeSentence, sizeOf, unitOf } from '../briefs.ts'
import { fmt } from '../format.ts'
import { orgFacts, teamFacts, myFacts } from './facts.ts'
import { allowedNumbers, citedFacts, clean, grounded, numbersFrom, parseJsonLoose, restore } from './validate.ts'
import { restrictPack, type OrgTab } from '../access.ts'

export const TASK_VERSION = 't2'

export type TaskKind = 'briefing' | 'explain' | 'monday' | 'summary'

export interface Task<T> {
  kind: TaskKind
  pack: FactPack
  system: string
  user: string
  parse: (raw: string, model: string) => T | null
}

const AREAS: Area[] = ['workforce', 'attrition', 'attendance', 'leave', 'performance', 'learning', 'hiring', 'cost']

// ── The movers, as facts ────────────────────────────────────────────────────

const v = (x: number | null, f: Mover['fmt']) => (f === 'days' ? `${fmt(x, 'days')} days` : f === 'pct' && x != null ? `${x.toFixed(1)}%` : fmt(x, f))

/** One fact for the change, one per breakdown. Group names are departments, locations,
 *  weekdays, leave types, reasons and sources — never people. */
export function moverFacts(set: MoverSet, keys?: string[]): Fact[] {
  const out: Fact[] = []
  for (const m of set.items) {
    if (keys && !keys.includes(m.key)) continue
    out.push({ id: `mv.${m.key}`, area: m.area, text: `${changeSentence(m)}, ${set.window.label}${m.notes.length ? `; ${m.notes.join('; ')}` : ''}` })
    for (const b of m.by) {
      const f = b.fmt || m.fmt
      const rows = b.rows.map(r => `${r.label} ${v(r.now, f)} against ${v(r.before, f)}${r.delta ? ` (${r.delta > 0 ? 'up' : 'down'} ${sizeOf({ fmt: f, delta: r.delta })}, ${r.n} ${unitOf(r.n, b.unit)})` : ` (${r.n} ${unitOf(r.n, b.unit)})`}`)
      out.push({ id: `mv.${m.key}.${b.dim}`, area: m.area, text: `${m.label} ${b.label.toLowerCase()}, ${set.window.label}, largest movers first: ${rows.join('; ')}` })
    }
  }
  return out
}

// ── Shared instructions ─────────────────────────────────────────────────────

const RULES = [
  'You are the people-analytics analyst inside EZER HRMS, an HR system used by Indian companies.',
  'You are given FACTS, each with an id, computed by the system from its own records, and SIGNALS: threshold checks the system already ran.',
  '',
  'Rules — follow every one:',
  '1. Use only the facts and signals. Every number you write — digits or words like "five" — must appear in the facts that item cites, as the same figure. Do not calculate anything new: no sums, differences, ratios or percentages of your own. Write figures as digits, exactly as the facts write them.',
  '2. Every item lists, in "facts", the ids (1 to 4) of the facts or signals it rests on. Never put ids in the text.',
  '3. Causes are possibilities, not facts: write "likely", "may", "worth checking". Point at WHERE a change happened (department, location, weekday, leave type, source) — the breakdown facts say where.',
  '4. When a fact shows thin data (few people, few punch-ins, low coverage), say so rather than drawing a conclusion.',
  '5. Never guess anyone\'s identity, gender, health, religion, caste, family or other personal matters. No legal or medical advice.',
  '6. Plain Indian English. Short sentences. No jargon, no emojis, no markdown. Answer with JSON only.',
].join('\n')

function userPrompt(pack: FactPack, extra = ''): string {
  return [
    extra,
    `CONTEXT: ${pack.context}`,
    `AREAS: ${pack.areas.join(', ')}`,
    '',
    'FACTS:',
    ...pack.facts.map(f => `[${f.id}] (${f.area}) ${f.text}`),
    '',
    'SIGNALS:',
    ...(pack.signals.length ? pack.signals.map(f => `[${f.id}] (${f.area}) ${f.text}`) : ['none']),
  ].filter(s => s !== undefined).join('\n').trim()
}

/** The checks every parser shares. */
function checker(pack: FactPack) {
  const byId = new Map([...pack.facts, ...pack.signals].map(f => [f.id, f]))
  const sheet = allowedNumbers(pack)
  const R = (t: string) => restore(t, pack.aliases)
  let dropped = 0
  const evidence = (fs: Fact[]) => fs.map(f => R(f.text.replace(/^\[(critical|warning|info|positive)\]\s*/, '')))
  return {
    get dropped() { return dropped },
    R, evidence,
    /** A sentence that cites nothing, held to the whole sheet. */
    free(text: unknown, max: number): string {
      const t = clean(text, max)
      if (!t) return ''
      if (grounded(t, sheet)) return R(t)
      dropped++; return ''
    },
    /** An item with its own citations: every text must be grounded in THOSE facts. */
    cited(o: Record<string, unknown>, fields: [string, number, boolean?][]): { texts: string[]; facts: Fact[] } | null {
      const facts = citedFacts(o.facts, byId)
      if (!facts.length) { dropped++; return null }
      const own = numbersFrom([pack.context, ...facts.map(f => f.text)])
      const texts: string[] = []
      for (const [k, max, advice] of fields) {
        const t = clean(o[k], max)
        if (t && !grounded(t, own, !advice)) { dropped++; return null }
        texts.push(R(t))
      }
      return { texts, facts }
    },
    area(o: Record<string, unknown>, facts: Fact[]): Area {
      const a = String(o.area || '').toLowerCase() as Area
      return AREAS.includes(a) ? a : ((facts.map(f => f.area).find(x => AREAS.includes(x as Area)) as Area) || 'workforce')
    },
  }
}

const items = (x: unknown, max: number) => (Array.isArray(x) ? x.filter(o => o && typeof o === 'object').slice(0, max) as Record<string, unknown>[] : [])

// ── Executive briefing ──────────────────────────────────────────────────────

/** `d` is the full payload (the fact sheet is cut to `tabs` here); `set` is already the
 *  reader's — redacted to their tabs. */
export function briefingTask(d: OrgAnalytics, set: MoverSet, base: Briefing, tabs: OrgTab[]): Task<Briefing> {
  const org = orgFacts(d)
  const pack: FactPack = restrictPack({
    ...org,
    scopeKey: JSON.stringify({ k: org.scopeKey, w: set.window.key, m: set.window.month }),
    context: `${org.context} The briefing is about ${set.window.label}.`,
    facts: [...moverFacts(set), ...org.facts.filter(f => /^(kpi|at\.summary|at\.risk|att\.summary|att\.coverage|lv\.summary|lv\.pending|pf\.cycle|ln\.summary|hr\.open|hr\.offers|cs\.latest|wf\.probation)/.test(f.id))],
  }, tabs)
  const system = [
    RULES, '',
    'TASK: executive briefing. Write the month on one page for the CEO, CHRO and leadership team: what changed, why it likely changed, and what to do.',
    '- "headline": one sentence, at most 140 characters — the single most important thing about the month.',
    '- "changes": 3 to 5 of the biggest movements a leader should know, biggest first. Prefer the mv.* facts (they compare the two windows). Good news counts too.',
    '- "causes": 2 to 4 likely causes, each saying where the change happened, from the breakdown facts (mv.*.department, .location, .weekday, .type, .reason, .source). Link causes across areas when the facts support it.',
    '- "actions": exactly 3 — the most useful things to do next. "owner" is a role (for example "HR business partner", "Head of Sales", "Line managers", "Payroll"), "when" is a time frame in words ("This week", "Before payroll closes"). Each action rests on a change, a cause or a signal.',
    '',
    'JSON shape:',
    '{"headline": "…", "changes": [{"title": "at most 80 characters", "detail": "at most 220 characters: now against before, and why it matters", "area": "one of the AREAS", "direction": "up|down", "facts": ["id"]}],',
    ' "causes": [{"text": "at most 220 characters", "area": "…", "facts": ["id"]}],',
    ' "actions": [{"action": "at most 140 characters", "owner": "a role", "when": "a time frame", "why": "at most 160 characters", "area": "…", "facts": ["id"]}]}',
  ].join('\n')
  return {
    kind: 'briefing', pack, system, user: userPrompt(pack),
    parse(raw, model) {
      const j = parseJsonLoose(raw)
      if (!j) return null
      const c = checker(pack)
      const changes: BriefChange[] = []
      for (const o of items(j.changes, 6)) {
        const r = c.cited(o, [['title', 100], ['detail', 260]])
        if (!r || !r.texts[0]) continue
        const dir = String(o.direction || '').toLowerCase() === 'up' ? 'up' : 'down'
        const mv = r.facts.find(f => /^mv\.[a-z]+$/.test(f.id))
        const m = mv ? set.items.find(x => `mv.${x.key}` === mv.id) : undefined
        changes.push({ title: r.texts[0], detail: r.texts[1], area: c.area(o, r.facts), dir, good: m && m.good !== 'neutral' ? (m.good === 'up') === (dir === 'up') : null, topic: m ? `m:${m.key}` : null, evidence: c.evidence(r.facts) })
      }
      const causes: BriefCause[] = []
      for (const o of items(j.causes, 5)) {
        const r = c.cited(o, [['text', 260]])
        if (r?.texts[0]) causes.push({ text: r.texts[0], area: c.area(o, r.facts), evidence: c.evidence(r.facts) })
      }
      const actions: BriefAction[] = []
      for (const o of items(j.actions, 5)) {
        const r = c.cited(o, [['action', 170, true], ['owner', 60, true], ['when', 60, true], ['why', 200]])
        if (r?.texts[0]) actions.push({ action: r.texts[0], owner: r.texts[1] || 'HR', when: r.texts[2] || 'This month', why: r.texts[3], area: c.area(o, r.facts), evidence: c.evidence(r.facts) })
      }
      const headline = c.free(j.headline, 170)
      // A briefing with no changes or no actions left is not a briefing: use the template.
      if (changes.length < 2 || actions.length < 2) return null
      // Exactly three actions: top up from the template if the check dropped one.
      for (const a of base.actions) { if (actions.length >= 3) break; if (!actions.some(x => x.area === a.area)) actions.push(a) }
      return { ...base, source: 'ai', model, generatedAt: new Date().toISOString(), dropped: c.dropped, headline: headline || base.headline, changes: changes.slice(0, 5), causes: causes.slice(0, 4), actions: actions.slice(0, 3) }
    },
  }
}

// ── "Why?" ──────────────────────────────────────────────────────────────────

export function explainTask(d: OrgAnalytics, set: MoverSet | null, base: Explanation, area: Area | null, tabs: OrgTab[]): Task<Explanation> {
  const org = orgFacts(d)
  const keys = base.movers.map(m => m.key)
  const facts = [
    ...(set && keys.length ? moverFacts(set, keys) : []),
    ...org.facts.filter(f => !area || f.area === area || (area === 'attendance' && f.area === 'leave' && keys.includes('leave'))).slice(0, 24),
  ]
  const pack: FactPack = restrictPack({
    ...org, facts,
    signals: org.signals.filter(s => !area || s.area === area),
    scopeKey: JSON.stringify({ k: org.scopeKey, t: base.topic, w: set?.window.key || '' }),
    context: `${org.context}${set ? ` The comparison is ${set.window.label}.` : ''}`,
  }, tabs)
  const system = [
    RULES, '',
    'TASK: explain. A leader clicked "Why?" on a figure and asked the QUESTION below. Answer it from the facts: what moved, where, and what may be behind it.',
    '- "answer": 2 to 4 sentences, at most 420 characters, that answer the question directly. Lead with where the change came from.',
    '- "reasons": up to 3 supporting points, each citing its facts.',
    '- "checks": up to 3 short things worth checking next (no new figures), for example "Check whether the Pune biometric device was down in the first week".',
    '',
    'JSON shape: {"answer": "…", "facts": ["id"], "reasons": [{"text": "at most 200 characters", "facts": ["id"]}], "checks": ["…"]}',
  ].join('\n')
  return {
    kind: 'explain', pack, system, user: userPrompt(pack, `QUESTION: ${base.question}`),
    parse(raw, model) {
      const j = parseJsonLoose(raw)
      if (!j) return null
      const c = checker(pack)
      const a = c.cited(j, [['answer', 460]])
      const answer = a?.texts[0] || ''
      const reasons: Reason[] = []
      for (const o of items(j.reasons, 4)) {
        const r = c.cited(o, [['text', 240]])
        if (r?.texts[0]) reasons.push({ text: r.texts[0], evidence: c.evidence(r.facts) })
      }
      const checks = (Array.isArray(j.checks) ? j.checks : []).map(x => clean(x, 160)).filter(t => t && grounded(t, numbersFrom([]), false)).slice(0, 3)
      if (!answer) return null
      return { ...base, source: 'ai', model, generatedAt: new Date().toISOString(), dropped: c.dropped, summary: answer, reasons: reasons.length ? reasons : base.reasons, checks }
    },
  }
}

// ── A manager's Monday note ─────────────────────────────────────────────────

export function mondayTask(d: TeamAnalytics, base: MondayNote, today: string): Task<MondayNote> {
  const pack = teamFacts(d, today)
  const tokenOf = new Map(Object.entries(pack.aliases).map(([t, name]) => [name, t]))
  const flagged = base.openers.map(o => tokenOf.get(o.name)).filter(Boolean) as string[]
  const system = [
    RULES, '',
    'TASK: Monday note. Write a line manager\'s start-of-week note about their own team. Speak to the manager as "you". Refer to people only by their tokens (P1, P2…) exactly as written. Be fair and kind: attendance and leave patterns are reasons to check in and support, never to discipline.',
    '- "summary": 1 or 2 sentences, at most 240 characters — how the team is this week.',
    '- "focus": the one thing to do first this week, at most 180 characters.',
    `- "openers": for each of these people only: ${flagged.join(', ') || 'none'} — one warm, open question the manager could start a one-to-one with, at most 200 characters. It must not mention figures, ratings or the warning signs by name; it invites the person to talk.`,
    '',
    'JSON shape: {"summary": "…", "focus": "…", "openers": [{"person": "P3", "opener": "…"}]}',
  ].join('\n')
  return {
    kind: 'monday', pack, system, user: userPrompt(pack),
    parse(raw, model) {
      const j = parseJsonLoose(raw)
      if (!j) return null
      const c = checker(pack)
      const summary = c.free(j.summary, 280), focus = c.free(j.focus, 220)
      const byToken = new Map<string, string>()
      for (const o of items(j.openers, 10)) {
        const t = String(o.person || '').trim()
        const text = clean(o.opener, 240)
        // No figures in an opener at all.
        if (!flagged.includes(t) || !text || !grounded(text, numbersFrom([]))) continue
        byToken.set(t, c.R(text))
      }
      if (!summary && !focus && !byToken.size) return null
      return {
        ...base, source: 'ai', model, generatedAt: new Date().toISOString(), dropped: c.dropped,
        summary: summary || base.summary, focus: focus || base.focus,
        openers: base.openers.map(o => ({ ...o, opener: byToken.get(tokenOf.get(o.name) || '') || o.opener })),
      }
    },
  }
}

// ── An employee's month ─────────────────────────────────────────────────────

export function summaryTask(d: MyAnalytics, base: MySummary, today: string): Task<MySummary> {
  const pack = myFacts(d, today)
  const system = [
    RULES, '',
    'TASK: personal summary. Write for one employee about their own month. Speak to them as "you". Friendly, encouraging and practical; never compare them with a named colleague (team figures are anonymous medians).',
    '- "lines": exactly 3 plain sentences, at most 170 characters each — attendance, leave, and growth (review, learning or recognition) — each citing its facts.',
    '- "nudge": one small, kind next step, at most 170 characters, citing its facts. It may come from a signal.',
    '',
    'JSON shape: {"lines": [{"text": "…", "area": "attendance|leave|performance|learning|pay|recognition", "facts": ["id"]}], "nudge": {"text": "…", "area": "…", "facts": ["id"]}}',
  ].join('\n')
  return {
    kind: 'summary', pack, system, user: userPrompt(pack),
    parse(raw, model) {
      const j = parseJsonLoose(raw)
      if (!j) return null
      const c = checker(pack)
      const lines = items(j.lines, 3).map(o => { const r = c.cited(o, [['text', 200]]); return r?.texts[0] ? { area: String(o.area || r.facts[0].area), text: r.texts[0] } : null }).filter(Boolean) as MySummary['lines']
      const n = j.nudge && typeof j.nudge === 'object' ? c.cited(j.nudge as Record<string, unknown>, [['text', 200, true]]) : null
      if (lines.length < 2) return null
      return {
        ...base, source: 'ai', model, generatedAt: new Date().toISOString(), dropped: c.dropped,
        lines: [...lines, ...base.lines.filter(b => !lines.some(l => l.area === b.area))].slice(0, 3),
        nudge: n?.texts[0] ? { area: String((j.nudge as Record<string, unknown>).area || n.facts[0].area), text: n.texts[0] } : base.nudge,
      }
    },
  }
}
