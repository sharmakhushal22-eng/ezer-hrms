// src/features/performance/Sides.tsx — the two manager-audience containers
// (website: components/ess/Performance.tsx TeamSide / DeptSide). Each reads
// the period (with its policy, bands, rules and chain) and the frozen-chain
// roster, and wires the website's handlers (actionsTeam.ts) into the tabs.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { approvalFinalises, heldBy, rungFor } from '@web/pms/chain'
import { showFinaliserFeedbackTab } from '@web/pms/postFinal'
import { defaultPipWindow, type PipIntent, type RecognitionIntent } from '@web/pms/training'
import type { BinSuggestion } from '@web/pms/trainingAi'
import { invalidate } from '@/core/query'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { Loading, PickerField } from '@/ui/primitives'
import { bandsOrDefault, loadPeriod, localToday } from './data'
import { loadFeedbackDraft, loadHrHead, loadKraPanel, loadPublished, loadRateRows, loadRoster, type FeedbackDraft } from './dataTeam'
import { acknowledgeAndLock, acknowledgeFinalReview, askForTraining, dismissSuggestion, finalise, logFinalReview, publishResult, rateAndApprove, sendBack } from './actionsTeam'
import { compareFor, EMPTY_TRAINING, trainingContext, type Rate, type TrainingDraft } from './logic'
import { NoPeriod } from './Pending'
import { B, Banner, K, PCard } from './ui'
import { ApproveTab, PipRequestTab, TeamTab } from './MgrTabs'
import { KraPanel } from './KraPanel'
import { RateTab } from './RateTab'
import { FeedbackOwnedByHr, FeedbackTab, FinaliseTab, PublishedResultsTab, TeamAnalyticsTab } from './HodTabs'
import { useReveal } from './scroll'

export type MgrTab = 'team' | 'approve' | 'rate' | 'pip' | 'analytics'
export type HodTab = 'finalise' | 'feedback' | 'published' | 'deptAnalytics'
export const MGR_TABS: { k: MgrTab; label: string; blurb: string }[] = [
  { k: 'team', label: 'Team Dashboard', blurb: 'who is where, worst deadline first' },
  { k: 'approve', label: 'KRA Approval & One-to-One', blurb: 'check their sets, then log the discussion' },
  { k: 'rate', label: 'Team Ratings', blurb: 'what each rung of the chain scored, read-only' },
  { k: 'pip', label: 'PIP Request', blurb: 'raise one, and HR decides whether it starts' },
  { k: 'analytics', label: 'Team Analytics', blurb: 'distribution and gaps, for information' },
]
export const HOD_TABS: { k: HodTab; label: string; blurb: string }[] = [
  { k: 'finalise', label: 'Review & Finalise', blurb: 'sign off, exit and notice cases first' },
  { k: 'feedback', label: 'Feedback & Recognition', blurb: 'what they read, and what they receive' },
  { k: 'published', label: 'Published Results', blurb: 'released and settled — your department\'s record, read-only' },
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
  return { ctx, period, rows: rosterQ.data ?? [], loading: periodQ.isLoading || (!!period && rosterQ.isLoading), saving, setSaving, msg, setMsg, run }
}

const emptyPip = (today: string): PipIntent => { const w = defaultPipWindow(today); return { wanted: false, reason: '', proposedStart: w.start, proposedEnd: w.end } }
const EMPTY_RECOG: RecognitionIntent = { wanted: false, kind: 'BONUS', note: '' }

export function TeamSide({ employeeId, tab }: { employeeId: string; tab: MgrTab }) {
  const { ctx, period, rows, loading, saving, setSaving, msg, setMsg, run } = useSide(employeeId, 'rm')
  const { notify } = useOverlay()
  const reveal = useReveal()
  const top = React.useRef<View>(null)
  const today = localToday()
  // Team Ratings: whose record is open.
  const [picked, setPicked] = React.useState<string | null>(null)
  // The review panel: whose, and this rater's draft (cleared when it closes).
  const [kraFor, setKraFor] = React.useState<string | null>(null)
  const [rate, setRate] = React.useState<Rate | null>(null)
  const [finalRating, setFinalRating] = React.useState('')
  const [confirmed, setConfirmed] = React.useState(false)
  const [overall, setOverall] = React.useState('')
  const [training, setTraining] = React.useState<TrainingDraft[]>([{ ...EMPTY_TRAINING }])
  const [pip, setPip] = React.useState<PipIntent>(() => emptyPip(today))
  const [recog, setRecog] = React.useState<RecognitionIntent>(EMPTY_RECOG)
  /** The AI bin, held per employee so one person's suggestions never show under another's name. */
  const [aiBin, setAiBin] = React.useState<Record<string, BinSuggestion[]>>({})
  const [aiBusy, setAiBusy] = React.useState(false)
  const [aiNote, setAiNote] = React.useState<string | null>(null)

  const member = rows.find(r => r.employeeId === picked) ?? null
  const panelMember = rows.find(r => r.employeeId === kraFor) ?? null
  const rung = panelMember ? rungFor(panelMember, employeeId) : null
  const rateQ = useQuery({
    queryKey: ['pms', 'rateRows', picked, period?.id],
    queryFn: () => loadRateRows(picked!, period!.id), enabled: !!picked && !!period,
  })
  const panelQ = useQuery({
    queryKey: ['pms', 'kraPanel', kraFor, period?.id, rung],
    queryFn: () => loadKraPanel(kraFor!, period!.id, rung), enabled: !!kraFor && !!period, staleTime: Infinity,
  })

  if (loading) return <Loading />
  if (!period || !ctx) return <NoPeriod />
  const bands = bandsOrDefault(ctx.bands)
  const byId = (id: string) => rows.find(r => r.employeeId === id)
  const lines = panelQ.data?.lines ?? null
  // This rater's scores, seeded from what they already wrote: a second visit is an edit, not a restart.
  const myRate: Rate = rate ?? panelQ.data?.mine ?? {}

  const closePanel = () => {
    setKraFor(null); setRate(null); setFinalRating(''); setConfirmed(false)
    reveal(top.current)
  }
  const openKras = (id: string) => {
    setKraFor(id); setRate(null); setFinalRating(''); setConfirmed(false); setAiNote(null)
    reveal(top.current)
  }
  const onApprove = async (fr?: number) => {
    if (!panelMember) return
    setSaving(true); setMsg(null)
    try {
      const r = await rateAndApprove({ viewerId: employeeId, member: panelMember, periodId: period.id, companyId: ctx.companyId, today,
        lines, rate: myRate, overall, training, pip, recog, finalRating: fr })
      setMsg(r.msg)
      if (r.msg) notify(r.msg, 'info')
      if (r.closed) {
        setKraFor(null); setRate(null); setFinalRating(''); setConfirmed(false); setOverall('')
        setTraining([{ ...EMPTY_TRAINING }]); setPip(emptyPip(today)); setRecog(EMPTY_RECOG)
        await invalidate('pms')
      }
      reveal(top.current)
    } finally { setSaving(false) }
  }
  const askAi = async () => {
    if (!panelMember) return
    setAiBusy(true); setAiNote(null)
    const cmp = compareFor(lines, myRate)
    const r = await askForTraining({ periodId: period.id, employeeId: panelMember.employeeId, companyId: ctx.companyId,
      context: trainingContext(panelMember, lines, myRate, cmp, { overall, bands, pip, recog }) }).finally(() => setAiBusy(false))
    if (r.suggestions) setAiBin(b => ({ ...b, [panelMember.employeeId]: r.suggestions! }))
    setAiNote(r.note)
  }
  const dismiss = (s: BinSuggestion) => {
    if (!panelMember) return
    setAiBin(b => ({ ...b, [panelMember.employeeId]: (b[panelMember.employeeId] ?? []).filter(x => x.id !== s.id) }))
    void dismissSuggestion(employeeId, s.id)
  }

  return (
    <View ref={top}>
      {!!msg && <Banner tone="blue" glyph="ℹ️">{msg}</Banner>}
      {tab === 'team' && <TeamTab flagRules={ctx.flagRules} rules={ctx.rules} members={rows} today={today} managerName="your team" viewerId={employeeId} />}
      {tab === 'approve' && (panelMember ? (
        // The panel takes the tab's place on a phone: one person, one task, a way back.
        <KraPanel member={panelMember} lines={panelQ.isLoading ? null : lines} onClose={closePanel}
          // Only the rung HOLDING it may rate and approve; anyone else gets the read-only record.
          myRung={rung && panelMember.chainStage === rung ? rung : null} rate={myRate} bands={bands}
          onRate={(kpiId, patch) => setRate(prev => {
            const base = prev ?? panelQ.data?.mine ?? {}
            return { ...base, [kpiId]: { ...(base[kpiId] ?? { rating: null, comment: '' }), ...patch } }
          })}
          confirmed={confirmed} onConfirm={setConfirmed}
          alreadyConfirmed={rung === 'RM_L1' ? panelMember.oneToOneDone === true : rung === 'HOD' ? panelMember.finalReviewMgrAcked === true : panelMember.rmL2ConfirmedOneToOne === true}
          finalises={!!rung && approvalFinalises(ctx.chain, rung, heldBy(panelMember))}
          finalRating={finalRating} onFinalRating={setFinalRating}
          overall={overall} onOverall={setOverall}
          training={training} onTraining={setTraining}
          ai={{ suggestions: aiBin[panelMember.employeeId] ?? null, busy: aiBusy, note: aiNote, onGenerate: () => void askAi(), onDismiss: dismiss }}
          pip={pip} onPip={p => setPip(x => ({ ...x, ...p }))} recog={recog} onRecog={r => setRecog(x => ({ ...x, ...r }))}
          today={today} onApprove={fr => void onApprove(fr)} saving={saving} />
      ) : (
        <ApproveTab flagRules={ctx.flagRules} rules={ctx.rules} members={rows} today={today} busy={saving}
          onAcknowledge={id => run(() => acknowledgeAndLock({ managerId: employeeId, id, periodId: period.id, companyId: ctx.companyId, today }))}
          onSendBack={(id, reason) => run(() => sendBack(employeeId, byId(id), id, period.id, reason))}
          onAcknowledgeFinalReview={id => run(() => acknowledgeFinalReview(id, period.id, 'rm'))}
          viewerId={employeeId} chain={ctx.chain} onOpenKras={openKras} />
      ))}
      {tab === 'rate' && (
        <RateTab flagRules={ctx.flagRules} rules={ctx.rules} bands={bands} members={rows} today={today}
          onPick={id => { setPicked(id); reveal(top.current) }} member={member} rows={rateQ.data ?? []} loadingRows={rateQ.isLoading} />
      )}
      {tab === 'pip' && <PipRequestTab flagRules={ctx.flagRules} members={rows} today={today} />}
      {tab === 'analytics' && <TeamAnalyticsTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} scopeLabel="your team" />}
    </View>
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
  const publishedIds = rows.filter(r => r.published).map(r => r.employeeId)
  const pubQ = useQuery({
    queryKey: ['pms', 'published', period?.id, publishedIds.join(',')],
    queryFn: () => loadPublished(period!.id, publishedIds), enabled: !!period && tab === 'published',
  })
  const hrHeadQ = useQuery({ queryKey: ['pms', 'hrHead', period?.policy_id], queryFn: () => loadHrHead(period?.policy_id), enabled: !!period && tab === 'published' })

  if (loading) return <Loading />
  if (!period || !ctx) return <NoPeriod />
  const bands = bandsOrDefault(ctx.bands)
  const d = draft ?? fbQ.data?.draft ?? EMPTY_DRAFT
  // Finalised and not yet published: once out, a result moves to Published Results and cannot be edited.
  const open = rows.filter(r => r.finalised && !r.published)
  const label = (r: (typeof rows)[number]) => `${r.code} · ${r.name} — rated ${r.finalRating}`

  return (
    <>
      {!!msg && <PCard><K>{msg}</K></PCard>}
      {tab === 'finalise' && (
        <FinaliseTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} role="HOD"
          chain={ctx.chain} whoCanFinalise={ctx.policy?.who_can_finalise ?? 'RM1_RM2_HOD'}
          finalReviewRequired={ctx.policy?.final_review_one_to_one ?? false} deptName="your department"
          onFinalise={(id, rating) => run(() => finalise(employeeId, id, period.id, rating))}
          onLogFinalReview={id => run(() => logFinalReview({ companyId: ctx.companyId, periodId: period.id, employeeId: id, managerId: employeeId, today }))}
          saving={saving} />
      )}
      {tab === 'feedback' && !showFinaliserFeedbackTab(ctx.postFinalOwner) && <FeedbackOwnedByHr />}
      {tab === 'feedback' && showFinaliserFeedbackTab(ctx.postFinalOwner) && (
        <>
          <PCard>
            <PickerField label="Whose result" value={member && open.includes(member) ? label(member) : ''} placeholder="Choose somebody…" onPress={() => setPickOpen(true)}
              style={{ marginBottom: 0 }} />
            {!rows.some(r => r.finalised) ? (
              <K style={{ marginTop: 6 }}>Nobody in your department has been finalised yet. Settle a rating on Review &amp; Finalise first — feedback is published with the result, not before it.</K>
            ) : !open.length ? (
              <K style={{ marginTop: 6 }}>Every settled result in your department has been published. They are on <B>Published Results</B>, where they cannot be edited — the employees have already read them.</K>
            ) : null}
          </PCard>
          <FeedbackTab bands={bands} member={member} rating={member?.finalRating ?? null}
            appreciation={d.appreciation} improvement={d.improvement} benefits={d.benefits} logs={fbQ.data?.logs ?? []}
            onChange={patch => setDraft({ ...d, ...patch })}
            onPublish={member ? () => run(() => publishResult({ viewerId: employeeId, companyId: ctx.companyId, periodId: period.id, member, draft: d })) : undefined}
            onAcknowledgeFinalReview={picked ? () => run(() => acknowledgeFinalReview(picked, period.id, 'hod')) : undefined}
            saving={saving} />
          <SelectSheet visible={pickOpen} onClose={() => setPickOpen(false)} title="Whose result" value={picked ?? ''}
            options={[{ value: '', label: 'Choose somebody…' }, ...open.map(r => ({ value: r.employeeId, label: label(r) }))]}
            onPick={v => { setPicked(String(v) || null); setDraft(null) /* one draft per person */ }} />
        </>
      )}
      {tab === 'published' && (
        <PublishedResultsTab members={rows} bands={bands} results={pubQ.data ?? []} deptName="Your department" hrHead={hrHeadQ.data ?? null} />
      )}
      {tab === 'deptAnalytics' && <TeamAnalyticsTab flagRules={ctx.flagRules} bands={bands} members={rows} today={today} scopeLabel="your department" />}
    </>
  )
}
