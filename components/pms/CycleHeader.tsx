'use client'
// components/pms/CycleHeader.tsx — the orientation strip above every PMS tab.
//
// Period · stepper · what you owe. It is the same three things for an
// employee, a manager, an HOD and HR, because the question "where are we and
// what is mine" does not change with the role — only the answer does.
//
// IT LOADS AGAINST TABLES THAT DO NOT EXIST YET
//
// The pms_* tables ship in migrations Nayan has not applied. Every read here
// can legitimately come back PGRST205, and the honest render for that is the
// cycle with nothing done rather than an error — the stages are still true,
// they just have no evidence behind them yet. That also means this component
// is the one place that knows the column names, so when the migration lands
// there is a single file to check rather than six screens.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CycleStepper from './CycleStepper'
import NextAction from './NextAction'
import {
  stageStates, nextAction, humanDate, DEFAULT_RULES,
  type Period, type Progress, type Roles, type Queues, type Rules,
} from '@/lib/pms/cycle'
import {
  PERIOD_OPEN, GOAL_SENT, GOAL_STATUS, GOAL_AWAITING_RM, WORKFLOW, reached,
} from '@/lib/pms/status'
import { C, F, W, S, R } from '@/lib/ui'

/** PostgREST's "that relation does not exist". */
const MISSING = 'PGRST205'
const missing = (e: unknown) => (e as { code?: string } | null)?.code === MISSING

/** Today as yyyy-mm-dd in LOCAL time. toISOString() would be UTC, which puts
 *  an Indian user a day behind their own deadline for the last 5.5 hours of
 *  every day — exactly when somebody is racing a window close. */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface Loaded { period: Period; progress: Progress; queues: Queues; rules: Rules }

const EMPTY: Loaded = {
  period: { label: 'No active period' }, progress: {}, queues: {}, rules: DEFAULT_RULES,
}

export default function CycleHeader({
  employeeId, roles, onGo,
}: { employeeId: string; roles: Roles; onGo?: (tab: string) => void }) {
  const [d, setD] = useState<Loaded | null>(null)
  const [pending, setPending] = useState(false)   // module not installed yet
  const today = localToday()

  useEffect(() => {
    let alive = true
    ;(async () => {
      const per = await supabase.from('pms_periods')
        .select('id, period_name, period_code, financial_year, kra_window_from, kra_window_to,'
              + ' self_rating_from, self_rating_to, rm_review_from, rm_review_to,'
              + ' finalise_from, finalise_to, result_publish_date, status')
        // NOT .eq('status','ACTIVE') — pms_periods has no such value, and
        // that filter matches zero rows forever without ever erroring.
        .in('status', PERIOD_OPEN)
        .order('period_start', { ascending: false }).limit(1).maybeSingle()

      if (missing(per.error)) { if (alive) { setPending(true); setD(EMPTY) } ; return }
      const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
      if (!row) { if (alive) setD(EMPTY); return }

      const win = (a: string, b: string) =>
        row[a] && row[b] ? { from: row[a] as string, to: row[b] as string } : undefined

      const period: Period = {
        label: [row.period_name || row.period_code, row.financial_year].filter(Boolean).join(' · '),
        kra: win('kra_window_from', 'kra_window_to'),
        self: win('self_rating_from', 'self_rating_to'),
        review: win('rm_review_from', 'rm_review_to'),
        finalise: win('finalise_from', 'finalise_to'),
        publishedOn: row.result_publish_date,
      }
      const periodId = row.id

      // Everything below is best-effort: a failed read leaves its flag unset,
      // which settled() treats as "not done". Never as done.
      const [goals, o2o, overall] = await Promise.all([
        supabase.from('pms_employee_goals')
          .select('weightage, status').eq('period_id', periodId).eq('employee_id', employeeId),
        supabase.from('pms_one_to_one')
          .select('employee_ack, manager_ack').eq('period_id', periodId).eq('employee_id', employeeId),
        supabase.from('pms_overall_rating')
          .select('workflow_status, published_at, self_score, final_score')
          .eq('period_id', periodId).eq('employee_id', employeeId).maybeSingle(),
      ])

      const rows = (goals.data ?? []) as unknown as { weightage: number; status: string }[]
      const ov = (overall.data ?? null) as unknown as Record<string, unknown> | null
      const meet = (o2o.data ?? []) as unknown as { employee_ack: boolean; manager_ack: boolean }[]
      const wf = (ov?.workflow_status as string | undefined) ?? undefined

      // Two independent sources agree on most of this: the goal rows say what
      // the employee did, the workflow column says what the process recorded.
      // Either is taken as evidence — a row present but a workflow not yet
      // stamped is a lag, never a reason to tell somebody to redo work.
      const progress: Progress = {
        kraCount: rows.length,
        weightageTotal: rows.reduce((t, r) => t + (Number(r.weightage) || 0), 0),
        kraSubmitted: rows.some(r => GOAL_SENT.includes(r.status)) || reached(wf, WORKFLOW.KRA_DRAFT),
        kraApproved:  rows.some(r => r.status === GOAL_STATUS.LOCKED) || reached(wf, WORKFLOW.KRA_LOCKED),
        oneToOneLogged: meet.length > 0,
        oneToOneBothConfirmed: meet.some(m => m.employee_ack && m.manager_ack),
        selfSubmitted: ov?.self_score != null || reached(wf, WORKFLOW.SELF_SUBMITTED),
        rmL1Done: reached(wf, WORKFLOW.RM_L1_DONE),
        rmL2Done: reached(wf, WORKFLOW.RM_L2_DONE),
        finalised: reached(wf, WORKFLOW.FINALISED),
        published: Boolean(ov?.published_at) || reached(wf, WORKFLOW.PUBLISHED),
      }

      // Queues only matter to somebody who has one.
      const queues: Queues = {}
      if (roles.isRM || roles.isHOD) {
        const team = await supabase.from('employees').select('id')
          .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`)
          .is('date_of_leaving', null)
        const ids = ((team.data ?? []) as unknown as { id: string }[]).map(t => t.id)
        if (ids.length) {
          const pend = await supabase.from('pms_employee_goals')
            .select('employee_id, status').eq('period_id', periodId).in('employee_id', ids)
          const byEmp = new Map<string, string[]>()
          for (const g of (pend.data ?? []) as unknown as { employee_id: string; status: string }[]) {
            byEmp.set(g.employee_id, [...(byEmp.get(g.employee_id) ?? []), g.status])
          }
          // Waiting on THIS manager: at least one goal sitting in
          // PENDING_RM_APPROVAL and none of them locked yet.
          queues.kraApprovals = [...byEmp.values()].filter(ss =>
            ss.some(x => GOAL_AWAITING_RM.includes(x)) &&
            !ss.some(x => x === GOAL_STATUS.LOCKED)).length
        }
      }

      if (alive) setD({ period, progress, queues, rules: DEFAULT_RULES })
    })().catch(() => { if (alive) setD(EMPTY) })
    return () => { alive = false }
  }, [employeeId, roles.isRM, roles.isHOD])

  if (!d) {
    return <div style={{ height: 132, borderRadius: R.sm, background: C.sunken, opacity: .5 }} aria-hidden />
  }

  const states = stageStates(d.period, d.progress, today)
  const action = nextAction(d.period, d.progress, roles, d.queues, today, d.rules)

  const detail: Partial<Record<string, string>> = {
    kra: d.progress.kraCount
      ? `${d.progress.kraCount} KRAs · ${d.progress.weightageTotal ?? 0}%`
      : undefined,
    self: d.period.self ? `${humanDate(d.period.self.from)} – ${humanDate(d.period.self.to)}` : undefined,
    finalise: d.period.finalise ? `by ${humanDate(d.period.finalise.to)}` : undefined,
  }

  return (
    <section style={{ marginBottom: S.lg }} aria-label="Where this appraisal cycle is">
      <div style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm,
        padding: `${S.md}px ${S.lg}px ${S.lg}px`, marginBottom: S.sm,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{d.period.label}</div>
          <div style={{ fontSize: F.micro, color: C.muted }}>
            {pending
              ? 'Showing the stages only — the module is not switched on in this database yet.'
              : 'Hover a stage to see what happens in it.'}
          </div>
        </div>
        <CycleStepper states={states as never} detail={detail as never} />
      </div>
      <NextAction action={action} onGo={onGo} />
    </section>
  )
}
