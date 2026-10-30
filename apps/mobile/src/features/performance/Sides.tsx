// src/features/performance/Sides.tsx — the two manager-audience containers
// (website: components/ess/Performance.tsx TeamSide / DeptSide). Each reads the
// period (with its policy, bands and rules) and the frozen-chain roster, and
// wires the website's handlers (actions.ts) into the tabs.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Chain } from '@web/pms/hierarchy'
import { invalidate } from '@/core/query'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { Loading, PickerField } from '@/ui/primitives'
import { bandsOrDefault, loadFeedbackDraft, loadPeriod, loadRateRows, loadRoster, localToday, type FeedbackDraft, type RateRow } from './data'
import { acknowledgeAndLock, acknowledgeFinalReview, approveInChain, finalise, logFinalReview, publishResult, sendBack, submitRating } from './actions'
import { NoPeriod } from './Pending'
import { Banner, K, PCard } from './ui'
import { ApproveTab, PipRequestTab, TeamTab } from './MgrTabs'
import { RateTab } from './RateTab'
import { FeedbackTab, FinaliseTab, TeamAnalyticsTab } from './HodTabs'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'deptAnalytics'
export const MGR_TABS: { k: MgrTab; label: string; blurb: string }[] = [
  { k: 'team', label: 'Team Dashboard', blurb: 'who is where, worst deadline first' },
  { k: 'approve', label: 'KRA Approval & One-to-One', blurb: 'check their sets, then log the discussion' },
  { k: 'rate', label: 'Rate My Team', blurb: 'rate each KRA against what they delivered' },
  { k: 'pip', label: 'PIP Request', blurb: 'raise one, and HR decides whether it starts' },
  { k: 'analytics', label: 'Team Analytics', blurb: 'distribution and gaps, for information' },
]
export const HOD_TABS: { k: HodTab; label: string; blurb: string }[] = [
  { k: 'finalise', label: 'Review & Finalise', blurb: 'sign off, exit and notice cases first' },
  { k: 'feedback', label: 'Feedback & Recognition', blurb: 'what they read, and what they receive' },
  { k: 'deptAnalytics', label: 'Department Analytics', blurb: 'the department against the company' },
]

function useSide(employeeId: string, as: 'rm' | 'hod') {
  const periodQ = useQuery({ queryKey: ['pms', 'period', employeeId], queryFn: () => loadPeriod(employeeId), enabled: !!employeeId })
  const ctx = periodQ.data
  const period = ctx?.period ?? null
  const rosterQ = useQuery({ queryKey: ['pms', 'roster', as, employeeId, period?.id], queryFn: () => loadRoster(employeeId, period!.id, as), enabled: !!period })
  const { notify } = useOverlay()
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  /** Run one website handler: show its sentence, then refetch everything PMS. */
  const run = async (fn: () => Promise<string>) => {
    setSaving(true); setMsg(null)
    try {
      const text = await fn()
      setMsg(text)
      if (text) notify(text, 'info')
      await invalidate('pms')
    } finally { setSaving(false) }
  }
  return {
    ctx, period, rows: rosterQ.data ?? [], loading: periodQ.isLoading || (!!period && rosterQ.isLoading),
    saving, setSaving, msg, setMsg, run,
  }
}

export function TeamSide({ employeeId, tab }: { employeeId: string; tab: MgrTab }) {
  const { ctx, period, rows, loading, saving, setSaving, msg, setMsg, run } = useSide(employeeId, 'rm')
  const { notify } = useOverlay()
  const [picked, setPicked] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<RateRow[] | null>(null)
  const [overall, setOverall] = React.useState('')
  const today = localToday()
  const member = rows.find(r => r.employeeId === picked) ?? null
  const rateQ = useQuery({
    queryKey: ['pms', 'rateRows', employeeId, picked, period?.id],
    queryFn: () => loadRateRows(employeeId, picked!, period!.id), enabled: !!picked && !!period,
  })

  if (loading) return <Loading />
  if (!period || !ctx) return <NoPeriod />
  const bands = bandsOrDefault(ctx.bands)
  const rateRows = draft ?? rateQ.data ?? []
  const byId = (id: string) => rows.find(r => r.employeeId === id)

  const onSubmitRating = async () => {
    setSaving(true); setMsg(null)
    const r = await submitRating({ viewerId: employeeId, member, periodId: period.id, companyId: ctx.companyId, rows: rateRows, overall })
      .finally(() => setSaving(false))
    setMsg(r.msg || null)
    if (r.msg) notify(r.msg, r.ok ? 'success' : 'error')
    if (r.ok) { setDraft(null); await invalidate('pms') }
  }

  return (
    <>
      {!!msg && <Banner tone="blue" glyph="ℹ️">{msg}</Banner>}
      {tab === 'team' && <TeamTab flagRules={ctx.flagRules} rules={ctx.rules} members={rows} today={today} managerName="your team" />}
      {tab === 'approve' && (
        <ApproveTab flagRules={ctx.flagRules} rules={ctx.rules} members={rows} today={today} busy={saving}
          onAcknowledge={id => run(() => acknowledgeAndLock(employeeId, id, period.id))}
          onSendBack={(id, reason) => run(() => sendBack(employeeId, byId(id), id, period.id, reason))}
          onAcknowledgeFinalReview={id => run(() => acknowledgeFinalReview(id, period.id, 'rm'))}
          viewerId={employeeId} chain={(ctx.policy?.approval_chain as Chain | undefined) ?? 'SELF_RM1_RM2_HOD'}
          onApprove={(id, rating) => run(() => approveInChain(employeeId, byId(id), id, period.id, rating))}
          bands={ctx.bands.length ? ctx.bands : undefined} />
      )}
      {tab === 'rate' && (
        <RateTab flagRules={ctx.flagRules} rules={ctx.rules} bands={bands} members={rows} onPick={id => { setPicked(id); setDraft(null); setOverall('') }} today={today}
          member={member} rows={rateRows} onChange={setDraft} loadingRows={rateQ.isLoading}
          onSubmit={() => void onSubmitRating()} saving={saving} overallComment={overall} onOverallComment={setOverall} />
      )}
      {tab === 'pip' && <PipRequestTab flagRules={ctx.flagRules} members={rows} today={today} />}
      {tab === 'analytics' && <TeamAnalyticsTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} scopeLabel="your team" />}
    </>
  )
}

const EMPTY_DRAFT: FeedbackDraft = { appreciation: '', improvement: '', benefits: [] }

export function DeptSide({ employeeId, tab }: { employeeId: string; tab: HodTab }) {
  const { ctx, period, rows, loading, saving, msg, run } = useSide(employeeId, 'hod')
  const [picked, setPicked] = React.useState<string | null>(null)
  const [pickOpen, setPickOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<FeedbackDraft | null>(null)
  const today = localToday()
  const member = rows.find(r => r.employeeId === picked) ?? null
  const fbQ = useQuery({
    queryKey: ['pms', 'fbDraft', picked, period?.id],
    queryFn: () => loadFeedbackDraft(picked!, period!.id), enabled: !!picked && !!period,
  })

  if (loading) return <Loading />
  if (!period || !ctx) return <NoPeriod />
  const bands = bandsOrDefault(ctx.bands)
  const d = draft ?? fbQ.data?.draft ?? EMPTY_DRAFT
  const finalised = rows.filter(r => r.finalised)
  const label = (r: (typeof rows)[number]) => `${r.code} · ${r.name} — rated ${r.finalRating}`

  return (
    <>
      {!!msg && <Banner tone="blue" glyph="ℹ️">{msg}</Banner>}
      {tab === 'finalise' && (
        <FinaliseTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} role="HOD"
          chain={ctx.policy?.approval_chain ?? 'SELF_RM1_RM2_HOD'} whoCanFinalise={ctx.policy?.who_can_finalise ?? 'RM1_RM2_HOD'}
          finalReviewRequired={ctx.policy?.final_review_one_to_one ?? false} deptName="your department"
          onFinalise={(id, rating) => run(() => finalise(employeeId, id, period.id, rating))}
          onLogFinalReview={id => run(() => logFinalReview({ companyId: ctx.companyId, periodId: period.id, employeeId: id, managerId: employeeId, today, points: '' }))}
          onAcknowledgeFinalReview={id => run(() => acknowledgeFinalReview(id, period.id, 'hod'))}
          saving={saving} />
      )}
      {tab === 'feedback' && (
        <>
          <PCard>
            <PickerField label="Whose result" value={member ? label(member) : ''} placeholder="Choose somebody…" onPress={() => setPickOpen(true)}
              style={{ marginBottom: finalised.length ? 0 : undefined }} />
            {!finalised.length && (
              <K>Nobody in your department has been finalised yet. Settle a rating on Review &amp; Finalise first — feedback is published with the result, not before it.</K>
            )}
          </PCard>
          <FeedbackTab bands={bands} member={member} rating={member?.finalRating ?? null}
            appreciation={d.appreciation} improvement={d.improvement} benefits={d.benefits} logs={fbQ.data?.logs ?? []}
            onChange={patch => setDraft({ ...d, ...patch })}
            onPublish={member ? () => run(() => publishResult({ viewerId: employeeId, companyId: ctx.companyId, periodId: period.id, member, draft: d })) : undefined}
            saving={saving} />
          <SelectSheet visible={pickOpen} onClose={() => setPickOpen(false)} title="Whose result" value={picked ?? ''}
            options={[{ value: '', label: 'Choose somebody…' }, ...finalised.map(r => ({ value: r.employeeId, label: label(r) }))]}
            onPick={v => { setPicked(String(v) || null); setDraft(null) /* one draft per person */ }} />
        </>
      )}
      {tab === 'deptAnalytics' && <TeamAnalyticsTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} scopeLabel="your department" />}
    </>
  )
}
