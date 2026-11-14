// lib/analytics/server/pieces.ts — the four written pieces, for a route or a scheduled
// email: the template version first (lib/analytics/briefs.ts), then the AI version if
// the model answers and passes the number check (lib/analytics/server/ai.ts runTask).

import type { MoverWindowKey, OrgAnalytics, TeamAnalytics, MyAnalytics } from '../types.ts'
import type { AiResponse } from '../ai/types.ts'
import type { OrgTab } from '../access.ts'
import { briefingFallback, mondayFallback, summaryFallback, type Briefing, type Explanation, type MondayNote, type MySummary } from '../briefs.ts'
import { resolveTopic, explainFallback } from '../topics.ts'
import { briefingTask, explainTask, mondayTask, summaryTask } from '../ai/tasks.ts'
import { istToday } from '../period.ts'
import { runTask } from './ai.ts'

type Opts = { actor: string | null; refresh?: boolean; cron?: boolean }

/** `full` is the server's copy; `body` the reader's, already cut to their tabs. */
export async function briefingFor(full: OrgAnalytics, body: OrgAnalytics, tabs: OrgTab[], win: MoverWindowKey, o: Opts): Promise<AiResponse<Briefing> | null> {
  const set = body.movers?.[win]
  if (!set) return null
  const base = briefingFallback(body, set)
  return runTask(briefingTask(full, set, base, tabs), base, o)
}

export async function explainFor(full: OrgAnalytics, body: OrgAnalytics, tabs: OrgTab[], topic: string, win: MoverWindowKey, o: Opts): Promise<AiResponse<Explanation> | null> {
  const set = body.movers?.[win]
  if (!set) return null
  const r = resolveTopic(topic, body, set)
  if (!r) return null
  const base = explainFallback(r, set, body)
  return runTask(explainTask(full, set, base, r.area, tabs), base, o)
}

export async function mondayFor(team: TeamAnalytics, o: Opts): Promise<AiResponse<MondayNote>> {
  const today = istToday()
  const base = mondayFallback(team, today)
  return runTask(mondayTask(team, base, today), base, o)
}

export async function summaryFor(me: MyAnalytics, o: Opts): Promise<AiResponse<MySummary>> {
  const today = istToday()
  const base = summaryFallback(me)
  return runTask(summaryTask(me, base, today), base, o)
}
