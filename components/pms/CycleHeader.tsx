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
import StatCards, { type Stat } from './StatCards'
import { nameThePeriod, periodSpanShort, frequencyPhrase, type PeriodNaming } from '@/lib/pms/language'
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

interface Loaded {
  period: Period; progress: Progress; queues: Queues; rules: Rules
  naming: PeriodNaming
  span: string
  frequency: string
  lastRating?: { score: number | null; label: string | null } | null
}

const EMPTY: Loaded = {
  period: { label: '' }, progress: {}, queues: {}, rules: DEFAULT_RULES,
  naming: { title: 'No review period is open', sub: 'Nothing is running right now', code: '' },
  span: '', frequency: '',
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
        .select('id, period_name, period_code, financial_year, period_no, period_start, period_end,'
              + ' kra_window_from, kra_window_to,'
              + ' self_rating_from, self_rating_to, rm_review_from, rm_review_to,'
              + ' finalise_from, finalise_to, result_publish_date, status,'
              + ' pms_policies(frequency)')
        // NOT .eq('status','ACTIVE') — pms_periods has no such value, and
        // that filter matches zero rows forever without ever erroring.
        .in('status', PERIOD_OPEN)
        .order('period_start', { ascending: false }).limit(1).maybeSingle()

      if (missing(per.error)) { if (alive) { setPending(true); setD(EMPTY) } ; return }
      const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
      if (!row) { if (alive) setD(EMPTY); return }

      const win = (a: string, b: string) =>
        row[a] && row[b] ? { from: row[a] as string, to: row[b] as string } : undefined

      // How many periods a year, so "3rd of 4" can be said without arithmetic.
      const freq = ((row as unknown as { pms_policies?: { frequency?: string } })
        .pms_policies?.frequency) ?? null
      const perYear = freq === 'MONTHLY' ? 12 : freq === 'QUARTERLY' ? 4
                    : freq === 'HALF_YEARLY' ? 2 : freq === 'ANNUAL' ? 1 : null

      // The heading is the months this covers. "Q3 2026-27" is a filing code
      // and is kept as one — small, and underneath.
      const naming = nameThePeriod({
        periodName: row.period_name, periodCode: row.period_code,
        financialYear: row.financial_year,
        periodStart: row.period_start, periodEnd: row.period_end,
        periodNo: row.period_no ? Number(row.period_no) : null,
        totalPeriods: perYear, frequency: freq,
      }, today)

      const period: Period = {
        label: naming.title,
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
          .select('workflow_status, published_at, self_score, final_score, final_rating')
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

      if (alive) setD({
        period, progress, queues, rules: DEFAULT_RULES, naming,
        span: periodSpanShort(row.period_start, row.period_end),
        frequency: frequencyPhrase(freq),
        lastRating: ov?.final_score != null
          ? { score: Number(ov.final_score), label: (ov.final_rating as string) ?? null }
          : null,
      })
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

  const r = d.rules
  const kn = d.progress.kraCount ?? 0
  const wt = d.progress.weightageTotal ?? 0
  const setDone = kn >= r.minKra && kn <= r.maxKra && wt === r.totalWeightage

  // Each number carries the sentence that makes it mean something. "6" on its
  // own is decoration; "needs 4 to 10" is the rule the reader is being held to.
  const stats: Stat[] = [
    {
      label: 'Your KRAs', value: kn, unit: kn === 1 ? 'goal' : 'goals',
      tone: kn === 0 ? 'neutral' : (kn >= r.minKra && kn <= r.maxKra) ? 'good' : 'warn',
      fill: Math.min(1, kn / r.minKra),
      meaning: kn === 0 ? `You need between ${r.minKra} and ${r.maxKra}.`
             : kn < r.minKra ? `${r.minKra - kn} more to reach the minimum of ${r.minKra}.`
             : kn > r.maxKra ? `That is ${kn - r.maxKra} over the limit of ${r.maxKra}.`
             : `Within the ${r.minKra}–${r.maxKra} allowed.`,
    },
    {
      label: 'Weightage used', value: wt, unit: `of ${r.totalWeightage}%`,
      tone: wt === r.totalWeightage ? 'good' : wt > r.totalWeightage ? 'bad' : 'warn',
      fill: wt / r.totalWeightage,
      meaning: wt === r.totalWeightage ? 'Adds up exactly. Nothing to change.'
             : wt > r.totalWeightage ? `${wt - r.totalWeightage}% too much — take some off a goal.`
             : `${r.totalWeightage - wt}% still to share out across your goals.`,
    },
    {
      label: 'How often', value: d.frequency || 'Not set',
      meaning: d.span ? `This one covers ${d.span}.` : 'Your HR team sets the dates.',
    },
    d.lastRating
      ? { label: 'Your last result', value: d.lastRating.score ?? '—',
          unit: d.lastRating.label ? `· ${d.lastRating.label}` : undefined, tone: 'brand',
          meaning: 'Published for the previous period.' }
      : { label: 'Your last result', value: 'Not yet', tone: 'neutral',
          meaning: 'Your first result appears here once a cycle finishes.' },
  ]

  return (
    <section style={{ marginBottom: S.lg }} aria-label="Where this appraisal cycle is">
      <div className="pms-head" style={{
        border: `1px solid ${C.line}`, borderRadius: R.sm,
        padding: `${S.lg}px ${S.lg}px ${S.lg}px`, marginBottom: S.sm,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
                      gap: S.md, flexWrap: 'wrap', marginBottom: S.lg }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              fontSize: F.title, fontWeight: W.bold, color: C.ink, letterSpacing: '-.015em',
              lineHeight: 1.15, margin: 0,
            }}>{d.naming.title}</h2>
            <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 4 }}>
              {d.naming.sub}
              {d.naming.code && (
                <span style={{
                  marginLeft: 8, padding: '2px 7px', borderRadius: 999, background: C.sunken,
                  color: C.muted, fontSize: F.micro, fontWeight: W.semi, whiteSpace: 'nowrap',
                }} title="The code your HR team files this under">{d.naming.code}</span>
              )}
            </div>
          </div>
          <div style={{ fontSize: F.micro, color: C.muted, maxWidth: '38ch', textAlign: 'right' }}>
            {pending
              ? 'These are the stages every appraisal goes through. The module is not switched on in this database yet, so nothing is filled in.'
              : 'Hover any stage to see what happens in it.'}
          </div>
        </div>

        <CycleStepper states={states as never} detail={detail as never} />
      </div>

      <div style={{ marginBottom: S.sm }}><NextAction action={action} onGo={onGo} /></div>
      <StatCards stats={stats} />

      <style>{`
        /* A ground, not a flat panel: the rail of stages sits on a faint
           vertical wash so the stepper reads as a surface with things on it
           rather than a row of icons floating on the page. */
        .pms-head{
          background: linear-gradient(180deg, ${C.surface} 0%, ${C.canvas} 100%);
          box-shadow: 0 1px 2px rgba(16,36,100,.05);
        }
      `}</style>
    </section>
  )
}
