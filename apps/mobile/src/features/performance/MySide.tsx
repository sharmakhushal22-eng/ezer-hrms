// src/features/performance/MySide.tsx — the employee's own side (website:
// components/ess/Performance.tsx MySide). Same reads, same derived values, same
// writes (actions.ts): the merged KRAs + self rating submission into the chain,
// the one-to-one log with duration and weightage changes, acknowledging a
// discussion somebody else logged, the Self Rating tab, and acknowledging a
// published result.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_RULES, STAGES, currentStage, settled, stageStates, type Progress, type Rules, type StageKey } from '@web/pms/cycle'
import { canLockWeightage, canPublishResult, type Log } from '@web/pms/oneToOne'
import { reached, WORKFLOW } from '@web/pms/status'
import type { Kra, Category } from '@web/pms/kra'
import type { Line } from '@web/pms/scoring'
import { invalidate } from '@/core/query'
import { useOverlay } from '@/ui/overlays'
import { Loading } from '@/ui/primitives'
import { bandsOrDefault, loadPeriod, loadPeriodData, loadWho, localToday } from './data'
import { acknowledgeDiscussion, acknowledgeResult, logDiscussion, submitKras, submitSelf, type KraSelf, type SelfRow } from './actions'
import { Banner, K } from './ui'
import { ChainBanner, DashboardTab, KraTab } from './EmpTabsA'
import { OneToOneTab } from './EmpOneToOne'
import { AnalyticsTab, ResultTab, SelfRatingTab } from './EmpTabsB'
import { NoPeriod } from './Pending'

export type EmpTab = 'dashboard' | 'kras' | 'oneToOne' | 'self' | 'result' | 'analytics'
export const EMP_TABS: { k: EmpTab; label: string; blurb: string }[] = [
  { k: 'dashboard', label: 'My Dashboard', blurb: 'where you are in the cycle, and what is owed next' },
  { k: 'kras', label: 'My KRAs', blurb: 'four to ten, totalling exactly 100' },
  { k: 'oneToOne', label: 'One-to-One Log', blurb: 'every discussion, and who has acknowledged it' },
  { k: 'self', label: 'Self Rating', blurb: 'rate your own delivery on each KRA' },
  { k: 'result', label: 'My Result', blurb: 'the final rating and the feedback behind it' },
  { k: 'analytics', label: 'My Analytics', blurb: 'how you and your manager saw the same work' },
]

const blankKra = (seq: number): Kra => ({ seq_no: seq, kra_title: '', kpi_metric: '', target_value: '', category: 'BUSINESS', weightage: 0 })
const STAGE_KEYS = STAGES.map(s => s.key)
const ACTION_LABEL: Record<StageKey, string> = {
  kra: 'Write your KRAs', oneToOne: 'The KRA discussion', lock: 'Waiting on your manager', self: 'Your self rating',
  review: 'With your manager', finalise: 'With the HOD', result: 'Read your result',
}
/** A function because the KRA note quotes the policy's numbers. */
const actionNotes = (rules: Rules): Record<StageKey, string> => ({
  kra: `${rules.minKra} to ${rules.maxKra}, totalling ${rules.totalWeightage}`,
  oneToOne: 'Both of you have to acknowledge it', lock: 'They lock the weightages once acknowledged',
  self: 'Rate every KRA, then submit (it locks)', review: 'Nothing owed from you right now',
  finalise: 'Nothing owed from you right now', result: 'Acknowledge once you have read it',
})
const EMPTY_SELF: KraSelf = { achievement: '', rating: null, comment: '' }

export function MySide({ employeeId, tab }: { employeeId: string; tab: EmpTab }) {
  const { notify } = useOverlay()
  const periodQ = useQuery({ queryKey: ['pms', 'period', employeeId], queryFn: () => loadPeriod(employeeId), enabled: !!employeeId })
  const whoQ = useQuery({ queryKey: ['pms', 'who', employeeId], queryFn: () => loadWho(employeeId), enabled: !!employeeId })
  const ctx = periodQ.data
  const period = ctx?.period ?? null
  const overall = ctx?.overall ?? null
  const rules = ctx?.rules
  const bands = bandsOrDefault(ctx?.bands)
  const dataQ = useQuery({
    queryKey: ['pms', 'periodData', employeeId, period?.id, ctx?.policy?.carry_forward_kras],
    queryFn: () => loadPeriodData(employeeId, ctx!), enabled: !!period,
  })
  const goals = React.useMemo(() => dataQ.data?.goals ?? [], [dataQ.data])
  const reviews = React.useMemo(() => dataQ.data?.reviews ?? [], [dataQ.data])
  const logs: Log[] = dataQ.data?.logs ?? []
  const feedback = dataQ.data?.feedback ?? null
  const carried = dataQ.data?.carried ?? null
  const who = whoQ.data ?? { name: '', code: '' }

  const [draftKras, setDraftKras] = React.useState<Kra[] | null>(null)
  const [selfDraft, setSelfDraft] = React.useState<SelfRow[] | null>(null)
  const [selfBySeq, setSelfBySeq] = React.useState<Record<number, KraSelf> | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const today = localToday()

  const kras: Kra[] = draftKras ?? (goals.length
    ? goals.map(g => ({
        seq_no: Number(g.seq_no), kra_title: String(g.kra_title ?? ''), kpi_metric: String(g.kpi_metric ?? ''),
        target_value: String(g.target_value ?? ''), category: String(g.category ?? 'BUSINESS') as Category, weightage: Number(g.weightage) || 0,
      }))
    : carried?.kras.length ? carried.kras
    : Array.from({ length: rules?.minKra ?? DEFAULT_RULES.minKra }, (_, i) => blankKra(i + 1)))

  const lockGate = canLockWeightage(logs)
  const publishGate = canPublishResult(logs)
  const locked = goals.length > 0 && goals.every(g => g.status === 'LOCKED')
  const selfSubmitted = !!(overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED' && overall.self_score != null)
  // Publication is an event: the workflow ladder, not "a final rating exists".
  const published = reached(overall?.workflow_status, WORKFLOW.PUBLISHED)
  const feedbackVisible = published && !!feedback?.visible_to_employee

  const ratingOf = (goalId: string, role: string) => {
    const row = reviews.find(r => String(r.goal_id) === goalId && r.rater_role === role)
    return row?.rating === null || row?.rating === undefined ? null : Number(row.rating)
  }
  const lines: Line[] = goals.map(g => ({
    goalId: String(g.id), title: String(g.kra_title ?? ''), category: String(g.category ?? 'BUSINESS') as Category,
    weightage: Number(g.weightage) || 0,
    self: ratingOf(String(g.id), 'SELF'), rmL1: ratingOf(String(g.id), 'RM_L1'), rmL2: ratingOf(String(g.id), 'RM_L2'),
    final: ratingOf(String(g.id), 'HOD') ?? ratingOf(String(g.id), 'RM_L2') ?? ratingOf(String(g.id), 'RM_L1'),
  }))
  // seq_no → the employee's saved SELF review (the KRA form works in seq_no).
  const selfSeeded = React.useMemo(() => {
    const out: Record<number, KraSelf> = {}
    for (const g of goals) {
      const row = reviews.find(r => String(r.goal_id) === String(g.id) && r.rater_role === 'SELF')
      out[Number(g.seq_no)] = {
        achievement: String(row?.achievement_value ?? ''),
        rating: row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
        comment: String(row?.comments ?? ''),
      }
    }
    return out
  }, [goals, reviews])
  const selfForKras = selfBySeq ?? selfSeeded
  const selfRows: SelfRow[] = selfDraft ?? goals.map(g => {
    const s = selfSeeded[Number(g.seq_no)] ?? EMPTY_SELF
    return {
      goalId: String(g.id), title: String(g.kra_title ?? ''), weightage: Number(g.weightage) || 0,
      category: String(g.category ?? 'BUSINESS') as Category, achievement: s.achievement, rating: s.rating, comment: s.comment,
    }
  })
  const progress: Progress = settled({
    kraCount: goals.length, weightageTotal: kras.reduce((s, k) => s + k.weightage, 0),
    kraSubmitted: goals.length > 0, kraApproved: locked, oneToOneLogged: logs.length > 0,
    oneToOneBothConfirmed: lockGate.open, selfSubmitted,
    rmL1Done: lines.some(l => l.rmL1 !== null), rmL2Done: lines.some(l => l.rmL2 !== null),
    finalised: overall?.final_rating != null, published,
  })
  const stage = currentStage(progress)
  const states = stageStates({ label: period?.period_code ?? '' }, progress, today)

  if (periodQ.isLoading || (period && dataQ.isLoading)) return <Loading />
  if (!period || !ctx) return <NoPeriod />

  const show = (text: string | null, ok: boolean) => {
    setMsg(text)
    if (text) notify(text, ok ? 'success' : 'error')
  }
  const run = async (fn: () => Promise<{ ok: boolean; msg: string | null }>, after?: () => void) => {
    setSaving(true); setMsg(null)
    try {
      const r = await fn()
      show(r.msg, r.ok)
      if (r.ok) { after?.(); await invalidate('pms') }
    } finally { setSaving(false) }
  }
  const onSubmitKras = () => run(
    () => submitKras({ employeeId, periodId: period.id, companyId: ctx.companyId, goals, kras, self: selfForKras }),
    () => { setDraftKras(null); setSelfBySeq(null) })
  const onSubmitSelf = () => run(() => submitSelf(employeeId, period.id, ctx.companyId, selfRows), () => setSelfDraft(null))
  const onLog = (l: Log) => run(() => logDiscussion({ employeeId, periodId: period.id, companyId: ctx.companyId, managerId: ctx.managerId, l }))
  const onAckLog = (logId: string) => run(() => acknowledgeDiscussion(employeeId, logId))
  const onAckResult = () => { if (published) void run(() => acknowledgeResult(employeeId, period.id)) }
  const onSelfChange = (seq: number, patch: Partial<KraSelf>) => setSelfBySeq(prev => {
    const base = prev ?? selfSeeded
    return { ...base, [seq]: { ...(base[seq] ?? EMPTY_SELF), ...patch } }
  })

  return (
    <>
      {!!msg && <Banner tone="blue" glyph="ℹ️">{msg}</Banner>}
      <ChainBanner stage={overall?.chain_stage} sentBackReason={overall?.sent_back_reason} sentBackAt={overall?.sent_back_at} />
      {tab === 'dashboard' && (
        <DashboardTab rules={ctx.rules} bands={bands} who={who}
          stages={STAGE_KEYS.map(k => ({ key: k, state: states[k], detail: k === 'kra' && goals.length ? `${goals.length} KRAs` : '' }))}
          current={stage} kraCount={goals.length} weightage={kras.reduce((s, k) => s + k.weightage, 0)}
          frequency="This period" periodLabel={period.period_code}
          lastRating={overall?.final_rating ?? null} lastScore={overall?.self_score ?? null}
          actionLabel={ACTION_LABEL[stage] ?? 'Nothing right now'} actionNote={actionNotes(ctx.rules)[stage] ?? ''} />
      )}
      {tab === 'kras' && (
        <KraTab rules={ctx.rules} carriedFrom={!goals.length && carried ? carried.fromPeriodCode : null} bands={bands}
          self={selfForKras} onSelfChange={onSelfChange} selfSubmitted={selfSubmitted}
          rateRequired={logs.some(l => l.discussion_type === 'KRA_SETTING' && (l.employee_ack || l.manager_ack))}
          kras={kras} onChange={setDraftKras} locked={locked} lockGate={lockGate} onSubmit={onSubmitKras} saving={saving} />
      )}
      {tab === 'oneToOne' && (
        <OneToOneTab kras={kras.map(k => ({ seq_no: k.seq_no, kra_title: k.kra_title, weightage: k.weightage }))}
          logs={logs} managerName="your manager" onLog={onLog} onAcknowledge={onAckLog} saving={saving} />
      )}
      {tab === 'self' && (!locked
        ? <Banner tone="amber" glyph="🔒">Self rating opens once your weightages are locked. {lockGate.because}</Banner>
        : <SelfRatingTab bands={bands} rows={selfRows} onChange={setSelfDraft} submitted={selfSubmitted} onSubmit={onSubmitSelf} saving={saving} />)}
      {tab === 'result' && (
        <ResultTab bands={bands} published={published} lines={lines} finalRating={overall?.final_rating ?? null}
          onAcknowledge={onAckResult} acknowledged={overall?.workflow_status === WORKFLOW.ACKNOWLEDGED} saving={saving}
          appreciation={feedbackVisible ? (feedback?.appreciation_remark as string | undefined) : undefined}
          improvement={feedbackVisible ? (feedback?.improvement_feedback as string | undefined) : undefined}
          benefits={feedbackVisible ? dataQ.data?.benefits ?? [] : []} publishGate={publishGate} />
      )}
      {tab === 'analytics' && <AnalyticsTab lines={lines} published={published} />}
      {dataQ.isError && <K>{(dataQ.error as Error).message}</K>}
    </>
  )
}
