// src/features/performance/HodTabs.tsx — analytics, the HOD side, and the two
// manager-audience containers (website: ManagerTabs.tsx §4.5, §5.1–5.3 and
// Performance.tsx TeamSide / DeptSide). Read-only in ESS: no onFinalise /
// onNudge, and Feedback & Recognition never has a member picked.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { teamQueue, finaliseQueue, distribution, type TeamMember, type FinaliseRow } from '@web/pms/team'
import { score, byCategory, bandFor, DEFAULT_BANDS } from '@web/pms/scoring'
import { CHAIN_LABEL, FINALISER_LABEL } from '@web/pms/hierarchy'
import { Button, Loading, PickerField } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { ABar, B, Banner, EmptyBlock, Field, K, PCard, Pill, PStat, StatGrid } from './ui'
import { loadPeriod, loadRoster, localToday } from './data'
import { NoPeriod } from './Pending'
import { ApproveTab, EMPTY_TEAM, ExitBanner, PipRequestTab, QueueCard, RateTab, TeamTab } from './MgrTabs'

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

// ── §4.5 / §5.3 analytics (lines are always [] and averages null in ESS) ──
export function TeamAnalyticsTab({ members, today, scopeLabel }: { members: TeamMember[]; today: string; scopeLabel: string }) {
  const rows = teamQueue(members, today)
  const dist = distribution(rows)
  const rated = dist.reduce((s, d) => s + d.n, 0)
  const cats = byCategory([], 'final')
  return (
    <>
      <PCard title={`How ${scopeLabel} was rated`} sub="For information. There is no curve to fit. With no pay attached, a forced distribution would be rationing nothing.">
        {rated === 0 ? <K>Nothing has been finalised yet, so there is no distribution to show.</K>
          : dist.map(d => <ABar key={d.rating} name={`${d.rating} · ${bandFor(d.rating)?.label ?? ''}`} final={d.n / rated} solidOnly value={`${d.n} · ${Math.round((d.n / rated) * 100)}%`} />)}
      </PCard>
      <StatGrid>
        <PStat label={`${scopeLabel} average`} value="-" />
        <PStat label="Company average" value="-" />
        <PStat label="Rated 2 or below" value={dist.filter(d => d.rating <= 2).reduce((s, d) => s + d.n, 0)} note="Each of these owes improvement feedback" />
      </StatGrid>
      <PCard title="Where the strength is, by category" sub="A low category across a whole team is a training need, not a run of individual failures.">
        {cats.length === 0 ? <K>No finalised ratings yet.</K>
          : cats.map(c => <ABar key={c.category} name={c.label} final={(c.score ?? 0) / 5} solidOnly value={c.score === null ? '-' : c.score.toFixed(2)} />)}
      </PCard>
    </>
  )
}

function FinaliseCard({ r }: { r: FinaliseRow }) {
  const [picked, setPicked] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState(false)
  const band = picked ? DEFAULT_BANDS.find(b => b.value === picked) : null
  return (
    <QueueCard r={r}>
      <View style={{ marginTop: 8 }}>
        <Field label="RM L1">{r.member.rmL1Score?.toFixed(2) ?? '-'}</Field>
        <Field label="RM L2">{r.member.rmL2Score?.toFixed(2) ?? '-'}</Field>
        <Field label="Final rating">
          {r.member.finalised ? <Pill kind="green" label={`${r.member.finalRating} · finalised`} />
            : <PickerField value={band ? `${band.value} · ${band.label}` : ''} placeholder="Choose" disabled={!r.canFinalise}
                onPress={() => setOpen(true)} style={{ marginBottom: 0 }} />}
        </Field>
        <Field label="Action">
          {/* No onFinalise / onNudge in ESS: both buttons stay disabled, as on the website. */}
          {r.member.finalised ? <K>done</K>
            : r.canFinalise ? <Button size="sm" title="Finalise" disabled />
            : r.insteadDo?.startsWith('RM L2') ? <Button size="sm" variant="ghost" title="Nudge RM L2" disabled />
            : <K>{r.insteadDo}</K>}
        </Field>
      </View>
      <SelectSheet visible={open} onClose={() => setOpen(false)} title="Final rating" value={picked ?? undefined}
        options={DEFAULT_BANDS.map(b => ({ value: b.value, label: `${b.value} · ${b.label}` }))} onPick={v => setPicked(Number(v))} />
    </QueueCard>
  )
}

// ── §5.1 Review & Finalise (role HOD, chain SELF_RM1_RM2_HOD, RM1_RM2_HOD) ──
export function FinaliseTab({ members, today, deptName }: { members: TeamMember[]; today: string; deptName: string }) {
  const chain = 'SELF_RM1_RM2_HOD' as const
  const whoCanFinalise = 'RM1_RM2_HOD' as const
  const rows = finaliseQueue(members, today, { role: 'HOD', chain, whoCanFinalise })
  const awaiting = rows.filter(r => !r.member.finalised).length
  const done = rows.filter(r => r.member.finalised).length
  const urgent = rows.filter(r => r.tone !== 'normal' && !r.member.finalised).length
  const avg = score(rows.filter(r => r.member.finalRating !== null).map(r => ({
    goalId: r.member.employeeId, title: r.member.name, category: 'BUSINESS' as const, weightage: 1, final: r.member.finalRating,
  })), 'final')
  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        The chain is <B>{CHAIN_LABEL[chain]}</B>, and under this policy <B>{FINALISER_LABEL[whoCanFinalise]}</B> may finalise. A row cannot be finalised while a step ahead of it is still open. That is not a nicety, it is the difference between a rating that went through the chain and one that skipped it.
      </Banner>
      <ExitBanner rows={rows} />
      <StatGrid>
        <PStat tone="accent" label="Awaiting finalisation" value={awaiting} note={`of ${rows.length}`} />
        <PStat label="Finalised" value={done} />
        <PStat tone={urgent ? 'warn' : undefined} label="Exit or notice" value={urgent} note={urgent ? 'Clear these first. Their deadline cannot move' : 'None outstanding'} />
        <PStat label={`${deptName} average`} value={avg === null ? '-' : avg.toFixed(2)} />
      </StatGrid>
      <PCard title={`Finalisation queue: ${deptName}`} sub="Exit and notice rows are pinned to the top, because after a last working day the record locks for good.">
        {rows.length === 0 ? <EmptyBlock title="Nothing to finalise" note={EMPTY_TEAM} /> : rows.map(r => <FinaliseCard key={r.member.employeeId} r={r} />)}
      </PCard>
    </>
  )
}

// ── §5.2 Feedback & Recognition — `member` is always null in ESS ─────────
export function FeedbackTab() {
  return (
    <PCard title="Pick somebody">
      <K>Choose a person from the finalisation queue to write their feedback.</K>
    </PCard>
  )
}

// ── containers ───────────────────────────────────────────────────────────
function useRosterFor(employeeId: string, as: 'rm' | 'hod') {
  const periodQ = useQuery({ queryKey: ['pms', 'period', employeeId], queryFn: () => loadPeriod(employeeId), enabled: !!employeeId })
  const period = periodQ.data?.period ?? null
  const rosterQ = useQuery({ queryKey: ['pms', 'roster', as, employeeId, period?.id], queryFn: () => loadRoster(employeeId, period!.id, as), enabled: !!period })
  return { loading: periodQ.isLoading || (!!period && rosterQ.isLoading), period, rows: rosterQ.data ?? [] }
}

export function TeamSide({ employeeId, tab }: { employeeId: string; tab: MgrTab }) {
  const { loading, period, rows } = useRosterFor(employeeId, 'rm')
  const today = localToday()
  if (loading) return <Loading />
  if (!period) return <NoPeriod />
  return (
    <>
      {tab === 'team' && <TeamTab members={rows} today={today} managerName="your team" />}
      {tab === 'approve' && <ApproveTab members={rows} today={today} />}
      {tab === 'rate' && <RateTab />}
      {tab === 'pip' && <PipRequestTab members={rows} today={today} />}
      {tab === 'analytics' && <TeamAnalyticsTab members={rows} today={today} scopeLabel="your team" />}
    </>
  )
}

export function DeptSide({ employeeId, tab }: { employeeId: string; tab: HodTab }) {
  const { loading, period, rows } = useRosterFor(employeeId, 'hod')
  const today = localToday()
  if (loading) return <Loading />
  if (!period) return <NoPeriod />
  return (
    <>
      {tab === 'finalise' && <FinaliseTab members={rows} today={today} deptName="your department" />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'deptAnalytics' && <TeamAnalyticsTab members={rows} today={today} scopeLabel="your department" />}
    </>
  )
}
