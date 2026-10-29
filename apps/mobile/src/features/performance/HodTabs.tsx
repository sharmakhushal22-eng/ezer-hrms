// src/features/performance/HodTabs.tsx — analytics and the HOD's tabs
// (website: components/pms/ManagerTabs.tsx §4.5, §5.1–5.3). Live as on the
// website: Finalise (pms_finalise), Log final review / Acknowledge it, and
// Feedback & Recognition → Publish. "Nudge RM L2" has no handler in ESS and
// stays disabled, as on the website.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, finaliseQueue, distribution, type TeamMember, type FinaliseRow } from '@web/pms/team'
import { score, byCategory, bandFor, checkFeedback, DEFAULT_BANDS, type Band } from '@web/pms/scoring'
import { canPublishResult, type Log } from '@web/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Chain, type Finaliser, type Role } from '@web/pms/hierarchy'
import type { FlagRules } from '@web/pms/employment'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { ABar, B, Banner, EmptyBlock, Field, K, PCard, Pill, PStat, StatGrid } from './ui'
import { BENEFIT_LABEL, BENEFIT_TYPES, type BenefitType, type FeedbackDraft } from './data'
import { EMPTY_TEAM, ExitBanner, QueueCard } from './MgrTabs'

// ── §4.5 / §5.3 analytics (lines are always [] and averages null in ESS) ──
export function TeamAnalyticsTab({ members, today, scopeLabel, bands = DEFAULT_BANDS, flagRules }: {
  members: TeamMember[]; today: string; scopeLabel: string; bands?: Band[]; flagRules?: FlagRules
}) {
  const rows = teamQueue(members, today, flagRules)
  const dist = distribution(rows)
  const rated = dist.reduce((s, d) => s + d.n, 0)
  const cats = byCategory([], 'final')
  return (
    <>
      <PCard title={`How ${scopeLabel} was rated`} sub="For information. There is no curve to fit. With no pay attached, a forced distribution would be rationing nothing.">
        {rated === 0 ? <K>Nothing has been finalised yet, so there is no distribution to show.</K>
          : dist.map(d => <ABar key={d.rating} name={`${d.rating} · ${bandFor(d.rating, bands)?.label ?? ''}`} final={d.n / rated} solidOnly value={`${d.n} · ${Math.round((d.n / rated) * 100)}%`} />)}
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

// ── §5.1 Review & Finalise ───────────────────────────────────────────────
interface FinaliseHandlers {
  onFinalise?: (id: string, rating: number) => void
  onLogFinalReview?: (id: string) => void
  onAcknowledgeFinalReview?: (id: string) => void
  saving?: boolean
}
function FinaliseCard({ r, bands, finalReviewRequired, onFinalise, onLogFinalReview, onAcknowledgeFinalReview, saving }: FinaliseHandlers & {
  r: FinaliseRow; bands: Band[]; finalReviewRequired: boolean
}) {
  const [picked, setPicked] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState(false)
  const m = r.member
  const band = picked ? bands.find(b => b.value === picked) : null
  let action: React.ReactNode
  if (m.finalised) action = <K>done</K>
  else if (r.canFinalise) action = <Button size="sm" title="Finalise" disabled={!picked || !onFinalise || saving} onPress={() => picked && onFinalise?.(m.employeeId, picked)} />
  else if (r.insteadDo?.startsWith('RM L2')) action = <Button size="sm" variant="ghost" title="Nudge RM L2" disabled />
  else if (finalReviewRequired && !m.finalReviewDone && r.precedingDone) {
    action = !m.finalReviewLogged
      ? <Button size="sm" title="Log final review" disabled={!onLogFinalReview || saving} onPress={() => onLogFinalReview?.(m.employeeId)} />
      : !m.finalReviewMgrAcked
        ? <Button size="sm" title="Acknowledge it" disabled={!onAcknowledgeFinalReview || saving} onPress={() => onAcknowledgeFinalReview?.(m.employeeId)} />
        : <K>Waiting on {m.name.split(' ')[0]} to acknowledge the final review</K>
  } else action = <K>{r.insteadDo}</K>
  return (
    <QueueCard r={r}>
      <View style={{ marginTop: 8 }}>
        <Field label="RM L1">{m.rmL1Score?.toFixed(2) ?? '-'}</Field>
        <Field label="RM L2">{m.rmL2Score?.toFixed(2) ?? '-'}</Field>
        <Field label="Final rating">
          {m.finalised ? <Pill kind="green" label={`${m.finalRating} · finalised`} />
            : <PickerField value={band ? `${band.value} · ${band.label}` : ''} placeholder="Choose" disabled={!r.canFinalise}
                onPress={() => setOpen(true)} style={{ marginBottom: 0 }} />}
        </Field>
        <Field label="Action">{action}</Field>
      </View>
      <SelectSheet visible={open} onClose={() => setOpen(false)} title="Final rating" value={picked ?? undefined}
        options={bands.map(b => ({ value: b.value, label: `${b.value} · ${b.label}` }))} onPick={v => setPicked(Number(v))} />
    </QueueCard>
  )
}

export function FinaliseTab({ members, today, role, chain, whoCanFinalise, deptName, bands = DEFAULT_BANDS, finalReviewRequired = false, flagRules, ...h }: FinaliseHandlers & {
  members: TeamMember[]; today: string; role: Role; chain: Chain; whoCanFinalise: Finaliser; deptName: string
  bands?: Band[]; finalReviewRequired?: boolean; flagRules?: FlagRules
}) {
  const rows = finaliseQueue(members, today, { role, chain, whoCanFinalise, finalReviewRequired, rules: flagRules })
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
        {rows.length === 0 ? <EmptyBlock title="Nothing to finalise" note={EMPTY_TEAM} />
          : rows.map(r => <FinaliseCard key={r.member.employeeId} r={r} bands={bands} finalReviewRequired={finalReviewRequired} {...h} />)}
      </PCard>
    </>
  )
}

// ── §5.2 Feedback & Recognition ──────────────────────────────────────────
function BenefitRow({ b, i, onType, onNote }: { b: FeedbackDraft['benefits'][number]; i: number; onType: (i: number) => void; onNote: (i: number, t: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.sm }}>
      <PickerField label="Type" value={BENEFIT_LABEL[b.type]} onPress={() => onType(i)} />
      <Input label="What for" value={b.note} style={{ marginBottom: 0 }} accessibilityLabel={`Recognition ${i + 1} what for`} onChangeText={t => onNote(i, t)} />
    </View>
  )
}

export function FeedbackTab({ member, rating, appreciation, improvement, benefits, logs, bands = DEFAULT_BANDS, onChange, onPublish, saving }: {
  member: TeamMember | null; rating: number | null
  appreciation: string; improvement: string; benefits: FeedbackDraft['benefits']; logs: Log[]
  bands?: Band[]; onChange: (patch: Partial<FeedbackDraft>) => void; onPublish?: () => void; saving?: boolean
}) {
  const [typeFor, setTypeFor] = React.useState<number | null>(null)
  if (!member) {
    return (
      <PCard title="Pick somebody">
        <K>Choose a person from the finalisation queue to write their feedback.</K>
      </PCard>
    )
  }
  const check = checkFeedback(rating, { appreciation, improvement }, bands)
  const publish = canPublishResult(logs)
  const band = bandFor(rating, bands)
  const canPublish = check.ok && publish.open
  const setB = (i: number, patch: Partial<FeedbackDraft['benefits'][number]>) => onChange({ benefits: benefits.map((x, j) => j === i ? { ...x, ...patch } : x) })
  return (
    <>
      <StatGrid>
        <PStat tone="accent" label="Writing feedback for" value={member.name} note={member.code} />
        <PStat label="Final rating" value={rating === null ? '-' : `${rating}${band ? ` · ${band.label}` : ''}`} />
        <PStat tone={band?.improvementMandatory ? 'warn' : undefined} label="Improvement feedback" value={band?.improvementMandatory ? 'Required' : 'Optional'}
          note={band?.improvementMandatory ? 'Mandatory at this rating' : 'Write it anyway if there is something to say'} />
      </StatGrid>
      <Input label="🏆 Appreciation" value={appreciation} multiline onChangeText={t => onChange({ appreciation: t })}
        placeholder="What they did well, specifically enough that they could repeat it" />
      <Input label="📈 Where to improve" value={improvement} multiline onChangeText={t => onChange({ improvement: t })}
        placeholder="What would change the rating, and what support goes with it" />
      <PCard title="🎁 Recognition" sub="Non-monetary only: a certificate, a nomination, an award. Anything with a cash component would touch payroll, and this module does not.">
        {benefits.map((b, i) => <BenefitRow key={i} b={b} i={i} onType={setTypeFor} onNote={(j, t) => setB(j, { note: t })} />)}
        <Button size="sm" variant="ghost" title="+ Add recognition" style={{ alignSelf: 'flex-start' }}
          onPress={() => onChange({ benefits: [...benefits, { type: 'CERTIFICATE', note: '' }] })} />
      </PCard>
      {(!check.ok || !publish.open) && (
        <Banner tone="amber" glyph="!" raw>
          <Txt size={F.tiny} w={700} tone="warning">Before this can be published:</Txt>
          {check.faults.map((f, i) => <Txt key={i} size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {f}</Txt>)}
          {!publish.open && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {publish.because}</Txt>}
        </Banner>
      )}
      <Button full disabled={!canPublish || !onPublish || saving} onPress={onPublish}
        title={saving ? 'Publishing…' : canPublish ? 'Publish the result' : 'Cannot publish yet'} />
      <SelectSheet visible={typeFor !== null} onClose={() => setTypeFor(null)} title="Type"
        value={typeFor !== null ? benefits[typeFor]?.type : undefined}
        options={BENEFIT_TYPES.map(t => ({ value: t, label: BENEFIT_LABEL[t] }))}
        onPick={v => { if (typeFor !== null) setB(typeFor, { type: v as BenefitType }) }} />
    </>
  )
}
