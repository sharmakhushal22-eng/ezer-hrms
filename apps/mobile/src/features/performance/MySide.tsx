// src/features/performance/MySide.tsx — the employee's own side (website:
// components/ess/Performance.tsx MySide). Same reads, same derived values, same
// three writes (KRA insert, one-to-one insert, SELF review upsert), same banner.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_RULES, STAGES, currentStage, settled, stageStates, type Progress, type StageKey } from '@web/pms/cycle'
import { canLockWeightage, canPublishResult, type Log } from '@web/pms/oneToOne'
import type { Kra, Category } from '@web/pms/kra'
import type { Line } from '@web/pms/scoring'
import { invalidate } from '@/core/query'
import { useOverlay } from '@/ui/overlays'
import { Loading } from '@/ui/primitives'
import { loadPeriod, loadPeriodData, loadWho, localToday, logDiscussion, submitKras, submitSelf, type SelfRow } from './data'
import { Banner, K } from './ui'
import { DashboardTab, KraTab, OneToOneTab } from './EmpTabsA'
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
const ACTION_NOTE: Record<StageKey, string> = {
  kra: `${DEFAULT_RULES.minKra} to ${DEFAULT_RULES.maxKra}, totalling ${DEFAULT_RULES.totalWeightage}`,
  oneToOne: 'Both of you have to acknowledge it', lock: 'They lock the weightages once acknowledged',
  self: 'Rate every KRA, then submit (it locks)', review: 'Nothing owed from you right now',
  finalise: 'Nothing owed from you right now', result: 'Acknowledge once you have read it',
}

export function MySide({ employeeId, tab }: { employeeId: string; tab: EmpTab }) {
  const { notify } = useOverlay()
  const periodQ = useQuery({ queryKey: ['pms', 'period', employeeId], queryFn: () => loadPeriod(employeeId), enabled: !!employeeId })
  const whoQ = useQuery({ queryKey: ['pms', 'who', employeeId], queryFn: () => loadWho(employeeId), enabled: !!employeeId })
  const period = periodQ.data?.period ?? null
  const overall = periodQ.data?.overall ?? null
  const dataQ = useQuery({ queryKey: ['pms', 'periodData', employeeId, period?.id], queryFn: () => loadPeriodData(employeeId, period!.id), enabled: !!period })
  const goals = dataQ.data?.goals ?? []
  const logs: Log[] = dataQ.data?.logs ?? []
  const reviews = dataQ.data?.reviews ?? []
  const feedback = dataQ.data?.feedback ?? null
  const who = whoQ.data ?? { name: '', code: '' }

  const [draftKras, setDraftKras] = React.useState<Kra[] | null>(null)
  const [selfDraft, setSelfDraft] = React.useState<SelfRow[] | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const today = localToday()

  const kras: Kra[] = draftKras ?? (goals.length
    ? goals.map(g => ({
        seq_no: Number(g.seq_no), kra_title: String(g.kra_title ?? ''), kpi_metric: String(g.kpi_metric ?? ''),
        target_value: String(g.target_value ?? ''), category: String(g.category ?? 'BUSINESS') as Category, weightage: Number(g.weightage) || 0,
      }))
    : Array.from({ length: DEFAULT_RULES.minKra }, (_, i) => blankKra(i + 1)))

  const lockGate = canLockWeightage(logs)
  const publishGate = canPublishResult(logs)
  const locked = goals.length > 0 && goals.every(g => g.status === 'LOCKED')
  const selfSubmitted = !!(overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED' && overall.self_score != null)
  const published = !!feedback?.visible_to_employee || overall?.final_rating != null

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
  const selfRows: SelfRow[] = selfDraft ?? goals.map(g => {
    const row = reviews.find(r => String(r.goal_id) === String(g.id) && r.rater_role === 'SELF')
    return {
      goalId: String(g.id), title: String(g.kra_title ?? ''), weightage: Number(g.weightage) || 0,
      category: String(g.category ?? 'BUSINESS') as Category,
      achievement: String(row?.achievement_value ?? ''),
      rating: row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
      comment: String(row?.comments ?? ''),
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
  // No windows passed, exactly as the website's inner stepper.
  const states = stageStates({ label: period?.period_code ?? '' }, progress, today)

  if (periodQ.isLoading || (period && dataQ.isLoading)) return <Loading />
  if (!period) return <NoPeriod />

  const done = async (text: string | null, ok: boolean) => {
    setMsg(text)
    if (text) notify(text, ok ? 'success' : 'error')
    if (ok) await invalidate('pms')
  }
  const onSubmitKras = async () => {
    setSaving(true); setMsg(null)
    const r = await submitKras(employeeId, period.id, kras)
    setSaving(false)
    if (r.ok) setDraftKras(null)
    await done(r.msg, r.ok)
  }
  const onSubmitSelf = async () => {
    setSaving(true); setMsg(null)
    const err = await submitSelf(employeeId, period.id, selfRows)
    setSaving(false)
    if (err) { await done(err, false); return }
    setSelfDraft(null)
    await invalidate('pms')
  }
  const onLog = async (l: Log) => {
    setSaving(true)
    const err = await logDiscussion(employeeId, period.id, l)
    setSaving(false)
    if (err) await done(err, false); else await invalidate('pms')
  }

  return (
    <>
      {!!msg && <Banner tone="blue" glyph="ℹ️">{msg}</Banner>}
      {tab === 'dashboard' && (
        <DashboardTab who={who}
          stages={STAGE_KEYS.map(k => ({ key: k, state: states[k], detail: k === 'kra' && goals.length ? `${goals.length} KRAs` : '' }))}
          current={stage} kraCount={goals.length} weightage={kras.reduce((s, k) => s + k.weightage, 0)}
          frequency="This period" periodLabel={period.period_code}
          lastRating={overall?.final_rating ?? null} lastScore={overall?.self_score ?? null}
          actionLabel={ACTION_LABEL[stage] ?? 'Nothing right now'} actionNote={ACTION_NOTE[stage] ?? ''} />
      )}
      {tab === 'kras' && <KraTab kras={kras} onChange={setDraftKras} locked={locked} lockGate={lockGate} onSubmit={onSubmitKras} saving={saving} />}
      {tab === 'oneToOne' && <OneToOneTab logs={logs} managerName="your manager" onLog={onLog} saving={saving} />}
      {tab === 'self' && (!locked
        ? <Banner tone="amber" glyph="🔒">Self rating opens once your weightages are locked. {lockGate.because}</Banner>
        : <SelfRatingTab rows={selfRows} onChange={setSelfDraft} submitted={selfSubmitted} onSubmit={onSubmitSelf} saving={saving} />)}
      {tab === 'result' && (
        <ResultTab published={published} lines={lines} finalRating={overall?.final_rating ?? null}
          appreciation={feedback?.appreciation_remark as string | undefined}
          improvement={feedback?.improvement_feedback as string | undefined} publishGate={publishGate} />
      )}
      {tab === 'analytics' && <AnalyticsTab lines={lines} published={published} />}
      {dataQ.isError && <K>{(dataQ.error as Error).message}</K>}
    </>
  )
}
